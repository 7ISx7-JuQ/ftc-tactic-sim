// 로봇 범퍼 면에 붙는 직사각형 구역 (로봇 기준 좌표, 명세서 3.3)
//   중심점은 side 변 위에 놓이며, depth는 변에서 바깥 수직 방향, width는 변과 평행한 방향
//   offset 부호: FRONT/BACK 변은 로봇 오른쪽이 +, LEFT/RIGHT 변은 로봇 앞쪽이 +
export type BumperSide = 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT';

export interface BumperZone {
  side: BumperSide;
  offset: number;           // 변 중점 기준 변을 따른 이동 (inch). |offset| ≤ 변 길이 / 2
  width: number;            // 변과 평행한 길이 (inch, > 0, 변 길이 초과 허용)
  depth: number;            // 변에서 바깥 수직으로 뻗는 깊이 (inch, > 0)
}

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
  canIntakeNectar: boolean; // Nectar 흡입 가능 여부 (false면 NECTAR 적재 불가)
  maxControlledPieces: number; // 최대 적재 수 (POLLEN/NECTAR 합산). 실제 한도 = min(이 값, 룰 상한 4)
  // 인테이크 구역 목록 (개수 무제한, 빈 배열 = 흡입 불가). 바닥 흡입과 FLOWER 하단 추출 모두 이 구역 기준
  // FRONT / ANY 등은 collision.ts의 createIntakeZonePreset()으로 생성
  intakeZones: BumperZone[];

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
    pollenCount: number;    // 상향 셀 POLLEN (기본 0)
    nectarCount: number;    // 상향 셀 NECTAR (기본 3). 합계는 HIVE_TIP_THRESHOLD 이하
  };

  // 텔레옵 시작 시 로봇 적재물 (순서 있는 목록, FIFO: 0번이 가장 먼저 나감)
  // 미지정 시 적재 한도만큼 POLLEN. 길이 ≤ 적재 한도, NECTAR는 canIntakeNectar 로봇만
  r1Loadout?: GamePiece['type'][];
  r2Loadout?: GamePiece['type'][];

  // FLOWER 내부 POLLEN 수 (FLOWER_CIRCLES 순서, 기본 각 4개, 각 0 ~ 4: 오토 중 투입 불가)
  flowerPiecesCount?: [number, number, number, number];

  // GARDEN에 남은 POLLEN 수 (기본 각 4개)
  gardenPiecesCount?: {
    ally: number;
    opponent: number;
  };

  // 오토 중 발생한 HIVE 팁 횟수 = 텔레옵 직전 휴먼 플레이어가 로딩 존에 투입하는 NECTAR 수 (기본 0)
  autoTipCount?: number;

  // ※ 위에서 지정되지 않은 나머지 POLLEN / NECTAR는 모두 바닥에 무작위 산포 (지정 수량으로부터 자동 계산)

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
  controlledPieces: GamePiece[]; // FIFO 적재함 (0번이 다음에 나감), 최대 길이 = 로봇 적재 한도
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
