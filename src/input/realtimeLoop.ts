// ============================================================
// 실시간 루프 컨트롤러 (명세서 3.6항)
// requestAnimationFrame 프레임마다 경과 시간을 누산해 20 ms마다 1틱 소비 (입력 결정 → engine.step).
// DOM 비의존: 프레임 스케줄러를 주입받으며(브라우저는 requestAnimationFrame, Step 07-6), 테스트는 가짜 시간을 쓴다.
// ============================================================

import { MATCH_TICKS } from '../core/simulationEngine';
import type { SimulationEngine } from '../core/simulationEngine';
import { MAX_CATCHUP_TICKS, TICK_MS } from './inputConfig';
import type { MatchInputs } from './inputLog';
import type { LiveControlSource } from './liveControls';

// 프레임 스케줄러 (브라우저: requestAnimationFrame / cancelAnimationFrame, 콜백 인자 = 타임스탬프 ms)
export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

// READY: 시작 전 / RUNNING: 진행 중 / PAUSED: 일시정지 / ENDED: 경기 종료(6000틱)
export type LoopState = 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED';
// USER: 사용자 조작 / HIDDEN: 탭 숨김 / BLUR: 창 포커스 소실 / GAMEPAD_DISCONNECTED: 배정된 게임패드 연결 해제
export type PauseReason = 'USER' | 'HIDDEN' | 'BLUR' | 'GAMEPAD_DISCONNECTED';

export interface RealtimeLoopHooks {
  onFrame?: (ticksStepped: number) => void;                       // 프레임 처리 후 (렌더링 연결용, Step 8)
  onStateChange?: (state: LoopState, reason: PauseReason | null) => void;
}

export class RealtimeLoop {
  private loopState: LoopState = 'READY';
  private reason: PauseReason | null = null;
  private handle: number | null = null;
  private lastTime: number | null = null; // null = 다음 프레임은 경과 시간 0 (시작 / 재개 직후)
  private accumulated = 0;                // 누산 시간 (ms)

  private readonly engine: SimulationEngine;
  private readonly inputs: MatchInputs;
  private readonly controls: LiveControlSource;
  private readonly scheduler: FrameScheduler;
  private readonly hooks: RealtimeLoopHooks;

  constructor(
    engine: SimulationEngine,
    inputs: MatchInputs,
    controls: LiveControlSource,
    scheduler: FrameScheduler,
    hooks: RealtimeLoopHooks = {},
  ) {
    this.engine = engine;
    this.inputs = inputs;
    this.controls = controls;
    this.scheduler = scheduler;
    this.hooks = hooks;
  }

  get state(): LoopState {
    return this.loopState;
  }

  get pauseReason(): PauseReason | null {
    return this.reason;
  }

  // 엔진 현재 틱(초기 / 되감은 틱)부터 진행 시작
  start(): void {
    if (this.loopState !== 'READY') return;
    this.run();
  }

  // 일시정지: 루프 정지, 누산 시간 0, 입력 누적기 초기화. 엔진은 마지막으로 완료한 틱에 멈춤
  pause(reason: PauseReason = 'USER'): void {
    if (this.loopState !== 'RUNNING') return;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.accumulated = 0;
    this.lastTime = null;
    this.controls.reset();
    this.setState('PAUSED', reason);
  }

  // 재개: 사용자의 명시적 조작으로만. 일시정지된 틱(또는 그사이 되감은 틱)에서 이어가며 첫 프레임은 경과 시간 0
  resume(): void {
    if (this.loopState !== 'PAUSED') return;
    this.run();
  }

  // 시작 / 재개: 입력 누적기도 비워 일시정지 중 탭이 재개 직후 발동하지 않게 함
  // (누르고 있는 입력은 다음 프레임 poll()에서 다시 샘플되어 이어짐)
  private run(): void {
    this.accumulated = 0;
    this.lastTime = null;
    this.controls.reset();
    if (this.engine.currentTick >= MATCH_TICKS) {
      this.setState('ENDED', null);
      return;
    }
    this.setState('RUNNING', null);
    this.handle = this.scheduler.request(this.onFrame);
  }

  private readonly onFrame = (now: number): void => {
    this.handle = null;
    if (this.loopState !== 'RUNNING') return;

    const elapsed = this.lastTime === null || !Number.isFinite(now) ? 0 : Math.max(0, now - this.lastTime);
    if (Number.isFinite(now)) this.lastTime = now;
    this.accumulated += elapsed;

    this.controls.poll?.();
    let stepped = 0;
    while (this.accumulated >= TICK_MS && stepped < MAX_CATCHUP_TICKS && this.engine.currentTick < MATCH_TICKS) {
      this.inputs.step(this.engine, this.controls.consumeTick());
      this.accumulated -= TICK_MS;
      stepped++;
    }
    // 따라잡기 상한에 걸려 1틱 이상 밀려 있으면 밀린 시간을 버림 (게임 시간이 잠깐 느려짐, 틱별 입력 기록으로 결정론 유지)
    if (this.accumulated >= TICK_MS) this.accumulated = 0;

    if (this.engine.currentTick >= MATCH_TICKS) {
      this.setState('ENDED', null);
    } else {
      this.handle = this.scheduler.request(this.onFrame);
    }
    this.hooks.onFrame?.(stepped);
  };

  private setState(state: LoopState, reason: PauseReason | null): void {
    this.loopState = state;
    this.reason = reason;
    this.hooks.onStateChange?.(state, reason);
  }
}
