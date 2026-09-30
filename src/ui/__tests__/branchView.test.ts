// 분기 트리 화면 규칙 (명세서 3.9 분기 트리, 10-6)
import { describe, expect, it } from 'vitest';
import type { BranchInfo } from '../../app/appController';
import {
  branchComparison,
  branchConfirmText,
  branchFullText,
  branchLabel,
  branchMenuEnabled,
  branchRows,
  deleteConfirmText,
  descendantCount,
  fileBranchNumber,
  forkMarks,
  newMatchConfirmText,
  shownBranchName,
} from '../branchView';
import { matchFileName, summaryFileName } from '../matchFile';

// 1(Main, 종료 87) ─ 2(Plan B, 1:40에서, 종료 95) ─ 3(자동, 1:20에서, 미종료 머리 0:50)
//                  └ 4(자동, 0:30에서, 종료 87)
const info = (b: Partial<BranchInfo> & Pick<BranchInfo, 'id'>): BranchInfo => ({
  number: b.id, name: null, parentId: null, forkTick: 0, depth: 0, headTick: 6000, ended: true, totalScore: 0, ...b,
});
const branches: BranchInfo[] = [
  info({ id: 1, totalScore: 87 }),
  info({ id: 2, name: 'Plan B', parentId: 1, forkTick: 1000, depth: 1, totalScore: 95 }),
  info({ id: 3, parentId: 2, forkTick: 2000, depth: 2, headTick: 3500, ended: false, totalScore: null }),
  info({ id: 4, parentId: 1, forkTick: 4500, depth: 1, totalScore: 87 }),
];
const tree = (currentBranchId: number, list = branches) => ({ branches: list, currentBranchId });

describe('분기 트리 화면 규칙 (10-6)', () => {
  it('A. 가지 이름: 사용자 이름, 없으면 원본 Main / "원본", 가지 Branch n / "가지 n"', () => {
    expect(branchLabel('en', branches[0])).toBe('Main');
    expect(branchLabel('ko', branches[0])).toBe('원본');
    expect(branchLabel('en', branches[2])).toBe('Branch 3');
    expect(branchLabel('ko', branches[2])).toBe('가지 3');
    expect(branchLabel('ko', branches[1])).toBe('Plan B');
  });

  it('B. 가지 목록 줄: 깊이 / 분기 시각(원본 —) / 상태(종료 = 점수, 미종료 = 머리 시각) / 지금 가지 / 삭제 가능', () => {
    const rows = branchRows('en', tree(3));
    expect(rows.map(r => [r.label, r.depth, r.forkText, r.stateText, r.current, r.deletable])).toEqual([
      ['Main', 0, '—', '87 pts', false, false],
      ['Plan B', 1, 'from 1:40', '95 pts', false, true],
      ['Branch 3', 2, 'from 1:20', 'to 0:50', true, true],
      ['Branch 4', 1, 'from 0:30', '87 pts', false, true],
    ]);
    expect(branchRows('ko', tree(3)).map(r => `${r.forkText} ${r.stateText}`)).toEqual(['— 87점', '1:40에서 95점', '1:20에서 0:50까지', '0:30에서 87점']);
    // 경기 시작(0틱)에서 갈라진 가지도 분기 시각을 보인다 (— 는 원본만)
    const atStart = branchRows('en', tree(1, [branches[0], info({ id: 5, parentId: 1, forkTick: 0, depth: 1, headTick: 100, ended: false, totalScore: null })]));
    expect(atStart[1].forkText).toBe('from 2:00');
  });

  it('C. 가지 목록을 열 수 있는 상태: 경기 중 + 보는 틱 이동 가능 + 재생 아님', () => {
    expect(branchMenuEnabled({ phase: 'MATCH', canScrub: true, playing: false })).toBe(true);
    expect(branchMenuEnabled({ phase: 'MATCH', canScrub: true, playing: true })).toBe(false);
    expect(branchMenuEnabled({ phase: 'MATCH', canScrub: false, playing: false })).toBe(false); // 진행 / 종료 강조 / 결과 팝업
    expect(branchMenuEnabled({ phase: 'ROTATING_IN', canScrub: false, playing: false })).toBe(false);
    expect(branchMenuEnabled({ phase: 'SETUP', canScrub: false, playing: false })).toBe(false);
  });

  it('D. 타임라인 분기 표식: 지금 가지와 그 조상이 갈라진 틱 (앞 틱부터), 원본이면 없음', () => {
    expect(forkMarks('en', tree(3))).toEqual([
      { fraction: 1000 / 6000, title: 'Plan B · from Main at 1:40' },
      { fraction: 2000 / 6000, title: 'Branch 3 · from Plan B at 1:20' },
    ]);
    expect(forkMarks('ko', tree(4))).toEqual([{ fraction: 0.75, title: '가지 4 · 원본의 0:30에서' }]);
    expect(forkMarks('en', tree(1))).toEqual([]);
  });

  it('E. 확인창 문구: 분기(보는 틱 시각 + 지금 가지) / 가득 참 / 삭제(하위 수) / NEW(가지 수)', () => {
    expect(branchConfirmText('en', { ...tree(2), tick: 1500 })).toBe('Start a new branch at 1:30 and drive again? The current branch (Plan B) keeps its record.');
    expect(branchConfirmText('ko', { ...tree(1), tick: 0 })).toBe('2:00에서 새 가지를 만들어 다시 조종할까요? 지금 가지(원본)의 기록은 그대로 남습니다.');
    expect(branchFullText('en')).toBe('All 8 branches are in use. Delete a branch from the branch list before branching.');
    expect(descendantCount(tree(1), 1)).toBe(3);
    expect(descendantCount(tree(1), 2)).toBe(1);
    expect(deleteConfirmText('en', tree(1), 2)).toBe('Delete the branch "Plan B" with its sub-branches (1)?');
    expect(deleteConfirmText('ko', tree(1), 4)).toBe("'가지 4' 가지를 삭제할까요?");
    expect(newMatchConfirmText('en', tree(1))).toBe('Discard this match with all 4 branches and start a new one with the same settings?');
    expect(newMatchConfirmText('en', tree(1, [branches[0]]))).toBe('Discard this match and start a new one with the same settings?');
    expect(newMatchConfirmText('ko', tree(1, branches.slice(0, 2)))).toBe('이 경기와 가지 2개를 모두 버리고 같은 설정으로 새 경기를 시작할까요?');
  });

  it('F. 결과 팝업 / 요약: 가지 이름은 2개 이상이거나 사용자 이름이 있을 때, 비교 줄은 종료한 가지 2개 이상 (최고 점수 동점 모두)', () => {
    expect(shownBranchName('en', tree(2))).toBe('Plan B');
    expect(shownBranchName('en', tree(1, [branches[0]]))).toBeNull();
    expect(shownBranchName('en', tree(1, [{ ...branches[0], name: 'Loaded run' }]))).toBe('Loaded run');
    expect(branchComparison('en', tree(4))).toEqual([
      { id: 1, label: 'Main', score: 87, current: false, best: false },
      { id: 2, label: 'Plan B', score: 95, current: false, best: true },
      { id: 4, label: 'Branch 4', score: 87, current: true, best: false },
    ]);
    const tie = [branches[0], { ...branches[1], totalScore: 87 }, branches[2]];
    expect(branchComparison('en', tree(1, tie))!.map(c => c.best)).toEqual([true, true]);
    expect(branchComparison('en', tree(1, [branches[0], branches[2]]))).toBeNull();
  });

  it('G. 파일 이름: 원본이 아닌 가지는 _b{번호}', () => {
    expect(fileBranchNumber(tree(1))).toBeNull();
    expect(fileBranchNumber(tree(4))).toBe(4);
    const date = new Date(2026, 8, 30, 14, 32);
    expect(matchFileName(date, 'RED', 87, fileBranchNumber(tree(4)))).toBe('tacticsim-match_20260930-1432_RED_87pts_b4.json');
    expect(summaryFileName(date, 'RED', 87, fileBranchNumber(tree(1)))).toBe('tacticsim-summary_20260930-1432_RED_87pts.txt');
  });
});
