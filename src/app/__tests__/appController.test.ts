import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, ScenarioConfig, ShotProbabilityResolver } from '../../core/types';
import type { BrowserInputEnv, GamepadLike } from '../../input/browserInput';
import { KEYBOARD_BINDINGS } from '../../input/inputConfig';
import type { FrameScheduler } from '../../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS } from '../../renderer/renderOptions';
import { VIEW_ANIMATION_MS, viewAngle } from '../../renderer/viewTransform';
import { AppController } from '../appController';
import type { AppStatus, MatchSetup } from '../appController';

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

// 테스트 경기 설정 (하네스와 독립: 하네스는 09-12에서 삭제)
const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, maxControlledPieces: 4, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05, flowerSetupDelay: 500, flowerDropDelay: 200,
});
let resolverCalls = 0;
const resolver: ShotProbabilityResolver = (robotId, pieceType) => {
  resolverCalls++;
  return robotId === 'robot1' ? (pieceType === 'POLLEN' ? 0.25 : 0.5) : 0.75;
};
const makeSetup = (alliance: 'RED' | 'BLUE', scenario: Partial<ScenarioConfig> = {}): MatchSetup => ({
  r1Config: cfg('robot1'),
  r2Config: cfg('robot2'),
  shotResolver: resolver,
  scenario: { allianceColor: alliance, ...scenario },
});

const setup = (initial: MatchSetup = makeSetup('RED')) => {
  const frames = new FakeFrames();
  const { env, win } = fakeEnv();
  const { ctx, counter } = countingCtx();
  const statuses: AppStatus[] = [];
  const h = new AppController({ ctx, setup: initial, env, scheduler: frames, now: () => frames.time, onStatus: s => statuses.push(s) });
  return { h, frames, win, counter, statuses };
};

describe('앱 컨트롤러 (명세서 3.8, 09-6c — 08-7 하네스 흐름 이전)', () => {
  it('B. 경기 흐름: 관중석 준비 → 회전 후 루프 시작 → 일시정지 / 재개 → 리셋 (반대 회전)', () => {
    const { h, frames, win, counter } = setup();
    frames.advance(16);
    assert(counter.renders >= 1 && h.status().phase === 'SETUP' && h.status().viewAngle === 0 && h.status().loopState === 'READY', 'setup screen drawn in the audience view, loop not started');
    assert(h.setSetup(makeSetup('BLUE')) && h.status().alliance === 'BLUE', 'setup (alliance) replaceable before the match');
    h.setSetup(makeSetup('RED'));

    h.start();
    frames.advance(VIEW_ANIMATION_MS - 60);
    const mid = h.status();
    assert(mid.phase === 'ROTATING_IN' && mid.loopState === 'READY' && mid.tick === 0, 'during the rotation: loop waits, no ticks (no driving while rotating)');
    assert(mid.viewAngle < 0 && mid.viewAngle > viewAngle('DRIVER', 'RED'), `rotating toward the RED driver view (${mid.viewAngle.toFixed(2)})`);
    frames.advance(120);
    const started = h.status();
    assert(started.phase === 'MATCH' && started.loopState === 'RUNNING' && started.viewAngle === viewAngle('DRIVER', 'RED'), 'rotation finished -> loop started in the driver view');
    assert(!h.setSetup(makeSetup('BLUE')) && h.status().alliance === 'RED', 'setup locked during the match');

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
    h.setSetup(makeSetup('BLUE'));
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

  it('D. 경기 설정 주입 / 상태 알림 (TIP / RP / 명중 확률)', () => {
    const { h, frames } = setup(makeSetup('RED', { autoTipCount: 2, r2Spawn: { x: 30, y: 100, heading: 0 } }));
    const s0 = h.status();
    assert(s0.autoTipCount === 2 && s0.tipCount === 0 && s0.score === 0 && !s0.rp.swarm && !s0.rp.pollinator1, 'TIP counts (auto / teleop), score, RP from the frame');
    assert(h.currentFrame().r2.x === 30 && h.currentFrame().tick === 0, 'engine built from the injected scenario');
    // 명중 확률: 옵션이 꺼져 있으면 null (판정 함수 호출 없음), 켜면 상태마다 로봇 2 × 기물 2 = 4회
    resolverCalls = 0;
    assert(h.status().hitProbability === null && resolverCalls === 0, 'hit probability off -> null, resolver not called');
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, hitProbability: true });
    resolverCalls = 0;
    const hp = h.status().hitProbability;
    assert(!!hp && resolverCalls === 4 && hp.robot1.POLLEN === 0.25 && hp.robot1.NECTAR === 0.5 && hp.robot2.POLLEN === 0.75 && hp.robot1.next === 'POLLEN', `hit probability on -> 4 resolver calls (${resolverCalls}), values from the injected resolver`);
    // 경기 전 설정 교체: 새 0틱 엔진, 진영 / 시작 자세 반영
    assert(h.setSetup(makeSetup('BLUE', { r1Spawn: { x: 120, y: 40, heading: Math.PI } })), 'setup accepted in SETUP');
    assert(h.status().alliance === 'BLUE' && h.currentFrame().r1.x === 120 && h.status().autoTipCount === 0, 'new engine from the replaced setup');
    // 경기 중에는 거부, 리셋은 같은 설정으로 0틱
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    frames.advance(500, 20);
    assert(h.status().tick > 0 && !h.setSetup(makeSetup('RED')) && h.status().alliance === 'BLUE', 'setup rejected during the match');
    h.reset();
    assert(h.status().tick === 0 && h.currentFrame().r1.x === 120 && h.status().alliance === 'BLUE', 'reset keeps the current setup');
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().phase === 'SETUP' && h.setSetup(makeSetup('RED')), 'back in SETUP: setup replaceable again');
    h.dispose();
  });
});
