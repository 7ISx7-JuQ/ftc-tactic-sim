// 필드 편집 모드 장면 그리기 (명세서 3.8 필드 편집 모드, 09-10b / 09-10c): 가짜 캔버스로 모드별로 그리는 표시만 확인
import { describe, expect, it } from 'vitest';
import { renderEditScene } from '../editSceneRenderer';
import type { EditScene, SpawnEditScene, SweetSpotEditScene } from '../editSceneRenderer';
import { createIntakeZonePreset } from '../../core/collision';
import { DEFAULT_SPAWN_POSES } from '../../core/simulationEngine';
import { restingView } from '../viewTransform';

const HATCH = 'rgba(17, 24, 39, 0.22)';
const VALID = '#15803d';
const INVALID = '#dc2626';
const APPLIED = 'rgba(17, 24, 39, 0.5)';

// stroke() 때의 선 색 / fill() 때의 채움 색을 기록하는 가짜 캔버스
function recordingCtx() {
  const strokes: string[] = [];
  const fills: string[] = [];
  const state: Record<string, unknown> = { strokeStyle: '#000' };
  const ctx = new Proxy(state, {
    get: (t, prop) => {
      if (prop === 'stroke' || prop === 'strokeRect') return () => strokes.push(String(t.strokeStyle));
      if (prop === 'fill') return () => fills.push(String(t.fillStyle));
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set: (t, prop, v) => {
      t[prop as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, fills };
}

const drawAll = (scene: EditScene) => {
  const rec = recordingCtx();
  renderEditScene(rec.ctx, scene, restingView('AUDIENCE', scene.alliance));
  return rec;
};
const draw = (scene: EditScene) => drawAll(scene).strokes;

const spotScene = (patch: Partial<SweetSpotEditScene> = {}): SweetSpotEditScene => ({
  mode: 'SWEET_SPOT',
  alliance: 'RED',
  reference: null,
  rowsDone: null,
  sweetSpot: { x: 40.5, y: 120.5 },
  sweetSpotValid: true,
  appliedSweetSpot: { x: 59.5, y: 131.5 },
  robotSize: { length: 18, width: 18 },
  hover: null,
  ...patch,
});

describe('편집 모드 장면 그리기 (09-10b / 09-10c)', () => {
  it('A. 히트맵 모드: 미계산 행 빗금, 스윗스팟 모드: 빗금 없음', () => {
    expect(draw({ mode: 'HEATMAP', alliance: 'RED', reference: null, rowsDone: null, sweetSpot: { x: 59.5, y: 131.5 } })).toContain(HATCH);
    expect(draw({ mode: 'HEATMAP', alliance: 'RED', reference: new Float32Array(144 * 144), rowsDone: new Uint8Array(144).fill(1), sweetSpot: null })).not.toContain(HATCH);
    expect(draw(spotScene())).not.toContain(HATCH);
  });

  it('B. 스윗스팟 모드: 마우스 칸(찍기 가능 초록 / 불가 빨강), 초안 윤곽(틀리면 빨강), 적용 스윗스팟 고리(초안과 다를 때만)', () => {
    const none = draw(spotScene());
    expect(none).not.toContain(VALID);
    expect(none).not.toContain(INVALID);
    expect(none).toContain(APPLIED);
    expect(draw(spotScene({ hover: { x: 30.5, y: 110.5, valid: true } }))).toContain(VALID);
    const badHover = draw(spotScene({ hover: { x: 60.5, y: 99.5, valid: false } }));
    expect(badHover).toContain(INVALID);
    expect(badHover).not.toContain(VALID);
    expect(draw(spotScene({ sweetSpotValid: false }))).toContain(INVALID);
    expect(draw(spotScene({ appliedSweetSpot: { x: 40.5, y: 120.5 } }))).not.toContain(APPLIED);
  });

  it('C. (09-11b) 시작 자세 모드: 배치 문제 로봇만 흰 빗금 + 빨간 테두리, 잡은 핸들은 주황, 히트맵 빗금 없음', () => {
    const config = { length: 18, width: 18, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }) };
    const spawn = (patch: Partial<SpawnEditScene> = {}): SpawnEditScene => ({
      mode: 'SPAWN',
      alliance: 'RED',
      robots: { robot1: { pose: DEFAULT_SPAWN_POSES.RED.robot1, config, bad: false }, robot2: { pose: DEFAULT_SPAWN_POSES.RED.robot2, config, bad: false } },
      gardenPieces: [],
      active: null,
      ...patch,
    });
    const STRIPE = 'rgba(255, 255, 255, 0.6)';
    const ok = drawAll(spawn());
    expect(ok.strokes).not.toContain(STRIPE);
    expect(ok.strokes).not.toContain(INVALID);
    expect(ok.strokes).not.toContain(HATCH);
    expect(ok.fills).not.toContain('#f59e0b');
    const bad = drawAll(spawn({ robots: { ...spawn().robots, robot2: { ...spawn().robots.robot2, bad: true } } }));
    expect(bad.strokes).toContain(STRIPE);
    expect(bad.strokes).toContain(INVALID);
    expect(drawAll(spawn({ active: { robot: 'robot1', part: 'handle' } })).fills).toContain('#f59e0b');
    expect(drawAll(spawn({ active: { robot: 'robot1', part: 'body' } })).fills).not.toContain('#f59e0b');
  });
});
