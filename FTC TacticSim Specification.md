# FTC TacticSim Specification

# [프로젝트 명세서] FTC BioBuzz 2D 텔레옵(Teleop) 전술 시뮬레이터

## 1. 프로젝트 개요 (Overview)

- **목적:** 로봇 공학 대회(FIRST Tech Challenge - BioBuzz)의 **TELEOP(텔레옵, 드라이버 조작 구간 120초)** 동안, 같은 동맹(Alliance) 소속인 2대의 로봇이 어떻게 동선을 짜고 점수를 낼지 시뮬레이션하고 복기하는 웹 기반 2D 시뮬레이터.
- **주요 특징:**
    - 상대팀 로봇은 존재하지 않는 **2 v 0 (내 동맹 로봇 2대만 존재)** 시뮬레이션.
    - 무거운 3D 물리엔진을 배제하고, 수학적 기구학(Kinematics)과 분리축 이론(SAT) 기반 충돌 처리만 사용하여 프레임 드랍이나 오차 없는 **100% 결정론적(Deterministic)** 작동 보장.
    - 모든 틱(Tick)의 상태를 배열에 저장하여, 비디오 편집기처럼 뒤로 가기/앞으로 가기(Scrubbing) 지원.

## 2. 게임 룰 & 환경 설정 (Game Rules & Environment)

이 시뮬레이터는 2v0 훈련 목적에 맞춰 최적화된 초기 필드 세팅을 따릅니다.

### 2.1 경기장 및 시간 (Field & Time)

- **크기:** 144 x 144 인치. (Canvas 렌더링 시 1인치 = 5px로 환산하여 720x720px로 출력)
- **시간:** 총 120초 (6000 틱, 50Hz 기준).
- **진영 선택:** 사용자가 Red 또는 Blue 진영을 선택하면 시뮬레이터는 선택된 진영을 '아군'으로 간주하며, 상대 진영의 요소는 로직에서 최소화/배제됩니다.
- **엔드게임 (Endgame):** 남은 시간이 60초 이하가 되는 시점.

### 2.2 득점 기물 초기화 세팅 (Game Pieces Setup)

상대 로봇이 없음을 가정하여, 불필요한 기물을 제거하고 총 40개의 기물(Pollen 32개, Nectar 8개)만 초기화합니다.

1. **POLLEN (꽃가루):** 노란색 공. 총 32개 구현.
    - **로봇 프리로드 (8개):** 내 동맹 로봇 2대에 각각 4개씩 적재된 상태로 시작. (상대 로봇 사전 적재 8개는 완전히 배제).
    - **FLOWER 내부 (16개):** 4개의 FLOWER에 각각 4개씩 배치.
    - **GARDEN (8개):** 아군 GARDEN에 4개, 상대 GARDEN에 4개 배치 (상대 가든 스틸 전술을 위해 유지).
2. **NECTAR (꿀):** 아군 색상 공. 총 8개 구현. (상대 팀 NECTAR는 아예 스폰하지 않음).
    - **HIVE 내부 (3개):** 아군 HIVE의 위를 향하고 있는(UP) CELL 내부에 사전 배치.
    - **휴먼 플레이어 스톡 (5개):** 필드 밖(NectarStock) 대기. HIVE 팁 성공 시 1개씩 로딩 존에 스폰되며, 엔드게임(남은 시간 60초) 돌입 시 남은 재고가 로딩 존에 일괄 스폰됨.

### 2.3 주요 구조물 및 득점 로직 (Scoring Mechanics)

1. **HIVE (벌집):**
    - 초기 상태: 시작 시 아군 HIVE의 한쪽 CELL이 반드시 UP 상태를 유지.
    - 로봇이 HIVE를 향해 공을 쏘아(슈터 모듈) UP 상태인 CELL에 공을 넣음 (슈터 정확도 연산 적용).
    - 공이 임계값(예: 3개) 도달 시 HIVE가 반대편으로 기울어짐(TIP).
    - **TIP 낙하 이벤트:** 기울어지는 순간, CELL 안에 있던 공들이 바닥으로 떨어짐. (가우시안 랜덤 좌표계를 사용해 일정 딜레이 후 HIVE 근처 바닥에 생성되도록 구현. 로봇과 겹치면 즉시 위치 재계산).
    - **TIP 득점 및 스폰:** 1회 팁 당 20점. 팁 즉시 로딩 존에 대기 중이던 NECTAR 1개가 필드에 스폰됨.
2. **FLOWER (꽃):**
    - **조작:** 상단 투입(POLLEN, NECTAR 모두 가능), 하단 반출(POLLEN만 가능).
    - **제약:** NECTAR는 **엔드게임(남은 시간 60초 이하)** 시점에만 투입 가능.
    - **득점:**
        - 소유권(Owner): FLOWER 최상단(가장 마지막에 투입된) NECTAR가 아군 색상이면 소유권 획득. 소유권 획득 시 FLOWER 내부 모든 공에 대해 개당 2점 획득.
        - 하단 보너스(Bottom Bonus): FLOWER 최하단(가장 처음에 투입된) NECTAR가 아군 색상이면 5점 추가.
3. **GARDEN & LOADING ZONE:**
    - GARDEN: 바닥 구역. 공을 드롭하면 개당 1점.
    - LOADING ZONE: NECTAR 스폰 구역이자, 경기 종료 시 주차(PARK, 5점) 구역.
4. **랭킹 포인트 (RP):**
    - SWARM RP: 텔레옵 PARK 점수가 10점(로봇 2대 모두 주차)일 경우 달성.
    - POLLINATOR 1 RP: HIVE 팁 4회 이상 시 달성.
    - POLLINATOR 2 RP: HIVE 팁 7회 이상 시 달성.

## 3. 핵심 아키텍처 원칙 (Architecture Principles)

1. **상태와 렌더링의 완벽한 분리:**
    - React는 UI(입력 폼, 타임라인 슬라이더, 스코어보드)만 담당.
    - 시뮬레이션 상태 루프 연산(초당 50회)과 Canvas 2D 렌더링은 React State(`useState`) 밖에서 순수 TypeScript 클래스/함수로 동작해야 함.
2. **50Hz Fixed Tick Loop:**
    - 브라우저의 프레임레이트와 무관하게 시뮬레이션 로직은 `dt = 0.02` 고정값으로 연산됨.
    - 매 틱마다 로봇, 기물, 구조물의 스냅샷을 `TimelineFrame` 객체로 생성하여 배열에 Push.
3. **분리축 이론 (SAT) 기반 충돌:**
    - 로봇(OBB)과 로봇, 로봇과 벽면 간의 충돌은 SAT를 사용하여 관통을 방지하고 직전 위치로 롤백시킴.
4. **Slew Rate Limiter (가감속 제한기):**
    - 로봇 설정의 `maxLinearAccel`, `maxAngularAccel`을 넘지 않도록 `approach(current, target, maxDelta)` 함수를 통해 선형 보간됨.

## 4. 데이터 인터페이스 명세 (`types.ts`)

TypeScript

```
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
  controlledPieces: GamePiece[]; // 최대 4개 제한
}

// 4. 구조물 상태
export interface FlowerState {
  id: string;
  pieces: GamePiece[];      // 투입된 순서 보존 (0번 인덱스가 Bottom)
  owner: 'RED' | 'BLUE' | 'NONE';
  bottomBonus: 'RED' | 'BLUE' | 'NONE';
}

export interface HiveState {
  upwardCell: 'AUDIENCE_SIDE' | 'OPPOSITE_SIDE'; // 현재 어느 쪽이 열려(UP) 있는지
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
```

## 5. 시스템 모듈 및 폴더 구조 (Directory Structure)

Plaintext

```
src/
├── core/
│   ├── types.ts              // 전체 타입 정의
│   ├── kinematics.ts         // 메카넘 수식, Slew Rate Limiter, 각도 정규화
│   ├── collision.ts          // SAT 충돌 함수, 바운더리 체크, 가우시안 랜덤 공 낙하 생성
│   ├── gamepad.ts            // Web Gamepad API 폴링 (아날로그 데드존 0.1 처리)
│   ├── fsm.ts                // 로봇의 액션 상태(딜레이) 전이 및 HIVE/FLOWER 상태 변경
│   ├── scoreCalculator.ts    // 프레임별 득점 및 RP 계산 로직
│   └── simulationEngine.ts   // 50Hz 고정 틱 루프 제어 및 TimelineFrame 배열 관리 (Init 포함)
├── renderer/
│   └── canvasRenderer.ts     // Canvas 2D 렌더러
├── components/
│   ├── SimulatorContainer.tsx// 메인 컨테이너 (Engine 초기화 및 루프 시작)
│   ├── ScoreBoard.tsx        // 실시간 FTC 스코어 & RP 비쥬얼라이저
│   ├── FieldCanvas.tsx       // Canvas 태그 래퍼
│   ├── TimelineBar.tsx       // 하단 스크러버 (마우스 드래그 시 해당 틱 프레임 렌더링)
│   └── RobotConfigPanel.tsx  // 로봇 파라미터 제어 사이드바 (shadcn/ui)
└── App.tsx
```

## 6. 개발 지시사항 (Implementation Instructions for Claude)

1. **필드 세팅 및 초기화 (Init Logic):** `simulationEngine.ts`의 초기화 함수에서 선택된 얼라이언스 색상에 맞춰 32개의 POLLEN과 8개의 NECTAR를 생성하라. (로봇 당 4개씩 POLLEN 프리로드, FLOWER 4곳에 4개씩, 양쪽 GARDEN에 4개씩. NECTAR 3개는 아군 HIVE UP-CELL에, 5개는 `nectarStock`에 할당). 추가로, HIVE 초기화 시 Red HIVE의 `upwardCell`은 'AUDIENCE_SIDE'로, Blue HIVE의 `upwardCell`은 'OPPOSITE_SIDE'로 하드코딩하여 초기 상태를 고정하라.
2. **의존성 분리:** `simulationEngine.ts`는 React Hook에 의존하지 않는 순수 클래스나 클로저 형태로 작성하라. React 컴포넌트는 `Engine.start()`, `Engine.pause()`, `Engine.seek(tick)`만 호출하고 렌더링용 데이터만 가져오게 하라.
3. **SAT 충돌 구현:** `collision.ts`에 분리축 이론(Separating Axis Theorem)을 적용하여 두 로봇(OBB) 간의 충돌을 검사하고, 겹쳤을 경우 직전 좌표(t-1)로 되돌리는 로직을 작성하라.
4. **상태 전이(FSM) 타이머 로직:** 로봇의 `actionState`가 `IDLE`이 아닐 때는 이동 속도를 감속 또는 정지시키고, `stateTimer`에서 `dt(20ms)`씩 차감하여 0이 되었을 때 기물 배열을 조작하는 로직을 작성하라 (슈팅 딜레이, FLOWER 투입 딜레이 분리 적용).
5. **엔드게임 트리거:** 루프 내부에서 `timestamp`가 60000(60초)을 돌파하는 즉시 `matchPhase`를 `ENDGAME`으로 변경하고, `nectarStock`의 수량만큼 로딩 존 내에 랜덤하게 NECTAR를 스폰시켜라.