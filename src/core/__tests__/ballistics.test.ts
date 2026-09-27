import { describe, expect, it } from 'vitest';
import {
  bearingTo,
  canPossiblyHit,
  createAimTrajectory,
  createLUTShotResolver,
  DEFAULT_SHOOTER_BALLISTICS,
  createRng,
  descendingDistanceAtHeight,
  estimateHitRate,
  generateReferenceLUT,
  generateRobotLUTs,
  heightAtDistance,
  hiveCellKey,
  intersectHiveBox,
  isAimWithinShooterRange,
  isShotInHiveCell,
  LUT_GRID_SIZE,
  lutCellCenter,
  lutIndex,
  lutGridIndex,
  mirrorLUTSet,
  planShotFlight,
  RNG_DRAWS_PER_SAMPLE,
  sampleLUT,
  searchLaunchSpeed,
  shooterBallisticsFrom,
  shotLaunchHeading,
  snapSweetSpot,
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
import type { Trajectory } from '../ballistics';
import { normalizeAngle } from '../kinematics';
import { FIELD_SIZE, GRAVITY, HIVE_AABB, HIVE_CELL_TILT, HIVE_CENTER_X, HIVE_HEIGHT, HIVE_RIM_Y, HIVE_RIM_Z, PIECE_PHYSICS, hiveCellAimPoint } from '../collision';
import type { BallisticsConfig, HeatmapLUTSet, HiveCellKey, MatchHeatmapLUTs, RobotConfig, ShooterBallistics } from '../types';

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

  it('N. LUT 명중 확률 판정 함수 (createLUTShotResolver)', () => {
    const n = LUT_GRID_SIZE;
    const KEYS: HiveCellKey[] = ['RED_AUDIENCE', 'RED_OPPOSITE', 'BLUE_AUDIENCE', 'BLUE_OPPOSITE'];
    // 로봇 / 기물 / 셀마다 다른 상수 LUT
    const expected = (robot: number, piece: number, cell: number) => 0.1 + 0.4 * robot + 0.2 * piece + 0.01 * (cell + 1);
    const constSet = (robot: number, piece: number) =>
      Object.fromEntries(KEYS.map((k, i) => [k, new Float32Array(n * n).fill(expected(robot, piece, i))])) as HeatmapLUTSet;
    const luts: MatchHeatmapLUTs = {
      robot1: { POLLEN: constSet(0, 0), NECTAR: constSet(0, 1) },
      robot2: { POLLEN: constSet(1, 0), NECTAR: constSet(1, 1) },
    };
    type Shooter = Pick<RobotConfig, 'turretType' | 'turretRange' | 'aimTolerance'>;
    const FIXED: Shooter = { turretType: 'FIXED', turretRange: [0, 0], aimTolerance: deg(3) };
    const resolver = createLUTShotResolver(luts, FIXED, FIXED);
    const x = 60.5, y = 120.5;
    const facing = (alliance: 'RED' | 'BLUE', cell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL') => { const a = hiveCellAimPoint(alliance, cell); return bearingTo(x, y, a.x, a.y); };

    // 슬롯 / 기물 / 진영 / 상향 셀 → 올바른 LUT
    assert(hiveCellKey('RED', 'AUDIENCE_CELL') === 'RED_AUDIENCE' && hiveCellKey('BLUE', 'OPPOSITE_CELL') === 'BLUE_OPPOSITE', 'cell key mapping');
    let mapped = true;
    (['robot1', 'robot2'] as const).forEach((id, ri) => (['POLLEN', 'NECTAR'] as const).forEach((type, pi) => KEYS.forEach((key, ci) => {
      const [alliance, side] = key.split('_') as ['RED' | 'BLUE', 'AUDIENCE' | 'OPPOSITE'];
      const cell = side === 'AUDIENCE' ? 'AUDIENCE_CELL' : 'OPPOSITE_CELL';
      mapped &&= near(resolver(id, type, x, y, facing(alliance, cell), alliance, cell), expected(ri, pi, ci), 1e-6);
    })));
    assert(mapped, 'resolver picks LUT by robot slot, piece type, alliance and upward cell');

    // 쌍선형 보간 조회 (선형 LUT는 격자 사이에서도 정확)
    {
      const linear = Float32Array.from({ length: n * n }, (_, i) => 0.001 * (i % n) + 0.002 * Math.floor(i / n));
      const lin: MatchHeatmapLUTs = { ...luts, robot1: { ...luts.robot1, POLLEN: { ...luts.robot1.POLLEN, RED_AUDIENCE: linear } } };
      const r = createLUTShotResolver(lin, FIXED, FIXED);
      const px = 60.8, py = 120.3;
      const a = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
      assert(near(r('robot1', 'POLLEN', px, py, bearingTo(px, py, a.x, a.y), 'RED', 'AUDIENCE_CELL'), 0.001 * (px - 0.5) + 0.002 * (py - 0.5), 1e-5), 'bilinear lookup at the robot center');
    }

    // 고정형: |Δψ| ≤ aimTolerance (경계 포함), 각도 감김, 비정상 허용 오차는 0으로 취급
    {
      const h = facing('RED', 'AUDIENCE_CELL');
      const p = (heading: number, s: Shooter = FIXED) => createLUTShotResolver(luts, s, s)('robot1', 'POLLEN', x, y, heading, 'RED', 'AUDIENCE_CELL');
      const P = expected(0, 0, 0);
      assert(near(p(h), P, 1e-6) && near(p(h + deg(3) - 1e-6), P, 1e-6) && near(p(h - deg(3) + 1e-6), P, 1e-6), 'FIXED within tolerance');
      assert(p(h + deg(3) + 1e-6) === 0 && p(h - deg(3) - 1e-6) === 0 && p(h + Math.PI) === 0, 'FIXED outside tolerance -> 0');
      assert(near(p(h + 2 * Math.PI), P, 1e-6) && near(p(h - 4 * Math.PI + deg(1)), P, 1e-6), 'heading wraps around');
      assert(near(p(h, { ...FIXED, aimTolerance: -1 }), P, 1e-6) && p(h + 1e-6, { ...FIXED, aimTolerance: -1 }) === 0 && p(h + 1e-6, { ...FIXED, aimTolerance: NaN }) === 0, 'invalid tolerance -> exact alignment only');
    }

    // 터렛형: Δψ = 조준점 방위 − 헤딩 (+ = 로봇 오른쪽, 캔버스 y-down), [α, β] 정규화, α > β는 ±π를 가로지름
    {
      const T = (range: [number, number]): Shooter => ({ turretType: 'TURRET', turretRange: range, aimTolerance: 0 });
      const within = (dPsi: number, range: [number, number]) => isAimWithinShooterRange(dPsi, T(range));
      assert(within(0, [-Math.PI / 2, Math.PI / 2]) && within(1.2, [-Math.PI / 2, Math.PI / 2]) && !within(Math.PI, [-Math.PI / 2, Math.PI / 2]), 'front half turret');
      assert(within(Math.PI, [2.5, -2.5]) && within(-Math.PI, [2.5, -2.5]) && within(2.6, [2.5, -2.5]) && !within(0, [2.5, -2.5]) && !within(2.4, [2.5, -2.5]), 'rear turret range crossing ±π');
      assert(within(2.6, [2.5 + 2 * Math.PI, -2.5 - 2 * Math.PI]) && !within(0, [2.5 + 2 * Math.PI, -2.5 - 2 * Math.PI]), 'turret range normalized');
      assert([-Math.PI, -2, 0, 2, Math.PI].every(d => within(d, [-Math.PI, Math.PI])), '360° turret');
      assert(!within(0, [NaN, 1]) && !within(NaN, [-Math.PI, Math.PI]), 'invalid range / angle -> not aimable');
      // 로봇 (60.5, 120.5)이 +x를 바라보면 조준점(위쪽, −y)은 로봇 왼쪽 → Δψ ≈ −π/2
      const p = (range: [number, number]) => createLUTShotResolver(luts, T(range), T(range))('robot1', 'POLLEN', x, y, 0, 'RED', 'AUDIENCE_CELL');
      assert(p([0, Math.PI]) === 0 && near(p([-Math.PI, 0]), expected(0, 0, 0), 1e-6), 'turret sign: + = robot right side');
    }

    // LUT 값이 비정상이면 0, 설정은 생성 시점에 복사 (이후 원본 변경 무시)
    {
      const bad: MatchHeatmapLUTs = { ...luts, robot2: { ...luts.robot2, NECTAR: { ...luts.robot2.NECTAR, RED_AUDIENCE: new Float32Array(n * n).fill(NaN) } } };
      assert(createLUTShotResolver(bad, FIXED, FIXED)('robot2', 'NECTAR', x, y, facing('RED', 'AUDIENCE_CELL'), 'RED', 'AUDIENCE_CELL') === 0, 'NaN LUT value -> 0');
      const mutable: Shooter = { ...FIXED };
      const r = createLUTShotResolver(luts, mutable, mutable);
      mutable.aimTolerance = 0;
      assert(near(r('robot1', 'POLLEN', x, y, facing('RED', 'AUDIENCE_CELL') + deg(2), 'RED', 'AUDIENCE_CELL'), expected(0, 0, 0), 1e-6), 'shooter settings snapshotted at creation');
    }
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
      assert(near(p.v0, solveAimLaunchSpeed(60.5, 130.5, aim, { ...DEFAULT_SHOOTER_BALLISTICS })!, 1e-9) && near(p.from.z, HIVE_RIM_Z - DEFAULT_SHOOTER_BALLISTICS.dz, 1e-12), 'auto shooter v0 = closed form to the aim point');
      const traj = { ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch };
      assert(near(heightAtDistance(traj, D), aim.z, 1e-9), 'nominal trajectory passes the aim point');
      // v0 우선순위: 기물별 지정값 > 닫힌 해 > 평지 사거리 = 조준점 거리
      assert(plan(60.5, 130.5, h, true, { ...DEFAULT_SHOOTER_BALLISTICS, v0: { POLLEN: 321 } }).v0 === 321, 'given v0 used');
      assert(near(plan(60.5, 130.5, h, true, { ...DEFAULT_SHOOTER_BALLISTICS, v0: { NECTAR: 321 } }).v0, p.v0, 1e-9), 'v0 of the other piece type ignored');
      const low = plan(59.5, 101.5, onAim(59.5, 101.5), true, { dz: 39.5, shooterPitch: deg(20), shooterOffset: 0 });
      const dLow = Math.hypot(aim.x - low.from.x, aim.y - low.from.y);
      assert(near(low.v0, Math.sqrt((GRAVITY * dLow) / Math.sin(2 * deg(20))), 1e-9), 'no closed form -> range-matched v0');
      assert(plan(60.5, 130.5, h, true, { dz: 39.5, shooterPitch: deg(95), shooterOffset: 0 }).pitch === DEFAULT_SHOOTER_BALLISTICS.shooterPitch, 'invalid pitch -> default pitch');
    }
    // 빗맞음 + HIVE 충돌: intersectHiveBox의 첫 접촉점
    {
      const p = plan(60.5, 130.5, onAim(60.5, 130.5), false);
      const box = intersectHiveBox({ ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch }, R_POLLEN)!;
      assert(p.result === 'MISS_HIVE' && box !== null && near(p.to.x, box.x, 1e-12) && near(p.to.y, box.y, 1e-12) && near(p.flightTime, box.time, 1e-12), 'miss -> first HIVE box contact');
    }
    // 빗맞음 + 바닥 착지: 사거리 지점, 수평 속도 × landingSpeedRetention (기물별)
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const p = plan(72, 110, 0, false, DEFAULT_SHOOTER_BALLISTICS, FIXED, type);
      const traj = { ...p.from, heading: p.heading, v0: p.v0, pitch: p.pitch };
      const R = landingDistance(traj, PIECE_PHYSICS[type].radius)!;
      const vh = p.v0 * Math.cos(p.pitch) * PIECE_PHYSICS[type].landingSpeedRetention;
      assert(p.result === 'MISS_FLOOR' && near(p.to.x, p.from.x + R, 1e-9) && near(p.to.z, PIECE_PHYSICS[type].radius, 1e-9) && near(p.landingVx, vh, 1e-9) && near(p.landingVy, 0, 1e-9), `${type} floor landing with retained speed`);
      assert(near(p.flightTime, timeAtDistance(traj, R), 1e-12), `${type} landing time`);
    }
    // 착지 전에 벽에 닿으면 벽 앞(반지름 여유)에서 정지
    {
      const p = plan(125, 72, 0, false);
      assert(p.result === 'MISS_FLOOR' && near(p.to.x, FIELD_SIZE - R_POLLEN, 1e-9) && p.landingVx === 0 && p.landingVy === 0, 'blocked by the wall -> stops at the wall');
    }
    // 터렛: 로봇이 반대쪽을 봐도 조준 방위로 발사
    {
      const p = plan(60.5, 130.5, onAim(60.5, 130.5) + Math.PI, true, DEFAULT_SHOOTER_BALLISTICS, TURRET([-Math.PI, Math.PI]));
      assert(near(p.heading, onAim(60.5, 130.5), 1e-12), '360° turret launches at the aim bearing');
    }
    // 생성 결과 → 엔진 슈터 탄도
    {
      const s = shooterBallisticsFrom(MC, { v0: { POLLEN: 200, NECTAR: null } } as Parameters<typeof shooterBallisticsFrom>[1]);
      assert(s.dz === MC.dz && s.shooterPitch === MC.shooterPitch && s.shooterOffset === MC.shooterOffset && s.v0?.POLLEN === 200 && s.v0?.NECTAR === undefined, 'shooterBallisticsFrom copies config and found v0');
    }
  });
});

