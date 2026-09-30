// 분기 트리 화면 규칙 (명세서 3.9 분기 트리, 10-6): React / DOM 비의존 순수 함수. 값은 상태 알림(AppStatus)의 가지 목록만 읽는다.
// - 가지 이름: 사용자 이름, 없으면 원본 Main / "원본", 가지 Branch n / "가지 n" (파일에는 언어와 무관한 영어 자동 이름, branchTree.fileBranchName).
// - 가지 목록 줄: 깊이 들여쓰기 / 분기 시각(원본 —) / 상태(종료 = 점수, 미종료 = 머리 시각) / 지금 가지 / 삭제 가능(원본 제외).
// - 타임라인 분기 표식: 지금 가지와 그 조상이 갈라진 틱. 확인창 문구(분기 / 가득 참 / 삭제 / NEW), 결과 팝업 가지 이름 · 비교 줄.

import type { AppStatus, BranchInfo } from '../app/appController';
import { MAX_BRANCHES } from '../app/branchTree';
import { DT, MATCH_TICKS } from '../core/simulationEngine';
import { t } from './i18n';
import type { Language } from './i18n';
import { formatMatchTime } from './units';

type Tree = Pick<AppStatus, 'branches' | 'currentBranchId'>;

/** 틱 → 경기 타이머 표시 (남은 시간) */
const clock = (tick: number) => formatMatchTime((MATCH_TICKS - tick) * DT);

/** 화면에 보일 가지 이름 */
export function branchLabel(lang: Language, b: Pick<BranchInfo, 'name' | 'number' | 'parentId'>): string {
  return b.name ?? (b.parentId === null ? t(lang, 'branch.main') : t(lang, 'branch.auto', { number: b.number }));
}

const find = (tree: Tree, id: number | null) => tree.branches.find(b => b.id === id);
export const currentBranchInfo = (tree: Tree): BranchInfo | undefined => find(tree, tree.currentBranchId);

export interface BranchRow {
  id: number;
  label: string;
  depth: number;
  forkText: string;   // 분기 시각 ("from 1:23"), 원본 = "—"
  stateText: string;  // 종료 = 점수, 미종료 = 머리 시각
  ended: boolean;
  current: boolean;
  deletable: boolean; // 원본 제외
}

/** 가지 목록 (만든 순서, 깊이만큼 들여쓰기) */
export function branchRows(lang: Language, tree: Tree): BranchRow[] {
  return tree.branches.map(b => ({
    id: b.id,
    label: branchLabel(lang, b),
    depth: b.depth,
    forkText: b.parentId === null ? '—' : t(lang, 'branch.fork', { time: clock(b.forkTick) }),
    stateText: b.totalScore !== null ? t(lang, 'branch.score', { score: b.totalScore }) : t(lang, 'branch.head', { time: clock(b.headTick) }), // 점수 = 종료한 가지만
    ended: b.ended,
    current: b.id === tree.currentBranchId,
    deletable: b.parentId !== null,
  }));
}

/** 가지 목록을 열 수 있는 상태: 경기 중 + 일시정지 / 복기 (진행 · 재생 · 회전 · 종료 강조 · 결과 팝업 아님). 확인창은 화면이 따로 막음 */
export function branchMenuEnabled(status: Pick<AppStatus, 'phase' | 'canScrub' | 'playing'>): boolean {
  return status.phase === 'MATCH' && status.canScrub && !status.playing;
}

/** 타임라인 분기 표식: 지금 가지 → 원본까지 거슬러 올라가며 각 가지가 부모에서 갈라진 틱 (앞 틱부터) */
export function forkMarks(lang: Language, tree: Tree): { fraction: number; title: string }[] {
  const out: { fraction: number; title: string }[] = [];
  for (let b = currentBranchInfo(tree); b && b.parentId !== null; b = find(tree, b.parentId)) {
    const parent = find(tree, b.parentId);
    if (!parent) break;
    out.push({ fraction: b.forkTick / MATCH_TICKS, title: t(lang, 'branch.markTip', { name: branchLabel(lang, b), parent: branchLabel(lang, parent), time: clock(b.forkTick) }) });
  }
  return out.sort((a, b) => a.fraction - b.fraction);
}

/** 분기 확인창: 보는 틱 시각 + 지금 가지 이름 */
export function branchConfirmText(lang: Language, status: Tree & Pick<AppStatus, 'tick'>): string {
  const current = currentBranchInfo(status);
  return t(lang, 'confirm.branch', { time: clock(status.tick), name: current ? branchLabel(lang, current) : t(lang, 'branch.main') });
}

/** 가지가 가득 찼을 때 안내 (확인 버튼 하나) */
export const branchFullText = (lang: Language): string => t(lang, 'confirm.branchFull', { max: MAX_BRANCHES });

/** 하위 가지 수 (자식, 손자, …) */
export function descendantCount(tree: Tree, id: number): number {
  const out = new Set<number>();
  for (const b of tree.branches) if (b.parentId !== null && (b.parentId === id || out.has(b.parentId))) out.add(b.id);
  return out.size;
}

/** 삭제 확인창: 하위 가지가 있으면 그 수까지 */
export function deleteConfirmText(lang: Language, tree: Tree, id: number): string {
  const b = find(tree, id);
  const name = b ? branchLabel(lang, b) : '';
  const count = descendantCount(tree, id);
  return count > 0 ? t(lang, 'confirm.deleteBranchTree', { name, count }) : t(lang, 'confirm.deleteBranch', { name });
}

/** NEW 확인창: 가지가 2개 이상이면 버려질 가지 수 */
export function newMatchConfirmText(lang: Language, tree: Tree): string {
  return tree.branches.length >= 2 ? t(lang, 'confirm.newMatchBranches', { count: tree.branches.length }) : t(lang, 'confirm.newMatch');
}

/** 결과 팝업 헤더 / 요약에 쓸 지금 가지 이름: 가지가 2개 이상이거나 사용자 이름이 있을 때만 */
export function shownBranchName(lang: Language, tree: Tree): string | null {
  const current = currentBranchInfo(tree);
  if (!current || (tree.branches.length < 2 && current.name === null)) return null;
  return branchLabel(lang, current);
}

/** 결과 팝업 가지 비교 줄: 종료한 가지가 2개 이상일 때만 (만든 순서, 지금 가지 / 최고 점수 표시) */
export function branchComparison(lang: Language, tree: Tree): { id: number; label: string; score: number; current: boolean; best: boolean }[] | null {
  const ended = tree.branches.filter(b => b.ended && b.totalScore !== null);
  if (ended.length < 2) return null;
  const best = Math.max(...ended.map(b => b.totalScore!));
  return ended.map(b => ({ id: b.id, label: branchLabel(lang, b), score: b.totalScore!, current: b.id === tree.currentBranchId, best: b.totalScore === best }));
}

/** 파일 이름에 붙일 가지 번호: 원본이 아니면 번호 (tacticsim-match_…_b3.json), 원본이면 null */
export function fileBranchNumber(tree: Tree): number | null {
  const current = currentBranchInfo(tree);
  return current && current.parentId !== null ? current.number : null;
}
