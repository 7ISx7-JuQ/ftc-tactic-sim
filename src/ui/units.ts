// 화면 단위 변환 / 표시 (명세서 3.8 로봇 제원 탭 단위, 09-6a)
// 엔진에는 항상 명세 단위(길이 inch, 각도 rad, 시간 ms, 편차 비율, 발사구 = dz)를 넣고, 화면 단위로는 표시할 때만 변환한다.
// - 내부 값은 항상 엔진 단위로 보관 → in / cm 토글을 반복해도 반올림이 누적되지 않는다.
// - 입력값은 입력한 단위에서 엔진 단위로 한 번만 변환한다. 길이 계열은 변환 결과를 1e-6 in 격자로 반올림해
//   cm로 같은 값을 다시 입력해도 원래 inch 값과 정확히 같아지게 한다 (예: 45.72 cm → 18 in, LUT 재생성 방지).
// - 폼은 사용자가 실제로 고친 칸만 변환해 저장한다 (고치지 않은 칸은 표시값을 되돌려 저장하지 않음).

import { HIVE_RIM_Z } from '../core/collision';
import { normalizeAngle } from '../core/kinematics';

export type LengthUnit = 'in' | 'cm';
export const LENGTH_UNITS: readonly LengthUnit[] = ['in', 'cm'];
export const DEFAULT_LENGTH_UNIT: LengthUnit = 'in';
export const CM_PER_INCH = 2.54;

// 물리량 종류 (화면 단위 / 소수 자리 / 변환 규칙이 종류로 정해짐)
export type QuantityKind =
  | 'length'        // 가로 / 세로 / 인테이크 구역 / 발사구 오프셋: in | cm
  | 'coordinate'    // 필드 좌표 (스윗스팟, 시작 자세): in | cm
  | 'launchHeight'  // 발사구 지상고 h (엔진 값은 dz = HIVE_RIM_Z − h): in | cm
  | 'speed'         // in/s | cm/s
  | 'accel'         // in/s² | cm/s²
  | 'angle'         // 터렛 범위 / 허용 조준 오차 / 발사각 / 방위 · 피치 편차: ° (엔진 rad)
  | 'heading'       // 시작 헤딩: ° (−180, 180], 0° = 필드 +x, 양수 = 관중석 시점 시계 방향 (엔진 rad)
  | 'angularRate'   // 최고 각속도: rad/s (RoadRunner / Pedro Pathing과 같은 단위)
  | 'angularAccel'  // 최대 각가속도: rad/s²
  | 'timeMs'        // 딜레이 / 준비 시간 / 투입 간격: ms
  | 'percent';      // 속도 편차: % (엔진 비율, 0.02 = 2%)

/** 화면 표시 소수 자리 (09-6a 확정: 길이 계열 2자리, 좌표 1자리, ° 1자리, rad 계열 2자리, ms 정수, % 1자리) */
export const DISPLAY_DECIMALS: Readonly<Record<QuantityKind, number>> = {
  length: 2,
  coordinate: 1,
  launchHeight: 2,
  speed: 2,
  accel: 2,
  angle: 1,
  heading: 1,
  angularRate: 2,
  angularAccel: 2,
  timeMs: 0,
  percent: 1,
};

const LENGTH_KINDS: ReadonlySet<QuantityKind> = new Set(['length', 'coordinate', 'launchHeight', 'speed', 'accel']);
const LENGTH_SNAP = 1e6; // 길이 계열 입력 변환 결과를 1e-6 in 격자로 반올림

const toDeg = (rad: number) => (rad * 180) / Math.PI;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 단위 기호 (언어 무관) */
export function unitLabel(kind: QuantityKind, lengthUnit: LengthUnit = DEFAULT_LENGTH_UNIT): string {
  switch (kind) {
    case 'length':
    case 'coordinate':
    case 'launchHeight':
      return lengthUnit;
    case 'speed':
      return `${lengthUnit}/s`;
    case 'accel':
      return `${lengthUnit}/s²`;
    case 'angle':
    case 'heading':
      return '°';
    case 'angularRate':
      return 'rad/s';
    case 'angularAccel':
      return 'rad/s²';
    case 'timeMs':
      return 'ms';
    case 'percent':
      return '%';
  }
}

/** 엔진 값 → 화면 값 (반올림 없음, 표시 반올림은 formatQuantity) */
export function toDisplay(kind: QuantityKind, engineValue: number, lengthUnit: LengthUnit = DEFAULT_LENGTH_UNIT): number {
  const scale = lengthUnit === 'cm' ? CM_PER_INCH : 1;
  switch (kind) {
    case 'launchHeight':
      return (HIVE_RIM_Z - engineValue) * scale;
    case 'length':
    case 'coordinate':
    case 'speed':
    case 'accel':
      return engineValue * scale;
    case 'angle':
      return toDeg(engineValue);
    case 'heading': {
      const deg = toDeg(normalizeAngle(engineValue));
      return deg <= -180 ? deg + 360 : deg; // (−180, 180]
    }
    case 'percent':
      return engineValue * 100;
    case 'angularRate':
    case 'angularAccel':
    case 'timeMs':
      return engineValue;
  }
}

/** 화면 입력값 → 엔진 값 (입력 단위에서 한 번만 변환, 길이 계열은 1e-6 in 격자로 반올림) */
export function fromDisplay(kind: QuantityKind, displayValue: number, lengthUnit: LengthUnit = DEFAULT_LENGTH_UNIT): number {
  if (LENGTH_KINDS.has(kind)) {
    const inches = Math.round((displayValue / (lengthUnit === 'cm' ? CM_PER_INCH : 1)) * LENGTH_SNAP) / LENGTH_SNAP;
    const value = kind === 'launchHeight' ? HIVE_RIM_Z - inches : inches;
    return Object.is(value, -0) ? 0 : value;
  }
  switch (kind) {
    case 'angle':
      return toRad(displayValue);
    case 'heading':
      return normalizeAngle(toRad(displayValue));
    case 'percent':
      return displayValue / 100;
    default:
      return displayValue;
  }
}

/** 숫자 → 고정 소수 자리 문자열 (−0 → 0, 비유한값 → '—') */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(Math.max(0, Math.floor(decimals)));
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** 엔진 값 → 화면 표시 문자열 (단위 기호 없이) */
export function formatQuantityValue(kind: QuantityKind, engineValue: number, lengthUnit: LengthUnit = DEFAULT_LENGTH_UNIT): string {
  return formatNumber(toDisplay(kind, engineValue, lengthUnit), DISPLAY_DECIMALS[kind]);
}

/** 엔진 값 → 화면 표시 문자열 (단위 기호 포함, ° / %는 붙여 씀) */
export function formatQuantity(kind: QuantityKind, engineValue: number, lengthUnit: LengthUnit = DEFAULT_LENGTH_UNIT): string {
  const unit = unitLabel(kind, lengthUnit);
  const value = formatQuantityValue(kind, engineValue, lengthUnit);
  return unit === '°' || unit === '%' ? `${value}${unit}` : `${value} ${unit}`;
}

/**
 * 입력칸 문자열 → 숫자 (앞뒤 공백 허용, 소수점 '.' 또는 ',', 부호 / 지수 허용). 빈 칸이나 숫자가 아니면 null.
 * 범위 검사는 폼 / 엔진 검증 함수가 맡는다.
 */
export function parseNumberInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** 길이 단위 문자열 검증 (저장된 값 복원 등): 알 수 없으면 inch */
export function toLengthUnit(value: unknown): LengthUnit {
  return LENGTH_UNITS.includes(value as LengthUnit) ? (value as LengthUnit) : DEFAULT_LENGTH_UNIT;
}

// ------------------------------------------------------------
// 경기 시간 표시 (좌측 패널 타이머)
// ------------------------------------------------------------

export const ENDGAME_REMAINING_SEC = 60;       // 이하부터 ENDGAME 색
export const TIMER_TENTHS_AT_OR_BELOW_SEC = 10; // 이하면 소수 1자리 (0:09.4)
const TIMER_EPSILON = 1e-6;                     // 틱 × 0.02 부동소수점 오차 흡수 (예: 9.980000000000004)

/**
 * 남은 시간(초) → 타이머 문자열. 두 구간 모두 올림이라 표시가 건너뛰지 않는다:
 * 10초 초과 M:SS (2:00 → 1:59 … 0:11), 10초 이하 M:SS.s (0:10.0 → 0:09.9 … 0:00.1 → 종료 0:00.0).
 */
export function formatMatchTime(remainingSec: number): string {
  const sec = Math.max(0, Number.isFinite(remainingSec) ? remainingSec : 0);
  if (sec > TIMER_TENTHS_AT_OR_BELOW_SEC + TIMER_EPSILON) {
    const whole = Math.ceil(sec - TIMER_EPSILON);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  const tenths = Math.max(0, Math.ceil(sec * 10 - TIMER_EPSILON));
  return `0:${String(Math.floor(tenths / 10)).padStart(2, '0')}.${tenths % 10}`;
}

/** 남은 시간이 ENDGAME(60초 이하)인지 (타이머 색) */
export function isEndgameTime(remainingSec: number): boolean {
  return remainingSec <= ENDGAME_REMAINING_SEC;
}
