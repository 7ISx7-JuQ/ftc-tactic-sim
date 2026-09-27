// 탄도 계산 모듈 (명세서 2.6.2, Step 06-2)
// 공기 저항 / 공 회전을 무시한 진공 포물선. 모든 궤적은 "지면 직선 + 높이 함수"로 표현한다.
//   수평 이동 거리 d에서 높이 z(d) = z0 + d·tanθ − g·d² / (2·v0²·cos²θ), 시간 t(d) = d / (v0·cosθ)
// 좌표계: 필드 (x, y) inch, 높이 z inch (바닥 z = 0)
// ※ LUT 판정 함수(06-4)는 이 파일에 이어서 추가 예정

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
import type { BallisticsConfig, GamePiece, HeatmapLUT, HeatmapLUTSet, RobotConfig, RobotHeatmapLUTs } from './types';

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
 * ③ 통과 전 공 중심이 림 y를 지나는 순간 z ≥ 림 z + 반지름 (림 / 림 아래 외벽에 걸리지 않음)
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

  // ③ 림 통과 높이
  if (Math.abs(vy) > EPSILON) {
    const tRim = (rimY - traj.y) / vy;
    if (tRim >= 0 && tRim < t) {
      const zRim = traj.z + vz * tRim - 0.5 * GRAVITY * tRim * tRim;
      if (zRim < HIVE_RIM_Z + r) return false;
    }
  }
  return true;
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

/** Mulberry32 시드 PRNG (엔진과 같은 알고리즘, 몬테카를로 전용 독립 스트림) */
export function createRng(seed: number): () => number {
  let state = seed | 0;
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

export const LUT_GRID_SIZE = 72;                          // 72 × 72 격자
export const LUT_CELL_SIZE = FIELD_SIZE / LUT_GRID_SIZE; // 2 in
export const DEFAULT_LUT_SAMPLES = 500;                   // 격자당 샘플 수
export const DEFAULT_V0_SEARCH_SAMPLES = 2000;            // v0 후보당 샘플 수
export const DEFAULT_BALLISTICS_SEED = 0x0ba1157;

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
 * 스윗스팟을 그 점을 담는 격자의 중심으로 스냅
 * LUT는 2 in 격자 중심에서만 명중률을 계산하므로, v0를 격자 중심 기준으로 탐색해야 스윗스팟 격자의 LUT 값이
 * 탐색 명중률과 일치한다 (근거리 상승 사격은 명중 띠가 격자 폭보다 좁을 수 있음). GUI 격자 클릭 입력은 이미 격자 중심.
 */
export function snapSweetSpot(p: { x: number; y: number }): { x: number; y: number } {
  return { x: lutCellCenter(lutGridIndex(p.x)), y: lutCellCenter(lutGridIndex(p.y)) };
}

export interface BallisticsIssue {
  code: 'PARAM_INVALID' | 'SWEET_SPOT_OUT_OF_FIELD' | 'SWEET_SPOT_IN_HIVE' | 'SWEET_SPOT_NO_SOLUTION';
  message: string;
}

type RobotSize = Pick<RobotConfig, 'length' | 'width'>;

// 조준점을 정면으로 바라보는 로봇 몸체 OBB (axes[0] = 로봇 앞쪽)
function aimingRobotOBB(x: number, y: number, target: { x: number; y: number }, size: RobotSize): OBB {
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

/**
 * 기준 셀 RED_AUDIENCE LUT (72 × 72): 격자 중심에서 조준점을 정면 조준한 몬테카를로 명중률
 * 조준점을 바라보는 로봇 몸체가 HIVE AABB와 겹치는 격자는 0
 */
export function generateReferenceLUT(
  config: BallisticsConfig,
  robotSize: RobotSize,
  pieceType: PieceType,
  v0: number,
  samples = DEFAULT_LUT_SAMPLES,
  seed = DEFAULT_BALLISTICS_SEED,
): HeatmapLUT {
  const lut = new Float32Array(LUT_GRID_SIZE * LUT_GRID_SIZE);
  const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
  const rng = createRng(seed);
  for (let gy = 0; gy < LUT_GRID_SIZE; gy++) {
    for (let gx = 0; gx < LUT_GRID_SIZE; gx++) {
      const x = lutCellCenter(gx);
      const y = lutCellCenter(gy);
      if (testOBBvsAABB(aimingRobotOBB(x, y, aim, robotSize), HIVE_AABB).colliding) continue;
      lut[lutIndex(gx, gy)] = estimateHitRate(x, y, v0, config, pieceType, samples, rng);
    }
  }
  return lut;
}

/**
 * 기준 셀 LUT → 4셀 LUT 세트 (격자 인덱스 대칭 복사, 셀 기하가 정확히 대칭이므로 오차 없음)
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

export interface RobotLUTOptions {
  samples?: number;       // 격자당 샘플 수 (기본 500)
  searchSamples?: number; // v0 후보당 샘플 수 (기본 2000)
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
  PIECE_TYPES.forEach((type, i) => {
    const found = searchLaunchSpeed(snapped, type, options.searchSamples, deriveSeed(seed, 2 * i));
    if (!found) return;
    result.v0[type] = found.v0;
    result.sweetSpotHitRate[type] = found.hitRate;
    const reference = generateReferenceLUT(config, robotSize, type, found.v0, options.samples, deriveSeed(seed, 2 * i + 1));
    result.luts[type] = mirrorLUTSet(reference);
  });
  return result;
}
