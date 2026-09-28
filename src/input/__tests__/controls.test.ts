import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../../core/simulationEngine';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, RobotPose, RobotState, ScenarioConfig } from '../../core/types';
import {
  ACTION_CODES,
  ControlLatch,
  NEUTRAL_SAMPLE,
  NEUTRAL_TICK,
  applyAxialDeadzone,
  applyRadialDeadzone,
  assignedDevices,
  buildDriveCommand,
  decodeActionRequest,
  decodeDriveInput,
  driverToField,
  encodeDriveCommand,
  mergeTickControls,
  quantizeUnit,
  readGamepad,
  readKeyboard,
  resolveActionRequest,
} from '../controls';
import type { ControlSample, DriverSettings, GamepadSnapshot, TickControls } from '../controls';
import {
  DEADZONE_LEFT,
  DEVICE_ASSIGNMENT,
  GAMEPAD_AXES,
  GAMEPAD_BUTTONS,
  KEYBOARD_BINDINGS,
  QUANT_MAX,
  TRIGGER_THRESHOLD,
} from '../inputConfig';

const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// 표준 배열 게임패드 스냅샷: axes 4개, buttons 17개 (buttons 인자: 인덱스 → {pressed, value})
const pad = (axes: number[] = [0, 0, 0, 0], buttons: Record<number, { pressed: boolean; value: number }> = {}): GamepadSnapshot => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? { pressed: false, value: 0 }),
});
const press = { pressed: true, value: 1 };
const sample = (over: Partial<ControlSample> = {}): ControlSample => ({ ...NEUTRAL_SAMPLE, ...over });
const tick = (over: Partial<TickControls> = {}): TickControls => ({ ...NEUTRAL_TICK, ...over });
const RED: DriverSettings = { alliance: 'RED', mode: 'FIELD' };
const BLUE: DriverSettings = { alliance: 'BLUE', mode: 'FIELD' };

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});
const C1 = cfg('robot1'), C2 = cfg('robot2');
const pose = (x: number, y: number, heading = 0): RobotPose => ({ x, y, heading });
const eng = (sc: Partial<ScenarioConfig> = {}) =>
  new SimulationEngine(C1, C2, () => 1, sc.allianceColor ?? 'RED', { allianceColor: 'RED', ...sc });

// 입력 계층 1틱: 직전 로봇 상태로 명령 결정 → 부호화 → 복호화 → 엔진 (R2 조작, R1 정지)
const driveR2 = (e: SimulationEngine, c: TickControls, settings: DriverSettings = RED) => {
  const cmd = buildDriveCommand(c, e.r2, settings);
  e.step(undefined, decodeDriveInput(encodeDriveCommand(cmd), 0, C2));
  return cmd;
};
const holdR2 = (e: SimulationEngine, n: number, c: TickControls = NEUTRAL_TICK) => {
  for (let i = 0; i < n; i++) driveR2(e, c);
};

describe('입력 계층 순수 변환 (명세서 3.6)', () => {
  it('A. 설정 기본값 (키 매핑 / 장치 배정)', () => {
    assert(GAMEPAD_AXES.forward.index === 1 && GAMEPAD_AXES.forward.invert && GAMEPAD_AXES.right.index === 0 && GAMEPAD_AXES.turn.index === 2,
      'axes: left Y (inverted) forward, left X right, right X turn');
    assert(GAMEPAD_BUTTONS.intake.index === 6 && GAMEPAD_BUTTONS.shoot.index === 7 && GAMEPAD_BUTTONS.lift.index === 0 && GAMEPAD_BUTTONS.drop.index === 1,
      'buttons: LT 6 intake, RT 7 shoot, A 0 lift, B 1 drop (standard mapping, 0-based)');
    assert(GAMEPAD_BUTTONS.intake.analog && GAMEPAD_BUTTONS.shoot.analog && !GAMEPAD_BUTTONS.lift.analog && !GAMEPAD_BUTTONS.drop.analog, 'triggers analog, A / B digital');
    assert(KEYBOARD_BINDINGS.intake === 'KeyM' && KEYBOARD_BINDINGS.shoot === 'Comma' && KEYBOARD_BINDINGS.lift === 'Period' && KEYBOARD_BINDINGS.drop === 'Slash',
      'keyboard actions m , . /');
    const r1 = assignedDevices('robot1'), r2 = assignedDevices('robot2');
    assert(r1.gamepadSlots.join() === '0' && !r1.keyboard && r2.gamepadSlots.join() === '1' && r2.keyboard, 'pad0 -> R1, pad1 + keyboard -> R2');
    assert(!assignedDevices('robot2', DEVICE_ASSIGNMENT, false).keyboard, 'keyboard disabled -> not assigned');
  });

  it('B. 게임패드 읽기 (축 방향 / 데드존 / 트리거 임계값)', () => {
    const up = readGamepad(pad([0, -1, 0, 0]));
    assert(near(up.forward, 1) && near(up.right, 0), 'left stick up (axes[1] = -1) -> forward +1');
    const rt = readGamepad(pad([1, 0, 0.5, -1]));
    assert(near(rt.right, 1) && near(rt.forward, 0), 'left stick right -> right +1');
    assert(near(rt.turn, (0.5 - DEADZONE_LEFT) / (1 - DEADZONE_LEFT)), 'right stick X -> turn (rescaled), right stick Y unused');
    // 좌스틱 원형 데드존
    assert(readGamepad(pad([0.05, 0.05, 0, 0])).forward === 0 && readGamepad(pad([0.05, 0.05, 0, 0])).right === 0, 'inside radial deadzone (|v| = 0.071 < 0.08) -> 0');
    const dz = applyRadialDeadzone(0.3, 0.4);
    assert(near(Math.hypot(dz.x, dz.y), (0.5 - 0.08) / 0.92) && near(dz.x / dz.y, 0.75), 'radial deadzone rescales magnitude, keeps direction');
    const corner = applyRadialDeadzone(1, 1);
    assert(near(Math.hypot(corner.x, corner.y), 1), 'square-gate corner clamped to magnitude 1');
    assert(applyAxialDeadzone(0.07) === 0 && near(applyAxialDeadzone(-1), -1) && applyAxialDeadzone(NaN) === 0, 'axial deadzone / full scale / non-finite');
    // 트리거는 value 임계값, A / B는 pressed
    const trig = (v: number) => readGamepad(pad(undefined, { 6: { pressed: v > 0, value: v }, 7: { pressed: v > 0, value: v } }));
    assert(!trig(TRIGGER_THRESHOLD - 0.01).intake && trig(TRIGGER_THRESHOLD).intake && trig(TRIGGER_THRESHOLD).shoot, 'LT / RT pressed at value >= 0.5');
    const ab = readGamepad(pad(undefined, { 0: press, 1: press }));
    assert(ab.lift && ab.drop && !ab.intake && !ab.shoot, 'A -> lift, B -> drop');
    const x = readGamepad(pad(undefined, { 2: press, 3: press }));
    assert(!x.lift && !x.drop, 'X / Y not bound (A = 0, B = 1)');
    const short = readGamepad({ axes: [], buttons: [] });
    assert(JSON.stringify(short) === JSON.stringify(NEUTRAL_SAMPLE), 'missing axes / buttons -> neutral');
    assert(readGamepad(pad([NaN, Infinity, 0, 0])).forward === 0, 'non-finite axes -> 0');
  });

  it('C. 키보드 읽기 (WASD / 방향키 / 대각선 정규화)', () => {
    const k = KEYBOARD_BINDINGS;
    const kb = (...codes: string[]) => readKeyboard(new Set(codes));
    assert(kb(k.forward).forward === 1 && kb(k.backward).forward === -1 && kb(k.right).right === 1 && kb(k.left).right === -1, 'W / S / D / A');
    const diag = kb(k.forward, k.right);
    assert(near(diag.forward, Math.SQRT1_2) && near(diag.right, Math.SQRT1_2), 'W + D -> diagonal normalized to magnitude 1');
    assert(kb(k.forward, k.backward).forward === 0, 'W + S cancel');
    assert(kb(k.turnRight).turn === 1 && kb(k.turnLeft).turn === -1 && kb(k.turnLeft, k.turnRight).turn === 0, 'arrows -> turn');
    const act = kb(k.intake, k.shoot, k.lift, k.drop);
    assert(act.intake && act.shoot && act.lift && act.drop, 'm , . / -> intake shoot lift drop');
    assert(JSON.stringify(kb('KeyQ', 'Space')) === JSON.stringify(NEUTRAL_SAMPLE), 'unbound keys ignored');
  });

  it('D. 짧은 탭 래치', () => {
    const l = new ControlLatch();
    l.sample(sample({ shoot: true }));
    l.sample(sample({ shoot: false }));                 // 틱 사이에 눌렀다 뗌
    assert(l.consume().shoot, 'tap shorter than a tick -> held for the next tick');
    assert(!l.consume().shoot, '... and only that tick');
    for (const b of ['intake', 'shoot', 'drop'] as const) {   // 유지형 버튼 전부 같은 래치
      const one = new ControlLatch();
      one.sample(sample({ [b]: true }));
      one.sample(sample());
      assert(one.consume()[b] && !one.consume()[b], `${b}: sub-tick tap latched for exactly one tick`);
    }
    l.sample(sample({ intake: true }));
    assert(l.consume().intake && l.consume().intake, 'held level stays pressed every tick');
    // 토글: 에지 1회 = 토글 1회, 누르고 있어도 반복되지 않음
    const t = new ControlLatch();
    t.sample(sample({ lift: true }));
    assert(t.consume().liftPressed && !t.consume().liftPressed, 'lift edge -> one toggle, holding A does not repeat');
    t.sample(sample({ lift: false }));
    t.sample(sample({ lift: true }));
    assert(t.consume().liftPressed, 'release + press again -> next toggle');
    // 한 프레임에 여러 틱 소비: 에지는 첫 틱에만
    const m = new ControlLatch();
    m.sample(sample({ drop: true }));
    m.sample(sample({ drop: false }));
    const ticks = [m.consume(), m.consume(), m.consume()];
    assert(ticks[0].drop && !ticks[1].drop && !ticks[2].drop, 'catch-up ticks: edge applied to first tick only');
    // 축은 최신 샘플
    const a = new ControlLatch();
    a.sample(sample({ forward: 1 }));
    a.sample(sample({ forward: 0.25, turn: -0.5 }));
    const at = a.consume();
    assert(at.forward === 0.25 && at.turn === -0.5, 'axes use the latest sample');
    // reset: 눌린 키 / 누적 에지 제거
    const r = new ControlLatch();
    r.sample(sample({ forward: 1, shoot: true, lift: true }));
    r.reset();
    assert(JSON.stringify(r.consume()) === JSON.stringify(NEUTRAL_TICK), 'reset clears levels and pending edges');
  });

  it('E. 장치 합성 (R2 = 패드 1 + 키보드)', () => {
    const m = mergeTickControls([tick({ forward: 0.3, right: -0.9, turn: 0.2 }), tick({ forward: -0.6, right: 0.5, shoot: true, liftPressed: true })]);
    assert(m.forward === -0.6 && m.right === -0.9 && m.turn === 0.2, 'axes: larger magnitude per channel');
    assert(m.shoot && m.liftPressed && !m.intake && !m.drop, 'buttons / toggle edges OR');
    assert(JSON.stringify(mergeTickControls([])) === JSON.stringify(NEUTRAL_TICK), 'no devices -> neutral');
    // 합성 후 단위원 초과(패드 오른쪽 1 + 키보드 전진 1) → 필드 속도 크기 1로 제한
    const f = driverToField(1, 1, RED, 0);
    assert(near(Math.hypot(f.ux, f.uy), 1), 'merged vector clamped to unit circle');
  });

  it('F. 조작 모드 (필드 기준 / 로봇 기준)', () => {
    const r = driverToField(1, 0, RED, 2.0), rs = driverToField(0, 1, RED, 2.0);
    assert(near(r.ux, 1) && near(r.uy, 0) && near(rs.ux, 0) && near(rs.uy, 1), 'RED field-centric: forward +x, right +y (heading ignored)');
    const b = driverToField(1, 0, BLUE, 0), bs = driverToField(0, 1, BLUE, 0);
    assert(near(b.ux, -1) && near(b.uy, 0) && near(bs.ux, 0) && near(bs.uy, -1), 'BLUE field-centric: forward -x, right -y');
    const ROBOT: DriverSettings = { alliance: 'RED', mode: 'ROBOT' };
    const h = Math.PI / 2;                                  // 캔버스 y-down에서 +y(아래)를 봄
    const rf = driverToField(1, 0, ROBOT, h), rr = driverToField(0, 1, ROBOT, h);
    assert(near(rf.ux, 0) && near(rf.uy, 1) && near(rr.ux, -1) && near(rr.uy, 0), 'robot-centric heading π/2: forward +y, right -x');
    const r0 = driverToField(1, 0, { alliance: 'BLUE', mode: 'ROBOT' }, 0);
    assert(near(r0.ux, 1), 'robot-centric ignores alliance');
    const cmd = buildDriveCommand(tick({ turn: 1 }), { actionState: 'IDLE', heading: 0 }, RED);
    assert(cmd.uw === 1, 'turn right -> +omega (both modes)');
  });

  it('G. 행동 요청 결정 (우선순위 / 리프트 토글 유도)', () => {
    const req = (prev: RobotState['actionState'], over: Partial<TickControls>) => resolveActionRequest(prev, tick(over));
    // IDLE / INTAKING: RT > A > LT, B 무효
    for (const prev of ['IDLE', 'INTAKING'] as const) {
      assert(req(prev, {}) === 'IDLE' && req(prev, { intake: true }) === 'INTAKING', `${prev}: none -> IDLE, LT -> INTAKING`);
      assert(req(prev, { shoot: true, intake: true }) === 'SHOOTING', `${prev}: RT beats LT`);
      assert(req(prev, { liftPressed: true, intake: true }) === 'FLOWER_SETUP', `${prev}: A beats LT`);
      assert(req(prev, { shoot: true, liftPressed: true }) === 'SHOOTING', `${prev}: RT + A same tick -> SHOOTING (A discarded)`);
      assert(req(prev, { drop: true }) === 'IDLE' && req(prev, { drop: true, intake: true }) === 'INTAKING', `${prev}: B ignored while lift is down`);
    }
    // 리프트 올림 / 대기: RT / LT 무시, A = 내림, B = 투입
    for (const prev of ['FLOWER_SETUP', 'FLOWER_READY'] as const) {
      assert(req(prev, {}) === 'FLOWER_SETUP', `${prev}: no input -> keep lift (toggle on derived from engine state)`);
      assert(req(prev, { shoot: true, intake: true }) === 'FLOWER_SETUP', `${prev}: RT / LT ignored while lifted`);
      assert(req(prev, { drop: true }) === 'FLOWER_DROPPING', `${prev}: B -> FLOWER_DROPPING`);
      assert(req(prev, { liftPressed: true }) === 'IDLE' && req(prev, { liftPressed: true, drop: true }) === 'IDLE', `${prev}: A -> lower request`);
    }
    // 투입 중: A 무효
    assert(req('FLOWER_DROPPING', { liftPressed: true }) === 'FLOWER_SETUP' && req('FLOWER_DROPPING', { liftPressed: true, drop: true }) === 'FLOWER_DROPPING',
      'DROPPING: A ignored (lift stays), B held -> continue dropping');
    // 발사 / 내림 중: A / B 무효
    for (const prev of ['SHOOTING', 'FLOWER_LOWERING'] as const) {
      assert(req(prev, { liftPressed: true }) === 'IDLE' && req(prev, { drop: true }) === 'IDLE', `${prev}: A / B ignored`);
      assert(req(prev, { shoot: true, intake: true }) === 'SHOOTING' && req(prev, { intake: true }) === 'INTAKING', `${prev}: RT > LT`);
    }
  });

  it('H. 8비트 양자화 / 부호화 / 복호화', () => {
    assert(quantizeUnit(1) === 127 && quantizeUnit(-1) === -127 && quantizeUnit(0) === 0, 'full scale ±127');
    assert(quantizeUnit(0.5) === 64 && quantizeUnit(-0.5) === -64, 'sign-symmetric rounding (0.5 * 127 = 63.5 -> ±64)');
    assert(quantizeUnit(2) === 127 && quantizeUnit(-3) === -127 && quantizeUnit(NaN) === 0 && Object.is(quantizeUnit(-0.001), 0), 'clamp / non-finite / no negative zero');
    for (const a of ACTION_CODES) assert(decodeActionRequest(encodeDriveCommand({ ux: 0, uy: 0, uw: 0, request: a })[3]) === a, `action ${a} round-trip`);
    assert(ACTION_CODES.join() === 'IDLE,INTAKING,SHOOTING,FLOWER_SETUP,FLOWER_DROPPING', 'action codes 0..4 fixed');
    assert(decodeActionRequest(9) === 'IDLE' && decodeActionRequest(-1) === 'IDLE', 'unknown action code -> IDLE');
    const enc = encodeDriveCommand({ ux: 1, uy: -0.5, uw: 0.25, request: 'SHOOTING' });
    const dec = decodeDriveInput(enc, 0, C2);
    assert(dec.targetVx === 60 && near(dec.targetVy, (-64 / 127) * 60) && near(dec.targetOmega, (32 / 127) * 4) && dec.actionState === 'SHOOTING', 'decode scales by maxSpeed / maxTurnRate');
    // 로그 Int8Array 오프셋에서 복호화 (4바이트 레코드), -128은 -127로 제한
    const log = new Int8Array([0, 0, 0, 0, ...enc, -128, 0, 0, 1]);
    const fromLog = decodeDriveInput(log, 4, C2);
    assert(JSON.stringify(fromLog) === JSON.stringify(dec), 'decode from Int8Array record == decode from tuple');
    assert(decodeDriveInput(log, 8, C2).targetVx === -60, 'out-of-range -128 clamped to -127');
    assert((1 / QUANT_MAX) * 60 < 0.5, 'one step at maxSpeed 60 < stationary threshold 0.5 in/s');
  });

  it('I. 엔진 연동 (부호화 → 복호화 → step, 리프트 토글 동기화)', () => {
    // RED 필드 기준 전진 → +x, BLUE 전진 → -x
    {
      const e = eng({ r2Spawn: pose(40, 115) });   // HIVE(y ≤ 91.475)와 떨어진 줄
      holdR2(e, 50, tick({ forward: 1 }));
      assert(e.r2.x > 60 && near(e.r2.y, 115, 1e-6), `RED forward drives +x (x ${e.r2.x.toFixed(2)})`);
      const b = eng({ allianceColor: 'BLUE', r2Spawn: pose(100, 115, Math.PI) });
      for (let i = 0; i < 50; i++) driveR2(b, tick({ forward: 1 }), BLUE);
      assert(b.r2.x < 80, `BLUE forward drives -x (x ${b.r2.x.toFixed(2)})`);
    }
    // 리프트 전체 흐름: A 탭 → 올림 → 대기 → B 탭 1개 투입 → 대기 → A 탭 → 내림 → IDLE, 이후 토글이 남지 않음
    {
      const e = eng({ r2Spawn: pose(9, 107.9) });
      driveR2(e, tick({ liftPressed: true }));
      assert(e.r2.actionState === 'FLOWER_SETUP', 'A tap near FLOWER -> lift starts');
      holdR2(e, 30);
      assert(e.r2.actionState === 'FLOWER_READY', 'no further input -> lift intent stays on (derived), READY');
      driveR2(e, tick({ drop: true }));
      holdR2(e, 15);
      assert(e.field.flowers[0].pieces.length === 5 && e.r2.controlledPieces.length === 3 && e.r2.actionState === 'FLOWER_READY', 'B tap -> one drop, back to READY');
      holdR2(e, 20, tick({ forward: 1, shoot: true }));
      assert(e.r2.actionState === 'FLOWER_READY' && e.r2.x === 9 && e.field.pendingShots.length === 0, 'RT / stick while lifted: no shot, no motion (lift stays up)');
      driveR2(e, tick({ liftPressed: true }));
      assert(e.r2.actionState === 'FLOWER_LOWERING', 'A tap while READY -> lowering');
      holdR2(e, 30);
      assert(e.r2.actionState === 'IDLE', 'lowered -> IDLE, toggle not stuck on');
    }
    // 투입 중 A 탭은 무효: 투입 후 대기 유지 (내리지 않음)
    {
      const e = eng({ r2Spawn: pose(9, 107.9) });
      driveR2(e, tick({ liftPressed: true }));
      holdR2(e, 30);
      driveR2(e, tick({ drop: true }));
      driveR2(e, tick({ liftPressed: true }));
      holdR2(e, 15);
      assert(e.field.flowers[0].pieces.length === 5 && e.r2.actionState === 'FLOWER_READY', 'A during DROPPING ignored -> READY after drop');
    }
    // 엔진이 올림 요청을 거부하면 토글도 꺼짐: 멀리서 A → IDLE, 이후 FLOWER 옆에 가도 저절로 올라가지 않음
    {
      const e = eng({ r2Spawn: pose(9, 120) });
      driveR2(e, tick({ liftPressed: true }));
      assert(e.r2.actionState === 'IDLE', 'A far from FLOWER -> refused (IDLE)');
      holdR2(e, 60, tick({ right: -0.3 }));               // 드라이버 왼쪽 = -y → FLOWER1(2, 96) 쪽으로 이동해 닿음
      holdR2(e, 20);
      assert(e.r2.y - 9 - 98 <= 1.0, `robot reached FLOWER drop reach (gap ${(e.r2.y - 9 - 98).toFixed(2)} in)`);
      assert(e.timeline.every(fr => fr.r2.actionState === 'IDLE'), 'refused toggle never re-fires later');
    }
    // 실시간 명령과 복호화 입력의 일치: 엔진은 양자화된 값만 받음
    {
      const cmd = buildDriveCommand(tick({ forward: 0.333, right: 0.1, turn: -0.77 }), { actionState: 'IDLE', heading: 0 }, RED);
      const input = decodeDriveInput(encodeDriveCommand(cmd), 0, C2);
      assert(near(input.targetVx, (quantizeUnit(0.333) / 127) * 60) && Math.abs(input.targetVx - 0.333 * 60) <= 0.5 * 60 / 127 + 1e-12,
        'engine receives quantized velocity (error <= half step)');
    }
  });
});
