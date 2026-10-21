// 저장 레시피 (경기 파일, 명세서 3.9 저장 레시피 / 경기 불러오기, 10-3): React / DOM 비의존 순수 함수
// - 경기 = 적용된 설정(R1 / R2 프로필 + 시나리오, 시드 채움) + LUT 설정 + 분기 트리(15-1). LUT 자체는 저장하지 않는다.
// - 가지 = {번호, 부모 번호, 분기 틱, 이름, 머리 틱, 분기 이후 로봇별 적용 입력 기록, 그 가지 전체의 체크포인트, 결과}.
//   끝나지 않은 가지도 저장한다. 가지의 0 ~ 머리 입력 = 조상 구간을 이어 붙인 것 (branchInputRecords).
// - 입력: 로봇별 연속 중복 압축(RLE) 후 Base64. 한 묶음 = [반복 틱 수 uint16 LE (1 ~ 6000)][qx][qy][qω][action] 6 B.
// - 형식 버전 1 파일(끝난 가지 하나)도 읽는다 → 원본 가지 하나짜리 트리.
// - 불러오기는 재현이 목적이므로 프리셋과 달리 없는 항목을 기본값으로 채우지 않고 거부한다.

import { BALLISTICS_MODEL_VERSION, DEFAULT_BALLISTICS_SEED, DEFAULT_LUT_SAMPLES, DEFAULT_V0_SEARCH_SAMPLES } from '../core/ballistics';
import { CHECKPOINT_INTERVAL, CHECKSUM_PATTERN, compareCheckpoints, timelineCheckpoints } from '../core/checksum';
import type { CheckpointComparison } from '../core/checksum';
import { DEFAULT_RNG_SEED, ENGINE_VERSION, MATCH_TICKS } from '../core/simulationEngine';
import { MAX_BRANCHES, normalizeName } from './branchTree';
import type { DeepReadonly, RPState, ScenarioConfig, TimelineFrame } from '../core/types';
import { ACTION_CODES } from '../input/controls';
import type { RobotId } from '../input/inputConfig';
import { LOG_RECORD_BYTES } from '../input/inputLog';
import type { MatchInputs } from '../input/inputLog';
import { tabIssues } from '../ui/configDraft';
import type { DraftTab, DraftValues } from '../ui/configDraft';
import { MATCH_FORMAT, PRESET_FORMAT, pinLegacyBlueSpawns, robotPresetData, sanitizeRobotPreset, sanitizeScenarioPreset, upgradeRobotProfileData } from '../ui/presetFile';
import type { RobotProfile } from '../ui/robotForm';

export const RECIPE_FORMAT = MATCH_FORMAT;
/** 경기 파일 형식 버전: 1 = 끝난 가지 하나 (v1.0.0), 2 = 분기 트리 (v2.0.0, 15-1). 내보내기는 항상 2 */
export const RECIPE_VERSION = 2;
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

/** 가지 하나 (15-1): 분기 이후 입력만 담는다. 0 ~ 분기 틱 구간은 부모(조상)의 것 */
export interface RecipeBranch {
  number: number;                       // 표시 번호 (원본 1, 경기 안에서 재사용 없음)
  parent: number | null;                // 부모 가지 번호 (원본 = null)
  forkTick: number;                     // 부모에서 갈라진 틱 (원본 0, 부모 머리 틱 미만)
  name: string | null;                  // 사용자 이름 (null = 자동 이름)
  headTick: number;                     // 마지막 기록 틱 (분기 틱 이상, 6000 = 경기 종료)
  inputs: Record<RobotId, Int8Array>;   // 로봇별 적용 입력 기록 분기 틱 ~ 머리 틱 − 1 (틱당 4 B)
  checksums: string[];                  // 이 가지 전체 타임라인의 체크포인트 (0, 50, … ≤ 머리 틱)
  result: RecipeResult | null;          // 종료한 가지의 점수 (사람이 알아보기 위한 정보, 불러오기 판정에 쓰지 않음)
}

export interface MatchRecipe {
  engineVersion: number;
  ballisticsModelVersion: number;
  createdAt: string;                    // 로컬 시각 + 시간대 (ISO 8601)
  setup: DraftValues;                   // 경기에 쓴 적용 값 (시나리오 시드는 항상 채움)
  lut: RecipeLutSettings;
  branches: RecipeBranch[];             // 만든 순서 (부모가 자식보다 앞, 0번 = 원본)
  current: number;                      // 내보낼 때 보던 가지 번호 (불러오면 이 가지로 연다)
  nextNumber: number;                   // 다음 새 가지 번호 (번호 재사용 없음)
}

export type RecipeErrorCode =
  | 'NOT_JSON' | 'PRESET_FILE' | 'NOT_RECIPE' | 'RECIPE_VERSION' | 'INVALID_FIELD' | 'INVALID_SETUP' | 'INVALID_INPUTS' | 'INVALID_CHECKSUMS'
  | 'TOO_MANY_BRANCHES';
export interface RecipeError {
  code: RecipeErrorCode;
  field?: string;      // INVALID_FIELD / INVALID_INPUTS / INVALID_CHECKSUMS: 문제 항목 (가지는 branches[번호 순서])
  version?: number;    // RECIPE_VERSION: 파일의 형식 버전
  issues?: string[];   // INVALID_SETUP: 탭 검증 문제 코드 (issue.* 문구 키와 같음)
  count?: number;      // TOO_MANY_BRANCHES: 파일의 가지 수 (상한 MAX_BRANCHES)
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
  if (ticks === 0) return text === '' ? new Int8Array(0) : null; // 분기 직후 머리 = 분기 틱인 가지
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

/** 가지 기록 요약 (16-2): 머리 틱 / 전체 타임라인의 체크포인트 / 종료 결과. 프레임을 해제한 가지도 목록 · 비교 · 내보내기에 쓴다 */
export type BranchRecord = Pick<RecipeBranch, 'headTick' | 'checksums' | 'result'>;

/** 0 ~ 머리 틱 프레임 → 가지 기록 요약 (체크포인트 121개 해시, 약 10 ms) */
export function timelineRecord(timeline: readonly DeepReadonly<TimelineFrame>[]): BranchRecord {
  const headTick = timeline.length - 1;
  const last = timeline[headTick];
  return {
    headTick,
    checksums: timelineCheckpoints(timeline),
    result: headTick >= MATCH_TICKS && last ? { totalScore: last.totalScore, rp: { ...last.rpAchieved } } : null,
  };
}

/** 내보낼 가지 하나의 재료 (컨트롤러 가지 트리) */
export interface RecipeBranchSource {
  number: number;
  parent: number | null;
  forkTick: number;
  name: string | null;
  inputs: Readonly<Record<RobotId, ArrayLike<number>>>; // 로봇별 적용 입력 기록 0 ~ 머리 틱 − 1 (조상 구간 포함 전체)
  record: BranchRecord;                                 // 머리 틱 / 체크포인트 / 결과 (16-2: 프레임 대신, timelineRecord)
}

export interface RecipeSource {
  setup: DraftValues;                 // 경기에 쓴 적용 값
  branches: readonly RecipeBranchSource[]; // 만든 순서 (0번 = 원본)
  current: number;
  nextNumber: number;
  createdAt: Date;
  lut?: RecipeLutSettings;            // 기본 = 현재 앱 값
}

/** 분기 트리 → 레시피. 입력이 머리 틱보다 짧거나 트리 구조가 틀리면 RangeError */
export function buildMatchRecipe(src: RecipeSource): MatchRecipe {
  const branches = src.branches.map((b): RecipeBranch => {
    const { headTick } = b.record;
    const cut = (data: ArrayLike<number>) => {
      if (data.length < headTick * LOG_RECORD_BYTES) throw new RangeError(`branch ${b.number}: input record shorter than its head tick`);
      return Int8Array.from({ length: (headTick - b.forkTick) * LOG_RECORD_BYTES }, (_, i) => data[b.forkTick * LOG_RECORD_BYTES + i]);
    };
    return {
      number: b.number,
      parent: b.parent,
      forkTick: b.forkTick,
      name: normalizeName(b.name),
      headTick,
      inputs: { robot1: cut(b.inputs.robot1), robot2: cut(b.inputs.robot2) },
      checksums: [...b.record.checksums],
      result: b.record.result && { totalScore: b.record.result.totalScore, rp: { ...b.record.result.rp } },
    };
  });
  const problem = branchTreeProblem(branches, src.current, src.nextNumber);
  if (problem) throw new RangeError(`invalid branch tree: ${problem}`);
  const setup = clone(src.setup);
  setup.scenario.rngSeed = src.setup.scenario.rngSeed ?? DEFAULT_RNG_SEED; // 파일만으로 완결
  return {
    engineVersion: ENGINE_VERSION,
    ballisticsModelVersion: BALLISTICS_MODEL_VERSION,
    createdAt: isoLocal(src.createdAt),
    setup,
    lut: { ...(src.lut ?? CURRENT_LUT_SETTINGS) },
    branches,
    current: src.current,
    nextNumber: src.nextNumber,
  };
}

/**
 * 트리 구조 검사 (만들기 / 해석 공용): 1 ~ MAX_BRANCHES개, 0번 = 원본(번호 1, 부모 없음, 분기 틱 0), 번호는 서로 다른 양의 정수,
 * 부모는 앞에 있는 가지, 0 ≤ 분기 틱 < 부모 머리 틱 (원본은 0), 분기 틱 ≤ 머리 틱 ≤ 6000, 지금 가지 번호가 있음, 다음 번호 > 가장 큰 번호.
 * 문제가 없으면 null, 있으면 문제 항목 이름
 */
function branchTreeProblem(branches: readonly Pick<RecipeBranch, 'number' | 'parent' | 'forkTick' | 'headTick'>[], current: unknown, nextNumber: unknown): string | null {
  if (branches.length === 0) return 'branches';
  const heads = new Map<number, number>();
  for (const [i, b] of branches.entries()) {
    const field = `branches[${i}]`;
    if (!isPositiveInt(b.number) || heads.has(b.number)) return field;
    if (i === 0 ? b.number !== 1 || b.parent !== null || b.forkTick !== 0 : b.parent === null) return field;
    if (!Number.isInteger(b.headTick) || !Number.isInteger(b.forkTick) || b.forkTick < 0 || b.headTick < b.forkTick || b.headTick > MATCH_TICKS) return field;
    if (b.parent !== null) {
      const parentHead = heads.get(b.parent);
      if (parentHead === undefined || b.forkTick >= parentHead) return field;
    }
    heads.set(b.number, b.headTick);
  }
  if (typeof current !== 'number' || !heads.has(current)) return 'current';
  if (!Number.isInteger(nextNumber) || (nextNumber as number) <= Math.max(...heads.keys())) return 'nextNumber';
  return null;
}

/** 가지의 0 ~ 머리 틱 − 1 적용 입력 기록 (조상 구간을 이어 붙임, 틱당 4 B). 없는 번호면 null */
export function branchInputRecords(recipe: Pick<MatchRecipe, 'branches'>, number: number): Record<RobotId, Int8Array> | null {
  const chain: RecipeBranch[] = [];
  for (let b = recipe.branches.find(x => x.number === number); b; b = b.parent === null ? undefined : recipe.branches.find(x => x.number === b!.parent)) chain.unshift(b);
  const target = chain[chain.length - 1];
  if (!target || chain[0].parent !== null) return null;
  const join = (robot: RobotId) => {
    const out = new Int8Array(target.headTick * LOG_RECORD_BYTES);
    // 목표 가지부터 원본 쪽으로: 각 가지는 [분기 틱, 아직 채우지 않은 구간 끝)만 채운다.
    // (자식이 부모의 분기 틱보다 앞에서 갈라졌으면 그 부모 구간은 쓰지 않음 — 그 틱들은 더 위 조상의 것)
    let limit = target.headTick;
    for (let k = chain.length - 1; k >= 0; k--) {
      const b = chain[k];
      if (limit > b.forkTick) out.set(b.inputs[robot].subarray(0, (limit - b.forkTick) * LOG_RECORD_BYTES), b.forkTick * LOG_RECORD_BYTES);
      limit = Math.min(limit, b.forkTick);
    }
    return out;
  };
  return { robot1: join('robot1'), robot2: join('robot2') };
}

/** 불러오기용 트리 (15-2, AppController.beginLoadMatch 입력): 가지마다 0 ~ 머리 전체 입력 */
export function recipeLoadTree(recipe: Pick<MatchRecipe, 'branches' | 'current' | 'nextNumber'>) {
  return {
    branches: recipe.branches.map(b => ({ number: b.number, parent: b.parent, forkTick: b.forkTick, name: b.name, headTick: b.headTick, records: branchInputRecords(recipe, b.number)! })),
    current: recipe.current,
    nextNumber: recipe.nextNumber,
  };
}

/** 레시피 → 파일 문자열 (형식 버전 2, 2칸 들여쓰기) */
export function serializeMatchRecipe(recipe: MatchRecipe): string {
  const file = {
    format: RECIPE_FORMAT,
    recipeVersion: RECIPE_VERSION,
    engineVersion: recipe.engineVersion,
    ballisticsModelVersion: recipe.ballisticsModelVersion,
    createdAt: recipe.createdAt,
    setup: { robot1: robotPresetData(recipe.setup.robot1), robot2: robotPresetData(recipe.setup.robot2), scenario: recipe.setup.scenario },
    lut: recipe.lut,
    checkpointInterval: CHECKPOINT_INTERVAL,
    current: recipe.current,
    nextNumber: recipe.nextNumber,
    branches: recipe.branches.map(b => {
      const ticks = b.headTick - b.forkTick;
      return {
        number: b.number,
        parent: b.parent,
        forkTick: b.forkTick,
        name: b.name,
        headTick: b.headTick,
        inputs: { robot1: encodeInputRecord(b.inputs.robot1, ticks), robot2: encodeInputRecord(b.inputs.robot2, ticks) },
        checksums: b.checksums,
        result: b.result,
      };
    }),
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
 * 틀린 팀 번호 / 팀명은 정리 함수가 빈 값으로 바꾸므로 같은 비교에서 걸린다.
 * 11-2: v2.0.0 새 로봇 항목은 없으면 이전 형식 변환(upgradeRobotProfileData)으로 채우고, 있으면 같은 엄격 비교 (명세서 3.9).
 * 15-1: 형식 버전 2 파일은 새 항목이 모두 있어야 한다 (없으면 거부). 없어진 aimTolerance는 버전과 무관하게 변환에서 버림 (11-3)
 */
function strictRobot(raw: unknown, def: RobotProfile, id: RobotId, requireV2Items: boolean): RobotProfile | null {
  if (!isRecord(raw)) return null;
  if (requireV2Items && !hasV2RobotItems(raw)) return null; // 형식 버전 2 파일은 v2.0.0 로봇 항목이 모두 있어야 함 (15-1)
  const upgraded = upgradeRobotProfileData(raw);
  const { profile } = sanitizeRobotPreset(upgraded, def, id);
  const config: Partial<RobotProfile['config']> = { ...profile.config };
  delete config.id; // 슬롯 id는 파일에 없음
  return containedIn({ ...profile, config }, upgraded) ? profile : null;
}

/** v2.0.0 로봇 항목이 모두 있는지 (형식 버전 2 파일, 값 형식은 정리 함수의 엄격 비교가 봄) */
function hasV2RobotItems(raw: Record<string, unknown>): boolean {
  const c = raw.config;
  const b = raw.ballistics;
  return isRecord(c) && isRecord(b) && ['shooterSetup', 'nectarShooter', 'flowerDropZones', 'liftMaxSpeed'].every(k => c[k] !== undefined) &&
    ['shooterLateralOffset', 'nectarShooter'].every(k => b[k] !== undefined);
}

const SCENARIO_KEYS: readonly (keyof ScenarioConfig)[] = [
  'allianceColor', 'r1Spawn', 'r2Spawn', 'hiveUpwardCell', 'hiveInitialPieces', 'r1Loadout', 'r2Loadout',
  'flowerPiecesCount', 'gardenPiecesCount', 'autoTipCount', 'rngSeed',
  'floorPieces', 'rpThresholds', 'r1AutoMovement', 'r2AutoMovement',
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

/** 체크포인트 목록 형식: 머리 틱까지의 개수(⌊머리 / 50⌋ + 1)와 8자리 16진수 */
const validChecksums = (v: unknown, headTick: number): v is string[] =>
  Array.isArray(v) && v.length === Math.floor(headTick / CHECKPOINT_INTERVAL) + 1 && v.every(x => typeof x === 'string' && CHECKSUM_PATTERN.test(x));

/** 알아보기용 결과 (틀리면 null, 거부하지 않음) */
function looseResult(res: unknown): RecipeResult | null {
  const rp = isRecord(res) && isRecord(res.rp) ? res.rp : null;
  return isRecord(res) && typeof res.totalScore === 'number' && rp && typeof rp.swarm === 'boolean' && typeof rp.pollinator1 === 'boolean' && typeof rp.pollinator2 === 'boolean'
    ? { totalScore: res.totalScore, rp: { swarm: rp.swarm, pollinator1: rp.pollinator1, pollinator2: rp.pollinator2 } }
    : null;
}

type TreeParsed = { ok: true; branches: RecipeBranch[]; current: number; nextNumber: number } | { ok: false; error: RecipeError };

/** 형식 버전 1: 끝난 가지 하나 (inputs 0 ~ 5999틱 + 체크포인트 121개 + 가지 이름) → 원본 가지 하나짜리 트리 */
function parseV1Tree(data: Record<string, unknown>): TreeParsed {
  const inputs = data.inputs;
  if (!isRecord(inputs) || inputs.ticks !== MATCH_TICKS) return { ok: false, error: { code: 'INVALID_INPUTS', field: 'ticks' } };
  const in1 = decodeInputRecord(inputs.robot1);
  if (!in1) return { ok: false, error: { code: 'INVALID_INPUTS', field: 'robot1' } };
  const in2 = decodeInputRecord(inputs.robot2);
  if (!in2) return { ok: false, error: { code: 'INVALID_INPUTS', field: 'robot2' } };
  const sums = data.checksums;
  if (!isRecord(sums) || sums.interval !== CHECKPOINT_INTERVAL || !validChecksums(sums.values, MATCH_TICKS)) return { ok: false, error: { code: 'INVALID_CHECKSUMS' } };
  const name = isRecord(data.branch) && typeof data.branch.name === 'string' ? normalizeName(data.branch.name) : null;
  const root: RecipeBranch = { number: 1, parent: null, forkTick: 0, name, headTick: MATCH_TICKS, inputs: { robot1: in1, robot2: in2 }, checksums: sums.values, result: looseResult(data.result) };
  return { ok: true, branches: [root], current: 1, nextNumber: 2 };
}

/** 형식 버전 2: 분기 트리 (가지마다 분기 이후 입력 + 그 가지 전체 체크포인트, 15-1) */
function parseV2Tree(data: Record<string, unknown>): TreeParsed {
  const fail = (error: RecipeError): TreeParsed => ({ ok: false, error });
  if (data.checkpointInterval !== CHECKPOINT_INTERVAL) return fail({ code: 'INVALID_CHECKSUMS', field: 'checkpointInterval' });
  const raw = data.branches;
  if (!Array.isArray(raw) || raw.length === 0) return fail({ code: 'INVALID_FIELD', field: 'branches' });
  if (raw.length > MAX_BRANCHES) return fail({ code: 'TOO_MANY_BRANCHES', count: raw.length });
  const branches: RecipeBranch[] = [];
  for (const [i, b] of raw.entries()) {
    const field = `branches[${i}]`;
    if (!isRecord(b) || !Number.isInteger(b.headTick) || !Number.isInteger(b.forkTick) || !(b.parent === null || Number.isInteger(b.parent))) return fail({ code: 'INVALID_FIELD', field });
    const headTick = b.headTick as number;
    const forkTick = b.forkTick as number;
    const ticks = headTick - forkTick;
    const inputs = b.inputs;
    const in1 = ticks >= 0 && isRecord(inputs) ? decodeInputRecord(inputs.robot1, ticks) : null;
    if (!in1) return fail({ code: 'INVALID_INPUTS', field: `${field}.robot1` });
    const in2 = isRecord(inputs) ? decodeInputRecord(inputs.robot2, ticks) : null;
    if (!in2) return fail({ code: 'INVALID_INPUTS', field: `${field}.robot2` });
    if (!validChecksums(b.checksums, Math.max(0, headTick))) return fail({ code: 'INVALID_CHECKSUMS', field });
    branches.push({
      number: b.number as number,
      parent: b.parent as number | null,
      forkTick,
      name: typeof b.name === 'string' ? normalizeName(b.name) : null, // 이름은 틀려도 자동 이름으로 (알아보기 정보와 같은 취급)
      headTick,
      inputs: { robot1: in1, robot2: in2 },
      checksums: b.checksums,
      result: headTick >= MATCH_TICKS ? looseResult(b.result) : null,
    });
  }
  const problem = branchTreeProblem(branches, data.current, data.nextNumber);
  if (problem) return fail({ code: 'INVALID_FIELD', field: problem });
  return { ok: true, branches, current: data.current as number, nextNumber: data.nextNumber as number };
}

/** 파일 글자 → 레시피 + 경고 (형식 버전 1 / 2). defaults = 로봇 프로필 모양의 기준 (슬롯별 기본 프로필) */
export function parseMatchRecipe(text: string, defaults: DraftValues): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail({ code: 'NOT_JSON' });
  }
  if (isRecord(data) && data.format === PRESET_FORMAT) return fail({ code: 'PRESET_FILE' });
  if (!isRecord(data) || data.format !== RECIPE_FORMAT) return fail({ code: 'NOT_RECIPE' });
  const version = data.recipeVersion;
  if (version !== 1 && version !== RECIPE_VERSION) return fail({ code: 'RECIPE_VERSION', version: typeof version === 'number' ? version : undefined });

  // 항목 형식
  if (!isPositiveInt(data.engineVersion)) return fail({ code: 'INVALID_FIELD', field: 'engineVersion' });
  if (!isPositiveInt(data.ballisticsModelVersion)) return fail({ code: 'INVALID_FIELD', field: 'ballisticsModelVersion' });
  const setup = isRecord(data.setup) ? data.setup : null;
  const requireV2Items = version === RECIPE_VERSION;
  const robot1 = setup && strictRobot(setup.robot1, defaults.robot1, 'robot1', requireV2Items);
  if (!robot1) return fail({ code: 'INVALID_FIELD', field: 'setup.robot1' });
  const robot2 = setup && strictRobot(setup.robot2, defaults.robot2, 'robot2', requireV2Items);
  if (!robot2) return fail({ code: 'INVALID_FIELD', field: 'setup.robot2' });
  const strict = setup && strictScenario(setup.scenario);
  if (!strict) return fail({ code: 'INVALID_FIELD', field: 'setup.scenario' });
  const scenario = data.engineVersion === 1 ? pinLegacyBlueSpawns(strict) : strict; // 엔진 버전 1 파일의 BLUE 기본 시작 자세 유지 (14-1a)
  const lut = data.lut;
  if (!isRecord(lut) || !Number.isInteger(lut.seed) || !isPositiveInt(lut.samples) || !isPositiveInt(lut.searchSamples)) return fail({ code: 'INVALID_FIELD', field: 'lut' });

  const tree = version === 1 ? parseV1Tree(data) : parseV2Tree(data);
  if (!tree.ok) return fail(tree.error);

  // 설정 검증 (로봇 폼 규칙 / 시나리오 · 배치 검증)
  const values: DraftValues = { robot1, robot2, scenario };
  let issues: string[];
  try {
    issues = (['robot1', 'robot2', 'scenario'] as DraftTab[]).flatMap(tab => tabIssues(values, tab).map(i => i.code));
  } catch {
    issues = ['VALIDATION_FAILED'];
  }
  if (issues.length > 0) return fail({ code: 'INVALID_SETUP', issues });

  const recipe: MatchRecipe = {
    engineVersion: data.engineVersion,
    ballisticsModelVersion: data.ballisticsModelVersion,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    setup: values,
    lut: { seed: lut.seed as number, samples: lut.samples, searchSamples: lut.searchSamples },
    branches: tree.branches,
    current: tree.current,
    nextNumber: tree.nextNumber,
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

/** 재계산한 가지 타임라인이 그 가지의 체크포인트와 같은지 (어긋나면 처음 달라진 구간) */
export function verifyRecipe(branch: Pick<RecipeBranch, 'checksums'>, timeline: readonly DeepReadonly<TimelineFrame>[]): CheckpointComparison {
  return compareCheckpoints(branch.checksums, timelineCheckpoints(timeline));
}
