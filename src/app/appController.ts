// 앱 컨트롤러 (명세서 3.8 기본 원칙 / 앱 상태 흐름, 09-6c): React 비의존
// 엔진 / 입력 허브 / 브라우저 실시간 루프 / 장면 렌더러를 소유하고, React는 약 10 Hz 상태 알림만 구독한다.
// 08-7 개발 하네스 컨트롤러를 일반화: 경기 설정(로봇 제원 2개 / 판정 함수 / 시나리오 / 슈터 탄도)을 코드에 고정하지 않고
// 밖에서 주입받는다 (09-6d까지는 하네스 고정 설정, 09-8 이후 config 창의 적용된 설정).
// 경기 흐름 (명세서 3.8 앱 상태 흐름, 09-7a):
//   SETUP(관중석 시점, 설정 교체 가능) → 시작 → ROTATING_IN(보기 회전, 루프 READY 유지) → 회전 완료 프레임에 loop.start() → MATCH
//   → NEW(리셋) → ROTATING_OUT(관중석 시점으로 회전, 같은 설정으로 0틱 새 엔진) → SETUP
//   MATCH 안: 진행(RUNNING) ⇄ 일시정지(PAUSED) / 재생(PLAYBACK, 기록 불변) / 6000틱 → 종료 강조 5초 → 결과 → 복기(REVIEW)
// 보는 틱(viewTick)과 엔진 머리(headTick)를 구분한다: 일시정지 중 틱 이동 / 재생 / 타임라인은 보는 틱만 바꾸고 그 프레임을 그린다.
// 기록을 바꾸는 동작은 재개(보는 틱 = 머리, 경기 미종료)와 분기(보는 틱 < 머리 → scrubTo + LIVE 로그 폐기 + 재개)뿐이다.
// 다시 그리기: 루프 RUNNING 중에는 onFrame마다, 그 외(일시정지 / 옵션 / 보기 애니메이션 / 재생 / 종료 강조 대기)에는 rAF로.
// 시계 / 프레임 스케줄러 / 브라우저 환경을 주입받아 Node에서 가짜 시간으로 테스트한다.

import { DT, MATCH_TICKS, SimulationEngine } from '../core/simulationEngine';
import type {
  DeepReadonly,
  MatchShooterBallistics,
  RobotConfig,
  RPState,
  ScenarioConfig,
  ScoreBreakdown,
  ShotProbabilityResolver,
  TimelineFrame,
} from '../core/types';
import { createAnimationFrameScheduler, createBrowserRealtimeLoop, isEditableTarget } from '../input/browserInput';
import type { BrowserInputAdapter, BrowserInputEnv, GamepadSlotStatus } from '../input/browserInput';
import { LOG_RECORD_BYTES, MatchInputs } from '../input/inputLog';
import type { InputSource } from '../input/inputLog';
import { DEFAULT_DRIVE_MODE, KEYBOARD_ENABLED } from '../input/inputConfig';
import type { DriveMode, RobotId } from '../input/inputConfig';
import { autoSource, resolveSource, sourceChoiceAllowed } from './inputPlan';
import type { SourceChoice } from './inputPlan';
import type { FrameScheduler, LoopState, PauseReason, RealtimeLoop } from '../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS, hitProbabilities } from '../renderer/renderOptions';
import type { RenderOptions, RobotHitProbability } from '../renderer/renderOptions';
import { renderScene } from '../renderer/sceneRenderer';
import { renderEditScene } from '../renderer/editSceneRenderer';
import type { EditScene } from '../renderer/editSceneRenderer';
import { ViewAnimator, viewAngle } from '../renderer/viewTransform';
import type { ViewMode } from '../renderer/viewTransform';

/** 경기 1회분 설정 (엔진 생성 인자). 진영은 scenario.allianceColor */
export interface MatchSetup {
  r1Config: RobotConfig;
  r2Config: RobotConfig;
  shotResolver: ShotProbabilityResolver;
  scenario: ScenarioConfig;
  shooters?: MatchShooterBallistics;
}

export type AppPhase = 'SETUP' | 'ROTATING_IN' | 'MATCH' | 'ROTATING_OUT';

/** 경기 종료 단계: NONE(종료 전) → HIGHLIGHT(필드 종료 강조 5초, 클릭 / Space로 건너뜀) → RESULT(결과 팝업) → REVIEW(복기) */
export type EndStage = 'NONE' | 'HIGHLIGHT' | 'RESULT' | 'REVIEW';
export const END_HIGHLIGHT_MS = 5000;

/** 재생 배속 (재생에만 적용, 조종은 항상 1×) */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** 경고 토스트 (명세서 3.8 필드 영역): 리프트 상태에서 주행 입력이 들어오면. 같은 로봇은 LIFT_TOAST_COOLDOWN_MS에 한 번 */
export interface LiftToast {
  robot: 'robot1' | 'robot2';
}
export const LIFT_TOAST_COOLDOWN_MS = 2000;
const LIFT_STATES: ReadonlySet<string> = new Set(['FLOWER_SETUP', 'FLOWER_READY', 'FLOWER_DROPPING', 'FLOWER_LOWERING']);

/** 1초 이동 = 50틱 */
export const TICKS_PER_SECOND = Math.round(1 / DT);

export interface AppStatus {
  phase: AppPhase;
  alliance: 'RED' | 'BLUE';
  matchView: ViewMode;          // 경기 중 보기 (경기 전 화면은 항상 관중석)
  viewAngle: number;            // 현재 표시 중인 보기 회전각 (rad, 애니메이션 중간값 포함)
  loopState: LoopState;
  pauseReason: PauseReason | null;
  // 자동 일시정지 배너 사유 (창 포커스 소실 / 탭 숨김 / 게임패드 해제로 멈췄을 때만, 재개 · 분기 · 재생 시작 · NEW에서 사라짐)
  autoPauseReason: Exclude<PauseReason, 'USER'> | null;
  tick: number;                 // 보는 틱 (진행 중에는 엔진 머리와 같음). 아래 프레임 값은 모두 이 틱 기준
  headTick: number;             // 마지막 기록 틱 (엔진 머리)
  matchEnded: boolean;          // 머리가 6000틱 (종료 기록 있음)
  canScrub: boolean;            // 보는 틱 이동 / 재생 가능 (경기 중 + 진행 중 아님 + 종료 강조 / 결과 팝업 아님)
  canResume: boolean;           // 일시정지 + 보는 틱 = 머리 + 경기 미종료 (+ 종료 강조 / 결과 팝업 아님)
  canBranch: boolean;           // 진행 중 아님 + 보는 틱 < 머리 (+ 종료 강조 / 결과 팝업 아님)
  playing: boolean;             // 기록 재생 중
  playbackSpeed: PlaybackSpeed;
  endStage: EndStage;
  endSeq: number;               // 이 경기에서 실제로 6000틱에 도달한 횟수 (종료 연출 트리거: 분기 후 재종료마다 +1, 재생 / 스크러빙으로는 불변)
  result: MatchResult | null;   // 종료 프레임 기준 결과 (경기 종료 후, 결과 팝업용 — 보는 틱과 무관)
  remainingSec: number;
  score: number;                // 확정 점수 (경기 중 = 텔레옵 TIP × 20, 종료 프레임 = 최종 합계)
  tipCount: number;             // 텔레옵 TIP 횟수
  autoTipCount: number;         // 오토 TIP 횟수 (좌측 패널 TIP 표시 = 오토 + 텔레옵, 점수에는 미포함)
  rp: RPState;
  // 표시 옵션 hitProbability가 켜져 있을 때만 (좌측 패널 명중 확률, 상태 알림마다 판정 함수 4회 호출), 꺼져 있으면 null
  hitProbability: Record<'robot1' | 'robot2', RobotHitProbability> | null;
  gamepads: GamepadSlotStatus[];
  input: InputStatus;
}

/**
 * 입력 출처 / 조작 모드 / 키보드 (명세서 3.8 SETTINGS 탭 입력, 09-8b). 선택(choices / modes / keyboardEnabled)은
 * 다음 START / RESUME / BRANCH부터 적용되고, sources / activeModes / activeKeyboard는 지금 경기에 적용 중인 값
 */
export interface InputStatus {
  choices: Record<RobotId, SourceChoice>;   // 경기 전 = AUTO / LIVE / NONE, 경기 중 = LIVE / REPLAY / NONE
  autoPreview: Record<RobotId, InputSource>; // 지금 시작하면 AUTO가 풀릴 값
  sources: Record<RobotId, InputSource>;     // 경기 중 = 적용 중인 출처, 경기 전 = 지금 시작하면 적용될 출처
  hasLog: Record<RobotId, boolean>;          // 입력 기록 있음 (REPLAY 가능)
  modes: Record<RobotId, DriveMode>;
  activeModes: Record<RobotId, DriveMode>;
  keyboardEnabled: boolean;
  activeKeyboard: boolean;
}

/** 입력 설정 초기값 (저장된 SETTINGS에서) */
export interface InputSettings {
  keyboardEnabled: boolean;
  driveModes: Record<RobotId, DriveMode>;
}

/** 결과 팝업 값 (종료 프레임 = 6000틱에서 읽음, 명세서 3.8 경기 종료와 결과 팝업) */
export interface MatchResult {
  total: number;
  breakdown: DeepReadonly<ScoreBreakdown>;
  rp: RPState;
  tips: number;                 // 오토 + 텔레옵 TIP 횟수 (RP 카드용, 점수에는 오토 미포함)
  autoTips: number;             // 오토 TIP 횟수 (결과 팝업 근거: RP에만 합산, 09-12)
  teleopTips: number;           // 텔레옵 TIP 횟수 (HIVE 점수 = × 20)
}

export interface AppControllerDeps {
  ctx: CanvasRenderingContext2D;  // 800 × 800 논리 크기(필드 뷰포트) × dpr 버퍼 캔버스
  setup: MatchSetup;
  dpr?: number;
  env?: BrowserInputEnv;
  scheduler?: FrameScheduler;
  now?: () => number;             // 보기 애니메이션용 벽시계 (ms)
  onStatus?: (status: AppStatus) => void;
  onToast?: (toast: LiftToast) => void;
  input?: Partial<InputSettings>;
  defaultView?: ViewMode;          // 새 경기의 경기 중 보기 (SETTINGS 기본 보기 방향, 09-8b)
  options?: RenderOptions;
  statusIntervalMs?: number;      // 진행 중 상태 알림 최소 간격 (기본 100 ms ≈ 10 Hz)
}

export class AppController {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr: number;
  private readonly env: BrowserInputEnv | undefined;
  private readonly scheduler: FrameScheduler;
  private readonly now: () => number;
  private readonly onStatus: (status: AppStatus) => void;
  private readonly onToast: (toast: LiftToast) => void;
  private readonly statusIntervalMs: number;

  private setup: MatchSetup;
  private matchView: ViewMode = 'DRIVER';
  private defaultView: ViewMode = 'DRIVER';
  // 입력 선택 (09-8b): 경기 전 선택 / 경기 중 선택 / 조작 모드 / 키보드 — 다음 START / RESUME / BRANCH부터 적용
  private setupChoices: Record<RobotId, SourceChoice> = { robot1: 'AUTO', robot2: 'AUTO' };
  private matchChoices: Record<RobotId, InputSource> = { robot1: 'LIVE', robot2: 'LIVE' };
  private driveModes: Record<RobotId, DriveMode> = { robot1: DEFAULT_DRIVE_MODE, robot2: DEFAULT_DRIVE_MODE };
  private keyboardEnabled = KEYBOARD_ENABLED;
  private options: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  private phase: AppPhase = 'SETUP';
  private readonly animator = new ViewAnimator(0);

  private engine!: SimulationEngine;
  private inputs!: MatchInputs;
  private loop!: RealtimeLoop;
  private adapter!: BrowserInputAdapter;
  private disposeLoop: (() => void) | null = null;

  private viewTick = 0;                 // 진행 중이 아닐 때 보는 틱 (진행 중에는 엔진 머리를 따라감)
  private playing = false;
  private playbackSpeed: PlaybackSpeed = 1;
  private playbackPos = 0;              // 재생 위치 (틱, 소수)
  private playbackLast: number | null = null;
  private endStage: EndStage = 'NONE';
  private endStageAt = 0;
  private endSeq = 0;
  private shortcutsEnabled = true;
  private autoPauseReason: Exclude<PauseReason, 'USER'> | null = null;
  private lastToastAt: Record<'robot1' | 'robot2', number> = { robot1: -Infinity, robot2: -Infinity };
  private detachKeys: (() => void) | null = null;

  private renderHandle: number | null = null;
  private lastStatusAt = -Infinity;
  private editScene: EditScene | null = null; // 필드 편집 모드 장면 (경기 전 SETUP에서만 그림, 09-10b)

  constructor(deps: AppControllerDeps) {
    this.ctx = deps.ctx;
    this.setup = deps.setup;
    this.dpr = deps.dpr ?? 1;
    this.env = deps.env;
    this.scheduler = deps.scheduler ?? createAnimationFrameScheduler();
    this.now = deps.now ?? (() => performance.now());
    this.onStatus = deps.onStatus ?? (() => {});
    this.onToast = deps.onToast ?? (() => {});
    this.statusIntervalMs = deps.statusIntervalMs ?? 100;
    this.keyboardEnabled = deps.input?.keyboardEnabled ?? KEYBOARD_ENABLED;
    if (deps.input?.driveModes) this.driveModes = { ...deps.input.driveModes };
    this.defaultView = deps.defaultView ?? 'DRIVER';
    if (deps.options) this.options = { ...deps.options };
    this.newMatch();
    this.attachShortcuts();
    this.requestRender();
  }

  // ---------------- 조작 ----------------

  /** 경기 설정 교체 (경기 전 SETUP에서만, 새 0틱 엔진). 받아들였으면 true */
  setSetup(setup: MatchSetup): boolean {
    if (this.phase !== 'SETUP') return false;
    this.setup = setup;
    this.newMatch();
    this.changed();
    return true;
  }

  /**
   * 경기 중 보기 (DRIVER / AUDIENCE, 스크러버 줄 VIEW). 경기 중이면 회전 애니메이션, 그 경기에서만 유지 (새 경기는 기본 보기 방향).
   * 경기 전(SETUP)에는 무시 — 시작 시점은 SETTINGS 기본 보기 방향으로만 정한다 (09-8 확정)
   */
  setMatchView(mode: ViewMode): void {
    if (mode === this.matchView || this.phase === 'SETUP') return;
    this.matchView = mode;
    if (this.phase === 'MATCH' || this.phase === 'ROTATING_IN') this.animator.start(viewAngle(mode, this.alliance), this.now());
    this.changed();
  }

  /** SETTINGS 기본 보기 방향: 새 경기(앱 시작 / NEW)의 경기 중 보기. 경기 전이면 이번 START에도 바로 적용 */
  setDefaultView(mode: ViewMode): void {
    this.defaultView = mode;
    if (this.phase === 'SETUP') this.matchView = mode;
    this.changed();
  }

  /** 로봇별 입력 출처 선택 (경기 전 AUTO / LIVE / NONE, 경기 중 진행 아닐 때 LIVE / NONE / 기록 있으면 REPLAY). 받아들였으면 true */
  setSourceChoice(robot: RobotId, choice: SourceChoice): boolean {
    const inMatch = this.phase !== 'SETUP';
    if (inMatch && (this.phase !== 'MATCH' || this.loop.state === 'RUNNING')) return false;
    if (!sourceChoiceAllowed(choice, inMatch, this.inputs.logs[robot].length > 0)) return false;
    if (inMatch) this.matchChoices = { ...this.matchChoices, [robot]: choice as InputSource };
    else this.setupChoices = { ...this.setupChoices, [robot]: choice };
    this.emitStatus(true);
    return true;
  }

  /** 로봇별 조작 모드 (FIELD / ROBOT), 다음 START / RESUME / BRANCH부터 */
  setDriveMode(robot: RobotId, mode: DriveMode): void {
    this.driveModes = { ...this.driveModes, [robot]: mode };
    this.emitStatus(true);
  }

  /** 키보드 주행 켜기 / 끄기, 다음 START / RESUME / BRANCH부터 (단축키는 항상 동작) */
  setKeyboardEnabled(enabled: boolean): void {
    this.keyboardEnabled = enabled;
    this.emitStatus(true);
  }

  setOptions(options: RenderOptions): void {
    this.options = { ...options };
    this.changed();
  }

  /** 시작: 보기 회전 애니메이션이 끝난 뒤 실시간 루프 시작 (회전 중 조종 방지) */
  start(): void {
    if (this.phase !== 'SETUP') return;
    // 경기 전 선택을 시작 순간의 장치 상태로 풀어 적용 (AUTO → LIVE / NONE)
    const pads = this.adapter.gamepadStatus();
    for (const robot of ['robot1', 'robot2'] as const) {
      this.matchChoices[robot] = resolveSource(this.setupChoices[robot], robot, pads, this.keyboardEnabled);
    }
    this.applyInputChoices();
    this.phase = 'ROTATING_IN';
    this.editScene = null; // 편집 중 START = 편집 취소 후 시작 (명세서 3.8)
    this.animator.start(viewAngle(this.matchView, this.alliance), this.now());
    this.changed();
  }

  pause(): void {
    this.loop.pause('USER');
  }

  /** 재개: 일시정지 + 보는 틱 = 마지막 기록 틱 + 경기 미종료일 때만 (되감은 틱에서는 분기) */
  resume(): void {
    if (!this.canResume()) return;
    this.stopPlayback();
    this.applyInputChoices();
    this.loop.resume();
  }

  /**
   * 분기: 보는 틱 < 마지막 기록 틱일 때 엔진을 보는 틱으로 되감고(scrubTo) LIVE 로봇 입력 기록을 그 틱 이후 폐기한 뒤 재개.
   * 이후 기록(프레임)은 첫 틱 진행 때 엔진이 폐기한다. 확인창은 화면이 띄운다 (명세서 3.8 분기 확인창)
   */
  branch(): void {
    if (!this.canBranch()) return;
    this.stopPlayback();
    const tick = this.viewTick;
    this.engine.scrubTo(tick);
    this.applyInputChoices(); // 분기부터 새 출처 (REPLAY로 바꾼 로봇은 기록 유지 = 녹화 덧입히기)
    for (const robot of ['robot1', 'robot2'] as const) {
      if (this.inputs.sources[robot] === 'LIVE') this.inputs.logs[robot].truncate(tick);
      this.inputs.applied[robot].truncate(tick); // 적용 입력 기록은 출처와 무관하게 분기 틱 이후 폐기 (10-3)
    }
    this.endStage = 'NONE';
    this.loop.resume();
  }

  /** NEW: 루프 정지, 같은 설정으로 새 엔진(0틱), 관중석 시점으로 반대로 회전 → 경기 전 화면 (확인창은 화면이 띄움) */
  reset(): void {
    if (this.phase === 'SETUP') return;
    this.newMatch();
    this.phase = 'ROTATING_OUT';
    this.animator.start(0, this.now());
    this.changed();
  }

  // ---------------- 보는 틱 / 재생 (진행 중이 아닐 때, 기록 불변) ----------------

  /** 보는 틱을 기록 구간 [0, 마지막 기록 틱] 안으로 옮김 (재생 중이면 재생을 멈춤) */
  setViewTick(tick: number): void {
    if (!this.canScrub()) return;
    this.stopPlayback();
    const next = Math.min(this.headTick(), Math.max(0, Math.round(Number.isFinite(tick) ? tick : 0)));
    if (next === this.viewTick) {
      this.emitStatus(true);
      return;
    }
    this.viewTick = next;
    this.changed();
  }

  /** 틱 이동 (± 1틱 / ± 50틱) */
  stepView(deltaTicks: number): void {
    this.setViewTick(this.viewTick + deltaTicks);
  }

  /** 재생 시작: 보는 틱부터 배속으로. 이미 마지막 기록 틱이면 처음(0틱)부터 */
  play(): void {
    if (!this.canScrub() || this.playing) return;
    if (this.viewTick >= this.headTick()) this.viewTick = 0;
    this.autoPauseReason = null;
    this.playing = true;
    this.playbackPos = this.viewTick;
    this.playbackLast = null;
    this.changed();
  }

  stopPlayback(): void {
    if (!this.playing) return;
    this.playing = false;
    this.playbackLast = null;
    this.changed();
  }

  togglePlayback(): void {
    if (this.playing) this.stopPlayback();
    else this.play();
  }

  setPlaybackSpeed(speed: PlaybackSpeed): void {
    if (!PLAYBACK_SPEEDS.includes(speed) || speed === this.playbackSpeed) return;
    this.playbackSpeed = speed;
    this.emitStatus(true);
  }

  // ---------------- 경기 종료 → 결과 → 복기 ----------------

  /** 종료 강조 5초 대기 건너뛰기 (필드 클릭 / Space) */
  skipHighlight(): void {
    if (this.endStage !== 'HIGHLIGHT') return;
    this.setEndStage('RESULT');
  }

  /** 결과 팝업 닫기 → 복기 */
  closeResult(): void {
    if (this.endStage !== 'RESULT') return;
    this.setEndStage('REVIEW');
  }

  /** RESULT 버튼: 복기 중 결과 팝업 다시 열기 */
  openResult(): void {
    if (this.endStage !== 'REVIEW') return;
    this.stopPlayback();
    this.setEndStage('RESULT');
  }

  /** 단축키 사용 여부 (화면이 확인창 / 팝업을 띄운 동안 끔) */
  setShortcutsEnabled(enabled: boolean): void {
    this.shortcutsEnabled = enabled;
  }

  /**
   * 캔버스 버퍼 배율 변경 (09-6d: 화면 크기에 맞춰 캔버스 CSS 크기가 바뀌면 버퍼 = CSS px × devicePixelRatio,
   * 배율 = 버퍼 px / 논리 800 px). 다음 프레임에 다시 그림
   */
  setRenderScale(scale: number): void {
    if (!(scale > 0) || scale === this.dpr) return;
    this.dpr = scale;
    this.requestRender();
  }

  /**
   * 필드 편집 모드 장면 (명세서 3.8 필드 편집 모드, 09-10b): 경기 전(SETUP)에만 경기 장면 대신 그린다. null = 경기 장면으로.
   * 편집 데이터(명중 확률표 진행 등)가 바뀔 때마다 새 장면으로 다시 부른다. START(회전 시작)에서 자동으로 해제
   */
  setEditScene(scene: EditScene | null): void {
    if (scene && this.phase !== 'SETUP') return;
    if (scene === this.editScene) return;
    this.editScene = scene;
    this.requestRender();
  }

  /** 다시 그리기 요청 (예: 웹폰트 로드 완료 후 캔버스 글자 갱신). 여러 번 요청해도 다음 프레임에 한 번 */
  redraw(): void {
    this.requestRender();
  }

  dispose(): void {
    this.disposeLoop?.();
    this.disposeLoop = null;
    this.detachKeys?.();
    this.detachKeys = null;
    if (this.renderHandle !== null) this.scheduler.cancel(this.renderHandle);
    this.renderHandle = null;
  }

  /** 보는 틱 프레임 (읽기 전용, 진행 중에는 엔진 현재 틱) */
  currentFrame(): DeepReadonly<TimelineFrame> {
    return this.engine.getFrame(this.shownTick())!;
  }

  status(): AppStatus {
    const frame = this.currentFrame();
    const { hive } = frame.field;
    const head = this.headTick();
    return {
      phase: this.phase,
      alliance: this.alliance,
      matchView: this.matchView,
      viewAngle: this.animator.sample(this.now()).angle,
      loopState: this.loop.state,
      pauseReason: this.loop.pauseReason,
      autoPauseReason: this.autoPauseReason,
      tick: frame.tick,
      headTick: head,
      matchEnded: head >= MATCH_TICKS,
      canScrub: this.canScrub(),
      canResume: this.canResume(),
      canBranch: this.canBranch(),
      playing: this.playing,
      playbackSpeed: this.playbackSpeed,
      endStage: this.endStage,
      endSeq: this.endSeq,
      result: head >= MATCH_TICKS ? this.matchResult() : null,
      remainingSec: Math.max(0, (MATCH_TICKS - frame.tick) * DT),
      score: frame.totalScore,
      tipCount: hive.tipCount,
      autoTipCount: hive.autoTipCount,
      rp: { ...frame.rpAchieved },
      hitProbability: this.options.hitProbability ? hitProbabilities(frame, this.setup.shotResolver) : null,
      gamepads: this.adapter.gamepadStatus(),
      input: this.inputStatus(),
    };
  }

  // ---------------- 내부 ----------------

  private get alliance(): 'RED' | 'BLUE' {
    return this.setup.scenario.allianceColor;
  }

  /** 입력 선택을 입력 허브 / 어댑터에 적용 (START / RESUME / BRANCH 순간) */
  private applyInputChoices(): void {
    for (const robot of ['robot1', 'robot2'] as const) {
      const choice = this.matchChoices[robot];
      // REPLAY는 기록이 있을 때만 (없으면 NONE과 같지만 명시적으로 NONE)
      this.inputs.sources[robot] = choice === 'REPLAY' && this.inputs.logs[robot].length === 0 ? 'NONE' : choice;
      this.inputs.modes[robot] = this.driveModes[robot];
    }
    this.adapter.setKeyboardEnabled(this.keyboardEnabled);
  }

  private inputStatus(): InputStatus {
    const pads = this.adapter.gamepadStatus();
    const inMatch = this.phase !== 'SETUP';
    const map = <T,>(fn: (robot: RobotId) => T): Record<RobotId, T> => ({ robot1: fn('robot1'), robot2: fn('robot2') });
    return {
      choices: inMatch ? { ...this.matchChoices } : { ...this.setupChoices },
      autoPreview: map(robot => autoSource(robot, pads, this.keyboardEnabled)),
      sources: inMatch ? { ...this.inputs.sources } : map(robot => resolveSource(this.setupChoices[robot], robot, pads, this.keyboardEnabled)),
      hasLog: map(robot => this.inputs.logs[robot].length > 0),
      modes: { ...this.driveModes },
      activeModes: { ...this.inputs.modes },
      keyboardEnabled: this.keyboardEnabled,
      activeKeyboard: this.adapter.isKeyboardEnabled,
    };
  }

  private matchResult(): MatchResult | null {
    const end = this.engine.getFrame(MATCH_TICKS);
    if (!end?.scoreBreakdown) return null;
    const { hive } = end.field;
    return {
      total: end.totalScore,
      breakdown: end.scoreBreakdown,
      rp: { ...end.rpAchieved },
      tips: hive.autoTipCount + hive.tipCount,
      autoTips: hive.autoTipCount,
      teleopTips: hive.tipCount,
    };
  }

  /** 그릴 틱: 진행 중에는 엔진 머리, 그 외에는 보는 틱 */
  private shownTick(): number {
    return this.loop.state === 'RUNNING' ? this.engine.currentTick : this.viewTick;
  }

  /** 마지막 기록 틱: 진행 중에는 엔진 현재 틱, 그 외에는 기록된 마지막 프레임 (분기 직후 첫 틱 전에는 옛 기록 포함) */
  private headTick(): number {
    return this.loop.state === 'RUNNING' ? this.engine.currentTick : this.engine.timeline.length - 1;
  }

  private endBusy(): boolean {
    return this.endStage === 'HIGHLIGHT' || this.endStage === 'RESULT';
  }

  /** 보는 틱을 움직일 수 있는 상태: 경기 중 + 진행 중 아님 + 종료 강조 / 결과 팝업 아님 */
  private canScrub(): boolean {
    return this.phase === 'MATCH' && this.loop.state !== 'RUNNING' && !this.endBusy();
  }

  private canResume(): boolean {
    const head = this.headTick();
    return this.canScrub() && this.loop.state === 'PAUSED' && this.viewTick === head && head < MATCH_TICKS;
  }

  private canBranch(): boolean {
    return this.canScrub() && this.viewTick < this.headTick();
  }

  private setEndStage(stage: EndStage): void {
    this.endStage = stage;
    this.endStageAt = this.now();
    this.changed();
  }

  private newMatch(): void {
    this.disposeLoop?.();
    const { r1Config, r2Config, shotResolver, scenario, shooters } = this.setup;
    this.engine = new SimulationEngine(r1Config, r2Config, shotResolver, scenario.allianceColor, scenario, shooters);
    this.inputs = new MatchInputs(); // 출처 / 조작 모드는 START에서 선택을 풀어 적용 (09-8b)
    this.matchView = this.defaultView; // 새 경기는 SETTINGS 기본 보기 방향 (VIEW는 그 경기에서만)
    this.viewTick = 0;
    this.playing = false;
    this.playbackLast = null;
    this.endStage = 'NONE';
    this.endSeq = 0;
    this.autoPauseReason = null;
    this.lastToastAt = { robot1: -Infinity, robot2: -Infinity };
    const created = createBrowserRealtimeLoop(
      this.engine,
      this.inputs,
      {
        onFrame: stepped => {
          this.checkLiftToasts(stepped);
          this.renderNow();
        },
        onStateChange: (state, reason) => {
          // 진행이 멈추면 보는 틱 = 멈춘 틱. 6000틱 도달 → 종료 강조 시작
          if (state !== 'RUNNING') this.viewTick = this.engine.currentTick;
          this.autoPauseReason = state === 'PAUSED' && reason !== null && reason !== 'USER' ? reason : null;
          if (state === 'ENDED') {
            this.endSeq++;
            this.setEndStage('HIGHLIGHT');
          }
          this.emitStatus(true);
          this.requestRender();
        },
      },
      this.env,
      this.scheduler,
      { keyboardEnabled: this.keyboardEnabled },
    );
    this.loop = created.loop;
    this.adapter = created.adapter;
    this.disposeLoop = created.dispose;
  }

  /**
   * 상태별 키 공유 단축키 (명세서 3.8 키보드 단축키). 주행 키는 입력 어댑터가 루프 진행 중에만 쓰고,
   * 여기서는 Space(일시정지 / 재개 / 재생 / 재생 멈춤 / 종료 강조 건너뛰기)와 진행 중이 아닐 때 ← / →(1틱), Shift + ← / →(1초)를 처리한다.
   * 텍스트 입력칸에 초점이 있거나 단축키가 꺼져 있으면(확인창 / 팝업) 무시. Space는 분기하지 않는다.
   */
  private attachShortcuts(): void {
    const win = this.env?.window ?? (typeof window !== 'undefined' ? window : null);
    if (!win) return;
    const onKeyDown = (e: Event) => {
      const k = e as KeyboardEvent;
      if (!this.shortcutsEnabled || isEditableTarget(k.target)) return;
      if (k.code === 'Space') {
        k.preventDefault(); // 스크롤 / 초점 버튼 누름 방지
        if (!k.repeat) this.onSpace();
      } else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && this.canScrub()) {
        k.preventDefault();
        const step = k.shiftKey ? TICKS_PER_SECOND : 1;
        this.stepView(k.code === 'ArrowLeft' ? -step : step); // 키 자동 반복 = 연속 이동
      }
    };
    const onKeyUp = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.code === 'Space' && this.shortcutsEnabled && !isEditableTarget(k.target)) k.preventDefault();
    };
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    this.detachKeys = () => {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
    };
  }

  private onSpace(): void {
    if (this.phase !== 'MATCH') return;
    if (this.endStage === 'HIGHLIGHT') this.skipHighlight();
    else if (this.endStage === 'RESULT') return;
    else if (this.loop.state === 'RUNNING') this.pause();
    else if (this.playing) this.stopPlayback();
    else if (this.canResume()) this.resume();
    else this.play();
  }

  /**
   * 이번 프레임에 진행한 틱마다: 그 틱 시작 상태가 리프트 상태인데 LIVE 입력 기록의 주행 축(qx, qy, qω)이 0이 아니면 경고 토스트.
   * 입력 기록(양자화 후, 데드존 적용 뒤)을 읽으므로 스틱 떨림은 경고하지 않는다. 같은 로봇은 LIFT_TOAST_COOLDOWN_MS에 한 번
   */
  private checkLiftToasts(stepped: number): void {
    if (stepped <= 0) return;
    const now = this.now();
    const end = this.engine.currentTick;
    for (const robot of ['robot1', 'robot2'] as const) {
      if (this.inputs.sources[robot] !== 'LIVE' || now - this.lastToastAt[robot] < LIFT_TOAST_COOLDOWN_MS) continue;
      const log = this.inputs.logs[robot];
      for (let tick = Math.max(0, end - stepped); tick < end; tick++) {
        const state = this.engine.getFrame(tick)?.[robot === 'robot1' ? 'r1' : 'r2'].actionState;
        if (!state || !LIFT_STATES.has(state) || !log.has(tick)) continue;
        const at = tick * LOG_RECORD_BYTES;
        if (log.data[at] !== 0 || log.data[at + 1] !== 0 || log.data[at + 2] !== 0) {
          this.lastToastAt[robot] = now;
          this.onToast({ robot });
          break;
        }
      }
    }
  }

  private changed(): void {
    this.emitStatus(true);
    this.requestRender();
  }

  private emitStatus(force: boolean): void {
    const t = this.now();
    if (!force && t - this.lastStatusAt < this.statusIntervalMs) return;
    this.lastStatusAt = t;
    this.onStatus(this.status());
  }

  /** 루프가 돌지 않을 때 다음 애니메이션 프레임에 한 번 그림 (여러 요청은 하나로 모음) */
  private requestRender(): void {
    if (this.loop.state === 'RUNNING' || this.renderHandle !== null) return;
    this.renderHandle = this.scheduler.request(now => {
      this.renderHandle = null;
      this.advancePlayback(now);
      this.advanceEndStage();
      this.renderNow();
    });
  }

  /** 재생: 벽시계 경과 × 배속 × 50틱/초로 보는 틱을 옮기고, 마지막 기록 틱에 닿으면 멈춤 */
  private advancePlayback(now: number): void {
    if (!this.playing) return;
    const elapsed = this.playbackLast === null || !Number.isFinite(now) ? 0 : Math.max(0, now - this.playbackLast);
    if (Number.isFinite(now)) this.playbackLast = now;
    const head = this.headTick();
    this.playbackPos = Math.min(head, this.playbackPos + (elapsed / (DT * 1000)) * this.playbackSpeed);
    this.viewTick = Math.floor(this.playbackPos);
    if (this.viewTick >= head) {
      this.viewTick = head;
      this.playing = false;
      this.playbackLast = null;
      this.emitStatus(true);
    }
  }

  /** 종료 강조 5초가 지나면 결과 팝업 */
  private advanceEndStage(): void {
    if (this.endStage === 'HIGHLIGHT' && this.now() - this.endStageAt >= END_HIGHLIGHT_MS) this.setEndStage('RESULT');
  }

  private renderNow(): void {
    const view = this.animator.sample(this.now());
    if (this.editScene && this.phase === 'SETUP') {
      renderEditScene(this.ctx, this.editScene, view, this.dpr);
    } else {
      const frame = this.currentFrame();
      renderScene(this.ctx, { frame, r1Config: this.setup.r1Config, r2Config: this.setup.r2Config, view, options: this.options }, this.dpr);
    }

    if (!view.done || this.playing || this.endStage === 'HIGHLIGHT') {
      this.requestRender(); // 보기 애니메이션 / 재생 / 종료 강조 대기 중 (루프가 돌면 onFrame이 이어서 그림)
    } else if (this.phase === 'ROTATING_IN') {
      this.phase = 'MATCH';
      this.loop.start(); // 회전이 끝난 뒤에만 조종 시작
      this.emitStatus(true);
    } else if (this.phase === 'ROTATING_OUT') {
      this.phase = 'SETUP';
      this.emitStatus(true);
    }
    this.emitStatus(false);
  }
}
