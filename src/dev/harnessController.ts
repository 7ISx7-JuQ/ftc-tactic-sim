// 개발 하네스 컨트롤러 (명세서 3.7 개발 하네스, 08-7): React 비의존
// 정식 엔진 + 입력 허브(R1 / R2 LIVE) + 브라우저 실시간 루프 + 장면 렌더러를 한 화면에 연결한다.
// 경기 흐름: SETUP(관중석 시점, 진영 선택) → 시작 → ROTATING_IN(보기 회전, 루프 대기) → MATCH(루프 시작)
//           → 리셋 → ROTATING_OUT(관중석 시점으로 회전, 새 엔진) → SETUP
// 다시 그리기: 루프 RUNNING 중에는 onFrame마다, 그 외(일시정지 / 옵션 / 보기 애니메이션)에는 요청 시 rAF 1회로 모아서.
// 시계 / 프레임 스케줄러 / 브라우저 환경을 주입받아 Node에서 가짜 시간으로 테스트한다.

import { MATCH_TICKS, DT } from '../core/simulationEngine';
import type { SimulationEngine } from '../core/simulationEngine';
import type { DeepReadonly, TimelineFrame } from '../core/types';
import { createAnimationFrameScheduler, createBrowserRealtimeLoop } from '../input/browserInput';
import type { BrowserInputAdapter, BrowserInputEnv, GamepadSlotStatus } from '../input/browserInput';
import { MatchInputs } from '../input/inputLog';
import type { FrameScheduler, LoopState, PauseReason, RealtimeLoop } from '../input/realtimeLoop';
import { DEFAULT_RENDER_OPTIONS } from '../renderer/renderOptions';
import type { RenderOptions } from '../renderer/renderOptions';
import { renderScene } from '../renderer/sceneRenderer';
import { ViewAnimator, viewAngle } from '../renderer/viewTransform';
import type { ViewMode } from '../renderer/viewTransform';
import { DEV_ROBOT_CONFIGS, createDevEngine } from './devSetup';

export type HarnessPhase = 'SETUP' | 'ROTATING_IN' | 'MATCH' | 'ROTATING_OUT';

export interface HarnessStatus {
  phase: HarnessPhase;
  alliance: 'RED' | 'BLUE';
  matchView: ViewMode;          // 경기 중 보기 (경기 전 화면은 항상 관중석)
  viewAngle: number;            // 현재 표시 중인 보기 회전각 (rad, 애니메이션 중간값 포함)
  loopState: LoopState;
  pauseReason: PauseReason | null;
  tick: number;
  remainingSec: number;
  score: number;
  gamepads: GamepadSlotStatus[];
}

export interface HarnessDeps {
  ctx: CanvasRenderingContext2D; // 1200 × 800 논리 크기 × dpr 버퍼 캔버스
  dpr?: number;
  env?: BrowserInputEnv;
  scheduler?: FrameScheduler;
  now?: () => number;             // 보기 애니메이션용 벽시계 (ms)
  onStatus?: (status: HarnessStatus) => void;
  statusIntervalMs?: number;      // 진행 중 상태 알림 최소 간격 (기본 100 ms ≈ 10 Hz)
}

export class HarnessController {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private readonly env: BrowserInputEnv | undefined;
  private readonly scheduler: FrameScheduler;
  private readonly now: () => number;
  private readonly onStatus: (status: HarnessStatus) => void;
  private readonly statusIntervalMs: number;

  private alliance: 'RED' | 'BLUE' = 'RED';
  private matchView: ViewMode = 'DRIVER';
  private options: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  private phase: HarnessPhase = 'SETUP';
  private readonly animator = new ViewAnimator(0);

  private engine!: SimulationEngine;
  private loop!: RealtimeLoop;
  private adapter!: BrowserInputAdapter;
  private disposeLoop: (() => void) | null = null;

  private renderHandle: number | null = null;
  private lastStatusAt = -Infinity;

  constructor(deps: HarnessDeps) {
    this.ctx = deps.ctx;
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

  /** 진영 선택 (경기 전 화면에서만) */
  setAlliance(alliance: 'RED' | 'BLUE'): void {
    if (this.phase !== 'SETUP' || alliance === this.alliance) return;
    this.alliance = alliance;
    this.newMatch();
    this.changed();
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

  /** 리셋: 루프 정지, 새 엔진(0틱), 관중석 시점으로 반대로 회전 → 경기 전 화면 */
  reset(): void {
    if (this.phase === 'SETUP') return;
    this.newMatch();
    this.phase = 'ROTATING_OUT';
    this.animator.start(0, this.now());
    this.changed();
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

  status(): HarnessStatus {
    const tick = this.engine.currentTick;
    return {
      phase: this.phase,
      alliance: this.alliance,
      matchView: this.matchView,
      viewAngle: this.animator.sample(this.now()).angle,
      loopState: this.loop.state,
      pauseReason: this.loop.pauseReason,
      tick,
      remainingSec: Math.max(0, (MATCH_TICKS - tick) * DT),
      score: this.engine.getFrame(tick)?.totalScore ?? 0,
      gamepads: this.adapter.gamepadStatus(),
    };
  }

  // ---------------- 내부 ----------------

  private newMatch(): void {
    this.disposeLoop?.();
    this.engine = createDevEngine(this.alliance);
    const inputs = new MatchInputs(); // R1 / R2 모두 LIVE (게임패드 0 → R1, 게임패드 1 + 키보드 → R2)
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
    const { robot1, robot2 } = DEV_ROBOT_CONFIGS;
    renderScene(this.ctx, { frame, r1Config: robot1, r2Config: robot2, view, options: this.options, shotResolver: this.engine.shotResolver }, this.dpr);

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
