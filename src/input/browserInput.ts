// ============================================================
// 브라우저 입력 어댑터 (명세서 3.6항, Step 07-6)
// Gamepad API 폴링 / 키보드 이벤트 / requestAnimationFrame / 포커스·가시성·패드 분리 이벤트를
// 입력 수집기(LiveControlCollector)와 실시간 루프(RealtimeLoop)에 연결하는 얇은 층.
// 브라우저 전역 대신 환경 객체를 주입받을 수 있어 Node 테스트에서도 가짜 이벤트로 검증한다.
// ============================================================

import type { SimulationEngine } from '../core/simulationEngine';
import type { GamepadSnapshot, TickControls } from './controls';
import { DEVICE_ASSIGNMENT, KEYBOARD_BINDINGS, KEYBOARD_ENABLED } from './inputConfig';
import type { RobotId } from './inputConfig';
import type { MatchInputs } from './inputLog';
import { LiveControlCollector } from './liveControls';
import type { LiveControlSource } from './liveControls';
import { RealtimeLoop } from './realtimeLoop';
import type { FrameScheduler, PauseReason, RealtimeLoopHooks } from './realtimeLoop';

// 게임패드 슬롯 상태 (연결 표시용, Step 9 GUI)
export interface GamepadSlotStatus {
  slot: number;
  robot: RobotId;
  connected: boolean;
  id: string | null;       // 브라우저가 알려주는 패드 이름
  standard: boolean;       // mapping === 'standard' (아니면 매핑이 다를 수 있어 경고)
}

// 필요한 브라우저 기능만 (window / document / navigator 또는 테스트용 가짜)
export interface BrowserInputEnv {
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: string };
  navigator: { getGamepads?: () => readonly (GamepadLike | null)[] };
}

export interface GamepadLike extends GamepadSnapshot {
  readonly index: number;
  readonly id: string;
  readonly mapping: string;
  readonly connected: boolean;
}

export interface BrowserInputOptions {
  assignment?: typeof DEVICE_ASSIGNMENT;
  keyboardEnabled?: boolean;
}

const BOUND_KEYS: ReadonlySet<string> = new Set(Object.values(KEYBOARD_BINDINGS));

// 입력 폼에 포커스가 있으면 키 입력을 가로채지 않음 (설정 입력 중 조작 방지)
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// requestAnimationFrame 기반 프레임 스케줄러
export function createAnimationFrameScheduler(
  win: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'> = window,
): FrameScheduler {
  return {
    request: cb => win.requestAnimationFrame(cb),
    cancel: id => win.cancelAnimationFrame(id),
  };
}

export class BrowserInputAdapter implements LiveControlSource {
  readonly collector: LiveControlCollector;
  private readonly keys = new Set<string>(); // 현재 눌린 매핑 키 (event.code)
  private readonly assignment: typeof DEVICE_ASSIGNMENT;
  private readonly keyboardEnabled: boolean;
  private readonly env: BrowserInputEnv;
  private detachFn: (() => void) | null = null;

  constructor(env: BrowserInputEnv, options: BrowserInputOptions = {}) {
    this.env = env;
    this.assignment = options.assignment ?? DEVICE_ASSIGNMENT;
    this.keyboardEnabled = options.keyboardEnabled ?? KEYBOARD_ENABLED;
    this.collector = new LiveControlCollector(this.assignment, this.keyboardEnabled);
  }

  // 이벤트 연결. onPause: 탭 숨김 / 포커스 소실 / 배정된 게임패드 분리 시 호출 (보통 loop.pause)
  attach(onPause: (reason: PauseReason) => void): () => void {
    this.detach();
    const { window: win, document: doc } = this.env;

    const onKeyDown = (e: Event) => {
      const k = e as KeyboardEvent;
      if (!this.keyboardEnabled || !BOUND_KEYS.has(k.code) || isEditableTarget(k.target)) return;
      k.preventDefault();                   // 방향키 스크롤, Firefox '/' 빠른 찾기 방지
      if (k.repeat || this.keys.has(k.code)) return; // 자동 반복은 새 눌림이 아님
      this.keys.add(k.code);
      this.collector.sampleKeyboard(this.keys);
    };
    const onKeyUp = (e: Event) => {
      const k = e as KeyboardEvent;
      if (!this.keys.delete(k.code)) return;
      this.collector.sampleKeyboard(this.keys);
    };
    // 포커스를 잃으면 키를 뗀 이벤트가 이 페이지로 오지 않으므로 눌린 키를 모두 비우고 일시정지
    const onBlur = () => {
      this.clearKeys();
      onPause('BLUR');
    };
    const onVisibility = () => {
      if (doc.visibilityState !== 'hidden') return;
      this.clearKeys();
      onPause('HIDDEN');
    };
    const onGamepadDisconnected = (e: Event) => {
      const index = (e as GamepadEvent).gamepad?.index;
      if (index === undefined || !(index in this.assignment.gamepads)) return;
      this.collector.sampleGamepad(index, null);
      onPause('GAMEPAD_DISCONNECTED');
    };

    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', onBlur);
    win.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    doc.addEventListener('visibilitychange', onVisibility);

    this.detachFn = () => {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      doc.removeEventListener('visibilitychange', onVisibility);
    };
    return () => this.detach();
  }

  detach(): void {
    this.detachFn?.();
    this.detachFn = null;
  }

  // 프레임 시작 시 (RealtimeLoop가 틱 소비 전에 호출): 배정된 게임패드 폴링 + 키 상태 재샘플
  poll(): void {
    const pads = this.readGamepads();
    for (const slot of Object.keys(this.assignment.gamepads).map(Number)) {
      const pad = pads[slot];
      this.collector.sampleGamepad(slot, pad && pad.connected ? pad : null);
    }
    this.collector.sampleKeyboard(this.keys);
  }

  consumeTick(): Record<RobotId, TickControls> {
    return this.collector.consumeTick();
  }

  // 일시정지 / 재개 시 루프가 호출: 누적 에지 / 레벨 초기화 (눌린 키 집합은 유지 → 다음 poll에서 복원)
  reset(): void {
    this.collector.reset();
  }

  // 배정된 슬롯별 연결 상태 (슬롯 오름차순)
  gamepadStatus(): GamepadSlotStatus[] {
    const pads = this.readGamepads();
    return Object.entries(this.assignment.gamepads)
      .map(([slot, robot]) => {
        const pad = pads[Number(slot)];
        const connected = !!pad && pad.connected;
        return {
          slot: Number(slot),
          robot,
          connected,
          id: connected ? pad!.id : null,
          standard: connected ? pad!.mapping === 'standard' : false,
        };
      })
      .sort((a, b) => a.slot - b.slot);
  }

  private readGamepads(): readonly (GamepadLike | null)[] {
    try {
      return this.env.navigator.getGamepads?.() ?? [];
    } catch {
      return [];                            // 보안 정책 등으로 Gamepad API를 쓸 수 없는 환경
    }
  }

  private clearKeys(): void {
    this.keys.clear();
    this.collector.sampleKeyboard(this.keys);
  }
}

// 엔진 + 입력 허브에 브라우저 입력과 실시간 루프를 연결 (화면 연결은 Step 8)
export function createBrowserRealtimeLoop(
  engine: SimulationEngine,
  inputs: MatchInputs,
  hooks: RealtimeLoopHooks = {},
  env: BrowserInputEnv = { window, document, navigator },
  scheduler: FrameScheduler = createAnimationFrameScheduler(),
  options: BrowserInputOptions = {},
): { loop: RealtimeLoop; adapter: BrowserInputAdapter; dispose: () => void } {
  const adapter = new BrowserInputAdapter(env, options);
  const loop = new RealtimeLoop(engine, inputs, adapter, scheduler, hooks);
  adapter.attach(reason => loop.pause(reason));
  return {
    loop,
    adapter,
    dispose: () => {
      loop.pause('USER');
      adapter.detach();
    },
  };
}
