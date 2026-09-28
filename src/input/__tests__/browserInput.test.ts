import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../../core/simulationEngine';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, RobotPose, ScenarioConfig } from '../../core/types';
import {
  BrowserInputAdapter,
  createAnimationFrameScheduler,
  createBrowserRealtimeLoop,
  isEditableTarget,
} from '../browserInput';
import type { BrowserInputEnv, GamepadLike } from '../browserInput';
import { DEVICE_ASSIGNMENT, KEYBOARD_BINDINGS } from '../inputConfig';
import { MatchInputs } from '../inputLog';
import type { FrameScheduler, PauseReason } from '../realtimeLoop';

const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4,
});
const pose = (x: number, y: number, heading = 0): RobotPose => ({ x, y, heading });
const eng = (sc: Partial<ScenarioConfig> = {}) =>
  new SimulationEngine(cfg('robot1'), cfg('robot2'), () => 0.6, 'RED', { allianceColor: 'RED', ...sc });

// 가짜 브라우저 환경: Node의 EventTarget + 조작 가능한 visibilityState / getGamepads
const fakeEnv = () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const pads: (GamepadLike | null)[] = [];
  const nav: { getGamepads?: () => readonly (GamepadLike | null)[] } = { getGamepads: () => pads };
  const env: BrowserInputEnv = { window: win, document: doc, navigator: nav };
  return { env, win, doc, pads, nav };
};
const gamepad = (index: number, axes = [0, 0, 0, 0], pressed: number[] = [], over: Partial<GamepadLike> = {}): GamepadLike => ({
  index, id: `Pad ${index}`, mapping: 'standard', connected: true, axes,
  buttons: Array.from({ length: 17 }, (_, i) => (pressed.includes(i) ? { pressed: true, value: 1 } : { pressed: false, value: 0 })),
  ...over,
});
// 키 이벤트 (Node에는 KeyboardEvent가 없으므로 Event + 속성; target은 버블링된 원래 대상 흉내)
const key = (type: 'keydown' | 'keyup', code: string, opts: { repeat?: boolean; target?: object } = {}) => {
  const ev = Object.assign(new Event(type, { cancelable: true }), { code, repeat: opts.repeat ?? false });
  if (opts.target) Object.defineProperty(ev, 'target', { value: opts.target });
  return ev;
};
const pausesOf = (a: BrowserInputAdapter) => {
  const reasons: PauseReason[] = [];
  a.attach(r => reasons.push(r));
  return reasons;
};
const K = KEYBOARD_BINDINGS;

class FakeScheduler implements FrameScheduler {
  private nextId = 1;
  private readonly pending = new Map<number, (now: number) => void>();
  request(cb: (now: number) => void): number { const id = this.nextId++; this.pending.set(id, cb); return id; }
  cancel(id: number): void { this.pending.delete(id); }
  frame(now: number): void { const cbs = [...this.pending.values()]; this.pending.clear(); for (const cb of cbs) cb(now); }
}

describe('브라우저 입력 어댑터 (명세서 3.6, 가짜 브라우저 환경)', () => {
  it('A. 입력 폼 판정', () => {
    assert(isEditableTarget({ tagName: 'INPUT' }) && isEditableTarget({ tagName: 'textarea' }) && isEditableTarget({ tagName: 'SELECT' }), 'input / textarea / select');
    assert(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), 'contenteditable');
    assert(!isEditableTarget({ tagName: 'CANVAS' }) && !isEditableTarget(null) && !isEditableTarget(new EventTarget()), 'canvas / null / window are not editable');
  });

  it('B. 키보드 (event.code / preventDefault / 자동 반복 / 입력 폼 / 비활성화)', () => {
    const { env, win } = fakeEnv();
    const a = new BrowserInputAdapter(env);
    pausesOf(a);
    const w = key('keydown', K.forward);
    win.dispatchEvent(w);
    a.poll();
    assert(w.defaultPrevented && a.consumeTick().robot2.forward === 1, 'W keydown -> prevented, R2 forward (keyboard -> R2)');
    const q = key('keydown', 'KeyQ');
    win.dispatchEvent(q);
    assert(!q.defaultPrevented, 'unbound key not intercepted');
    const arrow = key('keydown', K.turnRight);
    const slash = key('keydown', K.drop);
    win.dispatchEvent(arrow);
    win.dispatchEvent(slash);
    assert(arrow.defaultPrevented && slash.defaultPrevented, 'arrow (scroll) and / (Firefox quick find) prevented');
    win.dispatchEvent(key('keyup', K.turnRight));
    win.dispatchEvent(key('keyup', K.drop));
    a.consumeTick();

    // 토글 키 자동 반복: 반복 이벤트는 새 눌림이 아님 (토글 1회)
    win.dispatchEvent(key('keydown', K.lift));
    const rep = key('keydown', K.lift, { repeat: true });
    win.dispatchEvent(rep);
    assert(rep.defaultPrevented && a.consumeTick().robot2.liftPressed && !a.consumeTick().robot2.liftPressed, 'auto-repeat prevented but does not toggle again');
    win.dispatchEvent(key('keyup', K.lift));

    // 입력 폼에서 누른 키는 무시 (가로채지도 않음)
    const typed = key('keydown', K.shoot, { target: { tagName: 'INPUT' } });
    win.dispatchEvent(typed);
    assert(!typed.defaultPrevented && !a.consumeTick().robot2.shoot, 'keys typed into a form are ignored');

    // 짧은 탭: 틱 사이에 눌렀다 뗀 키도 1틱 반영
    win.dispatchEvent(key('keydown', K.shoot));
    win.dispatchEvent(key('keyup', K.shoot));
    assert(a.consumeTick().robot2.shoot && !a.consumeTick().robot2.shoot, 'sub-tick key tap latched for one tick');
    win.dispatchEvent(key('keyup', K.forward));
    a.poll();
    assert(a.consumeTick().robot2.forward === 0, 'keyup releases');

    // 키보드 비활성화: 무시 + 가로채지 않음
    const off = fakeEnv();
    const b = new BrowserInputAdapter(off.env, { keyboardEnabled: false });
    pausesOf(b);
    const w2 = key('keydown', K.forward);
    off.win.dispatchEvent(w2);
    b.poll();
    assert(!w2.defaultPrevented && b.consumeTick().robot2.forward === 0, 'KEYBOARD_ENABLED = false -> keyboard ignored entirely');
  });

  it('C. 게임패드 폴링 (슬롯 배정 / 연결 상태 / API 없음)', () => {
    const { env, pads, nav } = fakeEnv();
    const a = new BrowserInputAdapter(env);
    pads[0] = gamepad(0, [0, -1, 0, 0]);
    pads[1] = gamepad(1, [1, 0, 0, 0], [7], { connected: false });
    pads[2] = gamepad(2, [0, 1, 0, 0], [0, 1, 6, 7]);
    a.poll();
    const t = a.consumeTick();
    assert(t.robot1.forward === 1 && t.robot2.right === 0 && !t.robot2.shoot && !t.robot1.liftPressed, 'slot 0 -> R1; disconnected slot 1 neutral; unassigned slot 2 ignored');
    pads[1] = gamepad(1, [1, 0, 0, 0], [7]);
    a.poll();
    const u = a.consumeTick();
    assert(u.robot2.right === 1 && u.robot2.shoot, 'slot 1 connected -> R2');
    nav.getGamepads = () => { throw new Error('blocked'); };
    a.poll();
    assert(a.consumeTick().robot1.forward === 0, 'getGamepads throws -> neutral (no crash)');
    delete nav.getGamepads;
    a.poll();
    assert(a.consumeTick().robot2.right === 0, 'no Gamepad API -> neutral');

    const s = fakeEnv();
    const b = new BrowserInputAdapter(s.env);
    s.pads[0] = gamepad(0, undefined, [], { id: 'Xbox Controller' });
    s.pads[1] = gamepad(1, undefined, [], { id: 'Generic DInput', mapping: '' });
    const st = b.gamepadStatus();
    assert(st.length === Object.keys(DEVICE_ASSIGNMENT.gamepads).length && st[0].slot === 0 && st[0].robot === 'robot1' && st[0].connected && st[0].standard && st[0].id === 'Xbox Controller',
      'status: slot 0 -> R1, connected, standard mapping');
    assert(st[1].robot === 'robot2' && st[1].connected && !st[1].standard, 'status: non-standard mapping flagged (warning in GUI)');
    s.pads[1] = null;
    assert(!b.gamepadStatus()[1].connected && b.gamepadStatus()[1].id === null, 'status: missing pad -> not connected');
  });

  it('D. 자동 일시정지 이벤트 (포커스 소실 / 탭 숨김 / 배정 패드 분리)', () => {
    const { env, win, doc } = fakeEnv();
    const a = new BrowserInputAdapter(env);
    const reasons = pausesOf(a);
    win.dispatchEvent(key('keydown', K.forward));
    win.dispatchEvent(new Event('blur'));
    a.poll();
    assert(reasons.join() === 'BLUR' && a.consumeTick().robot2.forward === 0, 'blur -> pause(BLUR), held keys cleared (their keyup would be lost)');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert(reasons.length === 1, 'visibilitychange to visible -> no pause');
    win.dispatchEvent(key('keydown', K.forward));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    a.poll();
    assert(reasons.join() === 'BLUR,HIDDEN' && a.consumeTick().robot2.forward === 0, 'tab hidden -> pause(HIDDEN), keys cleared');
    const disc = (index: number) => Object.defineProperty(new Event('gamepaddisconnected'), 'gamepad', { value: { index } });
    win.dispatchEvent(disc(3));
    assert(reasons.length === 2, 'unassigned pad disconnect -> no pause');
    win.dispatchEvent(disc(1));
    assert(reasons.join() === 'BLUR,HIDDEN,GAMEPAD_DISCONNECTED', 'assigned pad (slot 1) disconnect -> pause');
    a.detach();
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(key('keydown', K.forward));
    a.poll();
    assert(reasons.length === 3 && a.consumeTick().robot2.forward === 0, 'detach removes all listeners');
  });

  it('E. 실시간 루프 연결 (createBrowserRealtimeLoop)', () => {
    const { env, win } = fakeEnv();
    const sched = new FakeScheduler();
    const e = eng({ r2Spawn: pose(40, 115) });
    const { loop, adapter, dispose } = createBrowserRealtimeLoop(e, new MatchInputs(), {}, env, sched);
    let now = 0;
    const frames = (n: number) => { for (let i = 0; i < n; i++) sched.frame((now += 20)); };
    loop.start();
    win.dispatchEvent(key('keydown', K.forward));
    frames(21);
    const x1 = e.r2.x;
    assert(loop.state === 'RUNNING' && e.currentTick === 20 && x1 > 42, `keyboard drives R2 through the loop (x ${x1.toFixed(2)})`);

    // 사용자 일시정지 → 재개: 누르고 있는 키는 다음 프레임 폴링에서 복원되어 계속 주행
    loop.pause('USER');
    loop.resume();
    frames(11);
    // 키가 유지되면 계속 가속(약 60 in/s), 잃으면 감속(약 24 in/s)
    assert(e.r2.x > x1 && e.r2.vx > 55, `held key survives USER pause / resume (vx ${e.r2.vx.toFixed(1)} in/s, still accelerating)`);

    // 포커스 소실 → 자동 일시정지 + 눌린 키 제거 → 재개 후 저절로 달리지 않음
    win.dispatchEvent(new Event('blur'));
    assert(loop.state === 'PAUSED' && loop.pauseReason === 'BLUR', 'window blur pauses the loop');
    loop.resume();
    frames(40);
    assert(Math.hypot(e.r2.vx, e.r2.vy) < 0.5, 'after blur the stuck key is gone: R2 coasts to a stop');
    assert(adapter.gamepadStatus().every(s => !s.connected), 'no gamepads connected in the fake env');

    dispose();
    const tick = e.currentTick;
    frames(10);
    win.dispatchEvent(key('keydown', K.forward));
    assert(loop.state === 'PAUSED' && e.currentTick === tick, 'dispose: loop paused and listeners removed');
  });

  it('F. requestAnimationFrame 스케줄러', () => {
    const calls: string[] = [];
    const win = {
      requestAnimationFrame: (cb: FrameRequestCallback) => { calls.push('raf'); cb(123); return 7; },
      cancelAnimationFrame: (id: number) => { calls.push(`cancel ${id}`); },
    };
    const s = createAnimationFrameScheduler(win);
    let got = -1;
    const id = s.request(t => { got = t; });
    s.cancel(id);
    assert(got === 123 && id === 7 && calls.join() === 'raf,cancel 7', 'delegates to requestAnimationFrame / cancelAnimationFrame');
  });
});
