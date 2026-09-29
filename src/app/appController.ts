// 앱 컨트롤러 (명세서 3.8 기본 원칙 / 앱 상태 흐름, 09-6c): React 비의존
// 엔진 / 입력 허브 / 브라우저 실시간 루프 / 장면 렌더러를 소유하고, React는 약 10 Hz 상태 알림만 구독한다.
// 08-7 개발 하네스 컨트롤러를 일반화: 경기 설정(로봇 제원 2개 / 판정 함수 / 시나리오 / 슈터 탄도)을 코드에 고정하지 않고
// 밖에서 주입받는다 (09-6d까지는 하네스 고정 설정, 09-8 이후 config 창의 적용된 설정).
// 경기 흐름 (09-6c 범위 = 하네스 수준, 분기 / 재생 / 결과 등은 09-7):
//   SETUP(관중석 시점, 설정 교체 가능) → 시작 → ROTATING_IN(보기 회전, 루프 READY 유지) → 회전 완료 프레임에 loop.start() → MATCH
//   → 리셋 → ROTATING_OUT(관중석 시점으로 회전, 같은 설정으로 0틱 새 엔진) → SETUP
// 다시 그리기: 루프 RUNNING 중에는 onFrame마다, 그 외(일시정지 / 옵션 / 보기 애니메이션)에는 요청을 rAF 1회로 모아서.
// 시계 / 프레임 스케줄러 / 브라우저 환경을 주입받아 Node에서 가짜 시간으로 테스트한다.

import { DT, MATCH_TICKS, SimulationEngine } from '../core/simulationEngine';
import type {
  DeepReadonly,
  MatchShooterBallistics,
  RobotConfig,
  RPState,
  ScenarioConfig,
  ShotProbabilityResolver,
  TimelineFrame,
} from '../core/types';
import { createAnimationFrameScheduler, createBrowserRealtimeLoop } from '../input/browserInput';
import type { BrowserInputAdapter, BrowserInputEnv, GamepadSlotStatus } from '../input/browserInput';
import { MatchInputs } from '../input/inputLog';
import type { FrameScheduler, LoopState, PauseReason, RealtimeLoop } from '../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS, hitProbabilities } from '../renderer/renderOptions';
import type { RenderOptions, RobotHitProbability } from '../renderer/renderOptions';
import { renderScene } from '../renderer/sceneRenderer';
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

export interface AppStatus {
  phase: AppPhase;
  alliance: 'RED' | 'BLUE';
  matchView: ViewMode;          // 경기 중 보기 (경기 전 화면은 항상 관중석)
  viewAngle: number;            // 현재 표시 중인 보기 회전각 (rad, 애니메이션 중간값 포함)
  loopState: LoopState;
  pauseReason: PauseReason | null;
  tick: number;
  remainingSec: number;
  score: number;                // 확정 점수 (경기 중 = 텔레옵 TIP × 20, 종료 프레임 = 최종 합계)
  tipCount: number;             // 텔레옵 TIP 횟수
  autoTipCount: number;         // 오토 TIP 횟수 (좌측 패널 TIP 표시 = 오토 + 텔레옵, 점수에는 미포함)
  rp: RPState;
  // 표시 옵션 hitProbability가 켜져 있을 때만 (좌측 패널 명중 확률, 상태 알림마다 판정 함수 4회 호출), 꺼져 있으면 null
  hitProbability: Record<'robot1' | 'robot2', RobotHitProbability> | null;
  gamepads: GamepadSlotStatus[];
}

export interface AppControllerDeps {
  ctx: CanvasRenderingContext2D;  // 800 × 800 논리 크기(필드 뷰포트) × dpr 버퍼 캔버스
  setup: MatchSetup;
  dpr?: number;
  env?: BrowserInputEnv;
  scheduler?: FrameScheduler;
  now?: () => number;             // 보기 애니메이션용 벽시계 (ms)
  onStatus?: (status: AppStatus) => void;
  statusIntervalMs?: number;      // 진행 중 상태 알림 최소 간격 (기본 100 ms ≈ 10 Hz)
}

export class AppController {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr: number;
  private readonly env: BrowserInputEnv | undefined;
  private readonly scheduler: FrameScheduler;
  private readonly now: () => number;
  private readonly onStatus: (status: AppStatus) => void;
  private readonly statusIntervalMs: number;

  private setup: MatchSetup;
  private matchView: ViewMode = 'DRIVER';
  private options: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  private phase: AppPhase = 'SETUP';
  private readonly animator = new ViewAnimator(0);

  private engine!: SimulationEngine;
  private loop!: RealtimeLoop;
  private adapter!: BrowserInputAdapter;
  private disposeLoop: (() => void) | null = null;

  private renderHandle: number | null = null;
  private lastStatusAt = -Infinity;

  constructor(deps: AppControllerDeps) {
    this.ctx = deps.ctx;
    this.setup = deps.setup;
    this.dpr = deps.dpr ?? 1;
    this.env = deps.env;
    this.scheduler = deps.scheduler ?? createAnimationFrameScheduler();
    this.now = deps.now ?? (() => performance.now());
    this.onStatus = deps.onStatus ?? (() => {});
    this.statusIntervalMs = deps.statusIntervalMs ?? 100;
    this.newMatch();
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

  /** 경기 중 보기 (DRIVER / AUDIENCE). 경기 중이면 회전 애니메이션, 경기 전이면 설정만 */
  setMatchView(mode: ViewMode): void {
    if (mode === this.matchView) return;
    this.matchView = mode;
    if (this.phase === 'MATCH' || this.phase === 'ROTATING_IN') this.animator.start(viewAngle(mode, this.alliance), this.now());
    this.changed();
  }

  setOptions(options: RenderOptions): void {
    this.options = { ...options };
    this.changed();
  }

  /** 시작: 보기 회전 애니메이션이 끝난 뒤 실시간 루프 시작 (회전 중 조종 방지) */
  start(): void {
    if (this.phase !== 'SETUP') return;
    this.phase = 'ROTATING_IN';
    this.animator.start(viewAngle(this.matchView, this.alliance), this.now());
    this.changed();
  }

  pause(): void {
    this.loop.pause('USER');
  }

  resume(): void {
    this.loop.resume();
  }

  /** 리셋: 루프 정지, 같은 설정으로 새 엔진(0틱), 관중석 시점으로 반대로 회전 → 경기 전 화면 */
  reset(): void {
    if (this.phase === 'SETUP') return;
    this.newMatch();
    this.phase = 'ROTATING_OUT';
    this.animator.start(0, this.now());
    this.changed();
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

  /** 다시 그리기 요청 (예: 웹폰트 로드 완료 후 캔버스 글자 갱신). 여러 번 요청해도 다음 프레임에 한 번 */
  redraw(): void {
    this.requestRender();
  }

  dispose(): void {
    this.disposeLoop?.();
    this.disposeLoop = null;
    if (this.renderHandle !== null) this.scheduler.cancel(this.renderHandle);
    this.renderHandle = null;
  }

  /** 현재 틱 프레임 (읽기 전용) */
  currentFrame(): DeepReadonly<TimelineFrame> {
    return this.engine.getFrame(this.engine.currentTick)!;
  }

  status(): AppStatus {
    const frame = this.currentFrame();
    const { hive } = frame.field;
    return {
      phase: this.phase,
      alliance: this.alliance,
      matchView: this.matchView,
      viewAngle: this.animator.sample(this.now()).angle,
      loopState: this.loop.state,
      pauseReason: this.loop.pauseReason,
      tick: frame.tick,
      remainingSec: Math.max(0, (MATCH_TICKS - frame.tick) * DT),
      score: frame.totalScore,
      tipCount: hive.tipCount,
      autoTipCount: hive.autoTipCount,
      rp: { ...frame.rpAchieved },
      hitProbability: this.options.hitProbability ? hitProbabilities(frame, this.setup.shotResolver) : null,
      gamepads: this.adapter.gamepadStatus(),
    };
  }

  // ---------------- 내부 ----------------

  private get alliance(): 'RED' | 'BLUE' {
    return this.setup.scenario.allianceColor;
  }

  private newMatch(): void {
    this.disposeLoop?.();
    const { r1Config, r2Config, shotResolver, scenario, shooters } = this.setup;
    this.engine = new SimulationEngine(r1Config, r2Config, shotResolver, scenario.allianceColor, scenario, shooters);
    const inputs = new MatchInputs(); // R1 / R2 모두 LIVE (게임패드 0 → R1, 게임패드 1 + 키보드 → R2), 출처 규칙은 09-8
    const created = createBrowserRealtimeLoop(
      this.engine,
      inputs,
      {
        onFrame: () => this.renderNow(),
        onStateChange: () => {
          this.emitStatus(true);
          this.requestRender();
        },
      },
      this.env,
      this.scheduler,
    );
    this.loop = created.loop;
    this.adapter = created.adapter;
    this.disposeLoop = created.dispose;
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
    this.renderHandle = this.scheduler.request(() => {
      this.renderHandle = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    const view = this.animator.sample(this.now());
    const frame = this.currentFrame();
    renderScene(this.ctx, { frame, r1Config: this.setup.r1Config, r2Config: this.setup.r2Config, view, options: this.options }, this.dpr);

    if (!view.done) {
      this.requestRender(); // 보기 애니메이션 진행 중 (루프가 돌면 onFrame이 이어서 그림)
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
