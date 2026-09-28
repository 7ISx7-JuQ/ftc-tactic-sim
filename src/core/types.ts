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
  id: 'robot1' | 'robot2';  // 엔진이 슬롯에 따라 강제 (r1 = 'robot1', r2 = 'robot2'), 사용자 입력 아님
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
  // 명중률은 로봇 제원이 아니라 탄도 LUT(ShotProbabilityResolver)가 결정 (명세서 2.6.2)
  shooterDelay: number;     // 한 발 발사 딜레이 (ms)
  turretType: 'FIXED' | 'TURRET';
  // 터렛 회전 한계 [α, β] (rad, 차체 헤딩 기준 상대각 Δψ = 목표 방위 − 헤딩, + = 로봇 오른쪽(캔버스 y-down), [-π, π] 정규화)
  // α ≤ β: α ~ β 구간, α > β: ±π를 가로지르는 구간 (예: 후방 터렛 [2.5, -2.5]), 360° 터렛 = [-π, π]
  turretRange: [number, number];
  aimTolerance: number;     // 고정형 슈터 허용 조준 오차 (rad, 차체 헤딩 기준 ±, 기본 3° ≈ 0.0524)

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
    nectarCount: number;    // 상향 셀 NECTAR (기본 3). {NECTAR, POLLEN}이 팁 임계(HIVE_TIP_POLLEN_BY_NECTAR) 미만이어야 함
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

  // 오토 중 발생한 HIVE 팁 횟수 (기본 0): 텔레옵 직전 휴먼 플레이어가 그 수만큼 로딩 존에 NECTAR 투입,
  // POLLINATOR RP 팁 횟수에 합산 (텔레옵 점수에는 미포함)
  autoTipCount?: number;

  // ※ 위에서 지정되지 않은 나머지 POLLEN / NECTAR는 모두 바닥에 무작위 산포 (지정 수량으로부터 자동 계산)

  // 결정론적 난수 시드 (미지정 시 엔진 기본 시드). 동일 시드 + 동일 입력 = 동일 경기
  rngSeed?: number;
}

// 독립 모듈용 탄도학 설정 및 히트맵 타입 (로봇별 1개, 명세서 2.6.2)
export interface BallisticsConfig {
  dz: number;               // 림 높이(HIVE_RIM_Z = 53.5) - 발사구 지상고 (inch). 발사구 z = 53.5 - dz
  shooterPitch: number;     // 발사각 (rad)
  // 스윗스팟: 기준 셀 RED_AUDIENCE를 가장 잘 넣는 로봇 중심 좌표 한 점 (inch).
  // 이 점에서 기물 종류별로 명중률이 최대인 v0를 탐색하고, 나머지 3셀은 대칭 변환으로 매핑
  sweetSpot: { x: number; y: number };
  shooterOffset: number;    // 차체 중심 기준 발사구 오프셋 (inch, 조준 방향)
  v0NoisePercent?: number;  // 속도 편차 (기본 0.02)
  headingNoiseRad?: number; // 방위각 편차 (기본 0.02 rad)
  pitchNoiseRad?: number;   // 피치각 편차 (기본 0.006 rad)
}

export type HiveCellKey = 'RED_AUDIENCE' | 'RED_OPPOSITE' | 'BLUE_AUDIENCE' | 'BLUE_OPPOSITE';
// 144 × 144 격자(1 in 해상도) 명중률 (0.0 ~ 1.0). 인덱스 = gy * 144 + gx, 격자 중심 = (gx + 0.5, gy + 0.5)
// 런타임 조회는 쌍선형 보간 (ballistics.ts sampleLUT)
export type HeatmapLUT = Float32Array;
export type HeatmapLUTSet = Record<HiveCellKey, HeatmapLUT>;
// 로봇 1대의 LUT: 기물 종류별 × 4셀 = 8장 (R1, R2 합계 16장)
export type RobotHeatmapLUTs = Record<GamePiece['type'], HeatmapLUTSet>;
// 경기 1회분 LUT: 로봇 슬롯별 (createLUTShotResolver 입력)
export type MatchHeatmapLUTs = Record<'robot1' | 'robot2', RobotHeatmapLUTs>;

// 엔진 발사 비행 처리용 슈터 탄도 (로봇별, 명세서 2.6.2 발사 비행 처리)
// v0 미지정 기물은 발사마다 조준점을 향한 닫힌 해로 결정 (자동 슈터, 해가 없으면 사거리 = 조준점 거리인 속도)
export interface ShooterBallistics {
  dz: number;               // 림 높이(53.5) - 발사구 지상고 (inch)
  shooterPitch: number;     // 발사각 (rad, (0, π/2) 밖이면 엔진 기본값)
  shooterOffset: number;    // 차체 중심 기준 발사구 오프셋 (inch, 발사 방향)
  v0?: Partial<Record<GamePiece['type'], number>>; // 기물별 사출 속도 (generateRobotLUTs 결과)
}
export type MatchShooterBallistics = Record<'robot1' | 'robot2', ShooterBallistics>;

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
  // IN_FLIGHT: 발사 후 도착 전 (FieldState.pendingShots에 비행 정보, 좌표는 발사 지점, 충돌 / 물리 제외)
  state: 'ON_FIELD' | 'CONTROLLED' | 'IN_HIVE' | 'IN_FLOWER' | 'IN_GARDEN' | 'OUT_OF_BOUNDS' | 'IN_FLIGHT';
}

// 3. 로봇 동역학 및 행동 상태
export interface RobotState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  omega: number;
  heading: number;
  // FLOWER_*: 리프트 FSM (명세서 2.6.3) — SETUP 올리는 중 / READY 올린 채 대기 / DROPPING 투입 중 / LOWERING 내리는 중
  actionState: 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_READY' | 'FLOWER_DROPPING' | 'FLOWER_LOWERING';
  stateTimer: number;
  isBraking: boolean;       // Stationary Lock 액션 진입 후 완전 정지 대기 중인지 여부
  intakeContactTimer: number; // 유효 흡입 영역 내 기물 접촉 유지 시간 누적치 (초)
  intakeTargetPieceId: string | null; // 현재 접촉 흡입 중인 기물 식별자
  controlledPieces: GamePiece[]; // FIFO 적재함 (0번이 다음에 나감), 최대 길이 = 로봇 적재 한도
}

// 틱별 행동 요청 (입력 계층 → 엔진, 명세서 3.6). FLOWER_READY / FLOWER_LOWERING은 엔진 상태이며 요청 값이 아님
export type ActionRequest = 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_DROPPING';

// 슈팅 판정 인터페이스: 0.0 ~ 1.0 명중 확률 반환 (엔진 생성자 필수 인자)
// 실제 경기는 탄도 LUT 기반 구현(createLUTShotResolver, Step 6)을 주입하고, 테스트는 고정 확률 함수를 주입
export type ShotProbabilityResolver = (
  robotId: 'robot1' | 'robot2',
  pieceType: GamePiece['type'], // 발사하는 기물 종류 (종류별 LUT 선택)
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
  nectarInUpwardCell: number;   // 상향 셀 NECTAR 수
  pollenInUpwardCell: number;   // 상향 셀 POLLEN 수
  isTipping: boolean;
  tipCount: number;             // 텔레옵 중 팁 횟수 (회당 20점)
  autoTipCount: number;         // 오토 중 팁 횟수 (ScenarioConfig, RP 판정에만 합산)
  tipProgressTimer: number;     // 전복 시작 후 누적 경과 시간 (초)
  pendingDrops: PendingDrop[];  // 시차 낙하 대기열
}

// 5. 필드 통합 상태 및 RP
// 발사 비행 대기열 (명세서 2.6.2): 결과와 도착 지점은 발사 시점에 확정, 도착 틱에 반영
export interface PendingShot {
  pieceId: string;
  pieceType: 'POLLEN' | 'NECTAR';
  robotId: 'robot1' | 'robot2';
  result: 'HIT' | 'MISS_HIVE' | 'MISS_FLOOR'; // 명중 / HIVE 직육면체 충돌 후 반사 방출 / 바닥 착지
  targetCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'; // 발사 시점 상향 셀 (도착 시 바뀌었으면 명중 무효)
  launchTick: number;
  arriveTick: number;       // 도착 틱 (≥ launchTick + 1)
  fromX: number;            // 발사구 (inch)
  fromY: number;
  fromZ: number;
  toX: number;              // 도착 지점: 명중 = 조준점, HIVE 충돌 = 첫 접촉점, 바닥 = 착지점
  toY: number;
  toZ: number;
  heading: number;          // 명목 궤적 수평 방향 (rad)
  v0: number;               // 명목 사출 속도 (inch/s) — 렌더러 높이 연출용
  pitch: number;            // 명목 발사각 (rad)
  landingVx: number;        // 바닥 착지 직후 속도 (inch/s, MISS_FLOOR)
  landingVy: number;
  ejectSpeedRoll: number;   // HIVE 반사 방출 난수 [0, 1) (발사 시점에 소비, 도착 시 사용)
  ejectAngleRoll: number;
}

export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number;      // 5개로 시작 (휴먼 플레이어가 아직 투입 결정하지 않은 재고)
  pendingHumanNectar: number; // 투입이 결정됐으나 로딩 존 빈 자리를 기다리는 NECTAR 수 (자리가 나면 즉시 배치)
  pendingShots: PendingShot[]; // 비행 중인 발사 (발사 순서)
}

export interface RPState {
  swarm: boolean;
  pollinator1: boolean;
  pollinator2: boolean;
}

// 읽기 전용 깊은 타입: 엔진이 외부로 공개하는 기록(타임라인 프레임)의 수정을 타입 수준에서 차단
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

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

/**
 * HIVE 팁(전복) 임계 테이블: 상향 셀 NECTAR 개수별 팁이 발동하는 POLLEN 개수
 * Key: NECTAR 개수, Value: 팁 발동 POLLEN 개수 (FLOWER_MAX_POLLEN_BY_NECTAR와 같은 구조)
 * 임계 조합 {NECTAR, POLLEN}: {5,0} {4,1} {3,3} {2,5} {1,6} {0,8}
 * NECTAR가 테이블 최대 키(5) 이상이면 POLLEN 0개로 즉시 팁
 */
export const HIVE_TIP_POLLEN_BY_NECTAR: Record<number, number> = {
  0: 8,
  1: 6,
  2: 5,
  3: 3,
  4: 1,
  5: 0,
};

/** 상향 셀 {NECTAR, POLLEN}에서 팁이 발동하는 POLLEN 개수 */
export function hiveTipPollenThreshold(nectar: number): number {
  const maxKey = Math.max(...Object.keys(HIVE_TIP_POLLEN_BY_NECTAR).map(Number));
  const key = Math.min(Math.max(0, Math.floor(nectar)), maxKey);
  return HIVE_TIP_POLLEN_BY_NECTAR[key] ?? 0;
}

/** 상향 셀 {NECTAR, POLLEN}이 팁 임계에 도달했는지 */
export function isHiveTipReached(nectar: number, pollen: number): boolean {
  return pollen >= hiveTipPollenThreshold(nectar);
}

/** FLOWER 하단 연속 deQ 최소 중력 낙하 쿨다운 (초 단위) */
export const FLOWER_DEQ_GRAVITY_COOLDOWN = 0.12;

/**
 * FLOWER 내부 NECTAR 수량에 따른 최대 POLLEN 수용 한도 테이블
 * 바닥(slot[0] 포함)부터 높이 21.5in 원통에 최대로 채울 수 있는 조합
 * {POLLEN, NECTAR} = {9,0} {8,1} {6,2} {5,3} {3,4} {2,5} {1,6}
 * (계산상의 {0,7}은 slot[0]이 NECTAR여야 하므로 제외: slot[0]에는 NECTAR가 올 수 없고,
 *  NECTAR가 있는 FLOWER의 slot[0]은 항상 POLLEN 또는 POLLEN으로 계산하는 빈칸이라 POLLEN ≥ 1)
 * (지그재그 적층 + 최상단 기물이 일부라도 원통 내부에 걸치면 인정하는 기준의 계산값. 실측 가능 시 교체 예정)
 * Key: NECTAR 개수, Value: 최대 POLLEN 개수 (slot[0] 포함 원통 내 전체 개수 기준)
 * NECTAR 잼 상태(slot[0] = null)에서는 빈 slot[0]을 POLLEN 1개로 계산하여 같은 테이블 사용
 * (턱 위 받침과 공 위 받침의 미세 차이는 단순화를 위해 의도적으로 무시, 명세서 2.6.3)
 */
export const FLOWER_MAX_POLLEN_BY_NECTAR: Record<number, number> = {
  0: 9,
  1: 8,
  2: 6,
  3: 5,
  4: 3,
  5: 2,
  6: 1,
};

/** FLOWER에 투입 가능한 최대 NECTAR 수량 (용량 테이블 최대 키) */
export const FLOWER_MAX_NECTAR_CAPACITY = 6;
