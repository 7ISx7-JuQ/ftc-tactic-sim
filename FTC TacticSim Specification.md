# FTC TacticSim Specification

# [프로젝트 명세서] FTC BioBuzz 2D 텔레옵(Teleop) 전술 시뮬레이터

## 1. 프로젝트 개요 (Overview)

- **목적:** 로봇 공학 대회(FIRST Tech Challenge - BioBuzz)의 **TELEOP(텔레옵, 드라이버 조작 구간 120초)**동안, 같은 동맹(Alliance) 소속인 2대의 로봇이 어떻게 동선을 짜고 점수를 낼지 시뮬레이션하고 복기하는 웹 기반 2D 시뮬레이터.
- **주요 특징:**
    - 상대팀 로봇은 존재하지 않는 **2 v 0 (내 동맹 로봇 2대만 존재)** 시뮬레이션.
    - 무거운 3D 물리엔진을 배제하고, 수학적 기구학(Kinematics)과 분리축 이론(SAT) 기반 충돌 처리만 사용하여 프레임 드랍이나 오차 없는 **100% 결정론적(Deterministic)** 작동 보장.
    - 모든 틱(Tick)의 상태를 배열에 저장하여, 비디오 편집기처럼 뒤로 가기/앞으로 가기(Scrubbing) 지원.

## 2. 게임 룰 & 환경 설정 (Game Rules & Environment)

### 2.1 경기장 및 시간 (Field & Time)

- **크기:** 144 x 144 인치. (Canvas 렌더링 시 1인치 = 5px로 환산하여 720x720px로 출력)
- **좌표계:** 좌측 상단을 (0, 0), 우측 하단을 (144, 144)로 하는 Canvas 2D 표준 좌표계를 사용. (Y=144 방향이 Audience Side)
- **시간:** 총 120초 (6000 틱, 50Hz 기준).
- **진영 선택:** 사용자가 Red 또는 Blue 진영을 선택하면 시뮬레이터는 선택된 진영을 '아군'으로 간주하며, 상대 진영의 Nectar 등 불필요한 요소는 로직에서 배제됨.
- **엔드게임 (Endgame):** 남은 시간이 60초 이하가 되는 시점.

### 2.2 물리적 규격 및 정확한 좌표 (Physical Dimensions & Coordinates)

좌상단 (0,0) 좌표계를 기준으로 한 각 기물 및 구역의 정확한 위치는 다음과 같다.

1. **HIVE (벌집):**
    - **위치 및 크기:** 경기장 정중앙 (72, 72)에 위치한 49.46 × 38.95 인치의 프레임.
    - **정교화된 구조:** 각 진영별 HIVE는 2개의 CELL로 분할된다. Y축을 기준으로 상단의 `OPPOSITE_CELL`(Y < 72)과 하단의 `AUDIENCE_CELL` (Y > 72)로 나뉘며 렌더링 시 이를 시각적으로 명확히 구분해야 한다.
    - Red HIVE 중심: (59.25, 72) / Blue HIVE 중심: (84.75, 72).
2. **FLOWER (솔리드 장애물):**
    - **크기:** 반지름 2.0인치의 단단한 원형 Bounding Box.
    - **중심 좌표:**
        - Red 측: (2, 96), (48, 2)
        - Blue 측: (142, 48), (96, 142)
3. **GARDEN (통과 가능 구역, 23 × 2 인치):**
    - Red: 좌측 하단 (X: 0~23, Y: 142~144)
    - Blue: 우측 상단 (X: 121~144, Y: 0~2)
4. **LOADING ZONE (통과 가능 구역, 23 × 11 인치):**
    - Red: 좌측 중간 (X: 0~11, Y: 24~47)
    - Blue: 우측 중간 (X: 133~144, Y: 97~120)

### 2.3 로봇 기본값 및 스폰 위치 (Robot Spawn)

- **크기:** 가로 18 × 세로 18 인치.
- **초기 스폰 좌표 (타일 중앙 및 벽면 밀착):**
    - **Red 진영:** R1은 `(9, 36)`, R2는 `(9, 108)`. 헤딩은 `0` (오른쪽 방향).
    - **Blue 진영:** B1은 `(135, 36)`, B2는 `(135, 108)`. 헤딩은 `Math.PI` (왼쪽 방향).
    - (※ 이 값은 UI에서 사용자가 수정할 수 있는 기본값으로 제공됨)

### 2.4 득점 기물 초기화 (Game Pieces Setup)

총 40개의 기물(Pollen 32개, Nectar 8개)만 초기화한다.

1. **POLLEN (직경 2.8인치):** 총 32개.
    - 로봇 프리로드 (8개): 내 동맹 로봇 2대에 각각 4개씩 적재.
    - FLOWER 내부 (16개): 4개의 FLOWER에 4개씩 배치.
    - GARDEN (8개): Red GARDEN 4개, Blue GARDEN 4개 배치.
2. **NECTAR (직경 3.6인치):** 아군 진영 색상 총 8개. (상대 팀 NECTAR 배제).
    - HIVE 내부 (3개): 아군 HIVE의 위를 향하고 있는(UP) CELL 내부에 배치.
    - 휴먼 플레이어 스톡 (5개): 필드 밖 대기. HIVE 팁 시 1개씩 로딩 존에 스폰되며, 남은 시간 60초 돌입 시 남은 재고 전량 로딩 존에 스폰.

### 2.5 득점 및 구조물 로직 (Scoring Mechanics)

1. **HIVE (벌집):**
    - **초기 상태:** Red는 AUDIENCE_CELL이 위(UP)를, Blue는 OPPOSITE_CELL이 위(UP)를 향하도록 고정 시작.
    - **TIP 낙하 이벤트:** 공이 임계값 도달 시 HIVE가 반대편으로 기울어짐(TIP). 기울어지는 순간 CELL 내부의 공들이 **가우시안 랜덤 좌표**로 바닥에 생성. 단, 생성 좌표가 HIVE의 솔리드 바운딩 박스 내부이거나 로봇과 겹칠 경우 즉시 다시 랜덤(Re-roll)하여 HIVE 외부 타일에 떨어지게 함.
    - **TIP 득점 및 스폰:** 1회 팁 당 20점. 팁 즉시 로딩 존에 NECTAR 1개가 스폰됨.
2. **FLOWER (꽃):**
    - **조작:** NECTAR는 60초 이하 시점에만 투입 가능.
    - **득점:** 최상단 NECTAR 아군 색상 시 소유권 획득(내부 공 전체 개당 2점). 최하단 NECTAR 아군 색상 시 5점 보너스.
3. **GARDEN & PARK:** GARDEN에 공 드롭 시 개당 1점. 경기 종료 시 LOADING ZONE 주차(PARK) 시 로봇당 5점.
4. **랭킹 포인트 (RP):** SWARM (주차 10점) / POLLINATOR 1 (팁 4회) / POLLINATOR 2 (팁 7회).

## 3. 핵심 아키텍처 원칙 (Architecture Principles)

1. **상태와 렌더링의 완벽한 분리:** React는 UI만 담당. 시뮬레이션 상태 루프(50Hz)와 Canvas 2D 렌더링은 순수 TypeScript 로직으로 분리.
2. **50Hz Fixed Tick Loop:** `dt = 0.02` 고정 연산. 매 틱 스냅샷을 `TimelineFrame` 객체로 `Array`에 저장.
3. **분리축 이론 (SAT) 충돌:** 로봇(OBB), HIVE 프레임(AABB/OBB), FLOWER(Circle) 간의 관통 없는 충돌 처리.
4. **Slew Rate Limiter:** RoadRunner 등 실제 FTC 로봇의 오도메트리 튜닝 상수(`maxVelocity`, `maxAcceleration` 등)를 그대로 입력받아 속도 선형 보간(`approach`) 구현.

## 4. 데이터 인터페이스 명세 (`types.ts`)

TypeScript

```
// 1. 로봇 하드웨어 제원 (UI 입력값 - RoadRunner 튜닝 상수와 1:1 호환)
export interface RobotConfig {
  id: 'robot1' | 'robot2';
  name: string;
  width: number;
  length: number;
  maxSpeed: number;         // 최고 속도 (inch/s)
  maxTurnRate: number;      // 최고 각속도 (rad/s)
  maxLinearAccel: number;   // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number;  // 최대 각가속도 (rad/s^2)

  // 초기 스폰 설정
  spawnX: number;
  spawnY: number;
  spawnHeading: number;

  // 인테이크 옵션
  intakeDelay: number;
  canIntakeNectar: boolean;
  intakeDirection: 'FRONT' | 'ANY';

  // HIVE 득점 (슈터) 옵션
  shooterDelay: number;
  shooterAccuracy: number;  // 0.0 ~ 1.0 (명중률)

  // FLOWER 득점 옵션
  flowerSetupDelay: number; // 초기 리프트/경사로 전개 준비 시간 (ms)
  flowerDropDelay: number;  // 연속 투입 간격 (ms)
}

// 2. 득점 기물
export interface GamePiece {
  id: string;
  type: 'POLLEN' | 'NECTAR';
  alliance: 'RED' | 'BLUE' | 'NONE';
  x: number;
  y: number;
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
  controlledPieces: GamePiece[]; // 최대 4개
}

// 4. 구조물 상태
export interface FlowerState {
  id: string;
  pieces: GamePiece[];      // 0번 인덱스가 Bottom
  owner: 'RED' | 'BLUE' | 'NONE';
  bottomBonus: 'RED' | 'BLUE' | 'NONE';
}

export interface HiveState {
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  ballsInUpwardCell: number;
  isTipping: boolean;
  tipCount: number;
}

// 5. 필드 통합 상태 및 RP
export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number;
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
```

## 5. 개발 지시사항 (Implementation Instructions for Claude)

1. **좌상단(0,0) 캔버스 좌표계 엄수:** 모든 로직과 렌더링은 명세서 2.2항의 정확한 기물 및 구역 좌표를 기준으로 작성하라. (Audience Side는 Y=144 방향임)
2. **필드 초기화 (Init Logic):**
    - 선택된 얼라이언스 색상에 맞춰 32개의 POLLEN과 8개의 NECTAR를 정확한 좌표에 생성하라.
    - Red 로봇의 기본 스폰 위치는 (9,36)과 (9,108)이며, Blue 로봇은 (135,36)과 (135,108)이다.
    - HIVE 초기화 시 Red HIVE의 `upwardCell`은 'AUDIENCE_CELL'로, Blue HIVE는 'OPPOSITE_CELL'로 설정하라.
3. **HIVE의 정교한 렌더링 및 타겟팅:** 단순 직사각형 충돌 박스를 넘어, Canvas 렌더링 시 HIVE를 상하로 이등분하여 `AUDIENCE_CELL`과 `OPPOSITE_CELL`을 시각적으로 명확히 구분하여 그려라. 로봇의 슈팅 모듈은 활성화된(UP) CELL의 방향을 타겟으로 삼아야 한다.
4. **의존성 분리:** `simulationEngine.ts`는 React Hook에 의존하지 않는 순수 클래스나 클로저로 작성하여 50Hz 루프를 독자적으로 돌게 하라. React 컴포넌트는 오직 엔진의 메서드만 호출해야 한다.
5. **SAT 충돌 & HIVE 데드존:** `collision.ts`에 분리축 이론(SAT)을 구현하여 로봇-로봇, 로봇-장애물(HIVE, FLOWER), 벽면 관통을 방지하라. 가우시안 랜덤 공 낙하 시 HIVE 프레임 내부에 생성되지 않도록 Re-roll 로직을 반드시 포함하라.
6. **상태 전이(FSM) 타이머:** 로봇의 `actionState`가 `IDLE`이 아닐 때는 이동을 감속/정지시키고, `stateTimer`를 `dt(20ms)`씩 차감하며 딜레이 로직을 수행하라. (Shooter Delay와 Flower Drop Delay를 철저히 분리할 것).
7. **엔드게임 전환:** 루프 `timestamp`가 60000(60초)을 돌파하면 즉시 `ENDGAME` 페이즈로 전환하고, `nectarStock` 수량만큼 아군 로딩 존 내에 NECTAR를 스폰시켜라.
8. **UI/UX 편의성:** 설정 패널 구성 시, Kinematics 입력 필드 옆에 *"RoadRunner나 Pedro Pathing 튜닝 시 얻은 상수(Max Velocity, Max Acceleration 등)를 그대로 입력하세요"* 라는 툴팁을 명시하라.