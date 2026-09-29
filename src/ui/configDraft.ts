// config 창 초안 / 적용 규칙 (명세서 3.8 우측 config 창, 09-8a): React / DOM 비의존 순수 함수
// - 탭 R1 / R2 / SCENARIO는 편집 중 값(초안)과 적용된 값을 따로 가진다. APPLY는 초안이 유효하고 적용된 값과 다를 때만.
// - 적용 안 된 수정 / 검증 실패가 있으면 그 탭 아이콘이 빨간 느낌표가 되고 START를 막는다 (첫 문제 탭: R1 → R2 → SCENARIO).
// - SETTINGS 탭은 바꾸는 즉시 적용 (09-8 확정, APPLY 없음) — 여기서 다루지 않는다.
// 탭 내용(폼)은 09-9(로봇) / 09-11(시나리오)에서 채운다.
// 09-9a: 로봇 탭 값 = 로봇 프로필(팀 번호 / 팀명 + RobotConfig). 폼에서 틀리게 입력한 칸의 글자는 fieldText에 보관
// (탭을 옮기거나 창을 닫아도 남고, 남아 있는 동안 그 탭은 INVALID).

import { validateRobotPlacement, validateScenario } from '../core/simulationEngine';
import type { ScenarioConfig } from '../core/types';
import type { AppPhase, AppStatus } from '../app/appController';
import type { MessageKey } from './i18n';
import { copyRobotProfile, robotProfileIssues } from './robotForm';
import type { RobotProfile } from './robotForm';

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
  robot1: RobotProfile;
  robot2: RobotProfile;
  scenario: ScenarioConfig;
}

/** 탭별 틀린 입력 글자 (칸 키 → 글자). 비어 있으면 모든 칸이 올바름 */
export type FieldTexts = Record<DraftTab, Readonly<Record<string, string>>>;

export interface ConfigDrafts {
  applied: DraftValues;
  draft: DraftValues;
  fieldText: FieldTexts;
}

const NO_FIELD_TEXT: FieldTexts = { robot1: {}, robot2: {}, scenario: {} };

/** 탭 검증 문제 (코드는 문구 사전 issue.* 키와 같음) */
export interface TabIssue {
  code: string;
  message: string;
}

/** 탭 상태: OK = 적용됨 · 유효, DIRTY = 적용 안 된 수정, INVALID = 초안 검증 실패 (둘 다면 INVALID) */
export type TabStatus = 'OK' | 'DIRTY' | 'INVALID';

export function initialDrafts(values: DraftValues): ConfigDrafts {
  return { applied: clone(values), draft: clone(values), fieldText: NO_FIELD_TEXT };
}

/** 초안 편집 (적용된 값 / 틀린 입력 글자는 그대로) */
export function editDraft<T extends DraftTab>(state: ConfigDrafts, tab: T, value: DraftValues[T]): ConfigDrafts {
  return { ...state, draft: { ...state.draft, [tab]: clone(value) } };
}

/** 칸 입력 글자: 틀린 글자면 보관, null이면 지움 (올바른 값이 들어와 초안에 반영됐을 때) */
export function setFieldText(state: ConfigDrafts, tab: DraftTab, key: string, text: string | null): ConfigDrafts {
  const current = state.fieldText[tab];
  if (text === null ? !(key in current) : current[key] === text) return state;
  const next = { ...current };
  if (text === null) delete next[key];
  else next[key] = text;
  return { ...state, fieldText: { ...state.fieldText, [tab]: next } };
}

export function hasFieldErrors(state: ConfigDrafts, tab: DraftTab): boolean {
  return Object.keys(state.fieldText[tab]).length > 0;
}

/** 초안 → 적용 (canApply일 때만, 아니면 그대로) */
export function applyTab(state: ConfigDrafts, tab: DraftTab): ConfigDrafts {
  if (!canApply(state, tab)) return state;
  return { ...state, applied: { ...state.applied, [tab]: clone(state.draft[tab]) } };
}

/** RESET TAB: 그 탭 초안을 기본값으로, 틀린 입력 글자도 지움 (적용은 APPLY로) */
export function resetTabDraft(state: ConfigDrafts, tab: DraftTab, defaults: DraftValues): ConfigDrafts {
  const next = editDraft(state, tab, defaults[tab]);
  return { ...next, fieldText: { ...next.fieldText, [tab]: {} } };
}

/** COPY TO R2 / COPY TO R1: 팀 번호 / 팀명을 뺀 전 항목을 상대 탭 초안으로 (상대 탭의 틀린 입력 글자는 지움). 원본 탭이 INVALID면 그대로 */
export function copyRobotTab(state: ConfigDrafts, from: 'robot1' | 'robot2'): ConfigDrafts {
  if (!canCopyRobotTab(state, from)) return state;
  const to = from === 'robot1' ? 'robot2' : 'robot1';
  const next = editDraft(state, to, copyRobotProfile(state.draft[from], state.draft[to], to));
  return { ...next, fieldText: { ...next.fieldText, [to]: {} } };
}

export function canCopyRobotTab(state: ConfigDrafts, from: 'robot1' | 'robot2'): boolean {
  return !hasFieldErrors(state, from) && tabIssues(state.draft, from).length === 0;
}

export function isDirty(state: ConfigDrafts, tab: DraftTab): boolean {
  return !deepEqual(state.applied[tab], state.draft[tab]);
}

/**
 * 초안 검증: 로봇 탭 = 프로필 값 범위 검사(robotProfileIssues, 폼을 거치지 않은 값의 안전장치),
 * 시나리오 탭 = 엔진 시나리오 검증 + 시작 자세 배치 검증 (로봇 크기 / 적재 한도에 따라 달라지므로 로봇 초안과 함께 검사)
 */
export function tabIssues(values: DraftValues, tab: DraftTab): TabIssue[] {
  if (tab !== 'scenario') return robotProfileIssues(values[tab]);
  const { scenario } = values;
  const r1 = values.robot1.config;
  const r2 = values.robot2.config;
  return [
    ...validateScenario(scenario, r1, r2).map(({ code, message }) => ({ code, message })),
    ...validateRobotPlacement(scenario, r1, r2).map(({ code, message }) => ({ code, message })),
  ];
}

export function canApply(state: ConfigDrafts, tab: DraftTab): boolean {
  return isDirty(state, tab) && !hasFieldErrors(state, tab) && tabIssues(state.draft, tab).length === 0;
}

export function tabStatus(state: ConfigDrafts, tab: DraftTab): TabStatus {
  if (hasFieldErrors(state, tab) || tabIssues(state.draft, tab).length > 0) return 'INVALID';
  return isDirty(state, tab) ? 'DIRTY' : 'OK';
}

/** START를 막는 첫 탭 (R1 → R2 → SCENARIO), 없으면 null */
export function firstBlockingTab(state: ConfigDrafts): DraftTab | null {
  return DRAFT_TABS.find(tab => tabStatus(state, tab) !== 'OK') ?? null;
}

/** RESET TAB 가능: 초안이 기본값과 다르거나 틀린 입력 글자가 있을 때 */
export function canResetTab(state: ConfigDrafts, tab: DraftTab, defaults: DraftValues): boolean {
  return hasFieldErrors(state, tab) || !deepEqual(state.draft[tab], defaults[tab]);
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
