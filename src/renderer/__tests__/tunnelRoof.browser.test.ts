// 터널 지붕 그리기 브라우저 테스트 (명세서 3.7 HIVE 터널 지붕, 13-1): 실제 Chromium 캔버스에서 그리는 순서 / 합성을 픽셀로 확인한다.
// 스크린샷 비교가 아니라 넓은 단색 영역 한가운데의 픽셀 한 점만 본다 (글꼴 / 안티앨리어싱과 무관).
import { describe, expect, it } from 'vitest';
import { HIVE_TUNNEL, createIntakeZonePreset } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import type { RobotConfig, RobotPose } from '../../core/types';
import { renderEditScene } from '../editSceneRenderer';
import { renderScene } from '../sceneRenderer';
import { ROOF_MIN_OPACITY } from '../tunnelRoof';
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
const ROBOT_RGB = [223, 0, 27]; // RED 로봇 몸체 (ALLIANCE_COLORS.RED.base)
const MID_X = (HIVE_TUNNEL.minX + HIVE_TUNNEL.maxX) / 2;
const IN_TUNNEL: RobotPose = { x: MID_X, y: 72, heading: -Math.PI / 2 }; // 몸체 전체가 터널 안 (t = 1)
const OUTSIDE: RobotPose = { x: MID_X, y: 125, heading: -Math.PI / 2 };
// 볼 점: 터널 안 · 상대(BLUE) 비활성 셀 위 · 로봇 몸체 모서리 가까이 (적재물 받침 / 화살표 / 흡입 구역 밖)
const PROBE = { x: MID_X + 7.5, y: 72 - 7.5 };

function pixel(ctx: CanvasRenderingContext2D, at: { x: number; y: number }): number[] {
  const p = fieldToCanvas(VIEW, at.x, at.y);
  return [...ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3)];
}

function canvas(): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = SCENE_WIDTH_PX;
  c.height = SCENE_HEIGHT_PX;
  return c.getContext('2d', { willReadFrequently: true })!;
}

function matchPixel(r1Spawn: RobotPose): number[] {
  const engine = new SimulationEngine(C1, C2, () => 0.5, 'RED', { allianceColor: 'RED', r1Spawn });
  const ctx = canvas();
  renderScene(ctx, { frame: engine.getFrame(0)!, r1Config: C1, r2Config: C2, view: VIEW }, 1);
  return pixel(ctx, PROBE);
}

function spawnPixel(pose: RobotPose): number[] {
  const ctx = canvas();
  renderEditScene(ctx, {
    mode: 'SCENARIO',
    alliance: 'RED',
    robots: { robot1: { pose, config: C1, bad: false }, robot2: { pose: { x: 9, y: 108, heading: 0 }, config: C2, bad: false } },
    gardenPieces: [],
    active: null,
  }, VIEW, 1);
  return pixel(ctx, PROBE);
}

const blend = (roof: number[]) => roof.map((v, i) => v * ROOF_MIN_OPACITY + ROBOT_RGB[i] * (1 - ROOF_MIN_OPACITY));
const close = (a: number[], b: number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('HIVE 터널 지붕 그리기 (13-1)', () => {
  it('A. 경기 장면: 터널이 비면 지붕 불투명, 로봇이 들어가면 지붕이 로봇 위에 ROOF_MIN_OPACITY로 합성', () => {
    const roof = matchPixel(OUTSIDE);
    const inside = matchPixel(IN_TUNNEL);
    expect(close(roof, ROBOT_RGB, 40), `empty tunnel: roof color, not the robot (${roof})`).toBe(false);
    expect(close(inside, blend(roof)), `robot inside: roof × ${ROOF_MIN_OPACITY} over the robot body (${inside} vs ${blend(roof).map(Math.round)})`).toBe(true);
  });

  it('B. 시작 자세 편집 장면도 같은 지붕 규칙', () => {
    const roof = spawnPixel(OUTSIDE);
    const inside = spawnPixel(IN_TUNNEL);
    expect(close(roof, matchPixel(OUTSIDE)), 'same opaque roof as the match scene').toBe(true);
    expect(close(inside, blend(roof)), `robot inside: roof × ${ROOF_MIN_OPACITY} over the robot (${inside})`).toBe(true);
  });
});
