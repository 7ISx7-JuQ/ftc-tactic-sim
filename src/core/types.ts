// 1. 로봇 하드웨어 제원 (UI 입력값)
export interface RobotConfig {
  id: 'robot1' | 'robot2';
  name: string;
  width: number;            // 가로 (inch)
  length: number;           // 세로 (inch)
  maxSpeed: number;         // 최고 속도 (inch/s)
  maxTurnRate: number;      // 최고 각속도 (rad/s)
  maxLinearAccel: number;   // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number;  // 최대 각가속도 (rad/s^2)

  // 초기 스폰 설정 (진영별 기본값 제공, 커스텀 가능)
  spawnX: number;
  spawnY: number;
  spawnHeading: number;     // 라디안

  // 인테이크 옵션
  intakeDelay: number;      // 흡입 딜레이 (ms)
  canIntakeNectar: boolean; // Nectar 무시 전략 옵션
  intakeDirection: 'FRONT' | 'ANY'; // 향후 전면 인테이크 구현을 위한 필드

  // HIVE 득점 (슈터) 옵션
  shooterDelay: number;     // 한 발 발사 딜레이 (ms)
  shooterAccuracy: number;  // 0.0 ~ 1.0 (명중률)

  // FLOWER 득점 옵션
  flowerSetupDelay: number; // 초기 리프트/경사로 전개 준비 시간 (ms)
  flowerDropDelay: number;  // 연속으로 기물을 떨어뜨리는 간격 (ms)

  // 전면 인테이크 판정 영역
  intakeWidth?: number;     // 전면 인테이크 유효 너비 (inch)
  intakeDepth?: number;     // 전면 흡입 감지 여유 깊이 (inch)
}

// 2. 득점 기물
export interface GamePiece {
  id: string;
  type: 'POLLEN' | 'NECTAR';
  alliance: 'RED' | 'BLUE' | 'NONE';
  x: number;
  y: number;
  vx: number;               // X방향 속도 (inch/s)
  vy: number;               // Y방향 속도 (inch/s)
  state: 'ON_FIELD' | 'CONTROLLED' | 'IN_HIVE' | 'IN_FLOWER' | 'IN_GARDEN' | 'OUT_OF_BOUNDS';
}

// 3. 로봇 동역학 및 행동 상태
export interface RobotState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  omega: number;
  heading: number;
  actionState: 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_DROPPING';
  stateTimer: number;
  controlledPieces: GamePiece[]; // 최대 4개 제한
}

// 4. 구조물 상태
export interface FlowerState {
  id: string;
  pieces: GamePiece[];      // 투입된 순서 보존 (0번 인덱스가 Bottom)
  owner: 'RED' | 'BLUE' | 'NONE';
  bottomBonus: 'RED' | 'BLUE' | 'NONE';
}

export interface PendingDrop {
  pieceId: string;
  type: 'POLLEN' | 'NECTAR';
  targetX: number;
  targetY: number;
  settleTime: number;       // 전복 시작 시점 기준 완전 정지 소요 시간 (초)
}

export interface HiveState {
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'; // 현재 어느 쪽이 열려(UP) 있는지
  ballsInUpwardCell: number;
  isTipping: boolean;
  tipCount: number;
  tipProgressTimer: number;     // 전복 시작 후 누적 경과 시간 (초)
  pendingDrops: PendingDrop[];  // 시차 낙하 대기열
}

// 5. 필드 통합 상태 및 RP
export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number;      // 5개로 시작
}

export interface RPState {
  swarm: boolean;
  pollinator1: boolean;
  pollinator2: boolean;
}

// 6. 타임라인 프레임 스냅샷
export interface TimelineFrame {
  tick: number;
  timestamp: number;
  r1: RobotState;
  r2: RobotState;
  field: FieldState;
  pieces: GamePiece[];
  totalScore: number;
  rpAchieved: RPState;
}
