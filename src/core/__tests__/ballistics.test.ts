import { describe, expect, it } from 'vitest';
import {
  bearingTo,
  createAimTrajectory,
  descendingDistanceAtHeight,
  heightAtDistance,
  intersectHiveBox,
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
import { GRAVITY, HIVE_AABB, HIVE_HEIGHT, HIVE_RIM_Z, PIECE_PHYSICS, hiveCellAimPoint } from '../collision';
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
