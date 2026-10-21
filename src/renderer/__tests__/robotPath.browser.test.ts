// 로봇 동선 그리기 브라우저 테스트 (명세서 3.7 표시 옵션 robotPath, 16-3): 실제 Chromium 캔버스에서 그리는 순서 / 합성을 픽셀로 확인한다.
// 동선은 바닥 표시라 바닥 기물 · 로봇 · 터널 지붕 아래다. 굵은 수평선 한가운데 픽셀 한 점만 본다 (안티앨리어싱과 무관).
import { describe, expect, it } from 'vitest';
import { HIVE_TUNNEL, createIntakeZonePreset } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { fixedRateShotJudge } from '../../core/ballistics';
import type { DeepReadonly, RobotConfig, TimelineFrame } from '../../core/types';
import { renderScene } from '../sceneRenderer';
import type { ScenePaths } from '../robotPath';
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
const PATH_RGB = [223, 0, 27]; // RED 진영 색 (ALLIANCE_COLORS.RED.base)
// 캔버스 y = 40 + 5 · y_in → y = n + 0.1 in이면 픽셀 행 한가운데 (선 굵기 1.75 ~ 2.75 px가 그 행을 덮음)
const PAST_Y = 100.1;
const FUTURE_Y = 110.1;
const MID_X = (HIVE_TUNNEL.minX + HIVE_TUNNEL.maxX) / 2;
const TUNNEL_Y = 72.1;

// 바닥 기물을 뺀 0틱 프레임 (산포 기물이 볼 점을 가리지 않게) + 선택한 바닥 기물 하나
function frame(piece?: { x: number; y: number }): DeepReadonly<TimelineFrame> {
  const f = new SimulationEngine(C1, C2, fixedRateShotJudge(0.5), 'RED', { allianceColor: 'RED' }).getFrame(0)!;
  const pollen = f.pieces.find(p => p.type === 'POLLEN')!;
  const pieces = f.pieces.filter(p => p.state !== 'ON_FIELD').concat(piece ? [{ ...pollen, state: 'ON_FIELD' as const, ...piece }] : []);
  return { ...f, pieces };
}

const line = (y: number, x0: number, x1: number) => [{ x: x0, y }, { x: x1, y }];
const PATHS: ScenePaths = {
  robot1: { past: [...line(PAST_Y, 20, 40), ...line(TUNNEL_Y, MID_X - 6, MID_X + 6)], future: line(FUTURE_Y, 20, 40) },
  robot2: { past: [], future: [] },
};

function render(paths: ScenePaths | null, piece?: { x: number; y: number }): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = SCENE_WIDTH_PX;
  c.height = SCENE_HEIGHT_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  renderScene(ctx, { frame: frame(piece), r1Config: C1, r2Config: C2, view: VIEW, paths }, 1);
  return ctx;
}

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
  const p = fieldToCanvas(VIEW, x, y);
  return [...ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data.slice(0, 3)];
}

const over = (base: number[], alpha: number) => base.map((v, i) => v * (1 - alpha) + PATH_RGB[i] * alpha);
const close = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('로봇 동선 그리기 (16-3)', () => {
  it('A. 지나온 동선은 진하게(85%), 앞으로 갈 동선은 흐리게(30%) 바닥 위에', () => {
    const base = render(null);
    const drawn = render(PATHS);
    const past = pixel(drawn, 30, PAST_Y);
    const future = pixel(drawn, 30, FUTURE_Y);
    expect(close(past, over(pixel(base, 30, PAST_Y), 0.85)), `past (${past})`).toBe(true);
    expect(close(future, over(pixel(base, 30, FUTURE_Y), 0.3)), `future (${future})`).toBe(true);
  });

  it('B. 바닥 기물과 터널 지붕 아래: 기물이 있으면 기물 색, 빈 터널(불투명 지붕) 안 구간은 지붕 색', () => {
    const withPiece = pixel(render(PATHS, { x: 30, y: PAST_Y }), 30, PAST_Y);
    expect(withPiece).toEqual(pixel(render(null, { x: 30, y: PAST_Y }), 30, PAST_Y));
    expect(close(withPiece, pixel(render(null), 30, PAST_Y))).toBe(false); // 기물이 실제로 그 자리에 그려짐
    const roof = pixel(render(null), MID_X, TUNNEL_Y);
    expect(pixel(render(PATHS), MID_X, TUNNEL_Y)).toEqual(roof);
    expect(close(roof, over(roof, 0.85))).toBe(false); // 지붕 색이 동선 색과 달라 가려졌는지 구분됨
  });
});
