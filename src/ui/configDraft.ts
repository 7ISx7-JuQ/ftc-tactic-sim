// config 창 초안 / 적용 규칙 (명세서 3.8 우측 config 창, 09-8a): React / DOM 비의존 순수 함수
// - 탭 R1 / R2 / SCENARIO는 편집 중 값(초안)과 적용된 값을 따로 가진다. APPLY는 초안이 유효하고 적용된 값과 다를 때만.
// - 적용 안 된 수정 / 검증 실패가 있으면 그 탭 아이콘이 빨간 느낌표가 되고 START를 막는다 (첫 문제 탭: R1 → R2 → SCENARIO).
// - SETTINGS 탭은 바꾸는 즉시 적용 (09-8 확정, APPLY 없음) — 여기서 다루지 않는다.
// 탭 내용(폼)은 09-9(로봇) / 09-11(시나리오)에서 채운다.

import { validateRobotPlacement, validateScenario } from '../core/simulationEngine';
import type { RobotConfig, ScenarioConfig } from '../core/types';
import type { AppPhase, AppStatus } from '../app/appController';
import type { MessageKey } from './i18n';

export type ConfigTab = 'robot1' | 'robot2' | 'scenario' | 'settings';
export type DraftTab = 'robot1' | 'robot2' | 'scenario';
export const CONFIG_TABS: readonly ConfigTab[] = ['robot1', 'robot2', 'scenario', 'settings'];
export const DRAFT_TABS: readonly DraftTab[] = ['robot1', 'robot2', 'scenario'];

/** 탭 이름 문구 키 */
export const TAB_LABEL_KEYS: Readonly<Record<ConfigTab, MessageKey>> = {
  robot1: 'config.tab.r1',
  robot2: 'config.tab.r2',
  scenario: 'config.tab.scenario',
  settings: 'config.tab.settings',
};

export interface DraftValues {
  robot1: RobotConfig;
  robot2: RobotConfig;
  scenario: ScenarioConfig;
}

export interface ConfigDrafts {
  applied: DraftValues;
  draft: DraftValues;
}

/** 탭 검증 문제 (코드는 문구 사전 issue.* 키와 같음) */
export interface TabIssue {
  code: string;
  message: string;
}

/** 탭 상태: OK = 적용됨 · 유효, DIRTY = 적용 안 된 수정, INVALID = 초안 검증 실패 (둘 다면 INVALID) */
export type TabStatus = 'OK' | 'DIRTY' | 'INVALID';

export function initialDrafts(values: DraftValues): ConfigDrafts {
  return { applied: clone(values), draft: clone(values) };
}

/** 초안 편집 (적용된 값은 그대로) */
export function editDraft<T extends DraftTab>(state: ConfigDrafts, tab: T, value: DraftValues[T]): ConfigDrafts {
  return { applied: state.applied, draft: { ...state.draft, [tab]: clone(value) } };
}

/** 초안 → 적용 (canApply일 때만, 아니면 그대로) */
export function applyTab(state: ConfigDrafts, tab: DraftTab): ConfigDrafts {
  if (!canApply(state, tab)) return state;
  return { applied: { ...state.applied, [tab]: clone(state.draft[tab]) }, draft: state.draft };
}

/** RESET TAB: 그 탭 초안을 기본값으로 (적용은 APPLY로) */
export function resetTabDraft(state: ConfigDrafts, tab: DraftTab, defaults: DraftValues): ConfigDrafts {
  return editDraft(state, tab, defaults[tab]);
}

export function isDirty(state: ConfigDrafts, tab: DraftTab): boolean {
  return !deepEqual(state.applied[tab], state.draft[tab]);
}

/**
 * 초안 검증: 로봇 탭은 제원 폼(09-9)이 생기기 전까지 문제 없음, 시나리오 탭은 엔진 시나리오 검증 + 시작 자세 배치 검증
 * (시나리오는 로봇 크기 / 적재 한도에 따라 달라지므로 로봇 초안과 함께 검사)
 */
export function tabIssues(values: DraftValues, tab: DraftTab): TabIssue[] {
  if (tab !== 'scenario') return [];
  const { scenario, robot1, robot2 } = values;
  return [
    ...validateScenario(scenario, robot1, robot2).map(({ code, message }) => ({ code, message })),
    ...validateRobotPlacement(scenario, robot1, robot2).map(({ code, message }) => ({ code, message })),
  ];
}

export function canApply(state: ConfigDrafts, tab: DraftTab): boolean {
  return isDirty(state, tab) && tabIssues(state.draft, tab).length === 0;
}

export function tabStatus(state: ConfigDrafts, tab: DraftTab): TabStatus {
  if (tabIssues(state.draft, tab).length > 0) return 'INVALID';
  return isDirty(state, tab) ? 'DIRTY' : 'OK';
}

/** START를 막는 첫 탭 (R1 → R2 → SCENARIO), 없으면 null */
export function firstBlockingTab(state: ConfigDrafts): DraftTab | null {
  return DRAFT_TABS.find(tab => tabStatus(state, tab) !== 'OK') ?? null;
}

/** RESET TAB 가능: 초안이 기본값과 다를 때 */
export function canResetTab(state: ConfigDrafts, tab: DraftTab, defaults: DraftValues): boolean {
  return !deepEqual(state.draft[tab], defaults[tab]);
}

// ------------------------------------------------------------
// 열 수 있는 시점 / 편집 가능 범위 (명세서 3.8 표)
// ------------------------------------------------------------

/** config 창 펼치기 가능: 경기 전, 또는 경기 중 일시정지 / 복기 (진행 · 재생 · 회전 · 종료 강조 · 결과 팝업 중 불가) */
export function configCanOpen(status: Pick<AppStatus, 'phase' | 'loopState' | 'playing' | 'endStage'>): boolean {
  if (status.phase === 'SETUP') return true;
  if (status.phase !== 'MATCH') return false;
  return status.loopState !== 'RUNNING' && !status.playing && status.endStage !== 'HIGHLIGHT' && status.endStage !== 'RESULT';
}

/** R1 / R2 / SCENARIO 탭 읽기 전용: 경기가 존재하는 동안 (경기 전 SETUP이 아니면) */
export function draftTabsLocked(phase: AppPhase): boolean {
  return phase !== 'SETUP';
}

// ------------------------------------------------------------
// 값 비교 / 복사 (설정 값은 JSON 호환: 숫자 / 문자열 / 불리언 / 배열 / 객체, undefined 속성은 없는 것과 같음)
// ------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // 한쪽에만 있는 키는 값이 undefined일 때만 같음 (undefined 속성 = 없는 속성)
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
