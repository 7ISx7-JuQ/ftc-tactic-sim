// 로봇 제원 탭 폼 규칙 (명세서 3.8 로봇 제원 탭, 09-9a): React / DOM 비의존
// - 로봇 프로필 = GUI 전용 팀 번호 / 팀명 + 엔진 RobotConfig (RobotConfig 타입은 수정하지 않음). 탄도(슈터 발사구 등)는 09-9b.
// - 숫자 칸: 엔진 단위로 범위 검사 (화면 표시 / 입력은 units.ts 변환). 입력 글자가 올바르면 그 칸 값만 엔진 단위로 바꿔 저장
//   (고친 칸만 변환 — 표시 반올림으로 다른 칸 값이 바뀌지 않음), 틀리면 글자를 그대로 보관하고 탭은 "설정 오류".
// - 허용 범위 (09-9 확정): 가로 / 세로 6 ~ 18 in, 최고 속도 1 ~ 200 in/s, 최대 가속도 1 ~ 2000 in/s², 최고 각속도 0.1 ~ 30 rad/s,
//   최대 각가속도 0.1 ~ 300 rad/s², 최대 적재 수 정수 1 ~ 4, 딜레이 · 준비 시간 · 투입 간격 정수 0 ~ 5000 ms,
//   허용 조준 오차 0.1 ~ 45°, 터렛 한계 −180 ~ 180° (왼쪽 ≠ 오른쪽), 팀 번호 숫자 0 ~ 5자리, 팀명 24자까지.

import type { RobotConfig } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { DISPLAY_DECIMALS, formatNumber, fromDisplay, parseNumberInput, toDisplay, unitLabel } from './units';
import type { LengthUnit, QuantityKind } from './units';

export interface RobotProfile {
  teamNumber: string; // GUI 전용 (엔진 미전달). 비우면 R1 / R2로 표시
  teamName: string;   // GUI 전용 팀명 (09-9 확정: '로봇 이름' 대신 사용자가 알아보기 쉬운 팀명)
  config: RobotConfig;
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
  | 'flowerDropDelay';
export type NumberFieldKey = NumericConfigKey | 'turretLeft' | 'turretRight';
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

export const NUMBER_FIELDS: Readonly<Record<NumberFieldKey, NumberFieldSpec>> = {
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
};

// 범위 경계 비교 여유 (° ↔ rad 변환 부동소수점 오차: 45°를 입력하면 정확히 max와 같지 않을 수 있음)
const EPS = 1e-9;

// ------------------------------------------------------------
// 값 읽기 / 쓰기
// ------------------------------------------------------------

export function readNumber(profile: RobotProfile, key: NumberFieldKey): number {
  if (key === 'turretLeft') return profile.config.turretRange[0];
  if (key === 'turretRight') return profile.config.turretRange[1];
  return profile.config[key];
}

export function writeNumber(profile: RobotProfile, key: NumberFieldKey, value: number): RobotProfile {
  const config = { ...profile.config };
  if (key === 'turretLeft') config.turretRange = [value, config.turretRange[1]];
  else if (key === 'turretRight') config.turretRange = [config.turretRange[0], value];
  else config[key] = value;
  return { ...profile, config };
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

/** 범위 끝값 표시 (오류 설명용) */
export function formatBound(spec: NumberFieldSpec, engineValue: number, unit: LengthUnit): string {
  return formatField(spec, engineValue, unit);
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
  code: string;    // 'FIELD_<key>' 또는 'TURRET_WIDTH'
  message: string; // 개발용 (화면 문구는 코드로 문구 사전에서)
}

/** 프로필 전체 검증 (폼을 거치지 않은 값: 저장값 복원 / 복사 등의 안전장치) */
export function robotProfileIssues(profile: RobotProfile): RobotIssue[] {
  const issues: RobotIssue[] = [];
  for (const key of Object.keys(NUMBER_FIELDS) as NumberFieldKey[]) {
    const error = checkNumber(NUMBER_FIELDS[key], readNumber(profile, key));
    if (error) issues.push({ code: `FIELD_${key}`, message: `${key}: ${error.code}` });
  }
  for (const key of ['teamNumber', 'teamName'] as const) {
    if (typeof profile[key] !== 'string' || checkText(key, profile[key])) issues.push({ code: `FIELD_${key}`, message: `${key}: invalid` });
  }
  const [left, right] = profile.config.turretRange;
  if (profile.config.turretType === 'TURRET' && Math.abs(left - right) <= EPS) issues.push({ code: 'TURRET_WIDTH', message: 'turret left and right limits must differ' });
  if (profile.config.turretType !== 'FIXED' && profile.config.turretType !== 'TURRET') issues.push({ code: 'FIELD_turretType', message: 'turretType' });
  return issues;
}

/** 터렛 프리셋 (rad): ±90° / 360° */
export const TURRET_PRESETS = {
  half: [-Math.PI / 2, Math.PI / 2] as [number, number],
  full: [-Math.PI, Math.PI] as [number, number],
};

/** COPY TO: 팀 번호 / 팀명을 뺀 전 항목을 대상 로봇 프로필로 (대상 슬롯 id 유지) */
export function copyRobotProfile(source: RobotProfile, target: RobotProfile, targetId: RobotId): RobotProfile {
  return {
    teamNumber: target.teamNumber,
    teamName: target.teamName,
    config: { ...structuredClone(source.config), id: targetId, name: target.config.name },
  };
}
