import { describe, expect, it } from 'vitest';
import {
  BALLISTICS_MODEL_VERSION,
  bearingTo,
  canPossiblyHit,
  createAimTrajectory,
  DEFAULT_SHOOTER_BALLISTICS,
  createRng,
  descendingDistanceAtHeight,
  estimateHitRate,
  generateReferenceLUT,
  generateReferenceLUTRows,
  generateRobotLUTs,
  heightAtDistance,
  isPieceFireable,
  nextFireablePieceIndex,
  shooterAimHeading,
  shooterFor,
  aimingRobotOBB,
  hiveCellKey,
  intersectHiveBox,
  isWithinTurretRange,
  estimateShotHitRate,
  isShotInHiveCell,
  LUT_GRID_SIZE,
  lutCellCenter,
  lutIndex,
  lutGridIndex,
  mirrorLUTSet,
  planShotFlight,
  planFallToFloor,
  planHiveBounce,
  planVoidedHitBounce,
  flightSegmentPoint,
  HIVE_BOUNCE_ANGLE_SPREAD,
  HIVE_BOUNCE_MIN_SPEED,
  HIVE_BOUNCE_RESTITUTION_SPREAD,
  HIVE_TOP_MAX_BOUNCES,
  FIELD_WALL_MAX_BOUNCES,
  RNG_DRAWS_PER_SAMPLE,
  fixedRateShotJudge,
  hiveCellCrossing,
  judgeShotTrajectory,
  nominalShot,
  perturbTrajectory,
  shotNoiseOf,
  sampleLUT,
  robotLUTSeeds,
  searchLaunchSpeed,
  shooterBallisticsFrom,
  shotLaunchHeading,
  snapSweetSpot,
  sweetSpotBasisCell,
  sweetSpotFromBasis,
  sweetSpotToBasis,
  validateBallisticsConfig,
  landingDistance,
  landingPoint,
  launchHeight,
  launchPoint,
  pointAtDistance,
  solveAimLaunchSpeed,
  solveLaunchSpeed,
  sweetSpotLaunchSpeed,
  timeAtDistance,
} from '../ballistics';
import type { FlightState, PostContactFlight, Trajectory } from '../ballistics';
import { normalizeAngle } from '../kinematics';
import { FIELD_SIZE, GRAVITY, HIVE_AABB, HIVE_CELL_TILT, HIVE_CENTER_X, HIVE_HEIGHT, HIVE_RIM_Y, HIVE_RIM_Z, PIECE_PHYSICS, hiveCellAimPoint } from '../collision';
import type { BallisticsConfig, FlightSegment, HiveCellKey, RobotConfig, ShooterBallistics } from '../types';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const deg = (d: number) => (d * Math.PI) / 180;
const R_POLLEN = PIECE_PHYSICS.POLLEN.radius;

const BC: BallisticsConfig = { dz: 41.5, shooterPitch: deg(55), sweetSpot: { x: 59.25, y: 130 }, shooterOffset: 6 };
// -y 방향(Audience 쪽에서 HIVE를 지나 Opposite 쪽)으로 쏘는 궤적 (x = 72 중앙선)
const northShot = (y: number, z: number, v0: number, pitchDeg: number): Trajectory =>
  ({ x: 72, y, z, heading: -Math.PI / 2, v0, pitch: deg(pitchDeg) });

describe('탄도 계산 (06-2)', () => {
  it('A. 발사구 / 조준', () => {
    assert(near(launchHeight(BC), HIVE_RIM_Z - 41.5), 'launch height = rim z - dz');
    const lp = launchPoint(10, 20, Math.PI / 2, BC);
    assert(near(lp.x, 10) && near(lp.y, 26) && near(lp.z, 12), `launch point offset along aim heading (${lp.x}, ${lp.y}, ${lp.z})`);
    assert(near(bearingTo(0, 0, 0, -5), -Math.PI / 2) && near(bearingTo(0, 0, -1, 0), Math.PI), 'bearing uses canvas y-down atan2');
  });

  it('B. v0 닫힌 해', () => {
    // 역대입: 닫힌 해 v0로 쏜 궤적은 거리 D에서 정확히 목표 높이를 지남
    for (const [d, dz, p] of [[60, 41.5, 45], [30, 10, 60], [100, -5, 20], [15, 40, 75]] as const) {
      const v0 = solveLaunchSpeed(d, dz, deg(p));
      assert(v0 !== null && v0 > 0, `solution exists (D ${d}, dz ${dz}, pitch ${p})`);
      const traj: Trajectory = { x: 0, y: 0, z: 10, heading: 0, v0: v0!, pitch: deg(p) };
      assert(near(heightAtDistance(traj, d), 10 + dz, 1e-9), `trajectory passes target (D ${d}, dz ${dz}, pitch ${p})`);
    }
    // 수치 예: 발사각 45°, 거리 60, 높이차 41.5 → v0 ≈ 274 in/s (명세 2.5 예시)
    assert(near(solveLaunchSpeed(60, 41.5, deg(45))!, 274.1, 0.5), 'v0 ≈ 274 in/s example');
    // 해 없음: D·tanθ ≤ Δz, D ≤ 0, 수직 / 비유한값
    assert(solveLaunchSpeed(30, 30, deg(45)) === null && solveLaunchSpeed(30, 40, deg(45)) === null, 'no solution when D·tanθ ≤ Δz');
    assert(solveLaunchSpeed(0, -5, deg(45)) === null && solveLaunchSpeed(-3, -5, deg(45)) === null, 'no solution for D ≤ 0');
    assert(solveLaunchSpeed(30, 5, deg(90)) === null && solveLaunchSpeed(NaN, 5, deg(45)) === null, 'no solution for vertical / NaN');
  });

  it('C. 스윗스팟 / 조준 궤적', () => {
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const v0 = sweetSpotLaunchSpeed(BC);
    assert(v0 !== null, 'sweet spot v0 exists');
    const traj = createAimTrajectory(BC.sweetSpot.x, BC.sweetSpot.y, aim, v0!, BC);
    const d = Math.hypot(aim.x - traj.x, aim.y - traj.y);
    const p = pointAtDistance(traj, d);
    assert(near(p.x, aim.x, 1e-9) && near(p.y, aim.y, 1e-9) && near(p.z, aim.z, 1e-9), `nominal trajectory hits aim point (${p.x}, ${p.y}, ${p.z})`);
    assert(near(traj.y, BC.sweetSpot.y - BC.shooterOffset, 1e-9) && near(traj.z, launchHeight(BC)), 'launch point offset toward target');
    assert(near(solveAimLaunchSpeed(BC.sweetSpot.x, BC.sweetSpot.y, aim, BC)!, v0!, 1e-9), 'sweetSpotLaunchSpeed = solveAimLaunchSpeed(RED_AUDIENCE aim)');
    // 스윗스팟이 조준점에 너무 가까워 닫힌 해가 없으면 null (스윗스팟 검증 실패)
    assert(sweetSpotLaunchSpeed({ ...BC, sweetSpot: { x: 59.25, y: 100 }, shooterOffset: 0, shooterPitch: deg(30) }) === null, 'too close for pitch -> null');
  });

  it('D. 비행 시간 / 높이 / 사거리', () => {
    const traj = northShot(130, 12, 274, 45);
    const vh = 274 * Math.cos(deg(45)), vz = 274 * Math.sin(deg(45));
    for (const d of [0, 20, 55.3, 120]) {
      const t = timeAtDistance(traj, d);
      assert(near(t, d / vh, 1e-12), `T = D / (v0·cosθ) at ${d}`);
      assert(near(heightAtDistance(traj, d), 12 + vz * t - 0.5 * GRAVITY * t * t, 1e-9), `height matches z(t) at ${d}`);
    }
    const R = landingDistance(traj, R_POLLEN)!;
    assert(near(heightAtDistance(traj, R), R_POLLEN, 1e-9), 'landing: ball center at radius height');
    const apex = (vh * vz) / GRAVITY; // 최고점 수평 거리
    assert(R > apex, `landing is the descending root (R ${R.toFixed(2)} > apex ${apex.toFixed(2)})`);
    const lp = landingPoint(traj, R_POLLEN)!;
    assert(near(lp.x, 72, 1e-9) && near(lp.y, 130 - R, 1e-9) && near(lp.time, R / vh, 1e-12), 'landing point along heading');
    // 발사구가 목표 높이보다 낮아도 하강 지점만 반환 (상승 중 통과 지점 무시)
    const low = northShot(130, 5, 200, 45);
    const d20 = descendingDistanceAtHeight(low, 20)!;
    assert(d20 > (200 * Math.cos(deg(45)) * 200 * Math.sin(deg(45))) / GRAVITY && near(heightAtDistance(low, d20), 20, 1e-9), 'descending root when launched below target');
    // 닿지 않는 높이 / 잘못된 발사는 null
    assert(descendingDistanceAtHeight(northShot(130, 12, 50, 45), 500) === null, 'unreachable height -> null');
    assert(landingDistance({ ...traj, v0: 0 }, R_POLLEN) === null && landingDistance({ ...traj, pitch: deg(90) }, R_POLLEN) === null, 'invalid launch -> null');
  });

  it('E. HIVE 직육면체 교차', () => {
    // 옆면: 조준점을 향한 명목 궤적은 HIVE 옆면(Audience 쪽 y = maxY + r)에서 부딪힘
    {
      const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
      const traj = createAimTrajectory(BC.sweetSpot.x, BC.sweetSpot.y, aim, sweetSpotLaunchSpeed(BC)!, BC);
      const hit = intersectHiveBox(traj, R_POLLEN);
      assert(hit !== null && hit.face === 'SIDE', 'aim trajectory hits HIVE side');
      assert(near(hit!.y, HIVE_AABB.maxY + R_POLLEN, 1e-9) && hit!.z <= HIVE_HEIGHT + R_POLLEN, `side hit on expanded face (y ${hit!.y}, z ${hit!.z})`);
      assert(near(hit!.time, timeAtDistance(traj, hit!.distance), 1e-12), 'hit time consistent');
    }
    // 넘어감: 높은 포물선은 박스 위를 지나 반대편에 착지
    {
      const traj = northShot(140, 20, 400, 60);
      assert(intersectHiveBox(traj, R_POLLEN) === null, 'high lob passes over HIVE');
      assert(heightAtDistance(traj, 140 - (HIVE_AABB.maxY + R_POLLEN)) > HIVE_HEIGHT + R_POLLEN, 'lob enters above top');
    }
    // 윗면 낙하: 윗면 위로 진입했다가 박스 구간 안에서 내려옴
    {
      const traj = northShot(140, 20, 230, 60);
      const hit = intersectHiveBox(traj, R_POLLEN);
      assert(hit !== null && hit.face === 'TOP', 'falls onto HIVE top');
      assert(near(hit!.z, HIVE_HEIGHT + R_POLLEN, 1e-9) && hit!.y > HIVE_AABB.minY - R_POLLEN && hit!.y < HIVE_AABB.maxY + R_POLLEN, `top hit inside footprint (y ${hit!.y})`);
    }
    // 못 미침: 박스 앞에 착지하면 교차 없음
    {
      const traj = northShot(140, 12, 60, 30);
      assert(landingDistance(traj, R_POLLEN)! < 140 - HIVE_AABB.maxY && intersectHiveBox(traj, R_POLLEN) === null, 'short shot lands before HIVE');
    }
    // 비껴감: 지면 직선이 박스를 지나지 않음 / 축 평행 직선이 범위 밖
    {
      assert(intersectHiveBox({ x: 20, y: 130, z: 12, heading: -Math.PI / 2, v0: 300, pitch: deg(30) }, R_POLLEN) === null, 'parallel line outside x range');
      assert(intersectHiveBox({ x: 72, y: 130, z: 12, heading: 0, v0: 300, pitch: deg(30) }, R_POLLEN) === null, 'shooting away from HIVE');
    }
    // 반지름 확장: 공 표면이 박스 모서리를 스침 (중심은 박스 밖)
    {
      const x = HIVE_AABB.minX - R_POLLEN * 0.5;
      const traj: Trajectory = { x, y: 130, z: 12, heading: -Math.PI / 2, v0: 200, pitch: deg(10) };
      assert(intersectHiveBox(traj, 0) === null && intersectHiveBox(traj, R_POLLEN)?.face === 'SIDE', 'ball radius expands the box');
    }
    // 발사구가 확장 박스 안 (HIVE에 붙은 로봇): 거리 0에서 옆면 충돌
    {
      const traj: Trajectory = { x: 72, y: HIVE_AABB.maxY + 0.5, z: 12, heading: -Math.PI / 2, v0: 200, pitch: deg(45) };
      const hit = intersectHiveBox(traj, R_POLLEN);
      assert(hit !== null && hit.face === 'SIDE' && hit.distance === 0, 'launch inside expanded box -> immediate side hit');
    }
  });
});

// 투입구 표면 좌표 (u: 셀 중심선 기준 좌우, s: 림 기준 표면 거리)의 필드 좌표
const openingPoint = (alliance: 'RED' | 'BLUE', cell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL', u: number, s: number) => {
  const inward = cell === 'OPPOSITE_CELL' ? 1 : -1;
  return { x: HIVE_CENTER_X[alliance] + u, y: HIVE_RIM_Y[cell] + inward * s * Math.cos(HIVE_CELL_TILT), z: HIVE_RIM_Z + s * Math.sin(HIVE_CELL_TILT) };
};
// 편차 없이 목표점을 정확히 지나는 조준 궤적 (닫힌 해 v0)
const shotAt = (robotX: number, robotY: number, target: { x: number; y: number; z: number }, cfg: BallisticsConfig = BC) =>
  createAimTrajectory(robotX, robotY, target, solveAimLaunchSpeed(robotX, robotY, target, cfg)!, cfg);
const NO_NOISE = { v0NoisePercent: 0, headingNoiseRad: 0, pitchNoiseRad: 0 };
// 몬테카를로 기준 설정: 발사구 14 in, 발사각 70°, Audience 벽에 붙은 스윗스팟 (정면 고각 사격, 하강 진입)
// (BC의 근거리 상승 사격은 조준점 명목 궤적이 림 모서리를 0.97 in 거리로 스쳐 걸리므로 몬테카를로 기준으로 쓰지 않음)
const MC: BallisticsConfig = { dz: 39.5, shooterPitch: deg(70), sweetSpot: { x: 60.5, y: 134.5 }, shooterOffset: 6 };
const SIZE = { length: 18, width: 18 };
const R_NECTAR = PIECE_PHYSICS.NECTAR.radius;

describe('몬테카를로 / LUT 생성 (06-3)', () => {
  it('F. 투입구 명중 판정 (isShotInHiveCell)', () => {
    // 4셀 대칭: 대칭 위치에서 각 셀 조준점을 정확히 지나는 궤적은 명중
    for (const [alliance, cell, x, y] of [['RED', 'AUDIENCE_CELL', 60.5, 134.5], ['RED', 'OPPOSITE_CELL', 60.5, 9.5], ['BLUE', 'AUDIENCE_CELL', 83.5, 134.5], ['BLUE', 'OPPOSITE_CELL', 83.5, 9.5]] as const) {
      const traj = shotAt(x, y, hiveCellAimPoint(alliance, cell), MC);
      assert(isShotInHiveCell(traj, alliance, cell, R_POLLEN), `aim point hit ${alliance} ${cell}`);
      const other = cell === 'AUDIENCE_CELL' ? 'OPPOSITE_CELL' : 'AUDIENCE_CELL';
      assert(!isShotInHiveCell(traj, alliance, other, R_POLLEN), `not counted for the other cell ${alliance} ${other}`);
    }
    // 정면 원거리 고각 사격 (발사각 70°, 목표 바로 앞 y = 140): 공이 내려오며 셀 앞면 개구부로 들어오므로 입구 변 판정만 검사
    const FC: BallisticsConfig = { ...BC, shooterPitch: deg(70) };
    const hit = (u: number, s: number, r = R_POLLEN) => isShotInHiveCell(shotAt(59.25 + u, 140, openingPoint('RED', 'AUDIENCE_CELL', u, s), FC), 'RED', 'AUDIENCE_CELL', r);
    // 좌우 세로 변: 반폭 10 - r (POLLEN 8.6, NECTAR 8.2)
    assert(hit(8.55, 3) && !hit(8.65, 3) && hit(-8.55, 3) && !hit(-8.65, 3), 'side edges inset by POLLEN radius');
    assert(hit(8.4, 3, R_POLLEN) && !hit(8.4, 3, R_NECTAR), 'NECTAR (larger) needs more margin than POLLEN');
    // 밑변(림): s ≥ r
    assert(!hit(0, 0.7) && hit(0, 2), 'bottom edge (rim) inset by radius');
    // 삼각형 빗변: 중심선에서 s ≤ 14 - r·√(6.39² + 10²) / 10 ≈ 12.34
    assert(hit(0, 12.2) && !hit(0, 12.5), 'slanted edges inset by radius');
    // 너무 짧게 / 길게 쏜 공은 빗맞음
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const base = shotAt(59.25, 140, aim, FC);
    assert(!isShotInHiveCell({ ...base, v0: base.v0 * 0.9 }, 'RED', 'AUDIENCE_CELL', R_POLLEN) && !isShotInHiveCell({ ...base, v0: base.v0 * 1.2 }, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'short / long shots miss');
    // 뒷면 통과: HIVE 반대편(Opposite 쪽)에서 쏜 공은 조준점을 지나도 빗맞음
    assert(!isShotInHiveCell(shotAt(59.25, 20, aim), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'crossing from the back side is a miss');
    // 근거리 상승 사격 (BC: 거리 약 35 in, 약 50°로 상승하며 도달): 공이 벽 윗모서리를 비스듬히 지나므로
    // 모서리까지의 수직 거리는 높이 여유 × cos(상승각). 입구 아래쪽 / 조준점(s ≈ 5.6)은 걸리고, 입구 위쪽(s = 11)은 명중
    {
      const low = shotAt(59.25, 130, openingPoint('RED', 'AUDIENCE_CELL', 0, 3));
      assert(heightAtDistance(low, low.y - HIVE_RIM_Y.AUDIENCE_CELL) < HIVE_RIM_Z + R_POLLEN && !isShotInHiveCell(low, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'rising shot to the lower opening clips the rim');
      assert(!isShotInHiveCell(shotAt(59.25, 130, aim), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'rising shot to the aim point passes within r of the rim corner');
      assert(isShotInHiveCell(shotAt(59.25, 130, openingPoint('RED', 'AUDIENCE_CELL', 0, 11)), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'rising shot to the upper opening clears the wall corner');
      // s = 9: 벽 윗면 띠(앞면 y, 림 y)에서는 림 z + r 위를 지나지만, 바깥 윗모서리까지의 수직 거리가 r 미만 → 모서리에서만 걸림
      const mid = shotAt(59.25, 130, openingPoint('RED', 'AUDIENCE_CELL', 0, 9));
      assert(heightAtDistance(mid, mid.y - HIVE_AABB.maxY) > HIVE_RIM_Z + R_POLLEN && heightAtDistance(mid, mid.y - HIVE_RIM_Y.AUDIENCE_CELL) > HIVE_RIM_Z + R_POLLEN, 's = 9 clears the wall top band');
      assert(!isShotInHiveCell(mid, 'RED', 'AUDIENCE_CELL', R_POLLEN), 's = 9 clips the outer wall corner (rounded Minkowski corner)');
    }
    // 림 통과 높이: 입구 안쪽(s = 3.85)을 지나지만 림 y에서 림 아래(z 52.05)를 지나는 가파른 궤적은 빗맞음
    {
      const steep: Trajectory = { x: 59.25, y: 95, z: 30, heading: -Math.PI / 2, v0: 147, pitch: deg(83) };
      assert(heightAtDistance(steep, 95 - HIVE_RIM_Y.AUDIENCE_CELL) < HIVE_RIM_Z + R_POLLEN, 'steep lob passes rim y below the rim');
      assert(!isShotInHiveCell(steep, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'blocked by rim / wall below the rim');
    }
    assert(!isShotInHiveCell({ ...base, v0: 0 }, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'invalid launch -> miss');
  });

  it('G. 몬테카를로 명중률 (estimateHitRate)', () => {
    const v0 = sweetSpotLaunchSpeed(MC)!;
    const { x, y } = MC.sweetSpot;
    assert(estimateHitRate(x, y, v0, { ...MC, ...NO_NOISE }, 'POLLEN', 50, createRng(1)) === 1, 'no noise + closed-form v0 -> 100%');
    const p1 = estimateHitRate(x, y, v0, MC, 'POLLEN', 2000, createRng(7));
    assert(p1 === estimateHitRate(x, y, v0, MC, 'POLLEN', 2000, createRng(7)), 'same seed -> same rate');
    assert(p1 > 0.5 && p1 < 1, `noisy rate at sweet spot in (0.5, 1): ${p1}`);
    // 같은 난수 스트림이면 같은 궤적이므로 NECTAR(반지름 큼) 명중은 POLLEN 명중의 부분집합
    assert(estimateHitRate(x, y, v0, MC, 'NECTAR', 2000, createRng(7)) <= p1, 'NECTAR rate ≤ POLLEN rate for identical samples');
    // 점대칭 (RED_AUDIENCE ↔ BLUE_OPPOSITE): 180° 회전이면 편차 부호가 보존되어 샘플 단위로 일치
    const pb = estimateHitRate(144 - x, 144 - y, v0, MC, 'POLLEN', 2000, createRng(7), 'BLUE', 'OPPOSITE_CELL');
    assert(Math.abs(pb - p1) <= 2 / 2000, `point-symmetric rate equal (${p1} vs ${pb})`);
    // 조준점에서 멀리 떨어지면 (고정 v0) 명중률 0
    assert(estimateHitRate(x, y - 25, v0, MC, 'POLLEN', 500, createRng(3)) === 0, 'off the sweet distance (25 in closer) -> 0');
    // PRNG: [0, 1) 균일, 시드별 스트림
    const r = createRng(123);
    const xs = Array.from({ length: 1000 }, r);
    assert(xs.every(v => v >= 0 && v < 1) && Math.abs(xs.reduce((a, b) => a + b, 0) / 1000 - 0.5) < 0.05, 'rng uniform in [0, 1)');
    assert(createRng(123)() === xs[0] && createRng(124)() !== xs[0], 'rng seeded');
  });

  it('H. v0 탐색 (searchLaunchSpeed)', () => {
    const closed = sweetSpotLaunchSpeed(MC)!;
    // 편차 없음: 닫힌 해에서 이미 100%이고 동률은 닫힌 해 우선 → 닫힌 해 그대로
    const exact = searchLaunchSpeed({ ...MC, ...NO_NOISE }, 'POLLEN', 50)!;
    assert(exact.v0 === closed && exact.hitRate === 1, `no noise -> closed-form v0 kept (${exact.v0} vs ${closed})`);
    // 편차 있음: 탐색 결과는 닫힌 해 ±21% 이내, 닫힌 해 명중률 이상 (같은 시드 공통 난수)
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const found = searchLaunchSpeed(MC, type, 1000, 99)!;
      const atClosed = estimateHitRate(MC.sweetSpot.x, MC.sweetSpot.y, closed, MC, type, 1000, createRng(99));
      assert(Math.abs(found.v0 / closed - 1) <= 0.21 + 1e-9, `${type} v0 within search range (${found.v0 / closed})`);
      assert(found.hitRate >= atClosed && found.hitRate > 0.5, `${type} search improves on closed form (${atClosed} -> ${found.hitRate})`);
      const again = searchLaunchSpeed(MC, type, 1000, 99)!;
      assert(again.v0 === found.v0 && again.hitRate === found.hitRate, `${type} deterministic`);
    }
    assert(searchLaunchSpeed({ ...BC, sweetSpot: { x: 59.25, y: 100 }, shooterOffset: 0, shooterPitch: deg(30) }, 'POLLEN') === null, 'no closed form -> null');
  });

  it('I. 탄도 설정 / 스윗스팟 검증', () => {
    const codes = (cfg: BallisticsConfig, size = SIZE) => validateBallisticsConfig(cfg, size).map(i => i.code).join();
    // 검증은 격자 중심으로 스냅한 스윗스팟 기준: y 134.9 → 134.5 (몸체 끝 약 143.55, 필드 안), y 135 → 135.5 (몸체가 벽을 넘음)
    assert(codes({ ...BC, sweetSpot: { x: 59.25, y: 134.9 } }) === '' && codes({ ...BC, sweetSpot: { x: 59.25, y: 135 } }) === 'SWEET_SPOT_OUT_OF_FIELD', 'validation uses snapped sweet spot');
    assert(codes(BC) === '', 'valid config');
    assert(codes({ ...BC, sweetSpot: { x: 59.25, y: 140 } }) === 'SWEET_SPOT_OUT_OF_FIELD', 'robot body crosses the audience wall');
    assert(codes({ ...BC, sweetSpot: { x: 59.25, y: 96 } }).includes('SWEET_SPOT_IN_HIVE'), 'robot body overlaps HIVE');
    assert(codes({ ...BC, shooterPitch: deg(30), sweetSpot: { x: 59.25, y: 110 } }) === 'SWEET_SPOT_NO_SOLUTION', 'too close for pitch');
    assert(codes({ ...BC, shooterPitch: deg(90) }) === 'PARAM_INVALID' && codes({ ...BC, shooterPitch: 0 }) === 'PARAM_INVALID', 'pitch must be in (0, π/2)');
    assert(codes({ ...BC, dz: NaN }) === 'PARAM_INVALID' && codes({ ...BC, headingNoiseRad: -0.1 }) === 'PARAM_INVALID' && codes(BC, { length: 0, width: 18 }) === 'PARAM_INVALID', 'invalid params');
  });

  it('J. LUT 생성 / 4셀 대칭 복사', () => {
    const n = LUT_GRID_SIZE;
    // 대칭 복사 인덱스 규칙 (합성 데이터)
    {
      const ref = Float32Array.from({ length: n * n }, (_, i) => i);
      const set = mirrorLUTSet(ref);
      let ok = true;
      for (const [gx, gy] of [[0, 0], [3, 140], [143, 5], [59, 130]]) {
        ok &&= set.RED_AUDIENCE[lutIndex(gx, gy)] === ref[lutIndex(gx, gy)]
          && set.RED_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(gx, n - 1 - gy)]
          && set.BLUE_AUDIENCE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, gy)]
          && set.BLUE_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, n - 1 - gy)];
      }
      assert(ok && set.RED_AUDIENCE !== ref, 'mirror index mapping (y = 72, x = 72, point symmetry), reference copied');
      assert(n === 144 && lutCellCenter(0) === 0.5 && lutCellCenter(143) === 143.5 && lutIndex(1, 2) === 2 * n + 1, '1 in grid centers / index');
      assert(lutGridIndex(0) === 0 && lutGridIndex(0.99) === 0 && lutGridIndex(1) === 1 && lutGridIndex(144) === 143 && lutGridIndex(-5) === 0 && lutGridIndex(NaN) === 0, 'grid index clamp');
      const ss = snapSweetSpot({ x: 59.25, y: 130 });
      assert(ss.x === 59.5 && ss.y === 130.5, `sweet spot snapped to grid center (${ss.x}, ${ss.y})`);
    }
    // 로봇 1대 LUT 8장 (샘플 수를 줄여 빠르게)
    const opts = { samples: 40, searchSamples: 300, seed: 5 };
    const res = generateRobotLUTs(MC, SIZE, opts);
    assert(res.issues.length === 0 && res.v0.POLLEN !== null && res.v0.NECTAR !== null, 'valid -> v0 per piece type');
    assert(res.sweetSpotHitRate.POLLEN > 0.5 && res.sweetSpotHitRate.NECTAR > 0.5, `sweet spot hit rates ${JSON.stringify(res.sweetSpotHitRate)}`);
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const set = res.luts[type];
      const ref = set.RED_AUDIENCE;
      assert(Object.values(set).every(l => l.length === n * n && l.every(v => v >= 0 && v <= 1)), `${type} 4 LUTs of 144x144 in [0, 1]`);
      let mirrored = true;
      for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
        mirrored &&= set.RED_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(gx, n - 1 - gy)] && set.BLUE_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, n - 1 - gy)];
      }
      assert(mirrored, `${type} cells are exact mirrors of the reference`);
      assert(ref[lutIndex(72, 72)] === 0 && ref[lutIndex(59, 86)] === 0, `${type} robot overlapping HIVE -> 0`);
      // 스윗스팟 (60.5, 134.5) = 격자 (60, 134) 중심에서 v0를 탐색하므로 그 격자 값이 높음
      const atSweet = ref[lutIndex(60, 134)];
      assert(atSweet > 0.5, `${type} high at the sweet spot grid (${atSweet})`);
      assert(ref[lutIndex(60, 143)] < atSweet && ref[lutIndex(60, 108)] === 0, `${type} falls off away from the sweet distance`);
    }
    const again = generateRobotLUTs(MC, SIZE, opts);
    assert(again.v0.POLLEN === res.v0.POLLEN && again.luts.NECTAR.BLUE_AUDIENCE.every((v, i) => v === res.luts.NECTAR.BLUE_AUDIENCE[i]), 'same seed -> identical LUTs');
    const other = generateRobotLUTs(MC, SIZE, { ...opts, seed: 6 });
    assert(other.luts.POLLEN.RED_AUDIENCE.some((v, i) => v !== res.luts.POLLEN.RED_AUDIENCE[i]), 'different seed -> different samples');
    const refA = generateReferenceLUT(MC, SIZE, 'POLLEN', res.v0.POLLEN!, 40, 11);
    const refB = generateReferenceLUT(MC, SIZE, 'POLLEN', res.v0.POLLEN!, 40, 11);
    assert(refA.every((v, i) => v === refB[i]), 'reference LUT deterministic');
    // 검증 실패: LUT 전부 0, v0 null
    const bad = generateRobotLUTs({ ...MC, sweetSpot: { x: 59.25, y: 96 } }, SIZE, opts);
    assert(bad.issues.length > 0 && bad.v0.POLLEN === null && Object.values(bad.luts.POLLEN).every(l => l.every(v => v === 0)), 'invalid -> all-zero LUTs');
  }, 60_000);

  it('K. HIVE 직육면체 진입 면 (셀 앞면 개구부 / 윗면만 허용)', () => {
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const LOB = MC;
    // HIVE 옆(x < 47)에서 조준점을 정확히 지나는 궤적: 입구 판정 ①~③은 통과하지만 HIVE 옆면을 뚫고 오므로 빗맞음
    for (const y of [85.5, 89.5, 93.5, 97.5]) {
      const traj = shotAt(9.5, y, aim, LOB);
      const box = intersectHiveBox(traj, R_POLLEN);
      assert(box !== null && box.face === 'SIDE' && near(box.x, HIVE_AABB.minX - R_POLLEN, 1e-6) && box.z < HIVE_HEIGHT, `side approach from y ${y} enters through the HIVE side face (z ${box?.z.toFixed(1)})`);
      assert(!isShotInHiveCell(traj, 'RED', 'AUDIENCE_CELL', R_POLLEN), `side approach from y ${y} blocked (no y = 93 stripe)`);
    }
    // 앞쪽 대각선에서 입구 가장자리를 노리면 셀 폭 밖(프레임)으로 앞면에 진입 → 차단, 정면에서는 같은 지점이 명중
    const FC: BallisticsConfig = { ...BC, shooterPitch: deg(70) };
    const edge = openingPoint('RED', 'AUDIENCE_CELL', -8.5, 3);
    assert(!isShotInHiveCell(shotAt(20, 140, edge, FC), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'diagonal shot to the opening edge hits the frame beside the cell');
    assert(isShotInHiveCell(shotAt(59.25 - 8.5, 140, edge, FC), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'straight shot to the same edge point enters');
    // 셀 앞면 개구부 진입 (정면 스윗스팟) / 윗면 진입 (발사각 80°, 앞면 도달 높이 67.3 > 박스 높이 + r)
    assert(isShotInHiveCell(shotAt(60.5, 134.5, aim, LOB), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'front window entry');
    {
      const steep = shotAt(59.25, 124, aim, { ...LOB, shooterPitch: deg(80) });
      assert(heightAtDistance(steep, steep.y - (HIVE_AABB.maxY + R_POLLEN)) > HIVE_HEIGHT + R_POLLEN, 'steep lob is above the box at the front face');
      assert(isShotInHiveCell(steep, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'top window entry');
    }
    // LUT: HIVE 옆 격자는 0, 앞쪽 띠는 유지
    const v0 = searchLaunchSpeed(LOB, 'POLLEN', 2000)!.v0;
    assert([85.5, 89.5, 93.5, 97.5].every(y => estimateHitRate(9.5, y, v0, LOB, 'POLLEN', 500, createRng(1)) === 0), 'side cells -> 0');
    assert(estimateHitRate(60.5, 134.5, v0, LOB, 'POLLEN', 500, createRng(1)) > 0.9, 'front sweet spot keeps a high rate');
  });

  it('L. LUT 쌍선형 보간 조회 (sampleLUT)', () => {
    const n = LUT_GRID_SIZE;
    // 선형 함수는 격자 사이에서도 정확히 재현 (격자 중심 = g + 0.5)
    const linear = Float32Array.from({ length: n * n }, (_, i) => 0.001 * (i % n) + 0.002 * Math.floor(i / n));
    const f = (x: number, y: number) => 0.001 * (x - 0.5) + 0.002 * (y - 0.5);
    assert([[10.5, 20.5], [10.8, 20.2], [60.25, 130.75], [0.5, 0.5], [143.5, 143.5]].every(([x, y]) => near(sampleLUT(linear, x, y), f(x, y), 1e-5)), 'bilinear reproduces a linear field');
    // 필드 가장자리 격자 중심 바깥은 가장자리 값, 비유한 좌표는 0으로 처리
    assert(near(sampleLUT(linear, 0.1, 50.5), f(0.5, 50.5), 1e-6) && near(sampleLUT(linear, 200, 50.5), f(143.5, 50.5), 1e-6) && near(sampleLUT(linear, NaN, 0.5), f(0.5, 0.5), 1e-6), 'edge clamp');
    // 단일 봉우리: 중심 1, 반 칸 옆 0.5, 대각 반 칸 0.25 (최근접 조회와 달리 연속)
    const spike = new Float32Array(n * n);
    spike[lutIndex(10, 10)] = 1;
    assert(sampleLUT(spike, 10.5, 10.5) === 1 && near(sampleLUT(spike, 11, 10.5), 0.5, 1e-9) && near(sampleLUT(spike, 11, 11), 0.25, 1e-9) && sampleLUT(spike, 11.5, 10.5) === 0, 'bilinear weights');
  });

  it('M. 격자별 독립 난수 구간 / 도달 불가 격자 생략', () => {
    // 난수 건너뛰기: createRng(seed, k)의 첫 값 = createRng(seed)의 k+1번째 값
    {
      const r = createRng(42);
      const xs = Array.from({ length: 1001 }, () => r());
      assert([0, 1, 5, 1000].every(k => createRng(42, k)() === xs[k]), 'rng jump-ahead matches sequential stream');
      // 샘플 1개당 난수 6개 소비: n샘플 후 다음 값 = createRng(seed, 6n)의 첫 값
      const s = createRng(7);
      estimateHitRate(59.5, 130.5, sweetSpotLaunchSpeed(BC)!, BC, 'POLLEN', 25, s);
      assert(s() === createRng(7, 25 * RNG_DRAWS_PER_SAMPLE)(), 'estimateHitRate consumes RNG_DRAWS_PER_SAMPLE draws per sample');
    }
    const LOB = MC;
    for (const [name, cfg] of [['BC', BC], ['LOB', LOB]] as const) {
      const v0 = searchLaunchSpeed(cfg, 'POLLEN', 1000)!.v0;
      const on = generateReferenceLUT(cfg, SIZE, 'POLLEN', v0, 30, 9, { skipUnreachable: true });
      const off = generateReferenceLUT(cfg, SIZE, 'POLLEN', v0, 30, 9, { skipUnreachable: false });
      assert(on.every((v, i) => v === off[i]), `${name}: skipping unreachable cells changes nothing`);
      let unreachable = 0, nonzero = 0;
      for (let gy = 0; gy < LUT_GRID_SIZE; gy++) for (let gx = 0; gx < LUT_GRID_SIZE; gx++) {
        if (!canPossiblyHit(lutCellCenter(gx), lutCellCenter(gy), v0, cfg)) unreachable++;
        if (off[lutIndex(gx, gy)] > 0) nonzero++;
      }
      assert(unreachable > 0 && nonzero > 0, `${name}: some cells skipped (${unreachable}), band present (${nonzero})`);
      // 격자 값은 자기 난수 구간만 사용 (다른 격자 / 계산 순서와 무관)
      const gx = 59, gy = name === 'BC' ? 130 : 134;
      const i = lutIndex(gx, gy);
      assert(off[i] === Math.fround(estimateHitRate(lutCellCenter(gx), lutCellCenter(gy), v0, cfg, 'POLLEN', 30, createRng(9, i * 30 * RNG_DRAWS_PER_SAMPLE))), `${name}: cell uses its own RNG segment`);
    }
    // 판정 전제를 벗어나면 (속도 편차 6σ ≥ 100%) 생략하지 않음, 조준점 바로 앞은 도달 불가
    assert(canPossiblyHit(10.5, 10.5, 200, { ...BC, v0NoisePercent: 0.2 }), 'huge speed noise -> never skipped');
    assert(!canPossiblyHit(59.5, 100.5, sweetSpotLaunchSpeed(BC)!, BC), 'too close to the HIVE for BC -> unreachable');
  }, 60_000);

  it('N. LUT 셀 키 / 터렛 회전 범위 판정 (isWithinTurretRange)', () => {
    assert(hiveCellKey('RED', 'AUDIENCE_CELL') === 'RED_AUDIENCE' && hiveCellKey('BLUE', 'OPPOSITE_CELL') === 'BLUE_OPPOSITE', 'cell key mapping');
    // 터렛형: Δψ = 조준 방향 − 헤딩 (+ = 로봇 오른쪽, 캔버스 y-down), [α, β] 정규화, α > β는 ±π를 가로지름
    const within = (dPsi: number, range: [number, number]) => isWithinTurretRange(dPsi, range);
    assert(within(0, [-Math.PI / 2, Math.PI / 2]) && within(1.2, [-Math.PI / 2, Math.PI / 2]) && !within(Math.PI, [-Math.PI / 2, Math.PI / 2]), 'front half turret');
    assert(within(Math.PI, [2.5, -2.5]) && within(-Math.PI, [2.5, -2.5]) && within(2.6, [2.5, -2.5]) && !within(0, [2.5, -2.5]) && !within(2.4, [2.5, -2.5]), 'rear turret range crossing ±π');
    assert(within(2.6, [2.5 + 2 * Math.PI, -2.5 - 2 * Math.PI]) && !within(0, [2.5 + 2 * Math.PI, -2.5 - 2 * Math.PI]), 'turret range normalized');
    assert([-Math.PI, -2, 0, 2, Math.PI].every(d => within(d, [-Math.PI, Math.PI])), '360° turret');
    assert(!within(0, [NaN, 1]) && !within(NaN, [-Math.PI, Math.PI]), 'invalid range / angle -> not within');
    // 부호: 로봇 (60.5, 120.5)이 +x를 바라보면 조준점(위쪽, −y)은 로봇 왼쪽 → Δψ ≈ −π/2 → [−π, 0] 터렛만 조준점으로 쏨
    const a = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const bearing = bearingTo(60.5, 120.5, a.x, a.y);
    const T = (range: [number, number]) => ({ turretType: 'TURRET' as const, turretRange: range });
    assert(near(shotLaunchHeading(T([-Math.PI, 0]), 0, bearing), bearing, 1e-12) && !near(shotLaunchHeading(T([0, Math.PI]), 0, bearing), bearing, 0.1), 'turret sign: + = robot right side');
  });
});

describe('발사 비행 계획 (06-6)', () => {
  it('O. planShotFlight / shotLaunchHeading', () => {
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const FIXED = { turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] };
    const TURRET = (range: [number, number]) => ({ turretType: 'TURRET' as const, turretRange: range });
    // 발사 방향: 고정형 = 헤딩, 터렛 = 조준 방위 (범위 밖이면 가까운 한계각)
    assert(shotLaunchHeading(FIXED, 0.3, 1.2) === 0.3, 'FIXED launches along the robot heading');
    assert(shotLaunchHeading(TURRET([-Math.PI, Math.PI]), 0.3, 1.2) === 1.2, 'TURRET within range launches at the aim bearing');
    assert(near(shotLaunchHeading(TURRET([-0.5, 0.5]), 0, Math.PI / 2), 0.5, 1e-12) && near(shotLaunchHeading(TURRET([-0.5, 0.5]), 0, -Math.PI / 2), -0.5, 1e-12), 'TURRET out of range clamps to the nearest limit');
    // 후방 터렛 [2.5, −2.5]: Δψ = +0.3이면 가까운 한계 2.5, −0.3이면 −2.5
    assert(near(shotLaunchHeading(TURRET([2.5, -2.5]), 0, 0.3), 2.5, 1e-12) && near(shotLaunchHeading(TURRET([2.5, -2.5]), 0, -0.3), -2.5, 1e-12), 'rear turret clamps toward the nearer rear limit');
    assert(near(shotLaunchHeading(TURRET([2.5, -2.5]), 1, 1 + Math.PI), normalizeAngle(1 + Math.PI), 1e-12), 'rear turret within range launches at the aim bearing');

    const plan = (x: number, y: number, heading: number, hit: boolean, ballistics: ShooterBallistics = DEFAULT_SHOOTER_BALLISTICS, shooter: Pick<RobotConfig, 'turretType' | 'turretRange'> = FIXED, pieceType: 'POLLEN' | 'NECTAR' = 'POLLEN') =>
      planShotFlight({ robotX: x, robotY: y, robotHeading: heading, shooter, ballistics, pieceType, alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit });
    const onAim = (x: number, y: number) => bearingTo(x, y, aim.x, aim.y);

    // 명중: 조준점 도착, 비행 시간 = 수평 거리 / (v0·cosθ). v0 미지정이면 조준점 닫힌 해 (명목 궤적이 조준점을 지남)
    {
      const h = onAim(60.5, 130.5);
      const p = plan(60.5, 130.5, h, true);
      const D = Math.hypot(aim.x - p.from.x, aim.y - p.from.y);
      assert(p.result === 'HIT' && near(p.to.x, aim.x, 1e-12) && near(p.to.y, aim.y, 1e-12) && near(p.to.z, aim.z, 1e-12), 'hit -> aim point');
      assert(near(p.flightTime, D / (p.v0 * Math.cos(p.pitch)), 1e-12) && p.pitch === DEFAULT_SHOOTER_BALLISTICS.shooterPitch, 'hit flight time');
      assert(p.contactTime === p.flightTime && p.segments.length === 0 && p.landing.x === aim.x && p.landing.y === aim.y, 'hit: no post-contact segments, arrival = contact');
      assert(near(p.v0, solveAimLaunchSpeed(60.5, 130.5, aim, { ...DEFAULT_SHOOTER_BALLISTICS })!, 1e-9) && near(p.from.z, HIVE_RIM_Z - DEFAULT_SHOOTER_BALLISTICS.dz, 1e-12), 'auto shooter v0 = closed form to the aim point');
      const traj = { ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch };
      assert(near(heightAtDistance(traj, D), aim.z, 1e-9), 'nominal trajectory passes the aim point');
      // v0 우선순위: 지정값(그 기물 슈터의 탐색 v0) > 닫힌 해 > 평지 사거리 = 조준점 거리 (12-3: 슈터 탄도가 기물별이라 v0는 숫자 하나)
      assert(plan(60.5, 130.5, h, true, { ...DEFAULT_SHOOTER_BALLISTICS, v0: 321 }).v0 === 321, 'given v0 used');
      assert(near(plan(60.5, 130.5, h, true, { ...DEFAULT_SHOOTER_BALLISTICS, v0: Number.NaN }).v0, p.v0, 1e-9), 'invalid given v0 ignored');
      const low = plan(59.5, 101.5, onAim(59.5, 101.5), true, { dz: 39.5, shooterPitch: deg(20), shooterOffset: 0 });
      const dLow = Math.hypot(aim.x - low.from.x, aim.y - low.from.y);
      assert(near(low.v0, Math.sqrt((GRAVITY * dLow) / Math.sin(2 * deg(20))), 1e-9), 'no closed form -> range-matched v0');
      assert(plan(60.5, 130.5, h, true, { dz: 39.5, shooterPitch: deg(95), shooterOffset: 0 }).pitch === DEFAULT_SHOOTER_BALLISTICS.shooterPitch, 'invalid pitch -> default pitch');
    }
    // 빗맞음 + HIVE 충돌: intersectHiveBox의 첫 접촉점
    {
      const p = plan(60.5, 130.5, onAim(60.5, 130.5), false);
      const box = intersectHiveBox({ ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch }, R_POLLEN)!;
      assert(p.result === 'MISS_HIVE' && box !== null && near(p.to.x, box.x, 1e-12) && near(p.to.y, box.y, 1e-12) && near(p.contactTime, box.time, 1e-12), 'miss -> first HIVE box contact');
      assert(p.segments.length > 0 && p.flightTime > p.contactTime && near(p.flightTime, p.segments[p.segments.length - 1].t1, 1e-12), 'miss -> falls after the contact (arrival = final landing)');
    }
    // 빗맞음 + 바닥 착지: 사거리 지점, 수평 속도 × landingSpeedRetention (기물별)
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const p = plan(72, 110, 0, false, DEFAULT_SHOOTER_BALLISTICS, FIXED, type);
      const traj = { ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch };
      const R = landingDistance(traj, PIECE_PHYSICS[type].radius)!;
      const vh = p.v0 * Math.cos(p.pitch) * PIECE_PHYSICS[type].landingSpeedRetention;
      assert(p.result === 'MISS_FLOOR' && near(p.to.x, p.from.x + R, 1e-9) && near(p.to.z, PIECE_PHYSICS[type].radius, 1e-9) && near(p.landingVx, vh, 1e-9) && near(p.landingVy, 0, 1e-9), `${type} floor landing with retained speed`);
      assert(near(p.flightTime, timeAtDistance(traj, R), 1e-12) && p.contactTime === p.flightTime && p.segments.length === 0, `${type} landing time`);
      assert(p.landing.x === p.to.x && p.landing.y === p.to.y, `${type} landing point = nominal end`);
    }
    // 착지 전에 벽에 닿으면 벽 접촉점(반지름 여유)에서 반사해 바닥까지 낙하 (12-9, 08-2의 수평 정지 대체)
    {
      const p = plan(125, 72, 0, false);
      const vh = p.v0 * Math.cos(p.pitch);
      const vzAtWall = p.v0 * Math.sin(p.pitch) - GRAVITY * p.contactTime;
      assert(p.result === 'MISS_FLOOR' && near(p.to.x, FIELD_SIZE - R_POLLEN, 1e-9) && p.to.z > R_POLLEN, 'blocked by the wall -> nominal flight ends at the wall (in the air)');
      const segs = p.segments;
      const end = flightSegmentPoint(segs[segs.length - 1], Infinity);
      assert(segs.length === 1 && segs[0].t0 === p.contactTime && near(segs[0].x, p.to.x, 1e-9) && segs[0].z === p.to.z, 'then one parabola from the wall contact');
      assert(near(segs[0].vx, -PIECE_PHYSICS.POLLEN.restitution * vh, 1e-9) && segs[0].vy === 0 && near(segs[0].vz, vzAtWall, 1e-9), 'reflected: vx -> -e·vx, vertical speed kept');
      assert(near(end.z, R_POLLEN, 1e-9) && p.landing.x < p.to.x && near(p.flightTime, segs[0].t1, 1e-12), 'lands back in front of the wall');
      assert(near(p.landingVx, segs[0].vx * PIECE_PHYSICS.POLLEN.landingSpeedRetention, 1e-9) && p.landingVy === 0, 'landing speed = rebound speed × landingSpeedRetention');
    }
    // 터렛: 로봇이 반대쪽을 봐도 조준 방위로 발사
    {
      const p = plan(60.5, 130.5, onAim(60.5, 130.5) + Math.PI, true, DEFAULT_SHOOTER_BALLISTICS, TURRET([-Math.PI, Math.PI]));
      assert(near(p.heading, onAim(60.5, 130.5), 1e-12), '360° turret launches at the aim bearing');
    }
    // 생성 결과 → 엔진 슈터 탄도
    {
      const s = shooterBallisticsFrom(MC, { v0: { POLLEN: 200, NECTAR: null } } as Parameters<typeof shooterBallisticsFrom>[1]);
      assert(s.POLLEN.dz === MC.dz && s.POLLEN.shooterPitch === MC.shooterPitch && s.POLLEN.shooterOffset === MC.shooterOffset && s.POLLEN.v0 === 200 && s.NECTAR.v0 === undefined && s.NECTAR.dz === MC.dz, 'shooterBallisticsFrom copies config (both pieces, shared shooter) and found v0');
    }
  });
});

describe('충돌 후 낙하 (08-2, 06-6 개정)', () => {
  it('P. HIVE 옆면 / 윗면 반사, 벽 반사, 무효 명중 반사', () => {
    const E_POLLEN = PIECE_PHYSICS.POLLEN.restitution;
    const box = { minX: HIVE_AABB.minX - R_POLLEN, maxX: HIVE_AABB.maxX + R_POLLEN, minY: HIVE_AABB.minY - R_POLLEN, maxY: HIVE_AABB.maxY + R_POLLEN };
    const topZ = HIVE_HEIGHT + R_POLLEN;
    const insideBox = (x: number, y: number) => x > box.minX && x < box.maxX && y > box.minY && y < box.maxY;
    // 구간 연결 검사: 시작 상태에서 출발, 구간끼리 위치 / 시각이 이어지고, 마지막 끝이 바닥(z = 반지름) 착지점
    const chain = (start: FlightState, f: PostContactFlight, label: string, r = R_POLLEN) => {
      const segs = f.segments;
      assert(segs.length > 0 && segs.every(s => s.t1 > s.t0), `${label}: non-empty segments with positive durations`);
      assert(near(segs[0].t0, start.t, 1e-12) && near(segs[0].x, start.x, 1e-9) && near(segs[0].y, start.y, 1e-9) && near(segs[0].z, start.z, 1e-9), `${label}: starts at the contact state`);
      for (let i = 0; i + 1 < segs.length; i++) {
        const end = flightSegmentPoint(segs[i], segs[i].t1);
        const next = segs[i + 1];
        assert(near(segs[i].t1, next.t0, 1e-12) && near(end.x, next.x, 1e-9) && near(end.y, next.y, 1e-9) && near(end.z, next.z, 1e-9), `${label}: segment ${i} -> ${i + 1} continuous`);
      }
      const last = segs[segs.length - 1];
      const end = flightSegmentPoint(last, last.t1);
      assert(near(end.z, r, 1e-9) && near(end.x, f.landing.x, 1e-9) && near(end.y, f.landing.y, 1e-9) && near(last.t1, f.landingTime, 1e-12), `${label}: ends on the floor at the landing point`);
      assert(!insideBox(f.landing.x, f.landing.y) && f.landing.x >= r && f.landing.x <= FIELD_SIZE - r && f.landing.y >= r && f.landing.y <= FIELD_SIZE - r, `${label}: lands in the field, outside the HIVE`);
    };

    // 구간 위치: BALLISTIC은 중력 포물선, ROLL은 높이 유지, 시각은 [t0, t1]로 제한
    {
      const seg: FlightSegment = { kind: 'BALLISTIC', t0: 1, t1: 2, x: 10, y: 20, z: 30, vx: 5, vy: -4, vz: 12 };
      const p = flightSegmentPoint(seg, 1.5);
      assert(near(p.x, 12.5) && near(p.y, 18) && near(p.z, 30 + 6 - GRAVITY * 0.125), 'ballistic point');
      assert(near(flightSegmentPoint({ ...seg, kind: 'ROLL' }, 1.5).z, 30) && near(flightSegmentPoint(seg, 5).x, 15) && near(flightSegmentPoint(seg, 0).x, 10), 'roll keeps height, time clamped');
    }

    // 옆면 (중립 난수): 파고드는 법선 성분만 −e배, 접선 / 수직 속도 유지 → 바깥으로 튀어 바닥까지 낙하
    {
      const contact: FlightState = { t: 0.5, x: 72, y: box.maxY, z: 30, vx: 40, vy: -150, vz: -50 };
      const f = planHiveBounce(contact, 'SIDE', 'POLLEN');
      const s0 = f.segments[0];
      assert(near(s0.vy, E_POLLEN * 150, 1e-9) && s0.vx === 40 && s0.vz === -50, `front face: vy -150 -> +${(E_POLLEN * 150).toFixed(1)}, tangential / vertical kept`);
      chain(contact, f, 'side');
      assert(f.landing.y > box.maxY && near(f.landingVy, s0.vy * PIECE_PHYSICS.POLLEN.landingSpeedRetention, 1e-9), 'lands in front of the face, horizontal speed × landingSpeedRetention');
      // 옆면 x 쪽 (−x 면): 법선 (−1, 0)
      const side = planHiveBounce({ t: 0, x: box.minX, y: 72, z: 20, vx: 100, vy: 10, vz: 0 }, 'SIDE', 'POLLEN');
      assert(near(side.segments[0].vx, -E_POLLEN * 100, 1e-9) && side.segments[0].vy === 10 && side.landing.x < box.minX, 'left face reflects -x');
    }
    // 산포 난수: 반사 세기 × (1 ± 0.2), 방향 ± 15° 회전, 바깥 법선 성분 최소 속도 보장
    {
      const contact: FlightState = { t: 0, x: 72, y: box.maxY, z: 30, vx: 0, vy: -150, vz: 0 };
      const weak = planHiveBounce(contact, 'SIDE', 'POLLEN', { restitution: 0, angle: 0.5 }).segments[0];
      const strong = planHiveBounce(contact, 'SIDE', 'POLLEN', { restitution: 0.75, angle: 0.5 }).segments[0];
      assert(near(weak.vy, E_POLLEN * (1 - HIVE_BOUNCE_RESTITUTION_SPREAD) * 150, 1e-9) && near(strong.vy, E_POLLEN * (1 + 0.5 * HIVE_BOUNCE_RESTITUTION_SPREAD) * 150, 1e-9), 'restitution roll scales the rebound');
      const turned = planHiveBounce(contact, 'SIDE', 'POLLEN', { restitution: 0.5, angle: 0 }).segments[0];
      assert(near(Math.atan2(turned.vy, turned.vx), Math.PI / 2 - HIVE_BOUNCE_ANGLE_SPREAD, 1e-9) && near(Math.hypot(turned.vx, turned.vy), E_POLLEN * 150, 1e-9), 'angle roll rotates the rebound by -15°');
      const graze = planHiveBounce({ ...contact, vx: 150, vy: -1 }, 'SIDE', 'POLLEN').segments[0];
      assert(near(graze.vy, HIVE_BOUNCE_MIN_SPEED, 1e-9) && near(graze.vx, 150, 1e-9), 'grazing hit: outward speed topped up to the minimum');
      const grazeTurned = planHiveBounce({ ...contact, vx: 150, vy: -1 }, 'SIDE', 'POLLEN', { restitution: 0.5, angle: 0 }).segments[0];
      assert(grazeTurned.vy >= HIVE_BOUNCE_MIN_SPEED - 1e-9, 'rotation toward the face still leaves the HIVE');
    }
    // 윗면: 빠른 공은 한 번 튀고 박스를 벗어나 그 포물선으로 낙하
    {
      // 가장자리 12.9 in 앞, 60 in/s: 첫 튐 체공(0.27 s) 안에 박스를 벗어남 (벽에는 닿지 않음)
      const contact: FlightState = { t: 1, x: 72, y: 80, z: topZ, vx: 0, vy: 60, vz: -150 };
      const f = planHiveBounce(contact, 'TOP', 'POLLEN');
      assert(f.segments.length === 1 && near(f.segments[0].vz, E_POLLEN * 150, 1e-9) && f.segments[0].vy === 60, 'top: vertical speed reversed × e, horizontal kept, leaves the box in the air');
      chain(contact, f, 'top fast');
      assert(f.landing.y > box.maxY, 'lands beyond the far side');
    }
    // 윗면: 느린 공은 최대 횟수 튀고 윗면을 굴러 가장자리에서 낙하 (굴러감 속도 = max(수평 속도, 최소 속도))
    {
      const contact: FlightState = { t: 1, x: 72, y: 60, z: topZ, vx: 0, vy: 30, vz: -150 };
      const f = planHiveBounce(contact, 'TOP', 'POLLEN');
      const kinds = f.segments.map(s => s.kind).join();
      assert(kinds === [...Array(HIVE_TOP_MAX_BOUNCES).fill('BALLISTIC'), 'ROLL', 'BALLISTIC'].join(), `slow top hit: ${HIVE_TOP_MAX_BOUNCES} bounces, roll, fall (${kinds})`);
      for (let i = 0; i < HIVE_TOP_MAX_BOUNCES; i++) {
        const s = f.segments[i];
        assert(near(s.z, topZ, 1e-9) && near(flightSegmentPoint(s, s.t1).z, topZ, 1e-9) && insideBox(flightSegmentPoint(s, s.t1).x, flightSegmentPoint(s, s.t1).y), `bounce ${i + 1} starts and ends on the top`);
      }
      assert(near(f.segments[1].vz, E_POLLEN * f.segments[0].vz, 1e-9), 'each bounce loses speed by e');
      const roll = f.segments[HIVE_TOP_MAX_BOUNCES];
      assert(roll.vy === 30 && near(flightSegmentPoint(roll, roll.t1).y, box.maxY, 1e-9), 'roll along the velocity to the edge');
      chain(contact, f, 'top slow');
      // 수평 속도 0: 가장 가까운 면(−y) 쪽으로 최소 속도로 굴러감
      const still = planHiveBounce({ ...contact, vy: 0 }, 'TOP', 'POLLEN');
      const stillRoll = still.segments.find(s => s.kind === 'ROLL')!;
      assert(stillRoll.vx === 0 && near(stillRoll.vy, -HIVE_BOUNCE_MIN_SPEED, 1e-12) && still.landing.y < box.minY, 'no horizontal speed -> rolls off the nearest face at the minimum speed');
      chain({ ...contact, vy: 0 }, still, 'top still');
    }
    // 벽: 착지 전에 벽에 닿으면 반사 (12-9 — 상세는 V), 수직 속도는 이어짐
    {
      const start: FlightState = { t: 0, x: 140, y: 72, z: 40, vx: 100, vy: 0, vz: 0 };
      const f = planFallToFloor(start, 'POLLEN');
      const [a, b] = f.segments;
      assert(f.segments.length === 2 && near(flightSegmentPoint(a, a.t1).x, FIELD_SIZE - R_POLLEN, 1e-9) && near(b.vx, -E_POLLEN * 100, 1e-9) && b.vy === 0, 'reflects at the wall');
      assert(near(b.vz, a.vz - GRAVITY * (a.t1 - a.t0), 1e-9) && near(f.landingVx, b.vx * PIECE_PHYSICS.POLLEN.landingSpeedRetention, 1e-9) && f.landingVy === 0, 'vertical speed continues, rebound speed retained on landing');
      chain(start, f, 'wall');
      const open = planFallToFloor({ ...start, x: 60 }, 'NECTAR');
      assert(open.segments.length === 1 && near(open.landingVx, 100 * PIECE_PHYSICS.NECTAR.landingSpeedRetention, 1e-9), 'open floor: one parabola, speed retained');
      chain({ ...start, x: 60 }, open, 'open', PIECE_PHYSICS.NECTAR.radius);
    }
    // 무효 명중: 조준점에서 셀 쪽 HIVE 앞면 바깥으로 반사 (AUDIENCE +y / OPPOSITE −y)
    {
      for (const cell of ['AUDIENCE_CELL', 'OPPOSITE_CELL'] as const) {
        const aim = hiveCellAimPoint('RED', cell);
        const fromY = cell === 'AUDIENCE_CELL' ? 130.5 : 144 - 130.5;
        const hitPlan = planShotFlight({ robotX: 60.5, robotY: fromY, robotHeading: bearingTo(60.5, fromY, aim.x, aim.y), shooter: { turretType: 'FIXED', turretRange: [0, 0] }, ballistics: DEFAULT_SHOOTER_BALLISTICS, pieceType: 'POLLEN', alliance: 'RED', upwardCell: cell, hit: true });
        const f = planVoidedHitBounce({ from: hitPlan.from, aim, v0: hitPlan.v0, pitch: hitPlan.pitch, contactTime: hitPlan.contactTime, targetCell: cell, pieceType: 'POLLEN' });
        const out = cell === 'AUDIENCE_CELL' ? f.segments[0].vy : -f.segments[0].vy;
        assert(out >= HIVE_BOUNCE_MIN_SPEED - 1e-9 && (cell === 'AUDIENCE_CELL' ? f.landing.y > box.maxY : f.landing.y < box.minY), `${cell}: bounces out of the cell front`);
        const vzAtAim = hitPlan.v0 * Math.sin(hitPlan.pitch) - GRAVITY * hitPlan.contactTime;
        chain({ t: hitPlan.contactTime, ...aim, vx: 0, vy: 0, vz: vzAtAim }, f, `voided ${cell}`);
        assert(near(f.segments[0].vz, vzAtAim, 1e-9), 'vertical speed at the aim point kept');
      }
    }
    // 착지 안전장치: 비정상 접촉(박스 안, 낮은 높이)도 HIVE 밖 필드 안에 착지
    {
      const f = planHiveBounce({ t: 0, x: 72, y: 90, z: 2, vx: 0, vy: -10, vz: 0 }, 'SIDE', 'POLLEN');
      assert(!insideBox(f.landing.x, f.landing.y) && f.landing.y > box.maxY, 'degenerate contact inside the box -> landing pushed outside');
    }
  });
});

describe('LUT 병렬 생성 사전 준비 (09-2)', () => {
  const bitEqual = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  // 행 경계 목록으로 나눠 계산한 뒤 이어 붙인 LUT (계산 순서는 뒤에서부터 → 순서 무관 확인)
  const assembleRows = (
    cfg: BallisticsConfig, size: { length: number; width: number }, type: 'POLLEN' | 'NECTAR',
    v0: number, samples: number, seed: number, bounds: number[],
  ) => {
    const lut = new Float32Array(LUT_GRID_SIZE * LUT_GRID_SIZE);
    for (let k = bounds.length - 2; k >= 0; k--) {
      lut.set(generateReferenceLUTRows(cfg, size, type, v0, samples, seed, bounds[k], bounds[k + 1]), bounds[k] * LUT_GRID_SIZE);
    }
    return lut;
  };
  const range = (step: number) => [...Array.from({ length: Math.ceil(LUT_GRID_SIZE / step) }, (_, i) => i * step), LUT_GRID_SIZE];

  it('Q. 행 범위 LUT / 시드 파생 / 작업 계획 동일성 / 모델 버전 / 스윗스팟 진영 기준', () => {
    const n = LUT_GRID_SIZE;
    // 행 범위 분할 → 이어 붙이면 generateReferenceLUT와 비트 단위로 같음
    {
      const v0 = searchLaunchSpeed(MC, 'POLLEN', 1000)!.v0;
      const full = generateReferenceLUT(MC, SIZE, 'POLLEN', v0, 20, 13);
      assert(full.some(v => v > 0), 'reference LUT has a hit band');
      for (const [name, bounds] of [['1 row', range(1)], ['7 rows', range(7)], ['uneven', [0, 5, 50, 51, 144]], ['whole', [0, 144]]] as const) {
        assert(bitEqual(assembleRows(MC, SIZE, 'POLLEN', v0, 20, 13, [...bounds]), full), `${name} partition === generateReferenceLUT`);
      }
      const rows = (a: number, b: number) => generateReferenceLUTRows(MC, SIZE, 'POLLEN', v0, 20, 13, a, b);
      assert(rows(130, 134).length === 4 * n && bitEqual(rows(130, 134), full.subarray(130 * n, 134 * n)), 'row r of the result = full row gyStart + r');
      assert(rows(10, 10).length === 0 && rows(20, 10).length === 0, 'empty / reversed range -> empty array');
      assert(bitEqual(rows(-5, 3), full.subarray(0, 3 * n)) && bitEqual(rows(140, 999), full.subarray(140 * n)), 'range clamped to [0, 144]');
      assert(bitEqual(rows(2.7, 4.2), full.subarray(2 * n, 4 * n)), 'fractional bounds floored');
      const noSkip = generateReferenceLUT(MC, SIZE, 'POLLEN', v0, 20, 13, { skipUnreachable: false });
      assert(bitEqual(assembleRows(MC, SIZE, 'POLLEN', v0, 20, 13, range(7)), noSkip)
        && bitEqual(generateReferenceLUTRows(MC, SIZE, 'POLLEN', v0, 20, 13, 60, 70, { skipUnreachable: false }), noSkip.subarray(60 * n, 70 * n)), 'skipUnreachable option passed through');
    }
    // 시드 파생: 기물 종류 × 용도별 서로 다른 값, 결정론, 기본값 고정
    // (값이 바뀌면 같은 설정의 LUT가 달라지므로 BALLISTICS_MODEL_VERSION을 올려야 함)
    {
      const s = robotLUTSeeds();
      assert(JSON.stringify(s) === JSON.stringify(robotLUTSeeds(0x0ba1157)), 'default = DEFAULT_BALLISTICS_SEED');
      assert(s.POLLEN.search === -1634899738 && s.POLLEN.lut === 1020584501 && s.NECTAR.search === -635667388 && s.NECTAR.lut === 2020079507,
        `derived seeds pinned ${JSON.stringify(s)}`);
      assert(new Set([s.POLLEN.search, s.POLLEN.lut, s.NECTAR.search, s.NECTAR.lut]).size === 4, 'four independent streams');
      assert(robotLUTSeeds(5).POLLEN.lut !== s.POLLEN.lut, 'different base seed -> different streams');
    }
    // 작업 계획(로봇 2대 × 기물 2종: v0 탐색 1개 → 4행 묶음, 역순 처리 → 조립 → 대칭 복사)으로 만든 16장 === generateRobotLUTs
    const robots = [
      { cfg: MC, size: SIZE, opts: { samples: 30, searchSamples: 200, seed: 5 } },
      { cfg: { ...BC, sweetSpot: { x: 59.2, y: 129.9 } }, size: { length: 14, width: 12 }, opts: { samples: 30, searchSamples: 200, seed: 8 } },
    ];
    const r1Direct = generateRobotLUTs(robots[0].cfg, robots[0].size, robots[0].opts);
    let sheets = 0;
    robots.forEach(({ cfg, size, opts }, r) => {
      const direct = r === 0 ? r1Direct : generateRobotLUTs(cfg, size, opts);
      const seeds = robotLUTSeeds(opts.seed);
      const snapped = { ...cfg, sweetSpot: snapSweetSpot(cfg.sweetSpot) };
      for (const type of ['POLLEN', 'NECTAR'] as const) {
        const found = searchLaunchSpeed(snapped, type, opts.searchSamples, seeds[type].search)!;
        assert(found.v0 === direct.v0[type] && found.hitRate === direct.sweetSpotHitRate[type], `robot${r + 1} ${type}: planned search = generateRobotLUTs v0 / hit rate`);
        const set = mirrorLUTSet(assembleRows(cfg, size, type, found.v0, opts.samples, seeds[type].lut, range(4)));
        for (const key of Object.keys(set) as HiveCellKey[]) {
          assert(bitEqual(set[key], direct.luts[type][key]), `robot${r + 1} ${type} ${key}: planned === generateRobotLUTs`);
          sheets++;
        }
      }
    });
    assert(sheets === 16, '16 LUT sheets compared');
    // 모델 버전: 양의 정수
    assert(Number.isInteger(BALLISTICS_MODEL_VERSION) && BALLISTICS_MODEL_VERSION >= 1, `BALLISTICS_MODEL_VERSION = ${BALLISTICS_MODEL_VERSION}`);
    // 스윗스팟 진영 기준: RED = 기준 셀 그대로(스냅), BLUE = 필드 중심 점대칭
    {
      assert(sweetSpotBasisCell('RED') === 'RED_AUDIENCE' && sweetSpotBasisCell('BLUE') === 'BLUE_OPPOSITE', 'basis cells');
      const same = (p: { x: number; y: number }, x: number, y: number) => p.x === x && p.y === y;
      assert(same(sweetSpotFromBasis({ x: 60.2, y: 134.9 }, 'RED'), 60.5, 134.5) && same(sweetSpotToBasis({ x: 60.2, y: 134.9 }, 'RED'), 60.5, 134.5), 'RED: snap only');
      assert(same(sweetSpotFromBasis({ x: 83.5, y: 9.5 }, 'BLUE'), 60.5, 134.5) && same(sweetSpotToBasis({ x: 60.5, y: 134.5 }, 'BLUE'), 83.5, 9.5), 'BLUE: point symmetry');
      // 경계 위의 점: 진영 기준 좌표에서 먼저 스냅 (사용자가 본 격자 유지)
      const edge = sweetSpotFromBasis({ x: 84, y: 10 }, 'BLUE');
      assert(same(edge, 59.5, 133.5) && same(sweetSpotToBasis(edge, 'BLUE'), 84.5, 10.5), `BLUE boundary click keeps the clicked grid (${edge.x}, ${edge.y})`);
      let roundTrip = true;
      for (const p of [{ x: 0, y: 0 }, { x: 143.99, y: 144 }, { x: 72, y: 72 }, { x: 12.3, y: 101.7 }, { x: 96, y: 18 }]) {
        for (const a of ['RED', 'BLUE'] as const) {
          const back = sweetSpotToBasis(sweetSpotFromBasis(p, a), a);
          roundTrip &&= same(back, snapSweetSpot(p).x, snapSweetSpot(p).y);
        }
      }
      assert(roundTrip, 'basis -> reference -> basis = snapped input (incl. field edges)');
      // BLUE 기준 셀 기하 = 기준 셀의 점대칭: 조준점, 검증, LUT 값이 대응
      const redAim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
      const blueAim = hiveCellAimPoint('BLUE', 'OPPOSITE_CELL');
      assert(near(blueAim.x, 144 - redAim.x) && near(blueAim.y, 144 - redAim.y) && near(blueAim.z, redAim.z), 'BLUE_OPPOSITE aim point = point mirror of RED_AUDIENCE');
      const inHive = validateBallisticsConfig({ ...MC, sweetSpot: sweetSpotFromBasis({ x: 84.75, y: 48 }, 'BLUE') }, SIZE);
      assert(inHive.some(i => i.code === 'SWEET_SPOT_IN_HIVE'), 'BLUE basis point in front of the HIVE -> validated as SWEET_SPOT_IN_HIVE');
      const b = sweetSpotToBasis(MC.sweetSpot, 'BLUE');
      const set = r1Direct.luts.POLLEN;
      const at = (lut: Float32Array, p: { x: number; y: number }) => lut[lutIndex(lutGridIndex(p.x), lutGridIndex(p.y))];
      assert(at(set[sweetSpotBasisCell('BLUE')], b) === at(set.RED_AUDIENCE, MC.sweetSpot) && at(set.RED_AUDIENCE, MC.sweetSpot) > 0.5,
        'BLUE basis sweet spot grid in BLUE_OPPOSITE LUT = reference sweet spot value');
    }
  }, 120_000);
});

describe('슈터 구성 / 좌우 오프셋 (12-3)', () => {
  const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
  const right = (h: number) => ({ x: -Math.sin(h), y: Math.cos(h) }); // 캔버스 y-down에서 발사 방향 기준 오른쪽
  const FAST = { samples: 20, searchSamples: 200 }; // 기물별 분기 / 동일성 확인용 저정밀

  it('R. 조준 보정 ψ = β − asin(b / D), 사출구 → 조준점 거리 = √(D² − b²) − 앞뒤 오프셋, b = 0이면 v1 계산 그대로', () => {
    const x = 60.5, y = 130.5;
    const beta = bearingTo(x, y, aim.x, aim.y);
    const D = Math.hypot(aim.x - x, aim.y - y);
    assert(shooterAimHeading(x, y, aim) === beta && shooterAimHeading(x, y, aim, 0) === beta, 'b = 0 -> bearing exactly');
    for (const b of [4, -4, 9]) {
      const psi = shooterAimHeading(x, y, aim, b)!;
      assert(near(psi, beta - Math.asin(b / D), 1e-12), `ψ formula (b = ${b})`);
      const f = 3;
      const exit = launchPoint(x, y, psi, { dz: 39.5, shooterOffset: f, shooterLateralOffset: b });
      const r = right(psi);
      assert(near((exit.x - x) * r.x + (exit.y - y) * r.y, b, 1e-9), `exit is b to the right of the shooting direction (b = ${b})`);
      // 사출구에서 발사 방향 직선이 조준점을 지남 (수직 거리 0), 거리 = √(D² − b²) − f
      const along = (aim.x - exit.x) * Math.cos(psi) + (aim.y - exit.y) * Math.sin(psi);
      const across = (aim.x - exit.x) * r.x + (aim.y - exit.y) * r.y;
      assert(near(across, 0, 1e-9) && near(along, Math.sqrt(D * D - b * b) - f, 1e-9), `line through the aim point (b = ${b}: across ${across.toExponential(1)}, along ${along.toFixed(3)})`);
      // 닫힌 해도 그 거리 기준
      const cfg = { dz: 39.5, shooterOffset: f, shooterLateralOffset: b, shooterPitch: deg(60) };
      assert(near(solveAimLaunchSpeed(x, y, aim, cfg)!, solveLaunchSpeed(Math.sqrt(D * D - b * b) - f, aim.z - launchHeight(cfg), cfg.shooterPitch)!, 1e-9), `closed form uses the corrected distance (b = ${b})`);
    }
    // 오른쪽 사출구 → 왼쪽으로 돌려 조준 (ψ < β)
    assert(shooterAimHeading(x, y, aim, 4)! < beta && shooterAimHeading(x, y, aim, -4)! > beta, 'right exit turns left, left exit turns right');
    // D ≤ |b| / 비유한값 → 조준 불가
    assert(shooterAimHeading(aim.x + 3, aim.y + 3, aim, 5) === null && shooterAimHeading(x, y, aim, Number.NaN) === null, 'no aim when D ≤ |b| or b is not finite');
    assert(solveAimLaunchSpeed(aim.x + 3, aim.y + 3, aim, { dz: 39.5, shooterOffset: 0, shooterLateralOffset: 5, shooterPitch: deg(60) }) === null, 'no closed form when D ≤ |b|');
    // 좌우 오프셋 미지정 / 0은 v1 사출구와 비트 단위로 같음
    const h = 1.234;
    const v1 = { x: x + 6 * Math.cos(h), y: y + 6 * Math.sin(h) };
    for (const lp of [launchPoint(x, y, h, { dz: 39.5, shooterOffset: 6 }), launchPoint(x, y, h, { dz: 39.5, shooterOffset: 6, shooterLateralOffset: 0 })]) {
      assert(lp.x === v1.x && lp.y === v1.y, 'lateral 0 / undefined = v1 launch point bit for bit');
    }
    // 조준한 로봇 몸체도 ψ를 바라봄
    const body = aimingRobotOBB(x, y, aim, SIZE, 6);
    assert(near(Math.atan2(body.axes[0].y, body.axes[0].x), shooterAimHeading(x, y, aim, 6)!, 1e-12), 'aiming body faces ψ');
    // 몬테카를로: 조준 불가 자리는 0 (난수 미사용)
    let draws = 0;
    const counting = () => { draws++; return 0.5; };
    assert(estimateHitRate(aim.x + 3, aim.y + 3, 300, { ...MC, shooterLateralOffset: 5 }, 'POLLEN', 10, counting) === 0 && draws === 0, 'no aim -> hit rate 0 without random draws');
    // 검증: 좌우 오프셋 비유한값 / 조준 불가 스윗스팟
    assert(validateBallisticsConfig({ ...MC, shooterLateralOffset: Number.NaN }, SIZE).some(i => i.code === 'PARAM_INVALID'), 'non-finite lateral offset -> PARAM_INVALID');
    assert(validateBallisticsConfig({ ...MC, sweetSpot: { x: 59.5, y: 101.5 }, shooterLateralOffset: 18 }, SIZE).some(i => i.code === 'SWEET_SPOT_NO_SOLUTION'), 'D ≤ |lateral| -> SWEET_SPOT_NO_SOLUTION');
  });

  it('S. 슈터 구성: 발사 가능 기물 / 기물별 슈터 / 다음 발사 기물 (첫 발사 가능 기물)', () => {
    const base = { shooterDelay: 300, turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] };
    const nectar = { shooterDelay: 450, turretType: 'TURRET' as const, turretRange: [-1, 1] as [number, number] };
    const fire = (setup: 'NONE' | 'POLLEN_ONLY' | 'SHARED' | 'PER_PIECE' | undefined) => [isPieceFireable({ shooterSetup: setup }, 'POLLEN'), isPieceFireable({ shooterSetup: setup }, 'NECTAR')];
    expect([fire('NONE'), fire('POLLEN_ONLY'), fire('SHARED'), fire('PER_PIECE'), fire(undefined)]).toEqual([[false, false], [true, false], [true, true], [true, true], [true, true]]);
    expect(shooterFor({ ...base, shooterSetup: 'PER_PIECE', nectarShooter: nectar }, 'NECTAR')).toBe(nectar);
    expect(shooterFor({ ...base, shooterSetup: 'PER_PIECE', nectarShooter: nectar }, 'POLLEN')).toEqual(base);
    expect(shooterFor({ ...base, shooterSetup: 'SHARED', nectarShooter: nectar }, 'NECTAR')).toEqual(base); // SHARED는 NECTAR 슈터 값을 쓰지 않음
    const N = { type: 'NECTAR' as const }, P = { type: 'POLLEN' as const };
    expect(nextFireablePieceIndex({ shooterSetup: 'POLLEN_ONLY' }, [N, N, P, N])).toBe(2);
    expect(nextFireablePieceIndex({ shooterSetup: 'POLLEN_ONLY' }, [N, N])).toBe(-1);
    expect(nextFireablePieceIndex({ shooterSetup: 'SHARED' }, [N, P])).toBe(0);
    expect(nextFireablePieceIndex({ shooterSetup: 'NONE' }, [P])).toBe(-1);
    expect(nextFireablePieceIndex({ shooterSetup: 'PER_PIECE' }, [])).toBe(-1);
  });

  it('T. 확률표: 기물마다 그 기물 슈터 설정으로 계산, 발사 불가 기물은 0, 단일 설정 = 두 기물 공용(v1과 같음), 검증 문제에 기물 표시', () => {
    const MC2: BallisticsConfig = { ...MC, dz: 37.5, shooterPitch: deg(62) };
    const shared = generateRobotLUTs(MC, SIZE, FAST);
    const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    // 단일 설정 = { POLLEN: c, NECTAR: c } = 좌우 0 명시
    const perPieceSame = generateRobotLUTs({ POLLEN: MC, NECTAR: MC }, SIZE, FAST);
    const lateral0 = generateRobotLUTs({ ...MC, shooterLateralOffset: 0 }, SIZE, FAST);
    for (const r of [perPieceSame, lateral0]) {
      assert(same(r.luts.POLLEN.RED_AUDIENCE, shared.luts.POLLEN.RED_AUDIENCE) && same(r.luts.NECTAR.RED_AUDIENCE, shared.luts.NECTAR.RED_AUDIENCE) && r.v0.POLLEN === shared.v0.POLLEN && r.v0.NECTAR === shared.v0.NECTAR, 'same as the shared (v1) result bit for bit');
    }
    // 기물별: NECTAR는 NECTAR 슈터 설정의 결과와 같고 POLLEN은 그대로
    const per = generateRobotLUTs({ POLLEN: MC, NECTAR: MC2 }, SIZE, FAST);
    const nectarOnly = generateRobotLUTs(MC2, SIZE, FAST);
    assert(same(per.luts.POLLEN.RED_AUDIENCE, shared.luts.POLLEN.RED_AUDIENCE) && same(per.luts.NECTAR.RED_AUDIENCE, nectarOnly.luts.NECTAR.RED_AUDIENCE), 'each piece uses its own shooter');
    assert(per.v0.NECTAR === nectarOnly.v0.NECTAR && per.v0.NECTAR !== shared.v0.NECTAR, 'NECTAR v0 from the NECTAR shooter');
    // 발사 불가 기물: 계산하지 않고 0, v0 null
    const pollenOnly = generateRobotLUTs({ POLLEN: MC }, SIZE, FAST);
    assert(pollenOnly.v0.NECTAR === null && pollenOnly.sweetSpotHitRate.NECTAR === 0 && pollenOnly.luts.NECTAR.RED_AUDIENCE.every(v => v === 0), 'non-fireable piece -> zero LUT, no v0');
    assert(same(pollenOnly.luts.POLLEN.RED_AUDIENCE, shared.luts.POLLEN.RED_AUDIENCE), 'fireable piece unchanged');
    const none = generateRobotLUTs({}, SIZE, FAST);
    assert(none.issues.length === 0 && none.v0.POLLEN === null && none.v0.NECTAR === null, 'no shooter -> nothing to generate');
    // 검증: 두 설정이 다르면 문제 슈터의 기물을 붙이고 LUT 전부 0, 같으면 v1처럼 표시 없음
    const bad: BallisticsConfig = { ...MC, shooterPitch: 0 };
    const badNectar = generateRobotLUTs({ POLLEN: MC, NECTAR: bad }, SIZE, FAST);
    assert(badNectar.issues.length > 0 && badNectar.issues.every(i => i.pieceType === 'NECTAR') && badNectar.v0.POLLEN === null, 'invalid NECTAR shooter -> tagged issue, nothing generated');
    assert(generateRobotLUTs(bad, SIZE, FAST).issues.every(i => i.pieceType === undefined), 'shared shooter issues are not tagged');
    // 좌우 오프셋 보정: 오프셋을 줘도 스윗스팟에서 조준점을 맞춰 명중률이 유지됨
    // (MC 스윗스팟 y 134.5는 몸체가 ψ로 돌면 모서리가 벽 밖 → SWEET_SPOT_OUT_OF_FIELD라 벽에서 띄운 자리)
    const away: BallisticsConfig = { ...MC, sweetSpot: { x: 60.5, y: 130.5 } };
    assert(validateBallisticsConfig({ ...MC, shooterLateralOffset: 5 }, SIZE).some(i => i.code === 'SWEET_SPOT_OUT_OF_FIELD'), 'rotated body at a wall-side sweet spot leaves the field');
    const offset = generateRobotLUTs({ ...away, shooterLateralOffset: 5 }, SIZE, FAST);
    const noOffset = generateRobotLUTs(away, SIZE, FAST);
    assert(offset.issues.length === 0 && offset.sweetSpotHitRate.POLLEN > 0.5 && !same(offset.luts.POLLEN.RED_AUDIENCE, noOffset.luts.POLLEN.RED_AUDIENCE), `lateral offset is aimed (sweet spot ${offset.sweetSpotHitRate.POLLEN.toFixed(2)}, issues ${offset.issues.map(i => i.code).join()})`);
    // 엔진 슈터 탄도: 기물별 (발사 불가 기물은 다른 기물의 값, v0 없음)
    const sb = shooterBallisticsFrom({ POLLEN: MC, NECTAR: MC2 }, per);
    assert(sb.POLLEN.dz === MC.dz && sb.NECTAR.dz === MC2.dz && sb.NECTAR.v0 === per.v0.NECTAR!, 'per-piece engine ballistics');
    const sbOnly = shooterBallisticsFrom({ POLLEN: { ...MC, shooterLateralOffset: 2 } }, pollenOnly);
    assert(sbOnly.NECTAR.dz === MC.dz && sbOnly.NECTAR.v0 === undefined && sbOnly.POLLEN.shooterLateralOffset === 2, 'non-fireable piece borrows the other shooter without v0');
  }, 120_000);

  it('U. 기대 명중률 / 비행 계획: 좌우 오프셋 조준 보정, 터렛 발사 방향', () => {
    const FIXED = { shooterDelay: 300, turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] };
    const TURRET360 = { ...FIXED, turretType: 'TURRET' as const, turretRange: [-Math.PI, Math.PI] as [number, number] };
    const x = 60.5, y = 130.5;
    const beta = bearingTo(x, y, aim.x, aim.y);
    // 기대 명중률 (13-5): 좌우 오프셋 고정형은 보정한 ψ를 바라볼 때 가장 높고, 방위 β를 바라보면 사출구 선이 조준점에서 b만큼
    // 비껴가 조금 낮음 (투입구 폭 20 in 안이라 0은 아님 — 이전 ±3° 컷은 이를 0으로 봄)
    const b = 6;
    const psi = shooterAimHeading(x, y, aim, b)!;
    const est = (heading: number, shooter: typeof FIXED | typeof TURRET360 = FIXED) =>
      estimateShotHitRate({ robotX: x, robotY: y, robotHeading: heading, shooter, ballistics: { ...DEFAULT_SHOOTER_BALLISTICS, shooterLateralOffset: b }, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL' });
    assert(Math.abs(psi - beta) > deg(3) && est(psi) > 0.9 && est(beta) < est(psi) && est(beta) > 0.5, `lateral offset: facing ψ ${est(psi)} vs facing β ${est(beta)}`);
    assert(est(psi + 0.5) === 0, 'far off the opening -> 0');
    // 360° 터렛은 헤딩과 무관하게 ψ로 쏘므로 ψ를 바라본 고정형과 같은 기대값 (같은 고정 시드)
    expect(est(beta + 1, TURRET360)).toBe(est(psi));

    // 비행 계획: 사출구 = 발사 방향 오른쪽 b, 명중은 조준점 도착, 명목 궤적이 조준점 높이를 지남
    const ballistics = { ...DEFAULT_SHOOTER_BALLISTICS, shooterOffset: 2, shooterLateralOffset: b };
    for (const [name, shooter, heading] of [['fixed facing ψ', FIXED, psi], ['360° turret', TURRET360, beta + 1]] as const) {
      const p = planShotFlight({ robotX: x, robotY: y, robotHeading: heading, shooter, ballistics, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit: true });
      const r = right(p.heading);
      assert(near(p.heading, psi, 1e-12), `${name}: launches along ψ`);
      assert(near((p.from.x - x) * r.x + (p.from.y - y) * r.y, b, 1e-9), `${name}: exit is b to the right`);
      const d = Math.hypot(aim.x - p.from.x, aim.y - p.from.y);
      const D = Math.hypot(aim.x - x, aim.y - y);
      assert(near(d, Math.sqrt(D * D - b * b) - 2, 1e-9), `${name}: exit → aim distance`);
      assert(near(heightAtDistance({ ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch }, d), aim.z, 1e-9), `${name}: closed-form v0 passes the aim point`);
    }
    // 좌우 오프셋 0 / 미지정은 v1 비행과 같음
    const v1 = planShotFlight({ robotX: x, robotY: y, robotHeading: beta, shooter: FIXED, ballistics: DEFAULT_SHOOTER_BALLISTICS, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit: false });
    const zero = planShotFlight({ robotX: x, robotY: y, robotHeading: beta, shooter: FIXED, ballistics: { ...DEFAULT_SHOOTER_BALLISTICS, shooterLateralOffset: 0 }, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit: false });
    expect(zero).toEqual(v1);
  });
});

describe('필드 벽 반사 (12-9)', () => {
  it('V. 높이 무한 벽 반사(닿은 축 −e배, 산포 없음), 모서리, 반대쪽 벽, 반사 뒤 HIVE 재충돌, 반사 상한, 발사 비행 계획', () => {
    const box = { minX: HIVE_AABB.minX - R_POLLEN, maxX: HIVE_AABB.maxX + R_POLLEN, minY: HIVE_AABB.minY - R_POLLEN, maxY: HIVE_AABB.maxY + R_POLLEN };
    const insideBox = (x: number, y: number) => x > box.minX && x < box.maxX && y > box.minY && y < box.maxY;
    const end = (f: PostContactFlight) => { const last = f.segments[f.segments.length - 1]; return flightSegmentPoint(last, last.t1); };
    // 구간끼리 위치 / 시각이 이어지고 마지막 끝이 필드 안 · HIVE 밖 바닥 착지점
    const continuous = (f: PostContactFlight, label: string, r = R_POLLEN) => {
      for (let i = 0; i + 1 < f.segments.length; i++) {
        const a = flightSegmentPoint(f.segments[i], f.segments[i].t1);
        const b = f.segments[i + 1];
        assert(near(f.segments[i].t1, b.t0, 1e-12) && near(a.x, b.x, 1e-9) && near(a.y, b.y, 1e-9) && near(a.z, b.z, 1e-9), `${label}: segment ${i} -> ${i + 1} continuous`);
      }
      const e = end(f);
      assert(near(e.z, r, 1e-9) && near(e.x, f.landing.x, 1e-9) && near(e.y, f.landing.y, 1e-9) && near(f.segments[f.segments.length - 1].t1, f.landingTime, 1e-12), `${label}: ends on the floor at the landing point`);
      assert(!insideBox(f.landing.x, f.landing.y) && f.landing.x >= r && f.landing.x <= FIELD_SIZE - r && f.landing.y >= r && f.landing.y <= FIELD_SIZE - r, `${label}: lands in the field, outside the HIVE`);
    };

    // 기물별 반발 계수 (바닥 공의 벽 충돌과 같은 값), 접선 / 수직 속도 유지, 반사 산포 난수와 무관
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const { radius: r, restitution: e } = PIECE_PHYSICS[type];
      const start: FlightState = { t: 0.2, x: 30, y: 135, z: 30, vx: -20, vy: 200, vz: 50 };
      const f = planFallToFloor(start, type);
      const [a, b] = f.segments;
      assert(f.segments.length === 2 && near(b.y, FIELD_SIZE - r, 1e-9), `${type}: hits the audience wall (y = 144 − r)`);
      assert(near(b.vy, -e * 200, 1e-9) && b.vx === -20 && near(b.vz, a.vz - GRAVITY * (a.t1 - a.t0), 1e-9), `${type}: vy -> −e·vy, vx / vz kept`);
      assert(near(f.landingVx, -20 * PIECE_PHYSICS[type].landingSpeedRetention, 1e-9) && near(f.landingVy, b.vy * PIECE_PHYSICS[type].landingSpeedRetention, 1e-9), `${type}: landing speed retained after the rebound`);
      continuous(f, `${type} wall`, r);
      for (const rolls of [{ restitution: 0, angle: 0 }, { restitution: 0.99, angle: 0.99 }]) {
        expect(planFallToFloor(start, type, [], rolls), `${type}: wall rebound ignores bounce rolls`).toEqual(f);
      }
    }
    // 모서리: 두 축에 동시에 닿으면 한 번에 두 축 반사
    {
      const f = planFallToFloor({ t: 0, x: 140, y: 140, z: 40, vx: 100, vy: 100, vz: 0 }, 'POLLEN');
      const b = f.segments[1];
      assert(f.segments.length === 2 && near(b.x, FIELD_SIZE - R_POLLEN, 1e-9) && near(b.y, FIELD_SIZE - R_POLLEN, 1e-9), 'corner contact');
      assert(near(b.vx, -E(100), 1e-9) && near(b.vy, -E(100), 1e-9), 'both axes reflected at once');
      continuous(f, 'corner');
    }
    // 반대쪽 벽: 빠른 공은 반사 뒤 반대쪽 벽에도 닿아 다시 반사 (HIVE를 비켜 가는 y = 10 줄)
    {
      const f = planFallToFloor({ t: 0, x: 140, y: 10, z: 40, vx: 1500, vy: 0, vz: 0 }, 'POLLEN');
      const [, b, c] = f.segments;
      assert(f.segments.length === 3 && near(b.vx, -E(1500), 1e-9) && near(c.x, R_POLLEN, 1e-9) && near(c.vx, E(E(1500)), 1e-9), 'second rebound off the opposite wall');
      continuous(f, 'opposite wall');
    }
    // 반사 상한: FIELD_WALL_MAX_BOUNCES회 반사 뒤의 벽 접촉은 v1처럼 수평 정지 후 수직 낙하 (착지 속도 0)
    {
      const f = planFallToFloor({ t: 0, x: 140, y: 10, z: 40, vx: 1e5, vy: 0, vz: 0 }, 'POLLEN');
      const segs = f.segments;
      const last = segs[segs.length - 1];
      assert(segs.length === FIELD_WALL_MAX_BOUNCES + 2, `${FIELD_WALL_MAX_BOUNCES} rebounds, then a stop at the next wall (${segs.length} segments)`);
      for (let i = 1; i <= FIELD_WALL_MAX_BOUNCES; i++) assert(Math.sign(segs[i].vx) === (i % 2 === 1 ? -1 : 1), `rebound ${i} alternates direction`);
      assert(last.vx === 0 && last.vy === 0 && f.landingVx === 0 && f.landingVy === 0 && (near(last.x, R_POLLEN, 1e-9) || near(last.x, FIELD_SIZE - R_POLLEN, 1e-9)), 'beyond the cap: drops straight down at the wall');
      continuous(f, 'cap');
    }
    // 반사 뒤 HIVE 재충돌: 벽에서 튕겨 HIVE 옆면(+x 면)에 공중에서 닿으면 옆면 규칙으로 다시 튕김 (반사 산포 난수도 그 규칙대로)
    {
      const start: FlightState = { t: 0, x: 140, y: 72, z: 20, vx: 300, vy: 0, vz: 100 };
      const f = planFallToFloor(start, 'POLLEN');
      const [, toHive, fromHive] = f.segments;
      const contact = flightSegmentPoint(toHive, toHive.t1);
      assert(f.segments.length === 3 && near(toHive.vx, -E(300), 1e-9) && near(contact.x, box.maxX, 1e-9) && contact.z < HIVE_HEIGHT + R_POLLEN, 'wall rebound reaches the HIVE side in the air');
      assert(near(fromHive.vx, HIVE_BOUNCE_MIN_SPEED > E(E(300)) ? HIVE_BOUNCE_MIN_SPEED : E(E(300)), 1e-9), 'side rule: −e·vn (outward speed at least the minimum)');
      assert(f.landing.x > box.maxX, 'lands between the HIVE and the wall');
      continuous(f, 'wall -> HIVE');
      const turned = planFallToFloor(start, 'POLLEN', [], { restitution: 0.5, angle: 0 });
      assert(turned.segments[2].vy !== 0, 'the HIVE re-contact uses the shot\'s bounce rolls');
      // 같은 높이에서 HIVE 위로 넘어가면 (높은 공) 재충돌 없음
      const over = planFallToFloor({ ...start, z: 60, vz: 250 }, 'POLLEN');
      const crossing = over.segments[1];
      assert(near(flightSegmentPoint(crossing, crossing.t1).x, R_POLLEN, 1e-9), 'high rebound: flies over the HIVE to the opposite wall (no HIVE contact)');
      continuous(over, 'over the HIVE');
    }
    // HIVE 옆면 반사 → 벽 반사 → HIVE 재충돌 사슬 / 무효 명중 낙하도 같은 낙하 규칙
    {
      const f = planHiveBounce({ t: 0, x: box.maxX, y: 72, z: 30, vx: -400, vy: 0, vz: 150 }, 'SIDE', 'POLLEN');
      assert(f.segments.length >= 2 && near(flightSegmentPoint(f.segments[0], f.segments[0].t1).x, FIELD_SIZE - R_POLLEN, 1e-9), 'HIVE rebound then reaches the wall');
      assert(f.segments[1].vx < 0, 'wall rebound heads back toward the HIVE');
      continuous(f, 'HIVE -> wall');
    }
    // 발사 비행 계획: 벽 접촉 = 명목 구간 끝, 이후 반사 구간 (결과는 첫 접촉 기준 MISS_FLOOR), 막히지 않은 바닥 착지는 그대로
    {
      const FIXED = { turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] };
      const shot = (x: number, y: number, heading: number) =>
        planShotFlight({ robotX: x, robotY: y, robotHeading: heading, shooter: FIXED, ballistics: DEFAULT_SHOOTER_BALLISTICS, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit: false });
      const corner = shot(120, 120, Math.PI / 4);
      const vh = corner.v0 * Math.cos(corner.pitch);
      const s0 = corner.segments[0];
      assert(corner.result === 'MISS_FLOOR' && near(corner.to.x, FIELD_SIZE - R_POLLEN, 1e-9) && near(corner.to.y, FIELD_SIZE - R_POLLEN, 1e-9), 'diagonal shot hits the corner');
      assert(near(s0.vx, -E(vh * Math.cos(Math.PI / 4)), 1e-9) && near(s0.vy, -E(vh * Math.sin(Math.PI / 4)), 1e-9), 'corner: both axes reflected');
      assert(corner.landingVx < 0 && corner.landingVy < 0 && near(corner.flightTime, corner.segments[corner.segments.length - 1].t1, 1e-12), 'lands back toward the field, arrival = final landing');
    }

    function E(v: number) {
      return PIECE_PHYSICS.POLLEN.restitution * v;
    }
  });
});

describe('실제 궤적 명중 판정 (12-11)', () => {
  it('W. 편차 궤적 1개 = 몬테카를로 샘플 1개, 명중 = 투입구 통과점, 고정형 / 터렛형 조준 범위 컷 없음, 고정 결과 판정', () => {
    const v0 = sweetSpotLaunchSpeed(MC)!;
    const { x, y } = MC.sweetSpot;
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const facing = bearingTo(x, y, aim.x, aim.y);
    const FIXED = { turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] };
    const ballistics: ShooterBallistics = { dz: MC.dz, shooterPitch: MC.shooterPitch, shooterOffset: MC.shooterOffset, v0 };
    const nominalAt = (heading: number, shooter: typeof FIXED | { turretType: 'TURRET'; turretRange: [number, number] } = FIXED) =>
      nominalShot({ robotX: x, robotY: y, robotHeading: heading, shooter, ballistics, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL' }).trajectory;
    const noise = shotNoiseOf(MC);
    const input = (nominal: Trajectory, rolls: number[]) => ({ robotId: 'robot1' as const, pieceType: 'POLLEN' as const, alliance: 'RED' as const, upwardCell: 'AUDIENCE_CELL' as const, nominal, noise, rolls });
    const rate = (nominal: Trajectory, n: number, rng: () => number) => {
      let hits = 0;
      for (let i = 0; i < n; i++) if (judgeShotTrajectory(input(nominal, Array.from({ length: RNG_DRAWS_PER_SAMPLE }, rng))).hit) hits++;
      return hits / n;
    };

    // 기본 편차값 / 같은 난수 스트림이면 판정 명중 수 = 몬테카를로 명중 수 (샘플 단위로 같은 궤적, 정면 조준)
    expect(noise).toEqual({ v0NoisePercent: 0.02, headingNoiseRad: 0.02, pitchNoiseRad: 0.006 });
    const onTarget = rate(nominalAt(facing), 2000, createRng(7));
    assert(onTarget === estimateHitRate(x, y, v0, MC, 'POLLEN', 2000, createRng(7)), `judge = Monte Carlo sample (${onTarget})`);
    // perturbTrajectory: 발사구 그대로, 방향 / 속도 / 발사각만 (편차 0이면 명목 궤적 그대로)
    const nominal = nominalAt(facing);
    const p = perturbTrajectory(nominal, noise, createRng(5));
    assert(p.x === nominal.x && p.y === nominal.y && p.z === nominal.z && p.heading !== nominal.heading && p.v0 !== nominal.v0 && p.pitch !== nominal.pitch, 'noise on the direction only');
    expect(perturbTrajectory(nominal, NO_NOISE, createRng(5))).toEqual(nominal);

    // 명중 = 통과점 (궤적 위, 투입구 평면 위), isShotInHiveCell과 일치. 같은 난수 = 같은 결과
    const rng = createRng(11);
    let crossings = 0;
    for (let i = 0; i < 300; i++) {
      const rolls = Array.from({ length: RNG_DRAWS_PER_SAMPLE }, rng);
      const j = judgeShotTrajectory(input(nominal, rolls));
      expect(judgeShotTrajectory(input(nominal, rolls))).toEqual(j);
      assert(j.hit === isShotInHiveCell(j.trajectory, 'RED', 'AUDIENCE_CELL', PIECE_PHYSICS.POLLEN.radius) && j.hit === (j.crossing !== null), 'hit = isShotInHiveCell = crossing');
      if (!j.crossing) continue;
      crossings++;
      const c = j.crossing, t = j.trajectory;
      const vh = t.v0 * Math.cos(t.pitch);
      assert(near(c.x, t.x + vh * Math.cos(t.heading) * c.t, 1e-9) && near(c.y, t.y + vh * Math.sin(t.heading) * c.t, 1e-9)
        && near(c.z, t.z + t.v0 * Math.sin(t.pitch) * c.t - 0.5 * GRAVITY * c.t * c.t, 1e-9), 'crossing lies on the trajectory');
      // 투입구 평면 (림에서 셀 기울기만큼 기운 면, AUDIENCE: y가 림에서 HIVE 쪽으로 줄어듦)
      assert(near((c.z - HIVE_RIM_Z) / Math.tan(HIVE_CELL_TILT), HIVE_RIM_Y.AUDIENCE_CELL - c.y, 1e-6), 'crossing lies on the opening plane');
    }
    assert(crossings > 200, `most sweet-spot shots cross the opening (${crossings} / 300)`);
    assert(hiveCellCrossing({ ...nominal, pitch: deg(10) }, 'RED', 'AUDIENCE_CELL', PIECE_PHYSICS.POLLEN.radius) === null, 'low shot -> no crossing');

    // 고정형: 이전 허용 오차(3°) 밖도 궤적이 들어가면 명중 — 각도가 커질수록 줄어듦
    const off5 = rate(nominalAt(facing + deg(5)), 2000, createRng(9));
    const off10 = rate(nominalAt(facing + deg(10)), 2000, createRng(9));
    const off30 = rate(nominalAt(facing + deg(30)), 500, createRng(9));
    assert(off5 > 0.5 && off5 <= onTarget + 0.02 && off10 < off5 && off30 === 0, `FIXED off aim: 5° ${off5}, 10° ${off10}, 30° ${off30}`);
    // 터렛형: 범위 밖이면 가까운 한계각으로 쏘고 그 궤적으로 판정 (범위 밖 = 0 아님)
    const turret = { turretType: 'TURRET' as const, turretRange: [deg(3), deg(30)] as [number, number] };
    const tn = nominalAt(facing, turret);
    assert(near(tn.heading, facing + deg(3), 1e-9) && rate(tn, 2000, createRng(9)) > 0.5, 'TURRET out of range fires at the nearest limit and can hit');

    // 고정 결과 판정: 명목 궤적 그대로 (복사), 명중 = 첫 난수 < p, 통과점 없음
    const fixed = fixedRateShotJudge(0.5);
    const hitJ = fixed(input(nominal, [0.3, 0, 0, 0, 0, 0]));
    assert(hitJ.hit && !fixed(input(nominal, [0.7, 0, 0, 0, 0, 0])).hit && hitJ.crossing === null && hitJ.trajectory !== nominal, 'fixed judge: roll < p, no crossing');
    expect(hitJ.trajectory).toEqual(nominal);
    assert(fixedRateShotJudge(1)(input(nominal, [0.999, 0, 0, 0, 0, 0])).hit && !fixedRateShotJudge(0)(input(nominal, [0, 0, 0, 0, 0, 0])).hit, 'p = 1 always hits, p = 0 never');
    assert(fixedRateShotJudge(({ pieceType }) => (pieceType === 'POLLEN' ? 1 : 0))(input(nominal, [0.5, 0, 0, 0, 0, 0])).hit, 'per-shot probability function');
  });

  it('X. 비행 계획: 판정한 궤적으로 비행, 명중은 통과점 도착 (통과점이 없으면 조준점), 빗맞음은 그 궤적의 충돌 규칙', () => {
    const v0 = sweetSpotLaunchSpeed(MC)!;
    const { x, y } = MC.sweetSpot;
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const facing = bearingTo(x, y, aim.x, aim.y);
    const base = {
      robotX: x, robotY: y, robotHeading: facing, shooter: { turretType: 'FIXED' as const, turretRange: [0, 0] as [number, number] },
      ballistics: { dz: MC.dz, shooterPitch: MC.shooterPitch, shooterOffset: MC.shooterOffset, v0 }, pieceType: 'POLLEN' as const, alliance: 'RED' as const, upwardCell: 'AUDIENCE_CELL' as const,
    };
    const nominal = nominalShot(base).trajectory;
    // 명목 궤적: planShotFlight 기본값과 같음
    const plain = planShotFlight({ ...base, hit: false });
    assert(plain.heading === nominal.heading && plain.v0 === nominal.v0 && plain.from.x === nominal.x, 'planShotFlight without a trajectory = nominal');
    // 명중으로 판정된 편차 궤적 하나 찾기
    const rng = createRng(21);
    let judged = judgeShotTrajectory({ robotId: 'robot1', pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', nominal, noise: shotNoiseOf(MC), rolls: Array.from({ length: 6 }, rng) });
    for (let i = 0; i < 50 && !judged.hit; i++) judged = judgeShotTrajectory({ robotId: 'robot1', pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', nominal, noise: shotNoiseOf(MC), rolls: Array.from({ length: 6 }, rng) });
    const c = judged.crossing!;
    const hit = planShotFlight({ ...base, hit: true, trajectory: judged.trajectory, crossing: c });
    assert(hit.result === 'HIT' && hit.to.x === c.x && hit.to.y === c.y && hit.to.z === c.z && hit.contactTime === c.t && hit.flightTime === c.t, 'hit arrives at the crossing');
    assert(hit.landing.x === c.x && hit.landing.y === c.y && hit.heading === judged.trajectory.heading && hit.v0 === judged.trajectory.v0 && hit.pitch === judged.trajectory.pitch, 'flight record = judged trajectory');
    // 통과점이 없는 명중(고정 결과 판정) = 조준점 (v1과 같은 규칙)
    const atAim = planShotFlight({ ...base, hit: true, trajectory: nominal, crossing: null });
    assert(near(atAim.to.x, aim.x, 1e-9) && near(atAim.to.z, aim.z, 1e-9), 'no crossing -> aim point');
    // 같은 궤적을 빗맞음으로 처리(TIP 중 발사): 투입구 쪽 HIVE 직육면체 충돌로 튕김
    const voided = planShotFlight({ ...base, hit: false, trajectory: judged.trajectory });
    assert(voided.result === 'MISS_HIVE' && voided.segments.length > 0, 'entering trajectory as a miss bounces off the HIVE box');
    // 무효 명중 반사: 도착점(통과점)에서 시작, 도착 수평 방향 = 궤적 방향
    const after = planVoidedHitBounce({ from: hit.from, aim: hit.to, v0: hit.v0, pitch: hit.pitch, contactTime: hit.contactTime, targetCell: 'AUDIENCE_CELL', pieceType: 'POLLEN' });
    assert(after.segments.length > 0 && near(after.segments[0].x, c.x, 1e-9) && near(after.segments[0].y, c.y, 1e-9), 'voided hit bounces from the crossing point');
  });
});
