import { describe, expect, it } from 'vitest';
import {
  bearingTo,
  createAimTrajectory,
  createRng,
  descendingDistanceAtHeight,
  estimateHitRate,
  generateReferenceLUT,
  generateRobotLUTs,
  heightAtDistance,
  intersectHiveBox,
  isShotInHiveCell,
  LUT_GRID_SIZE,
  lutCellCenter,
  lutIndex,
  lutGridIndex,
  mirrorLUTSet,
  searchLaunchSpeed,
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
import { GRAVITY, HIVE_AABB, HIVE_CELL_TILT, HIVE_CENTER_X, HIVE_HEIGHT, HIVE_RIM_Y, HIVE_RIM_Z, PIECE_PHYSICS, hiveCellAimPoint } from '../collision';
import type { BallisticsConfig } from '../types';

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
const SIZE = { length: 18, width: 18 };
const R_NECTAR = PIECE_PHYSICS.NECTAR.radius;

describe('몬테카를로 / LUT 생성 (06-3)', () => {
  it('F. 투입구 명중 판정 (isShotInHiveCell)', () => {
    // 4셀 대칭: 대칭 위치에서 각 셀 조준점을 정확히 지나는 궤적은 명중
    for (const [alliance, cell, x, y] of [['RED', 'AUDIENCE_CELL', 59.25, 130], ['RED', 'OPPOSITE_CELL', 59.25, 14], ['BLUE', 'AUDIENCE_CELL', 84.75, 130], ['BLUE', 'OPPOSITE_CELL', 84.75, 14]] as const) {
      const traj = shotAt(x, y, hiveCellAimPoint(alliance, cell));
      assert(isShotInHiveCell(traj, alliance, cell, R_POLLEN), `aim point hit ${alliance} ${cell}`);
      const other = cell === 'AUDIENCE_CELL' ? 'OPPOSITE_CELL' : 'AUDIENCE_CELL';
      assert(!isShotInHiveCell(traj, alliance, other, R_POLLEN), `not counted for the other cell ${alliance} ${other}`);
    }
    // 원거리 대각 사격 (발사각 60°): 공이 내려오며 입구에 들어가므로 림 통과 높이와 무관하게 변 판정만 검사
    const FC: BallisticsConfig = { ...BC, shooterPitch: deg(60) };
    const hit = (u: number, s: number, r = R_POLLEN) => isShotInHiveCell(shotAt(20, 140, openingPoint('RED', 'AUDIENCE_CELL', u, s), FC), 'RED', 'AUDIENCE_CELL', r);
    // 좌우 세로 변: 반폭 10 - r (POLLEN 8.6, NECTAR 8.2)
    assert(hit(8.55, 3) && !hit(8.65, 3) && hit(-8.55, 3) && !hit(-8.65, 3), 'side edges inset by POLLEN radius');
    assert(hit(8.4, 3, R_POLLEN) && !hit(8.4, 3, R_NECTAR), 'NECTAR (larger) needs more margin than POLLEN');
    // 밑변(림): s ≥ r
    assert(!hit(0, 0.7) && hit(0, 2), 'bottom edge (rim) inset by radius');
    // 삼각형 빗변: 중심선에서 s ≤ 14 - r·√(6.39² + 10²) / 10 ≈ 12.34
    assert(hit(0, 12.2) && !hit(0, 12.5), 'slanted edges inset by radius');
    // 너무 짧게 / 길게 쏜 공은 빗맞음
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const base = shotAt(20, 140, aim, FC);
    assert(!isShotInHiveCell({ ...base, v0: base.v0 * 0.9 }, 'RED', 'AUDIENCE_CELL', R_POLLEN) && !isShotInHiveCell({ ...base, v0: base.v0 * 1.2 }, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'short / long shots miss');
    // 뒷면 통과: HIVE 반대편(Opposite 쪽)에서 쏜 공은 조준점을 지나도 빗맞음
    assert(!isShotInHiveCell(shotAt(59.25, 20, aim), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'crossing from the back side is a miss');
    // 근거리 상승 사격 (BC: 거리 약 35 in, 도달 시 아직 상승 중): 입구 아래쪽(s = 3)을 노리면 림에 걸리고, 가운데는 명중
    {
      const low = shotAt(59.25, 130, openingPoint('RED', 'AUDIENCE_CELL', 0, 3));
      assert(heightAtDistance(low, low.y - HIVE_RIM_Y.AUDIENCE_CELL) < HIVE_RIM_Z + R_POLLEN && !isShotInHiveCell(low, 'RED', 'AUDIENCE_CELL', R_POLLEN), 'rising shot to the lower opening clips the rim');
      assert(isShotInHiveCell(shotAt(59.25, 130, openingPoint('RED', 'AUDIENCE_CELL', 0, 7)), 'RED', 'AUDIENCE_CELL', R_POLLEN), 'rising shot to the mid opening clears the rim');
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
    const v0 = sweetSpotLaunchSpeed(BC)!;
    const { x, y } = BC.sweetSpot;
    assert(estimateHitRate(x, y, v0, { ...BC, ...NO_NOISE }, 'POLLEN', 50, createRng(1)) === 1, 'no noise + closed-form v0 -> 100%');
    const p1 = estimateHitRate(x, y, v0, BC, 'POLLEN', 2000, createRng(7));
    assert(p1 === estimateHitRate(x, y, v0, BC, 'POLLEN', 2000, createRng(7)), 'same seed -> same rate');
    assert(p1 > 0.5 && p1 < 1, `noisy rate at sweet spot in (0.5, 1): ${p1}`);
    // 같은 난수 스트림이면 같은 궤적이므로 NECTAR(반지름 큼) 명중은 POLLEN 명중의 부분집합
    assert(estimateHitRate(x, y, v0, BC, 'NECTAR', 2000, createRng(7)) <= p1, 'NECTAR rate ≤ POLLEN rate for identical samples');
    // 점대칭 (RED_AUDIENCE ↔ BLUE_OPPOSITE): 180° 회전이면 편차 부호가 보존되어 샘플 단위로 일치
    const pb = estimateHitRate(144 - x, 144 - y, v0, BC, 'POLLEN', 2000, createRng(7), 'BLUE', 'OPPOSITE_CELL');
    assert(Math.abs(pb - p1) <= 2 / 2000, `point-symmetric rate equal (${p1} vs ${pb})`);
    // 조준점에서 멀리 떨어지면 (고정 v0) 명중률 0
    assert(estimateHitRate(x, y - 10, v0, BC, 'POLLEN', 500, createRng(3)) === 0, 'off the sweet distance (10 in closer) -> 0');
    // PRNG: [0, 1) 균일, 시드별 스트림
    const r = createRng(123);
    const xs = Array.from({ length: 1000 }, r);
    assert(xs.every(v => v >= 0 && v < 1) && Math.abs(xs.reduce((a, b) => a + b, 0) / 1000 - 0.5) < 0.05, 'rng uniform in [0, 1)');
    assert(createRng(123)() === xs[0] && createRng(124)() !== xs[0], 'rng seeded');
  });

  it('H. v0 탐색 (searchLaunchSpeed)', () => {
    const closed = sweetSpotLaunchSpeed(BC)!;
    // 편차 없음: 닫힌 해에서 이미 100%이고 동률은 닫힌 해 우선 → 닫힌 해 그대로
    const exact = searchLaunchSpeed({ ...BC, ...NO_NOISE }, 'POLLEN', 50)!;
    assert(exact.v0 === closed && exact.hitRate === 1, `no noise -> closed-form v0 kept (${exact.v0} vs ${closed})`);
    // 편차 있음: 탐색 결과는 닫힌 해 ±21% 이내, 닫힌 해 명중률 이상 (같은 시드 공통 난수)
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const found = searchLaunchSpeed(BC, type, 1000, 99)!;
      const atClosed = estimateHitRate(BC.sweetSpot.x, BC.sweetSpot.y, closed, BC, type, 1000, createRng(99));
      assert(Math.abs(found.v0 / closed - 1) <= 0.21 + 1e-9, `${type} v0 within search range (${found.v0 / closed})`);
      assert(found.hitRate >= atClosed && found.hitRate > 0.5, `${type} search improves on closed form (${atClosed} -> ${found.hitRate})`);
      const again = searchLaunchSpeed(BC, type, 1000, 99)!;
      assert(again.v0 === found.v0 && again.hitRate === found.hitRate, `${type} deterministic`);
    }
    assert(searchLaunchSpeed({ ...BC, sweetSpot: { x: 59.25, y: 100 }, shooterOffset: 0, shooterPitch: deg(30) }, 'POLLEN') === null, 'no closed form -> null');
  });

  it('I. 탄도 설정 / 스윗스팟 검증', () => {
    const codes = (cfg: BallisticsConfig, size = SIZE) => validateBallisticsConfig(cfg, size).map(i => i.code).join();
    // 검증은 격자 중심으로 스냅한 스윗스팟 기준: y 134.9 → 135 (몸체가 벽을 넘음), y 133.9 → 133 (필드 안)
    assert(codes({ ...BC, sweetSpot: { x: 59.25, y: 134.9 } }) === 'SWEET_SPOT_OUT_OF_FIELD' && codes({ ...BC, sweetSpot: { x: 59.25, y: 133.9 } }) === '', 'validation uses snapped sweet spot');
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
      for (const [gx, gy] of [[0, 0], [3, 70], [71, 5], [29, 64]]) {
        ok &&= set.RED_AUDIENCE[lutIndex(gx, gy)] === ref[lutIndex(gx, gy)]
          && set.RED_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(gx, n - 1 - gy)]
          && set.BLUE_AUDIENCE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, gy)]
          && set.BLUE_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, n - 1 - gy)];
      }
      assert(ok && set.RED_AUDIENCE !== ref, 'mirror index mapping (y = 72, x = 72, point symmetry), reference copied');
      assert(lutCellCenter(0) === 1 && lutCellCenter(71) === 143 && lutIndex(1, 2) === 2 * n + 1, 'grid centers / index');
      assert(lutGridIndex(0) === 0 && lutGridIndex(1.99) === 0 && lutGridIndex(2) === 1 && lutGridIndex(144) === 71 && lutGridIndex(-5) === 0 && lutGridIndex(NaN) === 0, 'grid index clamp');
      const ss = snapSweetSpot({ x: 59.25, y: 130 });
      assert(ss.x === 59 && ss.y === 131, `sweet spot snapped to grid center (${ss.x}, ${ss.y})`);
    }
    // 로봇 1대 LUT 8장 (샘플 수를 줄여 빠르게)
    const opts = { samples: 40, searchSamples: 300, seed: 5 };
    const res = generateRobotLUTs(BC, SIZE, opts);
    assert(res.issues.length === 0 && res.v0.POLLEN !== null && res.v0.NECTAR !== null, 'valid -> v0 per piece type');
    assert(res.sweetSpotHitRate.POLLEN > 0.5 && res.sweetSpotHitRate.NECTAR > 0.5, `sweet spot hit rates ${JSON.stringify(res.sweetSpotHitRate)}`);
    for (const type of ['POLLEN', 'NECTAR'] as const) {
      const set = res.luts[type];
      const ref = set.RED_AUDIENCE;
      assert(Object.values(set).every(l => l.length === n * n && l.every(v => v >= 0 && v <= 1)), `${type} 4 LUTs of 72x72 in [0, 1]`);
      let mirrored = true;
      for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
        mirrored &&= set.RED_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(gx, n - 1 - gy)] && set.BLUE_OPPOSITE[lutIndex(gx, gy)] === ref[lutIndex(n - 1 - gx, n - 1 - gy)];
      }
      assert(mirrored, `${type} cells are exact mirrors of the reference`);
      // 기준 셀 LUT는 채택한 v0로 만든 generateReferenceLUT와 같음 (시드 파생 규칙 포함 결정론)
      assert(ref[lutIndex(36, 36)] === 0 && ref[lutIndex(29, 43)] === 0, `${type} robot overlapping HIVE -> 0`);
      // 스윗스팟 (59.25, 130) → 격자 (29, 65) 중심 (59, 131)에서 v0를 탐색하므로 그 격자 값이 높음
      const atSweet = ref[lutIndex(29, 65)];
      assert(atSweet > 0.5, `${type} high at the sweet spot grid (${atSweet})`);
      assert(ref[lutIndex(29, 70)] < atSweet && ref[lutIndex(29, 55)] === 0, `${type} falls off away from the sweet distance`);
    }
    const again = generateRobotLUTs(BC, SIZE, opts);
    assert(again.v0.POLLEN === res.v0.POLLEN && again.luts.NECTAR.BLUE_AUDIENCE.every((v, i) => v === res.luts.NECTAR.BLUE_AUDIENCE[i]), 'same seed -> identical LUTs');
    const other = generateRobotLUTs(BC, SIZE, { ...opts, seed: 6 });
    assert(other.luts.POLLEN.RED_AUDIENCE.some((v, i) => v !== res.luts.POLLEN.RED_AUDIENCE[i]), 'different seed -> different samples');
    const refA = generateReferenceLUT(BC, SIZE, 'POLLEN', res.v0.POLLEN!, 40, 11);
    const refB = generateReferenceLUT(BC, SIZE, 'POLLEN', res.v0.POLLEN!, 40, 11);
    assert(refA.every((v, i) => v === refB[i]), 'reference LUT deterministic');
    // 검증 실패: LUT 전부 0, v0 null
    const bad = generateRobotLUTs({ ...BC, sweetSpot: { x: 59.25, y: 96 } }, SIZE, opts);
    assert(bad.issues.length > 0 && bad.v0.POLLEN === null && Object.values(bad.luts.POLLEN).every(l => l.every(v => v === 0)), 'invalid -> all-zero LUTs');
  }, 60_000);
});

