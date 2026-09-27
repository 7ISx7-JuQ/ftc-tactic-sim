// 탄도 계산 모듈 (명세서 2.6.2, Step 06-2)
// 공기 저항 / 공 회전을 무시한 진공 포물선. 모든 궤적은 "지면 직선 + 높이 함수"로 표현한다.
//   수평 이동 거리 d에서 높이 z(d) = z0 + d·tanθ − g·d² / (2·v0²·cos²θ), 시간 t(d) = d / (v0·cosθ)
// 좌표계: 필드 (x, y) inch, 높이 z inch (바닥 z = 0)
// ※ 몬테카를로 LUT 생성(06-3)과 LUT 판정 함수(06-4)는 이 파일에 이어서 추가 예정

import { GRAVITY, HIVE_AABB, HIVE_HEIGHT, hiveCellAimPoint, HIVE_RIM_Z } from './collision';
import type { BallisticsConfig } from './types';

// 부동소수점 오차 허용 범위
const EPSILON = 1e-9;

// ============================================================
// 1. 타입
// ============================================================

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

/** 명목 발사 궤적: 발사구 위치 + 수평 방향 + 사출 속도 / 발사각 */
export interface Trajectory {
  x: number;      // 발사구 x (inch)
  y: number;      // 발사구 y (inch)
  z: number;      // 발사구 높이 (inch)
  heading: number; // 수평 발사 방향 (rad, 필드 기준 atan2(dy, dx))
  v0: number;     // 사출 속도 (inch/s, > 0)
  pitch: number;  // 발사각 (rad, (-π/2, π/2))
}

/** 궤적 위의 한 지점 (지면 직선 거리 기준) */
export interface TrajectoryPoint extends Vector3D {
  distance: number; // 발사구로부터의 수평 거리 (inch)
  time: number;     // 발사 후 경과 시간 (초)
}

/** HIVE 직육면체 충돌 지점 (SIDE: 옆면 진입, TOP: 윗면으로 낙하) */
export interface HiveBoxHit extends TrajectoryPoint {
  face: 'SIDE' | 'TOP';
}

// ============================================================
// 2. 발사구 / 조준
// ============================================================

/** 발사구 높이: 림 높이(53.5) − dz */
export function launchHeight(config: Pick<BallisticsConfig, 'dz'>): number {
  return HIVE_RIM_Z - config.dz;
}

/** 필드 기준 방위각 (rad): from → to */
export function bearingTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

/**
 * 발사구 위치: 로봇 중심에서 조준 방향으로 shooterOffset만큼 이동한 점, 높이는 launchHeight
 * (터렛 회전축은 차체 중심으로 가정 → 고정형 / 터렛형 공통)
 */
export function launchPoint(
  robotX: number,
  robotY: number,
  aimHeading: number,
  config: Pick<BallisticsConfig, 'dz' | 'shooterOffset'>,
): Vector3D {
  return {
    x: robotX + config.shooterOffset * Math.cos(aimHeading),
    y: robotY + config.shooterOffset * Math.sin(aimHeading),
    z: launchHeight(config),
  };
}

// ============================================================
// 3. 닫힌 해
// ============================================================

// 궤적이 유효한지 (양의 사출 속도, 수평 성분이 있는 발사각)
function isValidLaunch(v0: number, pitch: number): boolean {
  return Number.isFinite(v0) && v0 > 0 && Number.isFinite(pitch) && Math.cos(pitch) > EPSILON;
}

/**
 * 사출 속도 v0 닫힌 해: 수평 거리 D, 높이차 Δz(목표 − 발사구), 발사각 θ로 목표점을 지나는 v0
 *   v0 = D / cosθ · √( g / (2·(D·tanθ − Δz)) )
 * 해가 없으면 (D ≤ 0, cosθ ≤ 0, D·tanθ ≤ Δz) null
 */
export function solveLaunchSpeed(distance: number, heightDiff: number, pitch: number): number | null {
  if (!Number.isFinite(distance) || !Number.isFinite(heightDiff) || !Number.isFinite(pitch)) return null;
  const cos = Math.cos(pitch);
  if (distance <= EPSILON || cos <= EPSILON) return null;
  const rise = distance * Math.tan(pitch) - heightDiff;
  if (rise <= EPSILON) return null;
  return (distance / cos) * Math.sqrt(GRAVITY / (2 * rise));
}

/**
 * 조준점을 향한 명목 궤적의 닫힌 해 v0: 로봇 중심 (robotX, robotY)에서 목표점을 정면 조준
 * 해가 없으면 null
 */
export function solveAimLaunchSpeed(
  robotX: number,
  robotY: number,
  target: Vector3D,
  config: Pick<BallisticsConfig, 'dz' | 'shooterOffset' | 'shooterPitch'>,
): number | null {
  const heading = bearingTo(robotX, robotY, target.x, target.y);
  const origin = launchPoint(robotX, robotY, heading, config);
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  return solveLaunchSpeed(distance, target.z - origin.z, config.shooterPitch);
}

/**
 * 스윗스팟 v0 초기값: 스윗스팟에서 기준 셀 RED_AUDIENCE 조준점을 향한 닫힌 해 (06-3 v0 탐색의 출발점)
 * 해가 없으면 null (스윗스팟 검증 실패)
 */
export function sweetSpotLaunchSpeed(config: BallisticsConfig): number | null {
  return solveAimLaunchSpeed(config.sweetSpot.x, config.sweetSpot.y, hiveCellAimPoint('RED', 'AUDIENCE_CELL'), config);
}

/** 조준점을 향한 명목 궤적 생성 (로봇 중심에서 정면 조준, 사출 속도 v0) */
export function createAimTrajectory(
  robotX: number,
  robotY: number,
  target: Pick<Vector3D, 'x' | 'y'>,
  v0: number,
  config: Pick<BallisticsConfig, 'dz' | 'shooterOffset' | 'shooterPitch'>,
): Trajectory {
  const heading = bearingTo(robotX, robotY, target.x, target.y);
  const origin = launchPoint(robotX, robotY, heading, config);
  return { ...origin, heading, v0, pitch: config.shooterPitch };
}

// ============================================================
// 4. 궤적 조회
// ============================================================

/** 수평 거리 d에서의 공 중심 높이 */
export function heightAtDistance(traj: Trajectory, distance: number): number {
  const vh = traj.v0 * Math.cos(traj.pitch);
  return traj.z + distance * Math.tan(traj.pitch) - (GRAVITY * distance * distance) / (2 * vh * vh);
}

/** 수평 거리 d까지의 비행 시간 T = d / (v0·cosθ) */
export function timeAtDistance(traj: Trajectory, distance: number): number {
  return distance / (traj.v0 * Math.cos(traj.pitch));
}

/** 수평 거리 d의 궤적 위 지점 */
export function pointAtDistance(traj: Trajectory, distance: number): TrajectoryPoint {
  return {
    x: traj.x + distance * Math.cos(traj.heading),
    y: traj.y + distance * Math.sin(traj.heading),
    z: heightAtDistance(traj, distance),
    distance,
    time: timeAtDistance(traj, distance),
  };
}

/**
 * 공 중심이 높이 targetZ에 "내려오며" 도달하는 수평 거리 (포물선의 큰 근)
 * 궤적이 targetZ에 닿지 않으면 null. 발사구가 이미 targetZ 아래면 올라가며 지나는 지점은 무시하고 하강 지점만 반환
 */
export function descendingDistanceAtHeight(traj: Trajectory, targetZ: number): number | null {
  if (!isValidLaunch(traj.v0, traj.pitch) || !Number.isFinite(targetZ)) return null;
  const vh = traj.v0 * Math.cos(traj.pitch);
  // a·d² + b·d + c = 0, a < 0
  const a = -GRAVITY / (2 * vh * vh);
  const b = Math.tan(traj.pitch);
  const c = traj.z - targetZ;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const d = (-b - Math.sqrt(disc)) / (2 * a); // a < 0이므로 큰 근
  return d >= 0 ? d : null;
}

/**
 * 사거리 R: 공 중심 높이가 pieceRadius(바닥에 닿는 순간)가 되는 수평 거리 (필드 경계 무시)
 * 발사구가 바닥보다 낮은 등 해가 없으면 null
 */
export function landingDistance(traj: Trajectory, pieceRadius: number): number | null {
  return descendingDistanceAtHeight(traj, pieceRadius);
}

/** 바닥 착지 지점 (사거리 R, 필드 경계 무시) */
export function landingPoint(traj: Trajectory, pieceRadius: number): TrajectoryPoint | null {
  const d = landingDistance(traj, pieceRadius);
  return d === null ? null : pointAtDistance(traj, d);
}

// ============================================================
// 5. HIVE 직육면체 교차 (빗맞음 비행 판정, 명세서 2.2 / 2.6.2)
// ============================================================

/**
 * 궤적이 HIVE 직육면체(밑면 HIVE_AABB, 높이 HIVE_HEIGHT)에 처음 부딪히는 지점
 * - 공 표면 기준: 직육면체를 기물 반지름만큼 확장 (xy 경계 ± r, 높이 HIVE_HEIGHT + r)하고 공 중심으로 판정
 * - 지면 직선이 확장 AABB 안에 있는 구간 [dIn, dOut]에서 공 중심 높이가 확장 높이 이하인 첫 지점:
 *   진입 순간 이미 낮으면 SIDE (옆면), 위로 들어와 구간 안에서 내려오면 TOP (윗면 낙하)
 * - 착지(사거리 R) 이후 구간은 보지 않음. 부딪히지 않으면 (넘어가거나 닿지 않음) null
 */
export function intersectHiveBox(traj: Trajectory, pieceRadius = 0): HiveBoxHit | null {
  if (!isValidLaunch(traj.v0, traj.pitch)) return null;
  const r = Math.max(0, pieceRadius);
  const maxDistance = landingDistance(traj, r);
  if (maxDistance === null) return null;

  const box = {
    minX: HIVE_AABB.minX - r,
    maxX: HIVE_AABB.maxX + r,
    minY: HIVE_AABB.minY - r,
    maxY: HIVE_AABB.maxY + r,
  };
  const topZ = HIVE_HEIGHT + r;

  // 슬랩 방식: 지면 직선 p(d) = (x, y) + d·(cos, sin)이 확장 AABB 안에 있는 d 구간
  const dirs = [Math.cos(traj.heading), Math.sin(traj.heading)];
  const origin = [traj.x, traj.y];
  const mins = [box.minX, box.minY];
  const maxs = [box.maxX, box.maxY];
  let dIn = 0;
  let dOut = maxDistance;
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(dirs[axis]) < EPSILON) {
      // 이 축으로 이동하지 않음: 시작 좌표가 범위 밖이면 교차 없음
      if (origin[axis] < mins[axis] || origin[axis] > maxs[axis]) return null;
      continue;
    }
    let t1 = (mins[axis] - origin[axis]) / dirs[axis];
    let t2 = (maxs[axis] - origin[axis]) / dirs[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    dIn = Math.max(dIn, t1);
    dOut = Math.min(dOut, t2);
    if (dIn > dOut) return null;
  }

  // 진입 순간 이미 윗면 높이 이하 → 옆면 충돌 (발사구가 박스 안이면 d = 0)
  if (heightAtDistance(traj, dIn) <= topZ) return { ...pointAtDistance(traj, dIn), face: 'SIDE' };

  // 윗면 위로 진입: 포물선이 구간 안에서 윗면 높이로 내려오면 윗면 낙하
  const dTop = descendingDistanceAtHeight(traj, topZ);
  if (dTop !== null && dTop >= dIn && dTop <= dOut) return { ...pointAtDistance(traj, dTop), face: 'TOP' };

  return null; // HIVE를 넘어감
}
