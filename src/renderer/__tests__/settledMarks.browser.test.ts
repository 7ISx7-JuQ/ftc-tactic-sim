// 종료 정착 위치 그리기 브라우저 테스트 (명세서 3.7 경기 종료 강조, 12-14): 실제 Chromium 캔버스에서 정착 자리 채움 / 판정 강조 위치를 픽셀로 확인한다.
// 채움 한가운데 픽셀 한 점만 본다 (점선 윤곽 / 안티앨리어싱과 무관).
import { describe, expect, it } from 'vitest';
import { PIECE_PHYSICS, createIntakeZonePreset } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { fixedRateShotJudge } from '../../core/ballistics';
import type { DeepReadonly, RobotConfig, ScoreBreakdown, TimelineFrame } from '../../core/types';
import { ALLIANCE_COLORS } from '../canvasRenderer';
import { renderScene } from '../sceneRenderer';
import { SETTLED_FILL_ALPHA } from '../settledMarks';
import { SCENE_HEIGHT_PX, SCENE_WIDTH_PX, fieldToCanvas, restingView } from '../viewTransform';

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], flowerSetupDelay: 500, flowerDropDelay: 200,
  shooterSetup: 'SHARED', nectarShooter: { shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0] }, flowerDropZones: [], liftMaxSpeed: 0, maxControlledPieces: 4,
});
const C1 = cfg('robot1');
const C2 = cfg('robot2');
const VIEW = restingView('AUDIENCE', 'RED');
const ROBOT_RGB = [223, 0, 27]; // RED 진영 색 (ALLIANCE_COLORS.RED.base)
const SCORED_RGB = [245, 158, 11]; // 판정 강조 주황 (#f59e0b)
// 캔버스 = 40 + 5 · in → n + 0.1 in이면 픽셀 한가운데
const SETTLED_ROBOT = { x: 60.1, y: 100.1 };
const SETTLED_PIECE = { x: 30.1, y: 100.1 };

const EMPTY_SETTLE: ScoreBreakdown['settle'] = { ticks: 0, robots: [], pieces: [] };
// 바닥 기물을 뺀 0틱 프레임 + 종료 내역 (정착 자리만 바꿔 끼움)
function frame(settle: ScoreBreakdown['settle'] | null, parked: ('robot1' | 'robot2')[] = []): DeepReadonly<TimelineFrame> {
  const f = new SimulationEngine(C1, C2, fixedRateShotJudge(0.5), 'RED', { allianceColor: 'RED' }).getFrame(0)!;
  const pieces = f.pieces.filter(p => p.state !== 'ON_FIELD');
  const scoreBreakdown: ScoreBreakdown | null = settle && {
    hive: 0, cell: 0, flower: 0, garden: 0, park: parked.length * 5, flowers: [], gardenPieceIds: [], gardenPieces: { nectar: 0, pollen: 0 }, parkedRobots: parked,
    cellPieces: { nectar: 0, pollen: 0 }, teleopTips: 0, settle,
  };
  return { ...f, pieces, scoreBreakdown };
}

function render(f: DeepReadonly<TimelineFrame>): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = SCENE_WIDTH_PX;
  c.height = SCENE_HEIGHT_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  renderScene(ctx, { frame: f, r1Config: C1, r2Config: C2, view: VIEW }, 1);
  return ctx;
}

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
  const p = fieldToCanvas(VIEW, x, y);
  return [...ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data.slice(0, 3)];
}

const over = (base: number[], rgb: number[], alpha: number) => base.map((v, i) => v * (1 - alpha) + rgb[i] * alpha);
const close = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('종료 정착 위치 그리기 (12-14)', () => {
  it('A. 0:00 뒤 움직인 로봇 / 기물의 정착 자리 = 진영색 / 기물색을 흐리게(35%) 바닥 위에, 내역이 없으면 그리지 않음', () => {
    expect(ALLIANCE_COLORS.RED.base.toLowerCase()).toBe('#df001b');
    const base = render(frame(EMPTY_SETTLE));
    const drawn = render(frame({ ticks: 30, robots: [{ id: 'robot2', ...SETTLED_ROBOT, heading: 0 }], pieces: [{ id: 'pollen-1', type: 'POLLEN', ...SETTLED_PIECE }] }));
    const robot = pixel(drawn, SETTLED_ROBOT.x, SETTLED_ROBOT.y);
    expect(close(robot, over(pixel(base, SETTLED_ROBOT.x, SETTLED_ROBOT.y), ROBOT_RGB, SETTLED_FILL_ALPHA)), `robot (${robot})`).toBe(true);
    const piece = pixel(drawn, SETTLED_PIECE.x, SETTLED_PIECE.y);
    expect(close(piece, pixel(base, SETTLED_PIECE.x, SETTLED_PIECE.y)), `piece drawn (${piece})`).toBe(false);
    // 종료 전 프레임(내역 없음)은 settle이 있어도 그릴 근거가 없음
    expect(pixel(render(frame(null)), SETTLED_ROBOT.x, SETTLED_ROBOT.y)).toEqual(pixel(base, SETTLED_ROBOT.x, SETTLED_ROBOT.y));
  });

  it('B. 주차 강조는 판정한 자리에: 움직인 로봇은 정착 자세 외곽, 0:00 자세 외곽은 비움', () => {
    const f0 = frame(EMPTY_SETTLE);
    // 주차 외곽 = 몸체보다 1.5 in 큰 사각형 선 → 몸체 오른쪽 변 + 1.5 in (선 굵기 3.5 px 한가운데)
    const edge = (x: number) => x + 9 + 1.5;
    const stayed = render(frame(EMPTY_SETTLE, ['robot2']));
    expect(close(pixel(stayed, edge(f0.r2.x), f0.r2.y), SCORED_RGB, 12), 'not moved -> mark at the 0:00 pose').toBe(true);
    const moved = render(frame({ ticks: 30, robots: [{ id: 'robot2', ...SETTLED_ROBOT, heading: 0 }], pieces: [] }, ['robot2']));
    expect(close(pixel(moved, edge(SETTLED_ROBOT.x), SETTLED_ROBOT.y), SCORED_RGB, 12), 'moved -> mark at the settled pose').toBe(true);
    expect(close(pixel(moved, edge(f0.r2.x), f0.r2.y), SCORED_RGB, 12), 'no mark left at the 0:00 pose').toBe(false);
    expect(PIECE_PHYSICS.POLLEN.radius).toBeGreaterThan(1); // 기물 채움 점이 한가운데 픽셀을 덮음
  });
});
