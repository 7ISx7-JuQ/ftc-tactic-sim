// 저장 레시피 (경기 파일, 명세서 3.9 저장 레시피 / 경기 불러오기, 10-3): React / DOM 비의존 순수 함수
// - 경기 = 적용된 설정(R1 / R2 프로필 + 시나리오, 시드 채움) + LUT 설정 + 로봇별 적용 입력 기록 0 ~ 5999틱 + 체크포인트 121개.
//   LUT 자체는 저장하지 않는다 (불러올 때 캐시 또는 재생성). v1 저장 대상 = 경기 종료(6000틱)에 도달한 가지 하나.
// - 입력: 로봇별 연속 중복 압축(RLE) 후 Base64. 한 묶음 = [반복 틱 수 uint16 LE (1 ~ 6000)][qx][qy][qω][action] 6 B.
// - 불러오기는 재현이 목적이므로 프리셋과 달리 없는 항목을 기본값으로 채우지 않고 거부한다.

import { BALLISTICS_MODEL_VERSION, DEFAULT_BALLISTICS_SEED, DEFAULT_LUT_SAMPLES, DEFAULT_V0_SEARCH_SAMPLES } from '../core/ballistics';
import { CHECKPOINT_COUNT, CHECKPOINT_INTERVAL, CHECKSUM_PATTERN, compareCheckpoints, timelineCheckpoints } from '../core/checksum';
import type { CheckpointComparison } from '../core/checksum';
import { DEFAULT_RNG_SEED, ENGINE_VERSION, MATCH_TICKS } from '../core/simulationEngine';
import type { DeepReadonly, RPState, ScenarioConfig, TimelineFrame } from '../core/types';
import { ACTION_CODES } from '../input/controls';
import type { RobotId } from '../input/inputConfig';
import { LOG_RECORD_BYTES } from '../input/inputLog';
import type { MatchInputs } from '../input/inputLog';
import { tabIssues } from '../ui/configDraft';
import type { DraftTab, DraftValues } from '../ui/configDraft';
import { MATCH_FORMAT, PRESET_FORMAT, robotPresetData, sanitizeRobotPreset, sanitizeScenarioPreset } from '../ui/presetFile';
import type { RobotProfile } from '../ui/robotForm';

export const RECIPE_FORMAT = MATCH_FORMAT;
export const RECIPE_VERSION = 1;
const RUN_BYTES = 2 + LOG_RECORD_BYTES;
const QUANT_MAX = 127;

export interface RecipeLutSettings {
  seed: number;           // LUT 기준 시드
  samples: number;        // 격자당 샘플 수
  searchSamples: number;  // v0 후보당 샘플 수
}
/** 현재 앱이 LUT 생성에 쓰는 값 (LUT 관리자 기본값) */
export const CURRENT_LUT_SETTINGS: Readonly<RecipeLutSettings> = { seed: DEFAULT_BALLISTICS_SEED, samples: DEFAULT_LUT_SAMPLES, searchSamples: DEFAULT_V0_SEARCH_SAMPLES };

export interface RecipeResult {
  totalScore: number;
  rp: RPState;
}

export interface MatchRecipe {
  engineVersion: number;
  ballisticsModelVersion: number;
  createdAt: string;                    // 로컬 시각 + 시간대 (ISO 8601)
  setup: DraftValues;                   // 경기에 쓴 적용 값 (시나리오 시드는 항상 채움)
  lut: RecipeLutSettings;
  inputs: Record<RobotId, Int8Array>;   // 로봇별 0 ~ 5999틱 × 4 B
  checksums: string[];                  // 체크포인트 121개
  branchName: string;                   // 사람이 알아보기 위한 정보 (불러온 경기의 원본 가지 이름)
  result: RecipeResult | null;          // 사람이 알아보기 위한 정보 (불러오기 판정에 쓰지 않음)
}

export type RecipeErrorCode = 'NOT_JSON' | 'PRESET_FILE' | 'NOT_RECIPE' | 'RECIPE_VERSION' | 'INVALID_FIELD' | 'INVALID_SETUP' | 'INVALID_INPUTS' | 'INVALID_CHECKSUMS';
export interface RecipeError {
  code: RecipeErrorCode;
  field?: string;      // INVALID_FIELD / INVALID_INPUTS: 문제 항목
  version?: number;    // RECIPE_VERSION: 파일의 형식 버전
  issues?: string[];   // INVALID_SETUP: 탭 검증 문제 코드 (issue.* 문구 키와 같음)
}

/** 불러오기 확인창 경고 (진행은 가능, 결과 차이는 체크섬으로 드러남) */
export type RecipeWarning =
  | { code: 'ENGINE_VERSION' | 'BALLISTICS_VERSION'; file: number; current: number }
  | { code: 'LUT_SETTINGS' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ============================================================
// 1. 입력 부호화: RLE + Base64
// ============================================================

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** 로봇 입력 기록(틱당 4 B, 앞에서 ticks틱) → RLE + Base64 */
export function encodeInputRecord(data: ArrayLike<number>, ticks = MATCH_TICKS): string {
  if (data.length < ticks * LOG_RECORD_BYTES) throw new RangeError(`input record shorter than ${ticks} ticks`);
  const runs: number[] = [];
  const same = (a: number, b: number) => {
    for (let k = 0; k < LOG_RECORD_BYTES; k++) if (data[a * LOG_RECORD_BYTES + k] !== data[b * LOG_RECORD_BYTES + k]) return false;
    return true;
  };
  for (let t = 0; t < ticks; ) {
    let n = 1;
    while (t + n < ticks && n < 0xffff && same(t, t + n)) n++;
    runs.push(n & 0xff, n >>> 8);
    for (let k = 0; k < LOG_RECORD_BYTES; k++) runs.push(data[t * LOG_RECORD_BYTES + k] & 0xff);
    t += n;
  }
  return toBase64(Uint8Array.from(runs));
}

/** RLE + Base64 → 로봇 입력 기록 (ticks × 4 B). Base64 / 묶음 길이 / 반복 수 합 ≠ ticks / 값 범위 밖(q = −128, 행동 코드 밖)이면 null */
export function decodeInputRecord(text: unknown, ticks = MATCH_TICKS): Int8Array | null {
  if (typeof text !== 'string') return null;
  const bytes = fromBase64(text);
  if (!bytes || bytes.length === 0 || bytes.length % RUN_BYTES !== 0) return null;
  const out = new Int8Array(ticks * LOG_RECORD_BYTES);
  let t = 0;
  for (let i = 0; i < bytes.length; i += RUN_BYTES) {
    const n = bytes[i] | (bytes[i + 1] << 8);
    if (n < 1 || t + n > ticks) return null;
    const rec = Array.from(bytes.subarray(i + 2, i + RUN_BYTES), b => (b << 24) >> 24); // uint8 → int8
    if (rec.slice(0, 3).some(q => q < -QUANT_MAX) || rec[3] < 0 || rec[3] >= ACTION_CODES.length) return null;
    for (let k = 0; k < n; k++) out.set(rec, (t + k) * LOG_RECORD_BYTES);
    t += n;
  }
  return t === ticks ? out : null;
}

/** 입력 허브의 적용 입력 기록 (유효 구간만) */
export function appliedInputRecords(inputs: MatchInputs): Record<RobotId, Int8Array> {
  const cut = (robot: RobotId) => inputs.applied[robot].data.subarray(0, inputs.applied[robot].length * LOG_RECORD_BYTES);
  return { robot1: cut('robot1'), robot2: cut('robot2') };
}

// ============================================================
// 2. 레시피 만들기 / 문자열
// ============================================================

/** 로컬 시각 + 시간대: 2026-09-30T14:32:05+09:00 */
export function isoLocal(date: Date): string {
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}${sign}${p(off / 60)}:${p(off % 60)}`;
}

export interface RecipeSource {
  setup: DraftValues;                                 // 경기에 쓴 적용 값
  inputs: Readonly<Record<RobotId, ArrayLike<number>>>; // 로봇별 적용 입력 기록 (0 ~ 5999틱)
  timeline: readonly DeepReadonly<TimelineFrame>[];   // 0 ~ 6000틱 프레임
  branchName: string;
  createdAt: Date;
  lut?: RecipeLutSettings;                            // 기본 = 현재 앱 값
}

/** 끝까지 진행한 경기 → 레시피 (종료 전이거나 입력이 모자라면 RangeError) */
export function buildMatchRecipe(src: RecipeSource): MatchRecipe {
  const last = src.timeline[MATCH_TICKS];
  if (!last) throw new RangeError('match has not reached the final tick');
  const cut = (data: ArrayLike<number>) => {
    if (data.length < MATCH_TICKS * LOG_RECORD_BYTES) throw new RangeError('input record shorter than the match');
    return Int8Array.from({ length: MATCH_TICKS * LOG_RECORD_BYTES }, (_, i) => data[i]);
  };
  const setup = clone(src.setup);
  setup.scenario.rngSeed = src.setup.scenario.rngSeed ?? DEFAULT_RNG_SEED; // 파일만으로 완결
  return {
    engineVersion: ENGINE_VERSION,
    ballisticsModelVersion: BALLISTICS_MODEL_VERSION,
    createdAt: isoLocal(src.createdAt),
    setup,
    lut: { ...(src.lut ?? CURRENT_LUT_SETTINGS) },
    inputs: { robot1: cut(src.inputs.robot1), robot2: cut(src.inputs.robot2) },
    checksums: timelineCheckpoints(src.timeline),
    branchName: src.branchName,
    result: { totalScore: last.totalScore, rp: { ...last.rpAchieved } },
  };
}

/** 레시피 → 파일 문자열 (2칸 들여쓰기) */
export function serializeMatchRecipe(recipe: MatchRecipe): string {
  const file = {
    format: RECIPE_FORMAT,
    recipeVersion: RECIPE_VERSION,
    engineVersion: recipe.engineVersion,
    ballisticsModelVersion: recipe.ballisticsModelVersion,
    createdAt: recipe.createdAt,
    setup: { robot1: robotPresetData(recipe.setup.robot1), robot2: robotPresetData(recipe.setup.robot2), scenario: recipe.setup.scenario },
    lut: recipe.lut,
    inputs: { ticks: MATCH_TICKS, robot1: encodeInputRecord(recipe.inputs.robot1), robot2: encodeInputRecord(recipe.inputs.robot2) },
    checksums: { interval: CHECKPOINT_INTERVAL, values: recipe.checksums },
    branch: { name: recipe.branchName },
    result: recipe.result,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ============================================================
// 3. 불러오기: 해석 / 검증 (거부 사유 코드)
// ============================================================

/** a의 모든 항목이 b에 같은 값으로 있는지 (b의 여분 항목은 무시) */
function containedIn(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => containedIn(x, b[i]));
  if (isRecord(a)) return isRecord(b) && Object.keys(a).every(k => containedIn(a[k], b[k]));
  return a === b;
}

/**
 * 로봇 프로필 엄격 해석: 프리셋 정리 함수가 아무것도 바꾸지 않아야 통과 (없는 항목 / 형식 틀림 → null).
 * 틀린 팀 번호 / 팀명은 정리 함수가 빈 값으로 바꾸므로 같은 비교에서 걸린다
 */
function strictRobot(raw: unknown, def: RobotProfile, id: RobotId): RobotProfile | null {
  if (!isRecord(raw)) return null;
  const { profile } = sanitizeRobotPreset(raw, def, id);
  const config: Partial<RobotProfile['config']> = { ...profile.config };
  delete config.id; // 슬롯 id는 파일에 없음
  return containedIn({ ...profile, config }, raw) ? profile : null;
}

const SCENARIO_KEYS: readonly (keyof ScenarioConfig)[] = [
  'allianceColor', 'r1Spawn', 'r2Spawn', 'hiveUpwardCell', 'hiveInitialPieces', 'r1Loadout', 'r2Loadout',
  'flowerPiecesCount', 'gardenPiecesCount', 'autoTipCount', 'rngSeed',
];

/** 시나리오 엄격 해석: 진영 + 시드 필수, 파일에 있는 항목은 모두 형식이 맞아야 함 */
function strictScenario(raw: unknown): ScenarioConfig | null {
  if (!isRecord(raw) || (raw.allianceColor !== 'RED' && raw.allianceColor !== 'BLUE') || typeof raw.rngSeed !== 'number' || !Number.isFinite(raw.rngSeed)) return null;
  const scenario = sanitizeScenarioPreset(raw, { allianceColor: raw.allianceColor });
  if (SCENARIO_KEYS.some(k => raw[k] !== undefined && !(k in scenario))) return null; // 형식이 틀려 버려진 항목
  return containedIn(scenario, raw) ? scenario : null;
}

type Parsed = { ok: true; recipe: MatchRecipe; warnings: RecipeWarning[] } | { ok: false; error: RecipeError };
const fail = (error: RecipeError): Parsed => ({ ok: false, error });

/** 파일 글자 → 레시피 + 경고. defaults = 로봇 프로필 모양의 기준 (슬롯별 기본 프로필) */
export function parseMatchRecipe(text: string, defaults: DraftValues): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail({ code: 'NOT_JSON' });
  }
  if (isRecord(data) && data.format === PRESET_FORMAT) return fail({ code: 'PRESET_FILE' });
  if (!isRecord(data) || data.format !== RECIPE_FORMAT) return fail({ code: 'NOT_RECIPE' });
  if (data.recipeVersion !== RECIPE_VERSION) return fail({ code: 'RECIPE_VERSION', version: typeof data.recipeVersion === 'number' ? data.recipeVersion : undefined });

  // 항목 형식
  if (!isPositiveInt(data.engineVersion)) return fail({ code: 'INVALID_FIELD', field: 'engineVersion' });
  if (!isPositiveInt(data.ballisticsModelVersion)) return fail({ code: 'INVALID_FIELD', field: 'ballisticsModelVersion' });
  const setup = isRecord(data.setup) ? data.setup : null;
  const robot1 = setup && strictRobot(setup.robot1, defaults.robot1, 'robot1');
  if (!robot1) return fail({ code: 'INVALID_FIELD', field: 'setup.robot1' });
  const robot2 = setup && strictRobot(setup.robot2, defaults.robot2, 'robot2');
  if (!robot2) return fail({ code: 'INVALID_FIELD', field: 'setup.robot2' });
  const scenario = setup && strictScenario(setup.scenario);
  if (!scenario) return fail({ code: 'INVALID_FIELD', field: 'setup.scenario' });
  const lut = data.lut;
  if (!isRecord(lut) || !Number.isInteger(lut.seed) || !isPositiveInt(lut.samples) || !isPositiveInt(lut.searchSamples)) return fail({ code: 'INVALID_FIELD', field: 'lut' });

  const inputs = data.inputs;
  if (!isRecord(inputs) || inputs.ticks !== MATCH_TICKS) return fail({ code: 'INVALID_INPUTS', field: 'ticks' });
  const in1 = decodeInputRecord(inputs.robot1);
  if (!in1) return fail({ code: 'INVALID_INPUTS', field: 'robot1' });
  const in2 = decodeInputRecord(inputs.robot2);
  if (!in2) return fail({ code: 'INVALID_INPUTS', field: 'robot2' });

  const sums = data.checksums;
  if (
    !isRecord(sums) || sums.interval !== CHECKPOINT_INTERVAL || !Array.isArray(sums.values) || sums.values.length !== CHECKPOINT_COUNT ||
    !sums.values.every(v => typeof v === 'string' && CHECKSUM_PATTERN.test(v))
  ) {
    return fail({ code: 'INVALID_CHECKSUMS' });
  }

  // 설정 검증 (로봇 폼 규칙 / 시나리오 · 배치 검증)
  const values: DraftValues = { robot1, robot2, scenario };
  let issues: string[];
  try {
    issues = (['robot1', 'robot2', 'scenario'] as DraftTab[]).flatMap(tab => tabIssues(values, tab).map(i => i.code));
  } catch {
    issues = ['VALIDATION_FAILED'];
  }
  if (issues.length > 0) return fail({ code: 'INVALID_SETUP', issues });

  // 사람이 알아보기 위한 정보 (틀려도 거부하지 않음)
  const branch = isRecord(data.branch) && typeof data.branch.name === 'string' ? data.branch.name : '';
  const res = data.result;
  const rp = isRecord(res) && isRecord(res.rp) ? res.rp : null;
  const result: RecipeResult | null =
    isRecord(res) && typeof res.totalScore === 'number' && rp && typeof rp.swarm === 'boolean' && typeof rp.pollinator1 === 'boolean' && typeof rp.pollinator2 === 'boolean'
      ? { totalScore: res.totalScore, rp: { swarm: rp.swarm, pollinator1: rp.pollinator1, pollinator2: rp.pollinator2 } }
      : null;

  const recipe: MatchRecipe = {
    engineVersion: data.engineVersion,
    ballisticsModelVersion: data.ballisticsModelVersion,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    setup: values,
    lut: { seed: lut.seed as number, samples: lut.samples, searchSamples: lut.searchSamples },
    inputs: { robot1: in1, robot2: in2 },
    checksums: sums.values as string[],
    branchName: branch,
    result,
  };
  return { ok: true, recipe, warnings: recipeWarnings(recipe) };
}

/** 현재 앱과 다른 점 (엔진 버전 / 탄도 모델 버전 / LUT 설정) */
export function recipeWarnings(recipe: Pick<MatchRecipe, 'engineVersion' | 'ballisticsModelVersion' | 'lut'>): RecipeWarning[] {
  const out: RecipeWarning[] = [];
  if (recipe.engineVersion !== ENGINE_VERSION) out.push({ code: 'ENGINE_VERSION', file: recipe.engineVersion, current: ENGINE_VERSION });
  if (recipe.ballisticsModelVersion !== BALLISTICS_MODEL_VERSION) out.push({ code: 'BALLISTICS_VERSION', file: recipe.ballisticsModelVersion, current: BALLISTICS_MODEL_VERSION });
  const l = recipe.lut;
  if (l.seed !== CURRENT_LUT_SETTINGS.seed || l.samples !== CURRENT_LUT_SETTINGS.samples || l.searchSamples !== CURRENT_LUT_SETTINGS.searchSamples) out.push({ code: 'LUT_SETTINGS' });
  return out;
}

/** 재계산한 타임라인이 레시피 체크포인트와 같은지 (어긋나면 처음 달라진 구간) */
export function verifyRecipe(recipe: Pick<MatchRecipe, 'checksums'>, timeline: readonly DeepReadonly<TimelineFrame>[]): CheckpointComparison {
  return compareCheckpoints(recipe.checksums, timelineCheckpoints(timeline));
}
