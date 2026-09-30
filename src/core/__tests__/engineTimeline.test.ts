// 가지 타임라인 API (명세서 3.9 분기 트리, 10-5): forkTimeline / adoptTimeline / currentTimeline
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../collision';
import { SimulationEngine } from '../simulationEngine';
import type { RobotDriveInput } from '../simulationEngine';
import type { RobotConfig } from '../types';

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4,
});
// 발사가 섞여 결과가 시드 PRNG에 의존 (난수 상태까지 가지별로 맞아야 같은 결과)
const drive = (t: number, phase: number): RobotDriveInput => ({
  targetVx: 50 * Math.sin(t / 43 + phase),
  targetVy: 35 * Math.cos(t / 61 + phase),
  targetOmega: 1.5 * Math.sin(t / 37 + phase),
  actionState: (t + phase * 97) % 400 < 150 ? 'INTAKING' : (t + phase * 97) % 400 < 190 ? 'SHOOTING' : 'IDLE',
});
const eng = () => new SimulationEngine(cfg('robot1'), cfg('robot2'), () => 0.6, 'RED', { allianceColor: 'RED', rngSeed: 7 });
const run = (e: SimulationEngine, until: number, phase = 0) => {
  while (e.currentTick < until) e.step(drive(e.currentTick, phase), drive(e.currentTick, phase + 1));
};
const json = (e: SimulationEngine, t: number) => JSON.stringify(e.getFrame(t));

describe('가지 타임라인 (10-5)', () => {
  it('A. 분기: 0 ~ T 프레임은 부모와 같은 객체(참조 공유), 부모 배열은 그대로 보존, 새 가지만 이어 기록', () => {
    const e = eng();
    run(e, 1000);
    const parent = e.currentTimeline;
    const parentFrames = [...parent.frames];
    const child = e.forkTimeline(400);
    expect(e.currentTick).toBe(400);
    expect(child.frames).toHaveLength(401);
    expect(child.frames.every((f, t) => f === parent.frames[t])).toBe(true);
    expect(e.timeline).toBe(child.frames);

    run(e, 700, 5); // 다른 입력으로 이어감
    expect(parent.frames).toHaveLength(1001);
    expect(parent.frames.every((f, t) => f === parentFrames[t])).toBe(true);
    expect(child.frames).toHaveLength(701);
    expect(child.frames[400]).toBe(parent.frames[400]);
    expect(JSON.stringify(child.frames[700])).not.toBe(JSON.stringify(parent.frames[700]));
  });

  it('B. 같은 입력으로 이어가면 부모와 같은 결과 (틱별 난수 상태도 공유 구간에서 이어받음)', () => {
    const e = eng();
    run(e, 1200);
    const parent = e.currentTimeline;
    e.forkTimeline(300);
    run(e, 1200); // 같은 입력
    for (let t = 300; t <= 1200; t += 50) expect(JSON.stringify(e.getFrame(t))).toBe(JSON.stringify(parent.frames[t]));
  });

  it('C. 전환: 보관한 타임라인을 설치하면 그 머리 상태로 복원되고 이어 기록 / 되감기 / 다시 분기 가능', () => {
    const e = eng();
    run(e, 800);
    const main = e.currentTimeline;
    const mainHead = json(e, 800);
    e.forkTimeline(200);
    run(e, 500, 3);
    const side = e.currentTimeline;
    const sideAt500 = json(e, 500);

    e.adoptTimeline(main);
    expect(e.currentTick).toBe(800);
    expect(e.timeline).toBe(main.frames);
    expect(e.currentTimeline.rngStates).toBe(main.rngStates); // 난수 상태도 그 가지 것 (이어 기록이 다른 가지 배열을 오염시키지 않음)
    expect(json(e, 800)).toBe(mainHead);
    run(e, 900); // 원본 가지를 이어 기록
    expect(main.frames).toHaveLength(901);
    expect(side.frames).toHaveLength(501); // 다른 가지는 그대로

    // 이어 기록한 결과 = 처음부터 끝까지 한 번에 진행한 결과 (전환 시 엔진 상태 / 난수 상태 복원이 정확)
    const straight = eng();
    run(straight, 900);
    expect(json(e, 900)).toBe(json(straight, 900));

    e.adoptTimeline(side);
    expect(e.currentTick).toBe(500);
    expect(json(e, 500)).toBe(sideAt500);
    const nested = e.forkTimeline(350);
    expect(nested.frames[350]).toBe(side.frames[350]);
    expect(nested.frames[100]).toBe(main.frames[100]); // 원본 구간도 여전히 공유
    expect(side.frames).toHaveLength(501);

    // 빈 타임라인은 무시
    e.adoptTimeline({ frames: [], rngStates: [] });
    expect(e.timeline).toBe(nested.frames);
  });
});
