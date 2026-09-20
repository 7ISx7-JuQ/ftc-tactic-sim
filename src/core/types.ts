// 로봇 하드웨어 제원 (UI 입력값)
export interface RobotConfig {
  id: 'robot1' | 'robot2';
  name: string;
  width: number;            // 가로 (inch)
  length: number;           // 세로 (inch)
  maxSpeed: number;         // 최고 속도 (inch/s)
  maxTurnRate: number;      // 최고 각속도 (rad/s)
  maxLinearAccel: number;   // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number;  // 최대 각가속도 (rad/s^2)
  intakeDelay: number;      // 흡입 딜레이 (ms)
  shooterDelay: number;     // 발사 준비 딜레이 (ms)
  shooterAccuracy: number;  // 0.0 ~ 1.0 (명중률)
}

// 틱(Tick) 단위 로봇 동역학 상태
export interface RobotState {
  x: number;                // 0 ~ 144 inch
  y: number;                // 0 ~ 144 inch
  vx: number;               // 현재 X 속도
  vy: number;               // 현재 Y 속도
  omega: number;            // 현재 각속도
  heading: number;          // 라디안 [-PI, PI]
  actionState: 'IDLE' | 'INTAKING' | 'READY_TO_SHOOT' | 'SHOOTING';
  stateTimer: number;       // 잔여 딜레이 (ms)
  hasGamePiece: boolean;
}

// 필드 위 경기 기물 (공)
export interface GamePiece {
  id: string;
  x: number;
  y: number;
  state: 'ON_FIELD' | 'INTAKING' | 'SCORED';
}

// 시소 하이브 상태
export interface HiveState {
  currentSide: 'UP' | 'DOWN';
  ballsRemaining: number;
  isTipping: boolean;
}

// 50Hz 단일 스냅샷 프레임 (타임라인의 원소)
export interface TimelineFrame {
  tick: number;             // 0, 1, 2, ...
  timestamp: number;        // 경과 시간 (ms)
  r1: RobotState;
  r2: RobotState;
  hive: HiveState;
  pieces: GamePiece[];
  isCollided: boolean;
  totalScore: number;
}