// 로봇 제원 탭 폼 규칙 (명세서 3.8 로봇 제원 탭, 09-9a): React / DOM 비의존
// - 로봇 프로필 = GUI 전용 팀 번호 / 팀명 + 엔진 RobotConfig (RobotConfig 타입은 수정하지 않음) + 슈터 탄도 (09-9b) + 스윗스팟 (09-10a).
// - 숫자 칸: 엔진 단위로 범위 검사 (화면 표시 / 입력은 units.ts 변환). 입력 글자가 올바르면 그 칸 값만 엔진 단위로 바꿔 저장
//   (고친 칸만 변환 — 표시 반올림으로 다른 칸 값이 바뀌지 않음), 틀리면 글자를 그대로 보관하고 탭은 "설정 오류".
// - 허용 범위 (09-9 확정): 가로 / 세로 6 ~ 18 in, 최고 속도 1 ~ 200 in/s, 최대 가속도 1 ~ 2000 in/s², 최고 각속도 0.1 ~ 30 rad/s,
//   최대 각가속도 0.1 ~ 300 rad/s², 최대 적재 수 정수 1 ~ 4, 딜레이 · 준비 시간 · 투입 간격 정수 0 ~ 5000 ms,
//   허용 조준 오차 0.1 ~ 45°, 터렛 한계 −180 ~ 180° (왼쪽 ≠ 오른쪽), 팀 번호 숫자 0 ~ 5자리, 팀명 24자까지.
// - 09-9b 확정: 발사구 지상고 1 ~ 50 in, 발사각 5 ~ 85°, 발사구 오프셋 −18 ~ 18 in, 속도 편차 0 ~ 20 %, 방위 · 피치 편차 0 ~ 10°,
//   흡입 구역 offset ± 변 길이 / 2, width 3.6 ~ 36 in(가장 큰 기물 NECTAR 직경부터, 09-9c), depth 0.25 ~ 12 in, 구역 0 ~ 8개.
// - 09-10a: 스윗스팟은 기준 셀 RED_AUDIENCE 좌표로 보관하고, 폼은 시나리오 진영 기준으로 보여 주고 받는다 (BLUE = 필드 중심 점대칭).
//   칸 범위 0 ~ 144 in, 입력은 1 in 격자 중심으로 맞춤, 검증(validateBallisticsConfig) 실패는 탭 문제.
// - 13-3 (v2.0.0): 슈터 구성(NONE / POLLEN_ONLY / SHARED / PER_PIECE), 좌우 오프셋 −18 ~ 18 in, NECTAR 슈터 카드(PER_PIECE, 주 슈터와
//   같은 항목 · 범위, 칸 키 'nectar.' 접두사), 리프트 주행 속도 0 ~ 200 in/s, 투입 방향 구역(흡입 구역과 같은 칸 · 범위, 칸 키 'dropZone.').
//   쓰지 않는 슈터(NONE의 주 슈터, PER_PIECE가 아닐 때 NECTAR 슈터)의 값은 보관만 하고 검사하지 않는다 (숨는 칸이 탭을 막지 않게).

import {
  PIECE_TYPES,
  isPieceFireable,
  DEFAULT_HEADING_NOISE_RAD,
  DEFAULT_PITCH_NOISE_RAD,
  DEFAULT_SHOOTER_BALLISTICS,
  DEFAULT_V0_NOISE_PERCENT,
  sweetSpotFromBasis,
  sweetSpotToBasis,
  validateBallisticsConfig,
} from '../core/ballistics';
import type { RobotLUTShooters } from '../core/ballistics';
import { FIELD_SIZE, HIVE_RIM_Z, PIECE_PHYSICS } from '../core/collision';
import type { BallisticsConfig, BumperSide, BumperZone, RobotConfig, ShooterAimConfig, ShooterSetup } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { DISPLAY_DECIMALS, formatNumber, fromDisplay, parseNumberInput, toDisplay, unitLabel } from './units';
import type { LengthUnit, QuantityKind } from './units';

/**
 * 슈터 1개의 탄도 = 엔진 BallisticsConfig (편차 3종 / 좌우 오프셋은 값을 항상 채움). dz = 림 높이 − 발사구 지상고,
 * 스윗스팟 = 기준 셀 RED_AUDIENCE 좌표, 좌우 오프셋 + = 로봇 오른쪽 (명세서 4장 / 5.4 v2.0.0 항목 규칙)
 */
export interface ProfileShooterBallistics {
  dz: number;
  shooterPitch: number;
  shooterOffset: number;
  shooterLateralOffset: number;
  sweetSpot: { x: number; y: number };
  v0NoisePercent: number;
  headingNoiseRad: number;
  pitchNoiseRad: number;
}

/** 로봇 프로필의 탄도 = 주 슈터(v1 항목 위치 그대로) + PER_PIECE의 NECTAR 슈터 (다른 구성에서는 값만 보관) */
export interface ProfileBallistics extends ProfileShooterBallistics {
  nectarShooter: ProfileShooterBallistics;
}

/**
 * 기본 스윗스팟 (09-10a 사용자 확정, 후보 비교 C): 기준 셀 입구 정면 약 43 in. 기본 로봇(18 in, 발사구 14 in, 60°)에서
 * 스윗스팟 명중률 POLLEN 99.0 % / NECTAR 97.9 %, 50 % 이상 구역이 가장 넓은 후보
 */
export const DEFAULT_SWEET_SPOT: Readonly<{ x: number; y: number }> = { x: 59.5, y: 131.5 };

const defaultShooterBallistics = (): ProfileShooterBallistics => ({
  dz: DEFAULT_SHOOTER_BALLISTICS.dz,
  shooterPitch: DEFAULT_SHOOTER_BALLISTICS.shooterPitch,
  shooterOffset: DEFAULT_SHOOTER_BALLISTICS.shooterOffset,
  shooterLateralOffset: 0,
  sweetSpot: { ...DEFAULT_SWEET_SPOT },
  v0NoisePercent: DEFAULT_V0_NOISE_PERCENT,
  headingNoiseRad: DEFAULT_HEADING_NOISE_RAD,
  pitchNoiseRad: DEFAULT_PITCH_NOISE_RAD,
});

/** 기본 탄도: NECTAR 슈터 = 기본 주 슈터와 같은 값 */
export const DEFAULT_PROFILE_BALLISTICS: Readonly<ProfileBallistics> = { ...defaultShooterBallistics(), nectarShooter: defaultShooterBallistics() };

export interface RobotProfile {
  teamNumber: string; // GUI 전용 (엔진 미전달). 비우면 R1 / R2로 표시
  teamName: string;   // GUI 전용 팀명 (09-9 확정: '로봇 이름' 대신 사용자가 알아보기 쉬운 팀명)
  config: RobotConfig;
  ballistics: ProfileBallistics;
}

export const TEAM_NUMBER_MAX_DIGITS = 5;
export const TEAM_NAME_MAX_LENGTH = 24;

export type NumericConfigKey =
  | 'width'
  | 'length'
  | 'maxSpeed'
  | 'maxLinearAccel'
  | 'maxTurnRate'
  | 'maxAngularAccel'
  | 'maxControlledPieces'
  | 'intakeDelay'
  | 'shooterDelay'
  | 'aimTolerance'
  | 'flowerSetupDelay'
  | 'flowerDropDelay'
  | 'liftMaxSpeed';
export type BallisticsFieldKey = 'launchHeight' | 'shooterPitch' | 'shooterOffset' | 'shooterLateralOffset' | 'v0NoisePercent' | 'headingNoiseRad' | 'pitchNoiseRad';

/** 슈터 칸 (슈터마다 같은 항목, 13-3): 런타임 제원(발사 딜레이 / 허용 오차 / 터렛 한계) + 탄도 */
export type ShooterFieldKey = 'shooterDelay' | 'aimTolerance' | 'turretLeft' | 'turretRight' | BallisticsFieldKey;
export const SHOOTER_FIELD_KEYS: readonly ShooterFieldKey[] = [
  'shooterDelay', 'aimTolerance', 'turretLeft', 'turretRight',
  'launchHeight', 'shooterPitch', 'shooterOffset', 'shooterLateralOffset', 'v0NoisePercent', 'headingNoiseRad', 'pitchNoiseRad',
];
/** 슈터 자리: 주 슈터(v1 항목 위치) / PER_PIECE의 NECTAR 슈터 */
export type ShooterSlot = 'MAIN' | 'NECTAR';
/** NECTAR 슈터 카드의 칸 키 (틀린 입력 글자 / 문제 코드도 같은 키) */
export type NectarFieldKey = `nectar.${ShooterFieldKey}`;
export type NumberFieldKey = NumericConfigKey | 'turretLeft' | 'turretRight' | BallisticsFieldKey | NectarFieldKey;

/** 그 슈터 자리의 칸 키: 주 슈터 = 칸 이름 그대로, NECTAR 슈터 = 'nectar.' 접두사 */
export function shooterFieldKey(slot: ShooterSlot, key: ShooterFieldKey): NumberFieldKey {
  return slot === 'MAIN' ? key : `nectar.${key}`;
}

const NECTAR_PREFIX = 'nectar.';
const nectarBase = (key: NumberFieldKey): ShooterFieldKey | null => (key.startsWith(NECTAR_PREFIX) ? (key.slice(NECTAR_PREFIX.length) as ShooterFieldKey) : null);
export type TextFieldKey = 'teamNumber' | 'teamName';
export type RobotFieldKey = NumberFieldKey | TextFieldKey;

/** 숫자 칸: 물리량 종류('count' = 단위 없는 개수), 엔진 단위 범위 [min, max], 정수 여부 */
export interface NumberFieldSpec {
  kind: QuantityKind | 'count';
  min: number;
  max: number;
  integer?: boolean;
}

const deg = (d: number) => (d * Math.PI) / 180;

const MAIN_NUMBER_FIELDS: Readonly<Record<Exclude<NumberFieldKey, NectarFieldKey>, NumberFieldSpec>> = {
  width: { kind: 'length', min: 6, max: 18 },
  length: { kind: 'length', min: 6, max: 18 },
  maxSpeed: { kind: 'speed', min: 1, max: 200 },
  maxLinearAccel: { kind: 'accel', min: 1, max: 2000 },
  maxTurnRate: { kind: 'angularRate', min: 0.1, max: 30 },
  maxAngularAccel: { kind: 'angularAccel', min: 0.1, max: 300 },
  maxControlledPieces: { kind: 'count', min: 1, max: 4, integer: true },
  intakeDelay: { kind: 'timeMs', min: 0, max: 5000, integer: true },
  shooterDelay: { kind: 'timeMs', min: 0, max: 5000, integer: true },
  aimTolerance: { kind: 'angle', min: deg(0.1), max: deg(45) },
  turretLeft: { kind: 'angle', min: -Math.PI, max: Math.PI },
  turretRight: { kind: 'angle', min: -Math.PI, max: Math.PI },
  flowerSetupDelay: { kind: 'timeMs', min: 0, max: 5000, integer: true },
  flowerDropDelay: { kind: 'timeMs', min: 0, max: 5000, integer: true },
  // 리프트 상태 최고 속도 (13-3, 0 = 리프트 중 정지 = v1)
  liftMaxSpeed: { kind: 'speed', min: 0, max: 200 },
  // 슈터 탄도 (09-9b). 발사구 지상고는 엔진 값 dz = 53.5 − h로 보관 → 범위도 dz 기준 (h 1 ~ 50 in)
  launchHeight: { kind: 'launchHeight', min: HIVE_RIM_Z - 50, max: HIVE_RIM_Z - 1 },
  shooterPitch: { kind: 'angle', min: deg(5), max: deg(85) },
  shooterOffset: { kind: 'length', min: -18, max: 18 },
  shooterLateralOffset: { kind: 'length', min: -18, max: 18 }, // 13-3: + = 로봇 오른쪽
  v0NoisePercent: { kind: 'percent', min: 0, max: 0.2 },
  headingNoiseRad: { kind: 'angle', min: 0, max: deg(10) },
  pitchNoiseRad: { kind: 'angle', min: 0, max: deg(10) },
};

/** 모든 숫자 칸: 주 칸 + NECTAR 슈터 카드(주 슈터와 같은 범위, 13-3) */
export const NUMBER_FIELDS: Readonly<Record<NumberFieldKey, NumberFieldSpec>> = {
  ...MAIN_NUMBER_FIELDS,
  ...(Object.fromEntries(SHOOTER_FIELD_KEYS.map(key => [`nectar.${key}`, MAIN_NUMBER_FIELDS[key]])) as Record<NectarFieldKey, NumberFieldSpec>),
};

// ------------------------------------------------------------
// 흡입 구역 (09-9b): 구역별 offset / width / depth. offset 범위는 면과 로봇 크기에 따라 (± 변 길이 / 2)
// ------------------------------------------------------------

export const MAX_INTAKE_ZONES = 8;
export const BUMPER_SIDES: readonly BumperSide[] = ['FRONT', 'BACK', 'LEFT', 'RIGHT'];
export type ZoneField = 'offset' | 'width' | 'depth';
/** 구역 폭 최소 = 가장 큰 기물(NECTAR) 직경 3.6 in: 기물보다 좁은 입구는 물리적으로 흡입 불가 (09-9c) */
export const MIN_ZONE_WIDTH = 2 * Math.max(PIECE_PHYSICS.POLLEN.radius, PIECE_PHYSICS.NECTAR.radius);
export const ZONE_FIELDS: readonly ZoneField[] = ['offset', 'width', 'depth'];

/** 구역이 붙은 변의 길이: 앞 / 뒤 = 가로(width), 좌 / 우 = 세로(length) */
export function zoneSideLength(side: BumperSide, config: Pick<RobotConfig, 'width' | 'length'>): number {
  return side === 'FRONT' || side === 'BACK' ? config.width : config.length;
}

export function zoneFieldSpec(field: ZoneField, side: BumperSide, config: Pick<RobotConfig, 'width' | 'length'>): NumberFieldSpec {
  if (field === 'width') return { kind: 'length', min: MIN_ZONE_WIDTH, max: 36 };
  if (field === 'depth') return { kind: 'length', min: 0.25, max: 12 };
  const half = zoneSideLength(side, config) / 2;
  return { kind: 'length', min: -half, max: half };
}

/** 구역 목록: 흡입 구역 / 투입 방향 구역 (13-3, 같은 형식 · 같은 범위) */
export type ZoneList = 'intakeZones' | 'flowerDropZones';
export const ZONE_LISTS: readonly ZoneList[] = ['intakeZones', 'flowerDropZones'];
const ZONE_KEY_PREFIX: Readonly<Record<ZoneList, string>> = { intakeZones: 'zone', flowerDropZones: 'dropZone' };

/** 틀린 입력 글자 키: zone.{번호}.{칸} (투입 방향 구역은 dropZone.{번호}.{칸}) */
export const zoneFieldKey = (index: number, field: ZoneField, list: ZoneList = 'intakeZones') => `${ZONE_KEY_PREFIX[list]}.${index}.${field}`;
/** 그 목록 구역 칸의 틀린 글자 키인지 (구역 추가 / 삭제 / 프리셋으로 번호가 밀릴 때 지울 대상) */
export const isZoneFieldKey = (key: string, list: ZoneList) => key.startsWith(`${ZONE_KEY_PREFIX[list]}.`);

/** 새 구역 (구역 추가): FRONT, offset 0, 변 길이 × 1 in */
export function newIntakeZone(config: Pick<RobotConfig, 'width' | 'length'>): BumperZone {
  return { side: 'FRONT', offset: 0, width: Math.min(36, Math.max(MIN_ZONE_WIDTH, config.width)), depth: 1 };
}

// 범위 경계 비교 여유 (° ↔ rad 변환 부동소수점 오차: 45°를 입력하면 정확히 max와 같지 않을 수 있음)
const EPS = 1e-9;

// ------------------------------------------------------------
// 값 읽기 / 쓰기
// ------------------------------------------------------------

const BALLISTICS_KEYS: Readonly<Record<BallisticsFieldKey, Exclude<keyof ProfileShooterBallistics, 'sweetSpot'>>> = {
  launchHeight: 'dz',
  shooterPitch: 'shooterPitch',
  shooterOffset: 'shooterOffset',
  shooterLateralOffset: 'shooterLateralOffset',
  v0NoisePercent: 'v0NoisePercent',
  headingNoiseRad: 'headingNoiseRad',
  pitchNoiseRad: 'pitchNoiseRad',
};
const isBallisticsKey = (key: string): key is BallisticsFieldKey => key in BALLISTICS_KEYS;

// 런타임 조준 제원 1개 (주 슈터 = RobotConfig의 v1 항목, NECTAR = config.nectarShooter)의 칸 읽기 / 쓰기
type AimKey = 'shooterDelay' | 'aimTolerance' | 'turretLeft' | 'turretRight';
function readAim(aim: ShooterAimConfig, key: AimKey): number {
  if (key === 'turretLeft') return aim.turretRange[0];
  if (key === 'turretRight') return aim.turretRange[1];
  return aim[key];
}
function writeAim<T extends ShooterAimConfig>(aim: T, key: AimKey, value: number): T {
  if (key === 'turretLeft') return { ...aim, turretRange: [value, aim.turretRange[1]] };
  if (key === 'turretRight') return { ...aim, turretRange: [aim.turretRange[0], value] };
  return { ...aim, [key]: value };
}

export function readNumber(profile: RobotProfile, key: NumberFieldKey): number {
  const nectar = nectarBase(key);
  if (nectar) return isBallisticsKey(nectar) ? profile.ballistics.nectarShooter[BALLISTICS_KEYS[nectar]] : readAim(profile.config.nectarShooter, nectar as AimKey);
  if (key === 'turretLeft' || key === 'turretRight') return readAim(profile.config, key);
  if (isBallisticsKey(key)) return profile.ballistics[BALLISTICS_KEYS[key]];
  return profile.config[key as NumericConfigKey];
}

export function writeNumber(profile: RobotProfile, key: NumberFieldKey, value: number): RobotProfile {
  const nectar = nectarBase(key);
  if (nectar) {
    if (isBallisticsKey(nectar)) {
      return { ...profile, ballistics: { ...profile.ballistics, nectarShooter: { ...profile.ballistics.nectarShooter, [BALLISTICS_KEYS[nectar]]: value } } };
    }
    return { ...profile, config: { ...profile.config, nectarShooter: writeAim(profile.config.nectarShooter, nectar as AimKey, value) } };
  }
  if (isBallisticsKey(key)) return { ...profile, ballistics: { ...profile.ballistics, [BALLISTICS_KEYS[key]]: value } };
  if (key === 'turretLeft' || key === 'turretRight') return { ...profile, config: writeAim(profile.config, key, value) };
  return { ...profile, config: { ...profile.config, [key]: value } };
}

/** 그 슈터 자리의 런타임 조준 제원 (형식 / 허용 오차 / 터렛 한계) */
export function slotAim(profile: RobotProfile, slot: ShooterSlot): ShooterAimConfig {
  return slot === 'MAIN' ? profile.config : profile.config.nectarShooter;
}

/** 그 슈터 자리의 탄도 */
export function slotBallistics(profile: RobotProfile, slot: ShooterSlot): ProfileShooterBallistics {
  return slot === 'MAIN' ? profile.ballistics : profile.ballistics.nectarShooter;
}

/** 그 슈터 자리의 형식 / 터렛 범위 바꾸기 (탭의 형식 전환 / 터렛 프리셋) */
export function writeSlotAim(profile: RobotProfile, slot: ShooterSlot, patch: Partial<Pick<ShooterAimConfig, 'turretType' | 'turretRange'>>): RobotProfile {
  if (slot === 'MAIN') return { ...profile, config: { ...profile.config, ...patch } };
  return { ...profile, config: { ...profile.config, nectarShooter: { ...profile.config.nectarShooter, ...patch } } };
}

// ------------------------------------------------------------
// 슈터 구성 (13-3): NONE / POLLEN_ONLY / SHARED / PER_PIECE
// ------------------------------------------------------------

export const SHOOTER_SETUPS: readonly ShooterSetup[] = ['NONE', 'POLLEN_ONLY', 'SHARED', 'PER_PIECE'];

/** NECTAR를 흡입할 수 없으면 NONE / SHARED만 고를 수 있다 (POLLEN_ONLY · PER_PIECE는 SHARED와 같아짐) */
export function shooterSetupAllowed(setup: ShooterSetup, canIntakeNectar: boolean): boolean {
  return canIntakeNectar || setup === 'NONE' || setup === 'SHARED';
}

/** 쓰는 슈터 자리: NONE 없음, POLLEN_ONLY · SHARED 주 슈터, PER_PIECE 주 슈터 + NECTAR 슈터 (스윗스팟 검증 / 칸 검사 대상) */
export function usedShooterSlots(setup: ShooterSetup): ShooterSlot[] {
  if (setup === 'NONE') return [];
  return setup === 'PER_PIECE' ? ['MAIN', 'NECTAR'] : ['MAIN'];
}

// ------------------------------------------------------------
// 스윗스팟 (09-10a): 보관 = 기준 셀 RED_AUDIENCE 좌표, 폼 = 시나리오 진영 기준 (BLUE는 점대칭), 입력은 격자 중심으로 맞춤
// ------------------------------------------------------------

export type SweetSpotAxis = 'x' | 'y';
export const SWEET_SPOT_AXES: readonly SweetSpotAxis[] = ['x', 'y'];
export const SWEET_SPOT_SPEC: Readonly<NumberFieldSpec> = { kind: 'coordinate', min: 0, max: FIELD_SIZE };
/** 틀린 입력 글자 키: sweetSpot.x / sweetSpot.y (NECTAR 슈터 카드는 nectar.sweetSpot.x / y, 13-3) */
export const sweetSpotFieldKey = (axis: SweetSpotAxis, slot: ShooterSlot = 'MAIN') => `${slot === 'MAIN' ? '' : NECTAR_PREFIX}sweetSpot.${axis}`;

/** 진영 기준 스윗스팟 (폼 표시, LUT가 실제로 쓰는 격자 중심) */
export function readSweetSpot(profile: RobotProfile, alliance: 'RED' | 'BLUE', slot: ShooterSlot = 'MAIN'): { x: number; y: number } {
  return sweetSpotToBasis(slotBallistics(profile, slot).sweetSpot, alliance);
}

/** 진영 기준 좌표 한 축 입력 → 격자 중심으로 맞춰 기준 셀 좌표로 보관 (다른 축은 현재 값 유지) */
export function writeSweetSpot(profile: RobotProfile, alliance: 'RED' | 'BLUE', axis: SweetSpotAxis, value: number, slot: ShooterSlot = 'MAIN'): RobotProfile {
  const basis = { ...readSweetSpot(profile, alliance, slot), [axis]: value };
  const sweetSpot = sweetSpotFromBasis(basis, alliance);
  if (slot === 'MAIN') return { ...profile, ballistics: { ...profile.ballistics, sweetSpot } };
  return { ...profile, ballistics: { ...profile.ballistics, nectarShooter: { ...profile.ballistics.nectarShooter, sweetSpot } } };
}

/** 그 기물을 쏘는 슈터의 탄도 (12-3): PER_PIECE + NECTAR → NECTAR 슈터, 그 외 → 주 슈터 (엔진 shooterFor와 같은 규칙) */
export function profileShooterBallistics(profile: RobotProfile, pieceType: 'POLLEN' | 'NECTAR'): ProfileShooterBallistics {
  const b = profile.ballistics;
  return profile.config.shooterSetup === 'PER_PIECE' && pieceType === 'NECTAR' ? b.nectarShooter : b;
}

/** 슈터 1개의 탄도 → 엔진 탄도 설정 (LUT 요청 / 검증). 좌우 오프셋 0이면 계산은 v1과 같다 */
export function shooterBallisticsConfig(b: ProfileShooterBallistics): BallisticsConfig {
  return {
    dz: b.dz,
    shooterPitch: b.shooterPitch,
    shooterOffset: b.shooterOffset,
    shooterLateralOffset: b.shooterLateralOffset,
    sweetSpot: { x: b.sweetSpot.x, y: b.sweetSpot.y },
    v0NoisePercent: b.v0NoisePercent,
    headingNoiseRad: b.headingNoiseRad,
    pitchNoiseRad: b.pitchNoiseRad,
  };
}

/** 프로필 → 주 슈터의 엔진 탄도 설정 (폼 검증) */
export function profileBallisticsConfig(profile: RobotProfile): BallisticsConfig {
  return shooterBallisticsConfig(profile.ballistics);
}

/**
 * 프로필 → 확률표 생성 입력 (12-4): 발사 가능 기물마다 그 기물을 쏘는 슈터의 탄도 설정 (NONE = 빈 객체 → 생성 없이 준비 완료).
 * SHARED는 두 기물이 같은 값이라 확률표 / 캐시 키가 v1과 같다
 */
export function profileLUTShooters(profile: RobotProfile): RobotLUTShooters {
  const out: RobotLUTShooters = {};
  for (const type of PIECE_TYPES) {
    if (isPieceFireable(profile.config, type)) out[type] = shooterBallisticsConfig(profileShooterBallistics(profile, type));
  }
  return out;
}

/** 구역 하나의 칸 값 바꾸기 (구역 목록 복사). list = 흡입 구역(기본) / 투입 방향 구역 */
export function writeZone(profile: RobotProfile, index: number, patch: Partial<BumperZone>, list: ZoneList = 'intakeZones'): RobotProfile {
  const zones = profile.config[list].map((z, i) => (i === index ? { ...z, ...patch } : { ...z }));
  return { ...profile, config: { ...profile.config, [list]: zones } };
}

// ------------------------------------------------------------
// 화면 표시 / 입력 변환
// ------------------------------------------------------------

export function fieldUnit(spec: NumberFieldSpec, unit: LengthUnit): string {
  return spec.kind === 'count' ? '' : unitLabel(spec.kind, unit);
}

export function formatField(spec: NumberFieldSpec, engineValue: number, unit: LengthUnit): string {
  if (spec.kind === 'count') return formatNumber(engineValue, 0);
  return formatNumber(toDisplay(spec.kind, engineValue, unit), DISPLAY_DECIMALS[spec.kind]);
}

/** 범위 끝값 표시 (오류 설명용): 화면 값 기준 작은 쪽 → 큰 쪽 (발사구 지상고는 dz가 커질수록 h가 작아지므로 뒤집힘) */
export function displayRange(spec: NumberFieldSpec, unit: LengthUnit): [string, string] {
  const show = (v: number) => (spec.kind === 'count' ? v : toDisplay(spec.kind, v, unit));
  const [lo, hi] = show(spec.min) <= show(spec.max) ? [spec.min, spec.max] : [spec.max, spec.min];
  return [formatField(spec, lo, unit), formatField(spec, hi, unit)];
}

export type FieldError = { code: 'REQUIRED' } | { code: 'INTEGER' } | { code: 'RANGE'; min: number; max: number } | { code: 'TEAM_NUMBER' } | { code: 'TEAM_NAME' };

/** 엔진 값 범위 / 정수 검사 */
export function checkNumber(spec: NumberFieldSpec, value: number): FieldError | null {
  if (!Number.isFinite(value)) return { code: 'REQUIRED' };
  if (spec.integer && !Number.isInteger(value)) return { code: 'INTEGER' };
  if (value < spec.min - EPS || value > spec.max + EPS) return { code: 'RANGE', min: spec.min, max: spec.max };
  return null;
}

/** 입력 글자 → 엔진 값 (입력한 단위에서 한 번만 변환) 또는 오류 */
export function parseNumberField(spec: NumberFieldSpec, text: string, unit: LengthUnit): { ok: true; value: number } | { ok: false; error: FieldError } {
  const display = parseNumberInput(text);
  if (display === null) return { ok: false, error: { code: 'REQUIRED' } };
  // 정수 칸(개수 / ms)은 화면 값 = 엔진 값이라 정수 검사도 checkNumber가 함께 한다
  const value = spec.kind === 'count' ? display : fromDisplay(spec.kind, display, unit);
  const error = checkNumber(spec, value);
  return error ? { ok: false, error } : { ok: true, value };
}

export function checkText(key: TextFieldKey, text: string): FieldError | null {
  if (key === 'teamNumber') return /^\d{0,5}$/.test(text.trim()) ? null : { code: 'TEAM_NUMBER' };
  return text.trim().length <= TEAM_NAME_MAX_LENGTH ? null : { code: 'TEAM_NAME' };
}

// ------------------------------------------------------------
// 프로필 검증 / 복사
// ------------------------------------------------------------

export interface RobotIssue {
  code: string;    // 'FIELD_<key>', 'TURRET_WIDTH', 'SHOOTER_SETUP_NECTAR', 탄도 검증 코드(SWEET_SPOT_* 등)
  message: string; // 개발용 (화면 문구는 코드로 문구 사전에서)
  slot?: ShooterSlot; // 슈터 자리별 문제(터렛 폭 / 스윗스팟 검증)의 자리 (13-3). 없으면 주 슈터 또는 슈터와 무관
}

/** 프로필 전체 검증 (폼을 거치지 않은 값: 저장값 복원 / 복사 등의 안전장치) */
export function robotProfileIssues(profile: RobotProfile): RobotIssue[] {
  const issues: RobotIssue[] = [];
  const config = profile.config;
  const setup = config.shooterSetup;
  const setupValid = SHOOTER_SETUPS.includes(setup);
  if (!setupValid) issues.push({ code: 'FIELD_shooterSetup', message: 'shooterSetup' });
  // 쓰지 않는 슈터의 칸은 보관만 (13-3): NONE의 주 슈터, PER_PIECE가 아닐 때 NECTAR 슈터
  const slots = setupValid ? usedShooterSlots(setup) : (['MAIN'] as ShooterSlot[]);
  const shooterKeys = new Set<string>(SHOOTER_FIELD_KEYS);
  const checked = (key: NumberFieldKey) => {
    const nectar = nectarBase(key);
    if (nectar) return slots.includes('NECTAR');
    return !shooterKeys.has(key) || slots.includes('MAIN');
  };
  for (const key of Object.keys(NUMBER_FIELDS) as NumberFieldKey[]) {
    if (!checked(key)) continue;
    const error = checkNumber(NUMBER_FIELDS[key], readNumber(profile, key));
    if (error) issues.push({ code: `FIELD_${key}`, message: `${key}: ${error.code}` });
  }
  for (const key of ['teamNumber', 'teamName'] as const) {
    if (typeof profile[key] !== 'string' || checkText(key, profile[key])) issues.push({ code: `FIELD_${key}`, message: `${key}: invalid` });
  }
  for (const list of ZONE_LISTS) {
    const zones = config[list];
    if (!Array.isArray(zones) || zones.length > MAX_INTAKE_ZONES) {
      issues.push({ code: list === 'intakeZones' ? 'ZONE_COUNT' : 'DROP_ZONE_COUNT', message: `${list}: 0 ~ ${MAX_INTAKE_ZONES}` });
      continue;
    }
    zones.forEach((zone, i) => {
      if (!BUMPER_SIDES.includes(zone.side)) issues.push({ code: `FIELD_${zoneFieldKey(i, 'offset', list)}`, message: `${list} ${i} side` });
      else
        for (const field of ZONE_FIELDS) {
          if (checkNumber(zoneFieldSpec(field, zone.side, config), zone[field])) issues.push({ code: `FIELD_${zoneFieldKey(i, field, list)}`, message: `${list} ${i} ${field}` });
        }
    });
  }
  // 슈터 구성 (13-3): NECTAR를 흡입할 수 없는데 NECTAR를 따로 다루는 구성
  if (setupValid && !shooterSetupAllowed(setup, config.canIntakeNectar)) issues.push({ code: 'SHOOTER_SETUP_NECTAR', message: `${setup} needs canIntakeNectar` });
  // 스윗스팟 (09-10a, 13-3: 쓰는 슈터만): 칸 범위, 범위 안이고 다른 칸이 모두 올바르면 탄도 검증 (필드 밖 / HIVE / 해 없음 — 좌우 오프셋 포함)
  const spotIssues: RobotIssue[] = [];
  for (const slot of slots) {
    const sweetSpot = slotBallistics(profile, slot).sweetSpot;
    for (const axis of SWEET_SPOT_AXES) {
      if (checkNumber(SWEET_SPOT_SPEC, sweetSpot?.[axis])) spotIssues.push({ code: `FIELD_${sweetSpotFieldKey(axis, slot)}`, message: `${slot} sweetSpot.${axis}` });
    }
  }
  issues.push(...spotIssues);
  if (spotIssues.length === 0 && issues.length === 0) {
    for (const slot of slots) {
      for (const issue of validateBallisticsConfig(shooterBallisticsConfig(slotBallistics(profile, slot)), config)) {
        issues.push({ code: issue.code, message: issue.message, ...(slot === 'NECTAR' ? { slot } : {}) });
      }
    }
  }
  for (const slot of slots) {
    const aim = slotAim(profile, slot);
    const extra = slot === 'NECTAR' ? { slot } : {};
    const [left, right] = aim.turretRange;
    if (aim.turretType === 'TURRET' && Math.abs(left - right) <= EPS) issues.push({ code: 'TURRET_WIDTH', message: `${slot}: turret left and right limits must differ`, ...extra });
    if (aim.turretType !== 'FIXED' && aim.turretType !== 'TURRET') issues.push({ code: `FIELD_${slot === 'MAIN' ? '' : NECTAR_PREFIX}turretType`, message: 'turretType', ...extra });
  }
  return issues;
}

/** 터렛 프리셋 (rad): ±90° / 360° */
export const TURRET_PRESETS = {
  half: [-Math.PI / 2, Math.PI / 2] as [number, number],
  full: [-Math.PI, Math.PI] as [number, number],
};

/** COPY TO: 팀 번호 / 팀명을 뺀 전 항목(제원 · 흡입 구역 · 탄도)을 대상 로봇 프로필로 (대상 슬롯 id 유지) */
export function copyRobotProfile(source: RobotProfile, target: RobotProfile, targetId: RobotId): RobotProfile {
  return {
    teamNumber: target.teamNumber,
    teamName: target.teamName,
    config: { ...structuredClone(source.config), id: targetId, name: target.config.name },
    ballistics: structuredClone(source.ballistics),
  };
}

// ------------------------------------------------------------
// 로봇 미리보기 기하 (09-9b, 로봇 기준: fwd = 앞(+), right = 오른쪽(+), inch) — 엔진 getBumperZoneOBB와 같은 배치
// ------------------------------------------------------------

export interface PreviewRect {
  fwd: number;   // 중심 (앞 방향)
  right: number; // 중심 (오른쪽 방향)
  fwdSize: number;
  rightSize: number;
}

/** 흡입 구역 → 로봇 기준 사각형 (offset은 엔진처럼 변 위로 제한, 크기 0 이하면 null) */
export function previewZoneRect(zone: BumperZone, config: Pick<RobotConfig, 'width' | 'length'>): PreviewRect | null {
  if (!(zone.width > 0) || !(zone.depth > 0)) return null;
  const longitudinal = zone.side === 'FRONT' || zone.side === 'BACK';
  const halfSide = zoneSideLength(zone.side, config) / 2;
  const offset = Math.min(halfSide, Math.max(-halfSide, Number.isFinite(zone.offset) ? zone.offset : 0));
  const normal = (longitudinal ? config.length : config.width) / 2 + zone.depth / 2;
  const sign = zone.side === 'FRONT' || zone.side === 'RIGHT' ? 1 : -1;
  return longitudinal
    ? { fwd: sign * normal, right: offset, fwdSize: zone.depth, rightSize: zone.width }
    : { fwd: offset, right: sign * normal, fwdSize: zone.width, rightSize: zone.depth };
}

/** 사출구 위치 (로봇 기준, 앞을 조준했을 때): 앞뒤 오프셋 / 좌우 오프셋 (13-3) */
export function previewMuzzle(b: Pick<ProfileShooterBallistics, 'shooterOffset' | 'shooterLateralOffset'>): { fwd: number; right: number } {
  return { fwd: Number.isFinite(b.shooterOffset) ? b.shooterOffset : 0, right: Number.isFinite(b.shooterLateralOffset) ? b.shooterLateralOffset : 0 };
}

/** 미리보기에 그릴 슈터: 쓰는 슈터 자리마다 그 슈터가 쏘는 기물 (PER_PIECE = POLLEN 주 슈터 + NECTAR 슈터, NONE = 없음) */
export function previewShooters(profile: RobotProfile): { slot: ShooterSlot; pieces: ('POLLEN' | 'NECTAR')[]; aim: ShooterAimConfig; muzzle: { fwd: number; right: number } }[] {
  return usedShooterSlots(profile.config.shooterSetup).map(slot => ({
    slot,
    pieces: PIECE_TYPES.filter(type => isPieceFireable(profile.config, type) && (profile.config.shooterSetup !== 'PER_PIECE' || (type === 'NECTAR') === (slot === 'NECTAR'))),
    aim: slotAim(profile, slot),
    muzzle: previewMuzzle(slotBallistics(profile, slot)),
  }));
}

/** 슈터 조준 가능 범위 (로봇 앞 기준 각도, + = 오른쪽): 고정형 ± 허용 오차, 터렛 왼쪽 → 오른쪽 (왼쪽 > 오른쪽이면 뒤로 돌아 끝에 2π) */
export function previewAimSector(config: Pick<RobotConfig, 'turretType' | 'turretRange' | 'aimTolerance'>): { start: number; end: number } {
  if (config.turretType === 'FIXED') return { start: -config.aimTolerance, end: config.aimTolerance };
  const [a, b] = config.turretRange;
  return { start: a, end: a > b ? b + 2 * Math.PI : b };
}
