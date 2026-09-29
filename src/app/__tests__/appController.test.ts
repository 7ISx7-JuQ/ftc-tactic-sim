import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, ScenarioConfig, ShotProbabilityResolver } from '../../core/types';
import type { BrowserInputEnv, GamepadLike } from '../../input/browserInput';
import { KEYBOARD_BINDINGS } from '../../input/inputConfig';
import type { FrameScheduler } from '../../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS } from '../../renderer/renderOptions';
import { VIEW_ANIMATION_MS, viewAngle } from '../../renderer/viewTransform';
import { MATCH_TICKS } from '../../core/simulationEngine';
import { AppController, END_HIGHLIGHT_MS, LIFT_TOAST_COOLDOWN_MS } from '../appController';
import type { AppStatus, LiftToast, MatchSetup } from '../appController';

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
const key = (type: 'keydown' | 'keyup', code: string, shiftKey = false) => Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, shiftKey });
// 단축키 1회 누름 (keydown + keyup)
const press = (win: EventTarget, code: string, shiftKey = false) => {
  const down = key('keydown', code, shiftKey);
  win.dispatchEvent(down);
  win.dispatchEvent(key('keyup', code, shiftKey));
  return down.defaultPrevented;
};

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
  const toasts: LiftToast[] = [];
  const h = new AppController({ ctx, setup: initial, env, scheduler: frames, now: () => frames.time, onStatus: s => statuses.push(s), onToast: t => toasts.push(t) });
  return { h, frames, win, counter, statuses, toasts };
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

  it('E. 보는 틱 / 재생 / 재개 · 분기 / 단축키 (09-7a)', () => {
    const { h, frames, win } = setup();
    assert(press(win, 'Space') && h.status().phase === 'SETUP', 'Space before the match: default prevented, nothing else (START only by the button)');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    // R2를 1초 몰고(W) 1초 정지 → 기록 약 100틱
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(1000, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    frames.advance(1000, 20);
    assert(press(win, 'Space') && h.status().loopState === 'PAUSED' && h.status().pauseReason === 'USER', 'Space while running -> pause (default prevented)');
    const head = h.status().headTick;
    const drivenX = h.currentFrame().r2.x;
    let s = h.status();
    assert(s.tick === head && s.canResume && !s.canBranch && s.canScrub && !s.matchEnded, 'paused at the head: RESUME possible, no BRANCH');

    // 틱 이동: ← 1틱, Shift + ← 50틱, → 가 머리를 넘지 않음. 엔진 기록 / 현재 틱은 그대로
    assert(press(win, 'ArrowLeft') && h.status().tick === head - 1, '← : back 1 tick');
    press(win, 'ArrowLeft', true);
    assert(h.status().tick === head - 51 && h.currentFrame().tick === head - 51, 'Shift + ← : back 1 s (50 ticks), the drawn frame follows the view tick');
    s = h.status();
    assert(!s.canResume && s.canBranch && s.headTick === head, 'rewound: RESUME not possible, BRANCH possible, head unchanged');
    h.resume();
    assert(h.status().loopState === 'PAUSED' && h.status().tick === head - 51, 'resume ignored away from the head');
    h.stepView(10_000);
    assert(h.status().tick === head, 'stepping forward clamps to the head');
    h.setViewTick(-5);
    assert(h.status().tick === 0, 'view tick clamps to 0');

    // 재생: Space = 재생(분기하지 않음), 1× 약 50틱/초, 2×, 머리에서 자동 정지 → RESUME 가능
    assert(press(win, 'Space') && h.status().playing && h.status().loopState === 'PAUSED', 'Space away from the head -> playback (never a branch)');
    frames.advance(500, 20);
    const at1x = h.status().tick;
    assert(at1x >= 22 && at1x <= 26, `1x playback ≈ 25 ticks in 0.5 s (${at1x})`);
    h.setPlaybackSpeed(2);
    frames.advance(500, 20);
    const at2x = h.status().tick - at1x;
    assert(at2x >= 47 && at2x <= 52 && h.status().playbackSpeed === 2, `2x playback ≈ 50 ticks in 0.5 s (${at2x})`);
    assert(press(win, 'Space') && !h.status().playing, 'Space during playback -> stop');
    const stoppedAt = h.status().tick;
    frames.advance(300, 20);
    assert(h.status().tick === stoppedAt, 'stopped playback holds the view tick');
    h.play();
    frames.advance(3000, 20);
    s = h.status();
    assert(!s.playing && s.tick === head && s.canResume && s.headTick === head, 'playback stops at the last recorded tick -> RESUME possible, record unchanged');
    h.play();
    assert(h.status().playing && h.status().tick === 0, 'play at the head restarts from tick 0');
    h.stepView(1);
    assert(!h.status().playing && h.status().tick === 1, 'stepping stops playback');

    // 분기: 되감은 틱(주행 전)부터 다시 진행 → 이후 기록 폐기, 새 입력(정지)으로 다른 결과
    h.setViewTick(20);
    const branchX = h.currentFrame().r2.x;
    h.branch();
    s = h.status();
    assert(s.loopState === 'RUNNING' && !s.playing && s.endStage === 'NONE', 'branch -> running from the view tick');
    frames.advance(2000, 20);
    h.pause();
    s = h.status();
    const branchedX = h.currentFrame().r2.x;
    assert(s.headTick === s.tick && s.headTick > 60 && branchedX < drivenX - 20 && branchedX >= branchX, `branched run replaced the record (R2 stopped driving at tick 20: ${branchedX.toFixed(1)} vs driven ${drivenX.toFixed(1)})`);
    h.setViewTick(10_000);
    assert(h.status().tick === s.headTick, 'old frames after the branch point are gone (head = new head)');

    // 단축키 끔 (확인창 / 팝업): Space 무시
    h.setShortcutsEnabled(false);
    assert(!press(win, 'Space') && h.status().loopState === 'PAUSED', 'shortcuts disabled -> Space ignored');
    h.setShortcutsEnabled(true);
    press(win, 'Space');
    assert(h.status().loopState === 'RUNNING', 'Space at the head -> resume');
    // 진행 중 ←는 R2 회전(입력 어댑터)이고 보는 틱 이동이 아님
    const tickBefore = h.status().tick;
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    frames.advance(200, 20);
    win.dispatchEvent(key('keyup', 'ArrowLeft'));
    assert(h.status().tick > tickBefore && h.status().loopState === 'RUNNING', '← while running drives (no scrubbing)');
    h.dispose();
    assert(frames.waiting === 0, 'dispose: no pending frames');
  });

  it('F. 경기 종료 → 종료 강조 5초 → 결과 → 복기 / 다시 열기 / 종료 후 분기 / NEW', () => {
    const { h, frames, win } = setup();
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    // 100 ms 프레임 = 5틱 (따라잡기 상한) → 6000틱에서 멈출 때까지
    for (let i = 0; i < 1300 && h.status().loopState !== 'ENDED'; i++) frames.advance(100, 100);
    let s = h.status();
    assert(s.loopState === 'ENDED' && s.matchEnded && s.headTick === MATCH_TICKS && s.tick === MATCH_TICKS, 'match reached tick 6000');
    assert(s.endStage === 'HIGHLIGHT' && !s.canScrub && !s.canResume && !s.canBranch && !!s.result, 'end highlight: controls locked, result ready');
    const r = s.result!;
    const b = r.breakdown;
    assert(r.total === b.hive + b.flower + b.garden + b.park && r.total === s.score, 'result total = breakdown sum = final score');

    // 5초 대기 후 결과 팝업 (Space로 건너뛰기는 아래 분기 뒤에서 확인)
    frames.advance(END_HIGHLIGHT_MS - 200, 20);
    assert(h.status().endStage === 'HIGHLIGHT', 'still highlighting before 5 s');
    frames.advance(400, 20);
    assert(h.status().endStage === 'RESULT', 'result popup after 5 s');
    press(win, 'Space');
    press(win, 'ArrowLeft');
    assert(h.status().endStage === 'RESULT' && h.status().tick === MATCH_TICKS && !h.status().playing, 'result popup: Space / arrows ignored');

    // 복기: RESUME 없음, 마지막 틱에서 Space = 처음부터 재생, RESULT로 다시 열기
    h.closeResult();
    s = h.status();
    assert(s.endStage === 'REVIEW' && s.canScrub && !s.canResume && !s.canBranch, 'review: no RESUME, no BRANCH at the end tick');
    press(win, 'Space');
    assert(h.status().playing && h.status().tick === 0, 'Space at the end tick -> playback from the start');
    frames.advance(200, 20);
    h.openResult();
    assert(h.status().endStage === 'RESULT' && !h.status().playing, 'RESULT reopens the popup (playback stopped)');
    h.closeResult();

    // 종료 후 분기: 종료 전 틱으로 되감으면 BRANCH → 다시 끝까지 → 다시 종료 강조 (Space로 건너뛰기)
    h.setViewTick(MATCH_TICKS - 100);
    assert(h.status().canBranch, 'rewound after the end: BRANCH possible');
    h.branch();
    assert(h.status().loopState === 'RUNNING' && h.status().endStage === 'NONE' && !h.status().matchEnded, 'branch after the end -> running again');
    frames.advance(2500, 20);
    assert(h.status().loopState === 'ENDED' && h.status().endStage === 'HIGHLIGHT', 'branched run ended -> highlight again');
    h.skipHighlight();
    assert(h.status().endStage === 'RESULT', 'click (skipHighlight) skips the 5 s wait');
    h.closeResult();
    h.setViewTick(MATCH_TICKS - 100);
    h.branch();
    frames.advance(2500, 20);
    assert(press(win, 'Space') && h.status().endStage === 'RESULT', 'Space skips the 5 s wait');

    // NEW: 새 0틱 경기, 종료 단계 초기화
    h.closeResult();
    h.reset();
    s = h.status();
    assert(s.phase === 'ROTATING_OUT' && s.tick === 0 && s.headTick === 0 && s.endStage === 'NONE' && !s.playing && s.result === null, 'NEW -> fresh match, end stage cleared');
    h.dispose();
  });

  it('G. 경고 토스트 (리프트 중 주행 입력, 로봇당 2초에 한 번) / 자동 일시정지 배너 사유 (09-7b)', () => {
    const { h, frames, win, toasts } = setup();
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    // R2 리프트 올림 (기본 시작 자리에서 투입 가능) → 올리는 중 / 올린 채 대기에서 W → R2 경고 1회, 누르고 있어도 2초 안에는 다시 없음
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.lift));
    frames.advance(60, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.lift));
    frames.advance(200, 20);
    const lift = h.currentFrame().r2.actionState;
    assert(lift === 'FLOWER_SETUP' || lift === 'FLOWER_READY', `R2 lift raised (${lift})`);
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(100, 20);
    assert(toasts.length === 1 && toasts[0].robot === 'robot2', 'drive input while lifted -> toast for R2');
    frames.advance(LIFT_TOAST_COOLDOWN_MS - 300, 20);
    assert(toasts.length === 1, 'same robot: no repeat within 2 s while holding');
    frames.advance(400, 20);
    assert(toasts.length === 2, 'after 2 s: toast again while still holding');
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    frames.advance(LIFT_TOAST_COOLDOWN_MS + 200, 20);
    assert(toasts.length === 2, 'no drive input: no toast even in the lift state');
    // 리프트를 내린 뒤의 주행은 경고 없음
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.lift));
    frames.advance(60, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.lift));
    frames.advance(1500, 20);
    assert(h.currentFrame().r2.actionState === 'IDLE', `lift lowered (${h.currentFrame().r2.actionState})`);
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(500, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    assert(toasts.length === 2 && h.currentFrame().r2.x > 10, 'driving outside the lift states: no toast');

    // 자동 일시정지 배너: 포커스 소실 → 사유 표시, 재개하면 사라짐. 사용자 일시정지는 배너 없음
    win.dispatchEvent(new Event('blur'));
    assert(h.status().loopState === 'PAUSED' && h.status().autoPauseReason === 'BLUR', 'window blur -> banner reason BLUR');
    h.stepView(-10);
    assert(h.status().autoPauseReason === 'BLUR', 'scrubbing keeps the banner');
    h.play();
    assert(h.status().autoPauseReason === null, 'playback start clears the banner');
    h.stopPlayback();
    h.stepView(10_000);
    h.resume();
    assert(h.status().loopState === 'RUNNING' && h.status().autoPauseReason === null, 'resume: no banner');
    h.pause();
    assert(h.status().autoPauseReason === null && h.status().pauseReason === 'USER', 'user pause: no banner');
    h.resume();
    win.dispatchEvent(new Event('blur'));
    h.stepView(-10);
    h.branch();
    assert(h.status().loopState === 'RUNNING' && h.status().autoPauseReason === null, 'branch clears the banner');
    win.dispatchEvent(new Event('blur'));
    h.reset();
    assert(h.status().autoPauseReason === null, 'NEW clears the banner');
    h.dispose();
  });
});
