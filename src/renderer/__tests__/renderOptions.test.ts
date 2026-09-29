import { describe, expect, it } from 'vitest';
import { bearingTo } from '../../core/ballistics';
import { FLOWER_CIRCLES, PIECE_PHYSICS, createIntakeZonePreset, hiveCellAimPoint } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import type { RobotDriveInput } from '../../core/simulationEngine';
import type { DeepReadonly, RobotConfig, ShotProbabilityResolver, TimelineFrame } from '../../core/types';
import { renderScene } from '../sceneRenderer';
import { DEFAULT_RENDER_OPTIONS, aimGuide, hitProbabilities, intakeProgress } from '../renderOptions';
import type { RenderOptions } from '../renderOptions';
import { restingView } from '../viewTransform';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});
const C1 = cfg('robot1'), C2 = cfg('robot2');
type Frame = DeepReadonly<TimelineFrame>;
const engine = (resolver: ShotProbabilityResolver = () => 0.5) =>
  new SimulationEngine(C1, C2, resolver, 'RED', { allianceColor: 'RED', flowerPiecesCount: [0, 4, 4, 4] }); // FLOWER 1 비움 → 바닥 산포 POLLEN 있음
// 모든 메서드를 받아 아무것도 하지 않는 캔버스 (Node에서 renderScene 실행용, measureText만 폭 반환)
const noopCtx = () =>
  new Proxy({}, { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
const ALL_ON: RenderOptions = { aimGuide: true, intakeProgress: true, hitProbability: true, flightTrail: true, flightResult: true };

describe('표시 옵션 (명세서 3.7, 08-6)', () => {
  it('A. 조준선 (고정형 허용 오차 / 터렛 범위 부채꼴, 발사 방향)', () => {
    const frame = engine().getFrame(0)!;
    const robot = { ...frame.r1, x: 60.5, y: 130.5, heading: 1.2 };
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const bearing = bearingTo(60.5, 130.5, aim.x, aim.y);
    const fixed = aimGuide(robot, C1, 'RED', 'AUDIENCE_CELL');
    assert(near(fixed.sectorStart, 1.2 - 0.05) && near(fixed.sectorEnd, 1.2 + 0.05) && fixed.launchHeading === 1.2 && near(fixed.aim.x, aim.x), 'FIXED: heading ± aimTolerance, launches along the heading');
    const half = aimGuide(robot, cfg('robot1', { turretType: 'TURRET', turretRange: [-Math.PI / 2, Math.PI / 2] }), 'RED', 'AUDIENCE_CELL');
    assert(near(half.sectorStart, 1.2 - Math.PI / 2) && near(half.sectorEnd, 1.2 + Math.PI / 2), 'TURRET ±90°: sector heading ± 90°');
    const rear = aimGuide(robot, cfg('robot1', { turretType: 'TURRET', turretRange: [2.5, -2.5] }), 'RED', 'AUDIENCE_CELL');
    assert(near(rear.sectorEnd - rear.sectorStart, 2 * Math.PI - 5) && near(rear.sectorStart, 1.2 + 2.5), 'rear turret [2.5, −2.5]: sector crosses ±π (length 2π − 5)');
    const full = aimGuide({ ...robot, heading: bearing + 2 }, cfg('robot1', { turretType: 'TURRET', turretRange: [-Math.PI, Math.PI] }), 'RED', 'AUDIENCE_CELL');
    assert(near(full.sectorEnd - full.sectorStart, 2 * Math.PI) && near(full.launchHeading, bearing), '360° turret [−π, π]: full circle, launches at the aim bearing');
    // 엔진과 같은 해석: [0, 2π]는 정규화하면 [0, 0] (360° 아님) → 폭 0 부채꼴, 발사 방향 = 헤딩 (한계각)
    const zero = aimGuide({ ...robot, heading: bearing + 2 }, cfg('robot1', { turretType: 'TURRET', turretRange: [0, 2 * Math.PI] }), 'RED', 'AUDIENCE_CELL');
    assert(near(zero.sectorEnd - zero.sectorStart, 0) && near(zero.launchHeading, bearing + 2), '[0, 2π] normalizes to [0, 0] like the engine: zero-width sector');
  });

  it('B. 흡입 접촉 진행 (바닥 기물 / FLOWER slot[0], 필요 시간)', () => {
    const frame = engine().getFrame(0)!;
    const floorPiece = frame.pieces.find(p => p.state === 'ON_FIELD')!;
    const withTarget = (id: string | null, timer: number): Frame => ({ ...frame, r1: { ...frame.r1, intakeTargetPieceId: id, intakeContactTimer: timer } });
    const floor = intakeProgress(withTarget(floorPiece.id, 0.05).r1, C1, withTarget(floorPiece.id, 0.05))!;
    assert(near(floor.x, floorPiece.x) && near(floor.radius, PIECE_PHYSICS.POLLEN.radius + 0.6) && near(floor.fraction, 0.5), 'floor piece: 0.05 s of intakeDelay 0.1 s -> half arc around the piece');
    const slot0 = frame.field.flowers[1].pieces[0]!;
    const fl = intakeProgress(withTarget(slot0.id, 0.06).r1, C1, withTarget(slot0.id, 0.06))!;
    assert(near(fl.x, FLOWER_CIRCLES[1].center.x) && near(fl.y, FLOWER_CIRCLES[1].center.y) && near(fl.fraction, 0.06 / 0.12), 'FLOWER slot[0]: arc around the FLOWER, required max(intakeDelay, 0.12 s)');
    const noDelay = cfg('robot1', { intakeDelay: 0 });
    assert(intakeProgress(withTarget(floorPiece.id, 0).r1, noDelay, withTarget(floorPiece.id, 0)) === null, 'intakeDelay 0 on a floor piece -> nothing to show');
    assert(intakeProgress(withTarget(slot0.id, 0.03).r1, noDelay, withTarget(slot0.id, 0.03)) !== null, 'FLOWER still needs the 0.12 s gravity cooldown');
    assert(intakeProgress(frame.r1, C1, frame) === null, 'no intake target -> null');
    assert(near(intakeProgress(withTarget(floorPiece.id, 0.5).r1, C1, withTarget(floorPiece.id, 0.5))!.fraction, 1), 'fraction capped at 1');
  });

  it('C. 실시간 명중 확률 (로봇 2 × 기물 2, [0, 1] 제한, 다음 기물 종류)', () => {
    const frame = engine().getFrame(0)!;
    const calls: string[] = [];
    const resolver: ShotProbabilityResolver = (id, type) => {
      calls.push(`${id}:${type}`);
      return id === 'robot1' ? (type === 'POLLEN' ? 1.7 : NaN) : type === 'POLLEN' ? 0.25 : -1;
    };
    const p = hitProbabilities(frame, resolver);
    assert(calls.length === 4 && p.robot1.POLLEN === 1 && p.robot1.NECTAR === 0 && p.robot2.POLLEN === 0.25 && p.robot2.NECTAR === 0, '4 calls, clamped to [0, 1], non-finite -> 0');
    assert(p.robot1.next === 'POLLEN' && hitProbabilities({ ...frame, r2: { ...frame.r2, controlledPieces: [] } }, resolver).robot2.next === null, 'next piece type from the FIFO head (none when empty)');
  });

  it('D. 장면 그리기: 렌더러는 판정 함수를 호출하지 않음 (09-6b, 명중 확률은 HTML 패널), 풀매치 프레임 전부 그리기', () => {
    let calls = 0;
    const counting: ShotProbabilityResolver = () => {
      calls++;
      return 0.5;
    };
    const e = engine(counting);
    const drive: RobotDriveInput = { targetVx: 20, targetVy: 5, targetOmega: 0.3, actionState: 'INTAKING' };
    const shoot: RobotDriveInput = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' };
    e.inputProvider = t => ({ r1: t % 400 < 200 ? drive : shoot, r2: t % 300 < 150 ? shoot : drive });
    e.runFullMatch();
    const engineCalls = calls;
    assert(e.timeline.some(f => f.field.pendingShots.length > 0), 'match has flights to draw');
    const ctx = noopCtx();
    const draw = (frame: Frame, options?: RenderOptions) =>
      renderScene(ctx, { frame, r1Config: C1, r2Config: C2, view: restingView('DRIVER', 'RED'), options }, 2);
    calls = 0;
    for (const frame of e.timeline) draw(frame);
    draw(e.timeline[100], DEFAULT_RENDER_OPTIONS);
    for (let t = 0; t < e.timeline.length; t += 7) draw(e.timeline[t], ALL_ON);
    assert(calls === 0, `options off or all on: the renderer never calls the resolver (${calls})`);
    // 명중 확률 계산 함수 자체는 그대로 (HTML 패널이 호출): 로봇 2 × 기물 2 = 4회
    hitProbabilities(e.timeline[500], counting);
    assert(calls === 4, `hitProbabilities still calls the resolver 4 times (${calls})`);
    assert(engineCalls > 0, 'engine itself still calls the resolver only when firing');
  }, 120_000);
});
