import { describe, expect, it } from 'vitest';
import { bearingTo } from '../../core/ballistics';
import { hiveCellAimPoint } from '../../core/collision';
import type { BrowserInputEnv, GamepadLike } from '../../input/browserInput';
import { KEYBOARD_BINDINGS } from '../../input/inputConfig';
import type { FrameScheduler } from '../../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS } from '../../renderer/renderOptions';
import { VIEW_ANIMATION_MS, viewAngle } from '../../renderer/viewTransform';
import { DEV_HIT_PROBABILITY, DEV_ROBOT_CONFIGS, createDevEngine, createDevResolver } from '../devSetup';
import { HarnessController } from '../harnessController';
import type { HarnessStatus } from '../harnessController';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// 가짜 브라우저 환경 (입력 어댑터 테스트와 같은 방식)
const fakeEnv = () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const pads: (GamepadLike | null)[] = [];
  const env: BrowserInputEnv = { window: win, document: doc, navigator: { getGamepads: () => pads } };
  return { env, win };
};
const key = (type: 'keydown' | 'keyup', code: string) => Object.assign(new Event(type, { cancelable: true }), { code, repeat: false });

// 가짜 프레임 스케줄러 + 시계: frame(ms)가 시계를 옮기고 대기 중인 콜백을 모두 호출
class FakeFrames implements FrameScheduler {
  time = 0;
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
  get waiting(): number {
    return this.pending.size;
  }
  advance(ms: number, step = 16): void {
    for (let t = 0; t < ms; t += step) {
      this.time += step;
      const cbs = [...this.pending.values()];
      this.pending.clear();
      for (const cb of cbs) cb(this.time);
    }
  }
}

// 그리기 횟수를 세는 가짜 캔버스 (renderScene은 그릴 때마다 clearRect 1회)
const countingCtx = () => {
  const counter = { renders: 0 };
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'clearRect') return () => counter.renders++;
      return () => undefined;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, counter };
};

const setup = () => {
  const frames = new FakeFrames();
  const { env, win } = fakeEnv();
  const { ctx, counter } = countingCtx();
  const statuses: HarnessStatus[] = [];
  const h = new HarnessController({ ctx, env, scheduler: frames, now: () => frames.time, onStatus: s => statuses.push(s) });
  return { h, frames, win, counter, statuses };
};

describe('개발 하네스 (명세서 3.7, 08-7)', () => {
  it('A. 하네스 설정 (고정 제원, 간이 판정 함수)', () => {
    const { robot1, robot2 } = DEV_ROBOT_CONFIGS;
    const resolver = createDevResolver(robot1, robot2);
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const onAim = bearingTo(60, 130, aim.x, aim.y);
    assert(resolver('robot1', 'POLLEN', 60, 130, onAim, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, 'aimed (fixed shooter) -> 0.6');
    assert(resolver('robot1', 'NECTAR', 60, 130, onAim + (2.5 * Math.PI) / 180, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, 'within ±3° -> 0.6');
    assert(resolver('robot2', 'POLLEN', 60, 130, onAim + (5 * Math.PI) / 180, 'RED', 'AUDIENCE_CELL') === 0, 'off aim (5°) -> 0');
    const turret = createDevResolver({ ...robot1, turretType: 'TURRET', turretRange: [-Math.PI, Math.PI] }, robot2);
    assert(turret('robot1', 'POLLEN', 60, 130, onAim + 2, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, '360° turret aims anywhere -> 0.6');
    const e = createDevEngine('BLUE');
    assert(e.field.allianceColor === 'BLUE' && e.r1Config.name === 'DEV R1' && e.currentTick === 0, 'engine: default scenario of the chosen alliance');
  });

  it('B. 경기 흐름: 관중석 준비 → 회전 후 루프 시작 → 일시정지 / 재개 → 리셋 (반대 회전)', () => {
    const { h, frames, win, counter } = setup();
    frames.advance(16);
    assert(counter.renders >= 1 && h.status().phase === 'SETUP' && h.status().viewAngle === 0 && h.status().loopState === 'READY', 'setup screen drawn in the audience view, loop not started');
    h.setAlliance('BLUE');
    assert(h.status().alliance === 'BLUE', 'alliance selectable before the match');
    h.setAlliance('RED');

    h.start();
    frames.advance(VIEW_ANIMATION_MS - 60);
    const mid = h.status();
    assert(mid.phase === 'ROTATING_IN' && mid.loopState === 'READY' && mid.tick === 0, 'during the rotation: loop waits, no ticks (no driving while rotating)');
    assert(mid.viewAngle < 0 && mid.viewAngle > viewAngle('DRIVER', 'RED'), `rotating toward the RED driver view (${mid.viewAngle.toFixed(2)})`);
    frames.advance(120);
    const started = h.status();
    assert(started.phase === 'MATCH' && started.loopState === 'RUNNING' && started.viewAngle === viewAngle('DRIVER', 'RED'), 'rotation finished -> loop started in the driver view');
    h.setAlliance('BLUE');
    assert(h.status().alliance === 'RED', 'alliance locked during the match');

    // 실시간 진행 + 키보드(R2): RED 필드 기준 W = +x
    const t0 = h.status().tick;
    const r2x = h.currentFrame().r2.x;
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(1000, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    const running = h.status();
    assert(running.tick - t0 >= 45 && running.tick - t0 <= 51, `about 50 ticks per second (${running.tick - t0})`);
    assert(h.currentFrame().r2.x > r2x + 20 && h.currentFrame().r1.x === 9, `keyboard drives R2 (+x ${(h.currentFrame().r2.x - r2x).toFixed(1)} in), R1 (gamepad 0, not connected) stays`);
    assert(near(running.remainingSec, (6000 - running.tick) * 0.02), 'remaining time from the tick');

    // 일시정지: 틱 정지, 옵션 변경은 한 번 다시 그림
    h.pause();
    const pausedTick = h.status().tick;
    frames.advance(500);
    const before = counter.renders;
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, flightTrail: true });
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, aimGuide: true });
    frames.advance(16);
    assert(h.status().loopState === 'PAUSED' && h.status().tick === pausedTick && counter.renders - before === 1, 'paused: no ticks; two option changes -> one redraw');
    // 일시정지 중 보기 전환: 회전 애니메이션이 끝까지 그려짐
    h.setMatchView('AUDIENCE');
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().viewAngle === 0 && h.status().tick === pausedTick, 'view toggled to audience while paused (animated), still paused');
    h.resume();
    frames.advance(200, 20);
    assert(h.status().loopState === 'RUNNING' && h.status().tick > pausedTick, 'resumed');

    // 포커스 소실 → 자동 일시정지 (입력 어댑터 연결 확인)
    win.dispatchEvent(new Event('blur'));
    assert(h.status().loopState === 'PAUSED' && h.status().pauseReason === 'BLUR', 'window blur -> auto pause');

    // 리셋: 새 엔진 0틱, 관중석으로 반대 회전 → 준비 화면
    h.reset();
    const resetting = h.status();
    assert(resetting.phase === 'ROTATING_OUT' && resetting.tick === 0 && resetting.loopState === 'READY', 'reset: fresh match at tick 0');
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().phase === 'SETUP' && h.status().viewAngle === 0, 'rotated back to the audience view, setup screen');
    h.dispose();
    assert(frames.waiting === 0, 'dispose: no pending frames');
  });

  it('C. 드라이버 시점 BLUE / 관중석 경기 / 상태 알림 빈도', () => {
    const { h, frames, statuses } = setup();
    h.setAlliance('BLUE');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().viewAngle === viewAngle('DRIVER', 'BLUE'), 'BLUE driver view +90°');
    statuses.length = 0;
    frames.advance(2000, 16);
    assert(statuses.length >= 15 && statuses.length <= 25, `status updates throttled to ~10 Hz while running (${statuses.length} in 2 s)`);
    h.reset();
    frames.advance(VIEW_ANIMATION_MS + 50);
    h.setMatchView('AUDIENCE');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().phase === 'MATCH' && h.status().loopState === 'RUNNING' && h.status().viewAngle === 0, 'audience-view match: starts after the (no-rotation) transition');
    h.dispose();
  });
});
