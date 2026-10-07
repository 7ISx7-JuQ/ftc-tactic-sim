# FTC TacticSim 명세서

FTC BioBuzz TELEOP 2D 전술 시뮬레이터의 게임 규칙, 물리 모델, 구조, 화면 동작을 정리한 문서입니다.

> **읽는 법**
> - 이 문서는 **v1.0.0의 현재 동작**을 기준으로 씁니다. 결정의 이유는 필요한 곳에 짧게 남기고, 단계별 개발 기록은 git 커밋 이력으로 대신합니다.
> - 앞으로의 업데이트 예정 목록(v2.0.0 파괴적 / 비파괴)은 [5.2항](#52-업데이트-예정-목록), 그중 설계가 확정됐지만 아직 구현하지 않은 내용은 [5.4항](#54-확정-설계-미구현)에 따로 모읍니다. 구현되면 해당 절로 옮깁니다.
> - 절 번호(2.6.2항, 3.8항 등)는 코드 주석이 참조하므로 바꾸지 않습니다.
> - 좌표와 길이는 inch(in), 각도는 라디안(화면 표시는 도)입니다. 게임 용어(HIVE, FLOWER, NECTAR, TIP 등)는 룰북 표기를 따릅니다.
> - 사용법은 [README](README.md)와 앱 안 도움말(`?`)을 참고하세요.

## 목차

1. [개요](#1-개요)
2. [게임 규칙과 필드](#2-게임-규칙과-필드)
3. [구조와 동작](#3-구조와-동작)
4. [데이터 인터페이스 (`types.ts`)](#4-데이터-인터페이스-typests)
5. [개발 현황과 향후 과제](#5-개발-현황과-향후-과제)

## 1. 개요

- **목적:** FIRST Tech Challenge BioBuzz 시즌의 TELEOP(드라이버 조작 구간 120초) 동안 같은 ALLIANCE의 로봇 2대가 어떤 동선으로 점수를 낼지 시뮬레이션하고 복기하는 웹 기반 2D 시뮬레이터.
- **주요 특징:**
    - 상대 로봇이 없는 **2 v 0** 시뮬레이션 (우리 ALLIANCE 로봇 2대만 존재).
    - 3D 물리 엔진 없이 기구학과 분리축 이론(SAT) 기반 충돌 처리만 사용하여 **100% 결정론적**으로 동작 (같은 설정 + 같은 입력 = 같은 경기).
    - 모든 틱의 상태를 저장하여 비디오 편집기처럼 앞뒤로 탐색(스크러빙)하고, 원하는 시점에서 가지를 나눠 다른 작전을 시도.
- **범위 밖:** 상대 로봇, 오토(Autonomous) 구간 시뮬레이션, 모바일 화면, 3D 보기 (5.3항).

## 2. 게임 규칙과 필드

### 2.1 경기장과 시간

- **크기:** 144 × 144 in.
- **좌표계:** 좌측 상단 (0, 0), 우측 하단 (144, 144)인 캔버스 2D 표준 좌표계 (y-down). y = 144 쪽이 관중석(Audience Side).
- **시간:** 총 120초 = 6000틱 (50 Hz, dt = 0.02초).
- **진영 선택:** 사용자가 RED 또는 BLUE를 고르면 그 진영을 우리 ALLIANCE로 보고, 상대 진영의 NECTAR 등 불필요한 요소는 로직에서 뺀다.
- **ENDGAME:** 남은 시간이 60초 이하가 되는 시점부터.

### 2.2 필드 구조물의 치수와 좌표

좌상단 (0, 0) 좌표계 기준 각 구조물과 구역의 위치는 다음과 같다.

1. **HIVE (벌집):**
    - **위치 및 전체 크기:** 필드 정중앙 (72, 72)에 놓인 49.46 × 38.95 in 프레임.
    - **프레임 AABB 경계:** xMin = 47.27, xMax = 96.73, yMin = 52.525, yMax = 91.475.
    - **진영별 HIVE 중심:** RED `(59.25, 72.0)`, BLUE `(84.75, 72.0)`.
    - **CELL 분할:** 진영별 HIVE는 너비 20.0 in의 CELL 2개로 나뉜다. 위쪽(y < 72)이 `OPPOSITE_CELL`, 아래쪽(y > 72)이 `AUDIENCE_CELL`이며 화면에서 명확히 구분한다.
    - **CELL 투입구 기하** (위를 향한 셀 = 상향 셀, 바닥 z = 0, `collision.ts`의 `HIVE_RIM_Z` 등 상수):
        - 투입구 표면은 밑변이 평평한 오각형이다. 너비 20 × 높이 7.61 직사각형 위에 밑변 20 · 높이 6.39 이등변 삼각형을 올린 형태 (전체 높이 14 in, 길이는 표면을 따라 잰 값).
        - 밑변 = 림(셀의 가장 바깥 끝): z = 53.5 (`HIVE_RIM_Z`), x 범위 = 진영 HIVE 중심 ± 10.
        - 표면은 림에서 HIVE 중심 쪽으로 올라가며 **지면과 60°**(`HIVE_CELL_TILT`)를 이룬다. 즉 표면은 HIVE 바깥 위를 향하고, 바깥 법선은 수평에서 30° 위.
        - 림에서 표면 거리 s인 점: 수평 이동 s·cos60° (HIVE 중심 방향), 높이 z = 53.5 + s·sin60°.
        - **조준점**(`hiveCellAimPoint`) = 오각형의 면적 중심. 림에서 표면 거리 5.560 in (수평 2.780, 수직 4.815).
        - 오각형이 좌우 대칭이므로 4개 셀은 x = 72 / y = 72 기준으로 정확히 대칭이다:

          | 셀 | 림 x 범위 | 림 y | 어깨 y (s = 7.61, z = 60.09) | 꼭짓점 (x, y) (s = 14, z = 65.62) | 조준점 (x, y) (z = 58.32) | 바깥 법선 |
          |---|---|---|---|---|---|---|
          | RED_OPPOSITE | 49.25~69.25 | 52.74 | 56.545 | (59.25, 59.740) | (59.25, 55.520) | (0, −0.866, 0.5) |
          | RED_AUDIENCE | 49.25~69.25 | 91.26 | 87.455 | (59.25, 84.260) | (59.25, 88.480) | (0, +0.866, 0.5) |
          | BLUE_OPPOSITE | 74.75~94.75 | 52.74 | 56.545 | (84.75, 59.740) | (84.75, 55.520) | (0, −0.866, 0.5) |
          | BLUE_AUDIENCE | 74.75~94.75 | 91.26 | 87.455 | (84.75, 84.260) | (84.75, 88.480) | (0, +0.866, 0.5) |
        - HIVE 안의 기물(`IN_HIVE`)은 상향 셀 조준점을 바닥에 정사영한 좌표에 둔다.
    - **비행 판정용 HIVE 직육면체 (`HIVE_HEIGHT`):** HIVE의 복잡한 구조 대신, 밑면 = HIVE 프레임 AABB, 높이 = 오각형 꼭짓점 z(53.5 + 14·sin60° ≈ 65.62 in)인 직육면체로 근사한다. 빗맞은 공이 HIVE에 부딪히는지 넘어가는지(2.6.2항 발사 비행 처리)와 몬테카를로 명중 판정의 진입 면 조건(2.6.2항 ④)에 쓴다.
    - v2.0.0에서 로봇 / 바닥 공에 대해서는 HIVE를 기둥 2개 + 가운데 터널(y 방향 통과)로 바꾼다 (5.4항 HIVE 터널). 비행 판정용 직육면체는 그대로다.
2. **FLOWER (단단한 장애물):**
    - **크기:** 반지름 2.0 in 원.
    - **중심 좌표:** RED 쪽 (2.0, 96.0), (48.0, 2.0) / BLUE 쪽 (142.0, 48.0), (96.0, 142.0).
3. **GARDEN (통과 가능 구역, 23 × 2 in):**
    - RED: 좌측 하단 (x 0~23, y 142~144) / BLUE: 우측 상단 (x 121~144, y 0~2).
4. **LOADING ZONE (통과 가능 구역, 23 × 11 in):**
    - RED: 좌측 중간 (x 0~11, y 24~47) / BLUE: 우측 중간 (x 133~144, y 97~120).

### 2.3 로봇 기본값과 시작 위치

- **크기 기본값:** 18 × 18 in.
- **기본 시작 자세** (타일 중앙, 벽에 밀착):
    - **RED:** R1 `(9.0, 36.0)`, R2 `(9.0, 108.0)`, 헤딩 `0` (오른쪽).
    - **BLUE:** R1 `(135.0, 36.0)`, R2 `(135.0, 108.0)`, 헤딩 `Math.PI` (왼쪽).
- 시작 자세는 로봇 제원(`RobotConfig`)이 아니라 경기 시작 조건(`ScenarioConfig.r1Spawn` / `r2Spawn`)으로 지정한다. 지정하지 않으면 진영별 기본값을 쓰며, 엔진은 이 표를 `DEFAULT_SPAWN_POSES`로 제공한다.

### 2.4 기물 초기 배치

기물은 총 40개(POLLEN 32개, NECTAR 8개)다.

1. **POLLEN (직경 2.8 in 구):** 32개.
    - 로봇 적재 8개: 로봇 2대에 4개씩 (`CONTROLLED`). 로봇 적재 한도(`maxControlledPieces`)가 4보다 작으면 한도만큼만.
    - FLOWER 안 16개: FLOWER 4개에 4개씩 (`IN_FLOWER`).
    - GARDEN 8개: RED GARDEN 4개, BLUE GARDEN 4개 (`IN_GARDEN`).
2. **NECTAR (직경 3.6 in):** 우리 진영 색 8개 (상대 진영 NECTAR는 없음).
    - 필드에 풀린 NECTAR 3개(`NECTAR_IN_PLAY`): 기본 배치에서는 우리 HIVE 상향 셀 안(`IN_HIVE`). 오토 이후에는 HIVE / 로봇 적재 / 바닥 중 어딘가에 있다.
    - 휴먼 플레이어 재고 5개: 필드 밖 대기(`OUT_OF_BOUNDS`). HIVE TIP마다 1개씩 LOADING ZONE에 들어오고, ENDGAME이 시작되면 남은 재고가 모두 들어온다. 오토 중 TIP 보상분은 TELEOP 시작 직전에 들어온다(아래 `autoTipCount`).
    - **휴먼 플레이어 NECTAR 투입 규칙:** 투입이 정해진 NECTAR는 재고(`nectarStock`)에서 투입 대기(`pendingHumanNectar`)로 옮겨지고, 우리 LOADING ZONE의 빈 슬롯(기존 기물 · 로봇과 겹치지 않는 자리, 벽 쪽 우선)에 정지 상태로 놓인다. 슬롯은 RED LOADING ZONE 기준으로 만들고 BLUE는 필드 중심 점대칭으로 옮겨 두 진영의 배치가 대칭이다. 로봇이 LOADING ZONE을 막아 빈 슬롯이 없으면 대기하다가 자리가 나는 틱에 바로 놓인다 (기물을 로봇 몸체 안에 만들지 않음).
3. **TELEOP 시작 조건 (오토 결과 시나리오):**
    - **공식 기본 배치** (`ScenarioConfig`를 주지 않은 경우):
        * HIVE 상향 셀: RED `AUDIENCE_CELL`, BLUE `OPPOSITE_CELL`
        * HIVE 안: 상향 셀에 NECTAR 3개
        * 로봇 적재물: R1, R2 각각 POLLEN 4개 (적재 한도가 4 미만이면 한도만큼)
        * FLOWER: 4개 모두 POLLEN 4개씩
        * GARDEN: 양 진영 각각 POLLEN 4개
        * 오토 TIP 횟수: 0 (LOADING ZONE 투입 NECTAR 없음)
        * 바닥 무작위 산포: 없음 (위 배치로 POLLEN 32 / NECTAR 8개가 모두 소진됨)
    - **커스텀 시나리오** (`ScenarioConfig`로 덮어쓰는 값):
        * HIVE 상향 셀 방향(`hiveUpwardCell`)과 안에 든 POLLEN / NECTAR 수.
        * R1, R2 적재물(`r1Loadout`, `r2Loadout`): **순서 있는 기물 종류 목록**. 적재함은 FIFO(0번이 가장 먼저 발사 / 투입)이며, 오토 중 NECTAR를 흡입했다면 NECTAR도 넣을 수 있다. 지정하지 않으면 적재 한도만큼 POLLEN.
        * 남은 GARDEN POLLEN 수(`gardenPiecesCount`: 우리 / 상대), 남은 FLOWER POLLEN 수(`flowerPiecesCount`).
        * 오토 중 HIVE TIP 횟수(`autoTipCount`): 휴먼 플레이어가 TELEOP 시작 직전에 그 수만큼 NECTAR를 재고에서 꺼내 LOADING ZONE에 넣는다 (룰북 규정). 벽 쪽 슬롯부터 결정론적으로 배치하며 무작위 산포보다 먼저 한다. 오토 TIP은 POLLINATOR RP 판정의 TIP 횟수에 합산된다(2.6.5항).
        * R1, R2 시작 자세(`r1Spawn`, `r2Spawn`: 위치 x, y와 헤딩) = 오토가 끝난 위치. 지정하지 않으면 진영별 기본값(2.3항).
        * 난수 시드(`rngSeed`): 바닥 산포, 발사 명중 판정, 빗맞음 반사, HIVE 낙하 분포가 모두 이 시드로 재현된다. 지정하지 않으면 엔진 기본 시드.
    - **바닥에 남은 기물은 자동 계산:** 위에서 지정되지 않은 나머지 기물은 오토 중 바닥에 흩어진 것으로 보고 필드 바닥(`state: 'ON_FIELD'`, 속도 0)에 무작위로 놓는다. HIVE AABB, FLOWER, 로봇 시작 자세, **양 진영 GARDEN과 LOADING ZONE**, 이미 놓인 기물과 겹치지 않는 자리만 쓴다.
        - GARDEN을 빼는 이유: 산포된 공이 GARDEN에 걸쳐 멈추면 `IN_GARDEN`으로 판정되어 시나리오에서 정한 GARDEN 수가 바뀐다. LOADING ZONE을 빼는 이유: 휴먼 플레이어 NECTAR 슬롯과 주차 구역을 막지 않기 위해.
        - 무작위 시도 200회가 모두 실패하면 HIVE 아래 필드 중앙 하단 기준점에서 3 in 간격으로 고리를 넓혀 가며 첫 안전 좌표를 결정론적으로 찾는다.
        - 바닥 POLLEN = 32 − (로봇 적재 POLLEN + FLOWER + HIVE POLLEN + GARDEN)
        - 바닥 NECTAR = 3(`NECTAR_IN_PLAY`) − (HIVE NECTAR + 로봇 적재 NECTAR). 남는 NECTAR는 휴먼 플레이어 재고로 돌아가지 않는다.
        - 휴먼 플레이어 재고 = 5 − `autoTipCount`
        - 바닥 기물을 직접 배치하는 화면은 v2.0.0 예정(5.2항).
    - **배치 순서:** 로봇 적재물 → FLOWER → HIVE → GARDEN → 오토 TIP NECTAR(LOADING ZONE) → 바닥 무작위 산포.
    - **시나리오 검증 (`validateScenario`):** 아래 중 하나라도 어기면 화면은 시나리오 적용 버튼을 막는다. 엔진은 화면을 거치지 않은 값에 대비해 같은 규칙으로 잘라서 받는다(안전장치).
        - FLOWER별 POLLEN: 0 ~ 4 정수 (오토 중 FLOWER 투입은 룰상 불가하므로 초기값 4를 넘을 수 없음) — `FLOWER_COUNT`
        - GARDEN별 POLLEN: 0 ~ 8 정수 (GARDEN 23 in / POLLEN 2.8 in의 물리 한도) — `GARDEN_COUNT`
        - HIVE 상향 셀 {NECTAR, POLLEN}이 TIP 임계(2.6.1항)에 닿지 않을 것 (닿으면 시작 전에 이미 넘어간 불가능한 상태), NECTAR ≤ 3 — `HIVE_OVER_THRESHOLD`, `HIVE_COUNT`
        - 로봇 적재물 길이 ≤ 그 로봇의 적재 한도 — `LOADOUT_OVER_CAPACITY`
        - `canIntakeNectar = false`인 로봇의 적재물에 NECTAR 금지 — `LOADOUT_NECTAR_NOT_ALLOWED`
        - HIVE NECTAR + 로봇 적재 NECTAR ≤ 3 — `NECTAR_IN_PLAY_EXCEEDED`
        - 지정한 POLLEN 합계(로봇 적재 + FLOWER + HIVE + GARDEN) ≤ 32 — `POLLEN_TOTAL_EXCEEDED`
        - `autoTipCount`: 0 ~ 5 정수 — `AUTO_TIP_COUNT`

### 2.5 기물 물리 상수

기물 종류별 물리 상수는 `src/core/collision.ts`에 있다.

| 항목 | POLLEN | NECTAR |
|---|---|---|
| 반지름 | 1.4 in (직경 2.8) | 1.8 in (직경 3.6) |
| 질량 | 24.95 g (질량비 1.0) | 41.28 g (질량비 1.65) |
| 바닥 마찰 감속도 `frictionDecel` | 65.0 in/s² (EVA 폼 타일 쿨롱 감속) | 85.0 in/s² (타일 침하 저항) |
| 반발 계수 `restitution` | 0.35 | 0.25 |

- **정지 임계 속도:** `speed < 0.5 in/s`가 되면 수치 진동을 막기 위해 속도를 0으로 맞춘다.
- **중력 가속도 (`GRAVITY`):** 9.80665 m/s² ≈ 386.09 in/s². 발사 비행은 공기 저항과 공 회전을 무시한 진공 포물선으로 계산한다.
- **착지 속도 유지 비율 (`landingSpeedRetention`, 기물별, 기본 0.3 — 실측 전 임시값):**
    - 공기 저항이 없으므로 비행 중 수평 속도는 v0·cosθ로 일정하다. 실제 공은 EVA 폼 타일에 떨어지며 여러 번 튀면서 에너지를 잃어, 굴러가기 시작하는 속도가 v0·cosθ보다 훨씬 작다. 이 손실을 착지 순간 한 번에 반영하여, 바닥에 착지한 빗맞음 기물의 초기 속도 = 발사 방향 × v0·cosθ × `landingSpeedRetention`. HIVE에 맞고 떨어진 기물도 착지 순간 수평 속도 × 같은 비율로 굴러가기 시작한다(2.6.2항 충돌 후 낙하).
    - 예: 발사각 45°, 거리 60 in, 발사구 높이 12 in이면 v0 ≈ 274 in/s, 수평 194 in/s. 손실 없이 굴리면 POLLEN 마찰 65 in/s²로 약 290 in를 굴러 필드를 가로지른다.
    - **실측 방법:**
        1. 슈터를 고정하고 HIVE를 피해 바닥을 향해 기물 종류별로 여러 번(예: 10회 이상) 발사하며 옆에서 고fps 영상을 찍는다.
        2. 발사구 → 첫 착지 지점의 수평 거리 ÷ 비행 시간(프레임 수 ÷ fps)으로 착지 직전 수평 속도 v_h를 잰다 (또는 v0·cosθ 계산값).
        3. 첫 착지 지점 → 최종 정지 지점의 거리 L을 잰다.
        4. 착지 후를 마찰 감속도 a(POLLEN 65, NECTAR 85 in/s²)의 등감속 구름으로 보면 굴러가기 시작한 속도 = √(2·a·L)이므로 `landingSpeedRetention = √(2·a·L) / v_h`.
        5. 반복 측정 평균을 쓴다. (알려진 속도로 굴린 공의 정지 거리를 재서 마찰 감속도 자체도 검증하면 더 정확하다.)

### 2.6 득점과 구조물 규칙

#### 2.6.1 HIVE TIP과 시차 낙하

- **초기 상태:** RED는 `AUDIENCE_CELL`, BLUE는 `OPPOSITE_CELL`이 위(UP)를 향한 채 시작한다 (시나리오로 변경 가능).
- **TIP 임계 테이블 (`HIVE_TIP_POLLEN_BY_NECTAR`):** 상향 셀의 NECTAR 수별로 TIP이 일어나는 POLLEN 수. 임계 조합 {NECTAR, POLLEN} = {5, 0}, {4, 1}, {3, 3}, {2, 5}, {1, 6}, {0, 8}. 상향 셀 POLLEN ≥ 그 NECTAR 수의 임계 POLLEN이면 TIP (NECTAR 5개 이상이면 POLLEN 0개로 바로 TIP). 상향 셀 개수는 NECTAR / POLLEN을 따로 센다(`nectarInUpwardCell`, `pollenInUpwardCell`).
- **TIP 시점:** 명중한 공이 **도착한 틱**(2.6.2항 발사 비행 처리)에 상향 셀이 임계에 닿으면 그 틱에 바로 TIP 상태(`isTipping = true`, `tipProgressTimer = 0`)가 된다.
    - TIP 진행 중(낙하 대기열 방출 완료 전)에 발사된 공은 명중 확률과 무관하게 **모두 빗맞음**이다.
    - TIP 전에 명중으로 발사됐더라도, 도착 시점에 TIP 진행 중이거나 상향 셀이 발사 시점과 달라졌으면 조준점에서 셀 앞면 바깥으로 튕겨 떨어진다 (무효 명중, 2.6.2항 충돌 후 낙하).
- **30도 기울기 기반 시차 낙하 (Staggered Drop Queue):**
    - **기준점(Lip Origin):**
        - 기준 X: 우리 진영 중심선 `Lip_X = (alliance === 'RED') ? 59.25 : 84.75`
        - 기준 Y: Audience 쪽으로 넘어갈 때(+y 방향) `Lip_Y = 91.475` (아래쪽 개구부 립), Opposite 쪽으로 넘어갈 때(−y 방향) `Lip_Y = 52.525` (위쪽 개구부 립)
        - 쏟아지는 방향 계수 `spillDir`: Audience 쪽 `+1.0`, Opposite 쪽 `−1.0`
    - **기물별 몬테카를로 착지 분포:**
        - **POLLEN:** `targetY = Lip_Y + spillDir × Normal(24.3, 8.3)`, `targetX = Lip_X + Normal(0, 5.9)`, `settleTime = Uniform(1.46, 2.10)`초 (평균 1.83초)
        - **NECTAR:** `targetY = Lip_Y + spillDir × Normal(20.2, 7.0)`, `targetX = Lip_X + Normal(0, 5.9)`, `settleTime = Uniform(1.36, 2.08)`초 (평균 1.76초)
    - **데드존 재추첨:** 뽑은 `(targetX, targetY)`가 필드 밖(공 반지름 여유), HIVE AABB(반지름 여유 포함), 로봇 OBB와 겹치면 최대 50회 다시 뽑는다. 그래도 실패하면 안전한 바닥 좌표를 강제로 정한다.
    - **진행 순서:**
        1. 임계에 닿으면 20점 획득, `tipCount++`, `isTipping = true`, `tipProgressTimer = 0`, 상향 셀 반전, 새 상향 셀 개수 0으로 초기화.
        2. 셀 안의 공마다 목표 좌표와 `settleTime`을 계산해 `pendingDrops` 대기열에 넣는다.
        3. 매 틱 `tipProgressTimer += 0.02`를 누적하고, 각 공의 `settleTime`이 되면 그 좌표에 정지 상태(`ON_FIELD`, 속도 0)로 차례로 내려놓는다.
        4. 대기열이 모두 비면(약 2.1~2.2초) `isTipping = false`로 돌아가 다음 득점을 받는다.
        5. TIP 즉시 휴먼 플레이어가 NECTAR 1개를 LOADING ZONE에 넣는다 (빈 슬롯이 없으면 자리가 날 때까지 대기, 2.4항 투입 규칙).

#### 2.6.2 HIVE 슈팅과 탄도 모델

**역할 분리.** 엔진은 발사마다 3D 궤적으로 명중을 판정하지 않는다. 로봇 설정을 적용할 때 몬테카를로로 명중 확률표(LUT)를 미리 만들고(`ballistics.ts`), 경기 중에는 판정 함수(`ShotProbabilityResolver`)가 LUT를 조회한 확률과 시드 난수 1회로 명중을 정한다. 아래 "몬테카를로 명중 판정"은 **LUT를 만들 때만** 쓰이며 엔진 루프에서는 실행되지 않는다.

- **판정 함수는 엔진 필수 인자:** `SimulationEngine(r1Config, r2Config, shotResolver, alliance?, scenario?, shooters?)`. 실제 경기는 LUT 기반 `createLUTShotResolver`를, 테스트는 고정 확률 함수를 넣는다.
- **물리 가정:** 공기 저항 · 공 회전 무시, 중력 `GRAVITY` ≈ 386.09 in/s² (2.5항).
- **발사구 위치:** 높이 `z0 = HIVE_RIM_Z − dz` (림 z = 53.5가 고정이므로 `BallisticsConfig.dz`로 역산). 수평 위치는 로봇 중심에서 조준 방향으로 `shooterOffset`만큼 떨어진 점. 터렛 회전축은 차체 중심으로 가정하므로 고정형(정면 조준 시)과 터렛형의 발사구 위치가 같다.
- **조준점:** 목표 셀 투입구 오각형의 면적 중심 (2.2항 표, `hiveCellAimPoint`). 조준 오차, v0 역산, 명중 기물 배치의 기준이다.
- **v0 닫힌 해:** 발사구 → 조준점 수평 거리 $D$, 높이차 $\Delta z = z_{\text{aim}} - z_0$, 발사각 $\theta$일 때

    $$v_0 = \frac{D}{\cos\theta} \sqrt{\frac{g}{2(D\tan\theta - \Delta z)}}$$

    ($D\tan\theta > \Delta z$일 때만 해가 있다)

##### 스윗스팟 (한 점 입력)

- 로봇마다 기준 셀 `RED_AUDIENCE`를 가장 잘 넣는 로봇 중심 좌표 **한 점**(`BallisticsConfig.sweetSpot`)만 받는다.
    - 여러 단계의 명중률(예: 100% / 80% / 60% 구역)을 입력받지 않는 이유: 명중 확률은 편차 모델의 몬테카를로가 계산하므로, 사용자가 추정한 구역으로 보정하면 같은 편차를 이중으로 반영하고 덜 정확해진다. v0 고정 슈터의 명중 구역이 조준점 주변 거리 띠 모양으로 넓게 나타나는 것은 입력이 아니라 LUT 결과로 드러난다. (실측 명중률은 향후 편차 파라미터 보정에 쓴다, 5.2항)
- **화면 입력 기준:** 화면은 현재 시나리오 진영의 공식 시작 상향 셀(RED → `RED_AUDIENCE`, BLUE → `BLUE_OPPOSITE`)을 기준으로 스윗스팟을 입력 / 표시하고, BLUE는 필드 중심 점대칭 (x, y) ↔ (144 − x, 144 − y)로 바꿔 저장한다. 저장값은 항상 `RED_AUDIENCE` 기준이므로 진영을 바꿔도 LUT가 무효화되지 않는다 (3.8항).
    - 변환 함수: `sweetSpotBasisCell(alliance)`, `sweetSpotFromBasis(p, alliance)`(진영 기준 → 저장 좌표), `sweetSpotToBasis(p, alliance)`(저장 좌표 → 진영 기준). 두 변환 모두 **진영 기준 좌표에서 격자 중심으로 스냅한 뒤** 점대칭한다. 그래서 격자 경계 위의 점(예: BLUE (84, 10))도 사용자가 화면에서 본 격자가 그대로 LUT / 검증에 쓰인다 (변환 후 스냅하면 경계에서 옆 격자가 선택됨).
- **격자 중심 스냅 (`snapSweetSpot`):** 스윗스팟은 그 점을 담는 1 in 격자의 중심(x.5)으로 스냅한 뒤 검증 / v0 탐색한다 (경계 위의 점은 큰 쪽 격자, 예: (60, 135) → (60.5, 135.5)). LUT는 격자 중심에서만 명중률을 계산하므로, 격자 중심에서 v0를 찾아야 스윗스팟 격자의 LUT 값이 탐색 명중률과 일치한다 (근거리 상승 사격은 명중 띠가 격자보다 좁을 수 있음). 화면의 격자 클릭 입력은 이미 격자 중심이다.
- **검증 (`validateBallisticsConfig`):** 스냅한 스윗스팟 기준으로 엄격히 적용하며, 통과하지 못하면 로봇 탭 적용(LUT 생성) 버튼을 막는다. 헤딩은 입력받지 않고, 화면은 조준점을 향해 돌린 로봇 몸체 윤곽과 실패 사유를 미리 보여 준다.
    - 조준점을 바라보는 로봇 몸체가 필드 안 — `SWEET_SPOT_OUT_OF_FIELD`
    - HIVE AABB와 겹치지 않음 — `SWEET_SPOT_IN_HIVE`
    - 닫힌 해 존재 — `SWEET_SPOT_NO_SOLUTION`
    - 파라미터 유효 (발사각 (0, π/2), 유한값, 편차 ≥ 0, 로봇 크기 > 0) — `PARAM_INVALID`
    - v0 탐색 뒤 스윗스팟 명중률(`sweetSpotHitRate`)이 0이면 경고한다.

##### 2단계 몬테카를로 (로봇별 · 기물 종류별 독립)

1. **v0 탐색 (`searchLaunchSpeed`):** 스윗스팟의 닫힌 해 v0를 초기값으로, 닫힌 해 ±20%(1% 간격) → 최고점 ±1%(0.1% 간격)를 1차원 탐색하여 몬테카를로 명중률(후보당 20000샘플)이 가장 높은 v0를 고른다. 모든 후보가 같은 시드(공통 난수)를 써서 비교 잡음을 줄이고, 동률이면 닫힌 해(굵은 탐색 최고점)에 가까운 후보를 고른다. POLLEN / NECTAR를 따로 탐색한다 (팀이 기물 종류별로 슈터를 튜닝했다고 가정).
2. **LUT 생성 (`generateReferenceLUT`):** 고른 v0로 144 × 144 격자(1 in) 중심 $(g_x + 0.5, g_y + 0.5)$마다, 로봇이 조준점을 정면 조준했다고 가정한 명중률 $P_{\text{spatial}}$(격자당 2000샘플)을 계산한다. 조준점을 바라보는 로봇 몸체가 HIVE AABB와 겹치는 격자는 0.
    - **격자별 독립 난수 구간:** 격자 i는 기준 스트림의 $[i \cdot N \cdot 6,\ (i+1) \cdot N \cdot 6)$ 구간을 쓴다 (N = 격자당 샘플, 샘플 1개 = 난수 6개 `RNG_DRAWS_PER_SAMPLE`). Mulberry32 상태는 고정 증분 수열이라 `createRng(seed, skip)`로 O(1) 점프한다. 구간이 겹치지 않으므로 격자 계산 순서 / 건너뛰기 / Web Worker 분할과 무관하게 같은 값이 나온다 (144² × N × 6 < 2³² → N ≤ 약 34,000).
    - **도달 불가 격자 생략 (`canPossiblyHit`, 기본 켬):** 명중하려면 통과점이 오각형 위에 있어야 하므로, 발사구 → 오각형 지면 투영까지의 수평 거리 범위에서 공 높이가 [림 z, 꼭짓점 z]에 들어올 수 있어야 한다. 속도 / 발사각 편차 ±6σ 상자에서 높이의 최댓값 · 최솟값을 닫힌 형태로 구하고(속도에 단조, tanθ에 오목), 거리를 0.05 in 간격 + 립시츠 여유로 훑어 불가능이 확실한 격자만 0으로 둔다. ±6σ 밖 확률은 샘플당 약 6e-9라 생략해도 결과가 같다 (테스트로 동일성 검증).
    - 생략 비율은 약 11~16%로 크지 않다. 속도 편차 6σ(±12%)의 공은 포물선 하강 구간으로 필드 대부분의 거리에 닿을 수 있어 확실히 0인 격자를 증명할 수 있는 범위가 좁기 때문이다 (방위 편차 부채꼴로 투영을 잘라도 약 1%p 추가라 쓰지 않음). 실제로 0이 아닌 격자는 3~20% 수준.

- **샘플 편차 (`estimateHitRate`):** 속도 $v_0(1 + N(0, \text{v0NoisePercent}))$, 방위 $+N(0, \text{headingNoiseRad})$, 발사각 $+N(0, \text{pitchNoiseRad})$ (기본 0.02 / 0.02 rad / 0.006 rad). 발사구 위치는 명목 조준 방향 기준이고 편차는 공의 방향에만 적용한다.
- **결정론:** Mulberry32 시드 PRNG(`createRng`, 엔진과 같은 알고리즘의 독립 스트림). 기준 시드(`RobotLUTOptions.seed`, 기본 `DEFAULT_BALLISTICS_SEED`)에서 기물 종류 × 용도(탐색 / LUT)별 시드를 파생하고(`robotLUTSeeds`), LUT는 그 안에서 격자별 구간을 쓰므로 같은 설정 + 같은 시드 = 같은 LUT.
- 준난수(Sobol / Halton) 샘플링은 쓰지 않는다 (얻는 정확도에 비해 변경 범위가 큼).
- **통합 함수:** `generateRobotLUTs(config, robotSize, options)` → `{luts, v0, sweetSpotHitRate, issues}` (로봇 1대분 8장). 검증에 실패하면 LUT 전부 0, v0 null (판정 함수가 항상 0).

##### 몬테카를로 명중 판정 (샘플 1개, LUT 생성 전용)

아래를 모두 만족하면 명중이다.

- **① 앞면 통과:** 공 중심 궤적이 상향 셀 투입구 평면을 **앞면에서** 통과한다 (통과 순간 속도 · 바깥 법선 < 0).
- **② 줄인 오각형:** 통과점이 오각형을 **기물 반지름만큼 안쪽으로 줄인 영역** 안에 있다 (공 전체가 들어감). 반지름이 기물마다 달라 POLLEN / NECTAR LUT가 따로 필요하다.
- **③ 림 아래 벽 여유:** 통과 전 공 중심이 림 아래 벽(y–z 단면 R = [림 y, HIVE 앞면 y] × (−∞, 림 z], 셀 폭 방향으로 이어짐)과 반지름 이상 떨어져 있다. R을 r만큼 넓힌 영역 = 옆 띠(y ∈ [R − r], z < 림 z) ∪ 윗면 띠(z < 림 z + r) ∪ 윗모서리 원 2개. 공 높이가 시간에 대해 오목하므로 띠는 구간 끝점 검사로 정확하고, 모서리는 경로 곡률 반경(수백 in) ≫ r이라 거리 함수가 단봉이므로 황금분할 탐색으로 정확하다 (촘촘한 샘플링 기준 판정과 0.00%p 일치). 공이 모서리를 비스듬히 지날 때의 수직 거리(높이 여유 × cos(진입각))까지 반영하므로 상승 진입을 과대 · 과소 인정하지 않는다.
- **④ HIVE 직육면체 진입 면:** 통과 전 공이 직육면체(xy ± r, 높이 `HIVE_HEIGHT` + r)에 처음 들어오는 곳이 (a) 셀 앞면(AUDIENCE y = maxY + r / OPPOSITE y = minY − r, 안쪽으로 이동, 셀 폭 x ∈ [셀 좌측 + r, 셀 우측 − r]) 또는 (b) 셀 위 윗면(z = `HIVE_HEIGHT` + r, 셀 폭 안, 오각형 꼭짓점보다 앞쪽)이어야 한다.
    - HIVE 옆면 / 뒷면 / 셀 옆 프레임 / 셀 폭 밖 앞면으로 들어오면 차단한다 (HIVE 옆에서 옆면을 뚫고 오는 공을 명중으로 세지 않음).
    - 진입점과 통과점이 모두 셀 폭 안이면 그 사이 직선 경로도 셀 폭 안이므로 진입점 검사로 충분하다. 발사구가 이미 박스 안이면 앞면 앞 공간(림 바깥, 셀 폭 안)일 때만 허용한다.
- **구현 (`isShotInHiveCell`):** 투입구 평면까지의 부호 거리 $f(t)$는 오목한 2차식이므로 앞면 → 뒷면 통과는 항상 큰 근이다 (상승 진입도 앞면 통과면 인정). 줄인 오각형은 볼록 다각형의 각 변(밑변, 좌우 세로 변, 삼각형 빗변 2개)을 r만큼 안으로 옮긴 반평면의 교집합.
- **근거리 상승 사격:** 발사구가 낮고 조준점까지 가까우면 공이 아직 올라가는 중에 입구에 닿는다 (도달 기울기 $2\Delta z / D - \tan\theta > 0$). 공이 벽 윗모서리를 비스듬히 지나므로, 입구 아래쪽 / 가운데를 노린 공은 모서리에 걸리고 위쪽만 들어가 명중 띠가 좁다 (예: 발사구 12 in, 발사각 55°, 거리 약 35 in에서는 조준점 명목 궤적도 모서리를 0.97 in 거리로 스쳐 빗맞음). 멀리서 내려오며 들어가는 사격은 띠가 넓다.
- **고각 사격의 두 띠:** 발사각이 크면 로봇이 멀어질수록 입구 통과 높이가 림 → 입구 위쪽 → 림으로 올라갔다 내려와, 조준점 가까운 쪽에 상승 진입 띠, 먼 쪽에 하강 진입 띠(거리에 덜 민감해 더 넓음)가 생긴다. 두 띠 사이는 포물선 꼭대기가 입구 삼각형(좁아지는 부분)에 걸려 약간 낮다.

##### LUT 구성과 4셀 대칭

- 로봇 2대 × 기물 2종 × 4셀 = **16장**, 각 144 × 144 `Float32Array` (1 in 격자, 인덱스 `gy * 144 + gx`). 타입: `HeatmapLUT`, `HeatmapLUTSet`(4셀), `RobotHeatmapLUTs`(기물 종류별).
- **격자 / 샘플 수 근거:** 명중 띠 안 평균 오차는 2 in 격자 + 최근접 조회 2.9~9.4%p(최대 36~44%p), 1 in 격자 + 쌍선형 보간 0.3~1.1%p(최대 3.8~4.9%p)였다. 1 in + 보간 + 격자당 2000샘플(표본 오차 약 1%p)에서 격자 오차와 표본 오차가 비슷해진다. v0 탐색 20000샘플은 찾은 v0의 실제 명중률 손실을 0.6%p → 0.07%p로 줄이며 메모리 영향이 없다 (샘플을 저장하지 않음).
- 몬테카를로는 기준 셀 `RED_AUDIENCE`에서만 돌리고(로봇 × 기물 = 4회), 나머지 3셀은 격자 인덱스를 대칭 복사한다 (`mirrorLUTSet`, 셀 기하가 정확히 대칭이므로 오차 없음):
    - `RED_OPPOSITE`: y = 72 기준 대칭 (x, 144 − y) → $g_y' = 143 - g_y$
    - `BLUE_AUDIENCE`: x = 72 기준 대칭 (144 − x, y) → $g_x' = 143 - g_x$
    - `BLUE_OPPOSITE`: (72, 72) 점대칭 (144 − x, 144 − y) → 두 인덱스 모두 반전
- **연산량 / 메모리:** 격자당 2000샘플 기준 최대 4 × 20,736 × 2000 ≈ 1.66억 샘플 (도달 불가 격자 생략 전). 단일 스레드(Node V8, 스윗스팟 (60.5, 134.5), 발사구 14 in)로 로봇 1대(8장)에 발사각 55° 약 33초, 70° 약 61초가 걸린다 (고각일수록 입구 근처까지 가는 샘플이 많아 ③ 판정 비용 증가). 메모리는 16 × 20,736 × 4 B ≈ 1.3 MB. 저장 레시피(3.9항)는 LUT 대신 탄도 설정 + 시드를 저장해 다시 만든다.

##### LUT 생성 실행과 사용자 경험

로봇 1대 단일 스레드 약 30~60초를 "멈춰서 기다리는 시간"이 아니라 "다른 입력을 하는 동안 진행되는 시간"으로 만든다. 아래 1~4를 모두 적용한다 (저정밀 미리보기는 쓰지 않음, 5.3항).

1. **Web Worker 풀 병렬 생성 (`src/workers/`):**
    - **모듈:** `lutWorker.ts`(작업 처리기만 연결하는 Worker 진입점, `ballistics.ts`의 순수 함수만 import, DOM / React 비의존), `createLUTWorker.ts`(`new Worker(new URL('./lutWorker.ts', import.meta.url), { type: 'module' })`), `lutProtocol.ts`(메시지 타입 + 순수 작업 처리기 `handleLUTJob(job, post)`), `lutManager.ts`(`LUTManager`, Worker 생성 함수를 주입받음).
    - **풀 크기 (`defaultLUTPoolSize`):** `max(1, min(navigator.hardwareConcurrency − 1, 8))` (UI 스레드용 코어 1개를 남김, 코어 수를 모르면 4코어로 가정). 풀은 앱 수명 동안 재사용한다.
    - **작업 단위:** (로봇, 기물 종류, 단계). 단계 ① v0 탐색 = 작업 1개 (나누지 않음, 약 1~2초) → 단계 ② 기준 셀 LUT = 격자 행 묶음 작업 (기본 4행 = 576격자). 로봇 2대 × 기물 2종의 작업을 한 대기열에 넣고 쉬는 Worker가 다음 작업을 가져가는 동적 분배다 (명중 띠가 지나는 행은 ③ 판정 비용이 커서 정적 분할보다 균형이 좋음). 같은 (로봇, 기물)의 ② 작업은 ①이 끝나 v0가 정해져야 대기열에 들어간다.
    - **대기열 순서:** v0 탐색 작업이 행 작업보다 우선한다 (두 번째 로봇의 v0가 첫 번째 로봇 행 작업 뒤로 밀리지 않음). 행 작업은 요청 순서(FIFO). 탐색 / LUT 작업에 보내는 설정은 스윗스팟을 스냅한 설정이다 (행 계산은 스윗스팟과 무관).
    - **행 단위 함수:** `generateReferenceLUTRows(config, robotSize, pieceType, v0, samples, seed, gyStart, gyEnd, options) → Float32Array((gyEnd − gyStart) × 144)`. 격자 인덱스 / 난수 구간은 전체 LUT 기준 그대로이며, 범위는 정수로 내림한 뒤 [0, 144]로 제한하고 `gyEnd < gyStart`면 빈 배열이다. `generateReferenceLUT`는 `generateReferenceLUTRows(…, 0, 144)`와 같다. 시드 파생 `robotLUTSeeds(seed = DEFAULT_BALLISTICS_SEED) → Record<PieceType, { search, lut }>`를 공개해 Worker 작업 계획이 `generateRobotLUTs`와 같은 시드를 쓴다.
    - **결정론:** 격자별 독립 난수 구간이므로 어떤 분할 / 순서 / Worker 수로 계산해도 결과가 `generateRobotLUTs` 단일 스레드 결과와 비트 단위로 같다 (임의 행 분할 · 작업 계획 동일성 테스트).
    - **메시지 규약:** 메인 → Worker `{ kind: 'search' | 'rows', jobId, generation, robotId, pieceType, config, robotSize, samples, seed, gyStart?, gyEnd?, v0? }`, Worker → 메인 `{ kind: 'progress', jobId, cellsDone }`(행 1개마다) / `{ kind: 'result', jobId, generation, v0?, hitRate?, rows? }` / `{ kind: 'error', jobId, message }`. 결과 `Float32Array`는 transferable로 넘겨 복사 비용이 없다. 닫힌 해가 없으면 `v0` 없는 결과, 예외는 `error` 메시지.
    - **조립:** 메인 스레드가 (로봇, 기물)별 기준 LUT `Float32Array(144 × 144)`에 행 결과를 복사하고, 모든 행이 모이면 `mirrorLUTSet`으로 4셀을 만들어 `RobotHeatmapLUTs`를 완성한다.
    - **상태 스냅샷 `getStatus(robotId)`:** 상태 / 세대 / 검증 사유 / 오류 / 기물별 탐색 완료 · v0 · 스윗스팟 명중률 / 완료 격자(실행 중 작업의 행 단위 진행 포함) / 조립 중 기준 LUT + 행별 완료 표시(점진 히트맵용) / 결과. `onChange(robotId)`는 변화마다 호출되고 화면이 `requestAnimationFrame`으로 모은다. `matchLUTs()`는 두 로봇이 모두 `READY`일 때만 경기용 LUT를 준다.
    - **같은 요청 무시:** LUT를 결정하는 입력의 정규화 키 `lutRequestKey`(모델 버전 + 스냅한 스윗스팟 · 편차 기본값을 채운 탄도 설정 + 로봇 길이 / 폭 + 시드 + 샘플 수, 속성 순서를 고정한 JSON)가 진행 중이거나 `READY`인 요청과 같으면 아무것도 하지 않는다 (속도 등 무관한 제원만 바꿔 다시 `APPLY`해도 재생성 없음). 캐시 키는 이 문자열의 SHA-256이다.
    - **로봇 간 공유:** 다른 로봇이 같은 요청 키로 생성 중이거나 `READY`면 새로 만들지 않고 따라간다 (진행 / 상태는 앞선 로봇 것을 보여 주고, 앞선 로봇이 `READY`가 되면 결과를 함께 씀). 앞선 로봇이 취소 / 오류 / 검증 실패 / 설정 변경으로 멈추면 따라가던 로봇이 그때부터 스스로 생성하고(캐시 조회부터), 결과를 받은 뒤에는 서로 독립이다. 기본 프리셋처럼 R1 = R2면 첫 생성이 한 번으로 줄어든다.
    - **오류:** Worker `error` 메시지 / `onerror` / 행 결과 길이 불일치 → 그 로봇만 `ERROR`(사유 포함) + 대기 작업 제거, 다른 로봇은 계속한다. 같은 설정을 다시 요청하면 새로 생성한다.
    - **실측:** 헤드리스 Chromium, 4코어 컨테이너, Worker 3개에서 로봇 2대 × 기물 2종 기본 정밀도(격자당 2000 / 후보당 20000샘플) 전체 약 9.3초. 8코어 기준 로봇 1대 약 8~10초, 4코어 약 15~20초로 예상한다 (모바일은 더 느림). 개발 서버와 정식 빌드 모두에서 실제 Worker 결과가 `generateRobotLUTs`와 비트 단위로 같음을 확인했다.
2. **진행 상황 표시:**
    - **v0 먼저 표시:** 단계 ①이 끝나면 바로 기물 종류별 v0와 스윗스팟 명중률(`sweetSpotHitRate`)을 보여 준다. 0이면 경고("이 스윗스팟에서는 명중 불가 — 설정 확인")하되 생성은 계속한다.
    - **진행 막대:** 로봇별 `완료 격자 / 전체 격자` (기물 2종 합산, 전체 = 2 × 20,736). HIVE 겹침 / 도달 불가로 생략되는 격자는 행 처리 때 바로 완료로 센다. 단계 ① 동안은 "v0 탐색 중"으로 표시.
    - **남은 시간:** `경과 시간 × (남은 격자 / 완료 격자)`를 지수 평활해 표시하고, 5% 완료 전에는 표시하지 않는다 (초반 추정 불안정).
    - **점진 히트맵:** 메인 필드의 히트맵 편집 모드(3.8항)에 진영 기준 셀 LUT(RED = `RED_AUDIENCE`, BLUE = 점대칭 `BLUE_OPPOSITE`)를 행 묶음이 도착할 때마다 그린다 (미계산 행은 회색 빗금, 기물 종류 전환 가능). 사용자가 명중 띠가 드러나는 과정을 보며 설정이 맞는지 판단할 수 있다. 필드 윤곽 / HIVE / 조준점 / 스윗스팟을 함께 표시하고, 보기는 관중석 시점으로 고정한다 (3.7항).
    - **갱신 빈도:** 진행 / 히트맵 갱신은 `requestAnimationFrame`으로 모아 최대 약 10 Hz (메시지마다 React 상태를 바꾸지 않음).
3. **막지 않는 작업 흐름:**
    - **로봇별 상태 머신:** `IDLE`(설정 없음 / 검증 실패) → `QUEUED` → `SEARCHING`(단계 ①) → `GENERATING`(단계 ②, 진행률) → `READY` | `ERROR`. 설정이 바뀌면 `CANCELLED`를 거쳐 다시 `QUEUED`.
    - **시작 시점:** 로봇 탭 `APPLY`(검증 `validateBallisticsConfig` 통과 시에만 활성) 때. 입력 중 자동 재생성은 하지 않는다. 단, 앱을 시작할 때 기본 프리셋 / 자동 보관 설정(3.8항)의 LUT는 자동으로 만든다 (캐시에 있으면 바로 `READY`).
    - **무효화 조건:** 그 로봇의 `BallisticsConfig`, 로봇 `length` / `width`(HIVE 겹침 격자 / 검증에 영향), 기준 시드, 샘플 수가 바뀔 때만. 그 밖의 `RobotConfig` 변경(속도, 인테이크 등)과 시나리오 변경은 LUT를 무효화하지 않는다.
    - **취소:** 설정 변경으로 다시 요청하거나 `cancel(robotId)`를 부르면 로봇별 세대 번호(`generation`)를 올리고 대기열의 이전 세대 작업을 지우며, 실행 중인 작업의 결과 / 진행 메시지는 세대가 다르면 무시한다. `cancel`은 진행 중일 때만 `CANCELLED`로 멈추고 `READY`는 유지한다. 행 묶음이 작아(수백 ms) Worker를 강제 종료하지 않는다 (종료하면 풀 재생성 비용이 생김).
    - **막는 동작:** 경기 시작(과 LUT가 필요한 경기 불러오기)만 두 로봇이 모두 `READY`일 때 가능하고, 막힌 이유를 보여 준다 ("로봇 2 확률표 생성 중 63%"). 로봇 / 시나리오 / 스윗스팟 편집, 필드 보기 등 나머지는 모두 계속할 수 있다.
    - **사용 흐름 예:** 로봇 1 적용 → 생성 시작 → 그동안 로봇 2 입력 / 적용 → 시나리오 입력 → 대부분 입력이 끝날 즈음 생성 완료.
4. **IndexedDB 캐시 (`src/workers/lutCache.ts`):**
    - **캐시 키:** 정규화 JSON의 SHA-256 해시(`crypto.subtle.digest`, 16진 64자) — `{ BALLISTICS_MODEL_VERSION, BallisticsConfig(스윗스팟은 스냅한 좌표, 편차 미지정 값은 기본값으로 채움), robot length / width, seed, samples, searchSamples }`. `skipUnreachable`은 결과가 같으므로 키에서 뺀다.
    - **`BALLISTICS_MODEL_VERSION`:** `ballistics.ts`의 정수 상수(현재 1). 명중 판정 / LUT 생성 규칙 / 투입구 기하가 바뀌는 커밋마다 올려서 이전 캐시를 자동으로 무효화한다.
    - **저장 형식:** DB `ftc-tactic-sim`, 저장소 `lutCache`(keyPath `key`), 레코드 `{ key, modelVersion, createdAt, lastUsedAt, v0: {POLLEN, NECTAR}, sweetSpotHitRate: {POLLEN, NECTAR}, reference: {POLLEN: ArrayBuffer, NECTAR: ArrayBuffer} }`. 기준 셀 LUT만 저장하고(로봇당 2 × 82,944 B ≈ 166 KB), 불러올 때 `mirrorLUTSet`으로 4셀을 복원한다.
    - **정리:** 다른 모델 버전 레코드는 모두 지우고, 현재 버전은 `lastUsedAt` 기준 최근 20개(약 3.3 MB)만 남긴다 (동률은 키 순). 저장할 때 정리한다.
    - **조회 흐름:** 요청 → `QUEUED`에서 캐시 조회 → 적중하면 Worker 작업 없이 기준 LUT 복원 + 4셀 대칭 복사 → `READY`(`fromCache = true`). 미스 / 조회 실패(비동기 · 동기 예외)면 v0 탐색부터 생성 → `READY` 직후 저장(저장 실패는 무시). 적중 결과는 다시 저장하지 않고, 적중하면 `lastUsedAt`만 갱신한다. 조회가 끝났을 때 그 사이 재요청 / 취소로 실행이 바뀌었으면 결과를 버린다.
    - **레코드 검증:** 모델 버전 불일치 · 버퍼 길이 ≠ 82,944 B · v0 비유한값 · 명중률 누락이면 미스로 처리한다.
    - **실패 허용:** IndexedDB나 `crypto.subtle`(비보안 연결 등)을 쓸 수 없으면(사생활 보호 모드, 용량 초과 등) 캐시 없이 매번 생성하며 기능은 같다. `createBrowserLUTCache()`는 앱 시작 때 동기로 만들어 관리자에 넣고, 처음 쓸 때 DB를 연다.
    - **저장 레시피와의 관계:** 레시피에는 LUT 대신 탄도 설정 + 시드 + 샘플 수 + `BALLISTICS_MODEL_VERSION`을 저장한다. 불러올 때 캐시가 있으면 바로, 없으면 위 생성 흐름을 탄다. 모델 버전이 다르면 "다시 만든 확률표로 결과가 달라질 수 있음"을 경고한다 (3.9항).

##### 경기 중 명중 판정 (`createLUTShotResolver`)

엔진 생성자에 넣는 `ShotProbabilityResolver`. 엔진은 발사 완료 틱에 `(robotId, pieceType, robot.x, robot.y, robot.heading, alliance, upwardCell)`로 호출하고, 받은 확률과 시드 난수 1회로 명중을 정한다.

- **입력:** `luts: MatchHeatmapLUTs`(로봇 슬롯별 `RobotHeatmapLUTs`), `r1Config` / `r2Config`의 `turretType` / `turretRange` / `aimTolerance`. 슈터 설정은 만들 때 복사해 고정한다 (이후 원본 객체를 바꿔도 경기 중 판정에 새지 않음 → 결정론).
- **$P_{\text{spatial}}$:** `luts[robotId][pieceType][hiveCellKey(alliance, upwardCell)]`를 로봇 중심 좌표에서 **쌍선형 보간**(`sampleLUT`)으로 조회한다. 둘러싼 격자 중심 4개 값을 거리 비례로 섞고, 필드 가장자리 격자 중심 바깥은 가장자리 값. 셀 키 = `${alliance}_${AUDIENCE | OPPOSITE}`. TIP으로 상향 셀이 바뀌면 다음 발사부터 새 셀의 LUT와 조준점을 쓴다.
- **조준 오차:** $\Delta\psi$ = `angleDifference(조준점 방위, heading)` = 조준점 방위 − 헤딩, [−π, π]. 조준점 방위는 로봇 중심 → 상향 셀 조준점. 부호: + = 로봇 오른쪽 (캔버스 y-down에서 각도가 커지는 방향).
- **조준 판정 (`isAimWithinShooterRange`):**
    - **고정형(`FIXED`):** $|\Delta\psi| \le$ `aimTolerance`(기본 3° ≈ 0.0524 rad, 경계 포함)이면 $P_{\text{final}} = P_{\text{spatial}}$, 아니면 0. 허용 오차가 비유한값 / 음수면 0으로 본다 (정확히 정렬될 때만).
    - **터렛형(`TURRET`):** `turretRange` $[\alpha, \beta]$를 [−π, π]로 정규화한다 (`normalizeAngle`은 ±π를 보존하므로 360° 터렛 [−π, π] 유지). $\alpha \le \beta$면 $\alpha \le \Delta\psi \le \beta$, $\alpha > \beta$면 ±π를 가로지르는 구간 ($\Delta\psi \ge \alpha$ 또는 $\Delta\psi \le \beta$, 예: 후방 터렛 [2.5, −2.5]). 범위가 비유한값이면 조준 불가.
    - 한계: 허용 오차 / 터렛 범위 안이면 조준 오차에 따른 명중률 감소는 반영하지 않는다 (LUT는 정면 조준 가정). 고정형은 허용 오차가 작아(±3°) 영향이 작다.
- **안전장치:** LUT 값이 비유한값이면 0, 결과는 [0, 1]로 제한 (엔진도 한 번 더 제한).

##### 발사 비행 처리

- **목표:** 발사 순간 공이 HIVE로 순간이동하는 부자연스러움을 없애되, 결과(명중 여부)는 LUT 판정을 그대로 따르고, 3D 물리 엔진 없이 닫힌 해로 계산한다.
- **범위 분리:** 엔진은 궤도 결과(충돌 / 도착 지점, 충돌 후 낙하 구간, 최종 착지 지점 / 시점 / 속도)를 발사 시점에 계산해 비행 대기열에 기록하고 도착 틱에 반영한다. 이 기록을 보간해 그리는 것은 렌더러다 (3.7항).
- **충돌 후 낙하도 비행의 일부:** HIVE / 벽에 공중에서 닿은 공은 그 자리에서 바닥으로 옮기지 않고 반사 포물선으로 바닥까지 떨어뜨린다 (최대 약 66 in 높이에서 한 프레임 만에 바닥으로 옮겨지는 부자연스러움 방지). 낙하 중에는 `IN_FLIGHT`라 흡입 / 충돌 대상이 아니다 (현실과 일치).
- **슈터 탄도 입력:** 엔진 생성자 선택 인자 `shooters?: MatchShooterBallistics`. 로봇별 `ShooterBallistics {dz, shooterPitch, shooterOffset, v0?: {POLLEN?, NECTAR?}}`는 LUT 생성 결과에서 `shooterBallisticsFrom(config, generateRobotLUTs 결과)`로 만든다 (판정 LUT와 같은 발사구 / 발사각 / 탐색 v0). 지정하지 않으면 기본 자동 슈터 `DEFAULT_SHOOTER_BALLISTICS`(발사구 14 in, 발사각 60°, 오프셋 0, v0는 발사마다 조준점 닫힌 해). 만들 때 복사해 고정한다.
- **결과 선확정 / 난수:** 발사 완료 틱에 판정 함수 확률과 시드 PRNG 난수로 명중을 확정한다. 난수는 발사마다 **항상 3회**(명중 판정, 반사 세기 산포 `bounceRestitutionRoll`, 반사 방향 산포 `bounceAngleRoll`) 쓰고 도착 시점에는 쓰지 않는다 (무효 명중의 반사도 발사 때 뽑아 둔 값을 씀). 그래서 결과와 무관하게 난수 순서가 일정해 결정론이 유지된다. TIP 진행 중 발사는 발사 시점에 빗맞음.
- **명목 궤적 (`planShotFlight`, 편차 없는 포물선, 발사 1회당 상수 시간):**
    - 발사 방향 (`shotLaunchHeading`): 고정형 = 로봇 헤딩, 터렛형 = 조준점 방위 (터렛 범위 밖이면 가까운 한계각으로 제한).
    - 발사구 = 로봇 중심 + 발사 방향 × `shooterOffset`, 높이 53.5 − dz. 발사각이 (0, π/2) 밖이면 기본값.
    - v0 우선순위: 탄도 설정의 기물별 v0 → 조준점 닫힌 해 → (해가 없으면) 평지 사거리 = 조준점 거리인 속도 $\sqrt{g D / \sin 2\theta}$.
- **도착 규칙:**
    - **명중:** 궤적과 무관하게 조준점에 도착한다 (LUT 결과 우선). 비행 시간 $T = D / (v_0\cos\theta)$ (D = 발사구 → 조준점 수평 거리).
    - **빗맞음 + HIVE 충돌 (`intersectHiveBox`):** HIVE 직육면체를 기물 반지름만큼 넓히고(xy 경계 ± r, 높이 `HIVE_HEIGHT` + r, 공 표면 접촉 기준), 지면 직선이 넓힌 AABB 안에 있는 구간(착지 전까지)에서 공 중심 높이가 넓힌 높이 이하가 되는 첫 지점을 찾는다. 들어오는 순간 이미 낮으면 옆면 `SIDE`, 위로 들어와 구간 안에서 내려오면 윗면 `TOP`. 그 접촉점에서 아래 **충돌 후 낙하** 규칙으로 튕겨 바닥까지 떨어진다.
    - **빗맞음 + HIVE를 넘어가거나 닿지 않음:** 공 중심 높이가 기물 반지름이 되는 수평 거리 R 지점에 착지한다. 착지 후 발사 방향 수평 속도 = $v_0\cos\theta$ × `landingSpeedRetention`(2.5항)인 `ON_FIELD` 기물이 되고, 이후는 바닥 물리가 처리한다. 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 **벽 접촉점(공중)에서 수평 이동을 멈추고 수직으로 떨어져** 벽 앞 바닥에 속도 0으로 착지한다.
    - 고정형 슈터는 조준을 벗어나면 확률 0이고 직선도 조준점을 비껴가므로 판정과 연출이 일치한다.
- **충돌 후 낙하 (`planHiveBounce` / `planFallToFloor` / `planVoidedHitBounce`):** 충돌 순간 상태(위치, 속도: 수평 $v_0\cos\theta$ 발사 방향, 수직 $v_0\sin\theta - g t$)에서 반사한 뒤 중력 포물선으로 바닥(공 중심 z = r)까지 떨어진다. 모두 닫힌 해이며 구간 목록(`FlightSegment`)으로 기록한다.
    - **반발 계수:** 기물별 `restitution`(POLLEN 0.35 / NECTAR 0.25, 2.5항) × 반사 세기 산포 (1 + 0.2 · (2 · `bounceRestitutionRoll` − 1)), 즉 0.8~1.2배 (`HIVE_BOUNCE_RESTITUTION_SPREAD`).
    - **옆면 (`SIDE`):** 접촉 면(넓힌 AABB에서 가장 가까운 면, 모서리 동률이면 속도가 더 깊이 파고드는 면)의 수평 바깥 법선 n으로 파고드는 법선 성분만 $v_n \to -e\,v_n$ (접선 / 수직 성분 유지). 이어서 수평 속도를 반사 방향 산포 ±15°(`HIVE_BOUNCE_ANGLE_SPREAD`, `bounceAngleRoll`)만큼 돌리고, 바깥 법선 성분이 `HIVE_BOUNCE_MIN_SPEED`(20 in/s)보다 작으면 법선 방향으로 보충한다 (스치듯 맞아도 반드시 HIVE에서 멀어짐). 그 뒤 바닥까지 포물선.
    - **윗면 (`TOP`) 반복 튐:** 직육면체 윗면(z = `HIVE_HEIGHT` + r)에 떨어진 공은 수직 속도만 $v_z \to e\,|v_z|$로 뒤집고 수평 속도는 유지한다 (첫 튐에서 ±15° 산포 회전). 다시 윗면 높이로 내려오기 전(체공 $2 v_z / g$)에 넓힌 AABB를 벗어나면 그 포물선 그대로 바닥까지 떨어지고 (수평 직선 + 볼록 박스라 다시 부딪히지 않음), 아니면 윗면에 다시 떨어져 튄다. 최대 `HIVE_TOP_MAX_BOUNCES`(3)회 튀고도 윗면 위라면 수평 속도 방향(멈춰 있으면 가장 가까운 면 바깥)으로 max(수평 속도, 20 in/s)로 윗면을 굴러(`ROLL` 구간, 높이 유지) 가장자리에서 수직 속도 0으로 떨어진다. 실제 HIVE 윗부분은 평판이 아니므로 "윗면에 맞으면 낮게 튀며 진행 방향으로 넘어간다"를 근사한 것이며, HIVE 위에 걸려 멈추는 경우는 모델링하지 않는다.
    - **무효 명중:** 명중으로 발사됐지만 도착 시점에 TIP 진행 중이거나 상향 셀이 바뀐 공은 조준점에서 그 셀 쪽 HIVE 앞면의 수평 바깥 법선(AUDIENCE +y / OPPOSITE −y)으로 옆면 규칙과 같이 튕겨 떨어진다. 도착 속도의 수평 방향은 발사구 → 조준점 (렌더러 명목 구간과 같은 방향). 결과는 `MISS_HIVE`로 바뀌고 착지 틱이 늦춰진다.
    - **벽:** 모든 낙하 포물선에서 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 그 지점에서 수평 이동을 멈추고 수직으로 떨어진다 (착지 속도 0). 즉 **높이 무한 · 반발 계수 0인 벽**을 가정한다. 실제로는 벽보다 높이 날아간 공이 필드 밖으로 나가기도 하지만 이는 전술이 아닌 실수이므로 구현하지 않는다 (벽 반사는 v2.0.0 예정, 5.2항).
    - **착지:** 착지 속도 = 착지 순간 수평 속도 × `landingSpeedRetention` (벽에서 멈췄으면 0). 안전장치로 착지점을 필드 안 / 넓힌 HIVE AABB 밖으로 제한한다 (발사구가 HIVE에 걸친 비정상 입력에서만 작동).
- **비행 대기열 (`FieldState.pendingShots: PendingShot[]`, 발사 순서):** `{pieceId, pieceType, robotId, result('HIT' | 'MISS_HIVE' | 'MISS_FLOOR'), targetCell(발사 시점 상향 셀), launchTick, arriveTick, contactTime, fromX/Y/Z, toX/Y/Z, heading, v0, pitch, segments: FlightSegment[], landX/Y, landingVx/Vy, bounceRestitutionRoll, bounceAngleRoll}` (4장). 발사하면 기물 상태를 `IN_FLIGHT`로 바꾸고 좌표는 발사구 지면 투영, 속도 0.
    - 명목 구간: 발사구(`from`) → `to`(명중 = 조준점, HIVE 충돌 = 첫 접촉점, 벽 = 벽 접촉점, 바닥 = 착지점), 끝 시각 `contactTime`(발사 후 초). 충돌 후 구간 `segments`는 시간순이며 각 구간 `{kind: 'BALLISTIC' | 'ROLL', t0, t1, x, y, z, vx, vy, vz}`(발사 후 초, 구간 시작 상태). 마지막 구간 끝 = 착지점 `landX/Y`. 빈 배열이면 명목 구간 끝이 착지점(또는 명중).
    - 도착 틱: 명중 = 발사 틱 + max(1, round(`contactTime` / dt)) (조준점 도착, 유효성 판정), 그 외 = 발사 틱 + max(1, round(최종 착지 시각 / dt)).
    - 틱 처리 순서 5-2(HIVE 시차 낙하 다음, 3.4항)에서 도착 틱이 된 발사를 발사 순서대로 처리한다. 명중은 **도착 시점에 TIP 진행 중이 아니고 상향 셀이 발사 시점과 같을 때만** HIVE에 쌓이고 TIP 판정을 한다 (같은 틱에 두 발이 도착하면 앞 발의 TIP이 뒤 발을 무효화). 무효면 조준점에서 반사 낙하 구간을 붙이고 `MISS_HIVE`로 바꿔 착지 틱(현재 틱 이후)까지 비행을 유지한다. 그 외는 착지점 / 착지 속도로 `ON_FIELD`.
    - 비행 중(낙하 포함) 기물은 로봇 / 기물 / FLOWER 위를 지나므로 충돌하지 않는다 (물리 / 충돌은 `ON_FIELD`만 대상). 착지 지점이 로봇이나 기물과 겹치면 다음 틱 충돌 처리로 밀려난다.
    - 경기 종료(6000틱)까지 도착하지 못한 비행은 득점에 반영하지 않는다 (기물은 `IN_FLIGHT`로 남음).
    - 타임라인 스냅샷은 대기열 배열 / 항목 / 구간 목록을 복제해 기록을 보호한다.
- **렌더링:** 렌더러는 명목 구간을 출발점 → `to` 선형 보간 + 명목 포물선 높이에 끝점을 맞추는 선형 보정으로, 충돌 후 구간은 기록된 포물선 / 굴러감을 그대로 계산해 기물 크기 / 그림자 오프셋으로 그린다 (3.7항). 필요한 정보가 모두 프레임에 있으므로 스크러빙 / 분기 재생에서도 똑같이 재현된다.
- **탄도 계산 함수 (`ballistics.ts`):** 궤적은 `Trajectory {x, y, z, heading, v0, pitch}`(발사구 위치 + 수평 방향)로 표현하고, 수평 거리 d의 높이 $z(d) = z_0 + d\tan\theta - g d^2 / (2 v_0^2 \cos^2\theta)$, 시간 $t(d) = d / (v_0\cos\theta)$로 조회한다.
    - 발사구 / 조준: `launchHeight`(53.5 − dz), `launchPoint`(조준 방향 `shooterOffset`), `bearingTo`.
    - 닫힌 해: `solveLaunchSpeed(D, Δz, θ)`(해가 없으면 null), `solveAimLaunchSpeed`(로봇 위치 → 조준점), `sweetSpotLaunchSpeed`(스윗스팟 → `RED_AUDIENCE` 조준점, v0 탐색 초기값 / 검증), `createAimTrajectory`.
    - 궤적 조회: `heightAtDistance`, `timeAtDistance`, `pointAtDistance`, `descendingDistanceAtHeight`(내려오며 그 높이에 닿는 큰 근), `landingDistance` / `landingPoint`(공 중심 높이 = 반지름, 필드 경계 무시 — 벽 처리는 엔진).
    - HIVE 교차: `intersectHiveBox(traj, pieceRadius)` → `{x, y, z, distance, time, face}` 또는 null(넘어감 / 못 미침 / 비껴감).

#### 2.6.3 FLOWER 기물 조작과 하단 추출

- **슬롯 구조와 유효 득점 볼륨:** FLOWER는 수직 원통이다. 아래 출구 밖으로 빠져나와 바닥 타일에 닿아 있는 맨 아래 기물은 공식 룰상 득점 인정 영역 밖이다.
    - **`slot[0]` (바닥 접촉 슬롯):**
        - 아래 출구 밑 바닥에 닿아 있는 슬롯. **경기 종료 득점에서 완전히 빠진다 (0점).**
        - 로봇이 하단으로 추출할 때 가장 먼저 회수되는 대상.
        - FLOWER는 단단한 장애물(반지름 2.0 in)이라 바닥에서 공을 밀어 넣을 수 없고, 위에서 넣은 NECTAR(3.6 in)는 아래 배출구(2.8 in)를 지나지 못하므로 `slot[0]`에는 POLLEN만 올 수 있다.
    - **`slot[1 .. N]` (원통 안 유효 득점 볼륨):** 아래 턱에 걸려 바닥으로 내려가지 못한 기물과 그 위로 차례로 쌓인 기물. 경기 종료 시 득점 대상이다.
- **경기 종료 득점 (2 v 0 단순화):** 상대 기물이 없으므로, 경기 종료(6000틱) 시점에 `slot[1 .. N]` 안에 우리 NECTAR가 1개 이상 있으면 소유권과 하단 보너스가 모두 성립한다.
    - **소유권:** `slot[1 .. N]` 안 기물 전체 개수 × 2점.
    - **하단 보너스:** 5점.
    - `slot[1 .. N]`에 NECTAR가 없으면 그 FLOWER는 0점.
- **하단 추출(deQ)과 중력 침하:**
    - **추출 조건:** FLOWER 원통(반지름 2.0 in)의 바닥 정사영 원이 로봇 인테이크 구역(`intakeZones`, 3.3항) 중 하나와 겹침 + `actionState === 'INTAKING'` + 적재 공간 여유(`controlledPieces.length < 적재 한도`, 적재 한도 = min(`maxControlledPieces`, 4)). 인테이크 구역이 없는 면으로는 추출할 수 없다. 여러 FLOWER가 동시에 걸리면 차체에 가장 가까운 것을 우선한다.
    - **추출:** `slot[0]`에 POLLEN이 있고 접촉 유지 시간(`intakeContactTimer`)이 최소 추출 쿨다운에 닿으면 `slot[0]` 기물을 로봇에 적재하고 `intakeContactTimer = 0`.
    - **연속 추출 쿨다운:** 다음 기물까지 `max(robotConfig.intakeDelay / 1000, 0.12초)`를 기다린다 (중력으로 기물이 내려오는 최소 시간).
    - **NECTAR 하단 막힘 (잼):** `slot[0]`이 비었을 때
        - 바로 위(`slot[1]`)가 POLLEN이면 그 기물이 `slot[0]`으로 내려오고 위 기물들도 한 칸씩 내려온다.
        - 바로 위가 NECTAR면 NECTAR(3.6 in)가 아래 배출구(2.8 in)보다 커서 턱에 걸린다. NECTAR는 `slot[1]`에 영구 고정되고 `slot[0]`은 빈칸(`null`)으로 남으며, 이후 하단 추출은 영구히 막힌다.
- **위에서 넣기 (Drop):**
    - 대상: 로봇 OBB 외곽과 FLOWER 원통의 최단 거리가 1.0 in 이내인 FLOWER 중 가장 가까운 것 (v1은 투입 방향 무관, 방향 구역은 v2.0.0 예정, 5.2항). 대상이 없으면 넣을 수 없다.
    - NECTAR는 ENDGAME(남은 60초 이하)에만 넣을 수 있다.
    - **FLOWER 용량 테이블 (`FLOWER_MAX_POLLEN_BY_NECTAR`, `FLOWER_MAX_NECTAR_CAPACITY = 6`):** 바닥(`slot[0]` 포함)부터 높이 21.5 in 원통에 최대로 채울 수 있는 조합 {POLLEN, NECTAR} = {9, 0}, {8, 1}, {6, 2}, {5, 3}, {3, 4}, {2, 5}, {1, 6}. 넣은 뒤 원통 안 전체 POLLEN 수(`slot[0]` 포함)가 그 NECTAR 수의 최대 POLLEN 이하이고 NECTAR ≤ 6이어야 한다.
        - 산출 기준: 원통 안 지그재그 적층 + 맨 위 기물이 일부라도 원통 안에 걸치면 인정. 사용자 계산값이며 실측이 가능해지면 바꾼다 (5.2항).
        - **`slot[0]` 불변식:** `slot[0]`에는 NECTAR가 올 수 없다 (초기 배치는 POLLEN만, 하단 추출 후 NECTAR는 `slot[1]`에 걸림, 빈 원통에 넣은 NECTAR는 `[null, NECTAR]`). 그래서 NECTAR가 있는 FLOWER의 `slot[0]`은 항상 POLLEN이거나 POLLEN으로 세는 빈칸(아래 잼 처리)이며 계산상 POLLEN ≥ 1이다. 기하 계산상의 {0, 7} 조합은 `slot[0]`이 NECTAR여야 하므로 도달할 수 없어 테이블에서 뺐다.
        - **잼 상태 용량 (단순화):** `slot[0]`이 비고 `slot[1]`에 NECTAR가 걸린 잼 상태(하단 추출 후 잼, 또는 빈 원통에 NECTAR 투입)에서는 빈 `slot[0]`을 **POLLEN 1개로 세어** 같은 테이블을 쓴다. 출구 턱 높이가 POLLEN 직경(2.8 in)과 같아, 턱에 걸린 NECTAR는 `slot[0]` POLLEN 위에 놓인 경우와 같은 높이에서 쌓이기 시작하기 때문이다. 턱 위 받침과 공 위 받침에 따른 미세한 적층 차이는 **의도적으로 무시**한다. 이 가상 POLLEN은 용량 판정에만 쓰이고 득점(`slot[1..N]` 개수)에는 들어가지 않는다.
    - 투입은 적재함 맨 앞 기물(FIFO, `controlledPieces.shift()`)을 FLOWER 맨 위 슬롯에 추가한다 (`pieces.push(piece)`). 투입 가능 여부 = ① 도달 거리 안 FLOWER, ② NECTAR는 ENDGAME에만, ③ 용량 테이블 (엔진 `findDropTarget`).
- **리프트 FSM:** 리프트를 올리고(준비) → 올린 채 대기 → 투입 → 내리는 단계를 나눠, 드라이버가 리프트를 올린 뒤 투입 시점을 고르고 실수로 올린 리프트를 다시 내릴 수 있게 한다.
    - **상태 (모두 Stationary Lock, 3.4항):** `FLOWER_SETUP`(올리는 중) → `FLOWER_READY`(올린 채 대기, 타이머 없음) ⇄ `FLOWER_DROPPING`(투입 중) → `FLOWER_LOWERING`(내리는 중) → `IDLE`.
    - **리프트 유지 요청** = 행동 요청이 `FLOWER_SETUP` 또는 `FLOWER_DROPPING`. 그 밖의 요청(`IDLE` / `INTAKING` / `SHOOTING`)은 리프트 상태에서 "내림" 요청으로 본다.
    - **`IDLE` / `INTAKING`에서:**
        - `FLOWER_SETUP` 요청: 투입 가능(①②③)할 때만 받아 `FLOWER_SETUP`에 들어간다 (`stateTimer = flowerSetupDelay`, 제동 후 정지 시점부터 차감). 불가능하면 거부한다 (리프트를 올리지 않음, 상태는 `IDLE` / `INTAKING`).
        - `FLOWER_DROPPING` 요청: **무효** (리프트가 올라가 있지 않으면 투입 불가).
    - **`FLOWER_SETUP`(올리는 중):** 유지 요청이면 계속 올리고 타이머가 끝나면 `FLOWER_READY`. 내림 요청이면 바로 `FLOWER_LOWERING`으로 바뀌며 내리는 시간 = **지금까지 올린 시간**(`flowerSetupDelay − 남은 stateTimer`). 아직 제동 중이라 올린 시간이 0이면 곧바로 `IDLE`.
    - **`FLOWER_READY`(대기):** `FLOWER_DROPPING` 요청 + 투입 가능 → `FLOWER_DROPPING`(`stateTimer = flowerDropDelay`). 투입이 불가능하면 요청을 무시하고 대기한다. `FLOWER_SETUP` 요청이면 대기 유지. 내림 요청이면 `FLOWER_LOWERING`(`stateTimer = flowerSetupDelay`). 적재함이 비어도 자동으로 내리지 않는다 (내림 요청까지 대기).
    - **`FLOWER_DROPPING`(투입 중):** 진행 중에는 모든 요청을 무시한다 (내림 요청 포함). 끝나면 투입 조건을 다시 확인해 가능하면 넣고, 불가능하면 기물을 그대로 둔다. 이어서 요청이 `FLOWER_DROPPING`이고 다음 기물을 넣을 수 있으면 연속 투입(`stateTimer = flowerDropDelay`), 아니면 `FLOWER_READY`로 돌아간다 (리프트는 올린 채).
    - **`FLOWER_LOWERING`(내리는 중):** 진행 중 모든 요청 무시, 끝나면 `IDLE`.
    - 리프트 상태에서는 HIVE 슈팅 / 흡입 요청을 받지 않는다 (리프트를 내린 뒤 `IDLE`에서 다시 요청). 입력 계층도 리프트 상태 동안 트리거 입력을 요청에 반영하지 않는다 (3.6항).

#### 2.6.4 GARDEN과 PARK (경기 종료 판정)

- 경기 중에는 실시간 점수에 넣지 않는다.
- 경기 종료 틱(6000틱)에 필드 상태를 검사해 한꺼번에 더한다.
    - **GARDEN:** 기물을 바닥(xy 평면)에 수직 정사영한 원(기물 반지름)이 우리 GARDEN AABB와 일부라도 겹친 채 완전히 멈춰(`speed === 0`, `state === 'IN_GARDEN'`) 있으면 개당 1점. 중심점이 구역 밖이어도 걸쳐 있으면 인정하고, 경계에 접하기만 한 경우(겹침 깊이 0)는 인정하지 않는다 (`collision.ts`의 `testCircleVsAABB`).
    - **PARK:** 우리 LOADING ZONE AABB와 차체(OBB)가 일부라도 겹친 채 멈춘 로봇당 5점 (FTC 룰상 부분 진입도 주차로 인정).

#### 2.6.5 랭킹 포인트 (RP)

- SWARM: 주차 점수 10점 / POLLINATOR 1: TIP 4회 / POLLINATOR 2: TIP 7회.
- POLLINATOR TIP 횟수는 **오토 TIP(`autoTipCount`) + TELEOP TIP(`tipCount`) 합산**으로 판정한다.
- 점수(`totalScore`)에는 TELEOP 구간의 TIP(회당 20점)만 들어가고 오토 TIP 점수는 들어가지 않는다.

## 3. 구조와 동작

### 3.1 상태와 렌더링의 분리

React는 화면 UI(컨트롤, 스크러버, 스코어보드)만 맡는다. 50 Hz 시뮬레이션 루프와 캔버스 2D 렌더링은 React 밖의 순수 TypeScript로 동작한다.

### 3.2 50 Hz 고정 틱과 타임라인

- `dt = 0.02` 고정 연산. 매 틱 스냅샷을 `TimelineFrame`으로 배열에 저장한다.
- **기록 보호:** 엔진은 타임라인을 `timeline` getter / `getFrame()` / `step()` 반환값으로 **읽기 전용(`DeepReadonly<TimelineFrame>`)**으로만 공개해 UI가 기록을 고치지 못하게 한다. `reset()`이나 가지 전환(3.9항) 때 타임라인 배열이 통째로 바뀌므로, UI는 배열 참조를 보관하지 말고 매번 `engine.timeline` / `getFrame()`으로 읽는다.
- **실시간 확정 득점과 경기 종료 득점의 분리:**
    - 경기 중(0 ~ 5999틱) `TimelineFrame.totalScore`에는 공식 룰상 바로 확정되는 **HIVE TIP 점수(회당 20점)**만 반영한다.
    - 확정되지 않은 요소(FLOWER 소유권 / 보너스, GARDEN, PARK)의 예측치는 타임라인 점수에 섞지 않는다.
    - 경기 종료 틱(6000틱)에 HIVE + FLOWER + GARDEN + PARK 점수를 한꺼번에 더해 최종 점수를 기록한다.
    - **득점 내역:** 종료 프레임에는 항목별 점수와 인정 근거(득점 FLOWER, 인정 GARDEN 기물 id, 주차 로봇)를 `TimelineFrame.scoreBreakdown`에 함께 기록하고, 그 외 프레임은 `null`이다. 항목 합 = `totalScore`. 렌더러의 경기 종료 강조(3.7항)와 결과 팝업(3.8항)은 이 기록만 읽고 득점 규칙을 다시 계산하지 않는다 (규칙의 단일 출처 = 엔진).

### 3.3 충돌과 기물 동역학 (`src/core/collision.ts`)

- **로봇-환경 충돌:** 벽, HIVE AABB, FLOWER 원 4개에 대해 SAT 침투 보정(MTV). 벽을 파고드는 법선 속도는 0으로 막고 접선 속도는 보존해 미끄러지게 한다. (v2.0.0: HIVE AABB → HIVE 기둥 2개, 바닥 공도 같음 — 5.4항)
- **로봇-로봇 충돌 (비탄성 슬라이딩):**
    - 법선 부호: `mtvNormal`은 `testOBBvsOBB(r1, r2)`가 반환하는 단위 법선으로 r1을 r2 밖으로 밀어내는 방향(r2 → r1)이다. `MTV = mtvNormal * depth`.
    - 위치 보정: `r1`은 `+0.5 * MTV`, `r2`는 `-0.5 * MTV`만큼 움직여 절반씩 떨어진다.
    - 법선 상대 속도 상쇄: `vRel = v1 - v2`, `vn = dot(vRel, mtvNormal)`이 음수(접근 중)이면 `r1.v -= 0.5 * vn * mtvNormal`, `r2.v += 0.5 * vn * mtvNormal`. 접선 속도는 그대로 두어 차체를 비비며 주행할 수 있다.
- **인테이크 구역 (`RobotConfig.intakeZones: BumperZone[]`):**
    - **구역 정의 (`BumperZone`):** 로봇 범퍼 변 하나에 붙는 로봇 기준 직사각형. 개수 제한 없음(한 변에 여러 조각 가능, 겹침 허용), 빈 배열이면 흡입할 수 없는 로봇.
        - `side`: 붙는 변 (`FRONT` / `BACK` / `LEFT` / `RIGHT`, 로봇 기준).
        - `offset`: 구역 중심의 변 중점 기준 이동 거리(in). 중심은 항상 변 위에 있고 `|offset| ≤ 변 길이 / 2`. **부호:** `FRONT` / `BACK` 변은 **로봇 오른쪽**이 +, `LEFT` / `RIGHT` 변은 **로봇 앞쪽**이 +.
        - `width`: 변과 평행한 길이(in, > 0). 변보다 길어도 된다(모서리 밖 돌출 허용).
        - `depth`: 변에서 차체 바깥으로 뻗는 깊이(in, > 0).
        - 엔진은 로봇의 현재 위치 / 헤딩으로 각 구역을 필드 좌표 OBB로 바꿔(`getBumperZoneOBB`) 판정한다. 로봇 OBB 축은 `axes[0]` = 로봇 앞쪽, `axes[1]` = 로봇 오른쪽 (캔버스 y-down).
    - **판정 (바닥 정사영):** GARDEN 판정(2.6.4항)처럼, 기물을 바닥에 수직 정사영한 원(기물 반지름 포함)이 인테이크 구역 중 하나와 일부라도 겹치면 유효하다. 공 중심이 구역 밖이어도 걸치면 인정하고, 경계에 접하기만 한 경우(겹침 깊이 0)는 인정하지 않는다. FLOWER 하단 추출도 FLOWER 원통 정사영 원과 인테이크 구역의 겹침으로 판정한다.
    - **프리셋 (`createIntakeZonePreset`):** `FRONT` / `ANY`는 별도 타입이 아니라 `BumperZone[]`을 만드는 편의 함수이며, 기본 depth는 1.0 in.
        - `FRONT`: `FRONT` 변 전체 폭(`width` = 로봇 너비) 구역 1개.
        - `ANY`: 4면 구역 4개, 각 `width` = 그 변 길이 + 2 × depth. 네 귀퉁이까지 덮어 차체를 사방으로 depth만큼 넓힌 영역과 같다.
        - 설정에는 숫자 배열만 저장되므로, 프리셋을 만든 뒤 로봇 크기가 바뀌면 프리셋을 다시 만들어야 한다.
    - **흡착 (Kinematic Pusher 트랩):** `INTAKING` 중 유효 구역에 걸친 공은 반발 계수를 0으로 줄여 범퍼 면에 안정적으로 머물게 한다.
    - **흡입 조건:** 구역 접촉 유지 시간(`intakeContactTimer`)이 `intakeDelay` 이상이고 적재 공간(`controlledPieces.length < 적재 한도`)이 있으면 `CONTROLLED`로 바꿔 적재함 맨 뒤에 넣는다 (FIFO).
- **공 vs 정적 장애물:**
    - 위치 보정: 장애물이 고정이므로 공에만 MTV를 100% 적용한다.
    - 속도 반사: 파고드는 법선 속도 `vn = dot(v_ball, normal) < 0`이면 `v_ball -= (1 + e) * vn * normal` (e = 기물별 반발 계수).
- **공 vs 로봇 (Kinematic Pusher):**
    - 로봇은 무한 질량으로 보고 감속하지 않는다. 공에만 MTV를 100% 적용한다.
    - 접촉점 유효 속도(회전 포함): 오프셋 `dx = ball.x - robot.x`, `dy = ball.y - robot.y`에 대해 `vEff.x = robot.vx - robot.omega * dy`, `vEff.y = robot.vy + robot.omega * dx`.
    - 충격량: `mtvNormal`은 로봇 → 공 방향. `vRel = v_ball - vEff`, `vn = dot(vRel, mtvNormal) < 0`이면 `v_ball -= (1 + e) * vn * mtvNormal` (달리는 로봇 범퍼에 맞은 공이 앞으로 튕겨 굴러감).
- **끼인 공 역보정 (`resolvePinnedPieces`):**
    - 문제: 로봇은 공을 그대로 밀지만, 공이 벽 / HIVE / FLOWER / 다른 로봇에 막혀 더 밀려날 곳이 없으면 공-벽 보정이 마지막에 공을 되돌려 공이 로봇 몸체 안에 묻힌다 (특히 로봇 면이 벽과 평행할 때).
    - 해결: 공 충돌 완화 뒤에도 로봇과 겹친(깊이 > 0.01 in) 공을 로봇 입장의 장애물로 보고 로봇을 MTV만큼 되밀며, 공 쪽으로 파고드는 법선 속도만 0으로 막는다. 접선 속도는 보존되므로 공을 누른 채 옆으로 미끄러질 수 있고 공은 모서리를 돌아 빠져나간다. 되밀린 로봇은 환경 충돌을 다시 보정한다.
    - 공이 로봇 하나에만 닿은 경우(정적 장애물과의 끼임): 그 로봇이 겹침을 전부 양보해 공에 막혀 멈춘다.
    - 공이 두 로봇 사이에 끼인 경우: 가장 깊이 겹친 로봇이 절반 양보를 시도하고, 양보하지 못한 만큼(벽에 막힘 등)은 공이 다른 로봇 쪽으로 밀려나 그 로봇이 양보한다. 마주 오는 두 로봇은 대칭으로 멈추고, 벽에 붙은 로봇 쪽으로 공을 밀어 넣으면 밀고 들어온 로봇이 멈춘다.
    - 인테이크 면으로 끼운 경우도 똑같이 멈추며, 공이 구역에 닿아 있으므로 `intakeDelay` 뒤에 흡입된다.
- **공 vs 공 (원 vs 원 PBD):**
    - 중심 거리 `d < rA + rB`이면 겹침 깊이 `depth = rA + rB − d`.
    - 질량비로 나눠 밀어낸다: `pieceA`는 `−depth × massB / (massA + massB) × normal`, `pieceB`는 `+depth × massA / (massA + massB) × normal`.

### 3.4 틱당 처리 순서

1. **로봇 기구학 갱신 (`kinematics.ts`)과 상태별 주행 제어**
    - **`INTAKING` (주행 중 흡입):** 주행 입력(`vx, vy, omega`)을 막지 않고 정상적으로 적분한다.
    - **`SHOOTING`과 리프트 상태 전체 (`FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING` / `FLOWER_LOWERING`, 2.6.3항) — Stationary Lock:**
        - 위치를 바로 고정하지 않고 목표 속도를 `(0, 0, 0)`으로 강제해 Slew Rate Limiter로 감속한다.
        - 차체가 완전 정지 임계(`speed < 0.5 in/s`, `|omega| < 0.05 rad/s`)에 닿기 전까지는 제동 상태(`isBraking = true`)로 기다리며 동작 타이머를 줄이지 않는다.
        - 완전히 멈추면 `isBraking = false`가 되고 그때부터 `stateTimer -= dt`.
2. 로봇-환경, 로봇-로봇 충돌 해결 (위치 / 속도 보정)
3. 바닥 공(`ON_FIELD`) 마찰 감속과 위치 적분 (`stepPieceDynamics`)
4. 공 충돌 완화 루프 (공 vs 환경 / 로봇 / 공, 2회 반복)
    - 4-2. 끼인 공 역보정 (`resolvePinnedPieces`): 완화 뒤에도 로봇과 겹친 공에 막힌 로봇을 되밀어 멈춤
5. HIVE `tipProgressTimer += dt` 누적, `settleTime`이 된 공을 차례로 `ON_FIELD`로 내려놓기
    - 5-2. 발사 비행 도착 (`stepShotArrivals`): 도착 틱이 된 발사를 발사 순서대로 명중 적재 / 무효 명중 반사 낙하 연장 / 최종 착지 (2.6.2항)

### 3.5 Slew Rate Limiter

RoadRunner / Pedro Pathing 오도메트리 제원(최고 속도, 가속도 등)을 기준으로 목표 속도까지 선형으로 가감속한다.

### 3.6 입력 계층과 실시간 루프

엔진 바깥의 순수 TS 계층이 장치 입력을 틱마다 `RobotDriveInput`으로 만들어 엔진에 넣는다. 엔진 입력 인터페이스는 `step(r1Input, r2Input)`과 `inputProvider`다.

#### 모듈 구성 (`src/input/`)

- `inputConfig.ts`: 키 매핑 / 데드존 / 임계값 / 장치 배정 / 루프 상수를 한곳에 모은 설정 파일 (값만 바꿔 조정). 매핑 편집 화면은 없다 (업데이트 예정, 5.2항).
- 순수 변환(축 처리, 행동 요청 결정, 탭 래치, 양자화), 입력 로그 / 입력 출처(`inputLog.ts`), 실시간 루프(`realtimeLoop.ts`, `liveControls.ts`): DOM 비의존. 시계 / 스케줄러 / 원시 입력을 주입받아 Node(Vitest)에서 가짜 시간으로 테스트한다.
- 브라우저 어댑터(`browserInput.ts`): Gamepad 폴링, 키보드 이벤트, `requestAnimationFrame`, 포커스 / 가시성 이벤트를 연결만 하는 얇은 층.
    - `BrowserInputAdapter`(브라우저 환경 객체 주입 가능, `attach(onPause)` / `detach`): 루프의 `poll()`에서 배정 슬롯 게임패드를 폴링하고 눌린 키를 다시 샘플한다. `gamepadStatus()`는 슬롯별 연결 / 표준 매핑 여부를 준다 (연결 표시용).
    - `createAnimationFrameScheduler`, `createBrowserRealtimeLoop(engine, inputs, hooks)` → `{loop, adapter, dispose}`.
    - 포커스를 잃거나 탭이 숨겨지면 눌린 키 집합을 비운 뒤 일시정지를 요청한다 (키를 뗀 이벤트 유실 대비). 사용자 일시정지 / 재개에서는 키 집합을 유지해, 누르고 있는 키가 다음 폴링에서 복원된다.

#### 키 매핑

`inputConfig.ts` 기본값, W3C Gamepad 표준 배열(`mapping === 'standard'`) 기준, 인덱스는 0부터.

| 기능 | 게임패드 | 키보드 (`KeyboardEvent.code`) | 입력 방식 |
|---|---|---|---|
| 전후 평행이동 | 좌스틱 Y `axes[1]` (위 = −1이므로 부호 반전) | `KeyW` 전진 / `KeyS` 후진 | 아날로그 / ±1 |
| 좌우 평행이동 | 좌스틱 X `axes[0]` (오른쪽 = +) | `KeyD` 오른쪽 / `KeyA` 왼쪽 | 아날로그 / ±1 |
| 회전 | 우스틱 X `axes[2]` (오른쪽 = + = 시계 방향 = 헤딩 증가) | `ArrowRight` + / `ArrowLeft` − | 아날로그 / ±1 |
| (미사용) | 우스틱 Y `axes[3]` | — | — |
| `INTAKING` | LT `buttons[6]` (`value ≥ 0.5`) | `KeyM` | 누르는 동안 유지 |
| `SHOOTING` | RT `buttons[7]` (`value ≥ 0.5`) | `Comma` | 누르는 동안 유지 |
| 리프트 올림 / 내림 (`FLOWER_SETUP`) | A `buttons[0]` | `Period` | 누를 때마다 토글 |
| `FLOWER_DROPPING` | B `buttons[1]` | `Slash` | 누르는 동안 유지 |

- 키보드는 물리 키 위치(`event.code`)로 읽어 한 / 영 상태나 자판 배열과 무관하게 동작한다. 매핑된 키는 `preventDefault`(방향키 스크롤, Firefox `/` 빠른 찾기 방지)하고, 입력 폼(`input` / `textarea` / `select` / `contenteditable`)에 포커스가 있으면 무시하며, 자동 반복(`event.repeat`)은 눌림 에지로 세지 않는다.
- 트리거 임계값 `TRIGGER_THRESHOLD = 0.5`, 나머지 버튼은 `pressed`. 비표준 매핑 패드도 같은 인덱스를 쓰고 연결 표시에서 경고한다.

#### 장치 → 로봇 배정 (`inputConfig.ts` 고정값)

- 게임패드 슬롯 0 → R1, 게임패드 슬롯 1 → R2, 키보드 → R2.
- 게임패드 슬롯 = `navigator.getGamepads()` 배열 인덱스 (연결 순서). 브라우저 정책상 페이지에서 버튼을 한 번 눌러야 보인다.
- 키보드 주행은 SETTINGS 탭 토글(기본 켬, 기본값 상수 `KEYBOARD_ENABLED`)로 끌 수 있다. 끄면 주행 키만 무시하고, 일시정지 / 스크러빙 단축키(Space, ← / →, Shift + ← / →)는 상태별로 키를 나눠 쓰므로 항상 동작한다 (3.8항).
- 한 로봇에 장치가 여럿 배정되면(R2 = 패드 1 + 키보드) 합친다: 축은 채널별로 절댓값이 큰 값, 유지형 버튼은 OR, 토글 눌림 에지는 OR.

#### 축 처리 (틱마다, 최신 샘플 사용)

- 좌스틱 원형 데드존 `DEADZONE_LEFT = 0.08`: 크기 m < 0.08이면 0, 아니면 크기를 (min(m, 1) − 0.08) / (1 − 0.08)로 다시 맞춘다 (방향 유지, 크기 ≤ 1). 우스틱 X 데드존 `DEADZONE_RIGHT_X = 0.08` (같은 방식).
- 키보드: 전진 f = W − S, 오른쪽 s = D − A, 동시 입력이면 크기 1로 정규화(대각선 0.707), 회전 r = Right − Left. 느린 이동 키는 없다.
- 드라이버 기준 전진 f(스틱 위 = +), 오른쪽 s → 필드 좌표 정규화 속도 (ux, uy):
    - **필드 기준 `FIELD` (기본):** 드라이버는 우리 벽에서 필드 안쪽을 본다 — RED는 x = 0 벽에서 +x 방향, BLUE는 x = 144 벽에서 −x 방향. RED: ux = f, uy = s / BLUE: ux = −f, uy = −s (캔버스 y-down에서 +x를 보는 드라이버의 오른쪽이 +y).
    - **로봇 기준 `ROBOT`:** 직전 틱 상태의 헤딩 h 기준. ux = f·cos h − s·sin h, uy = f·sin h + s·cos h (앞 = (cos h, sin h), 오른쪽 = (−sin h, cos h)).
    - 조작 모드(`DriveMode = 'FIELD' | 'ROBOT'`)는 로봇별 드라이버 설정이다 (로봇 제원이나 시나리오가 아님). 로그에는 변환이 끝난 필드 좌표 값을 기록하므로 모드는 재생에 영향이 없다.
- 회전: 정규화 각속도 uω = r (두 모드 공통, + = 오른쪽 회전).

#### 행동 요청 결정 (틱마다, 로봇별 `ActionRequest` 1개)

직전 틱의 로봇 `actionState`와 이번 틱 버튼(탭 래치 적용)으로 정한다. 리프트 토글 값은 입력 계층에 따로 저장하지 않고 **매 틱 엔진 상태에서 유도**하므로, 엔진이 요청을 거부하면 토글도 자동으로 그 상태를 따른다 (어긋날 수 없음).

- 리프트 의도 기본값 = 직전 상태가 `FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING`이면 켜짐, 그 외 꺼짐.
- A 눌림 에지: 직전 상태가 `IDLE` / `INTAKING`이면 켜짐(올림 요청), `FLOWER_SETUP` / `FLOWER_READY`면 꺼짐(내림 요청), `SHOOTING` / `FLOWER_DROPPING` / `FLOWER_LOWERING`이면 무효 (투입 중에는 내릴 수 없음).
- **직전 상태가 리프트 상태(`FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING`)일 때:** RT / LT는 반영하지 않는다. 의도 켜짐 → B면 `FLOWER_DROPPING`, 아니면 `FLOWER_SETUP` / 의도 꺼짐 → `IDLE`(내림 요청).
- **그 외 상태:** 우선순위 **`SHOOTING`(RT) > `FLOWER_DROPPING`(B) > `FLOWER_SETUP`(A 켜짐) > `INTAKING`(LT) > `IDLE`**. 리프트가 올라가 있지 않으면 B는 무효이므로 실제 선택은 RT → A → LT 순. 같은 틱에 RT와 A가 함께 들어오면 `SHOOTING`이 선택되고 A는 버려진다.
- 우선순위 근거: 계속 쥐고 있는 LT를 가장 낮게 두어 흡입 중에도 RT / A가 먹히게 하고(발사 뒤 LT를 쥐고 있으면 다시 흡입), 리프트 상태에서는 B가 A 토글보다 앞서야 투입할 수 있다. 엔진은 틱당 요청 1개만 받으므로 위 요청이 거부되면 아래 요청도 그 틱에는 수행되지 않는다 (예: 빈 적재함에서 LT + RT → RT를 쥐는 동안 흡입 정지).
- `ActionRequest = 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_DROPPING'` (`FLOWER_READY` / `FLOWER_LOWERING`은 엔진 상태이며 요청 값이 아니다).

#### 짧은 탭 래치

게임패드는 `requestAnimationFrame`마다 폴링하고 키보드는 이벤트로 받아 원시 입력 누적기에 모은다. 틱을 소비할 때:

- 유지형 버튼(LT / RT / B, 키보드 `M` / `,` / `/`): 눌림 = 현재 눌림 OR 직전 틱 소비 뒤 눌림 에지 1회 이상. 20 ms 안에 눌렀다 뗀 입력도 최소 1틱 요청으로 반영된다 (RT 탭 = 1발, B 탭 = 1개 투입 — 해당 동작은 시작 후 끝까지 진행되므로).
- 토글(A, 키보드 `.`): 직전 틱 소비 뒤 눌림 에지가 1회 이상이면 토글 1회.
- 한 화면 프레임에서 여러 틱을 소비하면 누적 에지는 첫 틱에만 적용하고 이후 틱은 현재 레벨을 쓴다. 축은 소비 시점의 최신 샘플.
- 게임패드는 폴링 간격(약 16.7 ms)보다 짧은 탭을 API 한계로 놓칠 수 있다.

#### 양자화 (입력 수신 시점, 8비트)

- 로봇별 틱당 4바이트: `[qx, qy, qω]` int8 ∈ [−127, 127] + `[action]` (0 `IDLE`, 1 `INTAKING`, 2 `SHOOTING`, 3 `FLOWER_SETUP`, 4 `FLOWER_DROPPING`).
- q = sign(u) · floor(|u| · 127 + 0.5), [−127, 127]로 제한 (u = 축 처리 결과 ux / uy / uω, 부호 대칭 반올림).
- 엔진 입력 = 복호화 값: `targetVx = qx / 127 × maxSpeed`, `targetVy = qy / 127 × maxSpeed`, `targetOmega = qω / 127 × maxTurnRate`. **실시간 입력도 부호화 → 복호화를 거쳐 엔진에 들어가므로** 기록 재생 결과가 비트 단위로 같다.
- 근거: 재현성은 해상도와 무관하고(엔진이 쓴 값 = 기록 값) 해상도는 조작감만 좌우한다. 1단계 = maxSpeed 60 in/s 기준 0.47 in/s(정지 임계 0.5 in/s 미만), 회전 4 rad/s 기준 0.03 rad/s, 풀스틱 방향 분해능 약 0.45°. 일반 패드는 원본이 8비트인 경우가 많고, 16비트 패드도 1% 이하는 잡음 / 데드존(8%) 범위다. int16은 크기 2배에 체감 이득이 없다.
- 크기 / 메모리: 로봇 2대 × 6000틱 × 4 B = 48 KB (저장 시 연속 중복 압축, 3.9항). 로봇별 `Int8Array(6000 × 4)` = 24 KB를 미리 할당한다. 풀매치 타임라인은 힙 약 46 MB라 입력 기록은 그 0.1% 수준이다 — 메모리 관리의 초점은 타임라인이다 (3.9항).

#### 입력 로그, 로봇별 입력 출처, 녹화 덧입히기

- **녹화 로그:** 로봇별 채널 `{ data: Int8Array(6000 × 4), length }` (`InputLogChannel`). 인덱스 t = 틱 t → t + 1 스텝에 쓰인 입력 (`DriveInputProvider`의 tick 규약과 같음). 틱 t에 쓰면 t 이후 기록은 버리고, 기록 끝보다 뒤에 쓰면 사이 틱은 중립(0, 0, 0, `IDLE`)으로 채운다 (예: 1회차에 `NONE`이던 로봇을 중간 틱부터 `LIVE`로 기록).
- **로봇별 입력 출처** `InputSource = 'LIVE' | 'REPLAY' | 'NONE'`:
    - `LIVE`: 장치 입력 → 축 처리 / 요청 결정 → 부호화 → 로그 t에 기록 → 복호화 → 엔진.
    - `REPLAY`: 로그 t 복호화 → 엔진. 기록 길이를 넘은 틱은 `NONE`과 같다.
    - `NONE`: 0 입력 + `IDLE` (기록하지 않음).
- **녹화 덧입히기:** 1회차 R1 `LIVE` / R2 `NONE`으로 R1 입력을 기록 → 원하는 틱으로 되감기 → 2회차 R1 `REPLAY` / R2 `LIVE`로, 한 사람이 두 로봇을 따로 조종한 경기를 만든다.
    - 되감은 틱 k에서 이어 가면(분기) 새 가지에서는 k 이후 프레임을 버리고, `LIVE` 로봇의 녹화 로그도 k 이후를 버린 뒤 이어서 기록한다. `REPLAY` 로봇의 로그는 유지한다. 원래 가지는 그대로 남는다 (3.9항 분기 트리).
    - `REPLAY`는 위치가 아니라 **조작 명령**을 재생한다. 2회차에 다른 로봇과 부딪히거나 기물을 먼저 가져가면 1회차와 궤적 / 결과가 달라질 수 있으며, 이는 결정론을 지킨 정상 동작이다. 리프트 요청도 기록된 요청을 그대로 보내고 수락 여부는 엔진이 다시 판정한다.
- **즉시 재계산:** 두 로봇이 모두 `REPLAY` / `NONE`이면 실시간 루프 없이 `inputProvider` + `runFullMatch()`로 바로 계산할 수 있다. 입력 허브 `MatchInputs`(로봇별 로그 / 출처 / 조작 모드)의 `createReplayProvider()`는 만든 시점의 출처를 복사해 고정하고, `LIVE` 로봇도 기록된 로그를 읽기 전용으로 재생하며(방금 진행한 경기를 바로 재계산), `NONE`은 로그가 있어도 중립 입력이다. 실시간 진행은 `MatchInputs.step(engine, liveControls)`(틱 결정 → 기록 → 복호화 → `engine.step`).
- 기록은 같은 로봇 설정 / 시나리오 / 시드 / 탄도 설정 / 엔진 버전을 전제로 한다 (저장 레시피, 3.9항).
- **적용 입력 기록:** 녹화 로그와 별개로, 틱마다 엔진에 실제로 들어간 입력(`NONE`의 중립 포함)을 로봇별로 기록한다(`MatchInputs.applied`). 경기 저장 / 재현은 이 기록만 쓴다. 녹화 덧입히기 중 `REPLAY` → `NONE` 전환처럼 녹화 로그만으로는 재현되지 않는 경우가 있기 때문이다 (3.9항).

#### 실시간 루프 (`requestAnimationFrame` + 20 ms 고정 스텝 누산기)

- 화면 프레임마다 누산 시간 += 경과 시간, 20 ms마다 1틱 소비 (입력 결정 → `engine.step`).
- **따라잡기 상한 `MAX_CATCHUP_TICKS = 5`:** 한 프레임에 최대 5틱(100 ms)만 소비하고, 그러고도 1틱 이상 밀려 있으면 밀린 누산 시간을 버린다 (1틱 미만 나머지는 다음 프레임으로 넘김). 순간 끊김 때 게임 시간이 잠깐 느려질 뿐, 입력이 틱별로 기록되므로 결정론은 유지된다.
- **구성:** `RealtimeLoop(engine, inputs: MatchInputs, controls: LiveControlSource, scheduler: FrameScheduler, hooks)`. 프레임 스케줄러(`request` / `cancel`, 브라우저는 `requestAnimationFrame`)를 주입받아 가짜 시간으로 테스트한다. 상태 `READY` → `RUNNING` ⇄ `PAUSED` → `ENDED`, 일시정지 사유 `USER` / `HIDDEN` / `BLUR` / `GAMEPAD_DISCONNECTED`, 훅 `onFrame(소비 틱 수)`(렌더링 연결) / `onStateChange`.
    - 루프가 `requestAnimationFrame`을 단독으로 소유하고, 프레임 시작 때 입력 공급의 `poll()`(게임패드 폴링 / 키 상태 재샘플)을 한 번 부른 뒤 틱을 소비한다 (폴링과 틱 소비의 순서 보장).
    - 입력 수집기 `LiveControlCollector`: 배정 장치별 탭 래치(`sampleGamepad(slot, pad | null)` / `sampleKeyboard(codes)`), 틱마다 로봇별 합성(`consumeTick`), `reset`. 배정되지 않은 게임패드 슬롯은 무시하고, 연결 해제(`null`)는 중립.
- **자동 일시정지:** 탭 숨김(`visibilitychange` → hidden), 창 포커스 소실(`blur`), 경기 중 배정된 게임패드 연결 해제(`gamepaddisconnected`). 탭이 숨겨지면 브라우저가 `requestAnimationFrame`을 멈추고 입력도 전달하지 않으므로(키를 뗀 이벤트 유실 → 키가 눌린 채 남음), 그대로 두면 돌아왔을 때 마지막 입력이 유지된 채 밀린 시간이 한꺼번에 계산된다.
- **일시정지:** 루프 정지, 누산 시간 0, 원시 입력 누적기(키 상태 / 탭 래치 에지) 초기화. 엔진은 마지막으로 끝낸 틱에 멈춰 있다.
- **재개:** 사용자의 명시적 조작(스크러버 줄 `RESUME` / `BRANCH` 버튼, Space — 3.8항)으로만 재개한다. 멈춘 틱(일시정지 중 되감았으면 그 틱)에서 이어 가며 첫 프레임은 경과 시간 0으로 시작한다. 시작 / 재개 때도 입력 누적기를 비워 일시정지 중 누른 탭은 발동하지 않고, 누르고 있는 입력은 다음 폴링에서 다시 샘플되어 이어진다.
- 경기 종료(6000틱)에 루프가 자동으로 멈춘다. 종료 뒤에도 엔진을 종료 전 틱으로 되감았으면(분기) `resume()`으로 그 틱부터 다시 진행한다. 엔진이 6000틱이면 무시한다.
- **새로고침 / 탭 닫힘 / 크래시 등으로 페이지 상태가 사라지면 그 경기는 사라진다** (v1은 자동 저장 / 복구 없음, 5.2항).

### 3.7 렌더러

#### 원칙과 모듈

- `src/renderer/`는 React 비의존 순수 TS다. 좌표 계산(보기 변환, 비행 / 낙하 보간, 게이지 배치, 가득 참 판정, 적재물 배치, 히트맵 색)은 DOM 없는 순수 함수로 분리해 Vitest로 테스트하고, 그리기 함수는 `CanvasRenderingContext2D`만 쓴다.
- **렌더러 입력 = 장면 1개:** `{ frame: DeepReadonly<TimelineFrame>, r1Config, r2Config, view, options }`. `RobotState`에는 로봇 크기 / 인테이크 구역이 없으므로 제원(`RobotConfig`)을 따로 받는다. 렌더러는 프레임을 읽기만 하고 엔진이나 판정 함수를 호출하지 않는다.
- 그림은 (프레임, 제원, 보기, 옵션)만의 함수다 → 스크러빙 / 재생 / 분기에서 같은 틱은 같은 그림. 벽시계 시간을 쓰는 것은 보기 전환 애니메이션뿐이다.
- **캔버스 글자:** HIVE 셀 알약(`▲ N{n} P{p}/{임계}`), 로봇 번호, 행동 배지뿐이다. 구조물 이름표(GARDEN / HIVE / FLOWER n / LOADING ZONE)는 그리지 않는다 (사용자가 필드 구성을 알고 있음). 캔버스에는 한국어를 그리지 않으며, 언어에 따라 바뀌는 글자는 모두 HTML(문구 사전)로 그린다.
- 주요 파일: `sceneRenderer.ts`(경기 장면), `editSceneRenderer.ts`(필드 편집 모드 장면, 3.8항), `canvasRenderer.ts`(필드 바탕 / 색 `ALLIANCE_COLORS`), `viewTransform.ts`(보기 변환), `robotLayout.ts`(로봇 몸체 안 배치 / 배지), `gaugeLayout.ts`(게이지), `flightView.ts`(비행 공), `renderOptions.ts`(표시 옵션 / 명중 확률), `heatmapView.ts`(히트맵 색 / 픽셀), `spawnEditLayout.ts`(시작 자세 편집 기하), `fonts.ts`(글꼴).

#### 캔버스 레이아웃 (논리 좌표, 1 in = 5 px)

- **캔버스 = 필드 뷰포트:** 필드 144 in + 사방 여백 8 in = 160 in 정사각형(논리 800 × 800 px, `SCENE_WIDTH_PX = SCENE_HEIGHT_PX = VIEWPORT_PX = 800`, 중심 `(400, 400)`). 여백에는 FLOWER 게이지 / NECTAR 재고 게이지가 들어간다. 보기 회전은 필드 중심 (72, 72) 기준으로 이 뷰포트 안에서만 적용한다.
- 화면에서는 CSS로 가용 영역에 맞춰 비율을 유지하며 확대 / 축소하고, 내부 버퍼는 `devicePixelRatio`만큼 키운다 (3.8항 필드 크기).
- **좌표 변환:** 필드 inch ↔ 논리 px ↔ 화면(CSS) px 양방향. 역변환(`cssToCanvas` → `canvasToField`)은 필드 편집 모드의 클릭 / 끌기에 쓴다.

#### 보기 방향 (`AUDIENCE` / `DRIVER`)

- `AUDIENCE`: 좌표 그대로 (y = 144 관중석이 화면 아래). **경기 시작 전 화면**(설정, 필드 편집 모드, 점진 히트맵)은 항상 이 시점이다.
- `DRIVER`: 선택 진영 드라이버 시점, 우리 벽이 화면 아래. RED는 필드 중심 기준 −90°(화면 반시계, 필드 +x → 화면 위, +y → 화면 오른쪽), BLUE는 +90°(필드 −x → 화면 위, −y → 화면 오른쪽). 회전만 쓰고 뒤집지 않으므로 `FIELD` 조작(3.6항)에서 스틱 위 = 화면 위, 스틱 오른쪽 = 화면 오른쪽이 된다.
- 경기 시작 시 보기는 SETTINGS 탭의 기본 보기 방향(기본 `DRIVER`)이고, 경기 중에는 스크러버 줄 `VIEW`로 언제든 바꿀 수 있다 (3.8항).
- **전환 애니메이션:** 경기 시작 시 `AUDIENCE` → `DRIVER`를 700 ms easeInOutCubic으로 회전한다. 회전 각 θ 동안 돌린 정사각형이 뷰포트를 벗어나지 않도록 배율 1 / (|cos θ| + |sin θ|)로 줄인다 (45°에서 약 0.71). 실시간 루프는 **애니메이션이 끝난 뒤** 시작한다 (회전 중 조종 방지). 기본 보기가 `AUDIENCE`여도 같은 700 ms를 기다린 뒤 시작한다. 경기 전 화면으로 돌아가면(`NEW`) 반대로 회전한다. 일시정지 / 재개 / 스크러빙은 보기를 바꾸지 않는다. 애니메이션은 화면 연출일 뿐 엔진 / 기록과 무관하다.
- 글자, 배지, 시계 방향 윤곽 애니메이션의 시작점(12시), 비행 공 높이 오프셋은 보기 회전을 상쇄해 항상 **화면 기준**으로 그린다 (글자는 똑바로, 높이는 화면 위쪽).

#### 그리기 순서, 캐시, 갱신

1. 정적 레이어(배경, 타일, 벽, GARDEN / LOADING ZONE / HIVE 프레임 · 셀 바탕 / FLOWER 원통, 게이지 틀): 필드 좌표로 오프스크린 캔버스(진영 × `devicePixelRatio`별, 개수 상한 있음)에 한 번 그려 두고 매 프레임 보기 변환으로 복사한다. 글자는 캐시에 넣지 않는다 (회전 시 똑바로 그리기 위해).
2. HIVE 셀 상태, FLOWER / 재고 게이지 내용
3. 바닥 기물(`ON_FIELD`, `IN_GARDEN`), 경기 종료 강조(필드 쪽)
4. 로봇 (조준선 옵션, 인테이크 구역, 몸체, 헤딩 화살표, 적재물), 주차 강조, 흡입 진행 옵션
5. HIVE 시차 낙하 중인 기물, 비행 공 (그림자 → 공)
6. 화면 공간: HIVE 셀 내용 / 알약, 로봇 번호, 행동 배지

- **갱신:** 루프 `RUNNING` 중에는 `onFrame`마다 최신 틱 프레임을 그린다. 그 밖에는(일시정지 / 스크러빙 / 재생 / 옵션 변경) 요청을 `requestAnimationFrame` 1회로 모아 그리고, 보기 애니메이션 중에는 끝날 때까지 매 프레임 그린다. 웹폰트가 늦게 도착하면 한 번 다시 그린다.
- **프레임 간 보간 없음:** 최신 틱 프레임만 그린다. 주사율이 50의 배수가 아니면(60 / 144 Hz) 같은 틱이 불규칙하게 두 번 보이는 미세한 끊김이 있을 수 있다 (보간은 업데이트 예정, 5.2항).

#### 색과 정적 구조 스타일

- 필드 바닥은 밝은 회색 타일, 필드 둘레(게이지 여백)는 어두운 배경이다 (3.8항 테마).
- **진영 색 (`ALLIANCE_COLORS`, 공식 RGB에서 계산):** 기본(로봇 몸체 / 우리 NECTAR / 상향 셀) RED `#DF001B` · BLUE `#0F53A7`, 15% 어둡게(테두리 / 글자) `#BE0017` · `#0D478E`, 흰색과 7 : 3(하향 셀) `#F5B3BB` · `#B7CBE5`, 25% 투명(GARDEN / LOADING ZONE 바탕).
- FLOWER는 중립이라 분홍 바탕 + 중립 테두리. POLLEN 노랑, HIVE 틀 회색, 인테이크 초록, 강조 주황.
- **상대 진영 전용 구조물**(상대 HIVE 셀 2개, 상대 LOADING ZONE, 상대 GARDEN, 상대 NECTAR 재고 틀)은 2 v 0에서 쓰이지 않으므로 진영별 비활성 색으로 그린다: 바탕 = 진영 색 8% 투명, HIVE 셀 = 진영 색 12% + 밝은 회색(222), 테두리 = 진영 색 35% + 회색(170). 진영은 알아보되 한눈에 비활성으로 보인다. 상대 HIVE 셀에는 개수 / 임계 글자를 그리지 않는다. (상대 GARDEN 안의 POLLEN은 실제 기물이므로 기물은 정상 색.)

#### 로봇

- **몸체 OBB:** 진영 색 채움(윤곽선 2.25 px), 앞쪽 변을 굵게 + 헤딩 화살표, 번호 "1" / "2" (화면 공간, 똑바로).
- **인테이크 구역**(`getBumperZoneOBB`): 평소 옅은 반투명, `INTAKING` 상태에서 진하게.
- **몸체 안 배치 (`robotLayout.ts`):** 앞에서부터 헤딩 화살표(0.45L ~ 0.32L) → 적재물 받침(0.29L ~ −0.21L, 4칸, 원 반지름 = min(1.2 in, 칸 간격 × 0.42)) → 번호(−0.34L). 모두 몸체 길이 L의 비율이라 로봇 크기와 무관하게 겹치지 않는다.
    - 적재물은 FIFO 순서대로 원 최대 4개(종류별 색, 크기 통일, 로봇 앞쪽부터 0번, 차체와 함께 회전). 0번(다음에 나갈 기물)은 굵은 진한 테두리로 강조한다.
    - 받침은 밝은 반투명 바탕이라 몸체와 같은 진영색인 NECTAR도 구분되고, 적재 한도(`min(maxControlledPieces, 4)`)만큼 빈 칸 윤곽을 그려 남은 공간을 보여 준다.
- **행동 상태 배지:** `INTAKING` / `SHOOTING` / `FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING` / `FLOWER_LOWERING`에서 그린다 (`IDLE`은 없음).
    - 위치 (`badgeCenter`): 로봇 중심과 같은 화면 x, 화면에서 돌린 몸체의 가장 위 꼭짓점 바로 위(2 px). 회전과 무관하게 몸체와 겹치지 않으면서 가장 가깝다.
    - 불투명도 (`BADGE_OPACITY`): 평소 60%, 제동 중(`isBraking`, "정지 대기 — 타이머 미차감")은 30%. 흰 원판이 뒤의 기물 / 로봇을 가리지 않으면서 약 21 px(1366 화면)에서도 식별되는 값이다.
- **배지 이미지 (`src/assets/badges/{key}.svg`):** key = `intaking`, `shooting`, `lift-up`(`FLOWER_SETUP`), `lift-ready`(`FLOWER_READY`), `lift-drop`(`FLOWER_DROPPING`), `lift-down`(`FLOWER_LOWERING`). 표시 크기 6 in(30 논리 px) 정사각형.
    - 공통 틀: `viewBox 0 0 24 24`, `width = height = 256`, 흰 원판(r 11) + 짙은 테두리 `#111827` 1.6 (밝은 필드와 어두운 여백 모두에서 보임). 그림 선 `#111827` 굵기 2~2.4, 둥근 끝.
    - 강조색은 보라 `#7C3AED` 하나 (필드에서 뜻이 있는 진영 빨강 / 파랑, POLLEN 노랑, 인테이크 초록, 강조 주황, FLOWER 분홍과 겹치지 않음). 기물 / 리프트처럼 움직이는 부분에 칠한다.
    - 모양: `intaking` 양쪽에서 가운데로 모이는 화살표 + 기물 점, `shooting` 왼쪽 아래 → 오른쪽 위 화살표 + 날아가는 기물 + 과녁, `lift-up` ▲ + 아래 막대, `lift-ready` 위 막대 + 일시정지 두 줄, `lift-drop` 기물이 바구니로 떨어짐, `lift-down` 위 막대 + ▼.
    - 이미지로 그리므로 고정 색만 쓴다 (`currentColor` / `<text>` / 외부 참조 금지). 테스트(`robotLayout.test.ts`)가 키마다 자산 1개 + 정사각 viewBox + `width = height` + 고정 색 / 글자 없음을 검사한다.
    - 자산을 불러오지 못하면 영어 글자 배지(둥근 사각형 + `INTAKE`, `SHOOT`, `LIFT ▲` 등)로 대신 그린다.

#### 기물 상태별 표시

| 상태 | 엔진 좌표 | 표시 |
|---|---|---|
| `ON_FIELD` | 실제 위치 | 좌표에 원 (실제 반지름, POLLEN 노랑 / NECTAR 우리 진영 색) |
| `IN_GARDEN` | 실제 위치 | `ON_FIELD`와 같은 원 + 초록 테두리 |
| `IN_HIVE` | 셀 조준점 바닥 투영 (모두 한 점) | 개별로 그리지 않고 HIVE 셀 안의 줄 / 개수로 표시. 시차 낙하 대기열(`pendingDrops`)의 기물은 낙하 연출로 그림 (엔진은 방출 전까지 `IN_HIVE`) |
| `IN_FLOWER` | FLOWER 중심 | FLOWER 게이지로만 |
| `CONTROLLED` | 로봇 중심 | 로봇 적재물로만 |
| `IN_FLIGHT` | 발사구 바닥 투영 | 비행 대기열 보간으로만 |
| `OUT_OF_BOUNDS` | 필드 밖 | NECTAR 재고 게이지로만 (POLLEN은 해당 없음) |

#### HIVE

- **우리 셀:** 셀 바탕 / 테두리는 필드 공간에 그린다 — 상향 셀은 진영색 + 노란 강조 테두리, TIP 진행 중에는 넘어간 셀(= 현재 상향 셀의 반대편)에 주황 점선 테두리.
- **셀 내용은 화면 공간에서 똑바로:** 상향 셀의 화면 경계 상자 안에 위에서부터 NECTAR 줄 / `▲ N{n} P{p}/{임계}` 알약 / POLLEN 줄. 기물 줄을 필드 공간에 두면 드라이버 시점에서 세로줄이 되어 글자와 겹치기 때문이다. NECTAR는 상향 셀 바탕과 같은 진영색이라 흰 윤곽선을 굵게 그린다.
- **상대 셀:** 비활성 스타일, 글자 없음.
- **시차 낙하 연출:** `pendingDrops`의 각 항목에 진행률 u = clamp(`tipProgressTimer` / `settleTime`, 0, 1). 위치 = 넘어간 셀의 립 기준점(Lip_X, Lip_Y, 2.6.1항) → (`targetX`, `targetY`) 선형 보간, 불투명도 = 0.25 + 0.75·u, 윤곽선은 화면 12시에서 시계 방향으로 u × 360°까지 호 (u = 1에서 완전한 원 = 착지). 방출되어 `ON_FIELD`가 되면 일반 표시. 필요한 값이 모두 프레임에 있으므로 스크러빙에서도 같다.

#### FLOWER 게이지 (필드 밖 직사각형, `gaugeLayout.ts`)

- FLOWER 4개는 필드 변을 2 : 1로 내분하는 점에 있고 필드 중심 기준 90° 회전 대칭이다: R(x, y) = (144 − y, x)를 반복하면 (96, 142) → (2, 96) → (48, 2) → (142, 48).
- 기준 게이지(관중석 벽 FLOWER (96, 142)): 필드 바깥 x ∈ [96, 120], y ∈ [144.6, 147.8] (벽과 0.6 in 간격, 두께 3.2 in, 양 끝 둥글게). FLOWER 쪽 끝(x = 96)이 bottom(`slot[0]`)이고, 필드 둘레를 따라 화면 기준 반시계 방향 끝(x = 120)이 top.
- 나머지 3개는 R로 회전 복제: 왼쪽 벽 (2, 96) → x ∈ [−3.8, −0.6], y ∈ [96, 120], bottom y = 96 / 위쪽 벽 (48, 2) → x ∈ [24, 48], y ∈ [−3.8, −0.6], bottom x = 48 / 오른쪽 벽 (142, 48) → x ∈ [144.6, 147.8], y ∈ [24, 48], bottom y = 48.
- **칸:** 길이 24 in를 9칸(칸당 약 2.667 in)으로 나눈다 (9 = 용량 테이블 최대 총 개수). 칸 k = `pieces[k]`. 기물은 종류별 색의 같은 크기 원(지름 2.2 in).
- `slot[0]`이 `null`(NECTAR 잼)이면 칸 0을 검정으로 막는다. 칸 0과 칸 1 사이에 출구 턱 구분선(점선)을 그린다 (칸 0은 득점 제외).
- **가득 참 표시:** POLLEN / NECTAR를 둘 다 더 넣을 수 없으면(엔진 용량 판정 `canFlowerAccept` 재사용, 규칙의 단일 출처 = 엔진) `pieces.length`번 ~ 8번 칸에 X를 그린다. 테이블이 NECTAR 수에 대해 엄격히 감소하므로 이는 "현재 조합이 용량 테이블의 최대 조합"과 같다 (예: {1, 6}은 7칸 + X 2칸, {9, 0}은 X 없음, 잼의 빈 `slot[0]`은 POLLEN 1개로 계산). ENDGAME NECTAR 제한처럼 시점에 따라 달라지는 조건은 반영하지 않는다.
- 게이지 틀(둥근 직사각형, 빈 칸 윤곽 9개, 출구 턱 점선)은 정적 레이어, 칸 내용은 매 프레임 그린다.

#### NECTAR 재고 게이지 (휴먼 플레이어, 룰북 Figure 10-2 ALLIANCE AREA)

- 각 진영 벽 바깥 y = 72 중심. RED: x ∈ [−3.8, −0.6], 칸 5개가 y ∈ [65.33, 78.67] (칸당 약 2.667 in, FLOWER 게이지와 같은 두께 / 간격 / 원 크기). BLUE: 필드 중심 점대칭 x ∈ [144.6, 147.8], 같은 y 범위. 틀은 칸 5개 양 끝에 칸 하나 길이(`STOCK_GAUGE_END_PAD`)만큼 여유를 둔다.
- 칸 채우는 순서: 우리 LOADING ZONE에 가까운 끝부터 (RED는 y가 작은 쪽, BLUE는 y가 큰 쪽). 앞에서부터 `pendingHumanNectar`개 = **투입 대기**(반투명 + 점선 테두리), 이어서 `nectarStock`개 = **재고**(정상 색), 나머지는 빈 칸 (이미 필드로 들어간 수 = 5 − 대기 − 재고).
- 두 값의 차이: `nectarStock`은 휴먼 플레이어가 아직 투입을 정하지 않은 재고이고, `pendingHumanNectar`는 투입이 정해졌지만(TIP / ENDGAME / 오토 TIP) LOADING ZONE 빈 슬롯이 없어(로봇이 막고 있음 등) 기다리는 수다 (2.4항). 예: ENDGAME 진입 때 로봇이 LOADING ZONE에 서 있으면 재고 3 → 0, 대기 3이 되고 자리가 나는 대로 대기가 줄어든다.
- 상대 진영 재고 틀은 비활성 색, 내용 없음.

#### 비행 공 (`pendingShots`, `flightView.ts`)

- 경과 시간 t = (tick − `launchTick`) · dt (발사 후 초). t < `contactTime`이면 명목 구간, 그 뒤는 충돌 후 구간(`segments`)에서 t를 담는 구간.
- **명목 구간:** 진행률 s = clamp(t / `contactTime`, 0, 1). 수평 위치 = (`fromX`, `fromY`) → (`toX`, `toY`) 선형 보간.
- **명목 구간 높이 (명목 포물선 + 선형 보정):** 명목 궤적 `{fromX, fromY, fromZ, heading, v0, pitch}`의 `heightAtDistance`로 z_nom(d)를 구하고, D = from → to 수평 거리일 때 z(s) = z_nom(s·D) + s·(`toZ` − z_nom(D)). s = 0에서 발사구, s = 1에서 `to`(조준점 / HIVE 접촉점 / 벽 접촉점 / 착지점)와 정확히 일치한다 (명중의 탐색 v0 / 고정형 조준 오차로 명목 포물선이 조준점을 비껴가도 끝점이 맞음). 포물선이 정의되지 않는 비정상 궤적은 높이를 발사구 → to 선형으로 한다.
- **충돌 후 구간:** 기록된 구간을 그대로 계산한다 (`flightSegmentPoint`: `BALLISTIC` 중력 포물선, `ROLL` 높이 유지). 구간이 명목 구간 끝 / 서로 / 착지점과 연속이므로 공중 → 바닥 점프가 없다. 충돌 후 구간이 없으면 명목 구간 끝에 멈춘다.
- **높이 연출:** 바닥 위치 (x, y)에 반투명 그림자(기물 반지름), 공은 화면 위쪽으로 0.3·z in 띄운 위치에 반지름 × (1 + z / 100)으로 그린다.
- 결과(`HIT` / `MISS_*`)는 도착 전까지 구분하지 않는다 (같은 색, 표시 옵션 `flightResult`로 구분 가능). 도착 틱 프레임에서는 기물이 이미 결과 상태로 그려진다.
- 비행 대기열의 모든 발사를 그린다 (연속 발사로 여러 발이 동시에 날 수 있음). 함수: `shotElapsed`, `shotPositionAt`, `shotTrail`(틱 간격 표본), `airborneDisplay`.

#### 경기 종료 강조

프레임에 `scoreBreakdown`이 있을 때(6000틱 프레임)만 그린다. **경기 중 예측 표시(LOADING ZONE / GARDEN 걸침 등)는 하지 않는다** (3.2항 실시간 / 확정 분리). 점수 글자는 캔버스에 그리지 않는다 (결과 팝업이 항목별 점수를 보여 줌).

- **GARDEN:** 경기 중 `IN_GARDEN` 기물은 초록 테두리. 종료 프레임에서 득점 인정된 기물은 초록 대신 주황 테두리 (겹쳐 그리지 않음).
- **FLOWER 소유권:** 필드의 FLOWER 원을 분홍 대신 진영 공식 색으로 칠한다.
- **하단 보너스:** 게이지에서 유효 득점 볼륨(`slot[1 .. N]`)의 **가장 아래 NECTAR 하나**에 주황 테두리 (`bottomBonusSlot`). 2 v 0 규칙상 소유권과 하단 보너스는 항상 함께 성립하므로 득점 FLOWER는 두 표시를 모두 받는다.
- **PARK:** 주차 인정 로봇에 몸체보다 사방 1.5 in 큰 주황 외곽선.

#### 표시 옵션 (`RenderOptions`)

사용자에게 공개하는 **공통 환경설정**(로봇별 아님)이며 기본값은 모두 꺼짐이다. SETTINGS 탭에서 경기 전 또는 일시정지 중에만 바꿀 수 있다 (3.8항).

| 옵션 | 표시 |
|---|---|
| `aimGuide` 조준선 | 로봇 아래에 반지름 24 in 부채꼴 — 고정형은 헤딩 ± `aimTolerance`, 터렛형은 `turretRange` — 과 로봇 중심에서 발사 방향(`shotLaunchHeading`, 터렛 범위 밖이면 한계각)으로 조준점 거리만큼 점선. 터렛 범위 해석은 엔진 조준 판정과 같다 (각 끝을 [−π, π]로 정규화하므로 360°는 `[−π, π]`뿐이고 `[0, 2π]`는 폭 0). |
| `intakeProgress` 흡입 진행 | 흡입 대상(`intakeTargetPieceId`) 둘레 + 0.6 in 반지름에 `intakeContactTimer` / 필요 시간 호 (화면 12시부터 시계 방향). 바닥 기물은 필요 시간 `intakeDelay`, FLOWER `slot[0]`이면 FLOWER 원통 둘레에 max(`intakeDelay`, 0.12 s). 필요 시간이 0이면 그리지 않는다. |
| `hitProbability` 명중 확률 | 캔버스가 아니라 좌측 HTML 패널에 로봇별 POLLEN / NECTAR 정수 % (3.8항). 계산 함수 `hitProbabilities`(`renderOptions.ts`)가 경기의 판정 함수를 보는 틱 프레임의 로봇 자세 / 진영 / 상향 셀로 호출한다 (로봇 2 × 기물 2 = 4회, 값은 [0, 1] 제한 / 비유한값 0). 옵션이 꺼져 있으면 호출하지 않는다. 엔진은 발사할 때만 판정 함수를 부르므로 결정론과 무관하고, 비용은 약 0.5 µs/회로 무시할 수 있다. |
| `flightTrail` 비행 잔상 | 발사구부터 현재까지 공 표시 위치(높이 오프셋 포함)를 점선으로. |
| `flightResult` 비행 결과 색 | 비행 중 공 테두리를 결과별로 — `HIT` 초록 / `MISS_HIVE` 주황 / `MISS_FLOOR` 회색. |

#### 테스트

순수 계산 함수는 Vitest로 검사한다 — 보기 변환(RED / BLUE 회전 방향, 역변환 왕복, 애니메이션 배율), 비행 보간(s = 0 발사구, s = 1 도착점, 보정항), 낙하 보간(립 → 착지, 불투명도 / 호 진행), FLOWER 게이지(회전 대칭 좌표, 칸 위치, 가득 참 — 테이블 7조합 + 잼), 재고 게이지 칸 배정, 적재물 / 배지 배치, 히트맵 색 척도 / 픽셀, 시작 자세 편집 기하. 그리기 결과는 저장소 밖 일회성 헤드리스 Chromium 스크린샷으로 확인했고, Playwright는 저장소에 넣지 않았다 (스크린샷 비교는 폰트 / 안티앨리어싱 차이로 불안정, 5.2항).

### 3.8 웹 화면 (GUI)

엔진 / 입력 계층 / 실시간 루프 / 렌더러 / LUT Worker를 한 화면으로 묶는 사용자 화면이다.

#### 기본 원칙

- **대상 환경:** 데스크톱 / 노트북 브라우저 전용. 모바일 최적화는 하지 않는다 (태블릿 가로 화면은 동작하면 좋으나 보장하지 않음).
- **화면 크기:** 최소 1366 × 768(브라우저 창 안쪽 가용 영역 약 1366 × 650 기준으로 설계), 최대 3840 × 2160. UI 치수(글자 / 패널 폭 / 버튼)는 기준 단위 `--u = max(1px, min(100vw / 1366, 100vh / 650))`에 비례해 4K에서도 1366 화면과 같은 비율로 보인다. 최소 크기보다 작으면 더 줄이지 않고 스크롤한다.
- **이름:** 앱 표시 이름과 브라우저 탭 제목은 `FTC TacticSim`.
- **React의 역할:** 컨트롤 UI / 스크러버 / 스코어보드 / 설정 폼만. 엔진 / 실시간 루프 / 렌더러 / LUT Worker는 React 밖의 앱 컨트롤러(`src/app/appController.ts`, `AppController`)가 소유하고, React는 상태 알림(`AppStatus`)을 구독한다. 상태 알림은 진행 중 최대 약 10 Hz이고 단계 / 루프 상태 변화는 즉시 보낸다.
- **언어와 문구 사전 (`src/ui/i18n.ts`):** 기본 영어, SETTINGS 탭에서 한국어로 바꾼다. 모든 화면 문구는 `t(lang, key, params?)`를 거친다 (영어 사전 키 기준, 한국어 사전은 타입으로 모든 키를 강제, 없는 키는 영어 → 키 문자열로 대체, 자리표시자 `{name}`). 엔진 검증 오류 코드(`issue.*`) / LUT 상태(`lut.*`) / 일시정지 사유(`pause.*`)마다 문구를 두고, 화면은 엔진 메시지 대신 코드로 문구를 찾는다. 한국어는 짧은 명사형을 쓴다.
    - **게임 용어는 언어와 무관하게 원어 대문자:** `POLLEN`, `NECTAR`, `HIVE`, `CELL`, `FLOWER`, `GARDEN`, `LOADING ZONE`, `TIP`, `PARK`, `ENDGAME`, `TELEOP`, `SWARM`, `POLLINATOR`, `RP`, `RED`, `BLUE`, `ALLIANCE`.
- **타이머 (`formatMatchTime`):** 10초 초과는 `M:SS`, 10초 이하는 `0:SS.s`. 두 구간 모두 올림이라 표시가 건너뛰지 않는다 (2:00 → 1:59 … 0:11 → 0:10.0 → 0:09.9 … 0:00.1 → 종료 0:00.0). 틱 × 0.02의 부동소수점 오차는 1e-6초로 흡수한다.
- **색과 테마:** 진영 공식 색 RED `#DF001B`, BLUE `#0F53A7` (UI와 렌더러 공통). 주변 UI / 팝업은 어두운 계열 — 배경 `#15171C`, 상자 `#1D2027` + 테두리 `#2C313B`, 보조 글자 `#9CA3AF`, 강조 / `ENDGAME` 주황 `#F59E0B`, 준비 초록 `#22C55E`. 필드 색은 3.7항.
- **글꼴 (`src/renderer/fonts.ts` `FONT_FAMILY`):** `'Apple SD Gothic Neo', 'Pretendard Variable', Pretendard, system-ui, sans-serif`. macOS는 설치된 Apple SD 산돌고딕 Neo, 그 외는 Pretendard(OFL, npm `pretendard`, 쓰는 글자만 나눠 받는 dynamic subset 웹폰트). 굵기는 600 / 700 / 800만 쓴다. HTML과 캔버스(`canvasFont(크기, 굵기)`)가 같은 정의를 쓰고, 웹폰트가 늦게 도착하면(`document.fonts.ready`) 캔버스를 다시 그린다.
- **아이콘:** `lucide-react`(ISC) 선 아이콘, `currentColor`. TIP 옆 HIVE 아이콘만 자체 제작(`HiveIcon.tsx`, 같은 24 × 24 / 선 굵기 2 규격). 역할: `START` Play / `PAUSE` Pause / `RESUME` Gamepad2 / `BRANCH` GitBranch / 가지 목록 GitFork / 1초 이동 Rewind · FastForward / 1틱 이동 ChevronLeft · ChevronRight / 재생 CirclePlay · CirclePause / `VIEW` SwitchCamera / `NEW` RotateCcw / `RESULT` Trophy / 로봇 Bot / 시나리오 Flag(진영색 채움) / 게임패드 Gamepad2 / 펼치기 PanelRightOpen / 도움말 CircleHelp / 준비 CircleCheck / 경고 TriangleAlert / 내보내기 · 불러오기 Download · Upload / 요약 FileText.
- **파비콘 (`public/favicon.svg`):** lucide Gamepad2 선(흰색)을 어두운 둥근 사각형(`#15171C`)에 넣고 두 버튼을 진영 빨강 / 파랑으로 칠함. 밝은 / 어두운 탭 모두에서 16 px로 식별된다.

#### 화면 구성

화면은 **메인 화면 하나**다. 경기 / 일시정지 / 복기가 모두 같은 화면이고, 설정은 우측 config 창, 경기 결과는 팝업, 도움말은 모달이다.

```
┌──────────────┬──────────────────────────────────────────┬──────┐
│  1:57 (타이머) │               [경고 토스트]                  │ R1 ◔ │
├──────────────┤                                          │ R2 ✓ │
│  RED  20     │                                          │  ⚑ ✓ │
│  (진영 점수)    │           필드 뷰포트 (정사각형)              │  🎮 1 │
├──────────────┤                                          │      │
│ HIVE TIP 1/4 │                                          │  ?   │
├──────────────┤                                          │      │
│ R1 #19049    │                                          │      │
│ R2 #24909    │                                          │      │
│ (명중 확률)     │                                          │  ≡   │
├──────────────┴──────────────────────────────────────────┴──────┤
│ [주 버튼][가지] [⏮][◀] ━━━━━━●━━━━━━ [▶][⏭] [▶ 재생] 0.25 0.5 1 2× [VIEW] [NEW] [RESULT] │
└────────────────────────────────────────────────────────────────┘
  좌측 패널 ≈ 260u    필드 = 가용 높이 − 스크러버 줄          접힌 config ≈ 72u (펼침 ≈ 480u, 필드 영역을 밀어냄)
```

- **배치:** CSS 그리드 `좌측 패널 | 필드 | config 띠` + 아래 줄 전체 스크러버 (간격 12u, `layoutCssVars()`가 루트 CSS 변수로 넘김). 1366 × 650에서 필드는 약 558 px, 3840 × 2160에서 약 1900 px. config를 펼쳐도 1366 폭에서는 필드가 줄지 않고(높이 제한), 폭이 부족한 화면(예: 4K)에서는 필드가 줄어든다.
- **필드 크기 (`fieldCanvasSize`):** CSS 크기 = 필드 영역의 짧은 변(내림), 버퍼 = CSS × dpr(반올림), 렌더 배율 = 버퍼 / 800. `ResizeObserver`와 창 `resize`(dpr만 바뀐 경우)마다 `AppController.setRenderScale`을 부르고, 버퍼가 바뀌었으면 다시 그린다.
- **좌측 패널 (HTML, 보는 틱 기준):**
    - 타이머: 경기 전에는 기본색, 경기가 시작된 뒤 남은 60초 이하(`ENDGAME`)면 주황, 남은 10초 이하면 빨강 + 초가 바뀔 때마다 맥박(아래 경기 종료 연출).
    - 진영 점수: 진영 색 바탕 + 15% 어두운 테두리 + 흰 글자, 진영 이름 + 현재 `totalScore`. 경기 중에는 확정 점수(TELEOP TIP × 20)만 오르고 FLOWER / GARDEN / PARK는 종료 때 합산된다 (3.2항).
    - `TIP`: HIVE 아이콘 + `{오토 TIP + TELEOP TIP} / {다음 RP 목표}` (`tipDisplay`). 목표는 4(`POLLINATOR 1`) → 달성 후 7(`POLLINATOR 2`) → 7 달성 후 `n / 7` + 초록 체크. 점수에는 오토 TIP을 넣지 않는다 (2.6.5항).
    - 로봇: 팀 번호가 있으면 `#번호`(크게) + 팀명(작게), 없으면 `R1` / `R2` + 팀명 (`robotLabel`). 표시 옵션 `hitProbability`가 켜져 있으면 그 아래에 로봇별 `POLLEN` / `NECTAR` 명중 확률 정수 % (적재함 0번 종류 줄은 밝게, 다른 줄은 흐리게, 기물 색 점).
    - 주차 여부는 표시하지 않는다 (경기 중에는 확정할 수 없음).
- **필드 영역:** 캔버스(3.7항) 위에 HTML 층을 겹친다 — 경고 토스트, 자동 일시정지 배너, 불러온 경기 불일치 배너(3.9항), 경기 종료 연출, 필드 편집 모드 안내 띠 / 글자.
- **스크러버 줄 (필드 아래):**

    | 요소 | 동작 |
    |---|---|
    | 주 버튼 | 상태에 따라 하나: `START`(경기 전) / 비활성(회전 중, 종료 강조 · 결과 팝업 중) / `PAUSE`(진행 중) / **`RESUME`**(게임패드 아이콘, 일시정지 + 보는 틱 = 머리 + 경기 미종료) / **`BRANCH`**(갈라지는 화살표, 주황, 보는 틱 < 머리) |
    | 가지 | 주 버튼 바로 옆, `GitFork` + 지금 가지 이름(최대 150u 말줄임). 누르면 가지 목록 (3.9항). 경기 전에는 자리만 두고 비활성 |
    | 1초 `⏮` / `⏭`, 1틱 `◀` / `▶` | 보는 틱 이동, 일시정지 / 복기 중에만. 길게 누르면 0.4초 뒤부터 반복 |
    | 타임라인 막대 | 0 ~ 6000틱, 10초 눈금 13개(`ENDGAME` 시작 눈금만 주황), 기록 구간 채움 + 보는 틱 동그라미 + 분기 표식(3.9항). 클릭 / 끌기로 보는 틱 이동 |
    | 재생 `▶` / `⏸` | 기록된 프레임을 배속으로 보기만 함 (기록 불변) |
    | 배속 | 0.25 / 0.5 / 1 / 2× (재생에만 적용, 조종은 항상 1×, 새 경기에서도 유지) |
    | `VIEW` | 드라이버 / 관중석 시점 토글 (경기 중 언제나, 경기 전 비활성, 3.7항 전환 애니메이션) |
    | `NEW` | 같은 설정 · 같은 시드로 새 경기 (확인창 → 관중석으로 회전 → 경기 전). 회전 중 비활성 |
    | `RESULT` | 경기 종료 뒤 결과 팝업 다시 열기 (복기 중만) |

- 버튼은 누른 뒤 포커스를 풀어 Space / Enter가 버튼을 다시 누르지 않게 한다.

#### 앱 상태 흐름

```
SETUP ──START(모두 준비)──▶ ROTATING_IN ──(700 ms)──▶ RUNNING ◀──────RESUME──────┐
  ▲                                                   │                        │
  │                                   PAUSE / Space / 자동 일시정지                │
  │                                                   ▼                        │
  │                                                PAUSED ──(보는 틱 = 머리)──────┘
  │                                                 │  ▲
  │                                          재생 ▶  │  │ 재생 끝 / ⏸
  │                                                 ▼  │
  │                                               PLAYBACK
  │
  │    RUNNING ──(6000틱)──▶ HIGHLIGHT(5초) ──▶ RESULT(팝업) ──REVIEW──▶ REVIEW
  │                          (클릭 / Space로 건너뛰기)          (= 경기 종료 뒤 일시정지, 재생 가능, RESUME 없음)
  │
  └── ROTATING_OUT ◀── NEW(확인창) ── 경기 시작 이후 모든 상태
      (관중석 회전, 같은 설정 · 같은 시드로 0틱 새 엔진)

PAUSED / REVIEW ──BRANCH(보는 틱 < 머리, 확인창)──▶ RUNNING  (새 가지, 기존 기록 보존 — 3.9항)
```

- **보는 틱과 머리를 구분한다.** 보는 틱(`viewTick`)은 화면에 그리는 틱이고, 머리(`headTick`)는 지금 가지의 마지막 기록 틱이다 (진행 중에는 둘 다 엔진 현재 틱). 스크러빙 / 재생 / 틱 이동은 보는 틱만 바꾸고 `engine.getFrame(보는 틱)`을 그리며, 엔진을 건드리지 않는다. 그리기와 좌측 패널 값(타이머 / 점수 / TIP / 명중 확률)은 보는 틱 프레임 기준이다.
- **기록을 바꾸는 동작은 재개와 분기뿐이다.** 재개는 머리에서만 가능하고, 되감은 틱에서 이어 조종하려면 반드시 분기(확인창)를 거친다. 경기 종료 뒤에는 `RESUME`이 없지만, 종료 전 틱으로 되감으면 `BRANCH`로 그 시점부터 다시 조종할 수 있다.
- **재생:** 머리에서 재생을 누르면(경기 종료 뒤 Space 포함) 0틱부터 재생한다. 재생은 머리에서 멈춘다. 재생 중 주 버튼은 보는 틱 기준 `RESUME` / `BRANCH`이며, 누르면 재생을 멈추고 그 동작을 한다. 재생 중에는 창 포커스를 잃어도 계속한다 (자동 일시정지는 조종 중에만).
- **`NEW`:** 진행 중에 누르면 먼저 일시정지하고 확인창을 띄운다 (취소하면 일시정지 상태로 남음). 설정과 시드는 유지되며, 시드는 SCENARIO 탭 `REROLL`로만 바뀐다. 가지 트리도 모두 버린다 (3.9항).
- **경기 종료 (`endStage`):** 루프 `ENDED` → `HIGHLIGHT`(`END_HIGHLIGHT_MS` = 5000, 필드 클릭 / Space로 건너뜀) → `RESULT` → `REVIEW`. 종료 강조 / 결과 팝업 중에는 보는 틱 이동 / 재생 / 재개 / 분기를 할 수 없다. 종료 뒤 분기해서 다시 6000틱에 닿으면 다시 `HIGHLIGHT`부터.
- 입력 출처 / 조작 모드는 경기 전 또는 일시정지 중에만 바꿀 수 있고, 다음 `START` / `RESUME` / `BRANCH`부터 적용된다.
- **컨트롤러 조작 (`AppController`):** `start` / `pause` / `resume` / `branch`, `setViewTick` / `stepView`(기록 구간 [0, 머리]로 제한, 재생 멈춤), `play` / `stopPlayback` / `togglePlayback` / `setPlaybackSpeed`(벽시계 × 배속 × 50틱/초), `reset`(`NEW`), `skipHighlight` / `closeResult` / `openResult`, `setShortcutsEnabled`(확인창 / 팝업 / 도움말 동안 끔), `setSetup`(경기 전에만 설정 교체), `setEditScene`(필드 편집 모드), 입력 설정(`setSourceChoice` / `setDriveMode` / `setKeyboardEnabled` / `setDefaultView`), 가지(`switchBranch` / `deleteBranch` / `renameBranch`), 불러오기(`loadMatch` / `recipeSource`, 3.9항).
- **상태 (`AppStatus`):** 단계, 진영, 보기 / 보기 각도, 루프 상태 / 일시정지 사유 / 자동 일시정지 사유, 보는 틱 · 머리 · 남은 시간, 확정 점수, TELEOP / 오토 TIP, RP, 게임패드 슬롯, 명중 확률(옵션 켜짐일 때만), `matchEnded` / `canScrub` / `canResume` / `canBranch` / `playing` / `playbackSpeed` / `endStage` / `endSeq`, `result`(종료 프레임의 총점 / 득점 내역 / RP / TIP — 보는 틱과 무관), 입력 출처 / 조작 모드 / 키보드(선택 · 적용 중), 가지 목록 / 지금 가지.

#### 확인창, 알림, 타임라인

- **확인창 (`ConfirmDialog.tsx`):** 화면 전체 흐림 + 필드 영역 중앙 상자(결과 팝업 위에서도 열림). 문구 + `취소 Esc` / 동작 이름 버튼(`BRANCH` · `NEW` 등, 주황) `Enter`. 창 `keydown`을 캡처 단계에서 받아 Enter = 확인, Esc = 취소, Space는 막는다. 열린 동안 단축키는 꺼진다. 확인 버튼 하나만 있는 안내창 모드도 있다 (가지 가득 참 안내, Esc도 닫기).
- **경고 토스트 (리프트 중 주행):** 로봇이 리프트 상태(`FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING` / `FLOWER_LOWERING`)인데 그 로봇의 `LIVE` 주행 입력(양자화 · 데드존 뒤 qx, qy, qω)이 0이 아니면 필드 위쪽 중앙에 빨간(`#DC2626`) 알약 + 경고 아이콘 `R2 · LOWER LIFT (A) TO MOVE` / "A로 리프트를 내려야 이동 가능"을 띄운다. 1.5초 뒤 0.3초 동안 흐려지며 사라지고, 같은 로봇은 2초(`LIFT_TOAST_COOLDOWN_MS`, 벽시계)에 한 번만. 리프트 상태 자체는 로봇 행동 배지로 보인다 (3.7항). 이 둘로 "리프트를 내려야 이동 가능"을 안내한다.
- **자동 일시정지 배너:** 창 포커스 소실 / 탭 숨김 / 게임패드 연결 해제로 멈췄을 때만(사용자 일시정지는 배너 없음) 필드 위쪽 중앙에 어두운 띠 + 주황 테두리 + 경고 아이콘, 사유 + "Space / RESUME으로 재개". 재개 · 분기 · 재생 시작 · `NEW`에서 사라지고, 보는 틱 이동은 유지한다.
- **타임라인:** 보는 틱을 움직일 수 있을 때 막대 클릭 / 끌기(포인터 캡처) → 막대 비율 × 6000 반올림(`timelineTickAt`) → 보는 틱 (기록 밖은 머리에 붙음, 재생 멈춤). 끄는 동안 동그라미 위에 경기 시계(`M:SS`)를 표시하고, 마우스를 올리면 동그라미가 1.2배로 커진다.

#### 경기 종료 연출과 결과 팝업

- **흐름:** 6000틱 도달 → 루프 정지 → **5초 동안 필드 경기 종료 강조**(3.7항) → 뒤 흐림 + 결과 팝업. 클릭 / Space로 5초 대기를 건너뛸 수 있다.
- **종료 연출 (소리 없이 화면만, 모두 캔버스 밖 HTML 층):** 종료 순간을 알아채기 쉽게 한다.
    - 마지막 10초: 경기가 시작된 뒤 남은 10초 이하(`FINAL_COUNTDOWN_SEC`)면 타이머가 빨강, 진행 중에는 초가 바뀔 때마다 0.42초 맥박(1.12배 → 1배).
    - 종료 순간 흰빛: 필드 영역에 0.35초.
    - 종료 배너: 종료 강조 5초 동안 필드 위쪽 중앙에 `MATCH COMPLETE` / "경기 종료"(주황, 튀어나오듯 등장) + 5초 동안 줄어드는 진행바 + "클릭 / Space로 결과 바로 보기". 배너는 클릭을 필드로 통과시켜 필드 클릭 건너뛰기가 그대로 동작한다.
    - 점수 집계: 좌측 점수가 종료 직전 점수(TELEOP TIP × 20)에서 최종 점수로 1.5초 카운트업(easeOutCubic, 정수) + 종료 때 더해진 항목 칩(`+4 GARDEN` 등, 0점 제외, FLOWER → GARDEN → PARK, 0.35초 간격).
    - 트리거 `endSeq` = 이 경기에서 실제로 6000틱에 도달한 횟수 (분기 뒤 다시 끝나면 +1, 재생 / 스크러빙으로 종료 틱을 보는 것과 가지 전환은 불변, `NEW`에서 0). 연출은 `HIGHLIGHT` 동안만 그리며 `endSeq`를 key로 새로 마운트해 매번 처음부터 재생한다. `prefers-reduced-motion`이면 움직임 없이 최종 상태만 보여 준다.
- **결과 팝업 (`ResultPopup.tsx`, 폭 460u, 표시 규칙 `src/ui/resultModel.ts`):**
    - 헤더: `FTC TacticSim` / `TELEOP MATCH COMPLETED` / 진영 배지 (+ 가지 이름, 3.9항). 그 아래 두 로봇 칩 — 진영색 `R1` / `R2` + 팀 번호(`#번호`, 있을 때) + 팀명.
    - 총점, 항목별 점수와 한 줄 근거 (`scoreBreakdown`만 읽음, 3.2항):
        - `HIVE` "TELEOP TIP n × 20" (오토 TIP이 있으면 "오토 TIP n회는 RP에만")
        - `FLOWER` 소유한 FLOWER별 "FLOWER k: 기물 × 2 (+ 하단 보너스 5)" (없으면 "소유한 FLOWER 없음")
        - `GARDEN` "POLLEN n × 1"
        - `PARK` "R1 · R2 주차 × 5" (없으면 "주차한 로봇 없음")
    - `RP` 카드 3개: 이름 + 조건과 지금 값 (`SWARM` "PARK 5 / 10", `POLLINATOR 1` "TIP 5 / 4", `POLLINATOR 2` "TIP 5 / 7", TIP은 오토 포함), 달성은 초록 체크.
    - 가지가 2개 이상 끝났으면 `BRANCHES` 비교 줄 (3.9항).
    - 동작: `EXPORT MATCH` / `EXPORT SUMMARY`(3.9항) 줄, 그 아래 `REVIEW`(팝업을 닫고 복기) / `RESTART`(= `NEW`, 확인창).

#### config 창 (우측)

- **접힌 상태 (세로 아이콘 띠, `ConfigRail`):**

    | 아이콘 | 상태 표시 |
    |---|---|
    | R1 / R2 로봇 | 초록 체크 = 준비 완료(탭이 올바름 + 적용 안 된 수정 없음 + 명중 확률표 `READY`) / 주황 진행률 링 = 확률표 생성 중(마우스를 올리면 "생성 중 63% · 약 7초 남음") / 빨간 느낌표 = 틀린 입력 · 검증 실패 · 적용 안 된 수정 · 생성 오류 (마우스를 올리면 사유) |
    | 시나리오 깃발 | 진영색 깃발 + 체크 = 유효 · 적용됨 / 빨간 느낌표 = 무효 또는 적용 안 된 수정 |
    | 게임패드 | 연결된 패드 수, 비표준 매핑 경고. 마우스를 올리면 슬롯별 패드 이름 / 배정 로봇 |
    | `?` 도움말 | 도움말 창 (3.10항), 언제나 |
    | 펼치기 | 열 수 있는 시점에만 활성 |

    - 로봇 / 시나리오 아이콘을 누르면 그 탭으로, 게임패드 아이콘은 SETTINGS 탭으로 펼친다.
- **펼친 상태 (`ConfigPanel`, 약 480u, 필드를 밀어냄, 0.2초 전환):** 위쪽 탭 4개 `R1` / `R2`(로봇 제원) / `SCENARIO` / `SETTINGS` + 닫기, Esc로 닫는다. 문제가 있는 탭에는 빨간 점.
- **초안과 적용:** R1 / R2 / SCENARIO 탭은 편집 중 값(초안)과 적용된 값을 따로 가진다 (`src/ui/configDraft.ts`).
    - 탭 하단 `APPLY`는 초안이 유효하고 적용 값과 다를 때만 활성. 하단에 "적용 안 된 수정" 표시 + `RESET TAB`.
    - 검증에 걸린 입력칸은 빨간 테두리 + 빨간 설명 글자. 적용 안 된 수정이 있으면 아이콘이 빨간 느낌표가 되고 `START`를 막는다 (옛 값으로 조용히 시작하지 않도록).
    - 탭을 옮기거나 창을 닫아도 초안은 남는다.
    - SETTINGS 탭은 바꾸는 즉시 적용된다 (`APPLY` 없음).
- **되돌리기:** `RESET TAB`은 그 탭 초안을 기본 프리셋으로 되돌린다 (시나리오는 지금 시드 유지). SETTINGS 탭의 `RESET ALL`은 확인창 → SETTINGS 값은 즉시 기본값, R1 / R2 / SCENARIO는 초안만 기본값(각 탭 `APPLY` 필요). 경기 전에만.
- **`START` 막기:** 준비가 안 됐으면(`startBlocker`: R1 탭 → R1 확률표 → R2 탭 → R2 확률표 → SCENARIO 순) config 창이 펼쳐지며 첫 문제 탭으로 이동하고 빨간 안내 띠를 보여 준다. 설정은 모두 끝났고 확률표 생성만 남았으면 "R2 확률표 생성 중 63%" 안내만 한다. 입력을 고치기 시작하면 안내를 지운다.
- **열 수 있는 시점 / 편집 범위:**

    | 앱 상태 | config 펼치기 | R1 / R2 / SCENARIO 탭 | SETTINGS 탭 |
    |---|---|---|---|
    | 경기 전 (`SETUP`) | 가능 | 편집 가능 | 전부 편집 가능 |
    | 회전 중 / 진행 중 / 재생 중 / 종료 강조 / 결과 팝업 | **불가** (펼쳐져 있었으면 자동으로 접힘) | — | — |
    | 일시정지 (경기 중 또는 복기) | 가능 | **읽기 전용** (경기가 있는 동안 입력칸을 흐리게 하고 "경기 중 잠금" 안내) | 입력 출처 / 조작 모드 / 키보드 / 표시 옵션 / 언어 / 단위 / 기본 보기 편집 가능, 프리셋 `EXPORT` 가능, `RESET ALL` · `IMPORT` 불가 |

#### 로봇 탭 (R1 / R2)

| 구역 | 항목 |
|---|---|
| 미리보기 | 탭 맨 위, 위에서 본 로봇(앞 = 위, `RobotPreview.tsx`, SVG) — 몸체 + 앞 변 굵은 선 + 앞 화살표, 흡입 구역 초록, 조준 범위 주황 부채꼴(360°면 원), 발사구 흰 점(오프셋 위치), 범례 |
| 팀 | 팀 번호, 팀명 |
| 하드웨어 | 가로 / 세로, 최고 속도, 최고 각속도, 최대 선형 가속도, 최대 각가속도, 최대 적재 수 |
| 인테이크 | 흡입 딜레이, `NECTAR` 흡입 가능 토글, 흡입 구역 편집기 |
| 슈터 | 형식(`FIXED` / `TURRET`), 허용 조준 오차 또는 터렛 왼쪽 / 오른쪽 한계(+ `±90°` / `360°` 프리셋), 발사 딜레이, 발사구 지상고, 발사각, 발사구 오프셋, 접힌 "고급 설정: 발사 편차"(속도 / 방위 / 피치 편차 3칸 + LUT에서만 쓴다는 안내) |
| `FLOWER` 리프트 | 리프트 준비 시간(올림 = 내림), 투입 간격 |
| 스윗스팟 → 명중 확률표 | 기준 CELL 라벨, 스윗스팟 X / Y, 검증 사유(빨간 글자), `SET ON FIELD`(필드 편집 모드), 명중 확률표 상태 상자, `SHOW HIT MAP`(히트맵 모드) |
| 복사 | `COPY TO R2`(R1 탭) / `COPY TO R1`(R2 탭) |

- **프로필 (`src/ui/robotForm.ts`):** 화면의 로봇 값은 `RobotProfile { teamNumber, teamName, config: RobotConfig, ballistics: ProfileBallistics }`다. 팀 번호 / 팀명은 화면 전용이고 `RobotConfig` 타입은 바꾸지 않는다 (`RobotConfig.name`은 엔진용 `R1` / `R2` 그대로, config 탭 이름 / 결과 팝업 / 캔버스 로봇 번호도 `R1` / `R2`). `ProfileBallistics` = 발사구(`dz`) / 발사각 / 오프셋 + 편차 3종 + 스윗스팟(`RED_AUDIENCE` 기준 좌표).
- **입력칸 규칙 (`FormControls.tsx`):** 숫자 칸은 단위를 표시하고 칠 때마다 검사한다. 올바르면 그 칸 값만 엔진 단위로 초안에 반영하고(**고친 칸만 변환** — 표시 반올림으로 다른 칸 값이 바뀌지 않게), 틀리면 친 글자를 보관한 채 빨간 테두리 + 빨간 설명("6.00 – 18.00 in 사이", "정수만 입력", "숫자를 입력"). 틀린 글자가 남아 있는 동안 탭은 `INVALID`이고 적용할 수 없으며, 탭 이동 / 창 닫기에도 남고 `RESET TAB` · 복사 대상에서는 지운다. 초점이 있는 동안은 친 글자 그대로, 초점을 잃거나 Enter면 표시 형식으로 바꾼다. 저장 값이 범위 밖이면(파일로 들어온 값 등) 그 칸도 빨갛게 표시한다(`checkValue`).
- **입력 허용 범위:**

    | 항목 | 범위 |
    |---|---|
    | 가로 / 세로 | 6 ~ 18 in |
    | 최고 속도 / 최대 가속도 | 1 ~ 200 in/s / 1 ~ 2000 in/s² |
    | 최고 각속도 / 최대 각가속도 | 0.1 ~ 30 rad/s / 0.1 ~ 300 rad/s² |
    | 최대 적재 수 | 정수 1 ~ 4 |
    | 흡입 · 발사 딜레이, 리프트 준비 시간, 투입 간격 | 정수 0 ~ 5000 ms |
    | 허용 조준 오차 | 0.1 ~ 45° |
    | 터렛 한계 | −180 ~ 180° (터렛이면 왼쪽 ≠ 오른쪽) |
    | 발사구 지상고 | 1 ~ 50 in (엔진 `dz = 53.5 − 지상고` = 3.5 ~ 52.5, 기본 14 in → 39.5) |
    | 발사각 | 5 ~ 85° (기본 60°) |
    | 발사구 오프셋 | −18 ~ 18 in (+ = 앞, 기본 0) |
    | 속도 편차 / 방위 · 피치 편차 | 0 ~ 20 % (기본 2 %) / 0 ~ 10° (기본 0.02 / 0.006 rad) |
    | 흡입 구역 수 / 위치 / 폭 / 깊이 | 0 ~ 8개 / ± 변 길이 ÷ 2 (앞 · 뒤 = 가로, 좌 · 우 = 세로) / 3.6 ~ 36 in (최소 = NECTAR 직경 — 기물보다 좁은 입구는 흡입 불가) / 0.25 ~ 12 in |
    | 스윗스팟 X / Y | 0 ~ 144 in (1 in 격자 중심으로 맞춤) |
    | 팀 번호 / 팀명 | 비움 또는 숫자 1 ~ 5자리 / 24자까지 |

- **흡입 구역 편집기:** 구역마다 한 줄 — 면 버튼 묶음(앞 / 뒤 / 왼쪽 / 오른쪽) + 위치 / 폭 / 깊이 + 삭제. `구역 추가`(8개면 비활성) = 앞 · 위치 0 · 폭 = 변 길이 · 깊이 1 in. 프리셋 `FRONT` / `ANY`는 현재 로봇 크기로 구역 전체를 바꾼다 (이후 크기를 바꿔도 구역은 따라가지 않으며, 위치가 변 밖이면 오류로 알림). 구역 0개는 허용하되 "흡입 불가" 경고를 띄운다. 면을 바꾸면 그 구역 위치를 새 범위로 다시 검사하고, 추가 / 삭제 / 프리셋은 번호가 밀리므로 구역 칸의 틀린 글자를 모두 지운다.
- **슈터:** 터렛으로 바꿀 때 범위 폭이 0이면 ±90°로 시작한다. 숨는 칸의 틀린 글자는 지운다. 발사구 지상고 / 발사각 / 오프셋은 경기 비행 처리에 바로 쓰이고(`MatchSetup.shooters`), 편차 3종과 스윗스팟은 명중 확률표 생성에만 쓰인다.
- **명중 확률표 상태 상자 (`LutStatus.tsx`, 화면 규칙 `src/ui/lutView.ts`):** 적용한 설정 기준 상태 한 줄("생성 중 63% · 약 7초 남음", "준비 완료 (저장된 결과)") + 진행 막대 + 기물별 발사 속도 · 스윗스팟 명중률(0 %면 경고). 남은 시간은 생성 시작 후 처리 속도로 추정하며 진행 2 % · 0.5초 이후부터 보인다. 오류면 오류 문구 + `RETRY`. 초안의 LUT 입력(탄도 / 스윗스팟 / 로봇 크기, `lutInputsChanged`)이 적용 값과 다르면 "적용하면 새로 만듦".
- **스윗스팟 입력 기준:** 현재 시나리오 진영(SCENARIO 탭 초안)의 공식 시작 상향 셀 — RED → `RED_AUDIENCE`, BLUE → `BLUE_OPPOSITE` — 을 기준으로 찍고, 칸 옆에 기준 셀 라벨(예: "기준: `BLUE_OPPOSITE`")을 보인다. 저장은 항상 `RED_AUDIENCE` 좌표이고 BLUE는 필드 중심 점대칭으로 변환한다 (2.6.2항). 진영을 나중에 바꿔도 LUT는 그대로이고 같은 스윗스팟이 새 진영 기준으로 대칭 이동해 보일 뿐이다. 시나리오에서 상향 셀을 바꿔도 표시 기준 셀은 바뀌지 않는다.
- **검증:** 스윗스팟 칸 범위 + (다른 칸이 모두 올바를 때) `validateBallisticsConfig`의 `SWEET_SPOT_*` 사유는 빨간 오류로 `APPLY`를 막는다. 스윗스팟 명중률 0 %는 경고만 한다 (적용 / 시작 허용).
- **`COPY TO`:** 팀 번호 / 팀명을 뺀 모든 항목(흡입 구역, 탄도, 스윗스팟 포함)을 상대 탭 초안으로 깊은 복사한다. 원본 탭에 틀린 입력이 있으면 불가. 상대 탭에 적용 안 된 수정이 있으면 확인창을 띄우고, 복사 뒤 "R2 초안에 복사함 — R2 탭에서 적용"을 안내한다.
- LUT 시드 / 샘플 수는 고정값(`DEFAULT_BALLISTICS_SEED`, 격자당 2000 / v0 후보당 20000)이며 화면에 보이지 않는다.

#### 명중 확률표 생성 연결

- **생성 시작:** 로봇 탭 `APPLY`에서 LUT 입력이 바뀌었을 때, 그리고 앱 시작 때 자동 보관 / 기본 프리셋 설정으로 (캐시에 있으면 바로 `READY`). 연결 모듈 `src/app/lutTracker.ts`(React 비의존)가 관리자의 잦은 진행 알림을 100 ms로 모으고 단계 변화는 바로 알리며, 로봇별 생성 시작 시각을 보관하고 `retry`를 제공한다. 브라우저 Worker / IndexedDB 캐시는 `MainScreen`이 주입한다.
- **경기 설정:** 두 로봇 결과가 모두 있으면 판정 함수 = `createLUTShotResolver`, 엔진 `shooters`에 기물별 사출 속도(`v0`, 못 찾은 기물은 엔진 기본 계산)를 넣고, 결과가 바뀔 때마다 경기 전 설정을 바꾼다(`setupFromDrafts` → `setSetup`). 결과가 없는 동안은 간이 판정 함수가 자리를 채우지만 `START`가 막혀 있으므로 경기에 쓰이지 않는다.
- **첫 실행 등 확률표가 준비될 때까지 `START`를 막고 기다린다** (간이 판정으로 먼저 시작하지 않음). 생성 오류는 로봇 아이콘 빨간 느낌표 + 로봇 탭 오류 문구와 `RETRY`.
- **측정:** 헤드리스 Chromium, 4코어(Worker 3개), 기본 프리셋에서 첫 실행 약 13 ~ 18초(R1 = R2라 한 번 생성), 새로고침 = 캐시 적중 약 0.3 ~ 0.9초, 한 로봇만 다른 설정으로 적용하면 약 13초. 남은 시간 추정은 가운데 행(명중 띠 근처)이 무거워 중간에 조금 늘었다 줄어든다.

#### 시나리오 탭

| 항목 | 입력 |
|---|---|
| 유효 배지 | 맨 위. 유효 = 초록, 무효 = 빨강 + 문제 수 + 문제 목록(로봇 문제는 "R2 · …") |
| 진영 | `RED` / `BLUE` |
| `HIVE` | 상향 셀(`AUDIENCE` / `OPPOSITE`) + 상향 셀 `POLLEN` / `NECTAR` 개수 조절기 + "NECTAR n개면 CELL이 POLLEN m개에서 TIP" 안내 |
| 로봇 적재물 | 로봇별 칸 = 기물 색 원 + 번호 (FIFO, 0번이 먼저 나감). 칸을 누르면 `POLLEN` → `NECTAR`(흡입 가능 로봇만) → 빈 칸 순환, 빈 칸은 목록에서 빠져 뒤로 모임. 적재 한도를 넘는 칸은 빨간 테두리 |
| 남은 기물 | `FLOWER` 4개 각 `POLLEN` 수, `GARDEN` 우리 / 상대 `POLLEN` 수 (개수 조절기) + 바닥 산포 / 휴먼 플레이어 재고 요약 |
| 오토 TIP | `autoTipCount` 개수 조절기 (0 ~ 5) |
| 시작 자세 | 로봇별 카드: X / Y / 헤딩 숫자 칸 + "ALLIANCE 기본" 표시 + `DEFAULT`(지정 해제), `EDIT ON FIELD`(필드 편집 모드) |
| 난수 시드 | 적용된 시드 표시 + `REROLL` (경기 전에만) |

- **검증:** `validateScenario()`(2.4항) + `validateRobotPlacement()`(아래). 둘 중 하나라도 걸리면 적용할 수 없다. 검증에 걸린 묶음은 빨간 테두리. 개수는 개수 조절기(`Stepper`)라 범위 밖 입력이 없고, 여러 칸이 얽힌 문제만 빨갛게 표시한다.
- **초안 형식 (`src/ui/scenarioForm.ts`):** 초안은 엔진 `ScenarioConfig` 그대로다. 지정하지 않은 항목은 엔진 기본값(진영별 상향 셀 / 기본 시작 자세, 적재 한도만큼 `POLLEN`, `DEFAULT_RNG_SEED`)으로 풀어 보여 주고, 고칠 때만 그 항목을 명시 값으로 쓴다 (기본 시나리오 `{ allianceColor: 'RED' }`와 호환).
- **진영을 바꾸면:** 직접 지정한 시작 자세는 **좌우 대칭**(x → 144 − x, 헤딩 → 180° − 헤딩 — RED R1 기본 (9, 36, 0°) ↔ BLUE R1 기본 (135, 36, 180°)이 정확히 맞음), 지정한 상향 셀은 반대 셀(RED 기본 `AUDIENCE` ↔ BLUE 기본 `OPPOSITE`), 나머지는 새 진영 기본값.
- **시드 `REROLL`:** 초안 / 적용을 거치지 않고 바로 적용한다 (경기 전 설정 교체 → 바닥 산포가 바로 바뀜) + 자동 보관 (새로고침해도 같은 시드). 새 시드는 지금과 다른 부호 없는 32비트 값이다. `RESET TAB`도 시드는 유지한다.
- 바닥에 남은 기물은 자동 계산 + 무작위 산포다 (직접 배치는 v2.0.0 예정, 5.2항).

#### SETTINGS 탭

| 구역 | 항목 | 바꿀 수 있는 때 |
|---|---|---|
| 게임패드 | 슬롯 → 로봇, 패드 이름 / "버튼을 한 번 눌러 연결" 안내, 비표준 매핑 경고 (읽기 전용) | — |
| 입력 | 로봇별 입력 출처, 로봇별 조작 모드(필드 기준 / 로봇 기준), 키보드 주행 켜기 / 끄기, 접는 키보드 조작표 | 경기 전 / 일시정지 |
| 표시 옵션 | 3.7항 5종 토글 (이름 + 한 줄 설명) | 경기 전 / 일시정지 |
| 화면 | 언어(English / 한국어), 길이 단위(in / cm), 기본 보기 방향(`DRIVER` / `AUDIENCE`) | 경기 전 / 일시정지 |
| 프리셋 `PRESETS` | `R1` / `R2` / `SCENARIO` / `ALL` 줄별 `EXPORT` / `IMPORT` + `MATCH` 줄 `IMPORT` (3.9항) | `EXPORT` 언제나 / `IMPORT` 경기 전만 |
| 초기화 | `RESET ALL` | 경기 전만 |

- 바꾸는 즉시 컨트롤러에 반영하고 저장한다. 입력 설정은 "다음 시작 / 재개 / 분기부터 적용"이며, 선택과 적용 중인 값이 다르면 "적용 대기"를 표시한다.
- **입력 출처 선택 (`src/app/inputPlan.ts`):**
    - 경기 전 선택지: `AUTO`(기본, 옆에 "지금: …"으로 예상 결과 표시) / `LIVE` / `NONE`. `START` 순간의 게임패드 상태로 풀어 적용한다.
    - `AUTO` 규칙(`autoSource`): 그 로봇에 배정된 패드 슬롯 중 연결된 것이나 켜진 키보드가 있으면 `LIVE`, 아니면 `NONE`. 즉 R1 = 슬롯 0 패드가 있으면 `LIVE`, R2 = 슬롯 1 패드 **또는 키보드 켜짐**이면 `LIVE` (패드 없이 키보드로 R2를 몰 수 있고, 키보드를 끄면 패드 1개일 때 R2 = `NONE`).
    - 일시정지 중 선택지: `LIVE` / `NONE` / `REPLAY`(그 로봇 녹화 기록이 있을 때만) + 녹화 덧입히기 안내. `REPLAY`인데 기록이 없으면 `NONE`.
    - `RESUME` / `BRANCH` 때 선택 · 조작 모드 · 키보드를 입력 허브 / 어댑터에 적용한다. 분기는 적용 뒤 `LIVE` 로봇 기록만 자르므로 `REPLAY` 로봇은 기록이 유지된다 (= 녹화 덧입히기, 3.6항).
- **키보드 토글:** 끄면 눌린 키를 비우고 주행 키를 가로채지 않는다 (다시 켜도 끄기 전 눌린 키는 되살아나지 않음). 단축키는 계속 동작한다.
- **보기:** 경기 전 `VIEW`는 비활성이고, 새 경기(`START` / `NEW` / 설정 교체)는 기본 보기 방향으로 시작한다. 경기 중 `VIEW`는 그 경기에서만 임시로 바꾼다.
- **설정 자동 보관 (`localStorage`, `src/ui/settings.ts`):** 마지막으로 적용한 로봇 프로필 / 시나리오(시드 포함)와 화면 설정(언어, 단위, 기본 보기, 표시 옵션, 키보드 토글, 로봇별 조작 모드)을 보관해 새로고침 뒤 복원한다. 입력 출처는 보관하지 않는다 (앱을 켤 때마다 `AUTO`). 경기 기록도 보관하지 않는다 (새로고침하면 경기는 사라짐, 3.6항).
    - 키 `ftc-tactic-sim/settings` + `SETTINGS_VERSION` = 1. 없음 · JSON 손상 · 버전 다름 → 전부 기본값, 항목별 형식 오류 → 그 항목만 기본값.
    - 적용 값 복원: 기본 프로필 모양에 맞추고(`mergeWithDefaults`: 없는 항목은 기본값으로 채움 → 이후 항목이 늘어도 저장한 로봇 유지, 종류가 다르면 버림) 숫자는 유한값, 진영 유효, 로봇 폼 · 시나리오 · 배치 검증을 통과할 때만 쓴다 (슬롯 id는 강제).
    - 저장소를 쓸 수 없으면 기본값으로 시작하고 오류 없이 동작한다. 문서 `lang` 속성은 언어와 동기화한다.
- **키보드 단축키 (상태별 키 공유):** 주행 키는 루프 `RUNNING`에서만, 스크러빙 단축키는 일시정지 / 복기 중에만 쓰이므로 같은 키를 겹쳐 쓴다. 키보드 주행을 꺼도 단축키는 항상 동작한다. 컨트롤러가 창 `keydown`을 직접 처리한다 (주행 키는 입력 어댑터).

    | 키 | 진행 중 (`RUNNING`) | 일시정지 / 복기 | 재생 중 | 종료 강조 |
    |---|---|---|---|---|
    | Space | 일시정지 | 보는 틱 = 머리이고 경기 미종료면 `RESUME`, 그 외에는 재생 시작 (**Space는 분기하지 않음**) | 재생 멈춤 | 건너뛰기 |
    | ← / → | R2 회전 (3.6항) | ∓1틱 | 재생 멈추고 ∓1틱 | — |
    | Shift + ← / → | — | ∓1초 (50틱) | 재생 멈추고 ∓1초 | — |
    | 그 밖의 주행 키 (W / A / S / D, M, `,` `.` `/`) | R2 주행 / 행동 (3.6항) | 무시 | 무시 | — |

    - 방향키 자동 반복 = 연속 이동. Space는 자동 반복을 무시하고, 텍스트 입력칸이 아니면 항상 브라우저 기본 동작(스크롤 / 버튼 누름)을 막는다. 결과 팝업 / 확인창 / 도움말이 열려 있으면 단축키를 끈다.
    - 텍스트 입력칸에 초점이 있으면 단축키를 무시한다. 게임패드에는 일시정지 / 재개를 매핑하지 않는다.
    - 일시정지 중 누른 방향키가 재개 뒤 주행으로 새지 않는 것은 3.6항 규칙(시작 / 재개 때 입력 누적기 초기화)으로 보장된다.

#### 필드 편집 모드 (경기 전, 관중석 시점)

config 창의 편집 버튼을 누르면 메인 필드가 그 편집 모드로 바뀐다. 1366 × 768에서 config 창 안의 작은 캔버스는 1 in 격자가 약 2.5 px라 클릭할 수 없고, 경기 전 메인 필드는 비어 있으며 보기도 같은 관중석 시점이라 메인 필드를 쓴다.

- **공통 (`src/ui/fieldEdit.ts`, 장면 `src/renderer/editSceneRenderer.ts`):**
    - 컨트롤러 `setEditScene(scene | null)`은 경기 전에만 받아 경기 장면 대신 그린다 (같은 객체면 무시, `start()`에서 해제).
    - 필드 위에 안내 띠(모드 이름, 버튼, 설명, Esc 안내)를 띄우고, config 창에는 같은 값의 숫자 칸이 함께 보여 실시간으로 따라온다. 한 번에 한 모드만.
    - 클릭 / 끌기 좌표: 포인터 → 캔버스 CSS 좌표 → `cssToCanvas` → `canvasToField`(보기 = 상태의 `viewAngle`).
    - **끝나는 경우:** 완료 버튼, Esc(캡처 단계라 config 창의 Esc 닫기보다 먼저 받음 — 창은 그대로), 다른 탭으로 이동, config 창 닫기, `START`(편집을 취소하고 시작 절차), 경기 전이 아니게 됨. 다른 탭 / 창 닫기 / 다른 모드로 전환하면 모드에서 바꾼 초안은 그대로 남는다 (숫자 칸 입력과 같음).
    - **완료 = 그 탭 `APPLY`까지 (`editDoneAction`):** 적용할 수 있으면 적용(스윗스팟이면 확률표 생성 시작), 탭에 틀린 칸이 있어 적용할 수 없으면 초안에만 남기고 안내, 바뀐 것이 없으면 닫기만.
    - **취소 (`CANCEL` / Esc / `START`):** 그 모드가 다루는 값과 그 칸의 틀린 글자만 들어오기 전으로 되돌린다 (모드 중 바꾼 다른 칸은 유지).
- **히트맵 모드 `SHOW HIT MAP` (`HEATMAP`):**
    - 로봇 탭 버튼 `SHOW HIT MAP` / `HIDE HIT MAP`("필드에서 확률표 보기" / "확률표 닫기", 열려 있으면 주황 강조, 같은 로봇이면 닫기 토글). 경기 중 비활성.
    - **적용한 설정**의 명중 확률표를 보여 준다 (생성 중이면 조립 중 버퍼, 약 10 Hz로 새로 그려 계산된 행이 채워짐, 미계산 행은 사선 빗금). 초안의 LUT 입력이 적용 값과 다르면 안내 띠에 "적용하면 새로 만듦".
    - 안내 띠(`FieldEditBanner.tsx`): `HIT MAP · R1` + `DONE`, 범례 줄(0 % → 100 % 척도 + 기준 CELL + 기물 버튼 `POLLEN` / `NECTAR`), 생성 상태 · 안내 · "Esc to close". 편집하는 값이 없어 `CANCEL`은 없다. 띠는 명중 띠를 가리지 않게 RED는 필드 위쪽, BLUE(기준 `BLUE_OPPOSITE`, 명중 띠가 위쪽)는 아래쪽에 둔다.
    - 장면: 둘레 배경 → 바닥 회색(`#d9d9d9`) → 히트맵(144 × 144 이미지를 필드 크기로 확대, 확대 보간 = 런타임 조회 `sampleLUT`와 같은 쌍선형) → 미계산 행 빗금 → 타일 / 벽 → HIVE(기준 셀은 진영색 + 노란 테두리) → 스윗스팟 → 조준점 점선, 조준점(흰 원 + 십자), 스윗스팟(흰 원 + 굵은 테두리 + 가운데 점). 로봇 / 기물 / 게이지는 그리지 않는다.
    - **색 척도 (`src/renderer/heatmapView.ts`):** 0 %는 바닥색 `#d9d9d9`, (0, 1]은 진영 파스텔 척도를 고르게 sRGB 선형 보간 — RED `#FECDD3 → #FDA4AF → #FB7185 → #F43F5E`, BLUE `#BAE6FD → #7DD3FC → #38BDF8 → #0284C7`. 더 밝은 앞쪽 색(흰색에 가까운 파스텔)은 회색 바닥보다 밝아 명중 띠 가장자리가 흰 테두리처럼 떠 보이므로 쓰지 않는다. 화면 격자 = 진영 기준 필드 좌표이고, BLUE는 기준 LUT를 점대칭(`BLUE_OPPOSITE`)해 그린다 (`heatmapPixels`, `pendingRowRanges`, `heatmapBasis`, 범례 `heatmapGradientCss`).
    - 참고: 행 작업은 두 기물 중 v0 탐색이 먼저 끝난 기물부터 대기열에 들어가므로(2.6.2항), 생성 중 보고 있는 기물의 행이 나중에 채워질 수 있다.
- **스윗스팟 모드 `SET ON FIELD` (`SWEET_SPOT`):**
    - 로봇 탭 스윗스팟 칸 아래 `SET ON FIELD`("필드에서 찍기", 모드 중에는 "필드에서 찍는 중" 강조 · 비활성).
    - 클릭 = 그 1 in 격자 중심으로 초안 스윗스팟 설정 (`fieldGridCell`, `placeSweetSpot`: 진영 기준 칸 → BLUE는 점대칭 보관). 클릭 뒤에도 모드를 유지해 여러 번 찍어 볼 수 있다. 검증에 실패하는 칸(몸체가 필드 밖 / HIVE와 겹침 / 해 없음)도 찍히고 빨간 오류가 된다 (숫자 칸에 틀린 값을 넣을 때와 같음, `APPLY` 막힘).
    - 마우스를 올린 칸을 강조하고(찍기 가능 초록 / 불가 빨강) 그 자리에서 조준점을 향해 돌린 몸체 점선 윤곽과 말풍선(진영 기준 좌표 + 찍으면 생기는 사유)을 보여 준다. 필드는 십자 커서. 칸이 바뀔 때만 상태를 갱신하고, 클릭은 마지막 포인터 이동의 칸을 찍는다 (클릭 좌표 반올림으로 칸 경계에서 다른 칸이 되는 문제 방지).
    - 장면: 바닥 위 **적용한 확률표** 반투명(50 %, 계산된 행만) → 타일 / 벽 / HIVE → 확률표를 만든 적용 스윗스팟(초안과 다를 때 점선 빈 고리) → 마우스 칸 + 몸체 윤곽 → 초안 스윗스팟 몸체 윤곽(앞 변 굵게, 틀리면 빨강, 크기 = 초안 로봇 크기) → 조준 점선 / 조준점 / 스윗스팟. 몸체 = `aimingRobotOBB`(스윗스팟 검증과 같은 함수). 스윗스팟을 옮기면 v0가 바뀌어 명중 띠 모양도 달라지므로 "적용한 스윗스팟 기준 — 완료하면 적용해 새로 만듦"을 안내한다.
    - 안내 띠: `SWEET SPOT · R1` + `CANCEL` / `DONE · APPLY`, 범례 줄(척도 + 기준 CELL + 기물 버튼), 초안 좌표 + 빨간 사유, 생성 상태 · 설명 · "Esc to cancel".
- **시작 자세 모드 `EDIT ON FIELD` (`SPAWN`):**
    - 시나리오 탭 시작 자세 구역의 `EDIT ON FIELD`("필드에서 편집", 모드 중 "필드에서 편집 중").
    - 조작: 로봇 몸체 끌기 = 위치(누른 점 대비 이동량, 좌표 0 ~ 144 제한), 회전 핸들 끌기 = 헤딩(중심 → 포인터 방향). 스냅은 없고 표시 자리수(0.1 in / 0.1°)로만 반올림한다 (칸에 보이는 값 = 보관 값). 겹쳐도 놓인다 (검증이 표시).
    - 기하 (`src/renderer/spawnEditLayout.ts`, 렌더러와 입력이 같은 계산): 회전 핸들 = 앞 변 가운데에서 앞으로 7 in 떨어진 원(반지름 2.2 in, 막대로 연결). 잡기 판정(`spawnHitTest`)은 핸들 우선(다른 로봇 몸체 위여도 돌릴 수 있게), 나중에 그린 R2 우선, 여유 1 in.
    - 장면: 경기 바닥(타일 / GARDEN / LOADING ZONE / HIVE / FLOWER) + GARDEN 기물 + 두 로봇(흡입 구역 / 몸체 / 앞 변 / 헤딩 화살표 / 번호 / 핸들). 바닥 산포 공은 그리지 않는다 (로봇 자리를 피해 다시 뿌려지므로 끌 때마다 공이 튀는 것 방지). 배치 문제 로봇은 흰 사선 빗금 + 빨간 테두리(RED 로봇에 빨간 덧칠은 보이지 않으므로), 마우스를 올린 몸체는 주황 점선, 잡은 핸들은 주황, 끄는 로봇을 위에 그린다.
    - 로봇 위 좌표 / 헤딩 글자(`SpawnPoseTag`, 문제면 빨간 테두리)는 캔버스와 같은 크기의 HTML 글자 층에 장면 비율(%)로 배치한다. 벽에 붙은 로봇의 글자가 잘리지 않게 가로 기준점을 위치 비율만큼 옮긴다. 커서: 몸체 위 `move`, 핸들 위 `grab`, 끄는 중 `grabbing`.
    - 안내 띠(`SpawnEditBanner`): `START POSE` + `CANCEL` / `DONE · APPLY`, 배치 문제 사유(빨강), "로봇을 끌어 옮기기 · 동그란 핸들을 끌어 돌리기" + Esc.
    - 취소하면 시작 자세 / 칸 글자만 되돌린다 (지정 안 했던 자세는 지정 해제, 모드 중 진영을 바꿨으면 들어오기 전 자세를 좌우 대칭).

#### 시작 자세 배치 검증 (`validateRobotPlacement`)

`validateRobotPlacement(scenario, r1Config, r2Config) → PlacementIssue[]` (`{ code, robots, message }`, `robots` = 문제 로봇 id). `collision.ts`의 OBB / SAT를 재사용하는 순수 함수이며, 시작 자세를 지정하지 않은 로봇은 진영별 기본값(2.3항)으로, 로봇별 크기로 검사한다.

| 코드 | 조건 |
|---|---|
| `PLACEMENT_OUT_OF_FIELD` | 로봇 OBB가 필드 [0, 144]² 밖으로 나감 (`testOBBvsFieldBounds`) |
| `PLACEMENT_IN_HIVE` | OBB가 HIVE AABB와 겹침 |
| `PLACEMENT_IN_FLOWER` | OBB가 FLOWER 원(반지름 2 in)과 겹침 (메시지에 FLOWER 번호) |
| `PLACEMENT_ROBOT_OVERLAP` | R1 / R2 OBB끼리 겹침 (두 로봇 모두 표시) |
| `PLACEMENT_PIECE_OVERLAP` | OBB가 시나리오로 정해지는 고정 배치 기물(GARDEN 기물)과 겹침 |

- **닿음은 허용, 파고듦만 오류** (침투 깊이 > `PLACEMENT_TOLERANCE` = 1e-6 in). 기본 시작 자세는 벽에 붙어 있으므로 통과해야 한다.
- 바닥 무작위 산포 기물과 오토 TIP NECTAR 슬롯은 이미 로봇을 피해 놓이므로 검사하지 않는다. GARDEN 기물 좌표는 `reset()`과 검증이 같은 함수(`gardenPiecePositions`)를 쓴다.
- **`reset()` 사전 보정 (엔진 안전장치):** 화면을 거치지 않은 겹친 시작 자세에 대비해, 로봇을 만든 직후 · 기물 배치 전에 로봇–환경 / 로봇–로봇 겹침이 있는 동안 틱마다 쓰는 로봇 충돌 해결(`resolveRobotCollisions`)을 최대 50회 반복한다 (시간 진행 없음, 결정론 유지). 바닥 산포는 보정된 로봇 자리를 피한다. 겹침이 없으면 아무것도 바꾸지 않는다. GARDEN 기물과의 겹침은 보정하지 않는다 (다음 틱 충돌 처리로 기물이 밀림, 화면은 검증으로 막음).

#### 단위와 표시

화면 ↔ 엔진 변환은 화면이 하고, 엔진에는 항상 inch 기반 단위를 넘긴다 (`src/ui/units.ts`).

| 항목 | 화면 단위 | 엔진 단위 |
|---|---|---|
| 길이 (크기 / 흡입 구역 / 오프셋 / 발사구 지상고 / 좌표) | in (토글 시 cm) | in |
| 속도 / 가속도 | in/s, in/s² (토글 시 cm/s, cm/s²) | in/s, in/s² |
| 최고 각속도 / 최대 각가속도 | rad/s, rad/s² (RoadRunner / Pedro Pathing 튜닝값과 같은 단위) | rad/s, rad/s² |
| 터렛 범위 / 허용 조준 오차 / 발사각 / 방위 · 피치 편차 / 시작 헤딩 | ° | rad |
| 딜레이 / 준비 시간 / 투입 간격 | ms | ms |
| 속도 편차 | % | 비율 (0.02 = 2%) |

- 발사구 지상고 h(바닥에서 잰 높이)를 받아 `dz = HIVE_RIM_Z − h = 53.5 − h`로 바꾼다.
- **내부 값은 항상 inch로 보관**하고 표시할 때만 바꾼다 (토글을 반복해도 반올림 누적 없음). 길이 계열 입력은 변환 결과를 **1e-6 in 격자로 반올림**해, cm로 표시된 값을 그대로 다시 넣어도 원래 inch 값과 정확히 같다 (예: 45.72 cm → 18 in — 로봇 크기가 바뀐 것으로 보여 LUT를 다시 만드는 일 방지). 표시 반올림으로 정보가 줄어드는 값(0.25 in = 0.635 cm → "0.64")은 다시 넣으면 바뀌므로 폼은 사용자가 실제로 고친 칸만 변환한다.
- 시작 헤딩 규약: 0° = 필드 +x(관중석 시점 오른쪽), 양수 = 관중석 시점 시계 방향 (엔진과 같은 부호), 표시 범위 (−180°, 180°].
- **표시 소수 자리:** 길이 계열(길이 / 발사구 지상고 / 속도 / 가속도) 2자리, 좌표 1자리, ° 1자리, rad/s · rad/s² 2자리, ms 정수, % 1자리.
- 숫자 입력 해석(`parseNumberInput`): 공백, 소수점 `.` · `,`, 부호, 지수 표기를 허용하고 그 밖은 오류.

#### 기본 프리셋 (`src/app/defaultSetup.ts`)

- R1 / R2 모두 같은 제원(`DEFAULT_ROBOT_CONFIGS`: 18 in, 앞면 흡입, 고정형 ±3°, 이름 `R1` / `R2`) + 기본 탄도(발사구 14 in, 발사각 60°, 오프셋 0, 편차 기본값) + 기본 스윗스팟.
- **기본 스윗스팟** = 기준 셀 `RED_AUDIENCE` (59.5, 131.5). 후보 11곳 비교(기본 로봇, 발사구 14 in, 60°)에서 입구 정면 약 43 in, 스윗스팟 명중률 POLLEN 99.0 % / NECTAR 97.9 %, 50 % 이상 구역이 가장 넓은 후보였다. 발사각 60°에서는 조준점 수평 거리 25.6 in 이하(`D·tanθ ≤ Δz`)에 해가 없다.
- 기본 시나리오는 `{ allianceColor: 'RED' }` (2.4항 공식 기본 배치).

### 3.9 분기 타임라인과 경기 저장 / 공유

분기해도 이전 기록을 가지로 보존하고, 끝난 경기를 파일(레시피)로 내보내 같은 결과를 다시 불러오며, 로봇 / 시나리오 설정을 프리셋 파일로 주고받는다. 직렬화 / 검증 / 트리 규칙은 React 밖 순수 TS이고 화면은 그 위에 얹는다.

- **범위:** 저장 위치는 **파일 다운로드 / 파일 선택 불러오기만**이다 (브라우저 안 경기 · 프리셋 목록은 없음, 5.2항). 파일에는 화면 설정(언어 / 단위 / 기본 보기 / 표시 옵션 / 키보드 토글 / 조작 모드)을 넣지 않는다 (받는 사람의 환경을 따름).

#### 적용 입력 기록

- **왜 필요한가:** 녹화 로그는 `LIVE` 로봇만 기록하고 `REPLAY`의 재료로 쓰인다. 녹화 덧입히기 중 `REPLAY` 로봇을 일시정지에서 `NONE`으로 바꿔 재개하면 로그 뒷부분은 남은 채 엔진에는 중립 입력이 들어가므로, 녹화 로그만으로는 그 경기를 재현할 수 없다.
- **규칙:** 입력 허브 `MatchInputs`에 로봇별 적용 입력 기록(`applied`, 녹화 로그와 같은 틱당 4 B 형식)을 둔다. 틱마다 엔진 `step`에 실제로 들어간 입력의 부호화 값을 출처와 무관하게 기록한다 — `LIVE` = 방금 기록한 값, `REPLAY` = 읽은 값(기록 끝을 넘으면 중립), `NONE` = 중립 `NEUTRAL_RECORD` `[0, 0, 0, IDLE]`. 길이 = 그 가지의 머리 틱. 녹화 로그 재생 공급 함수(`createReplayProvider`)는 기록하지 않는다.
- 녹화 로그(`logs`)의 규칙(`LIVE`만 기록, 분기 때 `LIVE`만 자름, `REPLAY` 재료)은 그대로다. 적용 입력 기록은 재현 / 저장 전용이며 `REPLAY`의 재료가 아니다. 분기 때는 두 로봇 모두 분기 틱에서 자른다.
- 레시피 재현은 적용 입력 기록만 재생한다 (`createInputRecordProvider(records)`: 출처 없이 기록 그대로 복호화, 기록 끝 너머 = 중립). 조작 모드는 부호화 전에 필드 좌표로 바뀌므로 저장하지 않는다 (3.6항).
- 메모리: 로봇별 `Int8Array(6000 × 4)` = 24 KB, 가지마다 녹화 로그 2 + 적용 기록 2 = 96 KB (프레임에 비해 무시할 수 있음).

#### 버전 상수

| 상수 | 위치 | 올리는 때 |
|---|---|---|
| `ENGINE_VERSION` (현재 1) | `simulationEngine.ts` | 같은 시나리오 / 시드 / 입력에 대해 프레임 결과가 달라지는 커밋 (엔진 규칙, 충돌 / 동역학 상수, 시나리오 초기화, 난수 사용 순서, 프레임 형식) |
| `BALLISTICS_MODEL_VERSION` (현재 1) | `ballistics.ts` | 명중 판정 / LUT 생성 규칙 / 투입구 기하가 바뀌는 커밋 (2.6.2항) |
| `RECIPE_VERSION` (현재 1) | `src/app/matchRecipe.ts` | 경기 파일 구조 변경 |
| `PRESET_VERSION` (현재 1) | `src/ui/presetFile.ts` | 프리셋 파일 구조 변경 |

- **`ENGINE_VERSION` 올림 누락 방지:** `src/core/__tests__/engineVersion.test.ts`가 고정 제원 · 시나리오 · 시드 · 입력으로 흡입 / 발사 / HIVE TIP 3회 / 리프트 전 단계 / GARDEN 득점이 나오는 경기를 돌리고, 버전 + 종료 체크섬 + 체크포인트 121개를 이은 해시를 기대값으로 박아 둔다. 결과가 바뀌면 테스트가 실패하므로 그 커밋에서 버전을 올리고 기대값을 갱신한다.

#### 상태 체크섬 (`src/core/checksum.ts`)

- `frameChecksum(frame)` = `JSON.stringify(frame)`의 UTF-16 코드 단위에 대한 **FNV-1a 32비트** 해시(`fnv1a32`), 8자리 소문자 16진수. JS 숫자 → 문자열은 왕복 정확(최단 표기)이라 부동소수 비트 차이를 잡고, 키 순서는 엔진의 프레임 복제 순서로 고정된다. 목적은 위변조 방지가 아니라 **불일치 검출**이다 (다른 브라우저 / 다른 엔진 버전, 5.3항 교차 브라우저 결정론).
- 체크포인트: 0, 50, 100, …, 6000틱 (1초 간격, 121개, `checkpointTicks` / `timelineCheckpoints`). 불러온 경기를 다시 계산해 비교하고(`compareCheckpoints`), 처음 어긋난 체크포인트로 "어디서부터 달라졌는지"(직전 일치 체크포인트 ~ 첫 불일치 체크포인트)를 알려 준다. 개수가 다르면 짧은 쪽 끝 다음에서 어긋난 것으로 본다.

#### 경기 파일 (레시피, `.json`, 수 KB ~ 최대 약 100 KB)

```
{
  "format": "ftc-tactic-sim/match",
  "recipeVersion": 1,
  "engineVersion": 1,
  "ballisticsModelVersion": 1,
  "createdAt": "2026-09-30T14:32:05+09:00",
  "setup": { "robot1": RobotProfile, "robot2": RobotProfile, "scenario": ScenarioConfig },
  "lut": { "seed": 12194135, "samples": 2000, "searchSamples": 20000 },
  "inputs": { "ticks": 6000, "robot1": "<Base64>", "robot2": "<Base64>" },
  "checksums": { "interval": 50, "values": ["1a2b3c4d", ...] },
  "branch": { "name": "Branch 3" },
  "result": { "totalScore": 87, "rp": { "swarm": false, "pollinator1": true, "pollinator2": false } }
}
```

- `setup`: 경기에 쓴 **적용된 값** 그대로 — 로봇 프로필(팀 번호 / 팀명 / 제원 / 탄도 설정 = 스윗스팟 · 발사구 · 발사각 · 편차, 3.8항)과 시나리오. 로봇 데이터는 프리셋과 같은 형식(슬롯 id 없음). 시나리오 `rngSeed`가 비어 있으면 엔진 기본 시드를 채워 파일만으로 완결되게 한다.
- `lut`: LUT 기준 시드 / 격자당 샘플 수 / v0 탐색 샘플 수 (지금 앱 상수 `DEFAULT_BALLISTICS_SEED` / `DEFAULT_LUT_SAMPLES` / `DEFAULT_V0_SEARCH_SAMPLES`, `CURRENT_LUT_SETTINGS`). LUT 자체는 저장하지 않는다 (불러올 때 캐시가 있으면 바로, 없으면 생성, 2.6.2항).
- `inputs`: 로봇별 적용 입력 기록 0 ~ 5999틱을 **연속 중복 압축(RLE)** 한 뒤 Base64. 한 묶음 = `[반복 틱 수 uint16 LE][qx][qy][qω][action]` 6 B, 묶음들의 반복 수 합 = 6000. 최악(매 틱 다름)이 로봇당 36 KB → Base64 48 KB.
- `checksums`: 체크포인트 121개.
- `branch` / `result`: 사람이 파일을 알아보기 위한 정보. 불러오기 판정에는 쓰지 않는다 (가지 이름은 불러온 경기의 원본 가지 이름으로만 쓴다).
- **저장 대상 = 경기 종료(6000틱)에 도달한 지금 가지 하나** (결과 팝업에서 내보냄). 가지의 조상 구간 입력을 이어 붙인 0 ~ 5999틱 전체가 한 파일이다. 미종료 가지 / 트리 전체 저장은 v2.0.0 예정(5.2항).
- **함수 (`matchRecipe.ts`):** `encodeInputRecord` / `decodeInputRecord`(RLE + Base64), `appliedInputRecords(inputs)`, `buildMatchRecipe`(종료 전 / 입력 부족이면 `RangeError`, 시드 채움, 결과 = 종료 프레임 점수 · RP), `serializeMatchRecipe`, `parseMatchRecipe(text, defaults)` → 레시피 + 경고 또는 거부 코드, `recipeWarnings`, `verifyRecipe`.
- **해석은 엄격하다** (재현이 목적이므로 프리셋과 달리 없는 항목을 기본값으로 채우지 않는다). 거부 코드:
    - `NOT_JSON` / `PRESET_FILE`(프리셋 파일을 넣음) / `NOT_RECIPE`(`format` 다름) / `RECIPE_VERSION`
    - `INVALID_FIELD` (`field` = `engineVersion` · `ballisticsModelVersion` · `setup.robot1` · `setup.robot2` · `setup.scenario` · `lut`)
    - `INVALID_INPUTS` (`ticks` · `robot1` · `robot2`: Base64 / 묶음 길이 오류, 반복 0, 합 ≠ 6000, q = −128, 행동 코드 0 ~ 4 밖)
    - `INVALID_CHECKSUMS` (개수 ≠ 121 등)
    - `INVALID_SETUP` (`issues` = 로봇 폼 / `validateScenario` / `validateRobotPlacement` 문제 코드)
    - 로봇 / 시나리오는 "프리셋 정리 함수가 아무것도 바꾸지 않아야 통과"로 엄격히 해석한다 (없는 항목 · 형식 틀림 · 틀린 팀 글자는 모두 값이 달라져 거부). 시나리오는 진영 + 시드가 필수. 파일의 모르는 항목은 무시하고, 알아보기 정보(`createdAt` / `branch` / `result`)는 틀려도 빈 값으로 받는다.

#### 경기 불러오기 (`IMPORT MATCH`, SETTINGS 탭 `PRESETS` 구역의 `MATCH` 줄, 경기 전에만)

1. **파일 선택 → 해석 / 검증.** 거부되면 줄 아래 빨간 글자로 사유를 보이고 아무것도 바꾸지 않는다 (파일 선택 오류 `TOO_LARGE`(1 MB 초과) / `READ_FAILED` 포함).
2. **확인창:** "R1 / R2 / SCENARIO 설정을 파일 값으로 바꾸고 경기를 불러올까요?" + 해당될 때만 `⚠` 경고 줄 — 엔진 버전 다름 / 탄도 모델 버전 다름("다시 만든 확률표로 결과가 달라질 수 있음") / `lut` 값이 지금 앱 상수와 다름. 경고가 있어도 진행할 수 있다 (지금 앱의 엔진 / 탄도 모델 / LUT 상수로 다시 계산하고 결과 차이는 체크섬으로 드러남).
3. **확인 →** R1 / R2 / SCENARIO의 **적용 값과 초안을 파일 값으로** 바꾸고(적용 안 된 수정은 버려짐, 자동 보관 갱신) 명중 확률표를 준비한다 (기존 생성 흐름). 준비 중에는 줄에 "경기 불러오는 중 · 명중 확률표 N%"(두 로봇 진행률 평균) + `CANCEL`. 생성 오류면 빨간 글자로 "로봇 탭에서 다시 시도하거나 취소"를 안내하고 대기한다. `CANCEL`하거나 준비 중에 `APPLY` / `REROLL` / `RESET ALL` / 프리셋 불러오기를 하면 불러오기만 취소되고, 이미 바뀐 설정은 그대로 경기 전 화면에 남는다.
4. **확률표 준비 →** "재계산 중"을 한 번 그린 뒤 적용 입력 기록으로 전체 재계산(`AppController.loadMatch`: 새 엔진 + `MatchInputs.loadRecords` + 기록 재생 공급 함수로 `runFullMatch`, 약 1.5초) → 체크포인트 비교 → 기본 보기 방향으로 회전 후 **복기 상태**(보는 틱 0, 루프 `ENDED`, `RESUME` 없음). 불러온 경기는 새 트리의 원본 가지(이름 = 파일 `branch.name`)가 된다. 종료 연출 / 결과 팝업은 띄우지 않고(`endSeq` = 0) `RESULT`로 연다.
5. 두 로봇의 입력 출처는 `REPLAY`(녹화 로그 = 불러온 적용 입력 기록)로 두어, 되감아 `BRANCH`하면 녹화 덧입히기로 이어 조종할 수 있다.
6. **체크섬이 어긋나면** 필드 위 경고 배너(자동 일시정지 배너와 같은 모양, 닫기 가능, 경기 전 화면에서 사라짐): "파일 기록과 결과가 다릅니다 · {M:SS} ~ {M:SS} 사이부터" (+ 버전이 달랐으면 그 사유). 경기는 그대로 복기 / 분기할 수 있다.

#### 경기 내보내기 (결과 팝업)

- 결과 팝업의 `EXPORT MATCH`("경기 내보내기", 레시피 `.json`, `Download`) / `EXPORT SUMMARY`("요약 내보내기", 요약 `.txt`, `FileText`). 불러오기는 `IMPORT MATCH`("경기 불러오기"). 프리셋 구역도 같은 동사 `EXPORT` / `IMPORT`("내보내기" / "불러오기")를 쓴다.
- 대상 = 결과 팝업이 보여 주는 지금 가지 (`AppController.recipeSource()` = 적용 입력 기록이 6000틱 모두 있으면 입력 + 타임라인 + 가지 이름). 레시피 설정 = 적용 값(경기 중에는 잠겨 있음). 내보내기는 기록을 바꾸지 않고 팝업을 닫지 않는다.
- **요약 텍스트** (UTF-8, 줄바꿈 `\n`, 지금 화면 언어, 결과 팝업과 같은 규칙 `resultRows` / `rpCards` / `resultBasisText` 재사용, `matchSummaryText`):

    ```
    FTC TacticSim · TELEOP MATCH COMPLETED
    2026-09-30 14:32 · RED · Branch 3
    R1 #12345 Bumblebots · R2 Hive Mind
    TOTAL SCORE 38
    HIVE    20  TELEOP TIP 1 × 20 · auto TIP 5 counts for RP only
    FLOWER   9  FLOWER 2: 2 × 2 + bottom bonus 5
    GARDEN   4  POLLEN 4 × 1
    PARK     5  R1 parked × 5
    RP  SWARM PARK 5 / 10 · POLLINATOR 1 ✓ TIP 5 / 4 · POLLINATOR 2 TIP 5 / 7
    SEED 12194135 · ENGINE v1 · BALLISTICS v1
    ```

    둘째 줄의 가지 이름은 결과 팝업과 같은 규칙(`shownBranchName`)일 때만 넣는다.

#### 분기 트리

- **보존:** `BRANCH`는 기존 기록을 지우지 않고 **새 가지**를 만든다. 가지 = `{ id, 번호, 이름, 부모 가지, 분기 틱 T, 타임라인, 녹화 로그 사본, 적용 입력 기록, 종료 도달 여부 }`.
- **이름:** 원본 `Main` / "원본", 새 가지 `Branch {n}` / "가지 {n}" (경기 안에서 번호 재사용 없음). 이름 바꾸기 1 ~ 24자(앞뒤 공백 제거, 비우면 자동 이름). 파일에는 언어와 무관한 영어 자동 이름(`fileBranchName`)을 쓴다.
- **프레임 공유:** 새 가지의 0 ~ T틱 프레임은 부모 가지의 프레임 객체를 **참조로 공유**하고(프레임은 불변 `DeepReadonly`), T + 1틱부터만 새로 만든다. 엔진은 기록 저장소를 타임라인 객체 `EngineTimeline { frames, rngStates }`로 꺼내 바꿀 수 있다 — `forkTimeline(tick)`(0 ~ tick 프레임 / 난수 상태를 참조로 복사한 새 배열을 설치 + 되감기, 원래 배열은 그대로라 부모 보존), `adoptTimeline(t)`(설치 + 그 머리로 복원), `currentTimeline`. 한 가지 안에서 프레임을 자르는 일은 없다 (재개는 머리에서만, 되감은 틱에서는 항상 새 가지).
- **입력:** 새 가지는 부모의 녹화 로그를 복사해 시작하고 3.6항 분기 규칙을 **새 가지의 사본에만** 적용한다 (`LIVE` 로봇은 T 이후 폐기, `REPLAY`는 유지 = 녹화 덧입히기). 적용 입력 기록은 0 ~ T를 복사한다. 입력 허브는 지금 가지의 작업본이고, 떠나는 가지는 사본(`MatchInputs.snapshot()` / `restore()`, `BranchInputs`)을 보관한다.
- **상한 `MAX_BRANCHES = 8`** (원본 포함). 가득 찬 상태에서 `BRANCH` → 안내창 "가지가 8개로 가득 찼습니다. 가지 목록에서 가지를 삭제한 뒤 분기하세요." (확인 버튼 하나, 분기 안 함).
- **메모리 근거:** 끝까지 진행한 가지 하나(6001프레임)는 Node 측정 힙 약 38 ~ 46 MB이고, 가지 메모리는 (6000 − T) / 6000에 비례한다. 헤드리스 Chromium(1366 × 768, 기본 설정)에서 경기 초반에 갈라 끝까지 진행한 가지를 하나씩 늘리며 잰 JS 힙은 경기 전 16.1 MB → 가지 1개 38.8 → 2개 60.8 → … → 8개 187.9 MB (가지당 약 21 MB)로, 탭 힙 상한(약 4 GB)의 약 5%다. 그래서 **모든 가지의 프레임을 메모리에 유지**한다. 전체 재계산은 1.2 ~ 1.5초.
- **분기 확인창:** "{M:SS}에서 새 가지를 만들어 다시 조종할까요? 지금 가지({이름})의 기록은 그대로 남습니다."
- **가지 목록 (`BranchMenu.tsx`, 스크러버 줄 가지 버튼에서 위로 펼침, 420u):** 만든 순서대로, 깊이마다 10u 들여쓰기. 줄 = 지금 가지 체크 · 이름(누르면 전환 후 닫힘) · 분기 시각(`from 1:24` / "1:24에서", 원본은 "—") · 상태(종료 = 총점 `95 pts` / "95점", 미종료 = 머리 시각 `to 0:50` / "0:50까지") · 이름 바꾸기(연필 → 줄 안 입력칸, Enter / 초점 이동 = 저장, Esc = 취소) · 삭제(휴지통, 원본 비활성). 바깥 클릭 / Esc로 닫힌다. 열 수 없는 상태(진행 · 재생 · 확인창 등)가 되면 숨었다가 돌아오면 다시 보인다 (삭제 확인 뒤 목록 유지).
- **타임라인 분기 표식:** 지금 가지와 그 조상이 갈라진 틱마다 파란 세로 막대, 마우스를 올리면 "Branch 3 · from Main at 1:23" / "가지 3 · 원본의 1:23에서" (`forkMarks`).
- **가지 전환 (`switchBranch`):** 일시정지 / 복기 중에만 (진행 · 재생 · 회전 · 종료 강조 · 결과 팝업 · 확인창 중에는 목록 버튼 비활성, `branchMenuEnabled`). 재생을 멈추고 보는 틱은 유지하되 그 가지 머리를 넘으면 머리로. 전환한 가지가 미종료면 일시정지(보는 틱 = 머리일 때 `RESUME` — 루프가 `ENDED`여도 엔진이 6000틱 전이면 재개 가능), 종료면 복기. 기록을 바꾸지 않으므로 확인창 / 종료 연출이 없다 (`endSeq` 불변).
- **가지 삭제 (`deleteBranch`):** 확인창 "'{이름}' 가지를 삭제할까요?" (하위 가지가 있으면 "'{이름}' 가지와 그 아래 가지 {n}개를 삭제할까요?", 영어는 "with its sub-branches (n)") → 그 가지와 모든 하위 가지 삭제. 지금 가지가 지워지면 먼저 그 부모로 전환한다. 원본은 삭제할 수 없다. id는 남은 가지 중 최대 + 1로 새로 매기되 번호는 재사용하지 않는다.
- **`NEW` / 불러오기:** 트리 전체를 버리고 새 트리를 만든다. 가지가 2개 이상이면 `NEW` 확인창에 "가지 {n}개를 모두 버리고"를 넣는다.
- **결과 팝업:** 가지가 2개 이상이거나 지금 가지에 사용자 이름이 있으면 헤더 진영 배지 옆에 가지 이름(`GitFork`). 종료된 가지가 2개 이상이면 RP 아래에 `BRANCHES` / "가지 비교" 줄 — 종료된 가지별 이름 + 점수 칩, 지금 가지 주황 테두리, 최고 점수(동점 모두) 트로피. 눌러도 전환하지는 않는다 (업데이트 예정, 5.2항).
- **모듈:** 트리 규칙 `src/app/branchTree.ts`(순수, `createBranchTree` / `forkBranch` / `switchBranch` / `renameBranch` / `removeBranch` / `descendantIds` / `branchDepth` / `fileBranchName`), 화면 규칙 `src/ui/branchView.ts`(`branchLabel` / `branchRows` / `forkMarks` / 확인창 문구 / `shownBranchName` / `branchComparison` / `fileBranchNumber`), 컨트롤러 상태 `branches`(번호 / 이름 / 부모 / 분기 틱 / 깊이 / 머리 / 종료 / 종료 점수) · `currentBranchId` · `canFork` · `branchName`.

#### 프리셋 파일 (SETTINGS 탭 `PRESETS` 구역, `src/ui/presetFile.ts`)

| 줄 | 파일 종류 `kind` | `EXPORT` | `IMPORT` |
|---|---|---|---|
| `R1` / `R2` | `ROBOT` (`RobotProfile`) | 그 로봇의 적용 값 | → 그 로봇 초안 (R1에서 내보낸 파일을 R2에 넣어도 됨, 슬롯 id는 줄이 정함) |
| `SCENARIO` | `SCENARIO` (`ScenarioConfig`, 시드 포함) | 적용 값 | → 시나리오 초안 |
| `ALL` | `SETUP` (R1 + R2 + 시나리오) | 세 탭의 적용 값 | → 세 탭 초안 모두 |
| `MATCH` | 경기 레시피 | (결과 팝업에서) | 위 "경기 불러오기" |

- 파일 형식: `{ "format": "ftc-tactic-sim/preset", "presetVersion": 1, "kind": "ROBOT" | "SCENARIO" | "SETUP", "data": ... }` (`SETUP`의 `data` = `{ robot1, robot2, scenario }`, 2칸 들여쓴 JSON, 로봇 데이터에 슬롯 id 없음).
- 줄 설명: 로봇 = 적용된 `#팀 번호 팀명`, 전체 = `R1 + R2 + SCENARIO`, 경기 = "경기 내보내기로 저장한 파일".
- `EXPORT`는 SETTINGS 탭을 볼 수 있으면 언제나 (적용 값이라 경기에 영향 없음). `IMPORT`는 경기 전에만 (초안은 경기 전에만 편집 가능).
- **불러오기 규칙:**
    - 파일 자체가 틀리면 거부하고 줄 아래 빨간 글자로 사유를 보인다 — `NOT_JSON` / `NOT_PRESET`(형식 · 버전 · 종류 값 · `data` 틀림) / `MATCH_FILE`(경기 파일을 넣음) / `NEWER_VERSION`(`presetVersion`이 지금보다 큼) / `WRONG_KIND`(그 줄과 종류가 다름), 파일 선택 쪽 `TOO_LARGE`(1 MB 초과) / `READ_FAILED`. 사유는 오류 코드로 보관해 지금 언어로 그리고, 탭을 옮기면 지운다.
    - 항목이 없거나 형식이 틀리면 **그 항목만 기본값**으로 채운다 (자동 보관과 같은 정리 함수). 로봇(`sanitizeRobotPreset`) = 숫자는 유한값만, 문자열 / 불리언 / 슈터 형식 / 터렛 범위(숫자 2개)는 형식이 맞을 때만, 흡입 구역은 형식이 맞는 구역만 최대 8개, 탄도는 항목별. 시나리오(`sanitizeScenarioPreset`) = 선택 항목은 없으면 기본 시나리오 그대로, 형식이 틀린 항목만 기본값, 모르는 항목은 버림.
    - 범위를 벗어난 값은 버리지 않고 초안에 넣어 빨간 오류로 보여 준다 (사용자가 고쳐서 `APPLY`). 팀 번호 / 팀명이 입력칸 규칙에 어긋나면 값은 비우고 그 글자를 틀린 입력 글자로 보관한다.
    - 불러온 값은 **초안**에만 들어가고 기존 `APPLY` 흐름(확률표 재생성 포함)을 탄다 (`importPresetToDrafts`). 적용 안 된 수정이 있는 탭에 넣으면 `COPY TO`와 같은 덮어쓰기 확인창(`importOverwriteTabs`).
- 파일 도우미 `src/ui/fileTransfer.ts`: `downloadTextFile`(Blob + `<a download>`), `pickTextFile`(숨긴 `<input type=file>`, 취소 → null).

#### 파일 이름 (로컬 시각, 파일 이름에 쓸 수 없는 글자는 `_`)

- 경기 `tacticsim-match_{YYYYMMDD-HHmm}_{RED|BLUE}_{총점}pts.json`, 원본이 아닌 가지는 끝에 `_b{번호}` (예: `tacticsim-match_20260930-1432_RED_87pts_b3.json`). 요약은 같은 이름의 `tacticsim-summary_….txt`.
- 프리셋 `tacticsim-robot_{팀 번호, 없으면 R1 / R2}.json`, `tacticsim-scenario_{RED|BLUE}.json`, `tacticsim-setup_{YYYYMMDD-HHmm}.json`.

### 3.10 도움말, 버그 리포트, 라이선스, 버전

- **버전:** `package.json` `version` = **1.0.0**. `vite.config.ts`의 `define`이 `__APP_VERSION__`으로 앱에 넣어(`src/ui/helpInfo.ts` `APP_VERSION`, 선언 `src/vite-env.d.ts`) 도움말 / 버그 리포트에 보인다.
- **라이선스:** PolyForm Noncommercial License 1.0.0 (`LICENSE`) — 비상업적 목적이면 사용 · 복사 · 수정 · 재배포 자유, 상업적 사용 불가. 필수 고지 `Required Notice: Copyright 2026 7ISx7JuQ (https://github.com/7ISx7-JuQ/ftc-tactic-sim)`. `package.json` `license` = `PolyForm-Noncommercial-1.0.0`. 배포 번들에 들어가는 서드파티(React · react-dom · scheduler MIT, lucide-react ISC, Pretendard OFL-1.1)는 `THIRD_PARTY_NOTICES.md`에 원문과 함께 고지한다.
- **도움말 창 (`HelpDialog.tsx`):** 접힌 config 띠의 `?` 버튼(`CircleHelp`, 언제나). 열면 진행 중인 경기 / 재생을 멈추고 단축키를 끈다 (닫으면 다시 켬, 경기는 일시정지 상태로 남음). 화면 전체 모달(640u, 본문 스크롤), Esc · 닫기 · 바깥 클릭으로 닫힌다.
    - 내용 (영어 / 한국어, 게임 용어 원어 대문자): 소개, 빠른 시작 4단계, 조작표(게임패드 / 키보드 — 키보드 칸은 `inputConfig` 키 설정을 그대로 읽음, `controlRows`), 복기와 가지, 저장과 공유, 알아 두기(데스크톱 · HTTPS · 시뮬레이션 한계), 버그 리포트, 정보(버전 · 라이선스 한 줄 · 소스 코드 / 라이선스 / 서드파티 고지 링크).
- **버그 리포트 (폼 없이 메일):** 받는 사람 `7isx7juq@gmail.com`(`BUG_REPORT_EMAIL`). 주 버튼 = Gmail 쓰기 창 링크 `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`(새 탭), 보조 = 기본 메일 앱 `mailto:` 링크, 그 아래 주소 글자.
    - 제목 `[FTC TacticSim {버전}] Bug report`, 본문 = 지금 화면 언어의 작성 틀(무슨 일 / 재현 순서 / 기대 결과 / 첨부 안내) + 앱 버전 · 브라우저(User-Agent) · 화면(가로 × 세로 @배율) · 언어.
    - 앱은 메일을 보내지 않고 링크만 연다 (서버 없음).
- **배포:** 정적 사이트(`npm run build` → `dist/`)라 어떤 정적 호스팅에도 올릴 수 있다. 명중 확률표 캐시(`crypto.subtle`)는 HTTPS에서만 동작하므로 HTTPS로 제공한다. 빌드에는 Node.js 22.12 이상이 필요하다.

## 4. 데이터 인터페이스 (`types.ts`)

엔진의 주요 타입이다 (`src/core/types.ts`). 좌표 / 길이는 inch, 각도는 라디안, 시간은 주석에 적힌 단위.

```tsx
// 로봇 범퍼 면에 붙는 직사각형 구역 (로봇 기준 좌표, 3.3항)
// offset 부호: FRONT/BACK 변은 로봇 오른쪽이 +, LEFT/RIGHT 변은 로봇 앞쪽이 +
export type BumperSide = 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT';

export interface BumperZone {
  side: BumperSide;
  offset: number; // 변 중점 기준 변을 따른 이동 (inch). |offset| ≤ 변 길이 / 2
  width: number; // 변과 평행한 길이 (inch, > 0, 변 길이 초과 허용)
  depth: number; // 변에서 바깥 수직으로 뻗는 깊이 (inch, > 0)
}

// 1. 로봇 하드웨어 제원 (RoadRunner 튜닝 상수 호환)
export interface RobotConfig {
  id: 'robot1' | 'robot2'; // 엔진이 슬롯에 따라 강제 (r1 = 'robot1', r2 = 'robot2'), 사용자 입력 아님
  name: string;
  width: number;
  length: number;
  maxSpeed: number; // 최고 속도 (inch/s)
  maxTurnRate: number; // 최고 각속도 (rad/s)
  maxLinearAccel: number; // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number; // 최대 각가속도 (rad/s^2)

  // 인테이크 옵션
  intakeDelay: number; // 흡입 딜레이 (ms)
  canIntakeNectar: boolean; // Nectar 흡입 가능 여부 (false면 NECTAR 적재 불가)
  maxControlledPieces: number; // 최대 적재 수 (POLLEN/NECTAR 합산). 실제 한도 = min(이 값, 룰 상한 4)
  intakeZones: BumperZone[]; // 인테이크 구역 목록 (개수 무제한, 빈 배열 = 흡입 불가). FRONT/ANY는 프리셋 함수로 생성

  // HIVE 득점 (슈터) 런타임 제원 (명중률은 탄도 LUT 판정 함수가 결정)
  shooterDelay: number; // 발사 딜레이 (ms)
  turretType: 'FIXED' | 'TURRET';
  // 터렛 회전 한계 [α, β] (rad, 차체 헤딩 기준 상대각 Δψ = 목표 방위 − 헤딩, + = 로봇 오른쪽, [-π, π] 정규화)
  // α > β이면 ±π를 가로지르는 구간, 360° 터렛 = [-π, π]
  turretRange: [number, number];
  aimTolerance: number; // 고정형 허용 조준 오차 (rad, 헤딩 기준 ±, 기본 3° ≈ 0.0524)

  // FLOWER 득점 옵션
  flowerSetupDelay: number; // 리프트 올림 시간 = 내림 시간 (ms, 2.6.3항 리프트 FSM)
  flowerDropDelay: number; // 연속 투입 간격 (ms)
}

// 로봇 자세 (필드 좌표계 위치 + 헤딩)
export interface RobotPose {
  x: number; // inch
  y: number; // inch
  heading: number; // 라디안
}

// TELEOP 시작 조건 (오토 결과를 반영한 시나리오, 2.4항)
export interface ScenarioConfig {
  allianceColor: 'RED' | 'BLUE';

  // 로봇 시작 자세 (오토 종료 위치). 미지정 시 진영별 기본값 (2.3항)
  r1Spawn?: RobotPose;
  r2Spawn?: RobotPose;

  // HIVE 초기 상태
  hiveUpwardCell?: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  hiveInitialPieces?: {
    pollenCount: number; // 상향 셀 POLLEN (기본 0)
    nectarCount: number; // 상향 셀 NECTAR (기본 3). {NECTAR, POLLEN}이 팁 임계 테이블 미만이어야 함
  };

  // TELEOP 시작 시 로봇 적재물 (순서 있는 목록, FIFO: 0번이 가장 먼저 나감)
  // 미지정 시 적재 한도만큼 POLLEN. 길이 ≤ 적재 한도, NECTAR는 canIntakeNectar 로봇만
  r1Loadout?: ('POLLEN' | 'NECTAR')[];
  r2Loadout?: ('POLLEN' | 'NECTAR')[];

  // FLOWER 내부 POLLEN 수 (기본 각 4개, 각 0 ~ 4: 오토 중 투입 불가)
  flowerPiecesCount?: [number, number, number, number];

  // GARDEN에 남은 POLLEN 수 (기본 각 4개)
  gardenPiecesCount?: {
    ally: number;
    opponent: number;
  };

  // 오토 중 HIVE TIP 횟수 (기본 0): TELEOP 직전 휴먼 플레이어가 그 수만큼 LOADING ZONE에 NECTAR 투입,
  // POLLINATOR RP TIP 횟수에 합산 (TELEOP 점수에는 미포함)
  autoTipCount?: number;

  // ※ 위에서 지정되지 않은 나머지 POLLEN / NECTAR는 모두 바닥에 무작위 산포 (자동 계산)

  // 결정론적 난수 시드 (미지정 시 엔진 기본 시드). 동일 시드 + 동일 입력 = 동일 경기
  rngSeed?: number;
}

// 독립 모듈용 탄도학 설정 및 히트맵 타입 (로봇별 1개)
export interface BallisticsConfig {
  dz: number; // 림 높이(53.5) - 발사구 지상고 (in). 발사구 z = 53.5 - dz
  shooterPitch: number; // 발사각 (rad)
  sweetSpot: { x: number; y: number }; // 기준 셀 RED_AUDIENCE 스윗스팟 (로봇 중심 좌표 한 점)
  shooterOffset: number; // 차체 중심 기준 발사구 오프셋 (in, 조준 방향)
  v0NoisePercent?: number; // 속도 편차 (기본 0.02)
  headingNoiseRad?: number; // 방위각 편차 (기본 0.02 rad)
  pitchNoiseRad?: number; // 피치각 편차 (기본 0.006 rad)
}

export type HiveCellKey = 'RED_AUDIENCE' | 'RED_OPPOSITE' | 'BLUE_AUDIENCE' | 'BLUE_OPPOSITE';
// 144 × 144 격자(1 in) 명중률 (0.0 ~ 1.0), 인덱스 = gy * 144 + gx, 격자 중심 = (gx + 0.5, gy + 0.5), 조회는 쌍선형 보간
export type HeatmapLUT = Float32Array;
export type HeatmapLUTSet = Record<HiveCellKey, HeatmapLUT>;
export type RobotHeatmapLUTs = Record<'POLLEN' | 'NECTAR', HeatmapLUTSet>; // 로봇당 8장, 합계 16장
export type MatchHeatmapLUTs = Record<'robot1' | 'robot2', RobotHeatmapLUTs>; // 경기 1회분 (createLUTShotResolver 입력)

// 엔진 발사 비행 처리용 슈터 탄도 (로봇별). v0 미지정 기물은 발사마다 조준점 닫힌 해
export interface ShooterBallistics {
  dz: number; // 림 높이(53.5) - 발사구 지상고 (in)
  shooterPitch: number; // 발사각 (rad)
  shooterOffset: number; // 차체 중심 기준 발사구 오프셋 (in, 발사 방향)
  v0?: Partial<Record<'POLLEN' | 'NECTAR', number>>; // 기물별 사출 속도 (generateRobotLUTs 결과)
}
export type MatchShooterBallistics = Record<'robot1' | 'robot2', ShooterBallistics>;

// HIVE 시차 낙하 예약 대기열
export interface PendingDrop {
  pieceId: string;
  type: 'POLLEN' | 'NECTAR';
  targetX: number;
  targetY: number;
  settleTime: number; // 전복 시작 시점 기준 완전 정지까지 소요 시간 (초 단위)
}

// 2. 득점 기물
export interface GamePiece {
  id: string;
  type: 'POLLEN' | 'NECTAR';
  alliance: 'RED' | 'BLUE' | 'NONE';
  x: number;
  y: number;
  vx: number; // X방향 속도 (inch/s)
  vy: number; // Y방향 속도 (inch/s)
  state: 'ON_FIELD' | 'CONTROLLED' | 'IN_HIVE' | 'IN_FLOWER' | 'IN_GARDEN' | 'OUT_OF_BOUNDS' | 'IN_FLIGHT'; // IN_FLIGHT: 발사 후 도착 전
}

// 3. 로봇 동역학 및 행동 상태
export interface RobotState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  omega: number;
  heading: number;
  // FLOWER_*: 리프트 FSM (2.6.3항) — SETUP 올리는 중 / READY 올린 채 대기 / DROPPING 투입 중 / LOWERING 내리는 중
  actionState: 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_READY' | 'FLOWER_DROPPING' | 'FLOWER_LOWERING';
  stateTimer: number;
  isBraking: boolean; // Stationary Lock 액션 진입 후 완전 정지 대기 중인지 여부
  intakeContactTimer: number; // 유효 흡입 영역 내 기물 접촉 유지 시간 누적치 (초 단위)
  intakeTargetPieceId: string | null; // 현재 접촉 흡입 중인 기물 식별자
  controlledPieces: GamePiece[]; // FIFO 적재함 (0번이 다음에 나감), 최대 길이 = 로봇 적재 한도
}

// 틱별 행동 요청 (입력 계층 → 엔진, 3.6항, 엔진 입력 RobotDriveInput.actionState의 타입)
// FLOWER_READY / FLOWER_LOWERING은 엔진 상태이며 요청 값이 아님
export type ActionRequest = 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_DROPPING';

// 슈팅 판정 인터페이스 (엔진 생성자 필수 인자: 실제 경기는 LUT 기반, 테스트는 고정 확률)
export type ShotProbabilityResolver = (
  robotId: 'robot1' | 'robot2',
  pieceType: 'POLLEN' | 'NECTAR', // 발사 기물 종류 (종류별 LUT 선택)
  robotX: number,
  robotY: number,
  heading: number,
  alliance: 'RED' | 'BLUE',
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL') => number; // 0.0 ~ 1.0 반환

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
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  nectarInUpwardCell: number; // 상향 셀 NECTAR 수
  pollenInUpwardCell: number; // 상향 셀 POLLEN 수
  isTipping: boolean;
  tipCount: number; // TELEOP 중 TIP 횟수 (회당 20점)
  autoTipCount: number; // 오토 중 TIP 횟수 (ScenarioConfig, RP 판정에만 합산)
  tipProgressTimer: number; // 전복 시작 후 누적 경과 시간 (초 단위)
  pendingDrops: PendingDrop[];
}

// 5. 필드 통합 상태 및 RP
// 충돌 후 자유 비행 구간 (2.6.2항). 시각은 발사 후 초, τ = t − t0
// BALLISTIC: (x, y, z) + (vx, vy, vz)·τ, z에서 g·τ²/2 차감 / ROLL: HIVE 윗면 위 수평 등속 (z 일정)
export interface FlightSegment {
  kind: 'BALLISTIC' | 'ROLL';
  t0: number; t1: number;
  x: number; y: number; z: number;   // 구간 시작 위치
  vx: number; vy: number; vz: number; // 구간 시작 속도
}

// 발사 비행 대기열 (결과 / 궤도는 발사 시점에 확정, 도착 틱에 반영). 명목 구간(from → to) 뒤에 충돌 후 구간이 이어짐
export interface PendingShot {
  pieceId: string;
  pieceType: 'POLLEN' | 'NECTAR';
  robotId: 'robot1' | 'robot2';
  result: 'HIT' | 'MISS_HIVE' | 'MISS_FLOOR'; // 명중이 도착 시 무효가 되면 MISS_HIVE로 바뀜
  targetCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'; // 발사 시점 상향 셀
  launchTick: number;
  arriveTick: number; // HIT: 조준점 도착 틱 / 그 외: 최종 착지 틱
  contactTime: number; // 명목 구간 끝 (발사 후 초)
  fromX: number; fromY: number; fromZ: number; // 발사구
  toX: number; toY: number; toZ: number; // 명목 구간 끝: 조준점 / HIVE 첫 접촉점 / 벽 접촉점 / 바닥 착지점
  heading: number; v0: number; pitch: number; // 명목 궤적 (렌더러 높이 연출)
  segments: FlightSegment[]; // 충돌 후 구간 (빈 배열 = 명목 구간 끝이 착지점 또는 명중)
  landX: number; landY: number; // 최종 착지점
  landingVx: number; landingVy: number; // 착지 직후 속도 (수평 속도 × landingSpeedRetention, 벽 정지 0)
  bounceRestitutionRoll: number; bounceAngleRoll: number; // 반사 세기 / 방향 산포 난수 [0, 1) (발사 시점 소비)
}

export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number; // 5개로 시작 (휴먼 플레이어가 아직 투입 결정하지 않은 재고)
  pendingHumanNectar: number; // 투입이 결정됐으나 로딩 존 빈 자리를 기다리는 NECTAR 수 (자리가 나면 즉시 배치)
  pendingShots: PendingShot[]; // 비행 중인 발사 (발사 순서)
}

export interface RPState {
  swarm: boolean;
  pollinator1: boolean;
  pollinator2: boolean;
}

// 경기 종료(6000틱) 득점 내역 (3.2항). hive + flower + garden + park = totalScore
export interface ScoreBreakdown {
  hive: number;   // TELEOP TIP × 20
  flower: number; // 득점 FLOWER의 (slot[1..N] 기물 수 × 2 + 하단 보너스 5) 합
  garden: number; // 아군 GARDEN 인정 기물 수 × 1
  park: number;   // 주차 인정 로봇 수 × 5
  // FLOWER별 (FLOWER_IDS 순서): scoringPieces = slot[1..N] 기물 수 (소유 여부와 무관), owned = 아군 NECTAR 존재, points = 그 FLOWER 점수
  flowers: { id: string; scoringPieces: number; owned: boolean; points: number }[];
  gardenPieceIds: string[];               // 득점 인정 GARDEN 기물 id
  parkedRobots: ('robot1' | 'robot2')[];  // 주차 인정 로봇
}

// 엔진이 공개하는 기록은 DeepReadonly<T>로 감싸 읽기 전용 (3.2항)

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
  scoreBreakdown: ScoreBreakdown | null; // 종료 프레임(6000틱)만 기록, 그 외 null
}
```

## 5. 개발 현황과 향후 과제

개발 규칙(작은 단계로 구현, 검증 명령, 테스트 갱신, `ENGINE_VERSION` 올리기)은 [CLAUDE.md](CLAUDE.md)를 따른다. 단계별 상세 기록은 git 커밋 이력에 있다.

### 5.1 개발 단계 (v1.0.0까지 완료)

| Step | 내용 | 주요 위치 |
|---|---|---|
| 01 ~ 02 | 프로젝트 세팅(Vite + React + TS), 타입 정의, 룰북 좌표계와 필드 | `src/core/types.ts` |
| 03 ~ 04 | 기구학(Slew Rate 가감속), 충돌 엔진(SAT, 기물 동역학, PBD, HIVE 시차 낙하 계획) | `kinematics.ts`, `collision.ts` |
| 05 | 50 Hz 결정론적 엔진과 게임 규칙 전반, Vitest 회귀 테스트 | `simulationEngine.ts` |
| 06 | 탄도 모델: v0 탐색, 몬테카를로 명중 판정, LUT 생성 / 4셀 대칭, 명중 판정 함수, 발사 비행 | `ballistics.ts` |
| 07 | 입력 계층: 리프트 FSM, 입력 변환 / 양자화, 입력 기록 / 녹화 덧입히기, 실시간 루프, 브라우저 어댑터 | `src/input/` |
| 08 | 렌더러: 보기 회전, 로봇 / 기물 / HIVE / 게이지, 비행 공, 표시 옵션, 종료 득점 내역 | `src/renderer/` |
| 09 | 웹 GUI: LUT Worker 풀 / IndexedDB 캐시, 배치 검증, 앱 컨트롤러, 메인 화면, 경기 흐름, config 창(로봇 / 시나리오 / SETTINGS), 필드 편집 모드, 결과 팝업 | `src/workers/`, `src/app/`, `src/ui/`, `src/components/` |
| 10 | 분기 트리, 경기 파일(레시피) 불러오기 / 내보내기, 프리셋 파일 | `branchTree.ts`, `matchRecipe.ts`, `presetFile.ts` |
| v1.0.0 | 라이선스, 서드파티 고지, README(영 / 한), 앱 안 도움말, 버그 리포트 | `LICENSE`, `README.md`, `HelpDialog.tsx` |

### 5.2 업데이트 예정 목록

v1.0.0 이후 구현하기로 정한 항목이다. 구현 순서는 정하지 않았다. 설계가 확정된 항목은 5.4항에 따로 적는다.

**구분 기준과 버전 번호**

- **파괴적 업데이트:** 아래 중 하나라도 해당하는 변경. 사용자에게 저장 파일 호환 경고, 확률표 재생성, 이전 파일 거부 같은 비용이 생기므로 **전부 v2.0.0 한 번에** 낸다.
    - `ENGINE_VERSION` / `BALLISTICS_MODEL_VERSION` / `RECIPE_VERSION` / `PRESET_VERSION` / `SETTINGS_VERSION`(3.9항, 3.8항)을 올리는 변경.
    - 저장 파일의 로봇 제원(`RobotConfig`) / 시나리오(`ScenarioConfig`) 항목을 늘리는 변경 (경기 파일 해석이 엄격해 이전 파일이 거부되거나, 이전 앱이 새 항목을 조용히 버려 다른 경기가 나옴, 3.9항).
- **비파괴 업데이트:** 위에 해당하지 않는 변경(화면, 렌더러, 새 저장소, 개발 도구). 큰 버전과 무관하게 완성되는 대로 낸다. 번호는 v2.0.0 전이면 `1.x.0`, 후면 `2.x.0` (기능 추가 = 두 번째 자리, 버그 수정 = 세 번째 자리). 비파괴 업데이트는 위 버전 상수를 바꾸지 않는다 — 바꿔야 한다면 파괴적 항목으로 옮긴다.
- 난이도는 v1 개발 기준의 상대 평가(하 / 중)다. 난이도 상으로 판단한 항목은 넣지 않는다 (5.3항).

#### v2.0.0 (파괴적)

| 항목 | 난이도 | 내용 |
|---|---|---|
| HIVE 터널 | 중 | 로봇 / 바닥 공이 HIVE 아래(y 방향)로 지나간다. 설계 확정 (5.4항) |
| 물리 계수 실측 보정 | 하 (코드) | FLOWER 용량 테이블, HIVE TIP 임계 테이블, TIP 낙하 분포, 착지 속도 유지 비율(`landingSpeedRetention`, 실측 방법 2.5항), 슈터 편차 기본값(실측 명중률로 보정), HIVE 충돌 후 낙하 파라미터(반발 계수, 산포 세기 ±20% / 방향 ±15°, 윗면 최대 튐 3회, 최소 이탈 속도 20 in/s)를 실측값으로 교체. 일의 대부분은 측정이다. 테이블을 바꾸면 시나리오 검증 기준이 바뀌어 기존 시나리오가 무효가 될 수 있다. v2.0.0 이후 실측값을 바꾸면 다시 파괴적 업데이트가 된다 |
| 바닥 기물 직접 배치 | 중 | v1은 무작위 산포 (2.4항). `ScenarioConfig` 선택 항목으로 기물 위치를 지정한다. 터널 바닥에는 놓을 수 있고 기둥에는 놓을 수 없다 (5.4항). 엔진 쪽은 작고 편집 화면(시작 자세 편집 모드 참고)이 대부분이다. 편집 화면 설계는 미정 |
| 미종료 가지 / 트리 전체 저장 | 중 | v1 경기 파일은 끝난 가지 하나만 저장한다 (3.9항). 가지마다 {부모, 분기 틱, 이름, 분기 이후 적용 입력 기록, 체크섬}을 저장해 트리 전체와 미종료 가지를 내보내고 불러온다 (`RECIPE_VERSION` 2). v1 경기 파일(가지 하나)도 계속 불러온다. 불러올 가지 수가 그 앱의 가지 상한을 넘으면 거부한다 |
| 리프트 상태 주행 | 중 | v1은 리프트 상태 전체를 Stationary Lock으로 둔다 (3.4항). `RobotConfig` 옵션(리프트 중 최고 속도, 0 = 잠금 = v1 동작)을 추가한다. 제동 / 타이머 규칙, 투입 중 이동 시 투입 조건 재확인, "리프트를 내려야 이동" 토스트(3.8항)를 옵션에 따라 띄우기를 함께 정한다. 실제 로봇이 리프트를 올린 채 움직이는지 자료 확인이 필요하다 |
| FLOWER 투입 방향 구역 | 하~중 | v1은 방향 무관(도달 거리 1.0 in, 2.6.3항). `RobotConfig.flowerDropZones`(인테이크 구역과 같은 `BumperZone[]`, 빈 배열 = 방향 무관 = v1 동작)를 추가한다. 엔진은 대상 판정 함수(`findDropTargetFlower`)만 교체하고, 편집 화면은 흡입 구역 편집기를 재사용한다 |
| 필드 벽 반사 | 중 | v1은 공중에서 벽에 닿은 공을 높이 무한 · 반발 0 벽으로 본다 (2.6.2항). 반발 계수 > 0 반사로 바꾸고(비행 구간 구조는 그대로), 반사 뒤 HIVE나 반대쪽 벽에 다시 닿는 경우를 처리한다. 벽을 넘어 필드 밖으로 나가는 공은 계속 구현하지 않는다 |
| 착지 겹침 보정 | 하 | v1은 HIVE TIP 낙하 / 발사 비행의 착지 지점이 그 사이 움직인 로봇이나 기물 위일 수 있다 (다음 틱 충돌 처리로 밀려남). 착지 틱에 겹치면 가까운 빈 자리로 결정론적으로 옮긴다. 비행 중 충돌은 넣지 않는다 (5.3항) |

- **버전:** `ENGINE_VERSION` 1 → 2, `RECIPE_VERSION` 1 → 2, `PRESET_VERSION` 1 → 2를 각각 한 번만 올린다. `BALLISTICS_MODEL_VERSION`은 올리지 않는다 (명중 판정 / LUT 규칙을 바꾸지 않아 사용자의 확률표 캐시가 그대로 쓰이게).
- **v1 파일 호환:** 로봇 제원 항목이 늘어나므로(리프트 상태 주행, FLOWER 투입 방향 구역) 경기 파일 엄격 해석(3.9항)이 v1 파일을 거부하지 않도록, 파일 버전에 따라 "없는 새 항목 = v1 동작 값"으로 채우는 변환을 함께 넣는다. v1 경기 파일은 기존 흐름대로 "엔진 버전 다름" 경고 + 체크섬 불일치 배너와 함께 열린다. 프리셋은 원래 없는 항목을 기본값으로 채운다.
- **설정 자동 보관:** 저장된 로봇 프로필 / 시나리오는 없는 항목을 기본값으로 채우므로(`mergeWithDefaults`, 3.8항) `SETTINGS_VERSION`은 올리지 않는다 (올리면 사용자 설정이 전부 기본값으로 돌아감).

#### 비파괴 — v2.0.0과 무관 (언제든)

| 항목 | 난이도 | 내용 |
|---|---|---|
| 결과 팝업 가지 비교 줄에서 바로 전환 | 하 | v1은 표시만 한다 (3.9항). 가지 목록의 전환을 그대로 연결한다 |
| 가지 프레임 해제 + 가지 상한 상향 | 중 | v1은 모든 가지의 프레임을 메모리에 둔다 (8개 약 188 MB, 3.9항). 지금 가지 외 프레임을 해제하고 선택할 때 적용 입력 기록으로 다시 계산(≤ 1.5초)한 뒤 `MAX_BRANCHES`를 올린다. 새 상한 값은 메모리 / 재계산 시간을 재서 정한다 |
| 복기 중 로봇 동선 표시 | 하 | 저장된 프레임에서 틱 구간의 로봇 위치를 선으로 그려 동선 회의에 활용한다 (표시 옵션 추가, 설정은 항목별 기본값이라 버전 불변). v2.0.0보다 먼저 하면 터널 지붕(5.4항)과의 그리는 순서를 v2.0.0에서 함께 정리한다 |
| 게임패드 매핑 편집 화면 | 중 | v1은 `inputConfig.ts` 고정 매핑 (3.6항). 매핑을 설정 항목(항목별 기본값)으로 옮기고 "버튼을 눌러 지정" 화면을 둔다. 입력 기록은 필드 좌표로 저장되므로 재생과 무관하다 |
| 렌더링 프레임 보간 | 중-하 | v1은 최신 틱 프레임만 그린다 (3.7항). 실시간 루프 `onFrame`에 누산기 잔여 비율(alpha)을 넘겨 직전 / 현재 프레임을 보간한다 (화면이 최대 1틱 20 ms 늦게 보임). 기물 상태가 바뀌는 틱(흡입, 착지 등)은 보간하지 않는다. 60 / 144 Hz 모니터에서 같은 틱이 불규칙하게 두 번 보이는 끊김(60 Hz에서는 6프레임마다 한 번)이 없어진다 |
| 조준 오차에 따른 비행 연출 | 하 | 고정형 슈터가 허용 오차 안에서 비스듬히 쏜 명중도 조준점으로 도착 처리하므로(LUT 결과 우선) 연출상 지면 직선과 조준점 사이가 최대 약 ±3° 어긋난다. 렌더러의 비행 보간만 고친다 (엔진 기록 불변) |
| 브라우저 자동 테스트 편입 | 중 | v1은 순수 함수 Vitest + 저장소 밖 일회성 헤드리스 Chromium 점검이다 (3.7항). Vitest 브라우저 모드로 화면 상호작용 테스트를 넣는다 (스크린샷 비교는 하지 않음). 개발 도구라 사용자 업데이트가 아니다. v2.0.0의 화면 변경(터널 지붕 등) 전에 갖추기를 권장 |

#### 비파괴 — v2.0.0 이후 (의존)

| 항목 | 난이도 | 의존하는 이유와 내용 |
|---|---|---|
| 경기 자동 저장 / 복구 | 하~중 | v1은 새로고침 / 크래시 때 경기가 사라진다 (3.6항). 자동 저장은 대부분 **끝나지 않은 경기**를 저장해야 하므로 v2.0.0의 미종료 가지 / 트리 형식 위에 만든다 (먼저 만들면 임시 형식을 하나 더 만들고 버리게 됨). 복구는 경기 불러오기 흐름(확률표 준비 → 재계산, 3.9항)을 재사용한다 |
| 브라우저 안 경기 / 프리셋 목록 | 중 | v1은 파일 다운로드 / 불러오기만 (3.9항). IndexedDB에 이름 붙인 목록을 둔다 (저장소 기반은 확률표 캐시에 이미 있음, 일의 대부분은 목록 화면). 저장하는 경기 / 프리셋 형식이 v2.0.0에서 바뀌므로 그 뒤에 만든다 (먼저 만들면 저장된 v1 형식 항목의 변환이 필요) |

### 5.3 하지 않는 것

- **상대 로봇과 오토 구간 시뮬레이션:** 2 v 0 TELEOP 전용이다. 오토 결과는 시나리오로 넣는다 (2.4항).
- **모바일 화면:** 데스크톱 / 노트북 전용 (3.8항).
- **저정밀 LUT 미리보기:** 샘플을 줄인 빠른 LUT를 먼저 보여 주고 정밀본으로 바꾸는 방식은 쓰지 않는다. 미리보기로 경기를 돌리면 경기 파일 재현 결과가 달라져 결정론이 깨지고, 표시용으로만 써도 정밀본과 달라 보여 혼란스럽다. 대신 정밀본을 행 단위로 점진 표시한다 (2.6.2항).
- **3D 보기:** 드라이버 감각 연습에는 3D 시점이 유리하다는 의견이 있었으나 범위 밖이다.
- **주행 중 발사:** 발사는 지금처럼 Stationary Lock(3.4항)으로 멈춘 뒤에만 한다. 명중 확률표(LUT)가 "그 자리에서 멈춰 조준한다"는 전제로 만들어지므로 주행 중 발사를 넣으려면 탄도 모델을 새로 만들어야 하고, 이를 주 전술로 쓰는 팀은 매우 드물어 비용에 비해 얻는 것이 적다.
- **HIVE 위에 걸려 멈추는 공:** HIVE 윗부분의 실제 형상과 공이 그 위에 걸려 멈추는 경우는 모델링하지 않는다 (2.6.2항 윗면 반복 튐 근사 유지). 새 기물 상태와 형상 모델이 필요해 비용이 크고 전술 영향은 작다.
- **비행 중 로봇 / FLOWER 충돌:** 발사 비행은 결과와 궤도를 발사 시점에 확정하는데(2.6.2항), 비행 중 로봇 충돌을 넣으려면 발사 시점에 알 수 없는 로봇의 미래 위치가 필요해 설계와 맞지 않는다. 착지 지점의 겹침만 보정한다 (5.2항 착지 겹침 보정).
- **교차 브라우저 결정론:** `Math.sin/cos/hypot` 등 초월함수 결과가 JS 엔진마다 최하위 비트에서 다를 수 있어, 다른 브라우저 간 재현은 비트 단위 동일성이 보장되지 않는다. 맞추려면 엔진과 확률표 생성의 수학 함수를 자체 구현해야 하고 `BALLISTICS_MODEL_VERSION`까지 올라가므로 하지 않는다. 체크섬 체크포인트로 불일치 구간을 경고만 한다 (3.9항, 현재 동작).

### 5.4 확정 설계 (미구현)

5.2항 업데이트 예정 항목 중 설계까지 확정한 내용이다. 아직 코드에 없으며, 구현되면 해당 절(2.2, 2.6.2, 3.3, 3.4, 3.7, 3.8 등)로 옮기고 여기서 지운다.

#### HIVE 터널

**배경:** 실제 HIVE는 A자 프레임 2개 + 꼭대기 가로대 구조라 로봇이 셀 아래로 지나다닌다 (사용자 피드백, 룰북 Figure 9-7 ~ 9-10). v1은 HIVE 프레임 AABB 전체를 하나의 직육면체 기둥으로 막는다.

**기하:**

- x 양 끝의 A자 프레임은 안쪽으로 기울어 있어, y 방향으로 본 단면(x–z)이 등변사다리꼴이다: 아랫변 49.46 in(Frame Width), 윗변 25.5 in(Figure 9-10의 HIVE Center to Center 값을 윗변으로 사용), 높이 43.95 in(Pivot Height).
- x 양 끝의 어두운 바닥 막대(A자 프레임 바닥, y 방향)는 지나갈 수 없다. 밝은 막대(Under TILE Strip, x 방향)는 매트 아래에 깔려 간섭이 없다. → **y축에 평행한 방향으로만 통과**한다.
- **통과 기준 = 18 × 18 × 18 in 정육면체** (FTC 로봇 최대 크기). 수직 벽을 가진 상자의 윗면 꼭짓점은 바닥 면적 가장자리 바로 위에 있으므로, "바닥 면적이 높이 18 in에서의 사다리꼴 폭 안에 있다"는 로봇 헤딩(대각선 진입 포함)과 무관하게 정확한 조건이다. 로봇 가로폭은 영향이 없고 높이만 영향을 준다.
    - 높이 18 in에서의 폭 = 49.46 − 18 × (49.46 − 25.5) / 43.95 ≈ **39.647 in**.
    - 윗변 값의 민감도는 18 / 43.95 ≈ 0.41배 (윗변이 2 in 달라도 터널 폭은 약 0.8 in 차이).
    - 18 in보다 낮은 로봇은 실제로 더 넓게 지나갈 수 있지만 18 in 고정으로 단순화한다 (보수적).
- **위쪽 간섭 없음:** 셀 바닥 25.5 in(Bottom of HIVE) > 18 in. 시소 구조라 TIP으로 셀이 도는 중에도 가장 낮은 점은 양 끝 자세(25.5 in)다. 리프트 상태는 FLOWER 근처에서만 들어가는 Stationary Lock이라 HIVE와 엮이지 않는다.
- **다리 두께 여유 `HIVE_TUNNEL_LEG_MARGIN` = 한쪽 1.0 in.** 위 치수는 바깥 치수라 다리 두께를 보수적으로 뺀다. 벽 두께가 조금 달라지는 정도라 사용성에 영향이 없으므로 **실측 갱신은 하지 않는 고정값**이다 (바꾸면 `ENGINE_VERSION`을 다시 올려야 함).
    - 터널 폭 = 39.647 − 2 × 1.0 = **37.647 in** → 18 in 로봇 2대(36 in)가 나란히 지나갈 수 있다. 한쪽 여유가 1.82 in 이상이면 나란히 통과가 불가능해지는 경계이므로 이 값을 넘기지 않는다.
- **좌표** (y는 모두 HIVE 깊이 전체 52.525 ~ 91.475):

    | 영역 | x 범위 | 폭 |
    |---|---|---|
    | 왼쪽 기둥 | 47.27 ~ 53.176 | 5.906 |
    | 터널 | 53.176 ~ 90.824 | 37.647 |
    | 오른쪽 기둥 | 90.824 ~ 96.73 | 5.906 |

- **상수 (`collision.ts`, 이름은 구현 때 확정):** 기존 `HIVE_AABB`는 HIVE 전체 바닥 면적으로 그대로 두고, 기둥 2개(`HIVE_PILLARS`)와 터널(`HIVE_TUNNEL`) AABB를 위 사다리꼴 / 여유 상수에서 계산해 추가한다.

**대상별 HIVE 모양:**

| 대상 | 쓰는 모양 | 비고 |
|---|---|---|
| 로봇-환경 충돌 (3.3항) | 기둥 2개 | |
| 바닥 공 충돌 (`ON_FIELD`, 3.3항 공 vs 정적 장애물) | 기둥 2개 | 실제 바닥에서 공을 막는 것은 어두운 막대뿐이지만 "화면의 기둥 = 바닥의 모든 것에 대한 벽"으로 통일한다. 끼인 공 역보정(3.3항)도 기둥을 정적 장애물로 본다. 구르는 공은 터널로 지나간다 |
| 비행 공 (`intersectHiveBox`, 충돌 후 낙하, 착지 안전장치, 2.6.2항) | HIVE 직육면체 그대로 | 공중의 공은 HIVE에 맞으면 튕긴다 |
| TIP 낙하 데드존 (2.6.1항), 바닥 무작위 산포 (2.4항) | HIVE 전체 바닥 면적 제외 그대로 | 난수 사용 순서 유지 |
| 바닥 기물 직접 배치 (v2.0.0) | 기둥만 금지 | 터널 바닥 허용 |
| 시작 자세 배치 검증 (`validateRobotPlacement`) / `reset()` 사전 보정 (3.8항) | 기둥 2개 | `PLACEMENT_IN_HIVE` = 기둥과 겹침 (코드 이름 유지, 문구는 "HIVE 기둥과 겹침"). 터널 안 시작 자세 허용 |
| 스윗스팟 검증 (`SWEET_SPOT_IN_HIVE`) / LUT 0 격자 (2.6.2항) | HIVE 전체 바닥 면적 그대로 | HIVE 아래에서는 쏠 수 없다는 뜻. `BALLISTICS_MODEL_VERSION` 유지 |
| `IN_HIVE` 기물 좌표 (조준점 바닥 투영) | 그대로 | 좌표가 터널 영역 안이지만 물리 / 충돌 대상이 아니다 |

**터널 안 발사 금지:**

- **판정:** 실제 로봇 몸체 OBB(현재 헤딩)가 HIVE 전체 바닥 면적(`HIVE_AABB`)과 깊이 `HIVE_SHOOT_TOLERANCE`(0.01 in)를 넘게 겹치면 "터널 안"이다. 기둥이 막고 있으므로 HIVE 면적과 겹친다 = 터널 안이다. 허용 오차는 기둥 앞면에 밀착해 멈춘 로봇의 부동소수점 잔차로 HIVE 바로 앞 발사가 막히지 않게 하기 위함이다.
- **요청 시:** `IDLE` / `INTAKING`에서 `SHOOTING` 요청을 받지 않는다. 빈 적재함 발사, 닿지 않는 FLOWER로의 리프트 올림과 같은 **조용한 무시**이며 토스트는 없다 (행동 배지가 뜨지 않는 것이 곧 피드백). 무시된 요청은 기존 규칙대로 `IDLE` / `INTAKING` 판정으로 넘어가므로 LT + RT를 함께 쥐면 흡입도 멈춘다 — 3.6항의 "빈 적재함에서 LT + RT" 동작과 같아 일관성을 위해 그대로 둔다.
- **발사 직전 재확인:** 요청을 받은 뒤 제동하는 동안 미끄러져 터널에 들어갈 수 있다 (예: 60 in/s, 감속도 60 in/s²면 약 30 in). FLOWER 투입이 완료 시점에 조건을 다시 보는 것처럼, 발사 완료 틱에 다시 판정해 터널 안이면 **쏘지 않고 기물을 적재함에 둔 채 `IDLE`** 로 돌아간다. 연속 발사도 발사마다 같은 판정을 한다.
- **난수:** 발사 판정 난수 3회(2.6.2항)는 실제로 발사할 때만 쓰므로, 거부 / 취소는 난수를 쓰지 않는다.
- **이유:** 명중 확률은 이미 0(LUT)이지만, 발사구가 HIVE 직육면체 안이면 빗맞음 비행이 거리 0에서 옆면 충돌로 처리되고 착지점이 HIVE 밖으로 밀려 순간이동처럼 보인다.

**렌더링 (터널 지붕):**

- **그리는 순서:** HIVE 바탕 + 셀 상태 그림을 터널 경계 x로 나눈다. 기둥 부분은 지금처럼 바닥 기물 아래에서 늘 불투명하게, 터널 부분(**터널 지붕**)은 로봇 위에서 지붕 불투명도로 그린다.
    - 순서: 정적 레이어(기둥 부분) → 셀 상태(기둥 부분) → 바닥 기물 → 로봇(조준선 / 흡입 구역 / 흡입 진행 포함) → **터널 지붕** → TIP 낙하 연출 · 비행 공 → 화면 공간(셀 내용 / 알약, 로봇 번호, 행동 배지).
    - 지붕 그림은 정적이므로 따로 오프스크린에 캐시하고 불투명도만 적용해 복사한다.
- **지붕 불투명도 (프레임만의 순수 함수):**
    - t = max(로봇별 "몸체 OBB와 터널 AABB가 겹친 넓이 / 몸체 넓이", 바닥 기물별 "기물 원과 터널 AABB가 겹친 넓이 / 원 넓이").
    - 바닥 기물 = 렌더러가 바닥에 그리는 기물(`ON_FIELD`, `IN_GARDEN` — 후자는 위치상 터널에 있을 수 없지만 바닥 그리기와 같은 기준으로 둔다). `IN_HIVE` / `CONTROLLED` / `IN_FLIGHT` 등은 좌표가 터널 안이어도 제외한다 (특히 `IN_HIVE` 좌표는 조준점 바닥 투영이라 항상 터널 안).
    - 불투명도 = 1 − t × (1 − `ROOF_MIN_OPACITY`), **`ROOF_MIN_OPACITY` = 0.4** (임시값, 화면을 보며 조정). 터널에 아무것도 없으면 t = 0 → v1과 같은 불투명.
    - 겹친 비율로 연속적으로 바뀌므로 로봇이 입구를 오가거나 공이 굴러 들어올 때 깜빡이지 않는다. 벽시계 애니메이션이 없어 스크러빙 / 재생 / 분기에서 같은 틱은 같은 그림이다.
- **셀 내용(기물 줄 / 알약)은 지붕과 함께 흐리게 하지 않는다.** 선명한 셀 안 기물과 지붕 아래 흐린 바닥 기물의 차이로 위아래가 구분된다.
- **터널 안 로봇 윤곽선을 지붕 위에 다시 그리지 않는다** (터널 안에 있다는 인상을 흐림). 로봇 번호 / 행동 배지는 화면 공간 라벨이라 지금처럼 맨 위에 그린다.
- **기둥 표시:** 지붕이 불투명할 때도 터널 경계를 알 수 있게 하되, v1의 셀 모양을 크게 바꾸지 않는다. 셀 상자(RED x 48.07 ~ 70.43, BLUE 대칭)가 터널 경계를 가로지르므로 다음 중 화면 확인으로 고른다.
    - 기본안: 터널 경계 x(53.176 / 90.824)에 얇고 흐린 점선(HIVE 틀 테두리색).
    - 대안: 기둥 영역에 HIVE 틀 색을 반투명하게 덧칠.
- **편집 장면:** 시작 자세 편집 장면(3.8항)도 같은 지붕 규칙을 쓴다 (터널 안에 시작 자세를 둘 수 있음). 히트맵 / 스윗스팟 장면은 로봇 · 기물이 없어 지붕이 불투명하다 (스윗스팟 몸체는 HIVE 면적과 겹칠 수 없음).

**영향과 검증:**

- v2.0.0 (파괴적, 5.2항): `ENGINE_VERSION` 2 (v2.0.0에서 한 번), `engineVersion.test.ts` 기대값 갱신. 명세 2.2 / 2.6.2 / 3.3 / 3.4 / 3.7 / 3.8 / 4장 갱신.
- 테스트 그룹:
    - 기하: 사다리꼴 / 여유 상수에서 계산한 터널 · 기둥 좌표, 18 in 로봇 2대 나란히 통과 가능.
    - 충돌: y 방향 터널 통과 / x 방향 기둥에 막힘 / 기둥 앞면 밀착, 바닥 공 터널 통과, 비행 공 HIVE 반사 유지, 공이 로봇과 기둥 사이에 끼면 로봇 정지.
    - 배치 검증: 터널 안 시작 자세 허용, 기둥 겹침 거부.
    - 발사: 터널 안 요청 무시, 제동 중 터널 진입 시 발사 취소(기물 유지, `IDLE`), 거부 / 취소 시 난수 미사용, 기둥 앞 밀착 발사 허용.
    - 렌더러: 지붕 불투명도 순수 함수(로봇 / 기물 겹친 비율, 최댓값, `IN_HIVE` 제외, 빈 터널 = 1).
