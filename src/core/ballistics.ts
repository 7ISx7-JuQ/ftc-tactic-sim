// 탄도 계산 모듈 (명세서 2.6.2, Step 06-2)
// 공기 저항 / 공 회전을 무시한 진공 포물선. 모든 궤적은 "지면 직선 + 높이 함수"로 표현한다.
//   수평 이동 거리 d에서 높이 z(d) = z0 + d·tanθ − g·d² / (2·v0²·cos²θ), 시간 t(d) = d / (v0·cosθ)
// 좌표계: 필드 (x, y) inch, 높이 z inch (바닥 z = 0)

import {
  FIELD_SIZE,
  GRAVITY,
  HIVE_AABB,
  HIVE_CELL_TILT,
  HIVE_CENTER_X,
  HIVE_HEIGHT,
  HIVE_OPENING_HEIGHT,
  HIVE_OPENING_RECT_HEIGHT,
  HIVE_OPENING_WIDTH,
  HIVE_RIM_Y,
  HIVE_RIM_Z,
  PIECE_PHYSICS,
  hiveCellAimPoint,
  sampleNormal,
  testOBBvsAABB,
  testOBBvsFieldBounds,
} from './collision';
import type { OBB } from './collision';
import { angleDifference, normalizeAngle } from './kinematics';
import type {
  BallisticsConfig,
  FlightSegment,
  GamePiece,
  HeatmapLUT,
  HeatmapLUTSet,
  HiveCellKey,
  MatchHeatmapLUTs,
  RobotConfig,
  RobotHeatmapLUTs,
  ShooterBallistics,
  ShotProbabilityResolver,
} from './types';

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

// ============================================================
// 6. 몬테카를로 명중 판정 (LUT 생성 전용, 명세서 2.6.2)
// ============================================================

type PieceType = GamePiece['type'];
type HiveCell = 'AUDIENCE_CELL' | 'OPPOSITE_CELL';

export const PIECE_TYPES: readonly PieceType[] = ['POLLEN', 'NECTAR'];

// 샘플 편차 기본값 (BallisticsConfig 미지정 시)
export const DEFAULT_V0_NOISE_PERCENT = 0.02;
export const DEFAULT_HEADING_NOISE_RAD = 0.02;
export const DEFAULT_PITCH_NOISE_RAD = 0.006;

/**
 * 궤적이 셀 투입구로 들어가는지 (몬테카를로 샘플 1개의 명중 판정)
 * ① 공 중심이 투입구 평면을 앞면에서 통과 (통과 순간 속도 · 바깥 법선 < 0)
 * ② 통과점이 오각형을 기물 반지름만큼 안쪽으로 줄인 영역 내부 (공 전체가 들어감)
 * ③ 통과 전 공이 림 아래 벽(단면: 림 y ~ HIVE 앞면 y, 림 z 이하)과 반지름 이상 떨어져 있음 (림 모서리 / 벽에 걸리지 않음)
 * ④ 통과 전 공이 HIVE 직육면체(반지름만큼 확장)에 처음 들어오는 곳이 셀 앞면(셀 폭 안) 또는 셀 위 윗면
 *    (HIVE 옆면 / 뒷면 / 셀 옆 프레임을 뚫고 오는 궤적 차단)
 */
export function isShotInHiveCell(
  traj: Trajectory,
  alliance: 'RED' | 'BLUE',
  cell: HiveCell,
  pieceRadius: number,
): boolean {
  if (!isValidLaunch(traj.v0, traj.pitch)) return false;
  const r = Math.max(0, pieceRadius);
  const inward = cell === 'OPPOSITE_CELL' ? 1 : -1; // 림에서 HIVE 중심 방향 (y)
  const sinT = Math.sin(HIVE_CELL_TILT);
  const cosT = Math.cos(HIVE_CELL_TILT);
  const ny = -inward * sinT; // 바깥 법선 (0, ny, nz)
  const nz = cosT;
  const rimY = HIVE_RIM_Y[cell];

  const vh = traj.v0 * Math.cos(traj.pitch);
  const vx = vh * Math.cos(traj.heading);
  const vy = vh * Math.sin(traj.heading);
  const vz = traj.v0 * Math.sin(traj.pitch);

  // 평면까지의 부호 거리 f(t) = a·t² + b·t + c (a < 0): 앞면 → 뒷면 통과는 큰 근 (f' < 0)
  const a = -0.5 * GRAVITY * nz;
  const b = ny * vy + nz * vz;
  const c = ny * (traj.y - rimY) + nz * (traj.z - HIVE_RIM_Z);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (!(t > 0)) return false;

  // ② 통과점의 투입구 표면 좌표: s = 림 기준 표면 거리, u = 셀 중심선 기준 좌우
  const zCross = traj.z + vz * t - 0.5 * GRAVITY * t * t;
  const s = (zCross - HIVE_RIM_Z) / sinT;
  const u = traj.x + vx * t - HIVE_CENTER_X[alliance];
  if (!isInsideInsetOpening(u, s, r)) return false;

  // ③ 림 아래 벽 여유
  if (!clearsRimWall(traj, vy, vz, t, cell, r)) return false;

  // ④ HIVE 직육면체 진입 면
  return entersThroughCellWindow(traj, vx, vy, vz, t, alliance, cell, r);
}

const GOLDEN_ITERATIONS = 60;

/**
 * 림 아래 벽과의 여유: y–z 단면에서 벽 R = [림 y, HIVE 앞면 y] × (−∞, 림 z]를 반지름 r만큼 넓힌 영역
 * (옆 띠 y ∈ [wLo − r, wHi + r]·z < 림 z, 윗면 띠 y ∈ [wLo, wHi]·z < 림 z + r, 윗모서리 원 2개)에
 * 통과 시각 이전의 공 중심 경로가 들어가지 않아야 한다. 벽은 셀 폭 방향(x)으로 이어져 있다고 본다 (셀 폭 밖은 ④가 차단).
 * - 띠: 공 높이는 시간에 대해 오목 → 구간 양 끝에서 최소이므로 끝점 검사로 정확
 * - 모서리: 경로 곡률 반경(수백 in)이 r보다 훨씬 커서 거리 함수가 단봉 → 황금분할 탐색
 */
function clearsRimWall(traj: Trajectory, vy: number, vz: number, tCross: number, cell: HiveCell, r: number): boolean {
  const rimY = HIVE_RIM_Y[cell];
  const faceY = cell === 'AUDIENCE_CELL' ? HIVE_AABB.maxY : HIVE_AABB.minY;
  const wLo = Math.min(rimY, faceY);
  const wHi = Math.max(rimY, faceY);
  const zAt = (time: number) => traj.z + vz * time - 0.5 * GRAVITY * time * time;
  const yAt = (time: number) => traj.y + vy * time;
  // y ∈ [lo, hi]인 시각 구간 ∩ [0, tCross]
  const timesInY = (lo: number, hi: number): [number, number] | null => {
    if (Math.abs(vy) < EPSILON) return traj.y >= lo && traj.y <= hi ? [0, tCross] : null;
    const a = (lo - traj.y) / vy;
    const b = (hi - traj.y) / vy;
    const t1 = Math.max(0, Math.min(a, b));
    const t2 = Math.min(tCross, Math.max(a, b));
    return t1 <= t2 ? [t1, t2] : null;
  };
  const minZ = (span: [number, number]) => Math.min(zAt(span[0]), zAt(span[1]));

  const side = timesInY(wLo - r, wHi + r);
  if (side && minZ(side) < HIVE_RIM_Z) return false;
  const top = timesInY(wLo, wHi);
  if (top && minZ(top) < HIVE_RIM_Z + r) return false;

  for (const cy of [wLo, wHi]) {
    const span = timesInY(cy - r, cy + r);
    if (!span) continue;
    const distSq = (time: number) => (yAt(time) - cy) ** 2 + (zAt(time) - HIVE_RIM_Z) ** 2;
    let lo = span[0];
    let hi = span[1];
    if (Math.abs(vy) < EPSILON) {
      // y 고정: 높이 오프셋 |z − 림 z|의 최소 (오목한 z가 림 z를 지나면 0)
      const tPeak = Math.min(hi, Math.max(lo, vz / GRAVITY));
      const zs = [zAt(lo), zAt(hi), zAt(tPeak)];
      const zMin = Math.min(...zs);
      const zMax = Math.max(...zs);
      const dz = zMin <= HIVE_RIM_Z && HIVE_RIM_Z <= zMax ? 0 : Math.min(...zs.map(z => Math.abs(z - HIVE_RIM_Z)));
      if ((traj.y - cy) ** 2 + dz * dz < r * r) return false;
      continue;
    }
    // 황금분할 탐색으로 최소 거리 시각
    const phi = (Math.sqrt(5) - 1) / 2;
    let m1 = hi - phi * (hi - lo);
    let m2 = lo + phi * (hi - lo);
    let f1 = distSq(m1);
    let f2 = distSq(m2);
    for (let i = 0; i < GOLDEN_ITERATIONS; i++) {
      if (f1 <= f2) {
        hi = m2;
        m2 = m1;
        f2 = f1;
        m1 = hi - phi * (hi - lo);
        f1 = distSq(m1);
      } else {
        lo = m1;
        m1 = m2;
        f1 = f2;
        m2 = lo + phi * (hi - lo);
        f2 = distSq(m2);
      }
    }
    if (Math.min(f1, f2, distSq(span[0]), distSq(span[1])) < r * r) return false;
  }
  return true;
}

/**
 * 공 중심이 투입구 통과 시각 tCross 이전에 HIVE 직육면체(xy ± r, 높이 HIVE_HEIGHT + r)에 처음 들어오는 곳이
 * (a) 셀 앞면: 앞면(AUDIENCE y = maxY + r, OPPOSITE y = minY − r), 셀 폭 안(x ∈ 셀 범위 ± r 안쪽)
 *     (앞면의 림 아래 부분에 대한 충돌은 ③ 림 아래 벽 여유가 정확히 판정)
 * (b) 셀 위 윗면: z = HIVE_HEIGHT + r, 셀 폭 안, 꼭짓점보다 앞쪽(투입구 앞 공간)
 * 중 하나인지. 통과점은 항상 직육면체 안이므로 진입은 반드시 존재하고, xy 이동이 직선이라 진입점과 통과점이 모두
 * 셀 폭 안이면 그 사이 경로도 셀 폭 안이다.
 */
function entersThroughCellWindow(
  traj: Trajectory,
  vx: number,
  vy: number,
  vz: number,
  tCross: number,
  alliance: 'RED' | 'BLUE',
  cell: HiveCell,
  r: number,
): boolean {
  const inward = cell === 'OPPOSITE_CELL' ? 1 : -1;
  const half = HIVE_OPENING_WIDTH / 2;
  const windowMinX = HIVE_CENTER_X[alliance] - half + r;
  const windowMaxX = HIVE_CENTER_X[alliance] + half - r;
  const inWindowX = (x: number) => x >= windowMinX && x <= windowMaxX;
  const topZ = HIVE_HEIGHT + r;
  const rimY = HIVE_RIM_Y[cell];
  const apexY = rimY + inward * HIVE_OPENING_HEIGHT * Math.cos(HIVE_CELL_TILT);
  const zAt = (time: number) => traj.z + vz * time - 0.5 * GRAVITY * time * time;

  // 지면 투영이 확장 AABB 안에 들어오는 시각 (슬랩 방식). 통과 시각에는 반드시 안쪽
  const slabs: [number, number, number, number][] = [
    [traj.x, vx, HIVE_AABB.minX - r, HIVE_AABB.maxX + r],
    [traj.y, vy, HIVE_AABB.minY - r, HIVE_AABB.maxY + r],
  ];
  let tIn = 0;
  let enterAxis = -1; // 0 = x 면, 1 = y 면, -1 = 발사구가 이미 지면 투영 안
  slabs.forEach(([p0, v, lo, hi], axis) => {
    if (Math.abs(v) < EPSILON) return; // 이 축으로 움직이지 않음: 통과점이 안쪽이므로 항상 안쪽
    const t1 = Math.min((lo - p0) / v, (hi - p0) / v);
    if (t1 > tIn) {
      tIn = t1;
      enterAxis = axis;
    }
  });

  if (tIn > tCross + EPSILON) return false; // 이론상 불가능 (통과점은 박스 안): 수치 안전장치

  if (zAt(tIn) > topZ) {
    // (b) 윗면 위로 들어와 내려옴: 윗면 높이로 내려오는 시각(큰 근)의 위치
    const disc = vz * vz - 2 * GRAVITY * (topZ - traj.z);
    if (disc < 0) return false;
    const tTop = (vz + Math.sqrt(disc)) / GRAVITY;
    if (tTop > tCross + EPSILON) return false;
    const xTop = traj.x + vx * tTop;
    const yTop = traj.y + vy * tTop;
    return inWindowX(xTop) && inward * (yTop - apexY) <= 0;
  }

  const xIn = traj.x + vx * tIn;
  if (enterAxis === -1) {
    // 발사구가 이미 확장 박스 안 (HIVE에 밀착): 앞면 앞 공간(림 바깥, 셀 폭 안)일 때만 허용
    return inWindowX(xIn) && inward * (traj.y - rimY) <= 0;
  }
  // (a) 옆면 진입: 앞면(안쪽으로 이동하며 y 면으로 진입)이고 셀 폭 안
  return enterAxis === 1 && inward * vy > 0 && inWindowX(xIn);
}

// 오각형(표면 좌표 u, s)을 반지름 r만큼 안쪽으로 줄인 영역 내부인지: 볼록 다각형의 각 변을 r만큼 이동한 반평면의 교집합
function isInsideInsetOpening(u: number, s: number, r: number): boolean {
  const half = HIVE_OPENING_WIDTH / 2;
  const hRect = HIVE_OPENING_RECT_HEIGHT;
  const hTri = HIVE_OPENING_HEIGHT - hRect;
  if (s < r) return false; // 밑변 (림)
  const au = Math.abs(u);
  if (au > half - r) return false; // 좌우 세로 변
  // 삼각형 빗변: (half, hRect) → (0, H), 바깥 법선 (hTri, half)
  return hTri * (au - half) + half * (s - hRect) <= -r * Math.hypot(hTri, half);
}

/** 몬테카를로 샘플 1개가 소비하는 난수 개수 (sampleNormal 3회 × 2) */
export const RNG_DRAWS_PER_SAMPLE = 6;

/**
 * Mulberry32 시드 PRNG (엔진과 같은 알고리즘, 몬테카를로 전용 독립 스트림)
 * skip: 처음 skip개의 난수를 건너뛴 위치에서 시작 (상태가 고정 증분 수열이라 O(1) 점프).
 * 한 스트림을 칸마다 겹치지 않는 구간으로 나눠 쓰는 데 사용 (칸 순서 / 건너뛰기 / 병렬 분할과 무관하게 같은 결과)
 */
export function createRng(seed: number, skip = 0): () => number {
  let state = (seed + Math.imul(skip, 0x6d2b79f5)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 로봇 중심 (robotX, robotY)에서 셀 조준점을 정면 조준해 사출 속도 v0로 쏠 때의 몬테카를로 명중률
 * 샘플 편차: 속도 v0·(1 + N(0, v0NoisePercent)), 방위 + N(0, headingNoiseRad), 발사각 + N(0, pitchNoiseRad)
 * 발사구는 명목 조준 방향 기준 (편차는 공의 방향에만 적용)
 */
export function estimateHitRate(
  robotX: number,
  robotY: number,
  v0: number,
  config: BallisticsConfig,
  pieceType: PieceType,
  samples: number,
  rng: () => number,
  alliance: 'RED' | 'BLUE' = 'RED',
  cell: HiveCell = 'AUDIENCE_CELL',
): number {
  const n = Math.max(1, Math.floor(samples));
  const aim = hiveCellAimPoint(alliance, cell);
  const aimHeading = bearingTo(robotX, robotY, aim.x, aim.y);
  const origin = launchPoint(robotX, robotY, aimHeading, config);
  const radius = PIECE_PHYSICS[pieceType].radius;
  const v0Noise = config.v0NoisePercent ?? DEFAULT_V0_NOISE_PERCENT;
  const headingNoise = config.headingNoiseRad ?? DEFAULT_HEADING_NOISE_RAD;
  const pitchNoise = config.pitchNoiseRad ?? DEFAULT_PITCH_NOISE_RAD;

  let hits = 0;
  for (let i = 0; i < n; i++) {
    const traj: Trajectory = {
      x: origin.x,
      y: origin.y,
      z: origin.z,
      heading: aimHeading + sampleNormal(0, headingNoise, rng),
      v0: v0 * (1 + sampleNormal(0, v0Noise, rng)),
      pitch: config.shooterPitch + sampleNormal(0, pitchNoise, rng),
    };
    if (isShotInHiveCell(traj, alliance, cell, radius)) hits++;
  }
  return hits / n;
}

// ============================================================
// 7. 스윗스팟 검증 / v0 탐색 / LUT 생성 (명세서 2.6.2)
// ============================================================

export const LUT_GRID_SIZE = 144;                         // 144 × 144 격자
export const LUT_CELL_SIZE = FIELD_SIZE / LUT_GRID_SIZE; // 1 in
export const DEFAULT_LUT_SAMPLES = 2000;                  // 격자당 샘플 수
export const DEFAULT_V0_SEARCH_SAMPLES = 20000;           // v0 후보당 샘플 수

// 도달 불가 격자 판정의 편차 범위 (±6σ 밖 확률은 차원당 약 2e-9로 무시 가능)
const REACH_NOISE_SIGMA = 6;
// 도달 불가 판정의 수평 거리 탐색 간격 (inch)
const REACH_DISTANCE_STEP = 0.05;
export const DEFAULT_BALLISTICS_SEED = 0x0ba1157;

/**
 * 탄도 모델 버전 (LUT 캐시 키 / 저장 레시피에 포함, 명세서 2.6.2 LUT 생성 실행 4)
 * 명중 판정 / LUT 생성 규칙 / 투입구 기하가 바뀌는 커밋마다 1씩 올려 이전 캐시를 자동 무효화한다.
 */
export const BALLISTICS_MODEL_VERSION = 1;

// v0 탐색 범위: 닫힌 해 ±20% (1% 간격) → 최고점 ±1% (0.1% 간격)
const V0_COARSE_STEPS = 20;
const V0_COARSE_STEP = 0.01;
const V0_FINE_STEPS = 10;
const V0_FINE_STEP = 0.001;

/** 격자 (gx, gy)의 LUT 인덱스 */
export function lutIndex(gx: number, gy: number): number {
  return gy * LUT_GRID_SIZE + gx;
}

/** 격자 인덱스의 중심 좌표 (inch) */
export function lutCellCenter(g: number): number {
  return (g + 0.5) * LUT_CELL_SIZE;
}

/** 필드 좌표(inch) → 그 좌표를 담는 격자 인덱스 (필드 밖은 가장자리로 clamp, 경계는 큰 쪽 격자) */
export function lutGridIndex(v: number): number {
  const g = Math.floor((Number.isFinite(v) ? v : 0) / LUT_CELL_SIZE);
  return Math.min(LUT_GRID_SIZE - 1, Math.max(0, g));
}

/**
 * LUT 쌍선형 보간 조회: 필드 좌표를 둘러싼 격자 중심 4개의 값을 거리 비례로 섞음
 * 필드 가장자리 격자 중심 바깥은 가장자리 값으로 고정 (런타임 판정 함수가 사용)
 */
export function sampleLUT(lut: HeatmapLUT, x: number, y: number): number {
  const n = LUT_GRID_SIZE;
  const fx = Math.min(n - 1, Math.max(0, (Number.isFinite(x) ? x : 0) / LUT_CELL_SIZE - 0.5));
  const fy = Math.min(n - 1, Math.max(0, (Number.isFinite(y) ? y : 0) / LUT_CELL_SIZE - 0.5));
  const x0 = Math.min(n - 2, Math.floor(fx));
  const y0 = Math.min(n - 2, Math.floor(fy));
  const wx = fx - x0;
  const wy = fy - y0;
  const p00 = lut[lutIndex(x0, y0)];
  const p10 = lut[lutIndex(x0 + 1, y0)];
  const p01 = lut[lutIndex(x0, y0 + 1)];
  const p11 = lut[lutIndex(x0 + 1, y0 + 1)];
  return (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy;
}

/**
 * 스윗스팟을 그 점을 담는 격자의 중심으로 스냅
 * LUT는 격자 중심에서만 명중률을 계산하므로, v0를 격자 중심 기준으로 탐색해야 스윗스팟 격자의 LUT 값이
 * 탐색 명중률과 일치한다 (근거리 상승 사격은 명중 띠가 격자 폭보다 좁을 수 있음). GUI 격자 클릭 입력은 이미 격자 중심.
 */
export function snapSweetSpot(p: { x: number; y: number }): { x: number; y: number } {
  return { x: lutCellCenter(lutGridIndex(p.x)), y: lutCellCenter(lutGridIndex(p.y)) };
}

/**
 * GUI 스윗스팟 입력 기준 셀 (명세서 3.8): 진영의 공식 시작 상향 셀.
 * RED → RED_AUDIENCE(= 기준 셀 그대로), BLUE → BLUE_OPPOSITE(기준 셀의 필드 중심 점대칭)
 */
export function sweetSpotBasisCell(alliance: 'RED' | 'BLUE'): HiveCellKey {
  return alliance === 'RED' ? 'RED_AUDIENCE' : 'BLUE_OPPOSITE';
}

// 필드 중심 (72, 72) 점대칭 (격자 중심 x.5 → x.5, mirrorLUTSet의 BLUE_OPPOSITE와 같은 변환)
function pointMirror(p: { x: number; y: number }): { x: number; y: number } {
  return { x: FIELD_SIZE - p.x, y: FIELD_SIZE - p.y };
}

/**
 * 진영 기준 좌표(GUI 입력) → 저장용 기준 셀(RED_AUDIENCE) 좌표.
 * 진영 기준 좌표에서 먼저 격자 중심으로 스냅한 뒤 변환하므로, 경계 위의 점도 사용자 화면에서 보인 격자가 그대로 쓰인다.
 */
export function sweetSpotFromBasis(p: { x: number; y: number }, alliance: 'RED' | 'BLUE'): { x: number; y: number } {
  const snapped = snapSweetSpot(p);
  return alliance === 'RED' ? snapped : pointMirror(snapped);
}

/**
 * 저장된 기준 셀(RED_AUDIENCE) 좌표 → 진영 기준 좌표 (GUI 표시, LUT가 실제로 쓰는 격자 중심).
 * 점대칭은 자기 자신이 역변환이므로 sweetSpotFromBasis와 같은 계산이다.
 */
export function sweetSpotToBasis(p: { x: number; y: number }, alliance: 'RED' | 'BLUE'): { x: number; y: number } {
  return sweetSpotFromBasis(p, alliance);
}

export interface BallisticsIssue {
  code: 'PARAM_INVALID' | 'SWEET_SPOT_OUT_OF_FIELD' | 'SWEET_SPOT_IN_HIVE' | 'SWEET_SPOT_NO_SOLUTION';
  message: string;
}

type RobotSize = Pick<RobotConfig, 'length' | 'width'>;

// 조준점을 정면으로 바라보는 로봇 몸체 OBB (axes[0] = 로봇 앞쪽). 스윗스팟 검증과 GUI 스윗스팟 편집 모드 윤곽(09-10c)이 같이 씀
export function aimingRobotOBB(x: number, y: number, target: { x: number; y: number }, size: RobotSize): OBB {
  const heading = bearingTo(x, y, target.x, target.y);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    center: { x, y },
    axes: [{ x: cos, y: sin }, { x: -sin, y: cos }],
    halfExtents: [size.length / 2, size.width / 2],
  };
}

/**
 * 탄도 설정 / 스윗스팟 검증 (GUI는 결과가 비어 있지 않으면 설정 확정을 비활성화)
 * 스윗스팟(격자 중심으로 스냅한 좌표): 기준 셀 RED_AUDIENCE 조준점을 바라보는 로봇 몸체가 필드 안,
 * HIVE와 겹치지 않음, 닫힌 해 존재
 */
export function validateBallisticsConfig(config: BallisticsConfig, robotSize: RobotSize): BallisticsIssue[] {
  const issues: BallisticsIssue[] = [];
  const add = (code: BallisticsIssue['code'], message: string): void => {
    issues.push({ code, message });
  };
  const finite = (v: number | undefined) => v === undefined || Number.isFinite(v);
  const nonNegative = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);

  if (!Number.isFinite(config.dz) || !Number.isFinite(config.shooterOffset) || !finite(config.sweetSpot.x) || !finite(config.sweetSpot.y)) {
    add('PARAM_INVALID', 'dz / shooterOffset / sweetSpot must be finite numbers');
  }
  if (!(config.shooterPitch > 0 && config.shooterPitch < Math.PI / 2)) {
    add('PARAM_INVALID', 'shooterPitch must be in (0, π/2) rad');
  }
  if (!nonNegative(config.v0NoisePercent) || !nonNegative(config.headingNoiseRad) || !nonNegative(config.pitchNoiseRad)) {
    add('PARAM_INVALID', 'noise parameters must be ≥ 0');
  }
  if (!(robotSize.length > 0) || !(robotSize.width > 0)) {
    add('PARAM_INVALID', 'robot length / width must be > 0');
  }
  if (issues.length > 0) return issues;

  const sweetSpot = snapSweetSpot(config.sweetSpot);
  const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
  const body = aimingRobotOBB(sweetSpot.x, sweetSpot.y, aim, robotSize);
  if (testOBBvsFieldBounds(body).colliding) add('SWEET_SPOT_OUT_OF_FIELD', 'robot body at sweet spot must be inside the field');
  if (testOBBvsAABB(body, HIVE_AABB).colliding) add('SWEET_SPOT_IN_HIVE', 'robot body at sweet spot overlaps HIVE');
  if (sweetSpotLaunchSpeed({ ...config, sweetSpot }) === null) add('SWEET_SPOT_NO_SOLUTION', 'no launch speed reaches the aim point from the sweet spot (D·tanθ ≤ Δz)');
  return issues;
}

// 시드 파생: 같은 기준 시드에서 용도별 독립 스트림
function deriveSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt + 1, 0x9e3779b1)) | 0;
}

/**
 * 기준 시드 → 기물 종류별 용도 시드 (v0 탐색 = deriveSeed(seed, 2i), LUT = deriveSeed(seed, 2i + 1), i = PIECE_TYPES 순서)
 * generateRobotLUTs와 Web Worker 작업 계획이 같은 시드를 쓰도록 공개 (명세서 2.6.2 LUT 생성 실행 1)
 */
export function robotLUTSeeds(seed = DEFAULT_BALLISTICS_SEED): Record<PieceType, { search: number; lut: number }> {
  const out = {} as Record<PieceType, { search: number; lut: number }>;
  PIECE_TYPES.forEach((type, i) => {
    out[type] = { search: deriveSeed(seed, 2 * i), lut: deriveSeed(seed, 2 * i + 1) };
  });
  return out;
}

/**
 * 스윗스팟 v0 탐색: 닫힌 해 v0를 초기값으로 ±20% (1% 간격) → 최고점 ±1% (0.1% 간격) 1차원 탐색,
 * 스윗스팟 몬테카를로 명중률이 최대인 v0 채택. 모든 후보가 같은 시드(공통 난수)를 써서 비교 잡음 최소화.
 * 동률이면 닫힌 해에 더 가까운 후보 우선. 닫힌 해가 없으면 null
 */
export function searchLaunchSpeed(
  config: BallisticsConfig,
  pieceType: PieceType,
  samples = DEFAULT_V0_SEARCH_SAMPLES,
  seed = DEFAULT_BALLISTICS_SEED,
): { v0: number; hitRate: number } | null {
  const v0Closed = sweetSpotLaunchSpeed(config);
  if (v0Closed === null) return null;
  const { x, y } = config.sweetSpot;
  const rate = (v: number) => estimateHitRate(x, y, v, config, pieceType, samples, createRng(seed));

  let bestV0 = v0Closed;
  let bestRate = rate(v0Closed);
  // 0, -1, +1, -2, +2 ... 순서로 보면서 더 높을 때만 교체 → 동률은 중심(닫힌 해 / 굵은 탐색 최고점)에 가까운 쪽
  const scan = (center: number, steps: number, step: number) => {
    for (let k = 1; k <= steps; k++) {
      for (const sign of [-1, 1]) {
        const v = center * (1 + sign * k * step);
        const r = rate(v);
        if (r > bestRate) {
          bestRate = r;
          bestV0 = v;
        }
      }
    }
  };
  scan(v0Closed, V0_COARSE_STEPS, V0_COARSE_STEP);
  scan(bestV0, V0_FINE_STEPS, V0_FINE_STEP);
  return { v0: bestV0, hitRate: bestRate };
}

// 투입구 오각형의 지면 투영 꼭짓점 (볼록 다각형)
function openingFootprint(alliance: 'RED' | 'BLUE', cell: HiveCell): { x: number; y: number }[] {
  const inward = cell === 'OPPOSITE_CELL' ? 1 : -1;
  const cx = HIVE_CENTER_X[alliance];
  const half = HIVE_OPENING_WIDTH / 2;
  const rimY = HIVE_RIM_Y[cell];
  const cos = Math.cos(HIVE_CELL_TILT);
  const shoulderY = rimY + inward * HIVE_OPENING_RECT_HEIGHT * cos;
  return [
    { x: cx - half, y: rimY },
    { x: cx + half, y: rimY },
    { x: cx + half, y: shoulderY },
    { x: cx, y: rimY + inward * HIVE_OPENING_HEIGHT * cos },
    { x: cx - half, y: shoulderY },
  ];
}

// 점에서 볼록 다각형까지의 최소 / 최대 거리 (점이 안쪽이면 최소 0)
function polygonDistanceRange(px: number, py: number, poly: { x: number; y: number }[]): [number, number] {
  let min = Infinity;
  let max = 0;
  let inside = true;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const cross = ex * (py - a.y) - ey * (px - a.x);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) inside = false;
    }
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a.x) * ex + (py - a.y) * ey) / len2)) : 0;
    min = Math.min(min, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
    max = Math.max(max, Math.hypot(px - a.x, py - a.y));
  }
  return [inside ? 0 : min, max];
}

/**
 * 도달 가능성 보수 판정 (false면 명중 확률이 사실상 0이라 몬테카를로 생략 가능)
 * 명중하려면 투입구 통과점이 오각형 위에 있어야 하므로, 발사구에서 오각형 지면 투영까지의 수평 거리 d ∈ [dMin, dMax]
 * (방위 편차와 무관) 중 어딘가에서 공 높이가 오각형 높이 범위 [림 z, 꼭짓점 z] 안에 들어올 수 있어야 한다.
 * 속도 / 발사각 편차 ±6σ 상자에서 높이의 최댓값·최솟값을 닫힌 형태로 구하고 (속도에 단조, tanθ에 오목),
 * d를 0.05 in 간격으로 훑되 립시츠 상수로 여유를 둔다. ±6σ 밖을 버리는 오차는 샘플당 약 6e-9.
 */
export function canPossiblyHit(
  robotX: number,
  robotY: number,
  v0: number,
  config: BallisticsConfig,
  alliance: 'RED' | 'BLUE' = 'RED',
  cell: HiveCell = 'AUDIENCE_CELL',
): boolean {
  const aim = hiveCellAimPoint(alliance, cell);
  const origin = launchPoint(robotX, robotY, bearingTo(robotX, robotY, aim.x, aim.y), config);
  const k = REACH_NOISE_SIGMA;
  const dv = k * (config.v0NoisePercent ?? DEFAULT_V0_NOISE_PERCENT);
  const dp = k * (config.pitchNoiseRad ?? DEFAULT_PITCH_NOISE_RAD);
  const pitchLo = config.shooterPitch - dp;
  const pitchHi = config.shooterPitch + dp;
  // 판정 전제를 벗어나면 (속도 하한 ≤ 0, 수직 이상 발사각) 생략하지 않음
  if (!(v0 > 0) || dv >= 1 || pitchLo <= -Math.PI / 2 + EPSILON || pitchHi >= Math.PI / 2 - EPSILON) return true;

  const vMin = v0 * (1 - dv);
  const vMax = v0 * (1 + dv);
  const tanLo = Math.tan(pitchLo);
  const tanHi = Math.tan(pitchHi);
  const tanAbs = Math.max(Math.abs(tanLo), Math.abs(tanHi));
  const zLo = HIVE_RIM_Z;
  const zHi = HIVE_RIM_Z + HIVE_OPENING_HEIGHT * Math.sin(HIVE_CELL_TILT);
  const [dMin, dMax] = polygonDistanceRange(origin.x, origin.y, openingFootprint(alliance, cell));

  // z(d; v, T) = z0 + d·T − g·d²·(1 + T²) / (2v²), T = tanθ
  const height = (d: number, v: number, T: number) => origin.z + d * T - (GRAVITY * d * d * (1 + T * T)) / (2 * v * v);
  // |∂z/∂d| 상한 → 간격 사이 변화량 여유
  const lipschitz = tanAbs + (GRAVITY * dMax * (1 + tanAbs * tanAbs)) / (vMin * vMin);
  const margin = lipschitz * REACH_DISTANCE_STEP;

  const steps = Math.max(1, Math.ceil((dMax - dMin) / REACH_DISTANCE_STEP));
  for (let i = 0; i <= steps; i++) {
    const d = Math.min(dMax, dMin + i * REACH_DISTANCE_STEP);
    // 최댓값: 속도 상한, tanθ는 꼭짓점 T* = v²/(g·d)를 [tanLo, tanHi]로 제한 / 최솟값: 속도 하한, tanθ 양 끝
    const tStar = d > EPSILON ? (vMax * vMax) / (GRAVITY * d) : tanHi;
    const zMax = height(d, vMax, Math.min(tanHi, Math.max(tanLo, tStar)));
    const zMin = Math.min(height(d, vMin, tanLo), height(d, vMin, tanHi));
    if (zMax + margin >= zLo && zMin - margin <= zHi) return true;
  }
  return false;
}

export interface ReferenceLUTOptions {
  skipUnreachable?: boolean; // 도달 불가 격자 몬테카를로 생략 (기본 true, 결과는 생략하지 않은 경우와 동일)
}

/**
 * 기준 셀 RED_AUDIENCE LUT (144 × 144): 격자 중심에서 조준점을 정면 조준한 몬테카를로 명중률
 * - 조준점을 바라보는 로봇 몸체가 HIVE AABB와 겹치는 격자는 0
 * - 격자마다 독립 난수 구간: 격자 i는 스트림의 [i · samples · 6, (i + 1) · samples · 6) 구간을 사용 (겹침 없음).
 *   따라서 도달 불가 격자를 건너뛰어도, 계산 순서나 병렬 분할이 달라도 각 격자 값은 같다.
 *   (144² 격자 × 샘플 × 6이 2³²를 넘지 않아야 구간이 겹치지 않음: 샘플 수 ≤ 약 34,000)
 * - 도달 불가 격자(canPossiblyHit = false)는 몬테카를로를 생략하고 0
 */
export function generateReferenceLUT(
  config: BallisticsConfig,
  robotSize: RobotSize,
  pieceType: PieceType,
  v0: number,
  samples = DEFAULT_LUT_SAMPLES,
  seed = DEFAULT_BALLISTICS_SEED,
  options: ReferenceLUTOptions = {},
): HeatmapLUT {
  return generateReferenceLUTRows(config, robotSize, pieceType, v0, samples, seed, 0, LUT_GRID_SIZE, options);
}

/**
 * 기준 셀 LUT의 행 범위 [gyStart, gyEnd) 계산 (Web Worker 행 묶음 작업, 명세서 2.6.2 LUT 생성 실행 1)
 * 반환 = Float32Array((gyEnd − gyStart) × 144), 반환 배열의 행 r = 전체 LUT의 행 gyStart + r.
 * 격자 인덱스 / 난수 구간은 전체 LUT 기준 그대로이므로, 어떻게 나눠 계산해 이어 붙여도 generateReferenceLUT와 비트 단위로 같다.
 * 범위는 정수로 내림한 뒤 [0, 144]로 제한하고, gyEnd < gyStart면 빈 배열.
 */
export function generateReferenceLUTRows(
  config: BallisticsConfig,
  robotSize: RobotSize,
  pieceType: PieceType,
  v0: number,
  samples: number,
  seed: number,
  gyStart: number,
  gyEnd: number,
  options: ReferenceLUTOptions = {},
): Float32Array {
  const clampRow = (g: number) => Math.min(LUT_GRID_SIZE, Math.max(0, Math.floor(Number.isFinite(g) ? g : 0)));
  const start = clampRow(gyStart);
  const end = Math.max(start, clampRow(gyEnd));
  const skipUnreachable = options.skipUnreachable ?? true;
  const n = Math.max(1, Math.floor(samples));
  const rows = new Float32Array((end - start) * LUT_GRID_SIZE);
  const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
  for (let gy = start; gy < end; gy++) {
    for (let gx = 0; gx < LUT_GRID_SIZE; gx++) {
      const x = lutCellCenter(gx);
      const y = lutCellCenter(gy);
      if (testOBBvsAABB(aimingRobotOBB(x, y, aim, robotSize), HIVE_AABB).colliding) continue;
      if (skipUnreachable && !canPossiblyHit(x, y, v0, config)) continue;
      const index = lutIndex(gx, gy);
      const rng = createRng(seed, index * n * RNG_DRAWS_PER_SAMPLE);
      rows[lutIndex(gx, gy - start)] = estimateHitRate(x, y, v0, config, pieceType, n, rng);
    }
  }
  return rows;
}

/**
 * 기준 셀 LUT → 4셀 LUT 세트 (격자 인덱스 대칭 복사, 셀 기하가 정확히 대칭이므로 오차 없음, g' = 143 − g)
 * RED_OPPOSITE: y = 72 대칭, BLUE_AUDIENCE: x = 72 대칭, BLUE_OPPOSITE: (72, 72) 점대칭
 */
export function mirrorLUTSet(reference: HeatmapLUT): HeatmapLUTSet {
  const n = LUT_GRID_SIZE;
  const mirror = (flipX: boolean, flipY: boolean): HeatmapLUT => {
    const out = new Float32Array(n * n);
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        out[lutIndex(gx, gy)] = reference[lutIndex(flipX ? n - 1 - gx : gx, flipY ? n - 1 - gy : gy)];
      }
    }
    return out;
  };
  return {
    RED_AUDIENCE: Float32Array.from(reference),
    RED_OPPOSITE: mirror(false, true),
    BLUE_AUDIENCE: mirror(true, false),
    BLUE_OPPOSITE: mirror(true, true),
  };
}

export interface RobotLUTOptions extends ReferenceLUTOptions {
  samples?: number;       // 격자당 샘플 수 (기본 2000)
  searchSamples?: number; // v0 후보당 샘플 수 (기본 20000)
  seed?: number;          // 기준 시드 (기본 DEFAULT_BALLISTICS_SEED)
}

export interface RobotBallisticsResult {
  luts: RobotHeatmapLUTs;                          // 기물 종류별 4셀 LUT (로봇당 8장)
  v0: Record<PieceType, number | null>;            // 채택한 사출 속도 (검증 실패 시 null)
  sweetSpotHitRate: Record<PieceType, number>;     // 스윗스팟 명중률 (0이면 GUI 경고)
  issues: BallisticsIssue[];                       // 검증 실패 목록 (비어 있지 않으면 LUT 전부 0)
}

function emptyLUTSet(): HeatmapLUTSet {
  const n = LUT_GRID_SIZE * LUT_GRID_SIZE;
  return {
    RED_AUDIENCE: new Float32Array(n),
    RED_OPPOSITE: new Float32Array(n),
    BLUE_AUDIENCE: new Float32Array(n),
    BLUE_OPPOSITE: new Float32Array(n),
  };
}

/**
 * 로봇 1대의 LUT 8장 생성 (2단계 몬테카를로): 기물 종류별 v0 탐색 → 기준 셀 LUT → 4셀 대칭 복사
 * 스윗스팟은 격자 중심으로 스냅하여 검증 / 탐색. 같은 설정 + 같은 시드 = 같은 LUT.
 * 검증 실패 시 LUT 전부 0 (판정 함수가 항상 0을 반환)
 */
export function generateRobotLUTs(
  config: BallisticsConfig,
  robotSize: RobotSize,
  options: RobotLUTOptions = {},
): RobotBallisticsResult {
  const seed = options.seed ?? DEFAULT_BALLISTICS_SEED;
  const issues = validateBallisticsConfig(config, robotSize);
  const result: RobotBallisticsResult = {
    luts: { POLLEN: emptyLUTSet(), NECTAR: emptyLUTSet() },
    v0: { POLLEN: null, NECTAR: null },
    sweetSpotHitRate: { POLLEN: 0, NECTAR: 0 },
    issues,
  };
  if (issues.length > 0) return result;

  const snapped: BallisticsConfig = { ...config, sweetSpot: snapSweetSpot(config.sweetSpot) };
  const seeds = robotLUTSeeds(seed);
  PIECE_TYPES.forEach(type => {
    const found = searchLaunchSpeed(snapped, type, options.searchSamples, seeds[type].search);
    if (!found) return;
    result.v0[type] = found.v0;
    result.sweetSpotHitRate[type] = found.hitRate;
    const reference = generateReferenceLUT(config, robotSize, type, found.v0, options.samples, seeds[type].lut, options);
    result.luts[type] = mirrorLUTSet(reference);
  });
  return result;
}

// ============================================================
// 8. 런타임 명중 확률 판정 함수 (엔진 주입용, 명세서 2.6.2)
// ============================================================

/** 진영 + 상향 셀 → LUT 셀 키 */
export function hiveCellKey(alliance: 'RED' | 'BLUE', cell: HiveCell): HiveCellKey {
  return `${alliance}_${cell === 'AUDIENCE_CELL' ? 'AUDIENCE' : 'OPPOSITE'}`;
}

/**
 * 조준 판정: 조준점 방위와 로봇 헤딩의 상대각 Δψ (rad, [-π, π])가 슈터 조준 가능 범위 안인지
 * - FIXED: |Δψ| ≤ aimTolerance (비유한 / 음수 허용 오차는 0으로 취급 → 정확히 정렬될 때만)
 * - TURRET: turretRange [α, β]를 [-π, π]로 정규화하여 α ≤ β면 α ≤ Δψ ≤ β,
 *   α > β면 ±π를 가로지르는 구간 (Δψ ≥ α 또는 Δψ ≤ β). 360° 터렛은 [-π, π]
 */
export function isAimWithinShooterRange(
  deltaPsi: number,
  config: Pick<RobotConfig, 'turretType' | 'turretRange' | 'aimTolerance'>,
): boolean {
  if (!Number.isFinite(deltaPsi)) return false;
  if (config.turretType === 'TURRET') {
    const [rawLo, rawHi] = config.turretRange;
    if (!Number.isFinite(rawLo) || !Number.isFinite(rawHi)) return false;
    const alpha = normalizeAngle(rawLo); // normalizeAngle은 ±π를 보존하므로 360° 터렛 [-π, π] 유지
    const beta = normalizeAngle(rawHi);
    return alpha <= beta ? deltaPsi >= alpha && deltaPsi <= beta : deltaPsi >= alpha || deltaPsi <= beta;
  }
  const tolerance = Number.isFinite(config.aimTolerance) ? Math.max(0, config.aimTolerance) : 0;
  return Math.abs(deltaPsi) <= tolerance;
}

/**
 * LUT 기반 명중 확률 판정 함수 (SimulationEngine 생성자에 주입, 엔진 수정 불필요)
 * P_final = (조준 가능 ? P_spatial : 0), P_spatial = 발사 로봇 · 기물 종류 · 아군 상향 셀 LUT를 로봇 중심에서 쌍선형 보간
 * 조준점 방위는 로봇 중심 → 상향 셀 조준점(투입구 오각형 면적 중심). 설정값은 생성 시점에 복사해 고정 (결정론)
 */
export function createLUTShotResolver(
  luts: MatchHeatmapLUTs,
  r1Config: Pick<RobotConfig, 'turretType' | 'turretRange' | 'aimTolerance'>,
  r2Config: Pick<RobotConfig, 'turretType' | 'turretRange' | 'aimTolerance'>,
): ShotProbabilityResolver {
  const shooters = {
    robot1: { turretType: r1Config.turretType, turretRange: [...r1Config.turretRange] as [number, number], aimTolerance: r1Config.aimTolerance },
    robot2: { turretType: r2Config.turretType, turretRange: [...r2Config.turretRange] as [number, number], aimTolerance: r2Config.aimTolerance },
  };
  return (robotId, pieceType, robotX, robotY, heading, alliance, upwardCell) => {
    const aim = hiveCellAimPoint(alliance, upwardCell);
    const deltaPsi = angleDifference(bearingTo(robotX, robotY, aim.x, aim.y), heading);
    if (!isAimWithinShooterRange(deltaPsi, shooters[robotId])) return 0;
    const p = sampleLUT(luts[robotId][pieceType][hiveCellKey(alliance, upwardCell)], robotX, robotY);
    return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  };
}

// ============================================================
// 9. 발사 비행 계획 (엔진 발사 / 도착 분리, 명세서 2.6.2 발사 비행 처리, 08-2 충돌 후 낙하 개정)
// ============================================================

// 엔진 기본 슈터 (탄도 설정 미주입 시): 발사구 14 in, 발사각 60°, 오프셋 0, v0는 발사마다 조준점 닫힌 해
export const DEFAULT_SHOOTER_BALLISTICS: ShooterBallistics = { dz: HIVE_RIM_Z - 14, shooterPitch: Math.PI / 3, shooterOffset: 0 };

/** generateRobotLUTs 결과 → 엔진 슈터 탄도 (탐색한 기물별 v0 포함) */
export function shooterBallisticsFrom(config: BallisticsConfig, result: RobotBallisticsResult): ShooterBallistics {
  const v0: Partial<Record<PieceType, number>> = {};
  for (const type of PIECE_TYPES) {
    const v = result.v0[type];
    if (v !== null) v0[type] = v;
  }
  return { dz: config.dz, shooterPitch: config.shooterPitch, shooterOffset: config.shooterOffset, v0 };
}

/**
 * 명목 발사 방향: 고정형은 로봇 헤딩, 터렛형은 조준점 방위 (터렛 범위 밖이면 가까운 한계각으로 제한, [-π, π])
 */
export function shotLaunchHeading(
  shooter: Pick<RobotConfig, 'turretType' | 'turretRange'>,
  robotHeading: number,
  aimBearing: number,
): number {
  if (shooter.turretType !== 'TURRET') return robotHeading;
  const delta = angleDifference(aimBearing, robotHeading);
  if (isAimWithinShooterRange(delta, { ...shooter, aimTolerance: 0 })) return normalizeAngle(aimBearing);
  const [rawLo, rawHi] = shooter.turretRange;
  if (!Number.isFinite(rawLo) || !Number.isFinite(rawHi)) return robotHeading;
  const lo = normalizeAngle(rawLo);
  const hi = normalizeAngle(rawHi);
  const toLo = Math.abs(angleDifference(lo, delta));
  const toHi = Math.abs(angleDifference(hi, delta));
  return normalizeAngle(robotHeading + (toLo <= toHi ? lo : hi));
}


export interface ShotFlightPlan {
  result: 'HIT' | 'MISS_HIVE' | 'MISS_FLOOR';
  from: Vector3D;         // 발사구
  to: Vector3D;           // 명목 구간 끝: 명중 = 조준점, HIVE 충돌 = 첫 접촉점, 벽 = 벽 접촉점, 바닥 = 착지점
  contactTime: number;    // 명목 구간 끝 시각 (초)
  flightTime: number;     // 도착 시각 (초): 명중 = contactTime, 그 외 = 최종 착지
  heading: number;        // 명목 궤적
  v0: number;
  pitch: number;
  segments: FlightSegment[]; // 충돌 후 구간 (명중 / 바로 바닥 착지는 빈 배열)
  landing: { x: number; y: number }; // 최종 착지점 (명중은 조준점 — 도착 시 무효면 엔진이 planVoidedHitBounce로 교체)
  landingVx: number;      // 착지 직후 속도 (수평 속도 × landingSpeedRetention, 벽 정지 / 명중 0)
  landingVy: number;
}

export interface ShotFlightInput {
  robotX: number;
  robotY: number;
  robotHeading: number;
  shooter: Pick<RobotConfig, 'turretType' | 'turretRange'>;
  ballistics: ShooterBallistics;
  pieceType: PieceType;
  alliance: 'RED' | 'BLUE';
  upwardCell: HiveCell;
  hit: boolean;           // 판정 함수 + 난수로 발사 시점에 확정된 명중 여부
  bounceRolls?: BounceRolls; // 반사 산포 난수 (발사 시점 소비, 미지정 = 산포 없음)
}

/**
 * 발사 1회의 비행 계획 (편차 없는 명목 포물선 + 충돌 후 구간, 닫힌 해, 발사 1회당 상수 시간)
 * - 명중: 궤적과 무관하게 조준점 도착, 비행 시간 = 발사구 → 조준점 수평 거리 / (v0·cosθ)
 * - 빗맞음 + HIVE 직육면체 충돌 (intersectHiveBox, 반지름 확장): 첫 접촉점에서 반사 포물선 (planHiveBounce) → 바닥 착지
 * - 빗맞음 + HIVE를 넘어가거나 닿지 않음: 공 중심 높이 = 반지름인 사거리 지점 착지, 착지 속도 = 발사 방향 v0·cosθ × landingSpeedRetention.
 *   지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 벽 접촉점에서 수평 이동을 멈추고 수직 낙하 (착지 속도 0)
 * - v0: 탄도 설정의 기물별 값 → 없으면 조준점 닫힌 해 → 그것도 없으면 평지 사거리 = 조준점 거리인 속도
 */
export function planShotFlight(input: ShotFlightInput): ShotFlightPlan {
  const { robotX, robotY, ballistics, pieceType } = input;
  const aim = hiveCellAimPoint(input.alliance, input.upwardCell);
  const bearing = bearingTo(robotX, robotY, aim.x, aim.y);
  const heading = shotLaunchHeading(input.shooter, input.robotHeading, bearing);
  const pitch =
    Number.isFinite(ballistics.shooterPitch) && ballistics.shooterPitch > 0 && ballistics.shooterPitch < Math.PI / 2
      ? ballistics.shooterPitch
      : DEFAULT_SHOOTER_BALLISTICS.shooterPitch;
  const cfg = {
    dz: Number.isFinite(ballistics.dz) ? ballistics.dz : DEFAULT_SHOOTER_BALLISTICS.dz,
    shooterOffset: Number.isFinite(ballistics.shooterOffset) ? ballistics.shooterOffset : 0,
    shooterPitch: pitch,
  };
  const origin = launchPoint(robotX, robotY, heading, cfg);
  const aimDistance = Math.max(EPSILON, Math.hypot(aim.x - origin.x, aim.y - origin.y));

  const given = ballistics.v0?.[pieceType];
  const v0 =
    given !== undefined && Number.isFinite(given) && given > 0
      ? given
      : (solveAimLaunchSpeed(robotX, robotY, aim, cfg) ?? Math.sqrt((GRAVITY * aimDistance) / Math.sin(2 * pitch)));
  const traj: Trajectory = { ...origin, heading, v0, pitch };
  const radius = PIECE_PHYSICS[pieceType].radius;
  const rolls = input.bounceRolls ?? NEUTRAL_BOUNCE_ROLLS;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const vh = v0 * Math.cos(pitch);
  const vzAt = (t: number) => v0 * Math.sin(pitch) - GRAVITY * t;
  const base = { from: { ...origin }, heading, v0, pitch };

  if (input.hit) {
    const t = timeAtDistance(traj, aimDistance);
    return {
      ...base,
      result: 'HIT',
      to: { ...aim },
      contactTime: t,
      flightTime: t,
      segments: [],
      landing: { x: aim.x, y: aim.y },
      landingVx: 0,
      landingVy: 0,
    };
  }

  const box = intersectHiveBox(traj, radius);
  if (box) {
    const contact: FlightState = { t: box.time, x: box.x, y: box.y, z: box.z, vx: vh * cos, vy: vh * sin, vz: vzAt(box.time) };
    const after = planHiveBounce(contact, box.face, pieceType, rolls);
    return {
      ...base,
      result: 'MISS_HIVE',
      to: { x: box.x, y: box.y, z: box.z },
      contactTime: box.time,
      flightTime: after.landingTime,
      segments: after.segments,
      landing: after.landing,
      landingVx: after.landingVx,
      landingVy: after.landingVy,
    };
  }

  // 바닥 착지 (해가 없으면 발사구 바로 아래)
  const range = landingDistance(traj, radius) ?? 0;
  // 지면 직선이 필드 벽(반지름 여유)에 닿는 거리
  let wall = Infinity;
  const axis = (p: number, d: number) => {
    if (d > EPSILON) wall = Math.min(wall, (FIELD_SIZE - radius - p) / d);
    else if (d < -EPSILON) wall = Math.min(wall, (radius - p) / d);
  };
  axis(origin.x, cos);
  axis(origin.y, sin);
  const blocked = wall < range;
  const d = Math.max(0, blocked ? wall : range);
  const clampXY = (v: number) => clamp(v, radius, FIELD_SIZE - radius);
  const to = { x: clampXY(origin.x + d * cos), y: clampXY(origin.y + d * sin), z: blocked ? heightAtDistance(traj, d) : radius };
  const contactTime = timeAtDistance(traj, d);
  if (!blocked) {
    const retained = vh * PIECE_PHYSICS[pieceType].landingSpeedRetention;
    return {
      ...base,
      result: 'MISS_FLOOR',
      to,
      contactTime,
      flightTime: contactTime,
      segments: [],
      landing: { x: to.x, y: to.y },
      landingVx: retained * cos,
      landingVy: retained * sin,
    };
  }
  // 벽 접촉: 수평 정지 후 수직 낙하 (높이 무한 · 반발 0 벽 가정)
  const drop = planFallToFloor({ t: contactTime, ...to, vx: 0, vy: 0, vz: vzAt(contactTime) }, pieceType);
  return {
    ...base,
    result: 'MISS_FLOOR',
    to,
    contactTime,
    flightTime: drop.landingTime,
    segments: drop.segments,
    landing: drop.landing,
    landingVx: 0,
    landingVy: 0,
  };
}

// ============================================================
// 10. 충돌 후 낙하 (명세서 2.6.2, 08-2 — 06-6 반사 방출 개정)
// HIVE 직육면체 / 필드 벽에 공중에서 닿은 공이 바닥에 닿을 때까지의 궤도를 닫힌 해 구간 목록(FlightSegment)으로 계산.
// 모든 구간은 발사 시점(무효 명중은 도착 시점)에 확정되고, 엔진은 최종 착지 틱에만 기물을 반영한다.
// ============================================================

/** HIVE 반사 세기 산포: 반발 계수 × (1 ± 0.2) (bounceRestitutionRoll 0 → 0.8배, 1 → 1.2배) */
export const HIVE_BOUNCE_RESTITUTION_SPREAD = 0.2;
/** HIVE 반사 방향 산포: 반사 후 수평 속도를 ± 15° 회전 (bounceAngleRoll) */
export const HIVE_BOUNCE_ANGLE_SPREAD = Math.PI / 12;
/** HIVE 윗면 최대 튐 횟수 (그래도 윗면 위면 굴러서 가장자리에서 낙하) */
export const HIVE_TOP_MAX_BOUNCES = 3;
/** HIVE에서 벗어나는 최소 수평 속도 (inch/s): 옆면 / 무효 명중 반사의 바깥 법선 성분 하한, 윗면 굴러감 속도 하한 */
export const HIVE_BOUNCE_MIN_SPEED = 20;
// 착지 안전장치: 착지점이 HIVE 확장 AABB 안이면 가장 가까운 면 바깥 이 여유만큼으로 이동 (정상 궤도에서는 발생하지 않음)
const HIVE_BOUNCE_GAP = 0.1;

/** 비행 상태: 시각 t (발사 후 초), 위치 (inch), 속도 (inch/s) */
export interface FlightState {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** 반사 산포 난수 [0, 1) (발사 시점에 소비). 0.5 = 산포 없음 */
export interface BounceRolls {
  restitution: number;
  angle: number;
}
export const NEUTRAL_BOUNCE_ROLLS: BounceRolls = { restitution: 0.5, angle: 0.5 };

/** 충돌 후 궤도: 구간 목록 + 최종 착지 */
export interface PostContactFlight {
  segments: FlightSegment[];
  landing: { x: number; y: number };
  landingTime: number; // 발사 후 초
  landingVx: number;   // 착지 직후 속도 (수평 속도 × landingSpeedRetention, 벽 정지 시 0)
  landingVy: number;
}

interface Box2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 구간 위의 위치 (t는 [t0, t1]로 제한) */
export function flightSegmentPoint(seg: FlightSegment, t: number): Vector3D {
  const tau = clamp(t, seg.t0, seg.t1) - seg.t0;
  return {
    x: seg.x + seg.vx * tau,
    y: seg.y + seg.vy * tau,
    z: seg.kind === 'ROLL' ? seg.z : seg.z + seg.vz * tau - (GRAVITY * tau * tau) / 2,
  };
}

// τ초 뒤 상태 (ROLL은 높이 / 수직 속도 유지)
function advance(s: FlightState, tau: number, kind: FlightSegment['kind'] = 'BALLISTIC'): FlightState {
  const ballistic = kind === 'BALLISTIC';
  return {
    t: s.t + tau,
    x: s.x + s.vx * tau,
    y: s.y + s.vy * tau,
    z: ballistic ? s.z + s.vz * tau - (GRAVITY * tau * tau) / 2 : s.z,
    vx: s.vx,
    vy: s.vy,
    vz: ballistic ? s.vz - GRAVITY * tau : s.vz,
  };
}

function pushSegment(segs: FlightSegment[], kind: FlightSegment['kind'], s: FlightState, duration: number): void {
  if (!(duration > EPSILON)) return; // 길이 0 구간은 기록하지 않음
  segs.push({ kind, t0: s.t, t1: s.t + duration, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: kind === 'ROLL' ? 0 : s.vz });
}

// 높이 z0, 수직 속도 vz에서 공 중심이 targetZ로 "내려오며" 도달하는 시간 (이미 아래거나 닿지 않으면 0)
function timeToDescend(z0: number, vz: number, targetZ: number): number {
  const disc = vz * vz + 2 * GRAVITY * (z0 - targetZ);
  if (disc <= 0) return 0;
  return Math.max(0, (vz + Math.sqrt(disc)) / GRAVITY);
}

// 수평 직선이 필드 벽(반지름 여유)에 닿는 시간 (닿지 않으면 Infinity)
function timeToWall(s: FlightState, r: number): number {
  let t = Infinity;
  const axis = (p: number, v: number) => {
    if (v > EPSILON) t = Math.min(t, (FIELD_SIZE - r - p) / v);
    else if (v < -EPSILON) t = Math.min(t, (r - p) / v);
  };
  axis(s.x, s.vx);
  axis(s.y, s.vy);
  return Math.max(0, t);
}

// 공 중심 기준 HIVE 확장 AABB (xy 경계 ± r)
function expandedHiveBox(r: number): Box2D {
  return { minX: HIVE_AABB.minX - r, maxX: HIVE_AABB.maxX + r, minY: HIVE_AABB.minY - r, maxY: HIVE_AABB.maxY + r };
}

// 박스 안(경계 포함)의 점이 수평 이동으로 박스를 벗어나는 시간 (움직이지 않으면 Infinity)
function timeToLeaveBox(s: FlightState, box: Box2D): number {
  let t = Infinity;
  const axis = (p: number, v: number, lo: number, hi: number) => {
    if (v > EPSILON) t = Math.min(t, (hi - p) / v);
    else if (v < -EPSILON) t = Math.min(t, (lo - p) / v);
  };
  axis(s.x, s.vx, box.minX, box.maxX);
  axis(s.y, s.vy, box.minY, box.maxY);
  return Math.max(0, t);
}

/**
 * HIVE 확장 AABB에서 (x, y)의 바깥 법선: 박스 밖이면 가장 가까운 경계점 방향,
 * 경계 위 / 안이면 가장 가까운 면 (동률이면 수평 속도가 가장 깊이 파고드는 면, 그다음 minX → maxX → minY → maxY)
 */
function hiveFaceNormal(x: number, y: number, r: number, vx = 0, vy = 0): { nx: number; ny: number } {
  const box = expandedHiveBox(r);
  const dx = x - clamp(x, box.minX, box.maxX);
  const dy = y - clamp(y, box.minY, box.maxY);
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) return { nx: dx / len, ny: dy / len };
  const faces = [
    { d: x - box.minX, nx: -1, ny: 0 },
    { d: box.maxX - x, nx: 1, ny: 0 },
    { d: y - box.minY, nx: 0, ny: -1 },
    { d: box.maxY - y, nx: 0, ny: 1 },
  ];
  let best = faces[0];
  for (const f of faces.slice(1)) {
    const closer = f.d < best.d - 1e-6;
    const tie = Math.abs(f.d - best.d) <= 1e-6;
    if (closer || (tie && f.nx * vx + f.ny * vy < best.nx * vx + best.ny * vy)) best = f;
  }
  return { nx: best.nx, ny: best.ny };
}

// 착지 안전장치: 필드 안 + HIVE 확장 AABB 밖 (발사구가 HIVE에 걸친 비정상 입력 대비, 정상 궤도는 그대로)
function safeLandingPoint(x: number, y: number, r: number): { x: number; y: number } {
  let lx = clamp(x, r, FIELD_SIZE - r);
  let ly = clamp(y, r, FIELD_SIZE - r);
  const box = expandedHiveBox(r);
  if (lx > box.minX && lx < box.maxX && ly > box.minY && ly < box.maxY) {
    const n = hiveFaceNormal(lx, ly, r);
    if (n.nx < 0) lx = box.minX - HIVE_BOUNCE_GAP;
    else if (n.nx > 0) lx = box.maxX + HIVE_BOUNCE_GAP;
    else if (n.ny < 0) ly = box.minY - HIVE_BOUNCE_GAP;
    else ly = box.maxY + HIVE_BOUNCE_GAP;
  }
  return { x: lx, y: ly };
}

function bounceRestitution(pieceType: PieceType, rolls: BounceRolls): number {
  return PIECE_PHYSICS[pieceType].restitution * (1 + HIVE_BOUNCE_RESTITUTION_SPREAD * (2 * rolls.restitution - 1));
}

function rotateHorizontal(s: FlightState, angle: number): FlightState {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return { ...s, vx: s.vx * c - s.vy * sn, vy: s.vx * sn + s.vy * c };
}

/**
 * 바닥까지 자유 낙하 (중력 포물선, 공 중심 높이 = 반지름에서 착지). 이미 쌓인 구간(segments) 뒤에 이어 붙인다.
 * 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 벽에서 수평 이동을 멈추고 수직으로 낙하한다
 * (높이 무한 · 반발 0 벽 가정, 착지 속도 0). 착지 속도 = 착지 순간 수평 속도 × landingSpeedRetention
 */
export function planFallToFloor(start: FlightState, pieceType: PieceType, segments: readonly FlightSegment[] = []): PostContactFlight {
  const phys = PIECE_PHYSICS[pieceType];
  const r = phys.radius;
  const segs = [...segments];
  const tLand = timeToDescend(start.z, start.vz, r);
  const tWall = timeToWall(start, r);
  if (tWall < tLand) {
    pushSegment(segs, 'BALLISTIC', start, tWall);
    const drop: FlightState = { ...advance(start, tWall), vx: 0, vy: 0 };
    const tDrop = timeToDescend(drop.z, drop.vz, r);
    pushSegment(segs, 'BALLISTIC', drop, tDrop);
    return { segments: segs, landing: safeLandingPoint(drop.x, drop.y, r), landingTime: drop.t + tDrop, landingVx: 0, landingVy: 0 };
  }
  pushSegment(segs, 'BALLISTIC', start, tLand);
  const end = advance(start, tLand);
  return {
    segments: segs,
    landing: safeLandingPoint(end.x, end.y, r),
    landingTime: end.t,
    landingVx: start.vx * phys.landingSpeedRetention,
    landingVy: start.vy * phys.landingSpeedRetention,
  };
}

// 옆면(수평 법선 n) 반사: 파고드는 법선 성분을 −e배로 뒤집고(접선 / 수직 성분 유지), 수평 속도를 산포 각도만큼 회전,
// 바깥 법선 성분이 최소 속도보다 작으면 법선 방향으로 보충 (반드시 HIVE에서 멀어짐)
function bounceOffSide(s: FlightState, n: { nx: number; ny: number }, pieceType: PieceType, rolls: BounceRolls): FlightState {
  const e = bounceRestitution(pieceType, rolls);
  let out: FlightState = { ...s };
  const vn = s.vx * n.nx + s.vy * n.ny;
  if (vn < 0) out = { ...out, vx: s.vx - (1 + e) * vn * n.nx, vy: s.vy - (1 + e) * vn * n.ny };
  out = rotateHorizontal(out, HIVE_BOUNCE_ANGLE_SPREAD * (2 * rolls.angle - 1));
  const away = out.vx * n.nx + out.vy * n.ny;
  if (away < HIVE_BOUNCE_MIN_SPEED) {
    out = { ...out, vx: out.vx + (HIVE_BOUNCE_MIN_SPEED - away) * n.nx, vy: out.vy + (HIVE_BOUNCE_MIN_SPEED - away) * n.ny };
  }
  return out;
}

// 윗면 반복 튐: 수직 속도만 −e배로 뒤집고 수평 속도 유지 (첫 튐에서 산포 각도만큼 회전).
// 다음에 윗면 높이로 내려오기 전에 확장 AABB를 벗어나면 그 포물선 그대로 바닥까지 낙하 (수평 직선 + 볼록 박스라 재충돌 없음).
// 최대 횟수를 튀고도 윗면 위면 수평 속도 방향(정지 상태면 가장 가까운 면)으로 굴러(최소 속도 보장) 가장자리에서 낙하
function bounceOnTop(contact: FlightState, pieceType: PieceType, rolls: BounceRolls): PostContactFlight {
  const r = PIECE_PHYSICS[pieceType].radius;
  const box = expandedHiveBox(r);
  const e = bounceRestitution(pieceType, rolls);
  const segs: FlightSegment[] = [];
  let s = rotateHorizontal(contact, HIVE_BOUNCE_ANGLE_SPREAD * (2 * rolls.angle - 1));
  for (let bounce = 1; bounce <= HIVE_TOP_MAX_BOUNCES; bounce++) {
    const up: FlightState = { ...s, vz: e * Math.abs(s.vz) };
    const airTime = (2 * up.vz) / GRAVITY;
    if (timeToLeaveBox(up, box) < airTime) return planFallToFloor(up, pieceType, segs);
    pushSegment(segs, 'BALLISTIC', up, airTime);
    s = { ...advance(up, airTime), z: contact.z }; // 윗면 높이로 복귀 (반올림 누적 방지)
  }
  const speed = Math.hypot(s.vx, s.vy);
  const dir = speed > EPSILON ? { nx: s.vx / speed, ny: s.vy / speed } : hiveFaceNormal(s.x, s.y, r);
  const rollSpeed = Math.max(speed, HIVE_BOUNCE_MIN_SPEED);
  const roll: FlightState = { ...s, vx: dir.nx * rollSpeed, vy: dir.ny * rollSpeed, vz: 0 };
  const tRoll = timeToLeaveBox(roll, box);
  pushSegment(segs, 'ROLL', roll, tRoll);
  return planFallToFloor({ ...advance(roll, tRoll, 'ROLL'), vz: 0 }, pieceType, segs);
}

/**
 * HIVE 직육면체 충돌 후 궤도 (빗맞음 MISS_HIVE): contact = 첫 접촉 순간 상태 (공 중심, 확장 박스 경계 위)
 * - SIDE: 접촉 면의 수평 바깥 법선으로 반사 후 바닥까지 낙하
 * - TOP: 윗면 반복 튐 (최대 HIVE_TOP_MAX_BOUNCES회) → 박스를 벗어나거나 굴러 떨어져 바닥까지 낙하
 */
export function planHiveBounce(
  contact: FlightState,
  face: 'SIDE' | 'TOP',
  pieceType: PieceType,
  rolls: BounceRolls = NEUTRAL_BOUNCE_ROLLS,
): PostContactFlight {
  if (face === 'TOP') return bounceOnTop(contact, pieceType, rolls);
  const r = PIECE_PHYSICS[pieceType].radius;
  const n = hiveFaceNormal(contact.x, contact.y, r, contact.vx, contact.vy);
  return planFallToFloor(bounceOffSide(contact, n, pieceType, rolls), pieceType);
}

export interface VoidedHitInput {
  from: { x: number; y: number }; // 발사구
  aim: Vector3D;                  // 조준점 (명중 도착 지점)
  v0: number;
  pitch: number;
  contactTime: number;            // 조준점 도착 시각 (발사 후 초)
  targetCell: HiveCell;           // 발사 시점 상향 셀 (반사 면 = 그 셀 쪽 HIVE 앞면)
  pieceType: PieceType;
  rolls?: BounceRolls;
}

/**
 * 무효 명중 (도착 시점에 HIVE 전복 중이거나 상향 셀이 바뀜): 조준점에서 그 셀 쪽 HIVE 앞면의 수평 바깥 법선
 * (AUDIENCE +y / OPPOSITE −y)으로 옆면과 같은 규칙으로 반사 후 바닥까지 낙하.
 * 도착 속도 = 발사구 → 조준점 수평 방향 × v0·cosθ, 수직 v0·sinθ − g·t (렌더러 명목 구간과 같은 방향)
 */
export function planVoidedHitBounce(input: VoidedHitInput): PostContactFlight {
  const { from, aim, v0, pitch, contactTime, pieceType } = input;
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  const len = Math.hypot(dx, dy);
  const vh = v0 * Math.cos(pitch);
  const contact: FlightState = {
    t: contactTime,
    x: aim.x,
    y: aim.y,
    z: aim.z,
    vx: len > EPSILON ? (dx / len) * vh : 0,
    vy: len > EPSILON ? (dy / len) * vh : 0,
    vz: v0 * Math.sin(pitch) - GRAVITY * contactTime,
  };
  const n = { nx: 0, ny: input.targetCell === 'AUDIENCE_CELL' ? 1 : -1 };
  return planFallToFloor(bounceOffSide(contact, n, pieceType, input.rolls ?? NEUTRAL_BOUNCE_ROLLS), pieceType);
}
