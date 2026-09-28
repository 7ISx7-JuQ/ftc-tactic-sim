// ============================================================
// 입력 계층 설정 (명세서 3.6항)
// 키 매핑 / 데드존 / 임계값 / 장치 배정을 한곳에 모은 파일.
// 매핑 편집 GUI는 두지 않으므로 값을 바꿀 때는 이 파일만 수정한다.
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

export interface GamepadButtonBinding {
  index: number;   // Gamepad.buttons 인덱스
  analog: boolean; // true = value ≥ TRIGGER_THRESHOLD로 판정 (LT / RT), false = pressed
}

// W3C Gamepad 표준 배열(mapping === 'standard') 기준, 인덱스는 0부터
// buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT / axes: 0 좌X, 1 좌Y, 2 우X, 3 우Y
export const GAMEPAD_AXES: Readonly<Record<'forward' | 'right' | 'turn', GamepadAxisBinding>> = {
  forward: { index: 1, invert: true },  // 좌스틱 Y: 전후 평행이동
  right: { index: 0, invert: false },   // 좌스틱 X: 좌우 평행이동
  turn: { index: 2, invert: false },    // 우스틱 X: 회전 (오른쪽 = + = 시계 방향 = 헤딩 증가). 우스틱 Y는 미사용
};

export const GAMEPAD_BUTTONS: Readonly<Record<ControlButton, GamepadButtonBinding>> = {
  intake: { index: 6, analog: true },  // LT: 누르는 동안 INTAKING
  shoot: { index: 7, analog: true },   // RT: 누르는 동안 SHOOTING
  lift: { index: 0, analog: false },   // A: 누를 때마다 리프트 올림 / 내림 토글
  drop: { index: 1, analog: false },   // B: 누르는 동안 FLOWER_DROPPING (리프트가 올라가 있을 때만)
};

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

// 개발자 디버그용 비공개 입력 (사용자 안내 없음). 정식 배포 시 false로 비활성화 가능
export const KEYBOARD_ENABLED = true;

// 장치 → 로봇 배정: 게임패드 슬롯(navigator.getGamepads() 인덱스) 0 → R1, 1 → R2, 키보드 → R2
export const DEVICE_ASSIGNMENT: Readonly<{ gamepads: Readonly<Record<number, RobotId>>; keyboard: RobotId }> = {
  gamepads: { 0: 'robot1', 1: 'robot2' },
  keyboard: 'robot2',
};

export const TRIGGER_THRESHOLD = 0.5; // LT / RT 눌림 판정 (value 0 ~ 1)
export const DEADZONE_LEFT = 0.08;    // 좌스틱 원형 데드존 (크기 기준)
export const DEADZONE_RIGHT_X = 0.08; // 우스틱 X 축 데드존

export const DEFAULT_DRIVE_MODE: DriveMode = 'FIELD';

// 8비트 양자화: 정규화 값 u ∈ [−1, 1] → 정수 q ∈ [−QUANT_MAX, QUANT_MAX]
export const QUANT_MAX = 127;

// 실시간 루프: 20 ms(엔진 DT 0.02초)마다 1틱, 한 프레임에 최대 5틱(100 ms)까지만 따라잡고 나머지 밀린 시간은 버림
export const TICK_MS = 20;
export const MAX_CATCHUP_TICKS = 5;
