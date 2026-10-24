// 렌더링 프레임 보간 (명세서 3.7 프레임 보간, 17-1a / 17-1b)
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset, hiveCellAimPoint } from '../../core/collision';
import { bearingTo, fixedRateShotJudge } from '../../core/ballistics';
import { DT, SimulationEngine } from '../../core/simulationEngine';
import type { DeepReadonly, GamePiece, RobotConfig, TimelineFrame } from '../../core/types';
import { inchToPx } from '../canvasRenderer';
import { shotPositionAt } from '../flightView';
import { frameTickOffset, interpolateFrame } from '../frameInterpolation';
import { renderScene } from '../sceneRenderer';
import { restingView } from '../viewTransform';

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
// 기물 하나만 바꾼 프레임
const withPiece = (f: DeepReadonly<TimelineFrame>, i: number, patch: Partial<GamePiece>): DeepReadonly<TimelineFrame> => ({
  ...f,
  pieces: f.pieces.map((p, j) => (j === i ? { ...p, ...patch } : p)),
});
// arc 호출(필드 px 중심)만 모으는 캔버스 (Node에서 renderScene 실행용)
const arcCtx = () => {
  const arcs: { x: number; y: number }[] = [];
  const ctx = new Proxy({}, {
    get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : prop === 'arc' ? (x: number, y: number) => arcs.push({ x, y }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, arcs };
};

describe('렌더링 프레임 보간 (17-1a / 17-1b)', () => {
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
    expect(mid.field).toBe(b.field); // TIP 진행 중 아님
    mid.pieces.forEach((p, i) => {
      if (p.x === b.pieces[i].x && p.y === b.pieces[i].y) expect(p).toBe(b.pieces[i]); // 움직이지 않은 기물은 같은 참조
    });
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

  it('E. (17-1b) 바닥 기물: 같은 id가 두 프레임에서 같은 바닥 상태일 때만 위치 내삽, 상태가 바뀌면 b 그대로, 배열 순서가 달라도 id로 맞춤', () => {
    const i = 0;
    const f = withPiece(withPiece(frames()[0], i, { state: 'ON_FIELD', x: 30, y: 40 }), 1, { state: 'ON_FIELD', x: 50, y: 40 });
    const b = withPiece(withPiece(f, i, { x: 34, y: 38, vx: 200 }), 1, { x: 54 });
    const mid = interpolateFrame(f, b, 0.25);
    expect(mid.pieces[i].x).toBeCloseTo(31, 12);
    expect(mid.pieces[i].y).toBeCloseTo(39.5, 12);
    expect(mid.pieces[i].vx).toBe(200);
    expect(mid.pieces[1].x).toBeCloseTo(51, 12);
    expect(mid.pieces[2]).toBe(b.pieces[2]); // 움직이지 않은 기물은 같은 참조
    // 흡입 (ON_FIELD → CONTROLLED), 착지 (IN_FLIGHT → ON_FIELD), GARDEN 진입은 b 그대로
    for (const [from, to] of [['ON_FIELD', 'CONTROLLED'], ['IN_FLIGHT', 'ON_FIELD'], ['ON_FIELD', 'IN_GARDEN']] as const) {
      const a2 = withPiece(f, i, { state: from });
      const b2 = withPiece(b, i, { state: to });
      expect(interpolateFrame(a2, b2, 0.25).pieces[i]).toBe(b2.pieces[i]);
    }
    const garden = interpolateFrame(withPiece(f, i, { state: 'IN_GARDEN' }), withPiece(b, i, { state: 'IN_GARDEN' }), 0.5).pieces[i];
    expect(garden.x).toBeCloseTo(32, 12); // GARDEN 안에서 밀리는 기물도 바닥 상태라 내삽
    const reordered = { ...f, pieces: [...f.pieces].reverse() };
    expect(interpolateFrame(reordered, b, 0.5).pieces[i].x).toBeCloseTo(32, 12);
    expect(interpolateFrame(f, f, 0.5).pieces).toBe(f.pieces); // 아무것도 움직이지 않으면 배열 그대로
  });

  it('F. (17-1b) TIP 낙하 진행 시간: 두 프레임 모두 TIP 진행 중일 때만 내삽 (시작 / 끝 / 새 TIP은 b 그대로)', () => {
    const f = frames()[0];
    const tipping = (timer: number, isTipping = true): DeepReadonly<TimelineFrame> => ({ ...f, field: { ...f.field, hive: { ...f.field.hive, isTipping, tipProgressTimer: timer } } });
    const mid = interpolateFrame(tipping(0.4), tipping(0.42), 0.5);
    expect(mid.field.hive.tipProgressTimer).toBeCloseTo(0.41, 12);
    expect(mid.field.flowers).toBe(f.field.flowers);
    const start = tipping(0);
    expect(interpolateFrame(tipping(0, false), start, 0.5).field).toBe(start.field);
    const end = tipping(0.5, false);
    expect(interpolateFrame(tipping(0.48), end, 0.5).field).toBe(end.field);
    const again = tipping(0);
    expect(interpolateFrame(tipping(1.2), again, 0.5).field).toBe(again.field);
  });

  it('G. (17-1b) 비행 공: 렌더러가 frame.tick + tickOffset 시각의 위치에 그림 (tickOffset = alpha − 1, 이 틱에 발사한 공은 발사구)', () => {
    expect(frameTickOffset(0.25)).toBe(-0.75);
    expect(frameTickOffset(1)).toBe(0);
    expect(frameTickOffset(-1)).toBe(-1);
    expect(frameTickOffset(Number.NaN)).toBe(0);
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const spawn = { x: 60.5, y: 130.5, heading: bearingTo(60.5, 130.5, aim.x, aim.y) };
    const e = new SimulationEngine(cfg('robot1'), cfg('robot2'), fixedRateShotJudge(0), 'RED', { allianceColor: 'RED', r1Spawn: spawn, r1Loadout: ['POLLEN'] });
    while (e.field.pendingShots.length === 0 && e.currentTick < 60) e.step({ targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' });
    const shot = e.field.pendingShots[0];
    for (let k = 0; k < 4; k++) e.step();
    const frame = e.getFrame(shot.launchTick + 4)!;
    const draw = (tickOffset?: number) => {
      const { ctx, arcs } = arcCtx();
      renderScene(ctx, { frame, r1Config: cfg('robot1'), r2Config: cfg('robot2'), view: restingView('AUDIENCE', 'RED'), tickOffset });
      return arcs;
    };
    const has = (arcs: { x: number; y: number }[], t: number) => {
      const p = shotPositionAt(frame.field.pendingShots[0], t); // 그림자 = 바닥 위치
      return arcs.some(a => Math.abs(a.x - inchToPx(p.x)) < 1e-6 && Math.abs(a.y - inchToPx(p.y)) < 1e-6);
    };
    expect(has(draw(), 4 * DT)).toBe(true);
    expect(has(draw(-0.5), 3.5 * DT)).toBe(true);
    expect(has(draw(-0.5), 4 * DT)).toBe(false);
    expect(has(draw(-9), 3 * DT)).toBe(true); // [−1, 0]로 자름
  });
});
