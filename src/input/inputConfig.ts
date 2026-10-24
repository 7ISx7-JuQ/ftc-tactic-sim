// ============================================================
// 입력 계층 설정 (명세서 3.6항)
// 키 매핑 / 데드존 / 임계값 / 장치 배정 기본값을 한곳에 모은 파일.
// 장치 → 로봇 배정(18-2)과 게임패드 버튼 매핑(18-3)은 SETTINGS 장치 구역에서 바꾼다 (여기 값은 기본값). 키보드 키를 바꿀 때는 이 파일만 수정한다.
// ============================================================

export type RobotId = 'robot1' | 'robot2';

// 드라이버 조작 모드: FIELD = 드라이버(아군 벽) 기준, ROBOT = 로봇 헤딩 기준
export type DriveMode = 'FIELD' | 'ROBOT';

// 논리 버튼: 흡입(유지) / 발사(유지) / 리프트 올림·내림(토글) / 투입(유지)
export type ControlButton = 'intake' | 'shoot' | 'lift' | 'drop';

export interface GamepadAxisBinding {
  index: number;   // Gamepad.axes 인덱스
  invert: boolean; // 부호 반전 (좌스틱 Y는 위 = −1이므로 반전해야 전진 = +)
}

// W3C Gamepad 표준 배열(mapping === 'standard') 기준, 인덱스는 0부터
// buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 LS, 11 RS, 12 ~ 15 D-pad ↑ ↓ ← →, 16 Home
// axes: 0 좌X, 1 좌Y, 2 우X, 3 우Y
export const GAMEPAD_AXES: Readonly<Record<'forward' | 'right' | 'turn', GamepadAxisBinding>> = {
  forward: { index: 1, invert: true },  // 좌스틱 Y: 전후 평행이동
  right: { index: 0, invert: false },   // 좌스틱 X: 좌우 평행이동
  turn: { index: 2, invert: false },    // 우스틱 X: 회전 (오른쪽 = + = 시계 방향 = 헤딩 증가). 우스틱 Y는 미사용
};
// 스틱 좌우 바꾸기 (18-3 swapSticks): 이동 = 우스틱, 회전 = 좌스틱 X (왼손잡이 드라이버용). 좌스틱 Y는 미사용
export const GAMEPAD_AXES_SWAPPED: Readonly<Record<'forward' | 'right' | 'turn', GamepadAxisBinding>> = {
  forward: { index: 3, invert: true },
  right: { index: 2, invert: false },
  turn: { index: 0, invert: false },
};

// 게임패드 매핑 (18-3, 슬롯별): 논리 버튼마다 Gamepad.buttons 인덱스 하나 (서로 다름) + 스틱 좌우 바꾸기.
// 버튼은 value ≥ TRIGGER_THRESHOLD(아날로그 트리거와 디지털 버튼 모두) 또는 value 없이 pressed일 때 눌림 — 어느 버튼이든 어느 동작에나 쓸 수 있다
export interface GamepadMapping {
  readonly buttons: Readonly<Record<ControlButton, number>>;
  readonly swapSticks: boolean;
}
export const CONTROL_BUTTONS: readonly ControlButton[] = ['intake', 'shoot', 'lift', 'drop'];
export const MAX_GAMEPAD_BUTTON_INDEX = 31; // 지정할 수 있는 버튼 인덱스 상한 (표준 배열은 0 ~ 16)

export const DEFAULT_GAMEPAD_MAPPING: GamepadMapping = {
  buttons: {
    intake: 6, // LT: 누르는 동안 INTAKING
    shoot: 7,  // RT: 누르는 동안 SHOOTING
    lift: 0,   // A: 누를 때마다 리프트 올림 / 내림 토글
    drop: 1,   // B: 누르는 동안 FLOWER_DROPPING (리프트가 올라가 있을 때만)
  },
  swapSticks: false,
};
export type GamepadMappings = Readonly<Record<GamepadSlot, GamepadMapping>>;
export const DEFAULT_GAMEPAD_MAPPINGS: GamepadMappings = { 0: DEFAULT_GAMEPAD_MAPPING, 1: DEFAULT_GAMEPAD_MAPPING };

/** 버튼 지정 (18-3): 다른 동작이 그 버튼을 쓰고 있으면 서로 자리를 바꾼다 (그 동작은 이 동작의 원래 버튼을 받음) */
export function assignGamepadButton(m: GamepadMapping, action: ControlButton, index: number): GamepadMapping {
  const current = m.buttons[action];
  if (current === index) return m;
  const other = CONTROL_BUTTONS.find(b => b !== action && m.buttons[b] === index);
  const buttons = { ...m.buttons, [action]: index, ...(other ? { [other]: current } : {}) };
  return { ...m, buttons };
}

export function sameMapping(a: GamepadMapping, b: GamepadMapping): boolean {
  return a.swapSticks === b.swapSticks && CONTROL_BUTTONS.every(k => a.buttons[k] === b.buttons[k]);
}

export function sameMappings(a: GamepadMappings, b: GamepadMappings): boolean {
  return GAMEPAD_SLOTS.every(s => sameMapping(a[s], b[s]));
}

// 키보드: 물리 키 위치(KeyboardEvent.code) — 한/영 입력 상태, 자판 배열과 무관
export const KEYBOARD_BINDINGS = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  turnLeft: 'ArrowLeft',
  turnRight: 'ArrowRight',
  intake: 'KeyM',
  shoot: 'Comma',
  lift: 'Period',
  drop: 'Slash',
} as const;

// 키보드 주행 기본값: true면 기본 배정에서 키보드 → R2, false면 키보드 배정 없음
export const KEYBOARD_ENABLED = true;

// 배정할 수 있는 게임패드 슬롯 (navigator.getGamepads() 인덱스, 18-2 확정: 0 / 1)
export const GAMEPAD_SLOTS = [0, 1] as const;
export type GamepadSlot = (typeof GAMEPAD_SLOTS)[number];

// 장치 → 로봇 배정 (18-2): 장치마다 R1 / R2 / 없음(null). 한 로봇에 여러 장치 허용 (합성은 mergeTickControls).
// 키보드 없음 = 키보드 주행 끔 (주행 키를 가로채지 않음, 단축키는 그대로)
export interface DeviceAssignment {
  readonly gamepads: Readonly<Record<GamepadSlot, RobotId | null>>;
  readonly keyboard: RobotId | null;
}

// 기본 배정: 게임패드 슬롯 0 → R1, 1 → R2, 키보드 → R2
export const DEVICE_ASSIGNMENT: DeviceAssignment = {
  gamepads: { 0: 'robot1', 1: 'robot2' },
  keyboard: KEYBOARD_ENABLED ? 'robot2' : null,
};

/** 게임패드 슬롯(아무 인덱스)의 배정 로봇 — 배정할 수 없는 슬롯 / 배정 없음은 null */
export function slotRobot(a: DeviceAssignment, slot: number): RobotId | null {
  return (GAMEPAD_SLOTS as readonly number[]).includes(slot) ? a.gamepads[slot as GamepadSlot] : null;
}

const OTHER_ROBOT: Readonly<Record<RobotId, RobotId>> = { robot1: 'robot2', robot2: 'robot1' };

/** 배정 바꾸기 (R1 ↔ R2): 모든 장치의 로봇을 서로 바꿈 (없음은 그대로) */
export function swapAssignment(a: DeviceAssignment): DeviceAssignment {
  const swap = (r: RobotId | null) => (r ? OTHER_ROBOT[r] : null);
  return { gamepads: { 0: swap(a.gamepads[0]), 1: swap(a.gamepads[1]) }, keyboard: swap(a.keyboard) };
}

export function sameAssignment(a: DeviceAssignment, b: DeviceAssignment): boolean {
  return a.keyboard === b.keyboard && GAMEPAD_SLOTS.every(s => a.gamepads[s] === b.gamepads[s]);
}

export const TRIGGER_THRESHOLD = 0.5; // LT / RT 눌림 판정 (value 0 ~ 1)
export const DEADZONE_LEFT = 0.08;    // 좌스틱 원형 데드존 (크기 기준)
export const DEADZONE_RIGHT_X = 0.08; // 우스틱 X 축 데드존

export const DEFAULT_DRIVE_MODE: DriveMode = 'FIELD';

// 8비트 양자화: 정규화 값 u ∈ [−1, 1] → 정수 q ∈ [−QUANT_MAX, QUANT_MAX]
export const QUANT_MAX = 127;

// 실시간 루프: 20 ms(엔진 DT 0.02초)마다 1틱, 한 프레임에 최대 5틱(100 ms)까지만 따라잡고 나머지 밀린 시간은 버림
export const TICK_MS = 20;
export const MAX_CATCHUP_TICKS = 5;
