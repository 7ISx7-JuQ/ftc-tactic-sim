import { describe, it, expect } from 'vitest';
import { DT, MATCH_TICKS, SimulationEngine } from '../../core/simulationEngine';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, RobotPose, ScenarioConfig } from '../../core/types';
import { NEUTRAL_TICK } from '../controls';
import type { GamepadSnapshot, TickControls } from '../controls';
import { DEVICE_ASSIGNMENT, KEYBOARD_BINDINGS, MAX_CATCHUP_TICKS, TICK_MS } from '../inputConfig';
import type { RobotId } from '../inputConfig';
import { LOG_RECORD_BYTES, MatchInputs } from '../inputLog';
import { LiveControlCollector } from '../liveControls';
import type { LiveControlSource } from '../liveControls';
import { RealtimeLoop } from '../realtimeLoop';
import type { FrameScheduler, LoopState, PauseReason } from '../realtimeLoop';

// 풀매치를 도는 테스트의 제한 시간 (기본 5초는 병렬 실행 부하에서 부족, 엔진 테스트와 같은 값)
const TEST_TIMEOUT_MS = 120_000;

const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});
const C1 = cfg('robot1'), C2 = cfg('robot2');
const pose = (x: number, y: number, heading = 0): RobotPose => ({ x, y, heading });
const eng = (sc: Partial<ScenarioConfig> = {}) =>
  new SimulationEngine(C1, C2, () => 0.6, sc.allianceColor ?? 'RED', { allianceColor: 'RED', ...sc });

// 가짜 requestAnimationFrame: frame(now)로 대기 중인 콜백을 실행
class FakeScheduler implements FrameScheduler {
  private nextId = 1;
  private readonly pending = new Map<number, (now: number) => void>();
  request(cb: (now: number) => void): number {
    const id = this.nextId++;
    this.pending.set(id, cb);
    return id;
  }
  cancel(id: number): void {
    this.pending.delete(id);
  }
  frame(now: number): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb(now);
  }
  get waiting(): number {
    return this.pending.size;
  }
}

// 호출 기록용 가짜 입력 공급
class CountingControls implements LiveControlSource {
  polls = 0;
  consumed = 0;
  resets = 0;
  readonly order: string[] = [];
  poll(): void { this.polls++; this.order.push('poll'); }
  consumeTick(): Record<RobotId, TickControls> { this.consumed++; this.order.push('tick'); return { robot1: NEUTRAL_TICK, robot2: NEUTRAL_TICK }; }
  reset(): void { this.resets++; }
}

// 루프 + 틱 수 기록. frame(dt)로 경과 시간을 흘려 보냄
const harness = (e = eng(), controls: LiveControlSource = new CountingControls(), inputs = new MatchInputs()) => {
  const sched = new FakeScheduler();
  const stepped: number[] = [];
  const events: [LoopState, PauseReason | null][] = [];
  const loop = new RealtimeLoop(e, inputs, controls, sched, {
    onFrame: n => stepped.push(n),
    onStateChange: (s, r) => events.push([s, r]),
  });
  let now = 1000;                                          // 임의 시작 시각 (rAF 타임스탬프)
  const frame = (dt: number) => { now += dt; sched.frame(now); return stepped[stepped.length - 1] ?? 0; };
  return { e, loop, sched, stepped, events, frame, inputs, controls };
};

// 표준 배열 게임패드 스냅샷
const pad = (axes: number[] = [0, 0, 0, 0], pressed: number[] = []): GamepadSnapshot => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => (pressed.includes(i) ? { pressed: true, value: 1 } : { pressed: false, value: 0 })),
});
// 수집기 + poll 훅(브라우저 어댑터 대역): 매 프레임 현재 장치 상태를 재샘플
class FakeDevices implements LiveControlSource {
  readonly collector = new LiveControlCollector();
  pads: (GamepadSnapshot | null)[] = [null, null];
  keys = new Set<string>();
  poll(): void {
    this.pads.forEach((p, slot) => this.collector.sampleGamepad(slot, p));
    this.collector.sampleKeyboard(this.keys);
  }
  consumeTick() { return this.collector.consumeTick(); }
  reset(): void { this.collector.reset(); }
}

describe('실시간 루프 (명세서 3.6)', () => {
  it('A. 루프 상수', () => {
    assert(TICK_MS === 20 && Math.abs(TICK_MS - DT * 1000) < 1e-9, 'TICK_MS = 20 ms = engine DT');
    assert(MAX_CATCHUP_TICKS === 5, 'catch-up cap 5 ticks (100 ms)');
  });

  it('B. 20 ms 누산기 (프레임 주기와 무관하게 50틱/초)', () => {
    {
      const h = harness();
      h.loop.start();
      assert(h.loop.state === 'RUNNING' && h.sched.waiting === 1, 'start -> RUNNING, one frame requested');
      assert(h.frame(0) === 0, 'first frame after start: elapsed 0 -> no tick');
      for (let i = 0; i < 10; i++) h.frame(20);
      assert(h.e.currentTick === 10 && h.stepped.slice(1).every(n => n === 1), '20 ms frames -> 1 tick each');
    }
    for (const hz of [30, 60, 120, 144]) {
      const h = harness();
      h.loop.start();
      h.frame(0);
      const start = h.e.currentTick;
      for (let i = 1; i <= hz; i++) h.frame(1000 / hz);    // 1초
      const ticks = h.e.currentTick - start;
      assert(ticks >= 49 && ticks <= 50, `${hz} Hz for 1 s -> 50 ticks (±1 rounding, got ${ticks})`);
      if (hz > 50) assert(h.stepped.includes(0), `${hz} Hz: some frames step 0 ticks`);
    }
    {
      const h = harness();
      h.loop.start();
      h.frame(0);
      for (let i = 0; i < 20; i++) h.frame(10);
      assert(h.e.currentTick === 10 && h.stepped.slice(1).join('') === '01'.repeat(10), '10 ms frames -> a tick every other frame (remainder kept)');
    }
  });

  it('C. 따라잡기 상한 5틱 (밀린 시간 버림)', () => {
    const h = harness();
    h.loop.start();
    h.frame(0);
    assert(h.frame(70) === 3 && h.frame(10) === 1, '70 ms -> 3 ticks, 10 ms remainder carried to the next frame');
    assert(h.frame(110) === 5 && h.frame(10) === 1, '110 ms -> 5 ticks (cap reached, 10 ms remainder < 1 tick is kept)');
    const before = h.e.currentTick;
    assert(h.frame(250) === MAX_CATCHUP_TICKS, '250 ms hitch -> capped at 5 ticks');
    assert(h.frame(20) === 1 && h.e.currentTick === before + 6, 'backlog (150 ms) discarded: next 20 ms frame steps only 1 tick');
  });

  it('D. 일시정지 / 재개', () => {
    const c = new CountingControls();
    const h = harness(eng(), c);
    h.loop.pause();
    h.loop.resume();
    assert(h.loop.state === 'READY' && h.events.length === 0, 'pause / resume before start: no-op');
    h.loop.start();
    h.frame(0);
    h.frame(35);                                            // 1틱 + 15 ms 누산
    const resetsBefore = c.resets;
    h.loop.pause('HIDDEN');
    assert(h.loop.state === 'PAUSED' && h.loop.pauseReason === 'HIDDEN' && h.sched.waiting === 0, 'pause -> PAUSED (reason kept), frame request cancelled');
    assert(c.resets === resetsBefore + 1, 'pause resets the input accumulator');
    const tick = h.e.currentTick;
    h.sched.frame(999999);
    assert(h.e.currentTick === tick, 'no ticks while paused (engine stays at the paused tick)');
    h.loop.pause('BLUR');
    assert(h.loop.pauseReason === 'HIDDEN', 'second pause while paused: no-op');
    h.loop.start();
    assert(h.loop.state === 'PAUSED', 'start while paused: no-op (use resume)');

    h.loop.resume();                                        // 30초 뒤 재개
    assert(h.loop.state === 'RUNNING' && h.loop.pauseReason === null && c.resets === resetsBefore + 2, 'resume -> RUNNING, accumulator reset again');
    assert(h.frame(30000) === 0 && h.e.currentTick === tick, 'first frame after resume: elapsed 0 (no burst, 15 ms accumulated before pause also dropped)');
    assert(h.frame(20) === 1 && h.e.currentTick === tick + 1, 'then continues from the paused tick');
    h.loop.pause('GAMEPAD_DISCONNECTED');
    h.loop.resume();
    const seq = h.events.map(([s, r]) => (r ? `${s}:${r}` : s)).join(' ');
    assert(seq === 'RUNNING PAUSED:HIDDEN RUNNING PAUSED:GAMEPAD_DISCONNECTED RUNNING', `state events (${seq})`);
  });

  it('E. 경기 종료 자동 정지', () => {
    const e = eng();
    while (e.currentTick < MATCH_TICKS - 7) e.step();
    const h = harness(e);
    h.loop.start();
    h.frame(0);
    h.frame(100);
    assert(h.loop.state === 'RUNNING' && e.currentTick === MATCH_TICKS - 2, '5 ticks, 2 left');
    assert(h.frame(100) === 2 && e.currentTick === MATCH_TICKS, 'last frame steps only the remaining 2 ticks');
    assert(h.loop.state === 'ENDED' && h.sched.waiting === 0, 'ENDED at tick 6000, no more frames requested');
    h.loop.pause();
    h.loop.resume();
    h.loop.start();
    const log = h.inputs.logs.robot1;
    assert(h.loop.state === 'ENDED' && log.length === MATCH_TICKS && log.data.subarray(0, (MATCH_TICKS - 7) * LOG_RECORD_BYTES).every(v => v === 0),
      'ended loop ignores pause / resume / start; live ticks 5993.. logged, earlier ticks neutral-filled');
    const done = harness(e);
    done.loop.start();
    assert(done.loop.state === 'ENDED' && done.sched.waiting === 0, 'start on a finished match -> ENDED immediately');
  }, TEST_TIMEOUT_MS);

  it('F. 틱마다 입력 1회 소비 / 프레임마다 폴링 1회 (소비 전)', () => {
    const c = new CountingControls();
    const h = harness(eng(), c);
    h.loop.start();
    h.frame(0);
    h.frame(60);
    h.frame(5);
    assert(c.consumed === 3 && c.polls === 3, `3 frames -> 3 polls, 3 ticks -> 3 consumes (${c.polls}, ${c.consumed})`);
    assert(c.order.join(' ') === 'poll poll tick tick tick poll', 'poll precedes tick consumption in each frame');
  });

  it('G. 통합: 입력 수집기 + 입력 허브 + 엔진', () => {
    // 장치 배정: 키보드 → R2 (패드 0 → R1은 연결 없음 → 정지)
    {
      const d = new FakeDevices();
      const h = harness(eng({ r2Spawn: pose(40, 115) }), d);
      d.keys = new Set([KEYBOARD_BINDINGS.forward]);
      h.loop.start();
      h.frame(0);
      for (let i = 0; i < 50; i++) h.frame(20);
      assert(h.e.r2.x > 60 && h.e.r1.x === 9 && h.inputs.logs.robot2.length === 50, `keyboard W drives R2 +x (x ${h.e.r2.x.toFixed(1)}), R1 idle, 50 ticks logged`);
      assert(DEVICE_ASSIGNMENT.keyboard === 'robot2', 'keyboard assigned to R2');
    }
    // 따라잡기 프레임의 탭: 한 프레임에 3틱 소비 → RT 탭은 첫 틱에만 SHOOTING 요청
    {
      const d = new FakeDevices();
      const h = harness(eng(), d);
      h.loop.start();
      h.frame(0);
      h.frame(20);
      d.collector.sampleGamepad(1, pad(undefined, [7]));     // 프레임 사이에 RT를 눌렀다 뗌 (패드 1 → R2)
      d.collector.sampleGamepad(1, pad());
      const t0 = h.e.currentTick;
      h.frame(60);
      const codes = [0, 1, 2].map(i => h.inputs.logs.robot2.data[(t0 + i) * LOG_RECORD_BYTES + 3]);
      assert(codes.join() === '2,0,0' && h.e.r2.actionState === 'SHOOTING', `tap during a 3-tick catch-up frame -> SHOOTING on the first tick only (${codes})`);
    }
    // 탭 숨김 중 키를 뗀 이벤트 유실: 일시정지가 눌린 키를 지워 재개 후 로봇이 저절로 달리지 않음
    {
      const d = new FakeDevices();
      const h = harness(eng({ r2Spawn: pose(40, 115) }), d);
      d.keys = new Set([KEYBOARD_BINDINGS.forward]);
      h.loop.start();
      h.frame(0);
      for (let i = 0; i < 10; i++) h.frame(20);
      h.loop.pause('HIDDEN');
      d.keys = new Set();                                     // 브라우저 어댑터: 포커스 소실 시 키 상태 비움 (07-6)
      h.loop.resume();
      h.frame(30000);
      for (let i = 0; i < 40; i++) h.frame(20);
      const r2 = h.e.r2;
      assert(Math.hypot(r2.vx, r2.vy) < 0.5 && h.inputs.logs.robot2.length === 50, `after resume the stuck key is gone: R2 decelerates to a stop (speed ${Math.hypot(r2.vx, r2.vy).toFixed(2)})`);
    }
    // 일시정지 중 되감기 → 재개는 되감은 틱에서 이어감 (LIVE 로그도 그 틱부터 다시 기록)
    {
      const d = new FakeDevices();
      const h = harness(eng(), d);
      h.loop.start();
      h.frame(0);
      for (let i = 0; i < 20; i++) h.frame(20);
      h.loop.pause();
      h.e.scrubTo(5);
      h.loop.resume();
      h.frame(0);
      for (let i = 0; i < 3; i++) h.frame(20);
      assert(h.e.currentTick === 8 && h.inputs.logs.robot1.length === 8 && h.e.timeline.length === 9, 'resume after scrub continues from tick 5 (log / timeline cut there)');
    }
    // 불규칙한 프레임 간격 + 끊김이 있어도 실시간 결과 = 로그 재생 결과 (풀매치)
    {
      const d = new FakeDevices();
      const h = harness(eng({ r2Spawn: pose(40, 115) }), d);
      h.inputs.modes.robot2 = 'ROBOT';
      h.loop.start();
      let f = 0;
      while (h.loop.state === 'RUNNING') {
        const t = h.e.currentTick;
        d.pads[0] = pad([Math.cos(t / 41), -Math.sin(t / 37), 0.4 * Math.sin(t / 23), 0], [...(t % 300 < 90 ? [6] : []), ...(t % 300 === 150 ? [7] : [])]);
        d.pads[1] = t % 700 < 350 ? pad([0.3 * Math.sin(t / 19), -0.8, 0, 0], t % 500 === 250 ? [0] : []) : null;
        d.keys = new Set(t % 400 < 60 ? [KEYBOARD_BINDINGS.turnRight] : []);
        f++;
        h.frame(f % 97 === 0 ? 180 : 8 + (f * 7919) % 17);   // 8~24 ms 흔들림 + 가끔 180 ms 끊김
        if (f % 1500 === 0) { h.loop.pause('BLUR'); h.loop.resume(); }
      }
      assert(h.loop.state === 'ENDED' && h.e.currentTick === MATCH_TICKS, `jittery real-time run reached the end (${f} frames)`);
      const replay = eng({ r2Spawn: pose(40, 115) });
      replay.inputProvider = h.inputs.createReplayProvider();
      replay.runFullMatch();
      let diff = -1;
      for (let t = 0; t <= MATCH_TICKS && diff < 0; t++) if (JSON.stringify(replay.getFrame(t)) !== JSON.stringify(h.e.getFrame(t))) diff = t;
      assert(diff < 0, `real-time loop result reproduces exactly from the logs (first diff ${diff})`);
    }
  }, TEST_TIMEOUT_MS);

  it('H. 입력 수집기 (장치 배정 / 합성 / 해제 / 초기화)', () => {
    const c = new LiveControlCollector();
    c.sampleGamepad(0, pad([0, -1, 0, 0]));                 // 패드 0 전진 → R1
    c.sampleGamepad(1, pad([0.5, 0, 0, 0], [7]));           // 패드 1 오른쪽 + RT → R2
    c.sampleKeyboard(new Set([KEYBOARD_BINDINGS.forward, KEYBOARD_BINDINGS.lift]));   // 키보드 W + . → R2
    c.sampleGamepad(2, pad([1, 1, 1, 1], [0, 1, 6, 7]));    // 슬롯 2는 배정 없음 → 무시
    const t = c.consumeTick();
    assert(t.robot1.forward === 1 && !t.robot1.shoot && !t.robot1.liftPressed && t.robot1.right === 0, 'pad 0 -> R1 only (slot 2 ignored)');
    assert(t.robot2.forward === 1 && t.robot2.right > 0.4 && t.robot2.shoot && t.robot2.liftPressed, 'R2 = pad 1 + keyboard merged');
    c.sampleGamepad(1, null);
    const u = c.consumeTick();
    assert(u.robot2.right === 0 && !u.robot2.shoot && u.robot2.forward === 1 && !u.robot2.liftPressed, 'pad 1 disconnected -> neutral; keyboard W still held; lift edge consumed');
    c.reset();
    const v = c.consumeTick();
    assert(v.robot1.forward === 0 && v.robot2.forward === 0, 'reset clears all device levels');
    const off = new LiveControlCollector(DEVICE_ASSIGNMENT, false);
    off.sampleKeyboard(new Set([KEYBOARD_BINDINGS.forward]));
    assert(off.consumeTick().robot2.forward === 0, 'keyboard disabled -> ignored');
  });
});
