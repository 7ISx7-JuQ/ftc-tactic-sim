// 로봇 동선 (명세서 3.7 표시 옵션 robotPath, 16-3)
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../../core/collision';
import { fixedRateShotJudge } from '../../core/ballistics';
import { SimulationEngine } from '../../core/simulationEngine';
import type { RobotConfig } from '../../core/types';
import { ROBOT_PATH_STEP, robotPaths } from '../robotPath';

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], flowerSetupDelay: 500, flowerDropDelay: 200,
  shooterSetup: 'SHARED', nectarShooter: { shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0] }, flowerDropZones: [], liftMaxSpeed: 0, maxControlledPieces: 4,
});
// R1은 300틱 동안 움직이고 멈춤, R2는 처음부터 끝까지 제자리
const run = (ticks: number) => {
  const e = new SimulationEngine(cfg('robot1'), cfg('robot2'), fixedRateShotJudge(0.5), 'RED', { allianceColor: 'RED' });
  while (e.currentTick < ticks) e.step(e.currentTick < 300 ? { targetVx: 30 * Math.cos(e.currentTick / 40), targetVy: 30 * Math.sin(e.currentTick / 40), targetOmega: 0, actionState: 'IDLE' } : undefined);
  return e.timeline;
};
const at = (frames: ReturnType<typeof run>, t: number) => ({ x: frames[t].r1.x, y: frames[t].r1.y });

describe('로봇 동선 (16-3)', () => {
  it('A. 지나온 동선 = 0틱 ~ 보는 틱, 앞으로 갈 동선 = 보는 틱 ~ 머리, 보는 틱의 점을 함께 가짐', () => {
    const frames = run(600);
    const paths = robotPaths(frames, 101)!;
    const { past, future } = paths.robot1;
    expect(past[0]).toEqual(at(frames, 0));
    expect(past.at(-1)).toEqual(at(frames, 101)); // 표본 간격과 무관하게 보는 틱에서 끝남 (선 끝 = 로봇 중심)
    expect(future[0]).toEqual(at(frames, 101));
    expect(future.at(-1)).toEqual(at(frames, 600));
    expect(past).toHaveLength(Math.ceil(101 / ROBOT_PATH_STEP) + 1); // 움직이는 동안은 표본마다 점
    expect(past[1]).toEqual(at(frames, ROBOT_PATH_STEP));
  });

  it('B. 제자리 점은 건너뜀: 멈춘 구간 / 움직이지 않는 로봇은 점 1개', () => {
    const frames = run(1000);
    const paths = robotPaths(frames, 1000)!;
    expect(paths.robot2.past).toHaveLength(1); // 처음부터 제자리
    expect(paths.robot2.future).toHaveLength(1);
    const moving = robotPaths(frames, 300)!.robot1;
    expect(moving.future.length).toBeLessThan(5); // 300틱 뒤 감속 후 정지
    expect(robotPaths(frames, 1000)!.robot1.past.length).toBeLessThan(300 / ROBOT_PATH_STEP + 10);
  });

  it('C. 보는 틱 자르기 / 끝 / 빈 기록', () => {
    const frames = run(200);
    const start = robotPaths(frames, -5)!.robot1;
    expect(start.past).toEqual([at(frames, 0)]);
    expect(start.future.at(-1)).toEqual(at(frames, 200));
    const head = robotPaths(frames, 999)!.robot1;
    expect(head.past.at(-1)).toEqual(at(frames, 200));
    expect(head.future).toEqual([at(frames, 200)]);
    expect(robotPaths(frames, Number.NaN)!.robot1.past).toHaveLength(1);
    expect(robotPaths([], 0)).toBeNull();
  });

  it('D. (17-1a) 나눔 점 지정: 지나온 동선 = 0 ~ 보는 틱 + 그 점, 앞으로 갈 동선 = 그 점 + 다음 틱 ~ 머리, 보는 틱 = 머리면 무시', () => {
    const frames = run(300);
    const a = at(frames, 101), b = at(frames, 102);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const still = { x: frames[101].r2.x, y: frames[101].r2.y };
    const paths = robotPaths(frames, 101, { robot1: mid, robot2: still })!;
    const plain = robotPaths(frames, 101)!;
    expect(paths.robot1.past).toEqual([...plain.robot1.past, mid]);
    expect(paths.robot1.future[0]).toEqual(mid);
    expect(paths.robot1.future[1]).toEqual(b);
    expect(paths.robot1.future.at(-1)).toEqual(at(frames, 300));
    expect(paths.robot2).toEqual(plain.robot2); // 제자리 로봇: 같은 점은 건너뜀
    const head = robotPaths(frames, 300, { robot1: mid, robot2: still })!;
    expect(head).toEqual(robotPaths(frames, 300));
  });
});
