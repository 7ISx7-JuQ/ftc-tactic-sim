// 렌더링 프레임 보간 (명세서 3.7 프레임 보간, 17-1a)
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../../core/collision';
import { fixedRateShotJudge } from '../../core/ballistics';
import { SimulationEngine } from '../../core/simulationEngine';
import type { DeepReadonly, RobotConfig, TimelineFrame } from '../../core/types';
import { interpolateFrame } from '../frameInterpolation';

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], flowerSetupDelay: 500, flowerDropDelay: 200,
  shooterSetup: 'SHARED', nectarShooter: { shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0] }, flowerDropZones: [], liftMaxSpeed: 0, maxControlledPieces: 4,
});
// R1이 대각선으로 달리며 도는 실제 엔진 프레임
const frames = () => {
  const e = new SimulationEngine(cfg('robot1'), cfg('robot2'), fixedRateShotJudge(0.5), 'RED', { allianceColor: 'RED' });
  while (e.currentTick < 40) e.step({ targetVx: 40, targetVy: 20, targetOmega: 3, actionState: 'IDLE' });
  return e.timeline;
};
// 헤딩만 바꾼 프레임 (±π 경계 검사용)
const withHeading = (f: DeepReadonly<TimelineFrame>, heading: number): DeepReadonly<TimelineFrame> => ({ ...f, r1: { ...f.r1, heading } });
const deg = (d: number) => (d * Math.PI) / 180;

describe('렌더링 프레임 보간 (17-1a)', () => {
  it('A. 끝점: alpha 0 = a의 로봇 자세, alpha 1 = b 자체 (같은 참조)', () => {
    const tl = frames();
    const [a, b] = [tl[30], tl[31]];
    expect(interpolateFrame(a, b, 1)).toBe(b);
    const zero = interpolateFrame(a, b, 0);
    for (const r of ['r1', 'r2'] as const) {
      expect(zero[r].x).toBe(a[r].x);
      expect(zero[r].y).toBe(a[r].y);
      expect(zero[r].heading).toBeCloseTo(a[r].heading, 12);
    }
  });

  it('B. 중간은 선형, 로봇 자세 외 항목은 b와 같은 참조, 입력 프레임 불변', () => {
    const tl = frames();
    const [a, b] = [tl[30], tl[31]];
    const before = JSON.stringify([a, b]);
    const mid = interpolateFrame(a, b, 0.25);
    expect(b.r1.x - a.r1.x).not.toBe(0); // 실제로 움직이는 구간
    expect(mid.r1.x).toBeCloseTo(a.r1.x + (b.r1.x - a.r1.x) * 0.25, 12);
    expect(mid.r1.y).toBeCloseTo(a.r1.y + (b.r1.y - a.r1.y) * 0.25, 12);
    expect(mid.r1.heading).toBeCloseTo(a.r1.heading + (b.r1.heading - a.r1.heading) * 0.25, 12);
    expect(mid.tick).toBe(b.tick);
    expect(mid.pieces).toBe(b.pieces);
    expect(mid.field).toBe(b.field);
    expect(mid.r1.controlledPieces).toBe(b.r1.controlledPieces);
    expect(mid.r1.vx).toBe(b.r1.vx);
    expect(mid.r1.actionState).toBe(b.r1.actionState);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('C. 헤딩은 ±π 경계에서 짧은 쪽으로 (179° → −179° = 2° 회전), 결과는 [−π, π]', () => {
    const f = frames()[0];
    const a = withHeading(f, deg(179));
    const b = withHeading(f, deg(-179));
    expect(interpolateFrame(a, b, 0.5).r1.heading).toBeCloseTo(Math.PI, 9); // 180°
    const q = interpolateFrame(a, b, 0.75).r1.heading;
    expect(q).toBeCloseTo(deg(-179.5), 9);
    expect(Math.abs(q)).toBeLessThanOrEqual(Math.PI);
    expect(interpolateFrame(b, a, 0.25).r1.heading).toBeCloseTo(deg(-179.5), 9);
  });

  it('D. alpha 범위 밖은 자름 (음수 = 0, 1 초과 / 비유한값 = b)', () => {
    const tl = frames();
    const [a, b] = [tl[30], tl[31]];
    expect(interpolateFrame(a, b, -0.5).r1.x).toBe(a.r1.x);
    expect(interpolateFrame(a, b, 1.5)).toBe(b);
    expect(interpolateFrame(a, b, Number.NaN)).toBe(b);
  });
});
