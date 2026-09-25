// 1. 로봇 하드웨어 제원 (UI 입력값, RoadRunner 튜닝 상수 호환)
export interface RobotConfig {
  id: 'robot1' | 'robot2';
  name: string;
  width: number;            // 가로 (inch)
  length: number;           // 세로 (inch)
  maxSpeed: number;         // 최고 속도 (inch/s)
  maxTurnRate: number;      // 최고 각속도 (rad/s)
  maxLinearAccel: number;   // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number;  // 최대 각가속도 (rad/s^2)

  // 인테이크 옵션
  intakeDelay: number;      // 흡입 딜레이 (ms)
  canIntakeNectar: boolean; // Nectar 무시 전략 옵션
  intakeDirection: 'FRONT' | 'ANY'; // FRONT: 전면 센서 박스, ANY: 차체 4면 확장 영역
  intakeWidth: number;      // 전면 인테이크 유효 너비 (inch)
  intakeDepth: number;      // 흡입 감지 여유 깊이 (inch)

  // HIVE 득점 (슈터) 런타임 제원
  shooterDelay: number;     // 한 발 발사 딜레이 (ms)
  shooterAccuracy: number;  // 0.0 ~ 1.0 (명중률)
  turretType: 'FIXED' | 'TURRET';
  turretRange: [number, number]; // 터렛 회전 한계 [α, β] (rad, 차체 헤딩 기준)
  aimTolerance: number;     // 고정형 슈터 허용 조준 오차 (rad, 기본 ±3°)

  // FLOWER 득점 옵션
  flowerSetupDelay: number; // 초기 리프트/경사로 전개 준비 시간 (ms)
  flowerDropDelay: number;  // 연속으로 기물을 떨어뜨리는 간격 (ms)
}

// 로봇 자세 (필드 좌표계 위치 + 헤딩)
export interface RobotPose {
  x: number;                // inch
  y: number;                // inch
  heading: number;          // 라디안
}

// 텔레옵 시작 조건 (자율주행 결과 반영 시나리오 설정)
export interface ScenarioConfig {
  allianceColor: 'RED' | 'BLUE';

  // 로봇 시작 자세 (자율주행 종료 위치). 미지정 시 진영별 기본 스폰 적용
  r1Spawn?: RobotPose;
  r2Spawn?: RobotPose;

  // HIVE 초기 상태
  hiveUpwardCell?: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  hiveInitialPieces?: {
    pollenCount: number;    // 0 ~ 8
    nectarCount: number;    // 0 ~ 5
  };

  // 로봇 프리로드 수량 (0 ~ 4개)
  r1PreloadCount?: number;
  r2PreloadCount?: number;

  // 플라워 내부 적재 수량 (기본 각 4개)
  flowerPiecesCount?: [number, number, number, number];

  // 바닥에 랜덤 산포할 잔여 기물 수
  groundPiecesCount?: {
    pollen: number;
    nectar: number;
  };

  // 결정론적 난수 시드 (미지정 시 엔진 기본 시드). 동일 시드 + 동일 입력 = 동일 경기
  rngSeed?: number;
}

// 독립 모듈용 탄도학 설정 및 히트맵 타입
export interface BallisticsConfig {
  dz: number;               // 림 높이 - 발사구 지상고 (inch)
  shooterPitch: number;     // 발사각 (rad)
  sweetSpot: { x: number; y: number }; // 전술 거점 좌표
  shooterOffset: number;    // 차체 중심 기준 발사구 전방 오프셋 (inch)
  v0NoisePercent?: number;  // 속도 편차 (기본 0.02)
  headingNoiseRad?: number; // 방위각 편차 (기본 0.02 rad)
  pitchNoiseRad?: number;   // 피치각 편차 (기본 0.006 rad)
}

export type HiveCellKey = 'RED_AUDIENCE' | 'RED_OPPOSITE' | 'BLUE_AUDIENCE' | 'BLUE_OPPOSITE';
export type HeatmapLUTSet = Record<HiveCellKey, number[][]>; // 72x72 배열 (0.0 ~ 1.0)

// HIVE 시차 낙하 예약 대기열
export interface PendingDrop {
  pieceId: string;
  type: 'POLLEN' | 'NECTAR';
  targetX: number;
  targetY: number;
  settleTime: number;       // 전복 시작 시점 기준 완전 정지 소요 시간 (초)
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
  isBraking: boolean;       // Stationary Lock 액션 진입 후 완전 정지 대기 중인지 여부
  intakeContactTimer: number; // 유효 흡입 영역 내 기물 접촉 유지 시간 누적치 (초)
  intakeTargetPieceId: string | null; // 현재 접촉 흡입 중인 기물 식별자
  controlledPieces: GamePiece[]; // 최대 4개 제한
}

// 슈팅 판정 인터페이스: 0.0 ~ 1.0 명중 확률 반환
export type ShotProbabilityResolver = (
  robotId: 'robot1' | 'robot2',
  robotX: number,
  robotY: number,
  heading: number,
  alliance: 'RED' | 'BLUE',
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL',
) => number;

// 4. 구조물 상태
export interface FlowerState {
  id: string;
  // 0번 인덱스는 지면 접촉 슬롯(slot[0], 득점 제외 볼륨). NECTAR 블로킹 시 null 가능.
  // 1번 인덱스부터 최상단까지가 유효 스코어링 볼륨(Inside FLOWER Scoring Volume).
  pieces: (GamePiece | null)[];
  owner: 'RED' | 'BLUE' | 'NONE';
  bottomBonus: 'RED' | 'BLUE' | 'NONE';
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

// ==========================================
// [Game Mechanics & Rule Tuning Constants]
// ==========================================

/** HIVE 팁(전복) 발동 상향 셀 누적 기물 수 */
export const HIVE_TIP_THRESHOLD = 3;

/** FLOWER 하단 연속 deQ 최소 중력 낙하 쿨다운 (초 단위) */
export const FLOWER_DEQ_GRAVITY_COOLDOWN = 0.12;

/**
 * FLOWER 내부 NECTAR 수량에 따른 최대 POLLEN 수용 한도 테이블
 * Key: NECTAR 개수, Value: 최대 POLLEN 개수
 */
export const FLOWER_MAX_POLLEN_BY_NECTAR: Record<number, number> = {
  0: 5,
  1: 4,
  2: 2,
};

/** FLOWER에 투입 가능한 최대 NECTAR 수량 */
export const FLOWER_MAX_NECTAR_CAPACITY = 2;
