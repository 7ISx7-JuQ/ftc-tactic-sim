// SETTINGS 탭 값 + 설정 자동 보관 (명세서 3.8 SETTINGS 탭 / "설정 자동 보관", 09-8b): React / DOM 비의존
// - SETTINGS는 바꾸는 즉시 적용 (APPLY 없음). 입력 출처는 보관하지 않는다 (앱을 켤 때마다 AUTO).
// - localStorage 키 하나에 버전 + JSON. 없음 / 버전 다름 / JSON 손상 → 전부 기본값, 항목별로 형식이 틀리면 그 항목만 기본값.
// - 마지막으로 적용한 로봇 제원 / 시나리오도 함께 보관 (탭 폼은 09-9 / 09-11). 기본값과 형식이 다르거나 검증에 실패하면 버림.
// - 경기 기록은 보관하지 않는다 (새로고침 = 경기 폐기).

import { DEFAULT_DRIVE_MODE, KEYBOARD_ENABLED } from '../input/inputConfig';
import type { DriveMode, RobotId } from '../input/inputConfig';
import { DEFAULT_RENDER_OPTIONS } from '../renderer/renderOptions';
import type { RenderOptions } from '../renderer/renderOptions';
import type { ViewMode } from '../renderer/viewTransform';
import { DEFAULT_LANGUAGE, toLanguage } from './i18n';
import type { Language } from './i18n';
import { DEFAULT_LENGTH_UNIT, toLengthUnit } from './units';
import type { LengthUnit } from './units';
import { tabIssues } from './configDraft';
import type { DraftValues } from './configDraft';

export const SETTINGS_STORAGE_KEY = 'ftc-tactic-sim/settings';
export const SETTINGS_VERSION = 1;

export interface UiSettings {
  language: Language;
  lengthUnit: LengthUnit;
  defaultView: ViewMode;                   // 새 경기의 경기 중 보기 (경기 전 화면은 항상 관중석)
  renderOptions: RenderOptions;
  keyboardEnabled: boolean;
  driveModes: Record<RobotId, DriveMode>;  // 09-8 확정: 조작 모드도 보관 (드라이버 개인 설정)
}

export const DEFAULT_SETTINGS: Readonly<UiSettings> = {
  language: DEFAULT_LANGUAGE,
  lengthUnit: DEFAULT_LENGTH_UNIT,
  defaultView: 'DRIVER',
  renderOptions: { ...DEFAULT_RENDER_OPTIONS },
  keyboardEnabled: KEYBOARD_ENABLED,
  driveModes: { robot1: DEFAULT_DRIVE_MODE, robot2: DEFAULT_DRIVE_MODE },
};

export interface StoredConfig {
  settings: UiSettings;
  applied: DraftValues | null; // 마지막으로 적용한 로봇 / 시나리오 (없거나 무효면 null → 기본값)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toView = (v: unknown): ViewMode => (v === 'AUDIENCE' ? 'AUDIENCE' : 'DRIVER');
const toMode = (v: unknown): DriveMode => (v === 'ROBOT' ? 'ROBOT' : v === 'FIELD' ? 'FIELD' : DEFAULT_DRIVE_MODE);
const toBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** 저장된 값 → 설정 (항목별로 형식이 틀리면 그 항목만 기본값) */
export function sanitizeSettings(raw: unknown): UiSettings {
  const r = isRecord(raw) ? raw : {};
  const opts = isRecord(r.renderOptions) ? r.renderOptions : {};
  const modes = isRecord(r.driveModes) ? r.driveModes : {};
  const renderOptions = Object.fromEntries(
    (Object.keys(DEFAULT_RENDER_OPTIONS) as (keyof RenderOptions)[]).map(k => [k, toBool(opts[k], DEFAULT_RENDER_OPTIONS[k])]),
  ) as unknown as RenderOptions;
  return {
    language: toLanguage(r.language),
    lengthUnit: toLengthUnit(r.lengthUnit),
    defaultView: toView(r.defaultView),
    renderOptions,
    keyboardEnabled: toBool(r.keyboardEnabled, KEYBOARD_ENABLED),
    driveModes: { robot1: toMode(modes.robot1), robot2: toMode(modes.robot2) },
  };
}

/** 값이 템플릿과 같은 모양인지 (템플릿의 모든 키가 같은 종류로 있음, 배열은 배열, 객체는 재귀) — 손상된 저장값이 엔진에 들어가지 않도록 */
export function sameShape(value: unknown, template: unknown): boolean {
  if (Array.isArray(template)) return Array.isArray(value);
  if (isRecord(template)) return isRecord(value) && Object.keys(template).every(k => template[k] === undefined || sameShape(value[k], template[k]));
  if (typeof template === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === typeof template;
}

/** 저장된 로봇 / 시나리오: 기본값과 같은 모양 + 진영 유효 + 시나리오 검증 통과일 때만 */
export function sanitizeApplied(raw: unknown, defaults: DraftValues): DraftValues | null {
  if (!isRecord(raw)) return null;
  const { robot1, robot2, scenario } = raw;
  if (!sameShape(robot1, defaults.robot1) || !sameShape(robot2, defaults.robot2)) return null;
  if (!isRecord(scenario) || (scenario.allianceColor !== 'RED' && scenario.allianceColor !== 'BLUE')) return null;
  const values = { robot1, robot2, scenario } as unknown as DraftValues;
  try {
    return tabIssues(values, 'scenario').length === 0 ? values : null;
  } catch {
    return null; // 시나리오 안 선택 항목의 형식이 틀려 검증 자체가 실패
  }
}

/** 저장 문자열 → 설정 + 적용 값. 없음 / JSON 손상 / 버전 다름 → 기본값 */
export function parseStoredConfig(text: string | null, defaults: DraftValues): StoredConfig {
  const fallback: StoredConfig = { settings: sanitizeSettings(null), applied: null };
  if (!text) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (!isRecord(data) || data.version !== SETTINGS_VERSION) return fallback;
  return { settings: sanitizeSettings(data.settings), applied: sanitizeApplied(data.applied, defaults) };
}

export function serializeStoredConfig(config: StoredConfig): string {
  return JSON.stringify({ version: SETTINGS_VERSION, settings: config.settings, applied: config.applied });
}

/** 저장소 (브라우저: localStorage, 테스트: 메모리). 쓸 수 없으면 null */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserSettingsStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // 보안 정책 등으로 접근 불가
  }
}

/** 불러오기 (저장소 오류는 기본값) */
export function loadStoredConfig(storage: SettingsStorage | null, defaults: DraftValues): StoredConfig {
  try {
    return parseStoredConfig(storage?.getItem(SETTINGS_STORAGE_KEY) ?? null, defaults);
  } catch {
    return parseStoredConfig(null, defaults);
  }
}

/** 저장 (용량 초과 / 비공개 모드 등 오류는 무시 — 다음 실행은 기본값). 성공하면 true */
export function saveStoredConfig(storage: SettingsStorage | null, config: StoredConfig): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serializeStoredConfig(config));
    return true;
  } catch {
    return false;
  }
}

/** 키보드 조작표용 키 이름 (event.code → 화면 글자): KeyW → W, ArrowLeft → ←, Comma → , 등 */
export function keyCodeLabel(code: string): string {
  const named: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Slash: '/', Space: 'Space' };
  if (named[code]) return named[code];
  const m = /^(?:Key|Digit)(.+)$/.exec(code);
  return m ? m[1] : code;
}
