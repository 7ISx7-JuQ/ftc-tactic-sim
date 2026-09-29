// config 창 초안 / 적용 규칙 (명세서 3.8 우측 config 창, 09-8a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import {
  applyTab,
  canApply,
  canCopyRobotTab,
  copyRobotTab,
  hasFieldErrors,
  setFieldText,
  canResetTab,
  configCanOpen,
  deepEqual,
  draftTabsLocked,
  editDraft,
  firstBlockingTab,
  initialDrafts,
  isDirty,
  resetTabDraft,
  tabIssues,
  tabStatus,
} from '../configDraft';

const defaults = DEFAULT_DRAFT_VALUES;
// 로봇 프로필의 제원 일부만 바꾼 값
const robot = (id: 'robot1' | 'robot2', patch: Partial<typeof defaults.robot1.config>) => ({ ...defaults[id], config: { ...defaults[id].config, ...patch } });

describe('config 창 초안 / 적용 (09-8a)', () => {
  it('A. 초안 편집 → 적용 안 된 수정 → APPLY → 적용 값 반영, 초안과 적용 값은 서로 독립', () => {
    const s0 = initialDrafts(defaults);
    expect(DRAFT_TABS_OK(s0)).toBe(true);
    expect(firstBlockingTab(s0)).toBeNull();
    expect(canApply(s0, 'robot1')).toBe(false); // 바뀐 것 없음

    const faster = robot('robot1', { maxSpeed: 70 });
    const s1 = editDraft(s0, 'robot1', faster);
    expect(isDirty(s1, 'robot1') && tabStatus(s1, 'robot1') === 'DIRTY' && canApply(s1, 'robot1')).toBe(true);
    expect(s1.applied.robot1.config.maxSpeed).toBe(60);
    expect(firstBlockingTab(s1)).toBe('robot1');
    faster.config.maxSpeed = 99; // 편집에 넘긴 객체를 나중에 바꿔도 초안은 복사본
    expect(s1.draft.robot1.config.maxSpeed).toBe(70);

    const s2 = applyTab(s1, 'robot1');
    expect(s2.applied.robot1.config.maxSpeed === 70 && !isDirty(s2, 'robot1') && tabStatus(s2, 'robot1') === 'OK').toBe(true);
    expect(firstBlockingTab(s2)).toBeNull();
    expect(applyTab(s2, 'robot1')).toBe(s2); // 적용할 것 없음 → 그대로
    expect(s0.applied.robot1.config.maxSpeed).toBe(60); // 이전 상태 불변
    // 기본값과 같은 값으로 되돌려 편집하면 적용 안 된 수정 아님
    expect(isDirty(editDraft(s0, 'robot2', robot('robot2', {})), 'robot2')).toBe(false);
  });

  it('B. 검증 실패 초안: INVALID, APPLY 불가, START 막힘 (첫 문제 탭 R1 → R2 → SCENARIO)', () => {
    const s0 = initialDrafts(defaults);
    const badScenario = editDraft(s0, 'scenario', { ...defaults.scenario, flowerPiecesCount: [4, 4, 9, 4] });
    expect(tabIssues(badScenario.draft, 'scenario').map(i => i.code)).toContain('FLOWER_COUNT');
    expect(tabStatus(badScenario, 'scenario')).toBe('INVALID');
    expect(canApply(badScenario, 'scenario')).toBe(false);
    expect(applyTab(badScenario, 'scenario')).toBe(badScenario);
    expect(firstBlockingTab(badScenario)).toBe('scenario');
    // 배치 검증도 시나리오 탭 문제 (R1 시작 자세가 HIVE 안)
    const inHive = editDraft(s0, 'scenario', { ...defaults.scenario, r1Spawn: { x: 72, y: 72, heading: 0 } });
    expect(tabIssues(inHive.draft, 'scenario').map(i => i.code)).toContain('PLACEMENT_IN_HIVE');
    // 순서: R2 수정 + 시나리오 오류 → R2가 먼저
    const both = editDraft(badScenario, 'robot2', robot('robot2', { maxSpeed: 50 }));
    expect(firstBlockingTab(both)).toBe('robot2');
    // 시나리오 검증은 로봇 초안과 함께: 적재 한도를 줄인 로봇 초안이면 기본 적재물이 넘침
    const loaded = editDraft(s0, 'scenario', { ...defaults.scenario, r1Loadout: ['POLLEN', 'POLLEN', 'POLLEN', 'POLLEN'] });
    expect(tabStatus(loaded, 'scenario')).toBe('DIRTY');
    const smaller = editDraft(loaded, 'robot1', robot('robot1', { maxControlledPieces: 2 }));
    expect(tabIssues(smaller.draft, 'scenario').map(i => i.code)).toContain('LOADOUT_OVER_CAPACITY');
  });

  it('C. RESET TAB: 그 탭 초안만 기본값으로 (적용은 APPLY), 기본값이면 불가', () => {
    const s0 = initialDrafts(defaults);
    expect(canResetTab(s0, 'robot1', defaults)).toBe(false);
    const edited = applyTab(editDraft(s0, 'robot1', robot('robot1', { width: 16 })), 'robot1');
    expect(canResetTab(edited, 'robot1', defaults)).toBe(true);
    const reset = resetTabDraft(edited, 'robot1', defaults);
    expect(reset.draft.robot1.config.width === 18 && reset.applied.robot1.config.width === 16 && tabStatus(reset, 'robot1') === 'DIRTY').toBe(true);
    expect(applyTab(reset, 'robot1').applied.robot1.config.width).toBe(18);
  });

  it('D. 열 수 있는 시점 / 잠금 (명세서 3.8 표)', () => {
    const base = { playing: false, endStage: 'NONE' as const };
    expect(configCanOpen({ ...base, phase: 'SETUP', loopState: 'READY' })).toBe(true);
    expect(configCanOpen({ ...base, phase: 'ROTATING_IN', loopState: 'READY' })).toBe(false);
    expect(configCanOpen({ ...base, phase: 'ROTATING_OUT', loopState: 'READY' })).toBe(false);
    expect(configCanOpen({ ...base, phase: 'MATCH', loopState: 'RUNNING' })).toBe(false);
    expect(configCanOpen({ ...base, phase: 'MATCH', loopState: 'PAUSED' })).toBe(true);
    expect(configCanOpen({ ...base, phase: 'MATCH', loopState: 'PAUSED', playing: true })).toBe(false);
    expect(configCanOpen({ phase: 'MATCH', loopState: 'ENDED', playing: false, endStage: 'HIGHLIGHT' })).toBe(false);
    expect(configCanOpen({ phase: 'MATCH', loopState: 'ENDED', playing: false, endStage: 'RESULT' })).toBe(false);
    expect(configCanOpen({ phase: 'MATCH', loopState: 'ENDED', playing: false, endStage: 'REVIEW' })).toBe(true);
    expect(draftTabsLocked('SETUP')).toBe(false);
    expect(draftTabsLocked('MATCH') && draftTabsLocked('ROTATING_IN') && draftTabsLocked('ROTATING_OUT')).toBe(true);
  });

  it('E. 값 비교: 깊은 비교, undefined 속성 = 없음, 배열 순서 구분', () => {
    expect(deepEqual({ a: 1, b: [1, 2], c: undefined }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('F. (09-9a) 틀린 입력 글자: 보관되는 동안 INVALID · 적용 불가, 올바른 값이 들어오면 지움, RESET TAB도 지움', () => {
    const s0 = initialDrafts(defaults);
    const typed = setFieldText(editDraft(s0, 'robot1', robot('robot1', { maxSpeed: 70 })), 'robot1', 'width', '30');
    expect(hasFieldErrors(typed, 'robot1') && tabStatus(typed, 'robot1') === 'INVALID' && !canApply(typed, 'robot1')).toBe(true);
    expect(firstBlockingTab(typed)).toBe('robot1');
    expect(setFieldText(typed, 'robot1', 'width', '30')).toBe(typed); // 같은 글자 → 그대로
    const fixed = setFieldText(typed, 'robot1', 'width', null);
    expect(tabStatus(fixed, 'robot1') === 'DIRTY' && canApply(fixed, 'robot1')).toBe(true);
    expect(setFieldText(fixed, 'robot1', 'width', null)).toBe(fixed);
    expect(canResetTab(setFieldText(s0, 'robot2', 'width', 'x'), 'robot2', defaults)).toBe(true); // 기본값이어도 틀린 글자가 있으면 되돌리기 가능
    const reset = resetTabDraft(typed, 'robot1', defaults);
    expect(!hasFieldErrors(reset, 'robot1') && reset.draft.robot1.config.maxSpeed === 60).toBe(true);
  });

  it('G. (09-9a) COPY TO: 원본 초안 → 상대 탭 초안 (팀 번호 / 팀명 유지, 상대 탭 틀린 글자 지움), 원본이 틀리면 불가', () => {
    let s = initialDrafts(defaults);
    s = editDraft(s, 'robot1', { teamNumber: '19049', teamName: 'Bees', config: { ...defaults.robot1.config, width: 14 } });
    s = editDraft(s, 'robot2', { ...defaults.robot2, teamNumber: '24909' });
    s = setFieldText(s, 'robot2', 'maxSpeed', 'fast');
    const copied = copyRobotTab(s, 'robot1');
    expect(copied.draft.robot2.config.width === 14 && copied.draft.robot2.teamNumber === '24909' && copied.draft.robot2.config.id === 'robot2').toBe(true);
    expect(!hasFieldErrors(copied, 'robot2') && tabStatus(copied, 'robot2') === 'DIRTY' && copied.applied.robot2.config.width === 18).toBe(true);
    const broken = setFieldText(s, 'robot1', 'width', '99');
    expect(canCopyRobotTab(broken, 'robot1')).toBe(false);
    expect(copyRobotTab(broken, 'robot1')).toBe(broken);
    // 로봇 탭 값 범위 검사도 탭 문제로 (폼을 거치지 않은 값)
    const fresh = initialDrafts(defaults);
    expect(tabStatus(editDraft(fresh, 'robot2', robot('robot2', { width: 30 })), 'robot2')).toBe('INVALID');
    expect(tabStatus(editDraft(fresh, 'robot2', robot('robot2', { width: 17 })), 'robot2')).toBe('DIRTY');
  });
});


function DRAFT_TABS_OK(state: ReturnType<typeof initialDrafts>): boolean {
  return (['robot1', 'robot2', 'scenario'] as const).every(tab => tabStatus(state, tab) === 'OK');
}