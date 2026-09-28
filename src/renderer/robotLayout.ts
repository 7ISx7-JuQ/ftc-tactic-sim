// 로봇 표시 배치 (명세서 3.7 로봇, 08-4). DOM 비의존 순수 함수
// 로봇 기준 좌표: forward = 로봇 앞쪽(+) 거리, right = 로봇 오른쪽(+) 거리 (inch)

import type { RobotState } from '../core/types';

// 1. 행동 상태 배지
// 이미지 자산 키 (src/assets/badges/{key}.svg | .png, 사용자 제공). IDLE / INTAKING은 배지 없음 (흡입은 인테이크 구역 강조로 표시)
export type BadgeKey = 'shooting' | 'lift-up' | 'lift-ready' | 'lift-drop' | 'lift-down';

const BADGE_BY_STATE: Partial<Record<RobotState['actionState'], BadgeKey>> = {
  SHOOTING: 'shooting',
  FLOWER_SETUP: 'lift-up',
  FLOWER_READY: 'lift-ready',
  FLOWER_DROPPING: 'lift-drop',
  FLOWER_LOWERING: 'lift-down',
};

// 이미지 자산이 없을 때 대신 그리는 글자 배지
export const BADGE_FALLBACK_TEXT: Readonly<Record<BadgeKey, string>> = {
  shooting: 'SHOOT',
  'lift-up': 'LIFT ▲',
  'lift-ready': 'READY',
  'lift-drop': 'DROP',
  'lift-down': 'LIFT ▼',
};

export interface RobotBadge {
  key: BadgeKey;
  alpha: number; // 제동 중(정지 대기, 타이머 미차감) 0.5, 그 외 1
}

export function robotBadge(robot: Pick<RobotState, 'actionState' | 'isBraking'>): RobotBadge | null {
  const key = BADGE_BY_STATE[robot.actionState];
  if (!key) return null;
  return { key, alpha: robot.isBraking ? 0.5 : 1 };
}

export const BADGE_SIZE_INCH = 6; // 필드 표시 크기 (배율 1에서 30 논리 px)

// 2. 몸체 안 배치: 앞에서부터 헤딩 화살표 → 적재물 받침(FIFO 줄) → 번호 라벨. 모두 몸체 길이 L의 비율이라 크기와 무관하게 겹치지 않음
// 로봇 기준 좌표: forward = 로봇 앞쪽(+) 거리, right = 로봇 오른쪽(+) 거리 (inch)
export interface LocalPoint {
  forward: number;
  right: number;
}

const ARROW_TIP = 0.45;          // 화살표 끝 (× L, 앞 범퍼 0.5L 안쪽)
const ARROW_BASE = 0.32;         // 화살표 밑변
const ARROW_HALF_WIDTH = 0.1;
const TRAY_FRONT = 0.29;         // 적재물 받침 앞 끝 (화살표 밑변 뒤)
const TRAY_BACK = -0.21;         // 적재물 받침 뒤 끝
const LABEL_FORWARD = -0.34;     // 번호 라벨 중심 (받침 뒤)
const TRAY_SLOTS = 4;            // 룰상 적재 상한
const PIECE_RADIUS_MAX = 1.2;    // 적재물 원 반지름 상한 (inch)
const PIECE_FILL_RATIO = 0.42;   // 원 반지름 / 칸 간격
const TRAY_SIDE_MARGIN = 0.4;    // 받침 좌우 여백 (inch)

const len = (length: number) => Math.max(0, length);

/** 헤딩 화살표 삼각형 [끝, 오른쪽 밑, 왼쪽 밑] */
export function headingArrow(length: number): LocalPoint[] {
  const L = len(length);
  return [
    { forward: ARROW_TIP * L, right: 0 },
    { forward: ARROW_BASE * L, right: ARROW_HALF_WIDTH * L },
    { forward: ARROW_BASE * L, right: -ARROW_HALF_WIDTH * L },
  ];
}

// 칸 간격: 받침 길이를 4칸으로
function carriedPiecePitch(length: number): number {
  return ((TRAY_FRONT - TRAY_BACK) * len(length)) / TRAY_SLOTS;
}

/** 적재물 원 반지름 (크기 통일, 칸 간격에 맞춰 겹치지 않음) */
export function carriedPieceRadius(length: number): number {
  return Math.min(PIECE_RADIUS_MAX, carriedPiecePitch(length) * PIECE_FILL_RATIO);
}

/** 적재물 i번(0 = 다음에 나갈 기물)의 로봇 기준 위치: 받침 앞쪽 칸부터 */
export function carriedPieceSlots(length: number, count: number): LocalPoint[] {
  const pitch = carriedPiecePitch(length);
  const first = TRAY_FRONT * len(length) - pitch / 2;
  return Array.from({ length: Math.min(TRAY_SLOTS, Math.max(0, count)) }, (_, i) => ({ forward: first - i * pitch, right: 0 }));
}

/** 적재물 받침 (밝은 바탕: 몸체와 같은 진영색 NECTAR도 보이게) — 앞 / 뒤 끝과 반폭 */
export function carriedTray(length: number): { front: number; back: number; halfWidth: number } {
  return { front: TRAY_FRONT * len(length), back: TRAY_BACK * len(length), halfWidth: carriedPieceRadius(length) + TRAY_SIDE_MARGIN };
}

/** 번호 라벨 위치: 몸체 뒤쪽 (받침 뒤) */
export function robotLabelOffset(length: number): LocalPoint {
  return { forward: LABEL_FORWARD * len(length), right: 0 };
}

/** 로봇 기준 위치 → 필드 좌표 */
export function localToField(
  robot: Pick<RobotState, 'x' | 'y' | 'heading'>,
  p: LocalPoint,
): { x: number; y: number } {
  const c = Math.cos(robot.heading);
  const s = Math.sin(robot.heading);
  // 앞 = (cos, sin), 오른쪽 = (−sin, cos) (캔버스 y-down)
  return { x: robot.x + p.forward * c - p.right * s, y: robot.y + p.forward * s + p.right * c };
}

/** 차체 외접원 반지름 (배지를 몸체 밖에 두기 위한 거리) */
export function robotCircumradius(length: number, width: number): number {
  return Math.hypot(Math.max(0, length), Math.max(0, width)) / 2;
}
