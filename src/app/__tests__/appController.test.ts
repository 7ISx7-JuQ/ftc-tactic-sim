import { describe, expect, it, vi } from 'vitest';
import { fixedRateShotJudge } from '../../core/ballistics';
import { createIntakeZonePreset } from '../../core/collision';
import type { DeepReadonly, RobotConfig, ScenarioConfig, ShotProbabilityResolver, TimelineFrame } from '../../core/types';
import type { BrowserInputEnv, GamepadLike } from '../../input/browserInput';
import { DEFAULT_GAMEPAD_MAPPING, DEVICE_ASSIGNMENT, KEYBOARD_BINDINGS, swapAssignment } from '../../input/inputConfig';
import type { FrameScheduler } from '../../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS } from '../../renderer/renderOptions';
import { VIEW_ANIMATION_MS, viewAngle } from '../../renderer/viewTransform';
import { MATCH_TICKS, SimulationEngine } from '../../core/simulationEngine';
import { createInputRecordProvider } from '../../input/inputLog';
import { AppController, END_HIGHLIGHT_MS, LIFT_TOAST_COOLDOWN_MS } from '../appController';
import { buildMatchRecipe, recipeLoadTree } from '../matchRecipe';
import { MAX_BRANCHES } from '../branchTree';
import { compareCheckpoints, frameChecksum, timelineCheckpoints } from '../../core/checksum';
import { DEFAULT_DRAFT_VALUES } from '../defaultSetup';
import type { AppStatus, LiftToast, MatchSetup } from '../appController';
import type { EditScene } from '../../renderer/editSceneRenderer';
import type { ScenePaths } from '../../renderer/robotPath';

// 편집 모드 장면 그리기 기록 (09-10b): 실제 그리기 대신 받은 장면만 모음
const editRenders = vi.hoisted(() => [] as unknown[]);
vi.mock('../../renderer/editSceneRenderer', () => ({ renderEditScene: (_ctx: unknown, scene: unknown) => editRenders.push(scene) }));
// 경기 장면 기록 (16-3 로봇 동선): 실제로 그리면서 받은 장면도 모음
const sceneRenders = vi.hoisted(() => [] as { paths?: ScenePaths | null; frame: { tick: number }; tickOffset?: number }[]);
vi.mock('../../renderer/sceneRenderer', async importOriginal => {
  const actual = await importOriginal<typeof import('../../renderer/sceneRenderer')>();
  return {
    ...actual,
    renderScene: (...args: Parameters<typeof actual.renderScene>) => {
      sceneRenders.push(args[1]);
      actual.renderScene(...args);
    },
  };
});

const NO_KEYBOARD = { ...DEVICE_ASSIGNMENT, keyboard: null };
// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;
// 지금 가지의 체크포인트 (보는 틱을 옮겨 읽고 되돌림, 일시정지 / 복기 중에만)
const viewCheckpoints = (h: AppController): string[] => {
  const { tick, headTick } = h.status();
  const out: string[] = [];
  for (let t = 0; t <= headTick; t += 50) {
    h.setViewTick(t);
    out.push(frameChecksum(h.currentFrame()));
  }
  h.setViewTick(tick);
  return out;
};
// 풀매치를 재계산 / 진행하는 테스트(J, K)의 제한 시간 (기본 5초는 전체 병렬 실행 부하에서 부족, 다른 풀매치 테스트와 같은 값)
const FULL_MATCH_TIMEOUT_MS = 120_000;

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
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], flowerSetupDelay: 500, flowerDropDelay: 200,
  shooterSetup: 'SHARED', nectarShooter: { shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0] }, flowerDropZones: [], liftMaxSpeed: 0,
});
let resolverCalls = 0;
const resolver: ShotProbabilityResolver = (robotId, pieceType) => {
  resolverCalls++;
  return robotId === 'robot1' ? (pieceType === 'POLLEN' ? 0.25 : 0.5) : 0.75;
};
const makeSetup = (alliance: 'RED' | 'BLUE', scenario: Partial<ScenarioConfig> = {}): MatchSetup => ({
  r1Config: cfg('robot1'),
  r2Config: cfg('robot2'),
  shotJudge: fixedRateShotJudge(({ robotId, pieceType }) => (robotId === 'robot1' ? (pieceType === 'POLLEN' ? 0.25 : 0.5) : 0.75)),
  hitRate: resolver,
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
    assert(h.status().matchView === 'DRIVER', '(09-8b) VIEW ignored before the match: the start view comes from the default view');
    h.setDefaultView('AUDIENCE');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().phase === 'MATCH' && h.status().loopState === 'RUNNING' && h.status().viewAngle === 0, 'audience-view match (default view AUDIENCE): starts after the (no-rotation) transition');
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
    assert(h.setSetup(makeSetup('BLUE', { r1Spawn: { x: 120, y: 70, heading: Math.PI } })), 'setup accepted in SETUP');
    assert(h.status().alliance === 'BLUE' && h.currentFrame().r1.x === 120 && h.status().autoTipCount === 0, 'new engine from the replaced setup');
    // 14-3: RP 기준값 = 이 경기 시나리오 값 (없거나 틀리면 엔진처럼 기본값)
    assert(JSON.stringify(s0.rpThresholds) === JSON.stringify({ swarmPoints: 16, pollinator1Tips: 4, pollinator2Tips: 7 }), 'default RP thresholds in the status');
    const custom = { swarmPoints: 13, pollinator1Tips: 3, pollinator2Tips: 5 };
    assert(h.setSetup(makeSetup('BLUE', { r1Spawn: { x: 120, y: 70, heading: Math.PI }, rpThresholds: custom })) && JSON.stringify(h.status().rpThresholds) === JSON.stringify(custom), 'scenario RP thresholds in the status');
    assert(h.setSetup(makeSetup('BLUE', { r1Spawn: { x: 120, y: 70, heading: Math.PI }, rpThresholds: { swarmPoints: 13, pollinator1Tips: 6, pollinator2Tips: 5 } })) && h.status().rpThresholds.pollinator1Tips === 4, 'invalid thresholds -> engine defaults');
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
    assert(s.endSeq === 1, 'end signal (endSeq) once at the real end (09-7c)');
    const r = s.result!;
    const b = r.breakdown;
    assert(r.total === b.hive + b.flower + b.garden + b.park && r.total === s.score, 'result total = breakdown sum = final score');
    // 14-3: RP 카드 재료 = 이 경기 기준값 + 오토 이동 점수 (기본 LEAVE · LEAVE = 6)
    assert(r.thresholds.swarmPoints === 16 && r.thresholds.pollinator2Tips === 7 && r.autoMovementPoints === 6, 'result carries thresholds / auto movement points');
    assert(r.rp.swarm === r.autoMovementPoints + b.park >= r.thresholds.swarmPoints, 'SWARM = auto movement + TELEOP PARK >= threshold');

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
    frames.advance(130_000, 100); // 재생이 마지막 틱까지 가도 종료 연출 신호는 그대로
    assert(!h.status().playing && h.status().tick === MATCH_TICKS && h.status().endSeq === 1 && h.status().endStage === 'REVIEW', 'playback reaching the end tick: no new end signal');
    h.openResult();
    assert(h.status().endStage === 'RESULT' && !h.status().playing, 'RESULT reopens the popup (playback stopped)');
    h.closeResult();

    // 종료 후 분기: 종료 전 틱으로 되감으면 BRANCH → 다시 끝까지 → 다시 종료 강조 (Space로 건너뛰기)
    h.setViewTick(MATCH_TICKS - 100);
    assert(h.status().canBranch, 'rewound after the end: BRANCH possible');
    h.branch();
    assert(h.status().loopState === 'RUNNING' && h.status().endStage === 'NONE' && !h.status().matchEnded, 'branch after the end -> running again');
    frames.advance(2500, 20);
    assert(h.status().loopState === 'ENDED' && h.status().endStage === 'HIGHLIGHT' && h.status().endSeq === 2, 'branched run ended -> highlight + end signal again');
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
    assert(s.phase === 'ROTATING_OUT' && s.tick === 0 && s.headTick === 0 && s.endStage === 'NONE' && !s.playing && s.result === null && s.endSeq === 0, 'NEW -> fresh match, end stage / end signal cleared');
    h.dispose();
  });

  it('F2. (16-1) 결과 팝업 가지 비교 → 종료한 가지로 전환: 팝업 유지 · 그 가지의 결과, 미종료 / 지금 가지 / 종료 강조 중은 거부, 종료 신호 불변', () => {
    const { h, frames, win } = setup();
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    for (let i = 0; i < 1300 && h.status().loopState !== 'ENDED'; i++) frames.advance(100, 100);
    h.skipHighlight();
    h.closeResult();
    h.setViewTick(MATCH_TICKS);
    const rootEnd = JSON.stringify(h.currentFrame());
    const rootTotal = h.status().result!.total;

    // 가지 2: 종료 100틱 전에서 갈라 R2(키보드) 전진 → 다시 종료 (종료 강조 중에는 전환 불가)
    h.setViewTick(MATCH_TICKS - 100);
    h.branch();
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(2500, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    let s = h.status();
    assert(s.endStage === 'HIGHLIGHT' && s.endSeq === 2 && !h.switchBranch(1), 'highlight: switch refused');
    h.skipHighlight();
    const sideEnd = JSON.stringify(h.currentFrame());
    assert(sideEnd !== rootEnd, 'branch 2 ends in a different state');

    // 가지 3: 미종료 (원본 100틱에서 갈라 잠깐 진행)
    h.closeResult();
    h.switchBranch(1);
    h.setViewTick(100);
    h.branch();
    frames.advance(200, 20);
    h.pause();
    const b3 = h.status().currentBranchId;

    // 가지 2로 돌아가 결과 팝업 → 원본으로 전환 = 팝업 유지, 원본 결과 / 종료 프레임
    h.switchBranch(2);
    h.setViewTick(MATCH_TICKS);
    h.openResult();
    assert(!h.switchBranch(b3) && h.status().currentBranchId === 2, 'result popup: unfinished branch refused');
    assert(!h.switchBranch(2), 'result popup: current branch refused');
    assert(h.switchBranch(1), 'result popup: switch to the ended root');
    s = h.status();
    assert(s.endStage === 'RESULT' && s.currentBranchId === 1 && s.tick === MATCH_TICKS && s.endSeq === 2, 'popup stays open on the root, no new end signal');
    assert(JSON.stringify(h.currentFrame()) === rootEnd && s.result!.total === rootTotal, 'root end frame / result');
    assert(h.switchBranch(2) && JSON.stringify(h.currentFrame()) === sideEnd && h.status().endStage === 'RESULT', 'and back to branch 2');

    // 팝업 닫기 = 그 가지 복기
    h.closeResult();
    s = h.status();
    assert(s.endStage === 'REVIEW' && s.currentBranchId === 2 && s.canScrub, 'close -> review of branch 2');
    h.dispose();
  }, FULL_MATCH_TIMEOUT_MS);

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

  it('G2. (12-8) 리프트 상태 주행이 켜진 로봇은 리프트 중 주행해도 경고 토스트 없음 (움직임)', () => {
    const { h, frames, win, toasts } = setup({ ...makeSetup('RED'), r2Config: { ...cfg('robot2'), liftMaxSpeed: 30 } });
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.lift));
    frames.advance(60, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.lift));
    frames.advance(200, 20);
    const lift = h.currentFrame().r2.actionState;
    assert(lift === 'FLOWER_SETUP' || lift === 'FLOWER_READY', `R2 lift raised (${lift})`);
    const x0 = h.currentFrame().r2.x;
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(500, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    const f = h.currentFrame().r2;
    assert(toasts.length === 0 && (f.actionState === 'FLOWER_READY' || f.actionState === 'FLOWER_SETUP') && f.x > x0 + 1, `drives with the lift up, no toast (x ${x0.toFixed(1)} -> ${f.x.toFixed(1)})`);
    h.dispose();
  });

  it('H. 입력 출처 / 조작 모드 / 키보드 배정 / 기본 보기 (09-8b): 다음 START · RESUME · BRANCH부터, 녹화 덧입히기', () => {
    const { h, frames, win } = setup();
    // 경기 전: AUTO 예상 (패드 없음 + 키보드 켬 → R1 NONE, R2 LIVE), REPLAY / 진행 중 선택 불가
    let input = h.status().input;
    assert(input.choices.robot1 === 'AUTO' && input.autoPreview.robot1 === 'NONE' && input.autoPreview.robot2 === 'LIVE', 'AUTO preview before the match');
    assert(!h.setSourceChoice('robot2', 'REPLAY'), 'REPLAY not selectable before the match');
    // 키보드 배정을 없애면 AUTO 예상도 바뀜 (R2 → NONE), 다시 배정
    h.setAssignment(NO_KEYBOARD);
    assert(h.status().input.autoPreview.robot2 === 'NONE', 'keyboard None -> R2 AUTO resolves to NONE');
    h.setAssignment(DEVICE_ASSIGNMENT);
    // 기본 보기 AUTO → 시작하면 관중석에서 회전 없음
    h.setDefaultView('AUDIENCE');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    input = h.status().input;
    assert(h.status().viewAngle === 0 && input.sources.robot1 === 'NONE' && input.sources.robot2 === 'LIVE' && input.choices.robot2 === 'LIVE', 'START resolves AUTO (R1 NONE, R2 LIVE) in the default view');
    assert(!h.setSourceChoice('robot2', 'NONE'), 'source change refused while running');

    // 1회차: R2 키보드로 1초 주행 → 일시정지
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(1000, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    frames.advance(500, 20);
    h.pause();
    const firstRunTick = h.status().tick;
    const firstRunX = h.currentFrame().r2.x;
    assert(firstRunX > 20, `first run: R2 driven by keyboard (${firstRunX.toFixed(1)})`);

    // 경기 중 선택: AUTO 불가, REPLAY는 입력 기록이 있는 로봇만 (R1은 NONE이라 기록 없음)
    assert(!h.setSourceChoice('robot2', 'AUTO'), 'AUTO not selectable during the match');
    assert(!h.status().input.hasLog.robot1 && !h.setSourceChoice('robot1', 'REPLAY'), 'R1 (NONE) has no input log -> REPLAY refused');
    assert(h.setSourceChoice('robot2', 'REPLAY') && h.status().input.choices.robot2 === 'REPLAY' && h.status().input.sources.robot2 === 'LIVE', 'REPLAY chosen, applied only from the next resume / branch');

    // 녹화 덧입히기: 0틱으로 되감아 분기 → R2는 키를 누르지 않아도 기록대로 같은 궤적
    h.setViewTick(0);
    h.branch();
    assert(h.status().input.sources.robot2 === 'REPLAY', 'branch applies REPLAY');
    frames.advance(3000, 20);
    h.pause();
    h.setViewTick(firstRunTick);
    assert(h.currentFrame().r2.x === firstRunX, `REPLAY reproduces the recorded drive exactly (${h.currentFrame().r2.x.toFixed(3)} vs ${firstRunX.toFixed(3)})`);

    // 조작 모드 / 키보드 끄기: 재개부터 적용 → 키보드로 R2가 움직이지 않음
    h.stepView(10_000);
    h.setSourceChoice('robot2', 'LIVE');
    h.setDriveMode('robot2', 'ROBOT');
    h.setAssignment(NO_KEYBOARD);
    input = h.status().input;
    assert(input.modes.robot2 === 'ROBOT' && input.activeModes.robot2 === 'FIELD' && input.assignment.keyboard === null && input.activeAssignment.keyboard === 'robot2', 'mode / assignment pending until resume');
    h.resume();
    input = h.status().input;
    assert(input.activeModes.robot2 === 'ROBOT' && input.activeAssignment.keyboard === null && input.sources.robot2 === 'LIVE', 'resume applies mode / assignment / source');
    const xBefore = h.currentFrame().r2.x;
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(600, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    assert(Math.abs(h.currentFrame().r2.x - xBefore) < 1e-9, 'keyboard driving off: W does nothing');
    // 경기 중 VIEW는 그 경기에서만: 드라이버로 바꾼 뒤 NEW → 다음 시작은 기본 보기(관중석)
    h.setMatchView('DRIVER');
    frames.advance(VIEW_ANIMATION_MS + 50);
    h.reset();
    frames.advance(VIEW_ANIMATION_MS + 50);
    input = h.status().input;
    assert(h.status().phase === 'SETUP' && h.status().matchView === 'AUDIENCE' && input.choices.robot2 === 'AUTO', 'NEW: view back to the default, choices back to the pre-match choices');
    h.dispose();
  });

  it('H4. (18-2) 장치 배정: 경기 전에는 바로 적용(장치 표시 / AUTO 예상), 경기 중에는 다음 재개부터 — 바꾸기 후 키보드가 R1을 조종', () => {
    const { h, frames, win } = setup();
    const swapped = swapAssignment(DEVICE_ASSIGNMENT);
    h.setAssignment(swapped);
    let st = h.status();
    assert(st.gamepads[0].robot === 'robot2' && st.gamepads[1].robot === 'robot1' && st.input.activeAssignment.keyboard === 'robot1', 'before the match: applied at once (pad status follows)');
    assert(st.input.autoPreview.robot1 === 'LIVE' && st.input.autoPreview.robot2 === 'NONE', 'AUTO preview: keyboard now drives R1');
    h.setAssignment(DEVICE_ASSIGNMENT);
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    h.pause();
    h.setAssignment(swapped);
    st = h.status();
    assert(st.input.assignment.keyboard === 'robot1' && st.input.activeAssignment.keyboard === 'robot2' && st.gamepads[0].robot === 'robot1', 'paused: pending until resume (pad status = applied)');
    h.setSourceChoice('robot1', 'LIVE');
    h.resume();
    const [r1x, r2x] = [h.currentFrame().r1.x, h.currentFrame().r2.x];
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(800, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    st = h.status();
    assert(st.input.activeAssignment.keyboard === 'robot1' && st.gamepads[0].robot === 'robot2', 'resume applies the swap');
    assert(h.currentFrame().r1.x > r1x + 5 && Math.abs(h.currentFrame().r2.x - r2x) < 1e-9, 'W drives R1 after the swap, R2 stays');
    // (18-3) 게임패드 매핑: 적용 시점은 배정과 같음 (경기 중 = 다음 재개부터)
    h.pause();
    const edited = { 0: { ...DEFAULT_GAMEPAD_MAPPING, swapSticks: true }, 1: DEFAULT_GAMEPAD_MAPPING };
    h.setGamepadMappings(edited);
    st = h.status();
    assert(st.input.mappings[0].swapSticks && !st.input.activeMappings[0].swapSticks, 'mapping pending until resume');
    h.resume();
    assert(h.status().input.activeMappings[0].swapSticks, 'resume applies the mapping');
    assert(h.gamepadButtons(0) === null, 'no pad connected -> raw buttons null');
    h.dispose();
  });

  it('H2. (16-3) 로봇 동선: 표시 옵션이 켜져 있고 진행 중이 아닐 때만 장면에 지금 가지의 동선 (보는 틱에서 나뉨)', () => {
    const { h, frames, win } = setup();
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, robotPath: true });
    const lastPaths = () => {
      frames.advance(16);
      return sceneRenders.at(-1)!.paths ?? null;
    };
    assert(lastPaths() === null, 'before the match: no paths');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(1000, 20);
    assert(h.status().loopState === 'RUNNING' && lastPaths() === null, 'running: no paths');
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    h.pause();
    const head = h.status().headTick;
    let paths = lastPaths()!;
    const at = () => ({ x: h.currentFrame().r2.x, y: h.currentFrame().r2.y });
    assert(!!paths && JSON.stringify(paths.robot2.past.at(-1)) === JSON.stringify(at()) && paths.robot2.future.length === 1, `paused at the head (${head}): path up to the robot, nothing ahead`);
    assert(paths.robot2.past.length > 2, 'R2 (keyboard) drove: a real path');
    h.setViewTick(10);
    paths = lastPaths()!;
    assert(JSON.stringify(paths.robot2.past.at(-1)) === JSON.stringify(at()) && paths.robot2.future.length > 2 && sceneRenders.at(-1)!.frame.tick === 10, 'rewound: split at the viewed tick');
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, robotPath: false });
    assert(lastPaths() === null, 'option off: no paths');
    h.dispose();
  });

  it('H3. (17-1a / 17-1b) 프레임 보간: 진행 중 = 부드러운 움직임 켜짐일 때만 머리 − 1 ~ 머리, 재생 = 항상 보는 틱 ~ 다음 틱, 멈추면 정수 틱 (틱 안 시간 함께)', () => {
    const { h, frames, win } = setup();
    const engine = (h as unknown as { engine: SimulationEngine }).engine;
    const drawn = () => sceneRenders.at(-1)!.frame as unknown as DeepReadonly<TimelineFrame>;
    const offset = () => sceneRenders.at(-1)!.tickOffset ?? 0;
    // 그린 R2 위치가 두 틱 프레임 사이(양 끝 포함)인지
    const between = (f: DeepReadonly<TimelineFrame>, t0: number, t1: number) => {
      const [a, b] = [engine.getFrame(t0)!.r2, engine.getFrame(t1)!.r2];
      return f.r2.x >= Math.min(a.x, b.x) - 1e-9 && f.r2.x <= Math.max(a.x, b.x) + 1e-9 && f.r2.y >= Math.min(a.y, b.y) - 1e-9 && f.r2.y <= Math.max(a.y, b.y) + 1e-9;
    };
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.right));
    frames.advance(500, 16);
    for (let i = 0; i < 20; i++) {
      frames.advance(16, 16);
      assert(drawn() === h.currentFrame() && offset() === 0, 'smooth motion off (controller default): running draws the head frame');
    }
    h.pause();
    h.setSmoothMotion(true);
    frames.advance(16);
    assert(drawn() === h.currentFrame(), 'paused: the head frame');
    h.resume();
    const resumedAt = h.status().headTick;
    frames.advance(16, 16);
    assert(h.status().headTick === resumedAt && drawn() === h.currentFrame(), 'first frame after resume (no tick yet): the head frame, not one tick back');
    let interpolated = 0;
    for (let i = 0; i < 30; i++) {
      frames.advance(16, 16);
      const head = h.status().headTick;
      const f = drawn();
      assert(f.tick === head && between(f, head - 1, head), `running: robot between head − 1 and head (${head})`);
      if (head === resumedAt) {
        assert(f === h.currentFrame() && offset() === 0, 'still no tick consumed since resume: the head frame');
        continue;
      }
      assert(f.field.flowers === h.currentFrame().field.flowers && offset() >= -1 && offset() < 0, 'FLOWER / HIVE cells are the head frame; flights drawn at a sub-tick time in [−1, 0) (alpha − 1)');
      if (Math.abs(f.r2.x - h.currentFrame().r2.x) + Math.abs(f.r2.y - h.currentFrame().r2.y) > 1e-6) interpolated++;
    }
    assert(interpolated > 10, `60 Hz frames: mostly in between ticks (${interpolated} / 30)`);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.right));
    h.pause();
    frames.advance(16);
    assert(drawn() === h.currentFrame() && offset() === 0, 'paused again: snapped to the head frame');

    // 재생: 부드러운 움직임을 꺼도 보는 틱 ~ 다음 틱 사이 (재생 위치 소수부)
    h.setSmoothMotion(false);
    h.setOptions({ ...DEFAULT_RENDER_OPTIONS, robotPath: true });
    h.setViewTick(20);
    h.setPlaybackSpeed(0.25);
    h.play();
    interpolated = 0;
    for (let i = 0; i < 20; i++) {
      frames.advance(16, 16);
      const view = h.status().tick;
      const f = drawn();
      assert(between(f, view, view + 1), `playback: robot between the viewed tick (${view}) and the next`);
      const split = sceneRenders.at(-1)!.paths!.robot2;
      assert(JSON.stringify(split.past.at(-1)) === JSON.stringify({ x: f.r2.x, y: f.r2.y }) && JSON.stringify(split.future[0]) === JSON.stringify({ x: f.r2.x, y: f.r2.y }), 'playback: path split = drawn robot center');
      const [a, b] = [engine.getFrame(view)!.r2, engine.getFrame(view + 1)!.r2];
      if (Math.min(Math.hypot(f.r2.x - a.x, f.r2.y - a.y), Math.hypot(f.r2.x - b.x, f.r2.y - b.y)) > 1e-6) interpolated++;
    }
    assert(interpolated > 10, `0.25× playback: mostly in between ticks (${interpolated} / 20)`);
    h.stopPlayback();
    frames.advance(16);
    assert(drawn() === h.currentFrame() && drawn().tick === h.status().tick && offset() === 0, 'playback stopped: snapped to the viewed tick');
    h.dispose();
  });

  it('I. 필드 편집 모드 장면 (09-10b): 경기 전에만 경기 장면 대신, 바뀔 때마다 다시 그림, START에서 해제', () => {
    const { h, frames, counter } = setup();
    frames.advance(16);
    editRenders.length = 0;
    const scene = (): EditScene => ({ mode: 'HEATMAP', alliance: 'RED', reference: null, rowsDone: null, sweetSpot: { x: 59.5, y: 131.5 } });
    const a = scene();
    h.setEditScene(a);
    const before = counter.renders;
    frames.advance(16);
    assert(editRenders.length === 1 && editRenders[0] === a && counter.renders === before, 'SETUP: edit scene drawn instead of the match scene');
    h.setEditScene(a);
    frames.advance(16);
    assert(editRenders.length === 1, 'same scene object: no redraw');
    const b = scene();
    h.setEditScene(b);
    frames.advance(16);
    assert(editRenders.length === 2 && editRenders[1] === b, 'new scene (e.g. hit map progress): redraw');
    h.setEditScene(null);
    frames.advance(16);
    assert(editRenders.length === 2 && counter.renders === before + 1, 'null: back to the match scene');
    // 편집 중 START → 편집 해제 후 회전 / 경기 장면, 경기 중에는 편집 장면을 받지 않음
    const backToSetup = () => {
      h.reset();
      frames.advance(VIEW_ANIMATION_MS + 50);
      h.redraw();
      frames.advance(16);
    };
    h.setEditScene(scene());
    frames.advance(16);
    const edits = editRenders.length;
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(editRenders.length === edits && h.status().phase === 'MATCH', 'START cancels the edit scene');
    backToSetup();
    assert(h.status().phase === 'SETUP' && editRenders.length === edits, 'NEW: back in SETUP without the edit scene from before START');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    h.pause();
    h.setEditScene(scene());
    frames.advance(16);
    assert(editRenders.length === edits, 'ignored during the match');
    backToSetup();
    assert(h.status().phase === 'SETUP' && editRenders.length === edits, 'a scene set during the match is not kept for SETUP');
    h.dispose();
  });

  it('J. 경기 불러오기 (10-4): 재계산 → 기본 보기로 회전 → 종료 연출 없이 복기(0틱) / REPLAY 출처 / 결과 다시 열기 / 분기 재현 / 내보내기 재료', () => {
    // 입력 기록: R1 전진 + 흡입, R2 오른쪽 + 회전 (로봇별 0 ~ 5999틱 × 4 B)
    const rec = (fn: (t: number) => [number, number, number, number]) => {
      const data = new Int8Array(MATCH_TICKS * 4);
      for (let t = 0; t < MATCH_TICKS; t++) data.set(fn(t), t * 4);
      return data;
    };
    const records = {
      robot1: rec(t => (t < 400 ? [100, 0, 0, t >= 100 ? 1 : 0] : [0, 0, 20, 0])),
      robot2: rec(t => (t < 600 ? [0, 90, -30, 0] : [-60, 0, 0, t % 300 < 20 ? 2 : 0])),
    };
    const loadSetup = makeSetup('BLUE', { rngSeed: 99 });
    const single = { branches: [{ number: 1, parent: null, forkTick: 0, name: 'Branch 3', headTick: MATCH_TICKS, records }], current: 1, nextNumber: 2 };
    const { h, frames, statuses } = setup();
    frames.advance(16);
    const loaded = h.loadMatch(loadSetup, single);
    const checksums = loaded?.[0].checksums;
    assert(!!checksums && loaded!.length === 1 && checksums.length === 121, 'loadMatch recomputed the whole match');
    const ref = new SimulationEngine(loadSetup.r1Config, loadSetup.r2Config, loadSetup.shotJudge, 'BLUE', loadSetup.scenario);
    ref.inputProvider = createInputRecordProvider(records);
    ref.runFullMatch();
    assert(checksums!.join() === timelineCheckpoints(ref.timeline).join(), 'same result as an independent engine replaying the records');
    let s = h.status();
    assert(s.phase === 'ROTATING_IN' && s.alliance === 'BLUE' && s.branchName === 'Branch 3', 'rotating into the match view (file setup / branch name)');

    statuses.length = 0;
    frames.advance(VIEW_ANIMATION_MS + 50);
    s = h.status();
    assert(s.phase === 'MATCH' && s.loopState === 'ENDED' && s.endStage === 'REVIEW' && s.tick === 0 && s.headTick === MATCH_TICKS, 'review state at tick 0 after the rotation');
    assert(s.viewAngle === viewAngle('DRIVER', 'BLUE'), 'default view (DRIVER) of the file alliance');
    assert(s.endSeq === 0 && statuses.every(x => x.endStage !== 'HIGHLIGHT' && x.endStage !== 'RESULT'), 'no end highlight / result popup / end signal');
    assert(!!s.result && s.result.total === ref.getFrame(MATCH_TICKS)!.totalScore && !s.canResume && s.canBranch, 'result available, no RESUME, BRANCH possible');
    assert(s.input.sources.robot1 === 'REPLAY' && s.input.sources.robot2 === 'REPLAY' && s.input.hasLog.robot1 && s.input.hasLog.robot2, 'both robots REPLAY from the loaded records');
    h.openResult();
    assert(h.status().endStage === 'RESULT', 'RESULT opens the popup');
    h.closeResult();

    // 내보내기 재료 = 불러온 기록 그대로 (트리 = 원본 하나)
    const src = h.recipeSource();
    const root = src?.branches[0];
    assert(!!src && src.branches.length === 1 && src.current === 1 && src.nextNumber === 2 && root!.name === 'Branch 3' && root!.parent === null && root!.record.headTick === MATCH_TICKS && root!.record.result!.totalScore === ref.getFrame(MATCH_TICKS)!.totalScore, 'recipe source available after the end');
    assert(Array.from(root!.inputs.robot1).join() === Array.from(records.robot1).join() && Array.from(root!.inputs.robot2).join() === Array.from(records.robot2).join(), 'recipe inputs = loaded records');

    // 분기: 두 로봇 REPLAY로 끝까지 → 같은 결과 (녹화 덧입히기 재료 확인), 이번에는 실제 종료 → 종료 연출
    h.setViewTick(3000);
    h.branch();
    assert(h.status().loopState === 'RUNNING', 'branch from a loaded match');
    frames.advance(70_000, 100);
    s = h.status();
    assert(s.loopState === 'ENDED' && (s.endStage === 'HIGHLIGHT' || s.endStage === 'RESULT') && s.endSeq === 1, `branched run reached the end -> end sequence (${s.endStage})`);
    assert(JSON.stringify(h.currentFrame()) === JSON.stringify(ref.getFrame(MATCH_TICKS)), 'REPLAY of both robots reproduces the loaded result');
    const afterBranch = h.recipeSource()!;
    assert(afterBranch.current === 2 && Array.from(afterBranch.branches[1].inputs.robot1).join() === Array.from(records.robot1).join(), 'applied record after the branch = same inputs');

    // 경기 중에는 불러오기 거부, NEW → 가지 이름 초기화, 진행 중이면 내보내기 재료 없음 / 일시정지면 미종료 경기도 있음 (15-2)
    assert(h.loadMatch(loadSetup, single) === null && h.beginLoadMatch(loadSetup, single) === null, 'loadMatch refused during a match');
    h.reset();
    frames.advance(VIEW_ANIMATION_MS + 50);
    assert(h.status().phase === 'SETUP' && h.status().branchName === null && h.recipeSource() === null, 'NEW: branch name cleared, no recipe source');
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    frames.advance(1000, 20);
    assert(h.status().loopState === 'RUNNING' && h.recipeSource() === null, 'running: no recipe source');
    h.pause();
    const paused = h.recipeSource();
    assert(!!paused && paused.branches[0].record.headTick === h.status().headTick && paused.branches[0].inputs.robot1.length === h.status().headTick * 4, 'paused unfinished match: recipe source up to the head');
    h.dispose();
  }, FULL_MATCH_TIMEOUT_MS);

  it('K. 분기 트리 (10-5): BRANCH = 새 가지(원래 가지 보존), 전환 / 이름 / 삭제, 가지 상한, 종료 가지 전환 = 복기, NEW = 트리 폐기', () => {
    const { h, frames, win } = setup();
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    // 원본: R2를 키보드로 몰며 약 3초
    win.dispatchEvent(key('keydown', KEYBOARD_BINDINGS.forward));
    frames.advance(3000, 20);
    win.dispatchEvent(key('keyup', KEYBOARD_BINDINGS.forward));
    h.pause();
    let s = h.status();
    const mainHead = s.headTick;
    const mainHeadFrame = JSON.stringify(h.currentFrame());
    const mainR2 = h.currentFrame().r2.x;
    assert(s.branches.length === 1 && s.currentBranchId === 1 && s.canFork && s.branches[0].headTick === mainHead && !s.branches[0].ended, 'one root branch');

    // 분기: 50틱에서 새 가지 (R2 가만히) → 원본은 그대로 보관
    h.setViewTick(50);
    const forkR2 = h.currentFrame().r2.x;
    assert(h.branch() === true, 'branch -> new branch');
    s = h.status();
    assert(s.loopState === 'RUNNING' && s.currentBranchId === 2 && s.branches.length === 2, 'running on branch 2');
    assert(s.branches[1].parentId === 1 && s.branches[1].forkTick === 50 && s.branches[1].number === 2 && s.branches[1].depth === 1, 'branch 2 info');
    frames.advance(1000, 20);
    h.pause();
    s = h.status();
    const sideHead = s.headTick;
    const sideHeadFrame = JSON.stringify(h.currentFrame());
    assert(s.branches[0].headTick === mainHead && sideHead > 50 && sideHead < mainHead, `root kept its record (${mainHead}), branch 2 head ${sideHead}`);
    assert(h.currentFrame().r2.x - forkR2 < (mainR2 - forkR2) / 2, `branch 2: R2 stopped driving after the fork (${(h.currentFrame().r2.x - forkR2).toFixed(1)} vs root ${(mainR2 - forkR2).toFixed(1)} in)`);

    // 전환 → 원본: 보는 틱 유지(머리 이하), 머리 프레임 그대로, RESUME으로 원본 이어 기록
    h.setViewTick(sideHead);
    assert(h.switchBranch(1), 'switch to the root');
    s = h.status();
    assert(s.currentBranchId === 1 && s.tick === sideHead && s.headTick === mainHead && s.endStage === 'NONE', 'switched to root: view tick kept, root head');
    h.setViewTick(mainHead);
    assert(JSON.stringify(h.currentFrame()) === mainHeadFrame && h.status().canResume, 'root head frame intact, RESUME available');
    h.resume();
    frames.advance(500, 20);
    h.pause();
    assert(h.status().headTick > mainHead && h.status().branches[1].headTick === sideHead, 'root continued, branch 2 untouched');
    const rootHead = h.status().headTick;
    const rootHeadFrame = JSON.stringify(h.currentFrame());
    assert(h.switchBranch(2) && h.status().tick === sideHead && JSON.stringify(h.currentFrame()) === sideHeadFrame, 'back to branch 2: head frame intact (view tick clamped to its head)');
    assert(!h.switchBranch(2) && !h.switchBranch(99), 'switch to the current / unknown branch refused');

    // 이름 바꾸기 / 내보내기 이름
    assert(h.renameBranch(2, '  Fast cycle ') && h.status().branchName === 'Fast cycle' && h.status().branches[1].name === 'Fast cycle', 'rename');
    h.renameBranch(2, '');
    assert(h.status().branchName === null, 'empty name -> auto name');

    // MAX_BRANCHES(16)개까지: 원본 / 가지 2에서 계속 분기
    for (let i = 3; i <= MAX_BRANCHES; i++) {
      h.setViewTick(10 + i);
      assert(h.branch(), `branch ${i}`);
      frames.advance(100, 20);
      h.pause();
    }
    s = h.status();
    assert(s.branches.length === MAX_BRANCHES && !s.canFork && s.branches.map(b => b.number).join() === Array.from({ length: MAX_BRANCHES }, (_, i) => i + 1).join(), 'all branches, full');
    h.setViewTick(5);
    assert(!h.branch() && h.status().branches.length === MAX_BRANCHES && h.status().loopState === 'PAUSED', 'full: BRANCH refused, still paused');

    // 삭제: 원본 불가, 가지 2(하위 3 ~ 16 포함, 지금 가지 16도 하위) → 부모(원본)로 전환
    assert(!h.deleteBranch(1), 'root cannot be deleted');
    const depth = h.status().branches.find(b => b.id === MAX_BRANCHES)!.depth;
    assert(depth === MAX_BRANCHES - 1, `nested branches (depth ${depth})`);
    assert(h.deleteBranch(2), 'delete branch 2 with its sub-branches');
    s = h.status();
    assert(s.branches.length === 1 && s.currentBranchId === 1 && s.canFork, 'only the root left, current = root');
    assert(s.headTick === rootHead && s.tick <= rootHead, 'the engine now holds the root timeline');
    h.setViewTick(rootHead);
    assert(JSON.stringify(h.currentFrame()) === rootHeadFrame, 'root head frame after deleting the current branch');
    h.setViewTick(rootHead - 20);
    assert(h.branch() && h.status().branches[1].number === MAX_BRANCHES + 1, 'numbers are not reused');
    const b9 = h.status().branches[1].id;
    frames.advance(200, 20);

    // 진행 중에는 전환 / 삭제 불가
    assert(!h.switchBranch(1) && !h.deleteBranch(b9), 'no switch / delete while running');
    h.pause();

    // 종료한 가지: 원본을 끝까지 → 종료 연출 1회. 가지 9로 전환(미종료, 머리에서 RESUME), 다시 원본 = 복기 (종료 신호 불변)
    h.switchBranch(1);
    h.setViewTick(h.status().headTick);
    h.resume();
    frames.advance(130_000, 100);
    s = h.status();
    assert(s.matchEnded && s.endSeq === 1 && s.branches[0].ended && s.branches[0].totalScore === s.score, 'root ended once');
    h.skipHighlight();
    h.closeResult();
    assert(h.switchBranch(b9), 'switch from the ended root');
    s = h.status();
    assert(s.endStage === 'NONE' && !s.matchEnded && s.loopState === 'ENDED' && s.tick === s.headTick && s.canResume, 'unfinished branch: RESUME available though the loop is ENDED');
    h.resume();
    frames.advance(300, 20);
    assert(h.status().loopState === 'RUNNING', 'resumed branch #9 from the ENDED loop');
    h.pause();
    assert(h.switchBranch(1), 'back to the ended root');
    s = h.status();
    assert(s.endStage === 'REVIEW' && s.matchEnded && !s.canResume && s.endSeq === 1 && !!s.result, 'ended branch -> review, no new end signal');
    const src = h.recipeSource()!;
    const rootSrc = src.branches.find(b => b.number === 1)!;
    assert(src.current === 1 && rootSrc.name === null && rootSrc.parent === null, 'recipe source: current = root (auto name)');
    // 원본 가지의 적용 입력 기록만으로 독립 재계산 = 원본 결과 (가지를 오가도 입력 기록이 섞이지 않음)
    const base = makeSetup('RED');
    const ref = new SimulationEngine(base.r1Config, base.r2Config, base.shotJudge, 'RED', base.scenario);
    ref.inputProvider = createInputRecordProvider(rootSrc.inputs);
    ref.runFullMatch();
    assert(timelineCheckpoints(ref.timeline).join() === rootSrc.record.checksums.join() && ref.getFrame(MATCH_TICKS)!.totalScore === rootSrc.record.result!.totalScore, 'root inputs reproduce the root result');
    // 다른 가지도 그 가지의 입력 사본 = 머리까지 (부모 번호 = 부모 가지의 번호)
    for (const b of src.branches) {
      assert(b.inputs.robot1.length === b.record.headTick * 4 && (b.parent === null || src.branches.some(p => p.number === b.parent)), `branch #${b.number}: inputs up to its head, parent by number`);
    }

    // NEW: 트리 폐기
    h.reset();
    frames.advance(VIEW_ANIMATION_MS + 50);
    s = h.status();
    assert(s.branches.length === 1 && s.currentBranchId === 1 && s.branchName === null, 'NEW discards the tree');
    h.dispose();
  }, FULL_MATCH_TIMEOUT_MS);
  it('K2. (16-2) 지금 가지만 프레임 보관: 떠난 가지는 입력 사본 + 기록 요약, 전환 = 같은 프레임의 마지막 틱부터 재계산 (처음 기록과 같음), 불러오기도 해제', () => {
    const { h, frames, win } = setup();
    frames.advance(16);
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    const drive = (code: string, ms: number) => {
      h.resume();
      win.dispatchEvent(key('keydown', code));
      frames.advance(ms, 20);
      win.dispatchEvent(key('keyup', code));
      h.pause();
    };
    const branchData = () => (h as unknown as { tree: { currentId: number; nodes: { id: number; data: Record<string, unknown> }[] } }).tree;
    // 가지마다 떠나기 전의 체크포인트 / 머리 프레임 (처음 기록)
    const original = new Map<number, { sums: string; head: string }>();
    const remember = () => {
      const s = h.status();
      h.setViewTick(s.headTick);
      original.set(s.currentBranchId, { sums: viewCheckpoints(h).join(), head: JSON.stringify(h.currentFrame()) });
    };
    const matches = (id: number) => {
      const s = h.status();
      h.setViewTick(s.headTick);
      return s.currentBranchId === id && viewCheckpoints(h).join() === original.get(id)!.sums && JSON.stringify(h.currentFrame()) === original.get(id)!.head;
    };

    // 1 ─(500) 2 ─(800) 3
    //  │        └(200) 4   (부모 분기 틱보다 앞)
    //  └(1500) 5
    h.pause();
    drive(KEYBOARD_BINDINGS.forward, 40_000);
    remember();
    h.setViewTick(500);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.right, 20_000);
    remember();
    h.setViewTick(800);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.left, 5_000);
    remember();
    h.switchBranch(2);
    h.setViewTick(200);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.forward, 3_000);
    remember();
    h.switchBranch(1);
    h.setViewTick(1500);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.left, 2_000);
    remember();
    const ids = h.status().branches.map(b => b.id);
    assert(ids.join() === '1,2,3,4,5', `tree 1 ~ 5 (${ids})`);

    // 떠난 가지는 프레임 없이 입력 사본 + 기록 요약, 지금 가지는 둘 다 없음
    const tree = branchData();
    assert(tree.nodes.every(n => !('timeline' in n.data) && (n.id === tree.currentId ? n.data.inputs === null && n.data.record === null : !!n.data.inputs && !!n.data.record)), 'only the current branch keeps frames');
    const info = h.status().branches;
    assert(info[0].headTick === 2000 && info[0].ended === false && info[1].headTick > 500, `heads from the records (${info.map(b => b.headTick)})`);

    // 재계산할 틱 수 = 머리 − 같은 프레임의 마지막 틱 (지금 가지 5 기준)
    const head = (id: number) => h.status().branches.find(b => b.id === id)!.headTick;
    assert(h.switchCost(5) === 0 && h.switchCost(1) === head(1) - 1500 && h.switchCost(3) === head(3) - 500 && h.switchCost(4) === head(4) - 200 && h.switchCost(99) === 0, 'switch cost');

    // 여러 순서로 오가도 매번 처음 기록과 같다
    for (const id of [3, 4, 1, 2, 5, 4, 3, 1, 5, 2]) {
      assert(h.switchBranch(id) && matches(id), `switch to ${id}: recomputed = original`);
    }

    // 재계산한 가지에서 이어 기록 → 떠났다 돌아와도 이어 쓴 기록 그대로
    h.switchBranch(4);
    h.setViewTick(head(4));
    drive(KEYBOARD_BINDINGS.right, 1_000);
    remember();
    h.switchBranch(1);
    assert(h.switchBranch(4) && matches(4), 'continued branch 4 after a recompute, kept after leaving');

    // 내보내기 재료 = 가지마다 기록 요약 (지금 가지는 지금 프레임에서)
    const src = h.recipeSource()!;
    for (const b of src.branches) assert(b.record.checksums.join() === original.get(b.number)!.sums, `recipe source #${b.number}: checkpoints = original`);

    // 지금 가지 삭제 → 부모로 전환(재계산)
    h.switchBranch(3);
    assert(h.deleteBranch(3) && matches(2), 'deleting the current branch recomputes its parent');

    // 불러오기: 지금 가지 외 프레임 해제, 체크포인트로 비교
    const recipe = buildMatchRecipe({ setup: DEFAULT_DRAFT_VALUES, ...h.recipeSource()!, createdAt: new Date() });
    h.dispose();
    const second = setup();
    second.frames.advance(16);
    const loaded = second.h.loadMatch(makeSetup('RED'), recipeLoadTree(recipe))!;
    assert(loaded.every(b => compareCheckpoints(recipe.branches.find(r => r.number === b.number)!.checksums, b.checksums).match), 'loaded checkpoints = file');
    const loadedTree = (second.h as unknown as { tree: { currentId: number; nodes: { id: number; data: Record<string, unknown> }[] } }).tree;
    assert(loadedTree.currentId === 2 && loadedTree.nodes.every(n => (n.id === loadedTree.currentId) === (n.data.record === null)), 'loaded tree: only the current branch keeps frames');
    second.frames.advance(VIEW_ANIMATION_MS + 50);
    for (const id of [4, 1, 5]) {
      second.h.switchBranch(id);
      second.h.setViewTick(second.h.status().headTick);
      assert(viewCheckpoints(second.h).join() === original.get(id)!.sums, `loaded branch ${id}: recomputed = original`);
    }
    second.h.dispose();
  }, FULL_MATCH_TIMEOUT_MS);

  it('L. (15-2) 트리 내보내기 재료 → 불러오기: 가지 단위 재계산 작업(진행 / 취소 = 버림), 번호 · 부모 · 분기 틱 · 이름 · 다음 번호 보존, 미종료 지금 가지는 머리에서 일시정지', () => {
    const { h, frames, win } = setup();
    frames.advance(16);
    h.start();
    frames.advance(VIEW_ANIMATION_MS + 50);
    const drive = (code: string, ms: number) => {
      h.resume();
      win.dispatchEvent(key('keydown', code));
      frames.advance(ms, 20);
      win.dispatchEvent(key('keyup', code));
      h.pause();
    };
    // 원본: 키보드(R2) 전진 / 가지 2(지움) / 가지 3 "Plan B" / 가지 4 = 가지 3의 20틱(원본 분기 틱 100보다 앞)에서
    h.pause();
    drive(KEYBOARD_BINDINGS.forward, 3000);
    h.setViewTick(50);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.right, 400);
    const b2 = h.status().currentBranchId;
    h.switchBranch(1);
    h.setViewTick(100);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.left, 1000);
    const b3 = h.status().currentBranchId;
    h.renameBranch(b3, 'Plan B');
    assert(h.deleteBranch(b2), 'deleted branch #2 (numbers keep a gap)');
    h.setViewTick(20);
    h.branch();
    h.pause();
    drive(KEYBOARD_BINDINGS.forward, 600);
    const before = h.status();
    const exportedHead = JSON.stringify(h.currentFrame());
    const numberOf = (id: number | null) => (id === null ? null : before.branches.find(b => b.id === id)!.number);
    const shape = (branches: AppStatus['branches'], num: (id: number | null) => number | null) =>
      branches.map(b => [b.number, num(b.parentId), b.forkTick, b.name, b.headTick, b.ended]);
    assert(before.branches.map(b => b.number).join() === '1,3,4' && before.branches.every(b => !b.ended), `tree 1, 3, 4 (${before.branches.map(b => b.number)})`);
    const src = h.recipeSource()!;
    assert(src.current === 4 && src.nextNumber === 5 && src.branches.map(b => b.parent).join() === ',1,3', 'recipe source: current #4, next number 5, parents by number');
    const recipe = buildMatchRecipe({ setup: DEFAULT_DRAFT_VALUES, ...src, createdAt: new Date() });
    h.dispose();

    // 새 컨트롤러에서 가지 단위로 불러오기
    const second = setup();
    second.frames.advance(16);
    const job = second.h.beginLoadMatch(makeSetup('RED'), recipeLoadTree(recipe))!;
    assert(job.total === 3 && job.done === 0 && job.commit() === null, 'job: 3 branches, nothing computed, commit refused');
    assert(!job.step() && job.done === 1 && second.h.status().phase === 'SETUP', 'one branch per step, controller untouched until commit');
    // 취소 = 버림: 다른 작업을 끝까지 계산해도 commit하지 않으면 경기 전 그대로
    const dropped = second.h.beginLoadMatch(makeSetup('RED'), recipeLoadTree(recipe))!;
    while (!dropped.step());
    assert(second.h.status().phase === 'SETUP' && second.h.status().branches.length === 1, 'a job that is not committed changes nothing');
    while (!job.step());
    assert(job.done === 3 && job.step(), 'all branches computed');
    const loaded = job.commit()!;
    assert(loaded.map(b => b.number).join() === '1,3,4', 'loaded branches in file order');
    for (const b of loaded) {
      const comparison = compareCheckpoints(recipe.branches.find(r => r.number === b.number)!.checksums, b.checksums);
      assert(comparison.match, `branch #${b.number}: recomputed checkpoints match`);
    }
    assert(job.commit() === null, 'second commit refused (no longer SETUP)');
    second.frames.advance(VIEW_ANIMATION_MS + 50);
    const s = second.h.status();
    assert(s.phase === 'MATCH' && s.loopState === 'PAUSED' && s.pauseReason === 'USER' && s.endStage === 'NONE', `unfinished current branch: paused after the rotation (${s.loopState})`);
    assert(s.tick === s.headTick && s.headTick === before.headTick && s.canResume && s.endSeq === 0, 'paused at its head, RESUME available');
    assert(JSON.stringify(shape(s.branches, id => id)) === JSON.stringify(shape(before.branches, numberOf)), 'numbers / parents / fork ticks / names / heads preserved');
    assert(s.branches.find(b => b.id === s.currentBranchId)!.number === 4 && s.branchName === null, 'opened the exported current branch (#4)');
    assert(s.input.sources.robot1 === 'REPLAY' && s.input.sources.robot2 === 'REPLAY', 'both robots REPLAY');
    assert(before.tick === before.headTick && JSON.stringify(second.h.currentFrame()) === exportedHead, 'same head frame as the exported branch');
    // 다른 가지로 전환해도 그 가지 그대로 / 새 가지 번호 = 파일의 다음 번호 (지운 번호 재사용 없음)
    assert(second.h.switchBranch(3) && second.h.status().branchName === 'Plan B' && viewCheckpoints(second.h).join() === src.branches[1].record.checksums.join(), 'switch to "Plan B" (recomputed = exported checkpoints)');
    second.h.setViewTick(10);
    assert(second.h.branch(), 'branch from a loaded branch');
    second.h.pause();
    assert(second.h.status().branches.at(-1)!.number === 5, 'new branch number = file next number (5)');
    // 재개: 머리에서 이어 진행
    assert(second.h.switchBranch(4), 'back to #4');
    second.h.setViewTick(second.h.status().headTick);
    second.h.resume();
    second.frames.advance(300, 20);
    assert(second.h.status().loopState === 'RUNNING' && second.h.status().headTick > before.headTick, 'resumed the loaded unfinished branch');
    second.h.dispose();
  }, FULL_MATCH_TIMEOUT_MS);
});
