// 시작 자세 편집 모드 기하 (명세서 3.8 필드 편집 모드 SPAWN, 09-11b): DOM 비의존 순수 함수
// 렌더러(핸들 그리기)와 입력(끌기 판정)이 같은 계산을 쓴다. 좌표는 관중석 시점 필드 inch.
// - 회전 핸들: 로봇 앞 변 가운데에서 앞쪽으로 HANDLE_GAP만큼 떨어진 원 (반지름 HANDLE_RADIUS). 막대로 앞 변과 이어 그린다.
// - 끌기 판정: 핸들이 몸체보다 먼저 (핸들이 다른 로봇 몸체 위에 있어도 돌릴 수 있게), 나중에 그린 R2가 R1보다 먼저.

import type { RobotConfig, RobotPose } from '../core/types';

export type SpawnRobotId = 'robot1' | 'robot2';
export type SpawnPart = 'body' | 'handle';

export const HANDLE_GAP = 7;        // 앞 변 → 핸들 중심 (inch)
export const HANDLE_RADIUS = 2.2;   // 핸들 원 반지름 (inch)
const HANDLE_HIT_SLOP = 1;          // 핸들 잡기 여유 (inch)

type Size = Pick<RobotConfig, 'length' | 'width'>;
type Point = { x: number; y: number };

/** 회전 핸들 중심 (필드 좌표) */
export function spawnHandlePoint(pose: RobotPose, size: Size): Point {
  const d = size.length / 2 + HANDLE_GAP;
  return { x: pose.x + Math.cos(pose.heading) * d, y: pose.y + Math.sin(pose.heading) * d };
}

/** 점이 로봇 몸체(방향 있는 직사각형) 안인지 (경계 포함) */
export function bodyContains(pose: RobotPose, size: Size, p: Point): boolean {
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const forward = dx * c + dy * s;
  const right = -dx * s + dy * c;
  return Math.abs(forward) <= size.length / 2 + 1e-9 && Math.abs(right) <= size.width / 2 + 1e-9;
}

/** 누른 점이 잡는 로봇 / 부분 (핸들 우선, R2 우선). 없으면 null */
export function spawnHitTest(robots: Readonly<Record<SpawnRobotId, { pose: RobotPose; size: Size }>>, p: Point): { robot: SpawnRobotId; part: SpawnPart } | null {
  const order: SpawnRobotId[] = ['robot2', 'robot1'];
  for (const robot of order) {
    const h = spawnHandlePoint(robots[robot].pose, robots[robot].size);
    if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE_RADIUS + HANDLE_HIT_SLOP) return { robot, part: 'handle' };
  }
  for (const robot of order) {
    if (bodyContains(robots[robot].pose, robots[robot].size, p)) return { robot, part: 'body' };
  }
  return null;
}
