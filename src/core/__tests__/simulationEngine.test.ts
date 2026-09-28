import { describe, expect, it } from 'vitest';
import { SimulationEngine, DEFAULT_RNG_SEED, DEFAULT_SPAWN_POSES, validateScenario, getCarryCapacity, DT } from '../simulationEngine';
import type { RobotDriveInput } from '../simulationEngine';
import type { BumperZone, RobotConfig, RobotPose, ScenarioConfig, ShotProbabilityResolver } from '../types';
import { createLUTShotResolver, generateRobotLUTs, bearingTo, shooterBallisticsFrom, planShotFlight, DEFAULT_SHOOTER_BALLISTICS } from '../ballistics';
import { GARDEN_AABB, LOADING_ZONE_AABB, testCircleVsAABB, createIntakeZonePreset, getBumperZoneOBB, getRobotOBB, testOBBvsCircle, DEFAULT_PRESET_ZONE_DEPTH, HIVE_AABB, HIVE_HEIGHT, HIVE_OPENING_CENTROID_S, HIVE_RIM_Y, GRAVITY, PIECE_PHYSICS, hiveCellAimPoint } from '../collision';

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});
const pose = (x: number, y: number, heading = 0): RobotPose => ({ x, y, heading });
const C1 = cfg('robot1'), C2 = cfg('robot2');
// 고정 명중 확률 판정 함수 (탄도 LUT 대신 주입): R1 = p1, R2 = p2
const fixedP = (p1: number, p2 = p1): ShotProbabilityResolver => (id) => (id === 'robot1' ? p1 : p2);
const ALWAYS_HIT = fixedP(1);
// 로봇을 빈 상태로 시작하되 빠진 POLLEN 4개를 아군 GARDEN으로 돌려 무작위 산포가 생기지 않게 함
const EMPTY_R1: Partial<ScenarioConfig> = { r1Loadout: [], gardenPiecesCount: { ally: 8, opponent: 4 } };
const EMPTY_R2: Partial<ScenarioConfig> = { r2Loadout: [], gardenPiecesCount: { ally: 8, opponent: 4 } };
const fillFlower1 = (e: SimulationEngine, n: number) => {
  const f = e.field.flowers[0];
  while (f.pieces.length < n) {
    const p = e.pieces.find(q => q.state === 'IN_GARDEN')!;
    p.state = 'IN_FLOWER';
    f.pieces.push(p);
  }
};
const eng = (sc: Partial<ScenarioConfig> = {}, c1 = C1, c2 = C2, resolver = ALWAYS_HIT) =>
  new SimulationEngine(c1, c2, resolver, sc.allianceColor ?? 'RED', { allianceColor: 'RED', ...sc });
// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const count = (e: SimulationEngine, s: string) => e.pieces.filter(p => p.state === s).length;
const inp = (actionState: RobotDriveInput['actionState'], vx = 0, vy = 0, w = 0): RobotDriveInput => ({ targetVx: vx, targetVy: vy, targetOmega: w, actionState });
const SHOOT = inp('SHOOTING'), INTAKE = inp('INTAKING'), DROP = inp('FLOWER_DROPPING'), LIFT = inp('FLOWER_SETUP');
// 리프트 FSM(명세서 2.6.3): A 토글 켬 + B 유지와 같은 입력 — 리프트가 올라가 있으면 투입, 아니면 올림 요청
const isLifted = (s: string) => s === 'FLOWER_READY' || s === 'FLOWER_DROPPING';
const liftDrop = (e: SimulationEngine) => (isLifted(e.r2.actionState) ? DROP : LIFT);
// R2가 n틱 동안 올림 → 투입 (올림 25틱 + 투입 10틱 = 35틱에 첫 투입, 이후 10틱마다)
const stepDrop = (e: SimulationEngine, n: number) => { for (let i = 0; i < n; i++) e.step(undefined, liftDrop(e)); };
// 비행 중인 발사가 모두 도착할 때까지 입력 없이 진행 (발사 → 도착 분리, 명세서 2.6.2)
const settle = (e: SimulationEngine) => { let guard = 0; while (e.field.pendingShots.length > 0 && guard++ < 500) e.step(); };
// 발사 틱에 기록된 비행의 도착 틱 (그 틱에 발사가 없으면 -1)
const arrivalOf = (e: SimulationEngine, launchTick: number) => e.getFrame(launchTick)?.field.pendingShots.find(s => s.launchTick === launchTick)?.arriveTick ?? -1;

// 풀매치(6000틱) 시뮬레이션을 여러 번 돌리는 그룹이 있어 기본 5초보다 넉넉하게
const TEST_TIMEOUT_MS = 120_000;

describe('SimulationEngine 통합 회귀 테스트', () => {
  it('A. 스폰 자세 (ScenarioConfig 이전)', () => {
    {
      const e = new SimulationEngine(C1, C2, ALWAYS_HIT); // 시나리오 없음 → RED 기본
      assert(e.r1.x === 9 && e.r1.y === 36 && e.r1.heading === 0 && e.r2.x === 9 && e.r2.y === 108, 'no scenario -> RED default spawn');
      const b = eng({ allianceColor: 'BLUE' });
      assert(b.r1.x === 135 && b.r1.y === 36 && b.r1.heading === Math.PI && b.r2.y === 108, 'BLUE alliance -> BLUE default spawn (auto)');
      const c = eng({ r1Spawn: pose(40, 20, 1.2) });
      assert(c.r1.x === 40 && c.r1.y === 20 && c.r1.heading === 1.2, 'custom r1Spawn applied');
      assert(c.r2.x === 9 && c.r2.y === 108, 'r2 unspecified -> default');
      const d = eng({ r1Spawn: pose(NaN, 20), r2Spawn: pose(30, Infinity) });
      assert(d.r1.x === 9 && d.r1.y === 36 && d.r2.y === 108, 'non-finite pose -> default fallback');
      assert(d.getFrame(0)!.r1.x === 9, 'frame 0 records spawn');
      // 동일 RobotConfig를 진영만 바꿔 재사용 (과거 버그 시나리오)
      const e2 = new SimulationEngine(C1, C2, ALWAYS_HIT, 'RED');
      e2.reset({ allianceColor: 'BLUE' });
      assert(e2.r1.x === 135 && e2.field.allianceColor === 'BLUE', 'reset(BLUE) with same configs moves robots to BLUE side');
      assert(DEFAULT_SPAWN_POSES.RED.robot1.x === 9, 'DEFAULT_SPAWN_POSES untouched');
      // 산포 데드존이 실제 스폰 자세를 회피
      const s = eng({ r1Spawn: pose(72, 120), flowerPiecesCount: [0, 0, 0, 0], gardenPiecesCount: { ally: 0, opponent: 0 }, hiveInitialPieces: { pollenCount: 0, nectarCount: 0 } });
      const near = s.pieces.filter(p => p.state === 'ON_FIELD' && Math.abs(p.x - 72) < 9 + 1.4 && Math.abs(p.y - 120) < 9 + 1.4);
      assert(near.length === 0, 'scatter avoids custom spawn OBB');
    }
  }, TEST_TIMEOUT_MS);

  it('B. 초기화', () => {
    {
      const e = eng();
      assert(e.pieces.length === 40, '40 pieces');
      assert(e.r1.controlledPieces.length === 4 && e.r2.controlledPieces.length === 4, 'preload 4/4');
      assert(e.field.flowers.every(f => f.pieces.length === 4), 'flowers 4 each');
      assert(count(e, 'IN_GARDEN') === 8 && count(e, 'IN_HIVE') === 3 && e.field.nectarStock === 5, 'garden 8, hive 3, stock 5');
      assert(e.getFrame(0)!.r1.controlledPieces[0] !== e.r1.controlledPieces[0], 'frame is clone');
    }
  }, TEST_TIMEOUT_MS);

  it('C. 슈팅 / HIVE 팁', () => {
    {
      const e = eng();
      let tip = -1;
      for (let i = 0; i < 200; i++) { e.step(SHOOT); if (tip < 0 && e.field.hive.tipCount === 1) tip = e.currentTick; }
      const third = arrivalOf(e, 45);
      assert(third > 46 && tip === third, `default hive {N3,P0}: 3rd POLLEN (fired tick 45 = 3 × 300ms) reaches {3,3} and tips on arrival (tick ${tip}, arrive ${third})`);
      assert(e.timeline[tip].totalScore === 20, 'tip score 20 live');
      assert(e.field.hive.upwardCell === 'OPPOSITE_CELL' && e.field.nectarStock === 4, 'cell flipped, human nectar spawned');
      assert(!e.field.hive.isTipping && e.r1.controlledPieces.length === 0, 'drops finished, all shot');
    }
  }, TEST_TIMEOUT_MS);

  it('D. FLOWER deQ / 잼 / 투입', () => {
    {
      const ANY2 = cfg('robot2', { intakeZones: createIntakeZonePreset('ANY', { length: 18, width: 18 }) });
      const e = eng({ ...EMPTY_R2, r2Spawn: pose(9, 107.9) }, C1, ANY2);
      for (let i = 0; i < 60; i++) e.step(undefined, INTAKE);
      assert(e.r2.controlledPieces.length === 4 && e.field.flowers[0].pieces.length === 0, 'deQ 4 pollen');
      const j = eng({ ...EMPTY_R2, r2Spawn: pose(9, 107.9) }, C1, ANY2);
      j.field.flowers[0].pieces.splice(2, 0, { ...j.pieces.find(p => p.type === 'NECTAR' && p.state === 'OUT_OF_BOUNDS')!, state: 'IN_FLOWER' });
      for (let i = 0; i < 60; i++) j.step(undefined, INTAKE);
      assert(j.field.flowers[0].pieces[0] === null && j.r2.controlledPieces.length === 2, 'nectar jam blocks deQ');
      const d = eng({ r2Spawn: pose(9, 107.9) });
      stepDrop(d, 25 + 10 * 4);
      assert(d.field.flowers[0].pieces.length === 8 && d.r2.controlledPieces.length === 0 && d.r2.actionState === 'FLOWER_READY', 'FLOWER 4 + 4 drops = 8 POLLEN (≤ 9), all dropped, lift stays up');
      const d9 = eng({ r2Spawn: pose(9, 107.9) });
      fillFlower1(d9, 8);
      stepDrop(d9, 45);
      assert(d9.field.flowers[0].pieces.length === 9 && d9.r2.controlledPieces.length === 3 && d9.r2.actionState === 'FLOWER_READY', 'FLOWER 8 + 1 drop = 9 (table max), next drop refused -> READY');
    }
  }, TEST_TIMEOUT_MS);

  it('E. 바닥 흡입', () => {
    {
      const e = eng({ ...EMPTY_R1, r1Spawn: pose(9, 20) });
      Object.assign(e.pieces.find(p => p.state === 'IN_GARDEN')!, { state: 'ON_FIELD', x: 40, y: 20 });
      for (let i = 0; i < 100; i++) e.step(inp('INTAKING', 30));
      assert(e.r1.controlledPieces.length === 1, 'floor intake');
    }
  }, TEST_TIMEOUT_MS);

  it('F. PARK (부분 진입)', () => {
    {
      const fin = (sc: Partial<ScenarioConfig>) => { const e = eng(sc); e.runFullMatch(); return e.getFrame(6000)!; };
      assert(fin({ r1Spawn: pose(9, 36), r2Spawn: pose(9, 55) }).rpAchieved.swarm, 'both partial -> swarm');
      assert(!fin({}).rpAchieved.swarm, 'one parked -> no swarm');
      const before = fin({ r1Spawn: pose(20, 36), r2Spawn: pose(60, 120) }).totalScore;
      const after = fin({ r1Spawn: pose(19.9, 36), r2Spawn: pose(60, 120) }).totalScore;
      assert(after - before === 5, `edge touch no, 0.1in overlap +5 (${before}->${after})`);
      assert(fin({ allianceColor: 'BLUE', r1Spawn: pose(135, 89, Math.PI) }).rpAchieved.swarm, 'blue swarm');
    }
  }, TEST_TIMEOUT_MS);

  it('G. 시드', () => {
    {
      const run = (sc: Partial<ScenarioConfig>) => { const e = eng({ flowerPiecesCount: [1, 1, 4, 4], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 }, ...sc }, C1, C2, fixedP(0.5, 1));
        e.inputProvider = (t) => ({ r1: t % 300 < 150 ? SHOOT : inp('INTAKING', 20, 10 * Math.sin(t / 40), 0.3), r2: SHOOT }); e.runFullMatch(); return JSON.stringify(e.timeline); };
      const def = run({});
      assert(def === run({ rngSeed: DEFAULT_RNG_SEED }), 'no seed == default');
      const s42 = run({ rngSeed: 42 });
      assert(s42 === run({ rngSeed: 42 }) && s42 !== run({ rngSeed: 43 }), 'seed reproducible / diverges');
      assert(run({ rngSeed: NaN }) === def && run({ rngSeed: 42.9 }) === s42, 'NaN->default, float truncated');
    }
  }, TEST_TIMEOUT_MS);

  it('H. 풀매치 결정론 / 스크러빙 / 분기', () => {
    {
      const prov = (t: number) => ({ r1: t < 400 ? SHOOT : inp('INTAKING', 20 * Math.sin(t / 50), 15, 1), r2: inp('INTAKING', 25, -10 * Math.cos(t / 80), -0.5) });
      const mk = () => { const s = eng({ flowerPiecesCount: [2, 2, 4, 4], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 }, r1Spawn: pose(30, 30, 0.5) }); s.inputProvider = prov; s.runFullMatch(); return s; };
      const a = mk(), b = mk();
      assert(a.timeline.length === 6001 && JSON.stringify(a.timeline) === JSON.stringify(b.timeline), '6001 frames, deterministic');
      assert(a.timeline[2999].field.matchPhase === 'TELEOP' && a.timeline[3000].field.matchPhase === 'ENDGAME' && a.timeline[3000].field.nectarStock === 0, 'endgame at 3000');
      const ref = JSON.stringify(b.timeline);
      a.scrubTo(3000);
      for (let t = 3000; t < 6000; t++) { const i = prov(t); a.step(i.r1, i.r2); }
      assert(JSON.stringify(a.timeline) === ref, 'scrub@3000 + resim identical');
      a.scrubTo(1234); a.scrubTo(5000);
      assert(a.timeline.length === 6001 && a.currentTick === 5000, 'scrub back/forward keeps future');
      a.scrubTo(2000); a.step(inp('IDLE', -60));
      assert(a.timeline.length === 2002 && JSON.stringify(a.timeline.slice(0, 2001)) === JSON.stringify(b.timeline.slice(0, 2001)), 'branch truncates future, past intact');
    }
  }, TEST_TIMEOUT_MS);

  it('I. GARDEN 정사영 판정 (원-사각형 겹침)', () => {
    {
      // RED 아군 GARDEN: x 0~23, y 142~144. 로봇은 가든과 먼 곳, 프리로드 0
      const endState = (place: (e: SimulationEngine) => void) => {
        const e = eng({ r1Spawn: pose(60, 30), r2Spawn: pose(100, 30) });
        place(e);
        while (e.currentTick < 6000) e.step();
        return e;
      };
      const redGarden = (e: SimulationEngine) => e.pieces.filter(p => p.state === 'IN_GARDEN' && p.y > 100);
      const cases: [number, boolean][] = [[142.6, true], [142.0, true], [141.9, true], [141.0, true], [140.7, true], [140.6, false], [140.0, false]];
      for (const [y, expect] of cases) {
        const e = endState((x) => redGarden(x).forEach(p => { p.y = y; }));
        const f = e.getFrame(6000)!;
        assert(f.totalScore === (expect ? 4 : 0), `POLLEN center y=${y} -> ${expect ? 'counted' : 'not counted'} (score ${f.totalScore})`);
      }
      // x 방향 측면 걸침: 중심 x=24.3 (가든 끝 23 + 1.3) 걸침 인정, x=24.4 (접함) 불인정
      for (const [x, expect] of [[24.3, 1], [24.41, 0]] as [number, number][]) {
        const e = endState((en) => { const g = redGarden(en); g.slice(1).forEach(p => { p.state = 'OUT_OF_BOUNDS'; p.x = -10; p.y = -10; }); g[0].x = x; });
        assert(e.getFrame(6000)!.totalScore === expect, `side overlap x=${x} -> ${expect}`);
      }
      // NECTAR (반지름 1.8): 중심 y=140.3 걸침 인정, 140.2 접함 불인정
      for (const [y, expect] of [[140.3, 1], [140.19, 0]] as [number, number][]) {
        const e = endState((en) => {
          redGarden(en).forEach(p => { p.state = 'OUT_OF_BOUNDS'; p.x = -10; p.y = -10; });
          Object.assign(en.pieces.find(p => p.type === 'NECTAR' && p.state === 'OUT_OF_BOUNDS')!, { state: 'ON_FIELD', x: 10, y });
        });
        // 엔드게임에 대기 NECTAR가 로딩 존에 스폰되므로 가든 점수만 분리 확인
        const f = e.getFrame(6000)!;
        const n = f.pieces.filter(p => p.type === 'NECTAR' && p.x === 10 && p.y === y)[0];
        assert(f.totalScore === expect && n.state === (expect ? 'IN_GARDEN' : 'ON_FIELD'), `NECTAR center y=${y} -> ${expect}`);
      }
      // 상대 GARDEN (BLUE, y 0~2) 공은 IN_GARDEN 상태지만 아군 점수 제외
      {
        const e = endState(() => {});
        const f = e.getFrame(6000)!;
        const blue = f.pieces.filter(p => p.state === 'IN_GARDEN' && p.y < 10).length;
        assert(blue === 4 && f.totalScore === 4, `opponent garden labeled (${blue}) but only ally scored (${f.totalScore})`);
      }
      // 경기 중 점수 미반영 + 틱마다 재판정 (로봇이 가든 공을 밀어내면 해제)
      {
        const e = eng({ r1Spawn: pose(11.5, 125, Math.PI / 2), r2Spawn: pose(100, 30) });
        e.step();
        assert(e.getFrame(1)!.totalScore === 0 && redGarden(e).length === 4, 'mid-match: labeled IN_GARDEN, score 0');
        for (let i = 0; i < 120; i++) e.step(inp('IDLE', 0, 40));
        assert(redGarden(e).length < 4, `robot pushing re-evaluates garden each tick (left ${redGarden(e).length})`);
      }
    }
  }, TEST_TIMEOUT_MS);

  it('J. BumperZone 인테이크 구역', () => {
    {
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
      const body0 = getRobotOBB({ x: 50, y: 50, heading: 0 } as never, C1);          // 앞 = +x, 오른쪽 = +y(화면 아래)
      const z = (side: BumperZone['side'], offset: number, width = 10, depth = 2): BumperZone => ({ side, offset, width, depth });
      const c = (zone: BumperZone, body = body0) => getBumperZoneOBB(body, zone)!;
      let o = c(z('FRONT', 0));
      assert(near(o.center.x, 60) && near(o.center.y, 50) && near(o.halfExtents[0], 1) && near(o.halfExtents[1], 5), 'FRONT zone: center on front edge + depth/2, extents [depth/2, width/2]');
      o = c(z('FRONT', 3));
      assert(near(o.center.x, 60) && near(o.center.y, 53), 'FRONT offset + = robot right');
      o = c(z('BACK', 3));
      assert(near(o.center.x, 40) && near(o.center.y, 53), 'BACK offset + = robot right');
      o = c(z('RIGHT', 3));
      assert(near(o.center.x, 53) && near(o.center.y, 60) && near(o.halfExtents[0], 5) && near(o.halfExtents[1], 1), 'RIGHT zone: offset + = robot front, extents [width/2, depth/2]');
      o = c(z('LEFT', 3));
      assert(near(o.center.x, 53) && near(o.center.y, 40), 'LEFT zone mirrored, offset + = robot front');
      const body90 = getRobotOBB({ x: 50, y: 50, heading: Math.PI / 2 } as never, C1);  // 앞 = +y, 오른쪽 = -x
      o = c(z('FRONT', 3), body90);
      assert(near(o.center.x, 47) && near(o.center.y, 60), 'rotates with heading (heading 90°: FRONT offset + → -x)');
      assert(near(c(z('FRONT', 20)).center.y, 59), 'offset clamped to edge (|offset| ≤ side/2)');
      assert(getBumperZoneOBB(body0, z('FRONT', 0, 0, 2)) === null && getBumperZoneOBB(body0, z('FRONT', 0, 5, -1)) === null, 'non-positive width/depth -> no zone');

      const front = createIntakeZonePreset('FRONT', { length: 18, width: 16 });
      assert(front.length === 1 && front[0].side === 'FRONT' && front[0].width === 16 && front[0].depth === DEFAULT_PRESET_ZONE_DEPTH && DEFAULT_PRESET_ZONE_DEPTH === 1, 'FRONT preset: 1 zone, width = robot width, depth 1');
      const any = createIntakeZonePreset('ANY', { length: 18, width: 16 });
      const w = Object.fromEntries(any.map(q => [q.side, q.width]));
      assert(any.length === 4 && w.FRONT === 18 && w.BACK === 18 && w.LEFT === 20 && w.RIGHT === 20, 'ANY preset: 4 zones, width = side + 2·depth');

      // ANY 프리셋 ≡ 구 ANY (차체를 사방으로 depth 확장한 박스): 차체와 겹치지 않는 모든 공 위치에서 판정 일치
      let mismatch = 0, samples = 0;
      for (const heading of [0, 0.4, Math.PI / 2, 2.2, -1.1]) {
        const cfgA = { ...C1, length: 18, width: 16 };
        const body = getRobotOBB({ x: 72, y: 72, heading } as never, cfgA);
        const zones = createIntakeZonePreset('ANY', cfgA, 2).map(q => getBumperZoneOBB(body, q)!);
        const expanded = { ...body, halfExtents: [body.halfExtents[0] + 2, body.halfExtents[1] + 2] as [number, number] };
        for (let x = 52; x <= 92; x += 0.37) for (let y = 52; y <= 92; y += 0.37) {
          const circle = { center: { x, y }, radius: 1.4 };
          if (testOBBvsCircle(body, circle).colliding) continue;
          samples++;
          if (zones.some(q => testOBBvsCircle(q, circle).colliding) !== testOBBvsCircle(expanded, circle).colliding) mismatch++;
        }
      }
      assert(mismatch === 0, `ANY preset equals legacy expanded box (${samples} samples, ${mismatch} mismatches)`);

      // 정사영 판정: 공 중심이 구역 밖이어도 걸치면 흡입 (FRONT depth 1, 공 중심은 전면에서 2.0in → 걸침 0.4in)
      const runIntake = (c1: RobotConfig, ballX: number, ballY: number, vx = 0) => {
        const e = eng({ ...EMPTY_R1, r1Spawn: pose(40, 40) }, c1);
        Object.assign(e.pieces.find(p => p.state === 'IN_GARDEN')!, { state: 'ON_FIELD', x: ballX, y: ballY });
        for (let i = 0; i < 30; i++) e.step(inp('INTAKING', vx));
        return e.r1.controlledPieces.length;
      };
      const F1 = cfg('robot1', { intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }) });
      assert(runIntake(F1, 51, 40) === 1, 'ball center outside zone but projection overlaps -> intake');
      assert(runIntake(F1, 51.5, 40) === 0, 'ball projection just clear of zone (0.1in gap) -> no intake');
      assert(runIntake(F1, 28.9, 40) === 0, 'FRONT-only robot ignores ball behind');
      const B1 = cfg('robot1', { intakeZones: [{ side: 'BACK', offset: 0, width: 18, depth: 1 }] });
      assert(runIntake(B1, 28.9, 40) === 1, 'BACK zone intakes ball behind');
      const R1 = cfg('robot1', { intakeZones: [{ side: 'RIGHT', offset: 4, width: 6, depth: 1 }] });
      assert(runIntake(R1, 44, 50.9) === 1 && runIntake(R1, 36, 50.9) === 0, 'RIGHT zone with offset: front-right intakes, rear-right does not');
      const split = cfg('robot1', { intakeZones: [{ side: 'FRONT', offset: -6, width: 4, depth: 1 }, { side: 'FRONT', offset: 6, width: 4, depth: 1 }] });
      assert(runIntake(split, 50.9, 46) === 1 && runIntake(split, 50.9, 40) === 0, 'two zones on one edge: gap in the middle does not intake');
      assert(runIntake(cfg('robot1', { intakeZones: [] }), 50.9, 40) === 0, 'empty intakeZones -> cannot intake');

      // FLOWER 하단 추출: 인테이크 구역이 FLOWER에 겹쳐야 함 (r2 왼쪽 면이 FLOWER1과 0.9in 간격)
      const deq = (c2: RobotConfig, spawn = pose(9, 107.9)) => {
        const e = eng({ ...EMPTY_R2, r2Spawn: spawn }, C1, c2);
        for (let i = 0; i < 60; i++) e.step(undefined, INTAKE);
        return e.r2.controlledPieces.length;
      };
      assert(deq(cfg('robot2', { intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }) })) === 0, 'FRONT-only robot cannot deQ with its side');
      assert(deq(cfg('robot2', { intakeZones: [{ side: 'LEFT', offset: 0, width: 18, depth: 1 }] })) === 4, 'LEFT zone deQ from flower on robot left');
      assert(deq(cfg('robot2', { intakeZones: [{ side: 'LEFT', offset: 0, width: 18, depth: 0.5 }] })) === 0, 'zone depth 0.5 does not reach flower 0.9in away');
      assert(deq(cfg('robot2', { intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }) }), pose(96, 131.5, Math.PI / 2)) === 4, 'FRONT zone facing flower4 deQ');
      // FLOWER 투입은 방향 무관 (버전 1): FRONT 전용 로봇이 왼쪽 면으로 투입
      const d = eng({ r2Spawn: pose(9, 107.9) });
      stepDrop(d, 45);
      assert(d.field.flowers[0].pieces.length === 6, 'flower drop remains direction-independent (reach 1.0in, 2 drops by tick 45)');
    }
  }, TEST_TIMEOUT_MS);

  it('K. 시작 상황 (적재물 / 잔여 공 / 오토 팁 / 검증)', () => {
    {
      const where = (e: SimulationEngine) => {
        const c = (type: string, st: string) => e.pieces.filter(p => p.type === type && p.state === st).length;
        return { pField: c('POLLEN', 'ON_FIELD'), pOOB: c('POLLEN', 'OUT_OF_BOUNDS'), nField: c('NECTAR', 'ON_FIELD'), nOOB: c('NECTAR', 'OUT_OF_BOUNDS'), stock: e.field.nectarStock };
      };
      // 기본 시나리오는 이전과 동일: 산포 없음, 재고 5, 밖으로 빠진 POLLEN 없음
      const d = eng();
      const w0 = where(d);
      assert(w0.pField === 0 && w0.pOOB === 0 && w0.nField === 0 && w0.stock === 5 && w0.nOOB === 5, 'default: no scatter, stock 5, all 32 POLLEN placed');
      assert(validateScenario({ allianceColor: 'RED' }, C1, C2).length === 0, 'default scenario valid');

      // 남는 POLLEN / NECTAR는 바닥 산포 (FLOWER 3개 감소 + GARDEN 1개 감소 + HIVE NECTAR 1개 감소)
      const e = eng({ flowerPiecesCount: [4, 2, 3, 4], gardenPiecesCount: { ally: 3, opponent: 4 }, hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } });
      const w1 = where(e);
      assert(w1.pField === 4 && w1.pOOB === 0 && w1.nField === 1 && w1.stock === 5, `leftover POLLEN 4 + NECTAR 1 scattered, stock stays 5 (${JSON.stringify(w1)})`);
      assert(e.pieces.filter(p => p.state === 'IN_GARDEN' && p.y > 100).length === 3, 'ally garden count 3');

      // 적재 한도 3: 기본 적재 3개, 남은 POLLEN 1개 산포, 흡입도 3개에서 정지
      const C3 = cfg('robot1', { maxControlledPieces: 3 });
      const c3 = eng({}, C3);
      assert(getCarryCapacity(C3) === 3 && c3.r1.controlledPieces.length === 3 && where(c3).pField === 1, 'capacity 3: default loadout 3, 1 POLLEN scattered');
      assert(getCarryCapacity(cfg('robot1', { maxControlledPieces: 9 })) === 4 && getCarryCapacity(cfg('robot1', { maxControlledPieces: -2 })) === 0, 'capacity clamped to 0..4');
      {
        const e3 = eng({ r1Loadout: ['POLLEN', 'POLLEN'], r1Spawn: pose(40, 40), gardenPiecesCount: { ally: 6, opponent: 4 } }, C3);
        const balls = e3.pieces.filter(p => p.state === 'IN_GARDEN' && p.y > 100).slice(0, 3);
        balls.forEach((b, i) => Object.assign(b, { state: 'ON_FIELD', x: 50.9, y: 34 + i * 6 }));
        for (let i = 0; i < 60; i++) e3.step(INTAKE);
        assert(e3.r1.controlledPieces.length === 3, 'intake stops at capacity 3');
      }

      // FIFO: 0번이 먼저 나감. [NECTAR, POLLEN] → 텔레옵 FLOWER 투입 거부(NECTAR는 엔드게임만), 맨 앞 원복
      {
        const f = eng({ r2Loadout: ['NECTAR', 'POLLEN'], r2Spawn: pose(9, 107.9), hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } });
        assert(f.r2.controlledPieces[0].type === 'NECTAR', 'loadout order preserved (index 0 = NECTAR)');
        stepDrop(f, 35);
        assert(f.field.flowers[0].pieces.length === 4 && f.r2.controlledPieces[0].type === 'NECTAR' && f.r2.controlledPieces.length === 2 && f.r2.actionState === 'IDLE'
          && f.timeline.every(fr => fr.r2.actionState === 'IDLE'),
          'TELEOP: NECTAR at front -> lift request refused (never enters FLOWER_SETUP), loadout untouched');
        const g = eng({ r1Loadout: ['NECTAR', 'POLLEN', 'POLLEN'], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } });
        for (let i = 0; i < 15; i++) g.step(SHOOT);
        assert(g.r1.controlledPieces.map(p => p.type).join() === 'POLLEN,POLLEN' && g.field.pendingShots.map(s => s.pieceType).join() === 'NECTAR', 'FIFO shooting: NECTAR (index 0) fired first');
        settle(g);   // 사격은 잠금 동작이라 15틱에 예약된 둘째 발(POLLEN)도 발사됨
        assert(g.pieces.filter(p => p.type === 'NECTAR' && p.state === 'IN_HIVE').length === 3, 'NECTAR arrives in HIVE');
      }

      // 오토 팁 2회: 로딩 존에 NECTAR 2개 결정론 배치, 재고 3, 산포는 그 뒤 (겹치지 않음)
      {
        const t = eng({ autoTipCount: 2, r1Spawn: pose(40, 20), flowerPiecesCount: [0, 0, 0, 0] });
        const lz = LOADING_ZONE_AABB.RED;
        const inLZ = t.pieces.filter(p => p.type === 'NECTAR' && p.state === 'ON_FIELD' && p.x >= lz.minX && p.x <= lz.maxX && p.y >= lz.minY && p.y <= lz.maxY);
        assert(inLZ.length === 2 && t.field.nectarStock === 3, `autoTipCount 2 -> 2 NECTAR in loading zone, stock 3`);
        const t2 = eng({ autoTipCount: 2, r1Spawn: pose(40, 20), flowerPiecesCount: [0, 0, 0, 0], rngSeed: 99 });
        const pos = (x: SimulationEngine) => x.pieces.filter(p => p.type === 'NECTAR' && p.state === 'ON_FIELD').map(p => `${p.x},${p.y}`).join('|');
        assert(pos(t) === pos(t2), 'loading-zone NECTAR placement independent of seed (deterministic slots)');
        const field = t.pieces.filter(p => p.state === 'ON_FIELD');
        let overlap = 0;
        for (let i = 0; i < field.length; i++) for (let j = i + 1; j < field.length; j++) if (Math.hypot(field[i].x - field[j].x, field[i].y - field[j].y) < 2.8) overlap++;
        assert(where(t).pField === 16 && overlap === 0, '16 scattered POLLEN avoid loading-zone NECTAR and each other');
        // 텔레옵 첫 팁 → 재고에서 1개 추가 스폰
        for (let i = 0; i < 200; i++) t.step(SHOOT);
        assert(t.field.hive.tipCount === 1 && t.field.nectarStock === 2, 'teleop tip spawns from remaining stock (3 -> 2)');
      }

      // canIntakeNectar = false: 엔진은 NECTAR를 적재하지 않고, 검증은 오류
      {
        const noN = cfg('robot1', { canIntakeNectar: false });
        const n = eng({ r1Loadout: ['NECTAR', 'POLLEN'], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } }, noN);
        assert(n.r1.controlledPieces.map(p => p.type).join() === 'POLLEN', 'NECTAR stripped from loadout of non-NECTAR robot');
        assert(validateScenario({ allianceColor: 'RED', r1Loadout: ['NECTAR'], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } }, noN, C2).some(i => i.code === 'LOADOUT_NECTAR_NOT_ALLOWED'), 'validate: LOADOUT_NECTAR_NOT_ALLOWED');
      }

      // 검증 규칙
      const codes = (sc: Partial<ScenarioConfig>, c1 = C1) => validateScenario({ allianceColor: 'RED', ...sc }, c1, C2).map(i => i.code);
      assert(codes({ flowerPiecesCount: [5, 4, 4, 4] }).includes('FLOWER_COUNT'), 'validate: FLOWER > 4');
      // 팁 임계 테이블: 도달 조합은 오류, 한 개 모자란 조합은 허용 (시작 NECTAR는 최대 3)
      for (const [n, p] of [[3, 3], [2, 5], [1, 6], [0, 8]]) {
        const small = { flowerPiecesCount: [0, 0, 0, 0] as [number, number, number, number] };
        assert(codes({ ...small, hiveInitialPieces: { nectarCount: n, pollenCount: p } }).includes('HIVE_OVER_THRESHOLD'), `validate: HIVE {N${n},P${p}} reaches tip table -> error`);
        assert(!codes({ ...small, hiveInitialPieces: { nectarCount: n, pollenCount: p - 1 } }).includes('HIVE_OVER_THRESHOLD'), `validate: HIVE {N${n},P${p - 1}} below table -> ok`);
      }
      assert(codes({ gardenPiecesCount: { ally: 8, opponent: 8 } }).includes('POLLEN_TOTAL_EXCEEDED'), 'validate: POLLEN total > 32');
      assert(codes({ gardenPiecesCount: { ally: 9, opponent: 0 } }).includes('GARDEN_COUNT'), 'validate: GARDEN > 8');
      assert(codes({ r1Loadout: ['POLLEN', 'POLLEN', 'POLLEN', 'POLLEN'] }, C3).includes('LOADOUT_OVER_CAPACITY'), 'validate: loadout > capacity');
      assert(codes({ r1Loadout: ['NECTAR'] }).includes('NECTAR_IN_PLAY_EXCEEDED'), 'validate: HIVE 3 + robot 1 NECTAR > 3');
      assert(codes({ autoTipCount: 6 }).includes('AUTO_TIP_COUNT') && codes({ autoTipCount: 1.5 }).includes('AUTO_TIP_COUNT'), 'validate: autoTipCount 0..5 integer');
      // 엔진 안전장치: 검증 실패 값도 잘라서 수용, 총량 보존
      const bad = eng({ flowerPiecesCount: [9, 9, 9, 9], gardenPiecesCount: { ally: 20, opponent: 20 }, hiveInitialPieces: { pollenCount: 5, nectarCount: 5 }, autoTipCount: 10 });
      const types = (t: string) => bad.pieces.filter(p => p.type === t).length;
      assert(bad.field.flowers.every(f => f.pieces.length === 4) && bad.field.hive.nectarInUpwardCell === 3 && bad.field.hive.pollenInUpwardCell === 2 && bad.field.nectarStock === 0 && types('POLLEN') === 32 && types('NECTAR') === 8,
        'engine clamps invalid scenario (flower 4, hive {N3,P2} below table, stock ≥ 0), totals conserved');
    }
  }, TEST_TIMEOUT_MS);

  it('L. 끼인 공 역보정 (로봇-벽/장애물 사이 공)', () => {
    {
      // 로봇 OBB 안으로 공이 파고든 최대 깊이 (원-OBB 겹침 깊이)
      const pen = (e: SimulationEngine, id: string) => {
        const b = e.pieces.find(p => p.id === id)!;
        if (b.state !== 'ON_FIELD') return 0; // 흡입된 기물은 로봇 중심에 동기화되므로 제외
        const hit = testOBBvsCircle(getRobotOBB(e.r1, C1), { center: { x: b.x, y: b.y }, radius: 1.4 });
        return hit.colliding ? hit.depth : 0;
      };
      // 뒷면(인테이크 없음)으로 공을 아래 벽(y=144)에 밀어붙임: heading -90° → 뒤쪽 = +y
      const pinRun = (heading: number, ballDx: number, steps = 150, input = inp('IDLE', 0, 30), c1 = C1) => {
        const e = eng({ ...EMPTY_R1, r1Spawn: pose(70, 110, heading), r2Spawn: pose(30, 30) }, c1);
        const ball = e.pieces.find(p => p.state === 'IN_GARDEN')!;
        Object.assign(ball, { state: 'ON_FIELD', x: 70 + ballDx, y: 121 });
        let maxPen = 0;
        for (let i = 0; i < steps; i++) { e.step(input); maxPen = Math.max(maxPen, pen(e, ball.id)); }
        return { e, ball: e.pieces.find(p => p.id === ball.id)!, maxPen };
      };
      let r = pinRun(-Math.PI / 2, 0);
      assert(r.maxPen < 0.05 && Math.abs(r.e.r1.y - (144 - 2.8 - 9)) < 0.1 && r.e.r1.vy === 0,
        `face parallel to wall: robot stops at ball (robot y=${r.e.r1.y.toFixed(2)}, max pen ${r.maxPen.toFixed(3)}in)`);
      r = pinRun(-Math.PI / 2, 7);
      assert(r.maxPen < 0.05, `ball near robot corner also blocks (max pen ${r.maxPen.toFixed(3)}in)`);
      r = pinRun(-Math.PI / 2 + 0.26, 0);
      assert(r.maxPen < 0.05 && Math.abs(r.e.r1.y - (144 - 9 * Math.cos(0.26) - 9 * Math.sin(0.26))) < 0.05, `15° face: ball squeezes out, robot reaches wall (robot y=${r.e.r1.y.toFixed(2)})`);
      // 공을 벽에 누른 채 옆으로 미끄러짐: 접선 속도 보존, 공은 모서리를 돌아 빠져나옴
      {
        const e = eng({ ...EMPTY_R1, r1Spawn: pose(70, 110, -Math.PI / 2), r2Spawn: pose(30, 30) });
        const ball = e.pieces.find(p => p.state === 'IN_GARDEN')!;
        Object.assign(ball, { state: 'ON_FIELD', x: 70, y: 121 });
        for (let i = 0; i < 100; i++) e.step(inp('IDLE', 0, 30));
        const x0 = e.r1.x;
        let maxPen = 0;
        // -x 방향으로 미끄러짐 (+x 쪽에는 FLOWER 4 (96, 142)가 있어 막힘)
        for (let i = 0; i < 75; i++) { e.step(inp('IDLE', -25, 30)); maxPen = Math.max(maxPen, pen(e, ball.id)); }
        assert(x0 - e.r1.x > 20 && maxPen < 0.05 && e.r1.y > 134.99, `slides along wall past the ball, then reaches wall (dx ${(e.r1.x - x0).toFixed(1)}in, robot y ${e.r1.y.toFixed(2)})`);
      }
      // HIVE에 밀어붙임 (HIVE 하단 y=91.475, 로봇이 위로 전진)
      {
        const e = eng({ ...EMPTY_R1, r1Spawn: pose(60, 125, -Math.PI / 2), r2Spawn: pose(30, 30) });
        const ball = e.pieces.find(p => p.state === 'IN_GARDEN')!;
        Object.assign(ball, { state: 'ON_FIELD', x: 60, y: 112 });
        let maxPen = 0;
        for (let i = 0; i < 150; i++) { e.step(inp('IDLE', 0, -30)); maxPen = Math.max(maxPen, pen(e, ball.id)); }
        assert(maxPen < 0.05 && Math.abs(e.r1.y - (91.475 + 2.8 + 9)) < 0.1, `pinned against HIVE: robot stops (y=${e.r1.y.toFixed(2)})`);
      }
      // 인테이크 면으로 밀어붙이면 겹침 없이 멈췄다가 흡입
      {
        // 흡입 딜레이 1.5초: 공이 벽에 먼저 끼인 뒤 흡입되는 순서를 확인
        const slowIntake = cfg('robot1', { intakeDelay: 1500 });
        const early = pinRun(Math.PI / 2, 0, 60, inp('INTAKING', 0, 30), slowIntake);
        assert(early.maxPen < 0.05 && early.e.r1.controlledPieces.length === 0 && Math.abs(early.e.r1.y - 132.2) < 0.1, 'intake face: ball pinned at wall without overlap before intakeDelay');
        const late = pinRun(Math.PI / 2, 0, 150, inp('INTAKING', 0, 30), slowIntake);
        assert(late.maxPen < 0.05 && late.e.r1.controlledPieces.length === 1, 'intake face: pinned ball intaken after intakeDelay');
      }
      // 막힘 없는 공은 기존대로 로봇 감속 없이 밀려남
      {
        // 열린 공간 (x=120 세로 통로, HIVE는 x ≤ 96.73)
        const e = eng({ ...EMPTY_R1, r1Spawn: pose(120, 90, Math.PI / 2), r2Spawn: pose(30, 30) });
        const ball = e.pieces.find(p => p.state === 'IN_GARDEN')!;
        Object.assign(ball, { state: 'ON_FIELD', x: 120, y: 102 });
        for (let i = 0; i < 40; i++) e.step(inp('IDLE', 0, 30));
        const b = e.pieces.find(p => p.id === ball.id)!;
        assert(Math.abs(e.r1.vy - 30) < 1e-9 && b.y > e.r1.y + 9, 'free ball: robot keeps full speed, ball pushed ahead');
      }
      // 두 로봇 사이에 낀 공 (열린 공간 y=120 통로)
      const twoRobots = (p1: RobotPose, p2: RobotPose, ballX: number, v1: number, v2: number) => {
        const e = eng({ ...EMPTY_R1, r1Spawn: p1, r2Spawn: p2 });
        const ball = e.pieces.find(p => p.state === 'IN_GARDEN')!;
        Object.assign(ball, { state: 'ON_FIELD', x: ballX, y: 120 });
        let maxPen = 0;
        for (let i = 0; i < 120; i++) {
          e.step(inp('IDLE', v1), inp('IDLE', v2));
          const b = e.pieces.find(p => p.id === ball.id)!;
          if (b.state !== 'ON_FIELD') continue;
          for (const [rs, rc] of [[e.r1, C1], [e.r2, C2]] as const) {
            const h = testOBBvsCircle(getRobotOBB(rs, rc), { center: { x: b.x, y: b.y }, radius: 1.4 });
            if (h.colliding) maxPen = Math.max(maxPen, h.depth);
          }
        }
        return { e, maxPen };
      };
      {
        const { e, maxPen } = twoRobots(pose(40, 120, 0), pose(70, 120, Math.PI), 55, 20, -20);
        assert(maxPen < 0.05 && Math.abs((e.r2.x - e.r1.x) - (18 + 2.8)) < 0.1, `ball squeezed by two converging robots: both stop at ball (gap ${(e.r2.x - e.r1.x - 18).toFixed(2)}in, max pen ${maxPen.toFixed(3)}in)`);
      }
      {
        // R1은 벽(x=0)에 붙어 정지, R2가 공을 R1 쪽으로 밀고 들어옴 → 밀고 들어온 R2가 정지해야 함
        const { e, maxPen } = twoRobots(pose(9, 120, 0), pose(45, 120, Math.PI), 24, 0, -20);
        assert(maxPen < 0.05 && Math.abs(e.r1.x - 9) < 0.01 && Math.abs(e.r2.x - (9 + 18 + 2.8)) < 0.1,
          `ball pushed into a walled robot: pushing robot (R2) stops (R2 x=${e.r2.x.toFixed(2)}, max pen ${maxPen.toFixed(3)}in)`);
      }
    }
  }, TEST_TIMEOUT_MS);

  it('M. HIVE 팁 임계 테이블 / 팁 중 빗맞음 / RP 오토 팁 합산', () => {
    {
      // 시작 {N, P-1}에서 POLLEN 1발 명중 → {N, P} 도달 즉시 팁 (NECTAR 0~3)
      for (const [n, p] of [[0, 8], [1, 6], [2, 5], [3, 3]]) {
        const e = eng({ flowerPiecesCount: [0, 0, 0, 0], hiveInitialPieces: { nectarCount: n, pollenCount: p - 1 } });
        for (let i = 0; i < 15; i++) e.step(SHOOT);
        settle(e);
        const arrive = arrivalOf(e, 15);
        const f = e.getFrame(arrive)!;
        assert(f.field.hive.tipCount === 1 && f.field.hive.isTipping && e.getFrame(arrive - 1)!.field.hive.tipCount === 0,
          `{N${n},P${p - 1}} + 1 POLLEN hit -> tip on the arrival tick (${arrive})`);
      }
      // NECTAR 4, 5개 구간: 런타임 상태를 직접 설정해 확인
      {
        const e = eng({ flowerPiecesCount: [0, 0, 0, 0], hiveInitialPieces: { nectarCount: 3, pollenCount: 0 } });
        e.field.hive.nectarInUpwardCell = 4;
        for (let i = 0; i < 15; i++) e.step(SHOOT);
        settle(e);
        assert(e.field.hive.tipCount === 1, '{N4,P0} + 1 POLLEN -> {4,1} tips');
        const e5 = eng({ r1Loadout: ['NECTAR', 'POLLEN'], flowerPiecesCount: [0, 0, 0, 0], hiveInitialPieces: { nectarCount: 2, pollenCount: 0 } });
        e5.field.hive.nectarInUpwardCell = 4;
        for (let i = 0; i < 15; i++) e5.step(SHOOT);
        settle(e5);
        assert(e5.field.hive.tipCount === 1 && e5.timeline[arrivalOf(e5, 15)].field.hive.tipCount === 1, '{N4,P0} + 1 NECTAR -> {5,0} tips with zero POLLEN');
      }
      // 상향 셀 개수는 종류별로 집계, 임계 미도달이면 팁 없음
      {
        const e = eng({ r1Loadout: ['NECTAR', 'POLLEN'], hiveInitialPieces: { nectarCount: 0, pollenCount: 0 }, flowerPiecesCount: [0, 0, 0, 0] });
        for (let i = 0; i < 30; i++) e.step(SHOOT);
        settle(e);
        assert(e.field.hive.nectarInUpwardCell === 1 && e.field.hive.pollenInUpwardCell === 1 && e.field.hive.tipCount === 0, 'counts tracked per type: {N1,P1}, no tip');
      }
      // 팁 진행 중 발사 / 도착은 명중률 100%여도 전부 빗맞음
      // (1발째 15틱 발사 → 도착 틱에 팁, 2~4발째는 팁 전에 발사됐어도 전복 중에 도착하면 반사 방출, 팁 후 발사는 발사 시점에 빗맞음)
      {
        const e = eng({ flowerPiecesCount: [0, 0, 0, 0], hiveInitialPieces: { nectarCount: 3, pollenCount: 2 } });
        for (let i = 0; i < 60; i++) e.step(SHOOT);
        settle(e);
        const f = e.getFrame(e.currentTick)!;
        const rebounds = f.pieces.filter(p => p.type === 'POLLEN' && p.state === 'ON_FIELD' && p.id.startsWith('pollen-')).length;
        assert(f.field.hive.isTipping && f.field.hive.tipCount === 1 && f.field.hive.pollenInUpwardCell === 0 && e.r1.controlledPieces.length === 0 && rebounds >= 3,
          `shots during tipping all miss (accuracy 1.0, ${rebounds} rebounds, new cell still empty)`);
      }
      // RP: 오토 팁 + 텔레옵 팁 합산, 점수는 텔레옵 팁만
      {
        const fin = (autoTipCount: number) => {
          const e = eng({ autoTipCount, r1Spawn: pose(60, 20), flowerPiecesCount: [0, 0, 0, 0], hiveInitialPieces: { nectarCount: 3, pollenCount: 2 } });
          for (let i = 0; i < 20; i++) e.step(SHOOT);
          while (e.currentTick < 6000) e.step();
          return e.getFrame(6000)!;
        };
        const f3 = fin(3), f0 = fin(0), f5 = fin(5);
        assert(f3.field.hive.tipCount === 1 && f3.field.hive.autoTipCount === 3 && f3.rpAchieved.pollinator1 && !f3.rpAchieved.pollinator2, 'auto 3 + teleop 1 = 4 tips -> POLLINATOR 1');
        assert(!f0.rpAchieved.pollinator1, 'auto 0 + teleop 1 -> no POLLINATOR');
        assert(f5.rpAchieved.pollinator1 && !f5.rpAchieved.pollinator2, 'auto 5 + teleop 1 = 6 -> POLLINATOR 1 only');
        const teleopTipPoints = (f: typeof f3) => f.field.hive.tipCount * 20;
        assert(teleopTipPoints(f3) === 20 && f3.totalScore - teleopTipPoints(f3) === f0.totalScore - teleopTipPoints(f0), 'score counts teleop tips only (auto tips add no points)');
      }
    }
  }, TEST_TIMEOUT_MS);

  it('N. FLOWER 투입 요청 시점 거부', () => {
    {
      const everLifted = (e: SimulationEngine, from = 0) => e.timeline.slice(from).some(fr => fr.r2.actionState !== 'IDLE' && fr.r2.actionState !== 'INTAKING');
      // ② 도달 거리 내 FLOWER 없음
      {
        const e = eng({ r2Spawn: pose(60, 120) });
        stepDrop(e, 40);
        assert(!everLifted(e) && e.r2.controlledPieces.length === 4, 'no FLOWER in reach -> lift request refused, stays IDLE');
      }
      // ③ 용량 초과: FLOWER1을 8개로 채운 뒤 1개 투입 → 9개(테이블 최대) → 추가 투입 요청 무시, 리프트는 올린 채 대기
      {
        const e = eng({ r2Spawn: pose(9, 107.9) });
        fillFlower1(e, 8);
        stepDrop(e, 35);                                                  // 35틱: 1개 투입 (8 → 9)
        assert(e.field.flowers[0].pieces.length === 9 && e.r2.actionState === 'FLOWER_READY', 'first drop OK (8 -> 9), then no rearm because next POLLEN would exceed capacity');
        stepDrop(e, 100);
        assert(e.timeline.slice(36).every(fr => fr.r2.actionState === 'FLOWER_READY') && e.r2.controlledPieces.length === 3,
          'holding drop button at full FLOWER: request ignored, lift waits (no repeated cycles)');
      }
      // 연속 투입: 가능할 때는 재장전 (FLOWER2가 비어 있으면 5개까지 연속 투입)
      {
        const e = eng({ flowerPiecesCount: [0, 4, 4, 4], r2Spawn: pose(9, 107.9) });
        stepDrop(e, 25 + 10 * 4);                                         // 올림 25틱 + 투입 10틱 × 4
        assert(e.field.flowers[0].pieces.length === 4 && e.r2.controlledPieces.length === 0, 'continuous drops while allowed (4 POLLEN into empty FLOWER)');
      }
      // ① NECTAR: TELEOP 거부, ENDGAME 수락
      {
        const e = eng({ r2Loadout: ['NECTAR', 'POLLEN'], r2Spawn: pose(9, 107.9), hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } });
        while (e.currentTick < 2990) e.step(undefined, liftDrop(e));
        assert(!everLifted(e), 'NECTAR at front refused for the whole TELEOP phase');
        while (e.currentTick < 3040) e.step(undefined, liftDrop(e));
        const f = e.field.flowers[0];
        assert(f.pieces.some(p => p?.type === 'NECTAR') && e.r2.controlledPieces.length <= 1, 'ENDGAME: NECTAR lift / drop accepted and dropped');
      }
      // 투입 요청 시점 검사: 대기 중에 FLOWER가 가득 차면 투입 요청 무시, 기물 그대로
      {
        const e = eng({ r2Spawn: pose(9, 107.9) });
        e.step(undefined, LIFT);
        assert(e.r2.actionState === 'FLOWER_SETUP', 'lift request accepted (FLOWER1 has room)');
        fillFlower1(e, 9);                                                // 올리는 중 다른 요인으로 9개(가득)가 됨
        stepDrop(e, 40);
        assert(e.field.flowers[0].pieces.length === 9 && e.r2.controlledPieces.length === 4 && e.r2.actionState === 'FLOWER_READY'
          && !e.timeline.some(fr => fr.r2.actionState === 'FLOWER_DROPPING'), 'READY: drop request refused when FLOWER became full, loadout untouched');
      }
      // 안전장치: 투입 중에 FLOWER가 가득 차면 완료 시점에 거부, 기물 그대로 두고 대기 복귀
      {
        const e = eng({ r2Spawn: pose(9, 107.9) });
        while (e.r2.actionState !== 'FLOWER_DROPPING' && e.currentTick < 40) e.step(undefined, liftDrop(e));
        assert(e.r2.actionState === 'FLOWER_DROPPING', 'drop accepted');
        fillFlower1(e, 9);
        for (let i = 0; i < 12; i++) e.step(undefined, LIFT);
        assert(e.field.flowers[0].pieces.length === 9 && e.r2.controlledPieces.length === 4 && e.r2.actionState === 'FLOWER_READY', 'completion-time safety check rejects, loadout untouched, back to READY');
      }
    }
  }, TEST_TIMEOUT_MS);

  it('O. FLOWER 용량 테이블 (21.5in 원통)', () => {
    {
      // 엔진 판정을 직접 확인: 투입 후 {P, N}이 테이블 이내면 투입, 초과면 요청 거부
      // FLOWER는 slot[0] 불변식을 지켜 구성: NECTAR가 있으면 slot[0]은 실제 POLLEN(normal) 또는 빈칸(jam)
      // e = 계산상 POLLEN 수 (jam이면 빈 slot[0] 1개 포함)
      const table: [number, number][] = [[9, 0], [8, 1], [6, 2], [5, 3], [3, 4], [2, 5], [1, 6]];
      const tryDrop = (e: number, nectarInFlower: number, type: 'POLLEN' | 'NECTAR', jam: boolean) => {
        const en = eng({ r2Loadout: [type], r2Spawn: pose(9, 107.9), flowerPiecesCount: [0, 4, 4, 4], hiveInitialPieces: { pollenCount: 0, nectarCount: 0 } });
        while (en.currentTick < 3000) en.step();                           // ENDGAME (NECTAR 투입 허용)
        const f = en.field.flowers[0];
        const pollen = () => { const p = en.pieces.find(q => q.type === 'POLLEN' && (q.state === 'ON_FIELD' || q.state === 'IN_GARDEN'))!; p.state = 'IN_FLOWER'; return p; };
        const nectar = () => { const p = en.pieces.find(q => q.type === 'NECTAR' && q.state !== 'IN_FLOWER' && q.state !== 'CONTROLLED')!; p.state = 'IN_FLOWER'; return p; };
        if (nectarInFlower === 0) f.pieces = Array.from({ length: e }, pollen);
        else if (jam) f.pieces = [null, ...Array.from({ length: nectarInFlower }, nectar), ...Array.from({ length: e - 1 }, pollen)];
        else f.pieces = [pollen(), ...Array.from({ length: nectarInFlower }, nectar), ...Array.from({ length: e - 1 }, pollen)];
        const before = f.pieces.length;
        stepDrop(en, 40);
        assert(f.pieces[0]?.type !== 'NECTAR', 'slot[0] never NECTAR');
        return f.pieces.length - before;
      };
      for (const [p, n] of table) {
        for (const jam of n > 0 ? [false, true] : [false]) {
          const label = `N${n} ${n === 0 ? '' : jam ? '(jam) ' : '(normal) '}`;
          if (p - 1 >= (n > 0 ? 1 : 0)) assert(tryDrop(p - 1, n, 'POLLEN', jam) === 1, `${label}POLLEN ${p - 1} -> ${p} accepted`);
          assert(tryDrop(p, n, 'POLLEN', jam) === 0, `${label}POLLEN ${p} -> ${p + 1} refused`);
        }
      }
      assert(tryDrop(1, 5, 'NECTAR', true) === 1 && tryDrop(1, 6, 'NECTAR', true) === 0, 'NECTAR: {P1,N5} -> {1,6} accepted, {P1,N6} -> N7 refused (max NECTAR 6)');
      assert(tryDrop(2, 5, 'NECTAR', false) === 0, 'NECTAR into {P2,N5}: -> {2,6} exceeds (max P1) refused');
      // slot[0] 불변식: 빈 원통 NECTAR 투입 → [null, N], 하단 추출 후 NECTAR 노출 → [null, N, ...]
      {
        const en = eng({ r2Loadout: ['NECTAR'], r2Spawn: pose(9, 107.9), flowerPiecesCount: [0, 4, 4, 4], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } });
        while (en.currentTick < 3000) en.step();
        stepDrop(en, 40);
        const f = en.field.flowers[0];
        assert(f.pieces.length === 2 && f.pieces[0] === null && f.pieces[1]?.type === 'NECTAR', 'NECTAR into empty FLOWER -> [null, NECTAR] (slot[0] never NECTAR)');
      }
      // NECTAR 잼 상태: 빈 slot[0]을 POLLEN 1개로 계산 (A안)
      const jamDrop = (jammed: boolean, pollenAbove: number) => {
        const e = eng({ r2Spawn: pose(9, 107.9), flowerPiecesCount: [0, 4, 4, 4], hiveInitialPieces: { pollenCount: 0, nectarCount: 1 } });
        const f = e.field.flowers[0];
        const nectar = e.pieces.find(q => q.type === 'NECTAR' && q.state === 'ON_FIELD')!;   // 바닥 산포된 필드 NECTAR 1개
        nectar.state = 'IN_FLOWER';
        const pollen = () => { const p = e.pieces.find(q => q.type === 'POLLEN' && (q.state === 'ON_FIELD' || q.state === 'IN_GARDEN'))!; p.state = 'IN_FLOWER'; return p; };
        f.pieces = jammed ? [null, nectar] : [pollen(), nectar];
        for (let i = 0; i < pollenAbove; i++) f.pieces.push(pollen());
        const before = f.pieces.length;
        stepDrop(e, 35);
        return { added: f.pieces.length - before, e };
      };
      // 잼 [null, N, P×6] = {P6(+가상1)=7, N1} → +1 → 8 ≤ 8 수락 / [null, N, P×7] → 9 > 8 거부
      assert(jamDrop(true, 6).added === 1 && jamDrop(true, 7).added === 0, 'jammed [null, N, P×k]: empty slot[0] counted as POLLEN (k=6 accepted, k=7 refused)');
      // 비잼 [P, N, P×6] = {P7, N1} → +1 → 8 수락 / [P, N, P×7] → 9 거부 → 잼과 같은 한도 (기하 동일)
      assert(jamDrop(false, 6).added === 1 && jamDrop(false, 7).added === 0, 'non-jammed [P, N, P×k]: same limits as jammed (equivalent geometry)');
      // 가상 POLLEN은 득점에 포함되지 않음: [null, N, P×7] (8 슬롯, 실제 기물 8개) → slot[1..] 8개 × 2 + 5 = 21
      {
        const { e } = jamDrop(true, 7);
        while (e.currentTick < 6000) e.step();
        const f = e.field.flowers[0];
        const volume = f.pieces.slice(1).filter(p => p !== null).length;
        assert(f.pieces[0] === null && volume === 8 && f.owner === e.field.allianceColor, `jammed FLOWER scored by real pieces only (slot[1..] = ${volume})`);
      }
    }
  }, TEST_TIMEOUT_MS);

  it('P. 코드 리뷰 반영 (읽기 전용 기록 / 로봇 id / 로딩 존 대칭 / 산포 제외 구역)', () => {
    {
      // 로봇 id는 슬롯으로 강제: 두 설정 id가 같아도 판정 함수에는 슬롯 id 전달
      {
        const shots: string[] = [];
        const same1 = cfg('robot1'), same2 = cfg('robot1');   // 둘 다 'robot1'
        const e = new SimulationEngine(same1, same2, (id) => { shots.push(id); return id === 'robot1' ? 1 : 0; }, 'RED', { allianceColor: 'RED', r2Spawn: pose(100, 20) });
        assert(e.r1Config.id === 'robot1' && e.r2Config.id === 'robot2', 'config ids forced by slot (r1 = robot1, r2 = robot2)');
        for (let i = 0; i < 15; i++) e.step(SHOOT, SHOOT);
        assert(shots.join() === 'robot1,robot2', `resolver receives slot ids (${shots.join()})`);
      }
      // 로딩 존 휴먼 NECTAR 슬롯: RED/BLUE 점대칭
      {
        const pos = (alliance: 'RED' | 'BLUE') => {
          const e = eng({ allianceColor: alliance, autoTipCount: 5, r1Spawn: pose(72, 20), r2Spawn: pose(72, 124) });
          return e.pieces.filter(p => p.type === 'NECTAR' && p.state === 'ON_FIELD').map(p => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        };
        const red = pos('RED'), blue = pos('BLUE').map(([x, y]) => [144 - x, 144 - y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        assert(red.length === 5 && blue.length === 5 && red.every(([x, y], i) => Math.abs(x - blue[i][0]) < 1e-9 && Math.abs(y - blue[i][1]) < 1e-9), 'human NECTAR slots point-symmetric between RED and BLUE');
        const blueRaw = pos('BLUE');
        assert(Math.abs(Math.max(...blueRaw.map(([x]) => x)) - (144 - 1.8)) < 1e-9, 'BLUE first column flush to wall (x = 142.2)');
      }
      // 산포: GARDEN / 로딩 존(양 진영)과 겹치지 않음 (시드 40개 × POLLEN 24 + NECTAR 3)
      {
        let checked = 0, bad = 0;
        for (let seed = 0; seed < 40; seed++) {
          const e = eng({ rngSeed: seed, flowerPiecesCount: [0, 0, 0, 0], gardenPiecesCount: { ally: 0, opponent: 0 }, hiveInitialPieces: { pollenCount: 0, nectarCount: 0 } });
          for (const p of e.pieces.filter(q => q.state === 'ON_FIELD')) {
            checked++;
            const c = { center: { x: p.x, y: p.y }, radius: p.type === 'POLLEN' ? 1.4 : 1.8 };
            if ([GARDEN_AABB.RED, GARDEN_AABB.BLUE, LOADING_ZONE_AABB.RED, LOADING_ZONE_AABB.BLUE].some(z => testCircleVsAABB(c, z).colliding)) bad++;
          }
        }
        assert(bad === 0 && checked === 40 * 27, `scattered pieces avoid GARDEN / loading zones (${checked} pieces, ${bad} violations)`);
      }
    }
  }, TEST_TIMEOUT_MS);

  it('Q. 탄도 준비 (HIVE 셀 투입구 기하 / 기물별 판정 함수 / 조준점 배치)', () => {
    const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) < tol;
    {
      // 투입구 기하: 지면과 60°, 오각형 면적 중심 표면 거리 5.560, 꼭짓점 z = HIVE 직육면체 높이 65.62
      assert(near(HIVE_OPENING_CENTROID_S, 5.5599) && near(HIVE_HEIGHT, 65.6244), `centroid ${HIVE_OPENING_CENTROID_S}, hive height ${HIVE_HEIGHT}`);
      const ro = hiveCellAimPoint('RED', 'OPPOSITE_CELL');
      assert(near(ro.x, 59.25) && near(ro.y, 55.520) && near(ro.z, 58.315), `RED_OPPOSITE aim (${ro.x}, ${ro.y}, ${ro.z})`);
      // 4셀 대칭: RED_AUDIENCE = (x, 144 - y), BLUE_OPPOSITE = (144 - x, y), BLUE_AUDIENCE = (144 - x, 144 - y)
      const ra = hiveCellAimPoint('RED', 'AUDIENCE_CELL'), bo = hiveCellAimPoint('BLUE', 'OPPOSITE_CELL'), ba = hiveCellAimPoint('BLUE', 'AUDIENCE_CELL');
      assert(near(ra.x, ro.x, 1e-9) && near(ra.y, 144 - ro.y, 1e-9) && near(bo.x, 144 - ro.x, 1e-9) && near(bo.y, ro.y, 1e-9)
        && near(ba.x, 144 - ro.x, 1e-9) && near(ba.y, 144 - ro.y, 1e-9) && [ra, bo, ba].every(a => near(a.z, ro.z, 1e-9)), 'aim points symmetric across 4 cells');
      assert(HIVE_RIM_Y.OPPOSITE_CELL > HIVE_AABB.minY && HIVE_RIM_Y.AUDIENCE_CELL < HIVE_AABB.maxY, 'rims lie inside HIVE AABB');
      assert(near(GRAVITY, 386.09, 0.01), `gravity ${GRAVITY} in/s^2`);
      assert((['POLLEN', 'NECTAR'] as const).every(t => PIECE_PHYSICS[t].landingSpeedRetention > 0 && PIECE_PHYSICS[t].landingSpeedRetention <= 1), 'landing speed retention in (0, 1]');
    }
    {
      // 판정 함수는 발사 기물 종류를 받음 (FIFO 순서): 종류별 확률 (POLLEN 1, NECTAR 0)
      const types: string[] = [];
      const byType: ShotProbabilityResolver = (_id, type) => { types.push(type); return type === 'POLLEN' ? 1 : 0; };
      const e = eng({ r1Loadout: ['NECTAR', 'POLLEN'], hiveInitialPieces: { pollenCount: 0, nectarCount: 2 } }, C1, C2, byType);
      for (let i = 0; i < 40; i++) e.step(SHOOT);
      settle(e);
      assert(types.join() === 'NECTAR,POLLEN', `resolver receives piece types in FIFO order (${types.join()})`);
      assert(e.field.hive.nectarInUpwardCell === 2 && e.field.hive.pollenInUpwardCell === 1, 'NECTAR missed (p = 0), POLLEN hit (p = 1)');
      // HIVE 내부 기물은 상향 셀 조준점 바닥 정사영에 배치
      const aim = hiveCellAimPoint('RED', e.field.hive.upwardCell);
      const inHive = e.pieces.filter(p => p.state === 'IN_HIVE');
      assert(inHive.length === 3 && inHive.every(p => near(p.x, aim.x, 1e-9) && near(p.y, aim.y, 1e-9)), 'IN_HIVE pieces placed at aim point projection');
    }
  }, TEST_TIMEOUT_MS);

  it('R. LUT 명중 확률 판정 함수 주입 (탄도 LUT → 엔진)', () => {
    // 고각 슈터 (발사구 14 in, 발사각 70°), 스윗스팟 (60.5, 134.5). 샘플 수를 줄여 빠르게 생성
    const ballistics = { dz: 39.5, shooterPitch: (70 * Math.PI) / 180, sweetSpot: { x: 60.5, y: 134.5 }, shooterOffset: 6 };
    const robotLUTs = generateRobotLUTs(ballistics, { length: 18, width: 18 }, { samples: 20, searchSamples: 300 });
    assert(robotLUTs.issues.length === 0, 'LUT generated');
    const lut = createLUTShotResolver({ robot1: robotLUTs.luts, robot2: robotLUTs.luts }, C1, C2);
    // 비행 처리도 같은 슈터 탄도(발사구 / 발사각 / 탐색한 v0)를 사용
    const shooter = shooterBallisticsFrom(ballistics, robotLUTs);
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    // 사격 결과: 판정 함수가 반환한 확률 기록 + HIVE 적재 / 팁 (시작 HIVE {N3, P2}: POLLEN 1발 명중으로 팁)
    const shoot = (x: number, y: number, heading: number) => {
      const ps: number[] = [];
      const e = new SimulationEngine(C1, C2, (...args) => { const p = lut(...args); ps.push(p); return p; }, 'RED',
        { allianceColor: 'RED', r1Spawn: pose(x, y, heading), r2Spawn: pose(20, 20), hiveInitialPieces: { nectarCount: 3, pollenCount: 2 } },
        { robot1: shooter, robot2: shooter });
      for (let i = 0; i < 80; i++) e.step(SHOOT);
      settle(e);
      // 득점 없음 = 팁 0회 + 상향 셀 POLLEN이 시작값 2 그대로
      return { e, ps, tips: e.field.hive.tipCount, scoredNothing: e.field.hive.tipCount === 0 && e.field.hive.pollenInUpwardCell === 2, upward: e.field.hive.upwardCell };
    };
    const onTarget = bearingTo(60.5, 134.5, aim.x, aim.y);
    const sweet = shoot(60.5, 134.5, onTarget);
    // 1발째(15틱) 명중 도착 → 팁 → 상향 셀 OPPOSITE. 팁 전에 발사한 발(15k < 팁 틱)은 고확률이지만 전복 중 도착 → 반사 방출,
    // 팁 후에 발사한 발은 판정 함수가 새 상향 셀(이 위치에서 조준 불가)로 확률 0
    const tipTick = arrivalOf(sweet.e, 15);
    const launches = [15, 30, 45, 60];
    assert(tipTick > 15 && tipTick < 60 && sweet.ps.length === 4, `first shot arrives before the 4th launch (tip tick ${tipTick})`);
    assert(sweet.ps.every((p, k) => (launches[k] < tipTick ? p > 0.8 : p === 0)) && sweet.ps[0] > 0.8 && sweet.ps[3] === 0,
      `P high before the tip, 0 after (upward cell switched) (${sweet.ps.map(p => p.toFixed(2))})`);
    assert(sweet.tips === 1 && sweet.upward === 'OPPOSITE_CELL' && sweet.e.field.hive.pollenInUpwardCell === 0, 'one tip; shots arriving during the tip are rejected');
    // 조준 이탈 (허용 오차 0.05 rad 초과) → 확률 0, 득점 없음
    const offAim = shoot(60.5, 134.5, onTarget + 0.1);
    assert(offAim.ps.length >= 3 && offAim.ps.every(p => p === 0) && offAim.scoredNothing, 'FIXED shooter off aim -> P 0, no score');
    // 명중 띠 밖 (HIVE 반대편 구석) → 확률 0
    const far = shoot(20.5, 20.5, bearingTo(20.5, 20.5, aim.x, aim.y));
    assert(far.ps.length >= 3 && far.ps.every(p => p === 0) && far.scoredNothing, 'outside the hit band -> P 0');
  }, TEST_TIMEOUT_MS);

  it('S. 발사 비행 처리 (발사 / 도착 분리, IN_FLIGHT, 비행 대기열)', () => {
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) < tol;
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const front = pose(60.5, 130.5, bearingTo(60.5, 130.5, aim.x, aim.y));
    // 명중 (P = 1): 발사 틱에 IN_FLIGHT + 대기열 등록, 도착 틱에 HIVE 적재
    {
      const e = eng({ r1Spawn: front, r1Loadout: ['POLLEN'] });
      for (let i = 0; i < 15; i++) e.step(SHOOT);
      const shot = e.field.pendingShots[0];
      const piece = e.pieces.find(p => p.id === shot?.pieceId)!;
      assert(shot !== undefined && shot.result === 'HIT' && shot.launchTick === 15 && shot.targetCell === 'AUDIENCE_CELL', 'hit shot queued at launch');
      assert(piece.state === 'IN_FLIGHT' && near(piece.x, shot.fromX, 1e-9) && near(piece.y, shot.fromY, 1e-9) && piece.vx === 0, 'piece IN_FLIGHT at the launch point');
      assert(near(shot.toX, aim.x, 1e-9) && near(shot.toY, aim.y, 1e-9) && near(shot.toZ, aim.z, 1e-9), 'hit arrives at the aim point');
      const T = Math.hypot(aim.x - shot.fromX, aim.y - shot.fromY) / (shot.v0 * Math.cos(shot.pitch));
      assert(shot.arriveTick === 15 + Math.max(1, Math.round(T / DT)), `arrive tick = launch + round(T / dt) (T ${T.toFixed(3)} s)`);
      settle(e);
      const before = e.getFrame(shot.arriveTick - 1)!, at = e.getFrame(shot.arriveTick)!;
      assert(before.pieces.find(p => p.id === shot.pieceId)!.state === 'IN_FLIGHT' && before.field.hive.pollenInUpwardCell === 0, 'still in flight one tick before arrival');
      assert(at.pieces.find(p => p.id === shot.pieceId)!.state === 'IN_HIVE' && at.field.hive.pollenInUpwardCell === 1 && at.field.pendingShots.length === 0, 'scored on the arrival tick');
      // 기록 보호: 발사 틱 프레임의 대기열은 이후 변경과 분리 (스냅샷 복제)
      assert(e.getFrame(14)!.field.pendingShots.length === 0 && e.getFrame(15)!.field.pendingShots.length === 1 && e.getFrame(15)!.pieces.find(p => p.id === shot.pieceId)!.state === 'IN_FLIGHT',
        'past frames keep their own flight queue snapshot (before launch empty, launch tick 1)');
      {
        // 기록 보호: 프레임의 대기열 / 항목은 엔진 작업본과 별개 객체
        const live = eng({ r1Spawn: front, r1Loadout: ['POLLEN'] });
        for (let i = 0; i < 15; i++) live.step(SHOOT);
        const frameShots = live.getFrame(15)!.field.pendingShots;
        assert(frameShots !== live.field.pendingShots && frameShots[0] !== live.field.pendingShots[0] && frameShots[0].segments !== live.field.pendingShots[0].segments,
          'recorded flight queue (and its segments) is a copy of the live queue');
      }
    }
    // 빗맞음 + HIVE 충돌 (P = 0, 정면): 첫 접촉점에서 바깥으로 반사, 바닥에 닿을 때까지 비행 유지 (08-2)
    {
      const e = eng({ r1Spawn: front, r1Loadout: ['POLLEN'] }, C1, C2, fixedP(0));
      for (let i = 0; i < 15; i++) e.step(SHOOT);
      const shot = e.field.pendingShots[0];
      assert(shot.result === 'MISS_HIVE' && near(shot.toY, HIVE_AABB.maxY + PIECE_PHYSICS.POLLEN.radius, 1e-6), `miss hits the HIVE front face (y ${shot.toY.toFixed(3)})`);
      const contactTick = 15 + Math.round(shot.contactTime / DT);
      const landTime = shot.segments[shot.segments.length - 1].t1;
      assert(shot.segments.length > 0 && shot.segments[0].vy > 0 && shot.arriveTick === 15 + Math.round(landTime / DT) && shot.arriveTick > contactTick + 5,
        `falls after the contact (contact tick ${contactTick}, landing tick ${shot.arriveTick})`);
      settle(e);
      assert(e.getFrame(shot.arriveTick - 1)!.pieces.find(p => p.id === shot.pieceId)!.state === 'IN_FLIGHT', 'still in flight (falling) one tick before landing');
      const piece = e.getFrame(shot.arriveTick)!.pieces.find(p => p.id === shot.pieceId)!;
      assert(piece.state === 'ON_FIELD' && near(piece.x, shot.landX, 1e-9) && near(piece.y, shot.landY, 1e-9) && piece.y > HIVE_AABB.maxY && piece.vy > 0, 'lands in front of the HIVE face, moving outward');
    }
    // 무효 명중: 명중으로 발사됐지만 도착 시점에 HIVE 전복 중 → 조준점에서 셀 앞면 바깥으로 반사 낙하 (08-2)
    {
      // 상향 셀 {NECTAR 3, POLLEN 2}: 첫 발 명중 도착으로 팁, 둘째 발(팁 전 발사)은 전복 중 도착
      const e = eng({ r1Spawn: front, r1Loadout: ['POLLEN', 'POLLEN'], hiveInitialPieces: { nectarCount: 3, pollenCount: 2 } }, C1, C2, fixedP(1));
      for (let i = 0; i < 30; i++) e.step(SHOOT);
      const launched = e.field.pendingShots.find(sh => sh.launchTick === 30)!;
      const hitArrive = launched.arriveTick;
      assert(launched.result === 'HIT', 'second shot launched as a hit (before the tip)');
      while (e.currentTick < hitArrive) e.step();
      const voided = e.field.pendingShots.find(sh => sh.launchTick === 30)!;
      assert(e.field.hive.tipCount === 1 && e.field.hive.isTipping, 'first shot tipped the HIVE, still tipping at the second arrival');
      assert(voided.result === 'MISS_HIVE' && voided.segments.length > 0 && voided.arriveTick > hitArrive && voided.segments[0].t0 === voided.contactTime,
        `voided hit falls from the aim point (aim tick ${hitArrive} -> landing tick ${voided.arriveTick})`);
      assert(e.pieces.find(p => p.id === voided.pieceId)!.state === 'IN_FLIGHT' && e.getFrame(hitArrive)!.field.pendingShots.some(sh => sh.launchTick === 30 && sh.result === 'MISS_HIVE'),
        'piece stays IN_FLIGHT; the aim-tick frame records the voided flight');
      settle(e);
      const piece = e.getFrame(voided.arriveTick)!.pieces.find(p => p.id === voided.pieceId)!;
      assert(piece.state === 'ON_FIELD' && near(piece.y, voided.landY, 1e-9) && piece.y > HIVE_AABB.maxY + PIECE_PHYSICS.POLLEN.radius && e.field.hive.pollenInUpwardCell === 0,
        'lands in front of the AUDIENCE cell, not scored');
    }
    // 빗맞음 + 바닥 착지 (HIVE 반대쪽을 향한 고정형): 사거리 지점에 착지, 수평 속도 × landingSpeedRetention
    {
      const e = eng({ r1Spawn: pose(72, 110, 0), r1Loadout: ['POLLEN'] }, C1, C2, fixedP(0));
      for (let i = 0; i < 15; i++) e.step(SHOOT);
      const shot = e.field.pendingShots[0];
      const plan = planShotFlight({ robotX: e.r1.x, robotY: e.r1.y, robotHeading: e.r1.heading, shooter: C1, ballistics: DEFAULT_SHOOTER_BALLISTICS, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL', hit: false });
      assert(shot.result === 'MISS_FLOOR' && plan.result === 'MISS_FLOOR' && near(shot.toX, plan.to.x, 1e-9) && near(shot.landingVx, plan.landingVx, 1e-9), 'engine uses planShotFlight');
      settle(e);
      const piece = e.getFrame(shot.arriveTick)!.pieces.find(p => p.id === shot.pieceId)!;
      // 착지 틱에 물리가 한 번 더 돌기 전 상태로 배치되므로 도착 프레임의 속도는 착지 속도
      assert(piece.state === 'ON_FIELD' && near(piece.x, shot.toX, 1e-9) && shot.landX === shot.toX && shot.segments.length === 0 && near(piece.vx, shot.landingVx, 1e-9) && shot.landingVx > 0,
        'lands on the floor with retained horizontal speed');
    }
    // 난수는 발사마다 3회: 첫 발의 명중 여부와 무관하게 둘째 발의 반사 난수가 같음
    {
      const second = (p1: number) => {
        let n = 0;
        const e = eng({ r1Spawn: front, r1Loadout: ['POLLEN', 'POLLEN'] }, C1, C2, () => (n++ === 0 ? p1 : 0));
        for (let i = 0; i < 30; i++) e.step(SHOOT);
        return e.field.pendingShots.find(s => s.launchTick === 30)!;
      };
      const a = second(1), b = second(0);
      assert(a.bounceRestitutionRoll === b.bounceRestitutionRoll && a.bounceAngleRoll === b.bounceAngleRoll, 'RNG consumption per shot is outcome independent');
    }
    // 스크러빙: 비행 중 틱으로 되감아 같은 입력으로 재시뮬레이션하면 동일
    {
      const e = eng({ r1Spawn: front });
      for (let i = 0; i < 70; i++) e.step(SHOOT);
      settle(e);
      const original = JSON.stringify(e.timeline);
      const mid = e.timeline.findIndex(f => f.field.pendingShots.length > 0) + 3;
      e.scrubTo(mid);
      while (e.currentTick < 70) e.step(SHOOT);
      settle(e);
      assert(JSON.stringify(e.timeline) === original, `re-simulation from a mid-flight tick (${mid}) is identical`);
    }
    // 경기 종료 시 비행 중인 공은 득점에 반영되지 않음 (도착이 6000틱 이후)
    {
      const e = eng({ r1Spawn: front, r1Loadout: ['POLLEN'], hiveInitialPieces: { nectarCount: 3, pollenCount: 2 } });
      while (e.currentTick < 5985) e.step();
      while (e.currentTick < 6000) e.step(SHOOT);
      const last = e.getFrame(6000)!;
      assert(last.field.pendingShots.length === 1 && last.field.pendingShots[0].arriveTick > 6000 && last.field.hive.tipCount === 0, 'flight still pending at the final tick -> not scored');
    }
  }, TEST_TIMEOUT_MS);

  it('T. FLOWER 리프트 FSM (올림 / 대기 / 투입 / 내림)', () => {
    // 기준: flowerSetupDelay 500 ms = 25틱, flowerDropDelay 200 ms = 10틱, R2는 FLOWER1 옆(도달 거리 안)에 정지
    const near = () => eng({ r2Spawn: pose(9, 107.9) });
    const states = (e: SimulationEngine) => e.timeline.map(fr => fr.r2.actionState);
    const firstTick = (e: SimulationEngine, s: string, from = 0) => states(e).indexOf(s as never, from);
    const flowerCount = (e: SimulationEngine, tick: number) => e.getFrame(tick)!.field.flowers[0].pieces.length;
    const lowerDuration = (e: SimulationEngine, from: number) => {   // 내림 시작 틱 ~ IDLE 복귀 틱 (타이머 차감 횟수)
      const start = firstTick(e, 'FLOWER_LOWERING', from);
      return firstTick(e, 'IDLE', start) - start + 1;
    };
    const raiseToReady = (e: SimulationEngine) => { while (e.r2.actionState !== 'FLOWER_READY' && e.currentTick < 60) e.step(undefined, LIFT); };

    // IDLE에서 투입 요청은 무효 (리프트가 올라가 있지 않음)
    {
      const e = near();
      for (let i = 0; i < 40; i++) e.step(undefined, DROP);
      assert(states(e).every(s => s === 'IDLE') && e.field.flowers[0].pieces.length === 4 && e.r2.controlledPieces.length === 4, 'IDLE + FLOWER_DROPPING request -> ignored (no lift, no drop)');
    }
    // 올림 요청 유지: 25틱 올린 뒤 대기, 투입 없이 계속 대기
    {
      const e = near();
      for (let i = 0; i < 60; i++) e.step(undefined, LIFT);
      assert(firstTick(e, 'FLOWER_SETUP') === 1 && firstTick(e, 'FLOWER_READY') === 25, `raise takes flowerSetupDelay (READY at tick 25, got ${firstTick(e, 'FLOWER_READY')})`);
      assert(states(e).slice(25).every(s => s === 'FLOWER_READY') && e.field.flowers[0].pieces.length === 4 && e.r2.controlledPieces.length === 4, 'holding lift -> waits in READY, never drops by itself');
    }
    // 대기 중 투입 탭 1틱: 투입은 커밋되어 정확히 1개, 이후 대기 복귀
    {
      const e = near();
      raiseToReady(e);
      const t0 = e.currentTick;
      e.step(undefined, DROP);
      for (let i = 0; i < 20; i++) e.step(undefined, LIFT);
      assert(e.field.flowers[0].pieces.length === 5 && e.r2.controlledPieces.length === 3 && e.r2.actionState === 'FLOWER_READY', 'READY + 1-tick drop tap -> exactly one drop, back to READY');
      assert(flowerCount(e, t0 + 9) === 4 && flowerCount(e, t0 + 10) === 5, 'drop completes after flowerDropDelay (10 ticks)');
    }
    // 대기 중 내림: flowerSetupDelay(25틱) 동안 내린 뒤 IDLE
    {
      const e = near();
      raiseToReady(e);
      const t0 = e.currentTick;
      for (let i = 0; i < 40; i++) e.step(undefined, inp('IDLE'));
      assert(lowerDuration(e, t0) === 25 && e.r2.actionState === 'IDLE', `lower from READY takes flowerSetupDelay (25 ticks, got ${lowerDuration(e, t0)})`);
    }
    // 올리는 중 내림: 올린 시간(10틱)만큼만 내림
    {
      const e = near();
      for (let i = 0; i < 10; i++) e.step(undefined, LIFT);
      for (let i = 0; i < 30; i++) e.step(undefined, inp('IDLE'));
      assert(firstTick(e, 'FLOWER_LOWERING') === 11 && lowerDuration(e, 0) === 10, `cancel while raising -> lower for the raised time (10 ticks, got ${lowerDuration(e, 0)})`);
      assert(firstTick(e, 'FLOWER_READY') < 0 && e.r2.controlledPieces.length === 4, 'cancelled lift never reaches READY, nothing dropped');
    }
    // 제동 중(아직 올리지 않음) 내림: 즉시 IDLE
    {
      const e = near();
      for (let i = 0; i < 3; i++) e.step(undefined, inp('IDLE', 0, -30));   // 천천히 FLOWER 쪽으로 이동 (도달 거리 유지)
      e.step(undefined, LIFT);
      const f4 = e.getFrame(4)!.r2;
      assert(f4.actionState === 'FLOWER_SETUP' && f4.isBraking, 'lift accepted while moving -> braking, timer not started');
      e.step(undefined, inp('IDLE'));
      assert(e.r2.actionState === 'IDLE' && firstTick(e, 'FLOWER_LOWERING') < 0, 'cancel before any raise -> IDLE immediately (no lowering)');
    }
    // 투입 중 내림 요청은 무시: 투입 완료 → 대기 복귀 후에 내림
    {
      const e = near();
      raiseToReady(e);
      const t0 = e.currentTick;
      e.step(undefined, DROP);
      for (let i = 0; i < 40; i++) e.step(undefined, inp('IDLE'));
      const dropTick = t0 + 10;
      assert(flowerCount(e, dropTick) === 5 && e.getFrame(dropTick)!.r2.actionState === 'FLOWER_READY', 'lower request during DROPPING ignored: drop completes, back to READY');
      assert(firstTick(e, 'FLOWER_LOWERING', t0) === dropTick + 1 && lowerDuration(e, t0) === 25 && e.r2.actionState === 'IDLE', 'then lowers from READY (25 ticks) to IDLE');
    }
    // 내림 중 올림 요청은 무시, IDLE 복귀 후 다시 올림 가능
    {
      const e = near();
      raiseToReady(e);
      const t0 = e.currentTick;
      e.step(undefined, inp('IDLE'));
      for (let i = 0; i < 30; i++) e.step(undefined, LIFT);
      const idleTick = firstTick(e, 'IDLE', t0);
      assert(lowerDuration(e, t0) === 25 && states(e).slice(t0 + 1, idleTick).every(s => s === 'FLOWER_LOWERING'), 'lift request during LOWERING ignored (lowering completes)');
      assert(e.getFrame(idleTick + 1)!.r2.actionState === 'FLOWER_SETUP', 'after IDLE, lift request accepted again');
    }
    // 리프트 상태에서 슈팅 / 흡입 불가: 슈팅 요청은 내림 요청으로 해석, 내린 뒤 IDLE에서 발사
    {
      const e = near();
      raiseToReady(e);
      const t0 = e.currentTick;
      for (let i = 0; i < 40; i++) e.step(undefined, SHOOT);
      const idleTick = firstTick(e, 'IDLE', t0);
      assert(firstTick(e, 'FLOWER_LOWERING', t0) === t0 + 1 && idleTick > t0 && firstTick(e, 'SHOOTING', t0) === idleTick + 1, 'SHOOT in READY -> lower first, shooting only after IDLE');
      assert(e.timeline.slice(0, idleTick + 1).every(fr => fr.field.pendingShots.length === 0), 'no shot fired while lift is up');
      const g = near();
      raiseToReady(g);
      for (let i = 0; i < 5; i++) g.step(undefined, INTAKE);
      assert(g.r2.actionState === 'FLOWER_LOWERING', 'INTAKE in READY -> lowering (no intake while lifted)');
    }
    // 리프트 상태는 Stationary Lock: 주행 입력이 있어도 정지 유지
    {
      const e = near();
      for (let i = 0; i < 40; i++) e.step(undefined, inp('FLOWER_SETUP', 40, 0, 2));
      assert(e.r2.actionState === 'FLOWER_READY' && e.r2.x === 9 && e.r2.y === 107.9 && e.r2.heading === 0, 'drive input ignored while raising / waiting');
    }
  }, TEST_TIMEOUT_MS);

  it('U. 경기 종료 득점 내역 (scoreBreakdown, 08-3)', () => {
    // 기본 경기 (입력 없음): RED는 R1이 로딩 존 스폰(주차), BLUE는 R2가 로딩 존 스폰 / 아군 GARDEN 4개, 팁 / FLOWER 없음
    for (const alliance of ['RED', 'BLUE'] as const) {
      const e = eng({ allianceColor: alliance });
      e.runFullMatch();
      const last = e.getFrame(6000)!;
      const b = last.scoreBreakdown!;
      const allyGarden = e.pieces.filter(p => p.state === 'IN_GARDEN' && testCircleVsAABB({ center: { x: p.x, y: p.y }, radius: PIECE_PHYSICS[p.type].radius }, GARDEN_AABB[alliance]).colliding).map(p => p.id);
      assert(e.timeline.slice(0, 6000).every(f => f.scoreBreakdown === null), `${alliance}: no breakdown before the final tick`);
      assert(b !== null && b.hive === 0 && b.flower === 0 && b.garden === 4 && b.park === 5 && last.totalScore === 9, `${alliance}: garden 4 + park 5 = 9`);
      assert(b.parkedRobots.join() === (alliance === 'RED' ? 'robot1' : 'robot2') && b.gardenPieceIds.slice().sort().join() === allyGarden.sort().join(), `${alliance}: parked robot / counted garden pieces identified`);
      assert(b.flowers.map(f => f.id).join() === e.field.flowers.map(f => f.id).join() && b.flowers.every(f => !f.owned && f.points === 0 && f.scoringPieces === 3), `${alliance}: 4 FLOWERs (POLLEN only, slot[1..] 3) not owned`);
    }
    // 전 항목: 팁 1회(20) + FLOWER 1개 소유(slot[1..] 2개 × 2 + 5 = 9) + GARDEN 4 + 주차 1대(5) = 38
    const build = () => {
      const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
      const e = eng({
        r1Spawn: pose(60.5, 130.5, bearingTo(60.5, 130.5, aim.x, aim.y)), r2Spawn: pose(9, 36), r1Loadout: ['POLLEN'],
        hiveInitialPieces: { nectarCount: 2, pollenCount: 4 }, flowerPiecesCount: [0, 4, 4, 4],
      });
      // FLOWER 1 = [POLLEN, NECTAR, POLLEN] (바닥 산포 기물을 옮겨 담음 — slot[0] 제외 2개, 아군 NECTAR 포함)
      const take = (type: 'POLLEN' | 'NECTAR') => { const p = e.pieces.find(q => q.type === type && q.state === 'ON_FIELD')!; p.state = 'IN_FLOWER'; return p; };
      e.field.flowers[0].pieces = [take('POLLEN'), take('NECTAR'), take('POLLEN')];
      // runFullMatch()는 reset()으로 위 배치를 지우므로 직접 진행: R1 1발 발사 후 입력 없음
      while (e.currentTick < 6000) e.step(e.currentTick < 15 ? SHOOT : undefined);
      return e;
    };
    const e = build();
    const last = e.getFrame(6000)!;
    const b = last.scoreBreakdown!;
    assert(b.hive === 20 && last.field.hive.tipCount === 1, `one tip -> hive 20 (${b.hive})`);
    assert(b.flowers[0].owned && b.flowers[0].scoringPieces === 2 && b.flowers[0].points === 9 && b.flower === 9 && b.flowers.slice(1).every(f => !f.owned && f.points === 0),
      `FLOWER 1 owned: 2 × 2 + 5 = 9, others 0 (${b.flowers.map(f => f.points)})`);
    assert(b.garden === 4 && b.park === 5 && b.parkedRobots.join() === 'robot2', `garden ${b.garden}, park ${b.park} (${b.parkedRobots})`);
    assert(b.hive + b.flower + b.garden + b.park === last.totalScore && last.totalScore === 38, `items sum to totalScore (${last.totalScore})`);
    assert(last.field.flowers[0].owner === 'RED' && last.field.flowers[1].owner === 'NONE', 'FLOWER owner set only for the scored FLOWER');
    // 스크러빙: 종료 전으로 되감으면 내역 없음, 같은 입력으로 재시뮬레이션하면 종료 프레임 동일, 종료 프레임으로 되감으면 복원
    {
      const original = JSON.stringify(last);
      e.scrubTo(5990);
      assert(e.getFrame(5990)!.scoreBreakdown === null, 'scrubbed before the end -> no breakdown');
      while (e.currentTick < 6000) e.step();
      assert(JSON.stringify(e.getFrame(6000)) === original, 're-simulated final frame (breakdown included) identical');
      e.scrubTo(6000);
      assert(JSON.stringify(e.getFrame(6000)) === original, 'scrubbing to the final frame keeps its breakdown');
    }
    // 결정론: 같은 설정 / 입력의 다른 경기도 같은 내역
    assert(JSON.stringify(build().getFrame(6000)!.scoreBreakdown) === JSON.stringify(b), 'deterministic breakdown');
  }, TEST_TIMEOUT_MS);
});

