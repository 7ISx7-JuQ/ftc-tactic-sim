import { describe, expect, it } from 'vitest';
import { bearingTo, DEFAULT_SHOOTER_BALLISTICS, heightAtDistance, solveAimLaunchSpeed } from '../../core/ballistics';
import { PIECE_PHYSICS, createIntakeZonePreset, hiveCellAimPoint } from '../../core/collision';
import { DT, SimulationEngine } from '../../core/simulationEngine';
import type { RobotDriveInput } from '../../core/simulationEngine';
import type { DeepReadonly, MatchShooterBallistics, PendingShot, RobotConfig, RobotPose } from '../../core/types';
import { airborneDisplay, shotElapsed, shotPositionAt, shotTrail } from '../flightView';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4,
});
const SHOOT: RobotDriveInput = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' };
const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
const facingAim = (x: number, y: number): RobotPose => ({ x, y, heading: bearingTo(x, y, aim.x, aim.y) });

// 엔진이 실제로 기록한 비행 1발 (R1이 15틱 발사)
function recordedShot(p: number, spawn: RobotPose, shooters?: MatchShooterBallistics): DeepReadonly<PendingShot> {
  const e = new SimulationEngine(cfg('robot1'), cfg('robot2'), () => p, 'RED', { allianceColor: 'RED', r1Spawn: spawn, r1Loadout: ['POLLEN'] }, shooters);
  for (let i = 0; i < 15; i++) e.step(SHOOT);
  return e.getFrame(15)!.field.pendingShots[0];
}

const R = PIECE_PHYSICS.POLLEN.radius;
const at = (shot: DeepReadonly<PendingShot>, t: number) => shotPositionAt(shot, t);
const endTime = (shot: DeepReadonly<PendingShot>) => (shot.segments.length ? shot.segments[shot.segments.length - 1].t1 : shot.contactTime);

describe('비행 공 표시 (명세서 3.7, 08-6)', () => {
  it('A. 명목 구간: 발사구 → to, 끝점 보정', () => {
    // 명중 + 탐색 v0 가정 (닫힌 해의 1.15배): 명목 포물선은 조준점을 비껴가지만 보정으로 끝점이 조준점과 일치
    const spawn = facingAim(60.5, 130.5);
    const closed = solveAimLaunchSpeed(spawn.x, spawn.y, aim, DEFAULT_SHOOTER_BALLISTICS)!;
    const fast = { ...DEFAULT_SHOOTER_BALLISTICS, v0: { POLLEN: closed * 1.15 } };
    const hit = recordedShot(1, spawn, { robot1: fast, robot2: DEFAULT_SHOOTER_BALLISTICS });
    const D = Math.hypot(hit.toX - hit.fromX, hit.toY - hit.fromY);
    const zNomEnd = heightAtDistance({ x: hit.fromX, y: hit.fromY, z: hit.fromZ, heading: hit.heading, v0: hit.v0, pitch: hit.pitch }, D);
    assert(hit.result === 'HIT' && Math.abs(zNomEnd - hit.toZ) > 1, `nominal parabola misses the aim height by ${(zNomEnd - hit.toZ).toFixed(1)} in (correction needed)`);
    const s0 = at(hit, 0);
    const s1 = at(hit, hit.contactTime);
    assert(near(s0.x, hit.fromX) && near(s0.y, hit.fromY) && near(s0.z, hit.fromZ), 't = 0: at the launch point');
    assert(near(s1.x, aim.x) && near(s1.y, aim.y) && near(s1.z, aim.z), 't = contact: exactly at the aim point');
    // 중간: 수평 중점, 높이 = 명목 포물선 + 끝점 오차의 절반 보정 (z(s) = z_nom(s·D) + s·(toZ − z_nom(D)))
    const mid = at(hit, hit.contactTime / 2);
    const zNomMid = heightAtDistance({ x: hit.fromX, y: hit.fromY, z: hit.fromZ, heading: hit.heading, v0: hit.v0, pitch: hit.pitch }, D / 2);
    assert(near(mid.x, (hit.fromX + hit.toX) / 2) && near(mid.y, (hit.fromY + hit.toY) / 2) && near(mid.z, zNomMid + 0.5 * (hit.toZ - zNomEnd)), 'halfway: horizontal midpoint, nominal height + half the end correction');
    assert(near(at(hit, -1).x, hit.fromX) && near(at(hit, 99).z, aim.z), 'time clamped to the nominal segment when there are no post-contact segments');
  });

  it('B. 충돌 후 구간 연속 / 착지 (HIVE 반사, 바닥 착지, 벽 낙하)', () => {
    const cases: [string, DeepReadonly<PendingShot>][] = [
      ['HIVE bounce', recordedShot(0, facingAim(60.5, 130.5))],
      ['open floor', recordedShot(0, { x: 72, y: 110, heading: 0 })],
      ['wall drop', recordedShot(0, { x: 125, y: 72, heading: 0 })],
    ];
    for (const [name, shot] of cases) {
      const c = at(shot, shot.contactTime);
      assert(near(c.x, shot.toX) && near(c.y, shot.toY) && near(c.z, shot.toZ), `${name}: nominal segment ends at the contact point`);
      if (shot.segments.length) {
        const after = at(shot, shot.contactTime + 1e-9);
        assert(Math.hypot(after.x - c.x, after.y - c.y, after.z - c.z) < 1e-5, `${name}: continuous into the post-contact segments (no jump)`);
      }
      const land = at(shot, endTime(shot));
      assert(near(land.x, shot.landX, 1e-6) && near(land.y, shot.landY, 1e-6) && near(land.z, R, 1e-6), `${name}: ends on the floor at the landing point`);
      assert(near(at(shot, endTime(shot) + 5).z, R, 1e-6), `${name}: after landing stays at the landing point`);
      // 프레임 틱 → 경과 시간
      assert(near(shotElapsed(shot, shot.launchTick + 10), 10 * DT), 'elapsed time from frame tick');
    }
    const [, bounce] = cases[0];
    assert(bounce.result === 'MISS_HIVE' && bounce.segments.length > 0 && at(bounce, (bounce.contactTime + endTime(bounce)) / 2).z > R, 'HIVE bounce: in the air between contact and landing');
    const [, wall] = cases[2];
    assert(wall.toZ > R && wall.segments.length === 1, 'wall: contact in the air, then a vertical drop');
  });

  it('C. 비행 잔상 / 높이 연출', () => {
    const shot = recordedShot(0, facingAim(60.5, 130.5));
    const t = shot.contactTime * 0.6;
    const trail = shotTrail(shot, t);
    const cur = at(shot, t);
    assert(near(trail[0].x, shot.fromX) && near(trail[0].z, shot.fromZ) && near(trail[trail.length - 1].x, cur.x) && near(trail[trail.length - 1].z, cur.z), 'trail: launch point to the current position');
    assert(trail.length === Math.ceil(t / DT) + 1, 'trail sampled every tick');
    const ground = airborneDisplay(0);
    const high = airborneDisplay(50);
    assert(ground.offset === 0 && ground.scale === 1 && near(high.offset, 15) && near(high.scale, 1.5) && airborneDisplay(-3).offset === 0, 'offset 0.3·z in, radius × (1 + z / 100), no negative height');
  });
});
