// ============================================================
// 입력 계층 순수 변환 (명세서 3.6항)
// 장치 원시 입력 → 논리 조작(ControlSample) → 탭 래치(TickControls) → 장치 합성
// → 필드 좌표 정규화 속도 + 행동 요청(DriveCommand) → 8비트 부호화 / 복호화(RobotDriveInput)
// DOM 비의존: 브라우저 어댑터(Step 07-6)가 원시 상태를 넘겨주고, 테스트는 직접 만든 값을 넣는다.
// ============================================================

import type { RobotDriveInput } from '../core/simulationEngine';
import type { ActionRequest, RobotConfig, RobotState } from '../core/types';
import {
  DEADZONE_LEFT,
  DEADZONE_RIGHT_X,
  DEVICE_ASSIGNMENT,
  GAMEPAD_AXES,
  GAMEPAD_BUTTONS,
  KEYBOARD_BINDINGS,
  KEYBOARD_ENABLED,
  QUANT_MAX,
  TRIGGER_THRESHOLD,
} from './inputConfig';
import type { ControlButton, DriveMode, GamepadAxisBinding, GamepadButtonBinding, RobotId } from './inputConfig';

// ============================================================
// 1. 타입
// ============================================================

// 한 장치의 논리 조작 상태 (드라이버 기준, 데드존 / 정규화 적용 후)
export interface ControlSample {
  forward: number; // 전진 + (스틱 위 / W), [-1, 1]
  right: number;   // 오른쪽 + (스틱 오른쪽 / D), [-1, 1]
  turn: number;    // 오른쪽 회전 + (우스틱 오른쪽 / →), [-1, 1]
  intake: boolean;
  shoot: boolean;
  lift: boolean;
  drop: boolean;
}

// 틱 1개에 쓰는 조작 (탭 래치 적용 후)
export interface TickControls {
  forward: number;
  right: number;
  turn: number;
  intake: boolean;      // 유지형: 현재 눌림 OR 직전 틱 이후 눌림 에지
  shoot: boolean;
  drop: boolean;
  liftPressed: boolean; // 토글형: 직전 틱 이후 눌림 에지 1회 이상
}

// Gamepad API 객체의 필요한 부분만 (DOM Gamepad가 구조적으로 만족)
export interface GamepadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

export interface DriverSettings {
  alliance: 'RED' | 'BLUE';
  mode: DriveMode;
}

// 틱별 조작 명령 (필드 좌표 정규화 속도 + 행동 요청), 부호화 전 값
export interface DriveCommand {
  ux: number; // targetVx / maxSpeed
  uy: number; // targetVy / maxSpeed
  uw: number; // targetOmega / maxTurnRate
  request: ActionRequest;
}

// 8비트 부호화 결과: [qx, qy, qω, action] (로봇별 틱당 4바이트)
export type EncodedDriveInput = readonly [number, number, number, number];

export const NEUTRAL_SAMPLE: Readonly<ControlSample> = {
  forward: 0, right: 0, turn: 0, intake: false, shoot: false, lift: false, drop: false,
};

export const NEUTRAL_TICK: Readonly<TickControls> = {
  forward: 0, right: 0, turn: 0, intake: false, shoot: false, drop: false, liftPressed: false,
};

const CONTROL_BUTTONS: readonly ControlButton[] = ['intake', 'shoot', 'lift', 'drop'];

// 부호화 행동 코드 (인덱스 = 코드). 저장 형식이므로 순서를 바꾸지 말 것
export const ACTION_CODES: readonly ActionRequest[] = ['IDLE', 'INTAKING', 'SHOOTING', 'FLOWER_SETUP', 'FLOWER_DROPPING'];

function finiteOr0(v: number | undefined): number {
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, finiteOr0(v)));
}

// ============================================================
// 2. 장치 → 논리 조작 (축 처리)
// ============================================================

// 좌스틱 원형 데드존: 크기 < dz면 0, 아니면 크기를 (min(m, 1) − dz) / (1 − dz)로 재조정 (방향 유지, 크기 ≤ 1)
export function applyRadialDeadzone(x: number, y: number, deadzone = DEADZONE_LEFT): { x: number; y: number } {
  const fx = finiteOr0(x);
  const fy = finiteOr0(y);
  const m = Math.hypot(fx, fy);
  if (m < deadzone || m === 0) return { x: 0, y: 0 };
  const scale = (Math.min(m, 1) - deadzone) / (1 - deadzone) / m;
  return { x: fx * scale, y: fy * scale };
}

// 축 데드존 (우스틱 X): |v| < dz면 0, 아니면 같은 방식으로 재조정
export function applyAxialDeadzone(v: number, deadzone = DEADZONE_RIGHT_X): number {
  const fv = finiteOr0(v);
  const m = Math.abs(fv);
  if (m < deadzone) return 0;
  return Math.sign(fv) * (Math.min(m, 1) - deadzone) / (1 - deadzone);
}

function readAxis(pad: GamepadSnapshot, binding: GamepadAxisBinding): number {
  const v = finiteOr0(pad.axes[binding.index]);
  return binding.invert ? -v : v;
}

function readButton(pad: GamepadSnapshot, binding: GamepadButtonBinding): boolean {
  const button = pad.buttons[binding.index];
  if (!button) return false;
  return binding.analog ? finiteOr0(button.value) >= TRIGGER_THRESHOLD : button.pressed === true;
}

export function readGamepad(pad: GamepadSnapshot): ControlSample {
  const left = applyRadialDeadzone(readAxis(pad, GAMEPAD_AXES.right), readAxis(pad, GAMEPAD_AXES.forward));
  return {
    forward: left.y,
    right: left.x,
    turn: applyAxialDeadzone(readAxis(pad, GAMEPAD_AXES.turn)),
    intake: readButton(pad, GAMEPAD_BUTTONS.intake),
    shoot: readButton(pad, GAMEPAD_BUTTONS.shoot),
    lift: readButton(pad, GAMEPAD_BUTTONS.lift),
    drop: readButton(pad, GAMEPAD_BUTTONS.drop),
  };
}

// 키보드: 눌린 키 코드 집합 → ±1 입력, 동시 이동은 크기 1로 정규화 (대각선 0.707)
export function readKeyboard(down: ReadonlySet<string>): ControlSample {
  const k = KEYBOARD_BINDINGS;
  const axis = (plus: string, minus: string) => (down.has(plus) ? 1 : 0) - (down.has(minus) ? 1 : 0);
  let forward = axis(k.forward, k.backward);
  let right = axis(k.right, k.left);
  const m = Math.hypot(forward, right);
  if (m > 1) {
    forward /= m;
    right /= m;
  }
  return {
    forward,
    right,
    turn: axis(k.turnRight, k.turnLeft),
    intake: down.has(k.intake),
    shoot: down.has(k.shoot),
    lift: down.has(k.lift),
    drop: down.has(k.drop),
  };
}

// ============================================================
// 3. 짧은 탭 래치 (장치별 1개)
// ============================================================

// 원시 입력이 바뀔 때마다 sample()(게임패드 폴링 / 키 이벤트), 틱을 소비할 때 consume().
// 20 ms 안에 눌렀다 뗀 입력도 다음 틱에 1회 반영되고, 한 프레임에 여러 틱을 소비하면 에지는 첫 틱에만 적용된다.
export class ControlLatch {
  private level: ControlSample = { ...NEUTRAL_SAMPLE };
  private edges: Record<ControlButton, boolean> = { intake: false, shoot: false, lift: false, drop: false };

  sample(next: ControlSample): void {
    for (const b of CONTROL_BUTTONS) {
      if (next[b] && !this.level[b]) this.edges[b] = true;
    }
    this.level = { ...next };
  }

  consume(): TickControls {
    const { level, edges } = this;
    const tick: TickControls = {
      forward: level.forward,
      right: level.right,
      turn: level.turn,
      intake: level.intake || edges.intake,
      shoot: level.shoot || edges.shoot,
      drop: level.drop || edges.drop,
      liftPressed: edges.lift,
    };
    this.edges = { intake: false, shoot: false, lift: false, drop: false };
    return tick;
  }

  // 일시정지 / 포커스 소실: 키 상태와 누적 에지를 모두 버림 (뗀 이벤트 유실로 눌린 채 남는 것 방지)
  reset(): void {
    this.level = { ...NEUTRAL_SAMPLE };
    this.edges = { intake: false, shoot: false, lift: false, drop: false };
  }
}

// ============================================================
// 4. 장치 배정 / 합성
// ============================================================

// 로봇에 배정된 장치 (키보드 비활성화 시 제외)
export function assignedDevices(
  robot: RobotId,
  assignment = DEVICE_ASSIGNMENT,
  keyboardEnabled = KEYBOARD_ENABLED,
): { gamepadSlots: number[]; keyboard: boolean } {
  const gamepadSlots = Object.entries(assignment.gamepads)
    .filter(([, id]) => id === robot)
    .map(([slot]) => Number(slot))
    .sort((a, b) => a - b);
  return { gamepadSlots, keyboard: keyboardEnabled && assignment.keyboard === robot };
}

// 한 로봇에 배정된 여러 장치 합성: 축은 채널별로 절댓값이 큰 값(같으면 앞 장치), 유지형 버튼 OR, 토글 에지 OR
export function mergeTickControls(list: readonly TickControls[]): TickControls {
  const pick = (key: 'forward' | 'right' | 'turn') =>
    list.reduce((best, c) => (Math.abs(c[key]) > Math.abs(best) ? c[key] : best), 0);
  return {
    forward: pick('forward'),
    right: pick('right'),
    turn: pick('turn'),
    intake: list.some(c => c.intake),
    shoot: list.some(c => c.shoot),
    drop: list.some(c => c.drop),
    liftPressed: list.some(c => c.liftPressed),
  };
}

// ============================================================
// 5. 드라이버 기준 → 필드 좌표 정규화 속도
// ============================================================

// FIELD: 드라이버는 아군 벽에서 필드 안쪽을 봄 (RED x = 0 벽 → +x, BLUE x = 144 벽 → −x)
// ROBOT: 헤딩 h 기준 (앞 = (cos h, sin h), 오른쪽 = (−sin h, cos h), 캔버스 y-down)
// 합성 결과가 단위원을 넘으면(예: 패드 오른쪽 + 키보드 전진) 크기 1로 제한
export function driverToField(
  forward: number,
  right: number,
  settings: DriverSettings,
  heading: number,
): { ux: number; uy: number } {
  let f = clampUnit(forward);
  let s = clampUnit(right);
  const m = Math.hypot(f, s);
  if (m > 1) {
    f /= m;
    s /= m;
  }
  if (settings.mode === 'ROBOT') {
    const h = finiteOr0(heading);
    const c = Math.cos(h);
    const n = Math.sin(h);
    return { ux: f * c - s * n, uy: f * n + s * c };
  }
  return settings.alliance === 'RED' ? { ux: f, uy: s } : { ux: -f, uy: -s };
}

// ============================================================
// 6. 행동 요청 결정 (리프트 토글은 엔진 상태에서 유도)
// ============================================================

// prev = 직전 프레임(현재 틱 상태)의 로봇 actionState. 토글 값을 따로 저장하지 않으므로
// 엔진이 요청을 거부 / 무효 판정하면 다음 틱의 리프트 의도도 자동으로 엔진 상태를 따른다.
export function resolveActionRequest(prev: RobotState['actionState'], c: TickControls): ActionRequest {
  switch (prev) {
    case 'FLOWER_SETUP':
    case 'FLOWER_READY':
    case 'FLOWER_DROPPING': {
      // 리프트 상태: RT / LT 무시. A 에지는 올림 / 대기 중에만 내림 요청, 투입 중에는 무효
      const lowering = c.liftPressed && prev !== 'FLOWER_DROPPING';
      if (lowering) return 'IDLE';
      return c.drop ? 'FLOWER_DROPPING' : 'FLOWER_SETUP';
    }
    case 'IDLE':
    case 'INTAKING':
      // 우선순위 SHOOTING > (FLOWER_DROPPING: 리프트가 내려가 있어 무효) > FLOWER_SETUP > INTAKING
      if (c.shoot) return 'SHOOTING';
      if (c.liftPressed) return 'FLOWER_SETUP';
      if (c.intake) return 'INTAKING';
      return 'IDLE';
    default:
      // SHOOTING / FLOWER_LOWERING: A / B 무효
      if (c.shoot) return 'SHOOTING';
      if (c.intake) return 'INTAKING';
      return 'IDLE';
  }
}

// 틱 조작 + 직전 로봇 상태 → 조작 명령 (부호화 전)
export function buildDriveCommand(
  c: TickControls,
  robot: Pick<RobotState, 'actionState' | 'heading'>,
  settings: DriverSettings,
): DriveCommand {
  const { ux, uy } = driverToField(c.forward, c.right, settings, robot.heading);
  return { ux, uy, uw: clampUnit(c.turn), request: resolveActionRequest(robot.actionState, c) };
}

// ============================================================
// 7. 8비트 양자화 (입력 수신 시점)
// ============================================================

// q = sign(u) · floor(|u| · 127 + 0.5), [−127, 127] (부호 대칭 반올림, 비유한값 0)
export function quantizeUnit(u: number): number {
  const v = finiteOr0(u);
  const q = Math.sign(v) * Math.floor(Math.abs(v) * QUANT_MAX + 0.5);
  return Math.max(-QUANT_MAX, Math.min(QUANT_MAX, q)) || 0;
}

export function encodeActionRequest(request: ActionRequest): number {
  const code = ACTION_CODES.indexOf(request);
  return code >= 0 ? code : 0;
}

// 알 수 없는 코드는 IDLE
export function decodeActionRequest(code: number): ActionRequest {
  return ACTION_CODES[code] ?? 'IDLE';
}

export function encodeDriveCommand(cmd: DriveCommand): EncodedDriveInput {
  return [quantizeUnit(cmd.ux), quantizeUnit(cmd.uy), quantizeUnit(cmd.uw), encodeActionRequest(cmd.request)];
}

// 엔진 입력 = 복호화 값. 실시간 입력도 부호화 → 복호화를 거치므로 로그 재생과 비트 단위로 같다.
// bytes: 부호화 튜플 또는 로그 Int8Array, offset: 4바이트 레코드 시작 위치
export function decodeDriveInput(
  bytes: ArrayLike<number>,
  offset: number,
  config: Pick<RobotConfig, 'maxSpeed' | 'maxTurnRate'>,
): RobotDriveInput {
  const q = (i: number) => Math.max(-QUANT_MAX, Math.min(QUANT_MAX, finiteOr0(bytes[offset + i])));
  return {
    targetVx: (q(0) / QUANT_MAX) * config.maxSpeed,
    targetVy: (q(1) / QUANT_MAX) * config.maxSpeed,
    targetOmega: (q(2) / QUANT_MAX) * config.maxTurnRate,
    actionState: decodeActionRequest(bytes[offset + 3]),
  };
}
