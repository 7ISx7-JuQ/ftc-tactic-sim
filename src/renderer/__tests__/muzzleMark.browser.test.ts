// 사출구 표시 브라우저 테스트 (명세서 3.7 표시 옵션 muzzleMark, 13-6): 실제 Chromium 캔버스에서 조준경이 조준선과 따로 켜지고,
// 속이 비어 아래 적재물이 그대로 보이는지 픽셀로 확인한다. 기본 오프셋 0 = 사출구가 로봇 중심(적재함 칸 위)인 겹침 상황.
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { fixedRateShotJudge } from '../../core/ballistics';
import type { DeepReadonly, RobotConfig, TimelineFrame } from '../../core/types';
import { DEFAULT_RENDER_OPTIONS } from '../renderOptions';
import type { RenderOptions } from '../renderOptions';
import { renderScene } from '../sceneRenderer';
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
const R1 = { x: 40.1, y: 100.1, heading: 0 }; // 고정형 + 탄도 미지정 → 사출구 = 로봇 중심, 발사 방향 = 헤딩

// 바닥 기물을 뺀 0틱 프레임 (R1 적재 4개 — 적재함 칸이 사출구를 지나감)
function frame(): DeepReadonly<TimelineFrame> {
  const f = new SimulationEngine(C1, C2, fixedRateShotJudge(0.5), 'RED', { allianceColor: 'RED', r1Spawn: R1, r1Loadout: ['POLLEN', 'NECTAR', 'POLLEN', 'NECTAR'] }).getFrame(0)!;
  return { ...f, pieces: f.pieces.filter(p => p.state !== 'ON_FIELD') };
}

function render(options: Partial<RenderOptions>): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = SCENE_WIDTH_PX;
  c.height = SCENE_HEIGHT_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  renderScene(ctx, { frame: frame(), r1Config: C1, r2Config: C2, view: VIEW, options: { ...DEFAULT_RENDER_OPTIONS, ...options } }, 1);
  return ctx;
}

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
  const p = fieldToCanvas(VIEW, x, y);
  return [...ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data.slice(0, 3)];
}

const diff = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);
// 볼 점: 사출구 중심(고리 안 빈 곳), 고리 위(눈금 사이 45°), 발사 방향 눈금 위
const CENTER = { x: R1.x, y: R1.y };
const RING = { x: R1.x + 0.9 * Math.SQRT1_2, y: R1.y + 0.9 * Math.SQRT1_2 };
const TICK = { x: R1.x + 1.3, y: R1.y };

describe('사출구 표시 (13-6)', () => {
  it('A. 사출구만 켜면 조준경이 그려지고(고리 · 발사 방향 눈금), 속은 비어 아래 그림 그대로', () => {
    const off = render({});
    const on = render({ muzzleMark: true });
    expect(diff(pixel(on, RING.x, RING.y), pixel(off, RING.x, RING.y))).toBeGreaterThan(60);
    expect(diff(pixel(on, TICK.x, TICK.y), pixel(off, TICK.x, TICK.y))).toBeGreaterThan(60);
    expect(diff(pixel(on, CENTER.x, CENTER.y), pixel(off, CENTER.x, CENTER.y))).toBeLessThanOrEqual(6);
  });

  it('B. 조준선만 켜면 사출구는 없음 (두 옵션은 따로)', () => {
    const off = render({});
    const aim = render({ aimGuide: true });
    expect(diff(pixel(aim, RING.x, RING.y), pixel(off, RING.x, RING.y))).toBeLessThanOrEqual(6);
    expect(diff(pixel(aim, TICK.x, TICK.y), pixel(off, TICK.x, TICK.y))).toBeLessThanOrEqual(6);
    const both = render({ aimGuide: true, muzzleMark: true });
    expect(diff(pixel(both, RING.x, RING.y), pixel(off, RING.x, RING.y))).toBeGreaterThan(60);
  });
});
