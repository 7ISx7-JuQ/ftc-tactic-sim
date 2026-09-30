// 프리셋 파일 내보내기 / 불러오기 (명세서 3.9 프리셋, 10-2): React / DOM 비의존 순수 함수
// - 파일 = { format, presetVersion, kind, data }. kind: ROBOT(RobotProfile) / SCENARIO(ScenarioConfig) / SETUP(R1 + R2 + 시나리오).
// - EXPORT는 적용 값을 내보낸다. IMPORT는 초안에만 넣고 기존 APPLY 흐름을 탄다.
// - 파일 자체가 틀리면 거부 (JSON 아님 / format 다름 / kind가 그 줄과 다름 / 더 새 버전). 항목이 없거나 형식이 틀리면 그 항목만 기본값.
//   범위 검증에 걸리는 값은 버리지 않고 초안에 넣어 빨간 오류로 보여 준다 (숫자 칸은 폼이 값으로 판정, 팀 번호 / 팀명은 틀린 입력 글자로 보관).

import type { BumperZone, RobotConfig, RobotPose, ScenarioConfig } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { TAB_LABEL_KEYS, editDraft, setFieldText, tabStatus } from './configDraft';
import type { ConfigDrafts, DraftTab, DraftValues } from './configDraft';
import { BUMPER_SIDES, MAX_INTAKE_ZONES, checkText } from './robotForm';
import type { ProfileBallistics, RobotProfile } from './robotForm';
import { t } from './i18n';
import type { Language, MessageKey } from './i18n';

export const PRESET_FORMAT = 'ftc-tactic-sim/preset';
export const PRESET_VERSION = 1;
// 경기 레시피 (3.9항, 10-3 ~ 10-4). 프리셋 줄에 경기 파일을 넣으면 따로 알려 준다
export const MATCH_FORMAT = 'ftc-tactic-sim/match';
// 읽을 파일 크기 상한 (프리셋은 수 KB, 경기 레시피도 약 100 KB 이하)
export const MAX_IMPORT_BYTES = 1024 * 1024;

export type PresetKind = 'ROBOT' | 'SCENARIO' | 'SETUP';
/** SETTINGS 탭 PRESETS 구역의 줄 (MATCH 줄은 10-4) */
export type PresetRow = 'robot1' | 'robot2' | 'scenario' | 'all';
export const PRESET_ROWS: readonly PresetRow[] = ['robot1', 'robot2', 'scenario', 'all'];

export const ROW_KIND: Readonly<Record<PresetRow, PresetKind>> = { robot1: 'ROBOT', robot2: 'ROBOT', scenario: 'SCENARIO', all: 'SETUP' };
/** 줄이 바꾸는 탭 */
export const ROW_TABS: Readonly<Record<PresetRow, readonly DraftTab[]>> = {
  robot1: ['robot1'],
  robot2: ['robot2'],
  scenario: ['scenario'],
  all: ['robot1', 'robot2', 'scenario'],
};

export type PresetErrorCode = 'NOT_JSON' | 'NOT_PRESET' | 'MATCH_FILE' | 'NEWER_VERSION' | 'WRONG_KIND' | 'TOO_LARGE' | 'READ_FAILED';
export interface PresetError {
  code: PresetErrorCode;
  kind?: PresetKind;    // WRONG_KIND: 파일의 종류
  version?: number;     // NEWER_VERSION: 파일의 버전
}

/** 불러온 값: 줄이 바꾸는 탭의 값 + 틀린 팀 번호 / 팀명 글자 (초안의 틀린 입력 글자로 보관) */
export interface PresetImport {
  values: Partial<DraftValues>;
  invalidTexts: Partial<Record<'robot1' | 'robot2', Partial<Record<'teamNumber' | 'teamName', string>>>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, fallback: number): number => (isNumber(v) ? v : fallback);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ============================================================
// 1. 내보내기
// ============================================================

/** 로봇 프로필 → 파일 데이터 (슬롯 id는 넣지 않음: 불러오는 줄이 정함). 경기 레시피도 같은 형식 (10-3) */
export function robotPresetData(profile: RobotProfile): unknown {
  const config: Partial<RobotConfig> = { ...profile.config };
  delete config.id;
  return { teamNumber: profile.teamNumber, teamName: profile.teamName, config, ballistics: profile.ballistics };
}

/** 줄의 적용 값 → 프리셋 파일 문자열 (사람이 열어 볼 수 있게 2칸 들여쓰기) */
export function buildPresetFile(row: PresetRow, applied: DraftValues): string {
  const kind = ROW_KIND[row];
  const data =
    row === 'robot1' || row === 'robot2'
      ? robotPresetData(applied[row])
      : row === 'scenario'
        ? applied.scenario
        : { robot1: robotPresetData(applied.robot1), robot2: robotPresetData(applied.robot2), scenario: applied.scenario };
  return `${JSON.stringify({ format: PRESET_FORMAT, presetVersion: PRESET_VERSION, kind, data }, null, 2)}\n`;
}

/** 파일 이름에 쓸 시각: 로컬 YYYYMMDD-HHmm */
export function fileTimestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/** 파일 이름에 쓸 수 없는 글자 → _ */
export const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|\s]/g, '_');

/** 파일 이름: tacticsim-robot_{팀 번호 | R1 · R2} / tacticsim-scenario_{진영} / tacticsim-setup_{시각} */
export function presetFileName(row: PresetRow, applied: DraftValues, now: Date): string {
  if (row === 'robot1' || row === 'robot2') {
    const team = applied[row].teamNumber.trim();
    return safeFileName(`tacticsim-robot_${team || (row === 'robot1' ? 'R1' : 'R2')}.json`);
  }
  if (row === 'scenario') return safeFileName(`tacticsim-scenario_${applied.scenario.allianceColor}.json`);
  return safeFileName(`tacticsim-setup_${fileTimestamp(now)}.json`);
}

// ============================================================
// 2. 불러오기: 항목별 정리 (없거나 형식이 틀린 항목만 기본값)
// ============================================================

function sanitizeZone(v: unknown): BumperZone | null {
  if (!isRecord(v) || !BUMPER_SIDES.includes(v.side as BumperZone['side'])) return null;
  if (!isNumber(v.offset) || !isNumber(v.width) || !isNumber(v.depth)) return null;
  return { side: v.side as BumperZone['side'], offset: v.offset, width: v.width, depth: v.depth };
}

function sanitizeConfig(v: unknown, def: RobotConfig, id: RobotId): RobotConfig {
  const r = isRecord(v) ? v : {};
  const out = { ...clone(def), id } as RobotConfig;
  const numKeys = ['width', 'length', 'maxSpeed', 'maxTurnRate', 'maxLinearAccel', 'maxAngularAccel', 'intakeDelay', 'maxControlledPieces', 'shooterDelay', 'aimTolerance', 'flowerSetupDelay', 'flowerDropDelay'] as const;
  for (const k of numKeys) out[k] = num(r[k], def[k]);
  if (typeof r.name === 'string') out.name = r.name;
  if (typeof r.canIntakeNectar === 'boolean') out.canIntakeNectar = r.canIntakeNectar;
  if (r.turretType === 'FIXED' || r.turretType === 'TURRET') out.turretType = r.turretType;
  if (Array.isArray(r.turretRange) && r.turretRange.length === 2 && r.turretRange.every(isNumber)) out.turretRange = [r.turretRange[0], r.turretRange[1]];
  // 구역: 배열이면 형식이 맞는 구역만 남기고 최대 개수까지 (배열이 아니면 기본값)
  if (Array.isArray(r.intakeZones)) out.intakeZones = r.intakeZones.map(sanitizeZone).filter((z): z is BumperZone => z !== null).slice(0, MAX_INTAKE_ZONES);
  return out;
}

function sanitizeBallistics(v: unknown, def: ProfileBallistics): ProfileBallistics {
  const r = isRecord(v) ? v : {};
  const spot = isRecord(r.sweetSpot) ? r.sweetSpot : {};
  return {
    dz: num(r.dz, def.dz),
    shooterPitch: num(r.shooterPitch, def.shooterPitch),
    shooterOffset: num(r.shooterOffset, def.shooterOffset),
    sweetSpot: { x: num(spot.x, def.sweetSpot.x), y: num(spot.y, def.sweetSpot.y) },
    v0NoisePercent: num(r.v0NoisePercent, def.v0NoisePercent),
    headingNoiseRad: num(r.headingNoiseRad, def.headingNoiseRad),
    pitchNoiseRad: num(r.pitchNoiseRad, def.pitchNoiseRad),
  };
}

/** 로봇 프로필 정리. 팀 번호 / 팀명 글자가 입력칸 규칙에 어긋나면 값은 비우고 글자를 따로 돌려준다 (초안의 틀린 입력 글자) */
export function sanitizeRobotPreset(v: unknown, def: RobotProfile, id: RobotId): { profile: RobotProfile; invalidTexts: Partial<Record<'teamNumber' | 'teamName', string>> } {
  const r = isRecord(v) ? v : {};
  const invalidTexts: Partial<Record<'teamNumber' | 'teamName', string>> = {};
  const text = (key: 'teamNumber' | 'teamName'): string => {
    const value = r[key];
    if (typeof value !== 'string') return def[key];
    if (checkText(key, value)) {
      invalidTexts[key] = value;
      return '';
    }
    return value;
  };
  const profile: RobotProfile = {
    teamNumber: text('teamNumber'),
    teamName: text('teamName'),
    config: sanitizeConfig(r.config, def.config, id),
    ballistics: sanitizeBallistics(r.ballistics, def.ballistics),
  };
  return { profile, invalidTexts };
}

const PIECE_TYPES = ['POLLEN', 'NECTAR'] as const;
const isPose = (v: unknown): v is RobotPose => isRecord(v) && isNumber(v.x) && isNumber(v.y) && isNumber(v.heading);

/** 시나리오 정리: 선택 항목은 없으면 없는 대로(엔진 기본값), 형식이 틀리면 기본 시나리오의 그 항목 */
export function sanitizeScenarioPreset(v: unknown, def: ScenarioConfig): ScenarioConfig {
  const r = isRecord(v) ? v : {};
  const out: ScenarioConfig = clone(def);
  const take = <K extends keyof ScenarioConfig>(key: K, ok: (x: unknown) => boolean, map: (x: unknown) => ScenarioConfig[K] = x => x as ScenarioConfig[K]) => {
    if (ok(r[key])) out[key] = map(r[key]); // 없거나(undefined) 형식이 틀리면 기본 시나리오의 그 항목
  };
  take('allianceColor', x => x === 'RED' || x === 'BLUE');
  take('r1Spawn', isPose, x => ({ x: (x as RobotPose).x, y: (x as RobotPose).y, heading: (x as RobotPose).heading }));
  take('r2Spawn', isPose, x => ({ x: (x as RobotPose).x, y: (x as RobotPose).y, heading: (x as RobotPose).heading }));
  take('hiveUpwardCell', x => x === 'AUDIENCE_CELL' || x === 'OPPOSITE_CELL');
  take('hiveInitialPieces', x => isRecord(x) && isNumber(x.pollenCount) && isNumber(x.nectarCount), x => {
    const h = x as Record<string, number>;
    return { pollenCount: h.pollenCount, nectarCount: h.nectarCount };
  });
  const isLoadout = (x: unknown) => Array.isArray(x) && x.every(p => (PIECE_TYPES as readonly unknown[]).includes(p));
  take('r1Loadout', isLoadout, x => [...(x as ScenarioConfig['r1Loadout'] & object)]);
  take('r2Loadout', isLoadout, x => [...(x as ScenarioConfig['r2Loadout'] & object)]);
  take('flowerPiecesCount', x => Array.isArray(x) && x.length === 4 && x.every(isNumber), x => [...(x as number[])] as [number, number, number, number]);
  take('gardenPiecesCount', x => isRecord(x) && isNumber(x.ally) && isNumber(x.opponent), x => {
    const g = x as Record<string, number>;
    return { ally: g.ally, opponent: g.opponent };
  });
  take('autoTipCount', isNumber);
  take('rngSeed', isNumber);
  return out;
}

// ============================================================
// 3. 불러오기: 파일 해석
// ============================================================

/** 파일 글자 → 줄에 넣을 값. 파일 자체가 틀리면 오류 (아무것도 바꾸지 않음) */
export function parsePresetFile(text: string, row: PresetRow, defaults: DraftValues): { ok: true; preset: PresetImport } | { ok: false; error: PresetError } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'NOT_JSON' } };
  }
  if (isRecord(data) && data.format === MATCH_FORMAT) return { ok: false, error: { code: 'MATCH_FILE' } };
  if (!isRecord(data) || data.format !== PRESET_FORMAT || !Number.isInteger(data.presetVersion) || (data.presetVersion as number) < 1 || !isRecord(data.data)) {
    return { ok: false, error: { code: 'NOT_PRESET' } };
  }
  if ((data.presetVersion as number) > PRESET_VERSION) return { ok: false, error: { code: 'NEWER_VERSION', version: data.presetVersion as number } };
  const kind = data.kind;
  if (kind !== 'ROBOT' && kind !== 'SCENARIO' && kind !== 'SETUP') return { ok: false, error: { code: 'NOT_PRESET' } };
  if (kind !== ROW_KIND[row]) return { ok: false, error: { code: 'WRONG_KIND', kind } };

  const body = data.data;
  const preset: PresetImport = { values: {}, invalidTexts: {} };
  const robot = (id: 'robot1' | 'robot2', v: unknown) => {
    const { profile, invalidTexts } = sanitizeRobotPreset(v, defaults[id], id);
    preset.values[id] = profile;
    if (Object.keys(invalidTexts).length > 0) preset.invalidTexts[id] = invalidTexts;
  };
  if (row === 'robot1' || row === 'robot2') robot(row, body);
  else if (row === 'scenario') preset.values.scenario = sanitizeScenarioPreset(body, defaults.scenario);
  else {
    robot('robot1', body.robot1);
    robot('robot2', body.robot2);
    preset.values.scenario = sanitizeScenarioPreset(body.scenario, defaults.scenario);
  }
  return { ok: true, preset };
}

/** 불러온 값 → 초안 (그 탭의 틀린 입력 글자는 지운 뒤, 틀린 팀 번호 / 팀명 글자만 다시 보관). 적용 값은 그대로 */
export function importPresetToDrafts(state: ConfigDrafts, preset: PresetImport): ConfigDrafts {
  let next = state;
  for (const tab of ['robot1', 'robot2', 'scenario'] as const) {
    const value = preset.values[tab];
    if (value === undefined) continue;
    next = editDraft(next, tab, value);
    next = { ...next, fieldText: { ...next.fieldText, [tab]: {} } };
  }
  for (const id of ['robot1', 'robot2'] as const) {
    for (const [key, text] of Object.entries(preset.invalidTexts[id] ?? {})) next = setFieldText(next, id, key, text);
  }
  return next;
}

// ============================================================
// 4. 화면 문구 / 확인창 대상
// ============================================================

/** 덮어쓰기 확인이 필요한 탭: 줄이 바꾸는 탭 중 적용 안 된 수정 / 틀린 입력이 있는 탭 (COPY TO와 같은 규칙) */
export function importOverwriteTabs(state: ConfigDrafts, row: PresetRow): DraftTab[] {
  return ROW_TABS[row].filter(tab => tabStatus(state, tab) !== 'OK');
}

/** 탭 이름 목록 (현재 언어) */
export const tabNames = (lang: Language, tabs: readonly DraftTab[]): string => tabs.map(tab => t(lang, TAB_LABEL_KEYS[tab])).join(' / ');

/** 파일 종류가 들어갈 줄 이름 */
function kindRowLabel(lang: Language, kind: PresetKind): string {
  if (kind === 'ROBOT') return tabNames(lang, ['robot1', 'robot2']);
  return kind === 'SCENARIO' ? tabNames(lang, ['scenario']) : t(lang, 'preset.row.all');
}

/** 거부 사유 문구 */
export function presetErrorMessage(lang: Language, error: PresetError): string {
  if (error.code === 'WRONG_KIND') return t(lang, 'preset.error.WRONG_KIND', { row: kindRowLabel(lang, error.kind ?? 'ROBOT') });
  if (error.code === 'NEWER_VERSION') return t(lang, 'preset.error.NEWER_VERSION', { version: error.version ?? '?' });
  return t(lang, `preset.error.${error.code}` as MessageKey);
}

/** 불러온 뒤 안내 (config 창 안내 줄) */
export function presetLoadedNotice(lang: Language, row: PresetRow): string {
  return row === 'all' ? t(lang, 'preset.loadedAll') : t(lang, 'preset.loaded', { tab: tabNames(lang, ROW_TABS[row]) });
}
