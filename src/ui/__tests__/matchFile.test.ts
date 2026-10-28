// 경기 파일 화면 규칙 (명세서 3.9 경기 불러오기 / 경기 내보내기, 10-4)
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../app/appController';
import type { RecipeWarning } from '../../app/matchRecipe';
import { BALLISTICS_MODEL_VERSION } from '../../core/ballistics';
import { ENGINE_VERSION } from '../../core/simulationEngine';
import { PENDING_LUT_VIEW } from '../lutView';
import type { RobotLutView } from '../lutView';
import {
  autosaveRestoreMessage,
  matchComputingText,
  matchFileName,
  matchImportConfirmMessage,
  matchImportErrorMessage,
  matchImportProgress,
  matchSummaryText,
  compareLoadedBranch,
  mismatchBanner,
  summaryFileName,
} from '../matchFile';
import type { MatchImportError } from '../matchFile';
import { t } from '../i18n';

const result: MatchResult = {
  total: 42,
  breakdown: {
    hive: 20,
    cell: 4,
    flower: 9,
    garden: 4,
    park: 5,
    flowers: [
      { id: 'flower1', scoringPieces: 3, owned: false, points: 0 },
      { id: 'flower2', scoringPieces: 2, owned: true, points: 9 },
      { id: 'flower3', scoringPieces: 0, owned: false, points: 0 },
      { id: 'flower4', scoringPieces: 1, owned: false, points: 0 },
    ],
    gardenPieceIds: ['pollen-1', 'pollen-2', 'pollen-3', 'nectar-4'],
    gardenPieces: { nectar: 1, pollen: 3 },
    parkedRobots: ['robot1'],
    cellPieces: { nectar: 1, pollen: 1 },
  },
  rp: { swarm: false, pollinator1: true, pollinator2: false },
  tips: 6,
  autoTips: 5,
  teleopTips: 1,
  settleTips: 0,
  thresholds: { swarmPoints: 16, pollinator1Tips: 4, pollinator2Tips: 7 },
  autoMovementPoints: 6,
};
const teams = { robot1: { teamNumber: '12345', teamName: 'Bumblebots' }, robot2: { teamNumber: '', teamName: 'Hive Mind' } };
const date = new Date(2026, 8, 30, 14, 32, 5);
const view = (over: Partial<RobotLutView>): RobotLutView => ({ ...PENDING_LUT_VIEW, ...over });

describe('경기 파일 화면 규칙 (10-4)', () => {
  it('A. 거부 사유 문구: 코드별 영어 / 한국어, 항목 / 버전 / 문제 코드 채움', () => {
    const errors: MatchImportError[] = [
      { code: 'NOT_JSON' },
      { code: 'PRESET_FILE' },
      { code: 'NOT_RECIPE' },
      { code: 'RECIPE_VERSION', version: 3 },
      { code: 'INVALID_FIELD', field: 'setup.robot1' },
      { code: 'INVALID_INPUTS', field: 'robot2' },
      { code: 'INVALID_CHECKSUMS' },
      { code: 'TOO_MANY_BRANCHES', count: 17 },
      { code: 'INVALID_SETUP', issues: ['FIELD_maxSpeed', 'PLACEMENT_ROBOT_OVERLAP'] },
      { code: 'TOO_LARGE' },
      { code: 'READ_FAILED' },
    ];
    for (const e of errors) {
      for (const lang of ['en', 'ko'] as const) {
        const text = matchImportErrorMessage(lang, e);
        expect(text).not.toMatch(/matchImport\.|preset\.error|\{/);
      }
      expect(matchImportErrorMessage('ko', e)).not.toBe(matchImportErrorMessage('en', e));
    }
    expect(matchImportErrorMessage('en', { code: 'RECIPE_VERSION', version: 3 })).toBe('Unsupported match file format (v3)');
    expect(matchImportErrorMessage('ko', { code: 'TOO_MANY_BRANCHES', count: 17 })).toBe('파일의 가지가 17개 — 이 앱은 16개까지 담을 수 있습니다');
    expect(matchImportErrorMessage('en', { code: 'INVALID_FIELD', field: 'setup.robot1' })).toBe('Damaged match file (setup.robot1)');
    expect(matchImportErrorMessage('ko', { code: 'INVALID_INPUTS', field: 'robot2' })).toBe('손상된 경기 파일 (입력: robot2)');
    expect(matchImportErrorMessage('en', { code: 'INVALID_SETUP', issues: ['FIELD_maxSpeed', 'PLACEMENT_ROBOT_OVERLAP'] })).toBe('The settings in the file are invalid (FIELD_maxSpeed, PLACEMENT_ROBOT_OVERLAP)');
    expect(matchImportErrorMessage('en', { code: 'NOT_JSON' })).toBe('Not a JSON file');
  });

  it('B. 확인창: 설정 교체 안내 + 해당될 때만 경고 줄', () => {
    expect(matchImportConfirmMessage('en', [])).toBe('Replace the R1, R2 and SCENARIO settings with the file and load the match?');
    const warnings: RecipeWarning[] = [
      { code: 'ENGINE_VERSION', file: ENGINE_VERSION + 1, current: ENGINE_VERSION },
      { code: 'BALLISTICS_VERSION', file: BALLISTICS_MODEL_VERSION + 1, current: BALLISTICS_MODEL_VERSION },
      { code: 'LUT_SETTINGS' },
    ];
    const lines = matchImportConfirmMessage('en', warnings).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`⚠ Made with engine v${ENGINE_VERSION + 1} (this app: v${ENGINE_VERSION}) — results may differ`);
    expect(lines[2]).toContain(`ballistics model v${BALLISTICS_MODEL_VERSION + 1}`);
    expect(lines[3]).toContain('Hit map settings differ');
    expect(matchImportConfirmMessage('ko', [warnings[0]]).split('\n')[1]).toContain(`엔진 v${ENGINE_VERSION + 1}`);
    // 가지가 2개 이상인 트리 (15-3): 안내 바로 아래 가지 수 줄, 경고는 그 뒤
    expect(matchImportConfirmMessage('en', [], 1)).toBe(matchImportConfirmMessage('en', []));
    const tree = matchImportConfirmMessage('ko', [{ code: 'LUT_SETTINGS' }], 4).split('\n');
    expect(tree).toHaveLength(3);
    expect(tree[1]).toBe('가지 4개를 불러옵니다.');
    expect(tree[2]).toContain('⚠');
  });

  it('B2. (19-1) 자동 저장 복구 확인창: 저장 시각 · 지금 가지 이름 + 남은 시간(끝났으면 점수), 가지 수, 불러오기와 같은 경고 줄', () => {
    const b = (number: number, parent: number | null, headTick: number, name: string | null = null, score: number | null = null) => ({
      number, parent, forkTick: 0, name, headTick, inputs: { robot1: new Int8Array(), robot2: new Int8Array() }, checksums: [],
      result: score === null ? null : { totalScore: score, rp: { swarm: false, pollinator1: false, pollinator2: false } },
    });
    const createdAt = '2026-10-24T09:05:00';
    const one = autosaveRestoreMessage('en', { createdAt, branches: [b(1, null, 1500)], current: 1 }, []);
    expect(one.split('\n')).toEqual(['Restore the last match? It was saved automatically before the page closed.', 'Saved 2026-10-24 09:05 · Main 1:30']);
    const tree = { createdAt, branches: [b(1, null, 6000, null, 38), b(2, 1, 6000, 'Plan B', 52)], current: 2 };
    const ko = autosaveRestoreMessage('ko', tree, [{ code: 'ENGINE_VERSION', file: 1, current: 2 }]).split('\n');
    expect(ko[1]).toBe('저장 2026-10-24 09:05 · Plan B 종료, 52점');
    expect(ko[2]).toBe(t('ko', 'matchImport.branches', { count: 2 }));
    expect(ko[3].startsWith('⚠ ')).toBe(true);
    expect(autosaveRestoreMessage('en', { createdAt: 'bad', branches: [b(1, null, 100)], current: 9 }, []).split('\n')[1]).toBe('Saved — · Main 1:58'); // 100틱 = 2초
  });

  it('C. 준비 진행: 두 로봇 평균(준비 완료 = 100%), 오류가 있으면 오류', () => {
    expect(matchImportProgress({ robot1: view({ phase: 'READY', progress: 1 }), robot2: view({ phase: 'READY', progress: 1 }) })).toEqual({ percent: 100, error: false });
    expect(matchImportProgress({ robot1: view({ phase: 'READY', progress: 0 }), robot2: view({ phase: 'WORKING', progress: 0.5 }) })).toEqual({ percent: 75, error: false });
    expect(matchImportProgress({ robot1: view({ phase: 'WORKING', progress: 0.333 }), robot2: view({ phase: 'WORKING', progress: 0.333 }) })).toEqual({ percent: 33, error: false });
    // 내림: 끝나기 전에는 100%로 보이지 않음
    expect(matchImportProgress({ robot1: view({ phase: 'WORKING', progress: 0.999 }), robot2: view({ phase: 'READY', progress: 1 }) }).percent).toBe(99);
    expect(matchImportProgress({ robot1: view({ phase: 'ERROR', progress: 0.2 }), robot2: view({ phase: 'READY', progress: 1 }) }).error).toBe(true);
  });

  it('C2. 재계산 진행 (15-3): 가지가 2개 이상이면 지금 계산 중인 가지 번째 / 전체, 하나면 "재계산 중"', () => {
    expect(matchComputingText('en', 0, 1)).toBe(matchComputingText('en', 0, 0));
    expect(matchComputingText('en', 0, 1)).not.toMatch(/\//);
    expect(matchComputingText('ko', 0, 3)).toBe('경기 불러오는 중 · 재계산 1 / 3');
    expect(matchComputingText('en', 2, 3)).toBe('Loading match · recalculating 3 / 3');
    // 모두 끝나 적용하는 순간에도 전체를 넘지 않음
    expect(matchComputingText('en', 3, 3)).toBe('Loading match · recalculating 3 / 3');
  });

  it('D. 체크섬 불일치 배너: 일치 = 없음, 처음부터 / 구간(경기 타이머), 버전이 달랐으면 사유 추가', () => {
    expect(mismatchBanner('en', { match: true }, [])).toBeNull();
    expect(mismatchBanner('en', { match: false, index: 0, lastMatchTick: null, firstMismatchTick: 0 }, [])).toEqual({ title: 'Results differ from the file', hint: 'From the start' });
    expect(mismatchBanner('en', { match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 }, [])!.hint).toBe('From between 1:56 and 1:55');
    expect(mismatchBanner('ko', { match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 }, [])).toEqual({ title: '파일 기록과 결과가 다릅니다', hint: '1:56 ~ 1:55 사이부터' });
    const versioned = mismatchBanner('en', { match: false, index: 1, lastMatchTick: 0, firstMismatchTick: 50 }, [{ code: 'ENGINE_VERSION', file: 9, current: 1 }]);
    expect(versioned!.hint).toBe('From between 2:00 and 1:59 · the file was made with a different engine or ballistics version');
    expect(mismatchBanner('en', { match: false, index: 1, lastMatchTick: 0, firstMismatchTick: 50 }, [{ code: 'LUT_SETTINGS' }])!.hint).toBe('From between 2:00 and 1:59');
    // 트리 (15-3): 처음 어긋난 가지 이름 + 그 밖에 어긋난 가지 수, 버전 사유는 맨 뒤
    const part = { match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 } as const;
    expect(mismatchBanner('en', part, [], { label: 'Branch 3', others: 2 })!.hint).toBe('Branch 3 · From between 1:56 and 1:55 (+2 more branches)');
    expect(mismatchBanner('ko', part, [], { label: '원본', others: 0 })!.hint).toBe('원본 · 1:56 ~ 1:55 사이부터');
    expect(mismatchBanner('ko', part, [], { label: '가지 2', others: 1 })!.hint).toBe('가지 2 · 1:56 ~ 1:55 사이부터 (외 1개 가지)');
    expect(mismatchBanner('en', part, [{ code: 'ENGINE_VERSION', file: 9, current: 1 }], { label: 'Main', others: 1 })!.hint).toBe(
      'Main · From between 1:56 and 1:55 (+1 more branches) · the file was made with a different engine or ballistics version',
    );
    expect(mismatchBanner('en', { match: true }, [], { label: 'Main', others: 3 })).toBeNull();
  });

  it('D2. (12-16) 불러온 가지 비교: 체크포인트가 먼저, 같으면 판정 결과(정착 구간) — 다르면 같은 배너 + 정착 구간 힌트', () => {
    const sums = ['a', 'b', 'c'];
    const res = (totalScore: number, swarm = false) => ({ totalScore, rp: { swarm, pollinator1: false, pollinator2: false } });
    expect(compareLoadedBranch({ checksums: sums, result: res(42) }, { checksums: [...sums], result: res(42) })).toEqual({ match: true });
    expect(compareLoadedBranch({ checksums: sums, result: null }, { checksums: sums, result: null })).toEqual({ match: true }); // 미종료 가지
    // 체크포인트가 다르면 그쪽이 먼저 (결과도 다르더라도)
    expect(compareLoadedBranch({ checksums: sums, result: res(42) }, { checksums: ['a', 'x', 'c'], result: res(47) })).toEqual({ match: false, index: 1, lastMatchTick: 0, firstMismatchTick: 50 });
    // 체크포인트는 같고 판정만 다름 (총점 / RP / 한쪽만 결과)
    const settle = compareLoadedBranch({ checksums: sums, result: res(42) }, { checksums: sums, result: res(47) });
    expect(settle).toEqual({ match: false, settle: { file: 42, now: 47 } });
    expect(compareLoadedBranch({ checksums: sums, result: res(42) }, { checksums: sums, result: res(42, true) })).toEqual({ match: false, settle: { file: 42, now: 42 } });
    expect(compareLoadedBranch({ checksums: sums, result: null }, { checksums: sums, result: res(42) })).toEqual({ match: false, settle: { file: null, now: 42 } });
    expect(mismatchBanner('en', settle, [])).toEqual({ title: 'Results differ from the file', hint: 'After 0:00, while settling (file 42 pts → now 47 pts)' });
    expect(mismatchBanner('ko', settle, [], { label: '가지 2', others: 1 })!.hint).toBe('가지 2 · 0:00 뒤 정착 구간부터 (파일 42점 → 지금 47점) (외 1개 가지)');
    expect(mismatchBanner('ko', { match: false, settle: { file: null, now: 42 } }, [])!.hint).toBe('0:00 뒤 정착 구간부터 (파일 –점 → 지금 42점)');
  });

  it('E. 파일 이름: 로컬 시각 / 진영 / 지금 가지 상태(총점 · 미종료면 남은 시간) / _b{번호} / _{가지 수}br, 요약은 같은 이름의 .txt', () => {
    expect(matchFileName(date, 'RED', { total: 87 })).toBe('tacticsim-match_20260930-1432_RED_87pts.json');
    expect(matchFileName(date, 'BLUE', { headTick: 3000 })).toBe('tacticsim-match_20260930-1432_BLUE_1-00.json');
    expect(matchFileName(date, 'RED', { headTick: 250 })).toBe('tacticsim-match_20260930-1432_RED_1-55.json');
    expect(matchFileName(date, 'RED', { total: 95 }, 3, 4)).toBe('tacticsim-match_20260930-1432_RED_95pts_b3_4br.json');
    expect(matchFileName(date, 'RED', { headTick: 3000 }, null, 2)).toBe('tacticsim-match_20260930-1432_RED_1-00_2br.json');
    expect(summaryFileName(date, 'BLUE', 0)).toBe('tacticsim-summary_20260930-1432_BLUE_0pts.txt');
  });

  it('F. 요약 텍스트: 결과 팝업과 같은 근거 / RP 규칙, 가지 이름은 있을 때만, 현재 화면 언어', () => {
    const en = matchSummaryText({ lang: 'en', result, alliance: 'RED', teams, branchName: 'Branch 3', date, seed: 12194135 });
    expect(en).toBe(
      [
        'FTC TacticSim · TELEOP MATCH COMPLETED',
        '2026-09-30 14:32 · RED · Branch 3',
        'R1 #12345 Bumblebots · R2 Hive Mind',
        'TOTAL SCORE 42',
        'HIVE    20  TELEOP TIP 1 × 20 · auto TIP 5 counts for RP only',
        'CELL     4  2 left in upward CELL × 2 (NECTAR 1 · POLLEN 1)',
        'FLOWER   9  FLOWER 2: 2 × 2 + bottom bonus 5',
        'GARDEN   4  4 counted in GARDEN × 1 (NECTAR 1 · POLLEN 3)',
        'PARK     5  R1 parked × 5 · auto LEAVE / PARK 6 counts for RP only',
        'RP  SWARM AUTO 6 + PARK 5 = 11 / 16 · POLLINATOR 1 ✓ TIP 6 / 4 · POLLINATOR 2 TIP 6 / 7',
        `SEED 12194135 · ENGINE v${ENGINE_VERSION} · BALLISTICS v${BALLISTICS_MODEL_VERSION}`,
        '',
      ].join('\n'),
    );
    const ko = matchSummaryText({ lang: 'ko', result, alliance: 'BLUE', teams: { robot1: { teamNumber: '', teamName: '' }, robot2: teams.robot2 }, branchName: null, date, seed: 7 });
    const lines = ko.split('\n');
    expect(lines[0]).toBe('FTC TacticSim · TELEOP 경기 종료');
    expect(lines[1]).toBe('2026-09-30 14:32 · BLUE');
    expect(lines[2]).toBe('R1 · R2 Hive Mind');
    expect(lines[3]).toBe('총점 42');
    expect(lines[4]).toContain('TELEOP TIP 1회 × 20');
    expect(lines[5]).toBe('CELL     4  상향 CELL에 남은 2개 × 2 (NECTAR 1 · POLLEN 1)');
    expect(lines[8]).toBe('PARK     5  R1 주차 × 5 · 오토 LEAVE · PARK 6점은 RP에만');
    expect(lines[10]).toBe(`시드 7 · 엔진 v${ENGINE_VERSION} · 탄도 모델 v${BALLISTICS_MODEL_VERSION}`);
  });
});
