# FTC TacticSim Specification

# [프로젝트 명세서] FTC BioBuzz 2D 텔레옵(Teleop) 전술 시뮬레이터

## 1. 프로젝트 개요 (Overview)

- **목적:** 로봇 공학 대회(FIRST Tech Challenge - BioBuzz)의 TELEOP(텔레옵, 드라이버 조작 구간 120초)동안, 같은 동맹(Alliance) 소속인 2대의 로봇이 어떻게 동선을 짜고 점수를 낼지 시뮬레이션하고 복기하는 웹 기반 2D 시뮬레이터.
- **주요 특징:**
    - 상대팀 로봇은 존재하지 않는 **2 v 0 (내 동맹 로봇 2대만 존재)** 시뮬레이션.
    - 무거운 3D 물리엔진을 배제하고, 수학적 기구학(Kinematics)과 분리축 이론(SAT) 기반 충돌 처리만 사용하여 프레임 드랍이나 오차 없는 **100% 결정론적(Deterministic)** 작동 보장.
    - 모든 틱(Tick)의 상태를 배열에 저장하여, 비디오 편집기처럼 뒤로 가기/앞으로 가기(Scrubbing) 지원.

## 2. 게임 룰 & 환경 설정 (Game Rules & Environment)

### 2.1 경기장 및 시간 (Field & Time)

- **크기:** 144 x 144 인치. (Canvas 렌더링 시 1인치 = 5px로 환산하여 720x720px로 출력)
- **좌표계:** 좌측 상단을 (0, 0), 우측 하단을 (144, 144)로 하는 Canvas 2D 표준 좌표계를 사용. (Y=144 방향이 Audience Side)
- **시간:** 총 120초 (6000 틱, 50Hz 기준, dt = 0.02초).
- **진영 선택:** 사용자가 Red 또는 Blue 진영을 선택하면 시뮬레이터는 선택된 진영을 ’아군’으로 간주하며, 상대 진영의 Nectar 등 불필요한 요소는 로직에서 배제됨.
- **엔드게임 (Endgame):** 남은 시간이 60초 이하가 되는 시점.

### 2.2 물리적 규격 및 정확한 좌표 (Physical Dimensions & Coordinates)

좌상단 (0,0) 좌표계를 기준으로 한 각 기물 및 구역의 정확한 위치는 다음과 같다.

1. **HIVE (벌집):**
    - **위치 및 전체 크기:** 경기장 정중앙 (72, 72)에 위치한 49.46 × 38.95 인치의 프레임.
    - **프레임 AABB 경계:** xMin = 47.27, xMax = 96.73, yMin = 52.525, yMax = 91.475.
    - **진영별 HIVE 중심 좌표:** Red HIVE 중심은 `(59.25, 72.0)`, Blue HIVE 중심은 `(84.75, 72.0)`.
    - **CELL 분할 구조:** 각 진영별 HIVE는 2개의 CELL(너비 20.0인치)로 분할된다. Y축을 기준으로 상단의 `OPPOSITE_CELL`(Y < 72)과 하단의 `AUDIENCE_CELL`(Y > 72)로 나뉘며 렌더링 시 시각적으로 명확히 구분한다.
    - **CELL 투입구 기하 (상향 셀, 바닥 z = 0, `collision.ts`의 `HIVE_RIM_Z` 등 상수):**
        - 투입구 표면은 밑변이 평평한 오각형: 너비 20 × 높이 7.61 직사각형 위에 밑변 20 · 높이 6.39 이등변 삼각형을 올린 형태 (전체 높이 14 in, 길이는 표면을 따라 잰 값).
        - 밑변 = 림(셀의 가장 바깥 끝): z = 53.5 (`HIVE_RIM_Z`), x 범위 = 진영 HIVE 중심 ± 10.
        - 표면은 림에서 HIVE 중심 방향으로 올라가며 **지면과 60°**(`HIVE_CELL_TILT`)를 이룬다 → 표면이 HIVE 바깥 위를 향하고, 바깥 법선은 수평에서 30° 위.
        - 표면 거리 s(림 기준)의 점: 수평 이동 s·cos60° (HIVE 중심 방향), 높이 z = 53.5 + s·sin60°.
        - **조준점**(`hiveCellAimPoint`) = 오각형 면적 중심, 림에서 표면 거리 5.560 in (수평 2.780, 수직 4.815).
        - 4개 셀은 오각형이 좌우 대칭이므로 x = 72 / y = 72 기준 대칭으로 정확히 옮겨진다:

          | 셀 | 림 x 범위 | 림 y | 어깨 y (s = 7.61, z = 60.09) | 꼭짓점 (x, y) (s = 14, z = 65.62) | 조준점 (x, y) (z = 58.32) | 바깥 법선 |
          |---|---|---|---|---|---|---|
          | RED_OPPOSITE | 49.25~69.25 | 52.74 | 56.545 | (59.25, 59.740) | (59.25, 55.520) | (0, −0.866, 0.5) |
          | RED_AUDIENCE | 49.25~69.25 | 91.26 | 87.455 | (59.25, 84.260) | (59.25, 88.480) | (0, +0.866, 0.5) |
          | BLUE_OPPOSITE | 74.75~94.75 | 52.74 | 56.545 | (84.75, 59.740) | (84.75, 55.520) | (0, −0.866, 0.5) |
          | BLUE_AUDIENCE | 74.75~94.75 | 91.26 | 87.455 | (84.75, 84.260) | (84.75, 88.480) | (0, +0.866, 0.5) |
        - 엔진은 HIVE 내부 기물(`IN_HIVE`)을 상향 셀 조준점의 바닥 정사영 좌표에 배치한다.
    - **비행 판정용 HIVE 직육면체 (`HIVE_HEIGHT`):** 실제 HIVE의 복잡한 구조는 무시하고, 밑면 = HIVE 프레임 AABB, 높이 = 상향 셀 오각형 꼭짓점 z(53.5 + 14·sin60° ≈ 65.62 in)인 직육면체로 근사한다. 빗맞은 공이 HIVE에 부딪히는지 넘어가는지 판정(2.6.2항 발사 비행 처리)과, 몬테카를로 명중 판정의 진입 면 조건(2.6.2항 ④: 셀 앞면(셀 폭 안) 또는 셀 위 윗면으로만 진입 허용)에 쓴다.
2. **FLOWER (솔리드 장애물):**
    - **크기:** 반지름 2.0인치의 단단한 원형 Bounding Box.
    - **중심 좌표:** Red 측: (2.0, 96.0), (48.0, 2.0) / Blue 측: (142.0, 48.0), (96.0, 142.0).
3. **GARDEN (통과 가능 구역, 23 × 2 인치):**
    - Red: 좌측 하단 (X: 0~23, Y: 142~144) / Blue: 우측 상단 (X: 121~144, Y: 0~2).
4. **LOADING ZONE (통과 가능 구역, 23 × 11 인치):**
    - Red: 좌측 중간 (X: 0~11, Y: 24~47) / Blue: 우측 중간 (X: 133~144, Y: 97~120).

### 2.3 로봇 기본값 및 스폰 위치 (Robot Spawn)

- **크기:** 가로 18 × 세로 18 인치.
- **초기 스폰 좌표 (타일 중앙 및 벽면 밀착):**
    - **Red 진영:** R1은 `(9.0, 36.0)`, R2는 `(9.0, 108.0)`. 헤딩은 `0` (오른쪽 방향).
    - **Blue 진영:** B1은 `(135.0, 36.0)`, B2는 `(135.0, 108.0)`. 헤딩은 `Math.PI` (왼쪽 방향).
    - (※ 로봇 시작 자세는 하드웨어 제원(`RobotConfig`)이 아닌 경기 시작 조건(`ScenarioConfig.r1Spawn` / `r2Spawn`)으로 지정하며, 미지정 시 선택된 진영의 위 기본 좌표가 자동 적용됨. 엔진은 이 표를 `DEFAULT_SPAWN_POSES`로 제공하여 UI 기본값으로 사용)

### 2.4 득점 기물 초기화 (Game Pieces Setup)

총 40개의 기물(Pollen 32개, Nectar 8개)을 초기화한다.

1. **POLLEN (직경 2.8인치, 구형):** 총 32개.
    - 로봇 적재 (8개): 내 동맹 로봇 2대에 각각 4개씩 적재 (`CONTROLLED`). 로봇별 적재 한도(`maxControlledPieces`)가 4보다 작으면 한도만큼만 적재.
    - FLOWER 내부 (16개): 4개의 FLOWER에 4개씩 배치 (`IN_FLOWER`).
    - GARDEN (8개): Red GARDEN 4개, Blue GARDEN 4개 배치 (`IN_GARDEN`).
2. **NECTAR (직경 3.6인치, 대형 구형/캡슐):** 아군 진영 색상 총 8개 (상대 진영 배제).
    - 필드에 풀린 NECTAR (3개, `NECTAR_IN_PLAY`): 경기 시작 시 아군 HIVE의 위를 향하고 있는(UP) CELL 내부에 배치 (`IN_HIVE`). 오토 이후에는 HIVE / 로봇 적재 / 바닥 중 어딘가에 있음.
    - 휴먼 플레이어 스톡 (5개): 필드 밖 대기 (`OUT_OF_BOUNDS`). HIVE 팁 시 1개씩 로딩 존에 스폰되며, 60초 돌입(ENDGAME) 시 잔여 재고 전량 로딩 존 스폰. 오토 중 발생한 팁 보상분은 텔레옵 시작 직전에 로딩 존으로 투입(아래 `autoTipCount`).
    - **휴먼 플레이어 NECTAR 투입 규칙:** 투입이 결정된 NECTAR는 재고(`nectarStock`)에서 투입 대기(`pendingHumanNectar`)로 옮겨지고, 아군 로딩 존의 빈 슬롯(기존 기물·로봇과 겹치지 않는 자리, 벽쪽 우선)에 정지 상태로 배치된다. 슬롯은 RED 로딩 존 기준으로 만들고 BLUE는 필드 중심 점대칭으로 변환하여 두 진영의 배치가 대칭이다. 로봇이 로딩 존을 막고 있어 빈 슬롯이 없으면 대기하다가 자리가 나는 틱에 즉시 배치된다 (기물을 로봇 몸체 안에 스폰하지 않음).
3. **텔레옵 시작 조건 및 자율주행(Autonomous) 시나리오 커스터마이징:**
    - 공식 경기 기본값(Default Setup):
        * HIVE 상향 셀: RED는 `AUDIENCE_CELL`, BLUE는 `OPPOSITE_CELL`
        * HIVE 내부 적재: 상향 셀에 NECTAR 3개
        * 로봇 적재물: R1, R2 각각 POLLEN 4개 (적재 한도가 4 미만이면 한도만큼)
        * FLOWER: 4개 플라워에 각각 POLLEN 4개씩 적재
        * GARDEN: 아군/상대 각각 POLLEN 4개
        * 오토 팁 횟수: 0 (로딩 존 투입 NECTAR 없음)
        * 바닥 무작위 산포: 없음 (위 배치로 32 / 8개가 모두 소진됨)
    - 커스텀 시나리오(`ScenarioConfig` 전달 시):
        * HIVE 상향 셀 방향(`hiveUpwardCell`) 및 내부 기물 수(Pollen/Nectar)를 사용자 정의값으로 덮어씀.
        * R1, R2의 적재물(`r1Loadout`, `r2Loadout`)을 **순서 있는 기물 종류 목록**으로 지정. 로봇 적재함은 FIFO(0번이 가장 먼저 발사/투입)이며, NECTAR 적재도 가능(오토 중 NECTAR를 흡입한 경우). 미지정 시 적재 한도만큼 POLLEN.
        * GARDEN 잔여 POLLEN 수(`gardenPiecesCount`: 아군/상대), FLOWER 잔여 POLLEN 수(`flowerPiecesCount`)를 지정 (오토 중 로봇이 건드린 결과 반영).
        * 오토 중 발생한 HIVE 팁 횟수(`autoTipCount`)를 지정하면 휴먼 플레이어가 텔레옵 시작 직전 그 수만큼 NECTAR를 재고에서 꺼내 로딩 존에 투입 (룰북 규정). 로딩 존 벽쪽 슬롯부터 결정론적으로 배치하며 무작위 산포보다 먼저 수행. 오토 팁 횟수는 POLLINATOR RP 팁 횟수에 합산됨(2.6.5항).
        * R1, R2의 시작 자세(`r1Spawn`, `r2Spawn`: 위치 x, y 및 헤딩)를 자율주행 종료 위치로 개별 지정 가능. 미지정 시 진영별 기본 스폰(2.3항) 적용.
        * **바닥 잔여 공은 자동 계산:** 위에서 지정되지 않은 나머지 기물은 모두 오토 중 바닥에 흩어진 공으로 간주하여, 정적 장애물(HIVE AABB, FLOWER 원통, 로봇 스폰 OBB), **양 진영 GARDEN과 로딩 존**, 이미 놓인 기물과 겹치지 않는 안전 데드존 회피 난수 알고리즘으로 필드 바닥(`state: 'ON_FIELD', vx: 0, vy: 0`)에 산포 스폰.
            - GARDEN 제외: 산포된 공이 GARDEN에 걸쳐 정지하면 `IN_GARDEN`으로 판정되어 시나리오에서 지정한 GARDEN 수량이 바뀌므로 제외. 로딩 존 제외: 휴먼 플레이어 NECTAR 슬롯과 주차 구역을 막지 않도록 제외. (v1은 바닥 공 직접 배치 GUI가 없으므로 이 규칙 유지)
            - 무작위 시도 200회가 모두 실패하면 HIVE 아래 필드 중앙 하단 기준점에서 3 in 간격으로 링을 넓혀 가며 첫 안전 좌표를 결정론적으로 탐색.
            - 바닥 POLLEN = 32 − (로봇 적재 POLLEN + FLOWER + HIVE POLLEN + GARDEN)
            - 바닥 NECTAR = 3(`NECTAR_IN_PLAY`) − (HIVE NECTAR + 로봇 적재 NECTAR). 남는 NECTAR는 휴먼 플레이어 재고로 돌아가지 않음.
            - 휴먼 플레이어 재고 = 5 − `autoTipCount`
            - (향후) GUI에서 바닥 잔여 공을 직접 배치하는 기능으로 무작위 산포를 대체 가능하게 확장 예정.
        * **배치 순서:** 로봇 적재물 → FLOWER → HIVE → GARDEN → 오토 팁 NECTAR(로딩 존) → 바닥 무작위 산포.
        * **시나리오 검증 (`validateScenario`, GUI 구현 시 필수 적용 메모):** 아래 중 하나라도 위반하면 GUI는 시나리오 설정 확정 버튼을 비활성화하여 입력을 막는다. 엔진은 GUI를 거치지 않은 값에 대비해 같은 규칙으로 잘라서 수용(안전장치)한다.
            - FLOWER별 POLLEN 수: 0 ~ 4 정수 (오토 중 FLOWER 투입은 룰상 불가하므로 초기값 4를 넘을 수 없음) — `FLOWER_COUNT`
            - GARDEN별 POLLEN 수: 0 ~ 8 정수 (GARDEN 23in / POLLEN 직경 2.8in 물리 한도) — `GARDEN_COUNT`
            - HIVE 상향 셀 {NECTAR, POLLEN}이 팁 임계 테이블(2.6.1항)에 도달하지 않아야 함 (도달 시 시작 전에 이미 전복된 불가능 상태), NECTAR ≤ 3 — `HIVE_OVER_THRESHOLD`, `HIVE_COUNT`
            - 로봇 적재물 길이 ≤ 해당 로봇 적재 한도 — `LOADOUT_OVER_CAPACITY`
            - `canIntakeNectar = false` 로봇의 적재물에 NECTAR 금지 — `LOADOUT_NECTAR_NOT_ALLOWED`
            - HIVE NECTAR + 로봇 적재 NECTAR ≤ 3 — `NECTAR_IN_PLAY_EXCEEDED`
            - 지정 POLLEN 합계(로봇 적재 + FLOWER + HIVE + GARDEN) ≤ 32 — `POLLEN_TOTAL_EXCEEDED`
            - `autoTipCount`: 0 ~ 5 정수 — `AUTO_TIP_COUNT`
        * 난수 시드(`rngSeed`)를 지정하면 잔여 공 산포, 슈팅 명중 판정, 빗맞음 방출, HIVE 낙하 분포가 모두 해당 시드로 재현됨. 미지정 시 엔진 기본 시드 사용.

### 2.5 기물 물리 상수 및 역학 (Physical Constants & Dynamics)

공의 물리 상수를 기물 타입별로 명확히 분리 정의한다 (`src/core/collision.ts`).

- **POLLEN:**
    - radius: 1.4 in (직경 2.8 in)
    - mass: 24.95 g (상대 질량비 1.0)
    - frictionDecel: 65.0 in/s² (EVA 폼 타일 쿨롱 감속도)
    - restitution: 0.35 (반발 계수 e)
- **NECTAR:**
    - radius: 1.8 in (직경 3.6 in)
    - mass: 41.28 g (상대 질량비 1.65)
    - frictionDecel: 85.0 in/s² (타일 침하 저항 감속도)
    - restitution: 0.25 (반발 계수 e)
- **정지 임계 속도:** `speed < 0.5 in/s` 도달 시 수치 진동 방지를 위해 `vx = 0, vy = 0`으로 강제 스냅.
- **중력 가속도 (`GRAVITY`):** 표준 중력 9.80665 m/s² 환산 ≈ 386.09 in/s². 발사 비행은 공기 저항과 공 회전을 무시한 진공 포물선으로 계산.
- **착지 속도 유지 비율 (`landingSpeedRetention`, 기물별, 기본 0.3 — 실측 전 임시값):**
    - 공기 저항을 무시하므로 비행 중 수평 속도는 v0·cosθ로 일정하다. 그러나 실제 공은 바닥(EVA 폼 타일)에 떨어질 때 여러 번 튀면서 에너지를 잃어, 굴러가기 시작하는 수평 속도가 v0·cosθ보다 훨씬 작다. 이 손실을 착지 순간 한 번에 반영하여, 빗맞음 바닥 착지 기물의 초기 속도 = 발사 방향 × v0·cosθ × `landingSpeedRetention`.
    - (보정 전 예) 발사각 45°, 거리 60 in, 발사구 높이 12 in이면 v0 ≈ 274 in/s, 수평 194 in/s → 손실 없이 굴리면 POLLEN 마찰 65 in/s²로 약 290 in를 굴러 필드를 가로지름.
    - **실측 방법:** ① 슈터를 고정하고 바닥을 향해(HIVE를 피해) 기물 종류별로 여러 번(예: 10회 이상) 발사하며 측면에서 고fps 영상 촬영. ② 발사구 → 첫 착지 지점의 수평 거리 ÷ 비행 시간(프레임 수 ÷ fps)으로 착지 직전 수평 속도 v_h 측정 (또는 v0·cosθ 계산값 사용). ③ 첫 착지 지점 → 최종 정지 지점의 거리 L 측정. ④ 착지 후 운동을 마찰 감속도 a(POLLEN 65, NECTAR 85 in/s²)의 등감속 구름으로 보면 굴러가기 시작한 속도 = √(2·a·L)이므로 `landingSpeedRetention = √(2·a·L) / v_h`. ⑤ 반복 측정 평균값을 사용. (마찰 감속도 자체도 실측으로 검증하면 더 정확함: 알려진 속도로 굴린 공의 정지 거리 측정)

### 2.6 득점 및 구조물 로직 (Scoring Mechanics)

1. **HIVE (벌집) 팁 및 시차 낙하 로직:**
    - **초기 상태:** Red는 `AUDIENCE_CELL`이 위(UP)를, Blue는 `OPPOSITE_CELL`이 위(UP)를 향하도록 고정 시작.
    - **팁 임계 테이블 (`HIVE_TIP_POLLEN_BY_NECTAR`, FLOWER 용량 테이블과 같은 구조):** 상향 셀의 NECTAR 개수별로 팁이 발동하는 POLLEN 개수. 임계 조합 {NECTAR, POLLEN} = {5, 0}, {4, 1}, {3, 3}, {2, 5}, {1, 6}, {0, 8}. 상향 셀 POLLEN ≥ 해당 NECTAR 개수의 임계 POLLEN이면 팁 (NECTAR 5개 이상이면 POLLEN 0개로 즉시 팁). 상향 셀 개수는 NECTAR / POLLEN 별도 집계(`nectarInUpwardCell`, `pollenInUpwardCell`).
    - **팁 발동 시점:** 명중한 공이 **도착한 틱**(발사 비행 처리, 2.6.2항)에 상향 셀이 임계에 도달하면 그 틱에 즉시 팁 상태(`isTipping = true`, `tipProgressTimer = 0`)로 전환. 팁 진행 중(낙하 대기열 방출 완료 전)에 발사된 공은 명중 확률과 무관하게 **전부 빗맞음**이며, 팁 전에 명중으로 발사됐더라도 도착 시점에 팁 진행 중이거나 상향 셀이 발사 시점과 달라졌으면 빗맞음과 같이 반사 방출된다.
    - **TIP 30도 틸트 기반 시차 낙하 (Staggered Drop Queue):**
        - **기준점(Lip Origin) 산출:**
            - 기준 X: 아군 진영 중심선 `Lip_X = (alliance === 'RED') ? 59.25 : 84.75`
            - 기준 Y: Audience 측 전복(+Y 사출) 시 `Lip_Y = 91.475 in` (하단 개구부 립)
            - 기준 Y: Opposite 측 전복(-Y 사출) 시 `Lip_Y = 52.525 in` (상단 개구부 립)
            - 사출 방향 계수 `spillDir`: Audience 측 `+1.0`, Opposite 측 `-1.0`
        - **기물별 몬테카를로 착지 분포:**
            - **POLLEN:** `targetY = Lip_Y + spillDir * Normal(mean = 24.3, sigma = 8.3) in`, `targetX = Lip_X + Normal(mean = 0, sigma = 5.9) in`, `settleTime = UniformRandom(1.46, 2.10) 초` (평균 1.83초)
            - **NECTAR:** `targetY = Lip_Y + spillDir * Normal(mean = 20.2, sigma = 7.0) in`, `targetX = Lip_X + Normal(mean = 0, sigma = 5.9) in`, `settleTime = UniformRandom(1.36, 2.08) 초` (평균 1.76초)
        - **데드존 Re-roll:** 생성된 `(targetX, targetY)`가 필드 밖(공 반지름 마진), HIVE AABB(반지름 마진 포함), 로봇 OBB 내부와 겹칠 경우 최대 50회 Re-roll. 초과 시 안전 오프셋 바닥 좌표 강제 지정.
        - **스폰 라이프사이클:**
            - HIVE 임계치 도달 시 20점 획득, `tipCount++`, `isTipping = true`, `tipProgressTimer = 0` 설정, 상향 셀 반전 및 새 상향 셀 개수 0으로 초기화.
            - 셀 내부의 공들에 대해 각각 목표 좌표와 `settleTime`을 계산하여 `pendingDrops` 큐에 등록.
            - 50Hz 엔진이 매 틱 `tipProgressTimer += 0.02`를 누적하며, 개별 `settleTime` 도달 시점에 해당 좌표에 정지 상태(`vx=0, vy=0, state='ON_FIELD'`)로 순차 스폰.
            - 큐의 모든 공이 스폰 완료되면(약 2.1~2.2초 소요) `isTipping = false`로 복귀하고 다음 득점 수용 가능.
            - 팁 발생 즉시 휴먼 플레이어가 NECTAR 1개를 로딩 존에 투입 (빈 슬롯이 없으면 자리가 날 때까지 대기, 2.4항 투입 규칙).
2. **HIVE 슈팅 메커니즘 및 탄도 모델:**
    - **역할 분리:** 엔진은 발사마다 3D 궤적으로 명중을 판정하지 않는다. 설정 확정 시 몬테카를로로 미리 만든 명중률 LUT(오프라인 탄도 모듈 `ballistics.ts`)를 판정 함수(`ShotProbabilityResolver`)로 조회하고, 시드 PRNG 난수 1회로 명중 여부를 정한다. 아래 "몬테카를로 명중 판정"은 **LUT 생성 시에만** 쓰이며 엔진 루프에서는 실행되지 않는다.
    - **판정 함수는 엔진 필수 인자:** `SimulationEngine(r1Config, r2Config, shotResolver, alliance?, scenario?)`. 실제 경기는 LUT 기반 `createLUTShotResolver`를 주입하고, 테스트는 고정 확률 함수를 주입한다. 로봇 고정 명중률(`shooterAccuracy`)은 폐기했다.
    - **물리 가정:** 공기 저항·공 회전 무시, 중력 `GRAVITY` ≈ 386.09 in/s² (2.5항).
    - **발사구 위치:** 높이 `z0 = HIVE_RIM_Z − dz` (림 z = 53.5 고정이므로 `BallisticsConfig.dz`로 역산). 수평 위치는 로봇 중심에서 조준 방향으로 `shooterOffset`만큼 떨어진 점. 터렛 회전축은 차체 중심으로 가정하므로 고정형(정면 조준 시)과 터렛형의 발사구 위치가 같다.
    - **조준점:** 목표 셀 투입구 오각형의 면적 중심 (2.2항 표, `hiveCellAimPoint`). 조준 오차, v0 역산, 명중 기물 배치의 기준.
    - **v0 초기값 (닫힌 해):** 발사구 → 조준점 수평 거리 $D$, 높이차 $\Delta z = z_{\text{aim}} - z_0$, 발사각 $\theta$:

        $$v_0 = \frac{D}{\cos\theta} \sqrt{\frac{g}{2(D\tan\theta - \Delta z)}}$$

        ($D\tan\theta > \Delta z$일 때만 해가 존재)
    - **스윗스팟 (한 점 입력):** 로봇마다 기준 셀 `RED_AUDIENCE`를 가장 잘 넣는 로봇 중심 좌표 **한 점**(`BallisticsConfig.sweetSpot`)만 입력받는다.
        - 기존 3-Tier(100% / 80% / 60%) 입력은 폐기: 명중 확률은 편차 모델의 몬테카를로가 계산하므로, 사용자가 추정한 80% / 60%로 보정하면 같은 편차를 이중 반영하고 덜 정확해진다. v0 고정 슈터의 명중 구역은 조준점 주변 거리 띠 형태로 넓게 나타나는데, 이는 입력이 아니라 LUT 결과로 드러난다. (실측 명중률은 향후 편차 파라미터 보정에 사용)
        - **격자 중심 스냅 (`snapSweetSpot`):** 스윗스팟은 그 점을 담는 1 in 격자의 중심(x.5)으로 스냅한 뒤 검증 / v0 탐색한다 (경계 위의 점은 큰 쪽 격자, 예: (60, 135) → (60.5, 135.5)). LUT는 격자 중심에서만 명중률을 계산하므로, 격자 중심 기준으로 v0를 찾아야 스윗스팟 격자의 LUT 값이 탐색 명중률과 일치한다 (근거리 상승 사격은 명중 띠 폭이 격자보다 좁을 수 있음). GUI 격자 클릭 입력은 이미 격자 중심.
        - 검증 (`validateBallisticsConfig`, GUI 확정 버튼(LUT 생성) 비활성화, 스냅한 스윗스팟 기준, 엄격 적용 — 헤딩은 입력받지 않음. GUI는 조준점을 향해 돌린 로봇 몸체 윤곽과 실패 사유를 미리 보여줌): 조준점을 바라보는 로봇 몸체가 필드 안 — `SWEET_SPOT_OUT_OF_FIELD`, HIVE AABB와 겹치지 않음 — `SWEET_SPOT_IN_HIVE`, 닫힌 해 존재 — `SWEET_SPOT_NO_SOLUTION`, 파라미터 유효(발사각 (0, π/2), 유한값, 편차 ≥ 0, 로봇 크기 > 0) — `PARAM_INVALID`. v0 탐색 후 스윗스팟 명중률(`sweetSpotHitRate`)이 0이면 경고.
    - **2단계 몬테카를로 (로봇별 · 기물 종류별 독립):**
        1. **v0 탐색 (`searchLaunchSpeed`):** 스윗스팟에서 닫힌 해 v0를 초기값으로, 닫힌 해 ±20% (1% 간격) → 최고점 ±1% (0.1% 간격) 1차원 탐색하여 몬테카를로 명중률(후보당 20000샘플)이 최대인 v0를 채택. 모든 후보가 같은 시드(공통 난수)를 써서 비교 잡음을 줄이고, 동률이면 닫힌 해(굵은 탐색 최고점)에 가까운 후보 우선. POLLEN / NECTAR 각각 따로 탐색한다 (팀이 기물 종류별로 슈터를 튜닝했다고 가정).
        2. **LUT 생성 (`generateReferenceLUT`):** 채택한 v0로 144 × 144 격자(1 in) 중심 $(g_x + 0.5, g_y + 0.5)$마다, 로봇이 조준점을 정면 조준했다고 가정한 명중률 $P_{\text{spatial}}$(격자당 2000샘플)를 계산. 조준점을 바라보는 로봇 몸체가 HIVE AABB와 겹치는 격자는 0.
            - **격자별 독립 난수 구간:** 격자 i는 기준 스트림의 $[i \cdot N \cdot 6,\ (i+1) \cdot N \cdot 6)$ 구간을 쓴다 (N = 격자당 샘플, 샘플 1개 = 난수 6개 `RNG_DRAWS_PER_SAMPLE`). Mulberry32 상태는 고정 증분 수열이라 `createRng(seed, skip)`로 O(1) 점프한다. 구간이 겹치지 않고, 격자 계산 순서 / 건너뛰기 / Web Worker 분할과 무관하게 같은 값이 나온다 (144² × N × 6 < 2³² → N ≤ 약 34,000).
            - **도달 불가 격자 생략 (`canPossiblyHit`, 기본 켬):** 명중하려면 통과점이 오각형 위에 있어야 하므로, 발사구 → 오각형 지면 투영까지의 수평 거리 범위에서 공 높이가 [림 z, 꼭짓점 z]에 들어올 수 있어야 한다. 속도 / 발사각 편차 ±6σ 상자에서 높이 최댓값·최솟값을 닫힌 형태로 구하고(속도에 단조, tanθ에 오목), 거리를 0.05 in 간격 + 립시츠 여유로 훑어 불가능이 확실한 격자만 0으로 둔다. ±6σ 밖 확률은 샘플당 약 6e-9라 생략해도 결과가 생략하지 않은 경우와 같다 (테스트로 동일성 검증).
            - 생략 비율은 약 11~16%로 크지 않다: 속도 편차 6σ(±12%)의 공은 포물선 하강 구간으로 필드 대부분의 거리에 닿을 수 있어, 확실히 0인 격자를 증명할 수 있는 범위가 좁다 (방위 편차 부채꼴로 투영을 잘라도 약 1%p 추가라 채택하지 않음). 실제 0이 아닌 격자는 3~20% 수준.
        - 샘플 편차 (`estimateHitRate`): 속도 $v_0(1 + N(0, \text{v0NoisePercent}))$, 방위 $+N(0, \text{headingNoiseRad})$, 발사각 $+N(0, \text{pitchNoiseRad})$ (기본 0.02 / 0.02 rad / 0.006 rad). 발사구 위치는 명목 조준 방향 기준이고 편차는 공의 방향에만 적용.
        - 결정론: Mulberry32 시드 PRNG(`createRng`, 엔진과 같은 알고리즘의 독립 스트림). 기준 시드(`RobotLUTOptions.seed`, 기본 `DEFAULT_BALLISTICS_SEED`)에서 기물 종류 × (탐색 / LUT) 용도별 시드를 파생하고, LUT는 그 안에서 격자별 구간을 쓰므로 같은 설정 + 같은 시드 = 같은 LUT.
        - 준난수(Sobol / Halton) 샘플링은 보류 (얻는 정확도 대비 변경 범위가 큼).
        - 통합 함수 `generateRobotLUTs(config, robotSize, options)` → `{luts, v0, sweetSpotHitRate, issues}` (로봇 1대분 8장). 검증 실패 시 LUT 전부 0, v0 null (판정 함수가 항상 0).
    - **몬테카를로 명중 판정 (샘플 1개, LUT 생성 전용):** 아래를 모두 만족하면 명중.
        - **① 앞면 통과:** 공 중심 궤적이 상향 셀 투입구 평면을 **앞면에서** 통과 (통과 순간 속도 · 바깥 법선 < 0).
        - **② 줄인 오각형:** 통과점이 오각형을 **기물 반지름만큼 안쪽으로 줄인 영역** 내부 (공 전체가 들어감). 반지름이 기물마다 달라 POLLEN / NECTAR LUT가 따로 필요.
        - **③ 림 아래 벽 여유:** 통과 전 공 중심이 림 아래 벽(y–z 단면 R = [림 y, HIVE 앞면 y] × (−∞, 림 z], 셀 폭 방향으로 이어짐)과 반지름 이상 떨어져 있음. R을 r만큼 넓힌 영역 = 옆 띠(y ∈ [R − r], z < 림 z) ∪ 윗면 띠(z < 림 z + r) ∪ 윗모서리 원 2개. 띠는 공 높이가 시간에 오목하므로 구간 끝점 검사로 정확하고, 모서리는 경로 곡률 반경(수백 in) ≫ r이라 거리 함수가 단봉이므로 황금분할 탐색으로 정확하다 (촘촘한 샘플링 기준 판정과 0.00%p 일치 확인).
            - 이전(06-3)의 "림 y를 지날 때 z ≥ 림 z + r" 조건은 공이 비스듬히 모서리를 지날 때의 수직 거리(높이 여유 × cos(진입각))를 무시해 상승 진입을 과대 인정했고, 반대로 네모 모서리 근사는 최대 약 40%p 과소 인정했다.
        - **④ HIVE 직육면체 진입 면:** 통과 전 공이 직육면체(xy ± r, 높이 `HIVE_HEIGHT` + r)에 처음 들어오는 곳이 (a) 셀 앞면(AUDIENCE y = maxY + r / OPPOSITE y = minY − r, 안쪽으로 이동, 셀 폭 x ∈ [셀 좌측 + r, 셀 우측 − r]) 또는 (b) 셀 위 윗면(z = `HIVE_HEIGHT` + r, 셀 폭 안, 오각형 꼭짓점보다 앞쪽)이어야 한다. HIVE 옆면 / 뒷면 / 셀 옆 프레임 / 셀 폭 밖 앞면으로 들어오면 차단. 진입점과 통과점이 모두 셀 폭 안이면 그 사이 직선 경로도 셀 폭 안이므로 진입점 검사로 충분. 발사구가 이미 박스 안이면 앞면 앞 공간(림 바깥, 셀 폭 안)일 때만 허용.
            - 이전(06-3)에는 직육면체를 쓰지 않아 HIVE 옆에서 옆면을 뚫고 오는 공이 명중으로 계산됐고(발사각 70°에서 옆쪽 명중 영역), 림 y 기준 조건이 발사구가 림 안쪽 / 바깥쪽인지에 따라 들쭉날쭉해 y = 93 행 줄무늬가 생겼다. ④로 옆쪽 영역과 줄무늬가 함께 사라진다.
        - 구현 (`isShotInHiveCell`): 투입구 평면까지의 부호 거리 $f(t)$는 오목한 2차식이므로 앞면 → 뒷면 통과는 항상 큰 근 (상승 진입도 앞면 통과면 인정). 줄인 오각형은 볼록 다각형의 각 변(밑변, 좌우 세로 변, 삼각형 빗변 2개)을 r만큼 안으로 옮긴 반평면의 교집합.
        - **근거리 상승 사격:** 발사구가 낮고 조준점까지 가까우면 공이 아직 올라가는 중에 입구에 도달한다 (도달 기울기 $2\Delta z / D - \tan\theta > 0$). 공이 벽 윗모서리를 비스듬히 지나므로 모서리까지의 수직 거리는 높이 여유 × cos(상승각)이다. 입구 아래쪽 / 가운데를 노린 공은 모서리에 걸리고 위쪽만 들어가므로 명중 띠가 좁다 (예: 발사구 12 in, 발사각 55°, 거리 약 35 in에서는 조준점 명목 궤적도 모서리를 0.97 in 거리로 스쳐 빗맞음). 원거리에서 내려오며 들어가는 사격은 띠가 넓다.
        - **고각 사격의 두 띠:** 발사각이 크면 로봇이 멀어질수록 입구 통과 높이가 림 → 입구 위쪽 → 림으로 올라갔다 내려와, 조준점 가까운 쪽에 상승 진입 띠, 먼 쪽에 하강 진입 띠(거리에 덜 민감해 더 넓음)가 생긴다. 두 띠 사이는 포물선 꼭대기가 입구 삼각형(좁아지는 부분)에 걸려 약간 낮다.
    - **LUT 구성 및 4-Cell 대칭 변환:**
        - 로봇 2대 × 기물 2종 × 4셀 = **16장**, 각 144 × 144 `Float32Array` (1 in 격자, 인덱스 `gy * 144 + gx`). 타입: `HeatmapLUT`, `HeatmapLUTSet`(4셀), `RobotHeatmapLUTs`(기물 종류별).
        - 격자 / 샘플 수 선택 근거 (06-3 이후 측정): 명중 띠 안 평균 오차는 2 in 격자 + 최근접 조회 2.9~9.4%p(최대 36~44%p), 1 in 격자 + 쌍선형 보간 0.3~1.1%p(최대 3.8~4.9%p)로, 1 in + 보간 + 격자당 2000샘플(표본 오차 약 1%p)에서 격자 오차와 표본 오차가 비슷해진다. v0 탐색 20000샘플은 찾은 v0의 실제 명중률 손실을 0.6%p → 0.07%p로 줄이며 메모리 영향이 없다 (샘플을 저장하지 않음).
        - 몬테카를로는 기준 셀 `RED_AUDIENCE`에 대해서만 수행 (로봇 × 기물 = 4회)하고, 나머지 3셀은 격자 인덱스 대칭 복사 (셀 기하가 정확히 대칭이므로 오차 없음):
            - `RED_OPPOSITE`: y = 72 직선 기준 대칭 (x, 144 − y) → $g_y' = 143 - g_y$
            - `BLUE_AUDIENCE`: x = 72 직선 기준 대칭 (144 − x, y) → $g_x' = 143 - g_x$
            - `BLUE_OPPOSITE`: (72, 72) 점대칭 (144 − x, 144 − y) → 두 인덱스 모두 반전
        - **연산량 / 메모리:** 격자당 2000샘플 기준 최대 4 × 20,736 × 2000 ≈ 1.66억 샘플 (도달 불가 격자 생략 전). 구현 측정(Node V8, 단일 스레드, 스윗스팟 (60.5, 134.5), 발사구 14 in): 로봇 1대(8장) 발사각 55° 약 33초, 70° 약 61초 (v0 탐색 포함, 고각일수록 입구 근처까지 가는 샘플이 많아 ③ 판정 비용 증가). 격자별 독립 난수 구간 덕분에 Web Worker로 격자를 나눠도 결과가 같으므로 병렬화로 단축 가능. 메모리는 16 × 20,736 × 4 B ≈ 1.3 MB. 실행 방식(Worker 풀 / 진행 표시 / 비차단 흐름 / 캐시)은 바로 아래 "LUT 생성 실행 / 사용자 경험" 참고. 저장 레시피(Step 10)에는 LUT 대신 탄도 설정 + 시드를 저장해 재생성한다.
    - **LUT 생성 실행 / 사용자 경험 (설계 확정, 미구현 — Step 9에서 구현):** 로봇 1대 단일 스레드 약 30~60초를 "멈춰서 기다리는 시간"이 아니라 "다른 입력을 하는 동안 진행되는 시간"으로 만든다. 아래 1~4를 모두 적용한다 (저정밀 미리보기는 불채택, 6.4항).
        1. **Web Worker 풀 병렬 생성:**
            - **Worker 모듈:** `src/workers/lutWorker.ts` (Vite `new Worker(new URL('./lutWorker.ts', import.meta.url), { type: 'module' })`). `ballistics.ts`의 순수 함수만 import하고 DOM / React 비의존.
            - **풀 크기:** `max(1, min(navigator.hardwareConcurrency − 1, 8))` (UI 스레드용 코어 1개 남김). 풀은 앱 수명 동안 재사용.
            - **작업 단위:** (로봇, 기물 종류, 단계). 단계 ① v0 탐색 = 작업 1개 (분할 없음, 약 1~2초) → 단계 ② 기준 셀 LUT = 격자 행 묶음 작업 (기본 4행 = 576격자). 로봇 2대 × 기물 2종의 작업을 한 대기열에 넣고, 유휴 Worker가 다음 작업을 가져가는 동적 분배 (명중 띠가 지나는 행은 ③ 판정 비용이 커서 정적 분할보다 균형이 좋음). 같은 (로봇, 기물)의 ② 작업은 ① 완료 후 v0가 정해져야 대기열에 들어감.
            - **결정론:** 격자별 독립 난수 구간(2.6.2항 LUT 생성)이므로 어떤 분할 / 순서 / Worker 수로 계산해도 결과가 `generateRobotLUTs` 단일 스레드 결과와 비트 단위로 같다.
            - **`ballistics.ts` 사전 준비 (Step 9 첫 작업):**
                - `generateReferenceLUTRows(config, robotSize, pieceType, v0, samples, seed, gyStart, gyEnd, options) → Float32Array((gyEnd − gyStart) × 144)`: `generateReferenceLUT`의 행 범위 버전. 격자 인덱스 / 난수 구간 계산은 전체 LUT 기준 그대로.
                - `generateReferenceLUT`는 `generateReferenceLUTRows(…, 0, 144)`로 재작성하여 코드 중복 제거.
                - 용도별 시드 파생(`deriveSeed(seed, 2i)` 탐색, `deriveSeed(seed, 2i + 1)` LUT)을 공개 함수(예: `robotLUTSeeds(seed)`)로 노출하여 Worker 작업 계획이 `generateRobotLUTs`와 같은 시드를 쓰게 함.
                - 테스트: 임의 행 분할(예: 1행 / 7행 / 불균등)로 계산해 합친 LUT === `generateReferenceLUT` 결과, 작업 계획으로 만든 16장 === `generateRobotLUTs` 결과.
            - **메시지 규약:** 메인 → Worker `{ kind: 'search' | 'rows', jobId, generation, robotId, pieceType, config, robotSize, samples, seed, gyStart?, gyEnd?, v0? }`, Worker → 메인 `{ kind: 'progress', jobId, cellsDone }` (행 1개마다) / `{ kind: 'result', jobId, generation, v0?, hitRate?, rows? }` / `{ kind: 'error', jobId, message }`. 결과 `Float32Array`는 transferable로 넘겨 복사 비용 0.
            - **조립:** 메인 스레드가 (로봇, 기물)별 기준 LUT `Float32Array(144 × 144)`에 행 결과를 복사하고, 모든 행이 모이면 `mirrorLUTSet`으로 4셀을 만들어 `RobotHeatmapLUTs` 완성.
            - **예상 시간:** 8코어 기준 로봇 1대 약 8~10초, 4코어 약 15~20초 (단일 스레드 30~60초 ÷ Worker 수 + 분배 오버헤드). 두 로봇이 동시에 진행되므로 전체 대기도 비슷한 수준. 모바일은 더 느림.
        2. **진행 상황 표시:**
            - **v0 결과 선표시:** 단계 ① 완료 즉시 기물 종류별 v0와 스윗스팟 명중률(`sweetSpotHitRate`) 표시. 0이면 경고 ("이 스윗스팟에서는 명중 불가 — 설정 확인"), 생성은 계속 진행.
            - **진행 막대:** 로봇별 `완료 격자 / 전체 격자` (기물 2종 합산, 전체 = 2 × 20,736). HIVE 겹침 / 도달 불가로 생략되는 격자는 행 처리 시 즉시 완료로 집계. 단계 ① 동안은 "v0 탐색 중" 표시.
            - **남은 시간:** `경과 시간 × (남은 격자 / 완료 격자)`를 지수 평활해 표시하고, 5% 완료 전에는 표시하지 않음 (초반 추정 불안정).
            - **점진 히트맵:** 로봇별 미리보기 캔버스에 기준 셀(`RED_AUDIENCE`) LUT를 행 묶음이 도착할 때마다 그림 (미계산 행은 회색 빗금, 기물 종류 전환 가능). 사용자가 명중 띠가 드러나는 과정을 직접 보며 설정이 맞는지 판단할 수 있게 함. 필드 윤곽 / HIVE / 조준점 / 스윗스팟을 함께 표시.
            - **갱신 빈도:** 진행 / 히트맵 갱신은 `requestAnimationFrame`으로 모아 최대 약 10 Hz (메시지마다 React 상태를 바꾸지 않음).
        3. **비차단 작업 흐름:**
            - **로봇별 상태 머신:** `IDLE`(설정 없음 / 검증 실패) → `QUEUED` → `SEARCHING`(단계 ①) → `GENERATING`(단계 ②, 진행률) → `READY` | `ERROR`. 설정 변경 시 `CANCELLED`를 거쳐 다시 `QUEUED`.
            - **시작 시점:** 탄도 설정 확정 버튼(검증 `validateBallisticsConfig` 통과 시에만 활성화)을 누를 때. 입력 중 자동 재생성은 하지 않음.
            - **무효화 조건:** 해당 로봇의 `BallisticsConfig`, 로봇 `length` / `width`(HIVE 겹침 격자 / 검증에 영향), 기준 시드, 샘플 수가 바뀔 때만. 그 외 `RobotConfig` 변경(속도, 인테이크 등)과 시나리오 변경은 LUT를 무효화하지 않음.
            - **취소:** 로봇별 세대 번호(`generation`)를 올리고, 대기열의 이전 세대 작업을 제거, 실행 중인 작업의 결과 / 진행 메시지는 세대가 다르면 무시. 행 묶음이 작아(수백 ms) Worker 강제 종료는 하지 않음 (종료 시 풀 재생성 비용 발생).
            - **막는 동작:** 시뮬레이션 시작(및 LUT가 필요한 경기 재생 / 분기 실행)만 두 로봇이 모두 `READY`일 때 활성화하고, 비활성 사유를 표시 ("로봇 2 확률표 생성 중 63%"). 로봇 / 시나리오 / 스윗스팟 편집, 필드 탐색 등 나머지는 모두 계속 가능.
            - **사용 흐름 예:** 로봇 1 탄도 확정 → 생성 시작 → 그동안 로봇 2 입력 / 확정 → 시나리오 입력 → 대부분 입력이 끝날 즈음 생성 완료.
        4. **IndexedDB 캐시:**
            - **캐시 키:** `crypto.subtle.digest('SHA-256')`로 만든 정규화 JSON의 해시 — `{ BALLISTICS_MODEL_VERSION, BallisticsConfig(스윗스팟은 스냅한 좌표, 편차 미지정 값은 기본값으로 채움), robot length / width, seed, samples, searchSamples }`. `skipUnreachable`은 결과가 같으므로 키에서 제외.
            - **`BALLISTICS_MODEL_VERSION`:** `ballistics.ts`에 둘 정수 상수. 명중 판정 / LUT 생성 규칙 / 투입구 기하가 바뀌는 커밋마다 올려서 이전 캐시를 자동 무효화 (예: 06-4의 진입 면 / 림 벽 판정 변경은 버전 증가 대상).
            - **저장 형식:** DB `ftc-tactic-sim`, 저장소 `lutCache`, 레코드 `{ key, modelVersion, createdAt, lastUsedAt, v0: {POLLEN, NECTAR}, sweetSpotHitRate: {POLLEN, NECTAR}, reference: {POLLEN: ArrayBuffer, NECTAR: ArrayBuffer} }`. 기준 셀 LUT만 저장(로봇당 2 × 82,944 B ≈ 166 KB)하고, 불러올 때 `mirrorLUTSet`으로 4셀 복원 (복원 비용 무시 가능).
            - **정리:** `lastUsedAt` 기준 LRU로 최대 20개(약 3.3 MB) 유지, 초과분은 저장 시 삭제.
            - **조회 흐름:** 확정 시 캐시 먼저 조회 → 적중하면 즉시 `READY` (Worker 미사용) → 없으면 생성 후 저장.
            - **저장 레시피(Step 10)와의 관계:** 레시피에는 LUT 대신 탄도 설정 + 시드 + 샘플 수 + `BALLISTICS_MODEL_VERSION`을 저장. 불러올 때 캐시가 있으면 즉시, 없으면 위 생성 흐름을 탐. 레시피의 모델 버전이 현재와 다르면 "재생성한 확률표로 결과가 달라질 수 있음"을 경고.
            - **실패 허용:** IndexedDB를 쓸 수 없으면(사생활 보호 모드, 용량 초과 등) 캐시 없이 매번 생성하며 기능은 동일.
    - **런타임 판정 (`createLUTShotResolver(luts, r1Config, r2Config)`, 06-5 구현 완료):** 엔진 생성자에 주입하는 `ShotProbabilityResolver` (엔진 수정 없음). 엔진은 발사 완료 틱에 `(robotId, pieceType, robot.x, robot.y, robot.heading, alliance, upwardCell)`로 호출하고, 반환 확률과 시드 난수 1회로 명중을 정한다.
        - **입력:** `luts: MatchHeatmapLUTs` (로봇 슬롯별 `RobotHeatmapLUTs`), `r1Config` / `r2Config`의 `turretType` / `turretRange` / `aimTolerance`. 슈터 설정은 생성 시점에 복사해 고정한다 (이후 원본 객체 변경이 경기 중 판정에 새지 않음 → 결정론).
        - **$P_{\text{spatial}}$:** `luts[robotId][pieceType][hiveCellKey(alliance, upwardCell)]`를 로봇 중심 좌표에서 **쌍선형 보간**(`sampleLUT`)으로 조회. 둘러싼 격자 중심 4개 값을 거리 비례로 섞고, 필드 가장자리 격자 중심 바깥은 가장자리 값. 셀 키 = `${alliance}_${AUDIENCE | OPPOSITE}`. 팁으로 상향 셀이 바뀌면 다음 발사부터 새 셀의 LUT와 조준점을 쓴다.
        - **조준 오차:** $\Delta\psi$ = `angleDifference(조준점 방위, heading)` = 조준점 방위 − 헤딩, [-π, π] (`kinematics.ts` 재사용). 조준점 방위는 로봇 중심 → 상향 셀 조준점(투입구 오각형 면적 중심). 부호: + = 로봇 오른쪽 (캔버스 y-down에서 각도가 커지는 방향).
        - **조준 판정 (`isAimWithinShooterRange`):**
            - **고정형(`FIXED`):** $|\Delta\psi| \le$ `aimTolerance`(기본 3° ≈ 0.0524 rad, 경계 포함)이면 $P_{\text{final}} = P_{\text{spatial}}$, 아니면 0. 허용 오차가 비유한값 / 음수면 0으로 취급 (정확히 정렬될 때만).
            - **터렛형(`TURRET`):** `turretRange` $[\alpha, \beta]$를 [-π, π]로 정규화 (`normalizeAngle`은 ±π를 보존하므로 360° 터렛 [-π, π] 유지). $\alpha \le \beta$면 $\alpha \le \Delta\psi \le \beta$, $\alpha > \beta$면 ±π를 가로지르는 구간 ($\Delta\psi \ge \alpha$ 또는 $\Delta\psi \le \beta$, 예: 후방 터렛 [2.5, −2.5]). 범위가 비유한값이면 조준 불가.
            - 한계: 허용 오차 / 터렛 범위 안이면 조준 오차에 따른 명중률 감소는 반영하지 않는다 (LUT는 정면 조준 가정). 고정형은 허용 오차가 작아(±3°) 영향이 작다.
        - **안전장치:** LUT 값이 비유한값이면 0, 결과는 [0, 1]로 제한 (엔진도 한 번 더 제한).
    - **발사 비행 처리 (06-6 구현 완료):**
        - **목표:** 발사 순간 공이 HIVE로 순간이동하는 부자연스러움을 없애되, 결과(명중 여부)는 LUT 판정을 그대로 따르고, 3D 물리 엔진 없이 닫힌 해로 계산한다.
        - **범위 분리:** 엔진은 궤도 결과(도착 지점, 도착 시점, 착지 속도)를 발사 시점에 계산해 비행 대기열에 기록하고 도착 틱에 반영한다. 이 기록으로 출발점 → 도착점을 보간하는 렌더링은 Step 8.
        - **슈터 탄도 입력:** 엔진 생성자 선택 인자 `SimulationEngine(r1, r2, shotResolver, alliance?, scenario?, shooters?: MatchShooterBallistics)`. 로봇별 `ShooterBallistics {dz, shooterPitch, shooterOffset, v0?: {POLLEN?, NECTAR?}}` — LUT 생성 결과에서 `shooterBallisticsFrom(config, generateRobotLUTs 결과)`로 만든다 (판정 LUT와 같은 발사구 / 발사각 / 탐색 v0). 미지정 시 기본 자동 슈터 `DEFAULT_SHOOTER_BALLISTICS`(발사구 14 in, 발사각 60°, 오프셋 0, v0는 발사마다 조준점 닫힌 해). 생성 시점에 복사해 고정.
        - **결과 선확정 / 난수:** 발사 완료 틱에 판정 함수 확률과 시드 PRNG 난수로 명중을 확정한다. 난수는 발사마다 **항상 3회**(명중 판정, 반사 방출 속도, 반사 방출 각도) 소비하고 도착 시점에는 쓰지 않는다 → 결과와 무관하게 RNG 시퀀스 일정, 결정론 유지. 팁 진행 중 발사는 발사 시점에 빗맞음.
        - **명목 궤적 (`planShotFlight`, 편차 없는 포물선, 발사 1회당 상수 시간):**
            - 발사 방향 (`shotLaunchHeading`): 고정형 = 로봇 헤딩, 터렛형 = 조준점 방위 (터렛 범위 밖이면 가까운 한계각으로 제한).
            - 발사구 = 로봇 중심 + 발사 방향 × `shooterOffset`, 높이 53.5 − dz. 발사각이 (0, π/2) 밖이면 기본값.
            - v0 우선순위: 탄도 설정의 기물별 v0 → 조준점 닫힌 해 → (해가 없으면) 평지 사거리 = 조준점 거리인 속도 $\sqrt{g D / \sin 2\theta}$.
        - **도착 규칙:**
            - **명중:** 궤적과 무관하게 조준점에 도착 (LUT 결과 우선). 비행 시간 $T = D / (v_0\cos\theta)$ (D = 발사구 → 조준점 수평 거리).
            - **빗맞음 + HIVE 충돌 (`intersectHiveBox`):** HIVE 직육면체를 기물 반지름만큼 확장(xy 경계 ± r, 높이 `HIVE_HEIGHT` + r, 공 표면 접촉 기준)하고, 지면 직선이 확장 AABB 안에 있는 구간(착지 전까지)에서 공 중심 높이가 확장 높이 이하가 되는 첫 지점이 있으면 (진입 순간 이미 낮으면 옆면 `SIDE`, 위로 들어와 구간 안에서 내려오면 윗면 `TOP`) 그 접촉점에 도착한 뒤 반사 방출.
            - **빗맞음 + HIVE를 넘어가거나 닿지 않음:** 공 중심 높이가 기물 반지름이 되는 시점의 수평 거리 R 지점에 착지. 착지 후 발사 방향 수평 속도 = $v_0\cos\theta$ × `landingSpeedRetention`(2.5항)을 가진 `ON_FIELD` 기물로 전환되고, 이후는 기존 물리가 처리. 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 벽 앞에서 속도 0으로 정지.
            - 고정형 슈터는 조준 이탈 시 확률 0이고 직선도 조준점을 비껴가므로 판정과 연출이 일치한다.
        - **반사 방출 (`ejectFromHive`):** 접촉 지점이 HIVE AABB 밖(옆면)이면 가장 가까운 외곽 지점과 그 면의 바깥 법선, 안(윗면 낙하 / 도착 시 무효가 된 명중의 조준점)이면 가장 가까운 면의 외곽 지점과 바깥 법선을 쓴다. 외곽 + (반지름 + 0.1 in)에 스폰, 속도 20~60 in/s, 방향 = 법선 ± 60° — 속도 / 각도는 발사 시점에 뽑아 둔 난수로 결정.
        - **비행 대기열 (`FieldState.pendingShots: PendingShot[]`, 발사 순서):** `{pieceId, pieceType, robotId, result('HIT' | 'MISS_HIVE' | 'MISS_FLOOR'), targetCell(발사 시점 상향 셀), launchTick, arriveTick, fromX/Y/Z, toX/Y/Z, heading, v0, pitch, landingVx/Vy, ejectSpeedRoll, ejectAngleRoll}`. 발사 시 기물 상태를 `IN_FLIGHT`로 바꾸고 좌표는 발사구 지면 투영, 속도 0.
            - 도착 틱 = 발사 틱 + max(1, round(T / dt)).
            - 파이프라인 Step 5-2(HIVE 시차 낙하 다음)에서 도착 틱이 된 발사를 발사 순서대로 처리: 바닥 착지는 착지점 / 착지 속도로 `ON_FIELD`, 명중은 **도착 시점에 전복 중이 아니고 상향 셀이 발사 시점과 같을 때만** HIVE 적재 + 팁 판정 (같은 틱에 두 발이 도착하면 앞 발의 팁이 뒤 발을 무효화), 그 외(HIVE 충돌 / 무효 명중)는 반사 방출.
            - 비행 중 기물은 로봇 / 기물 / FLOWER 위를 지나므로 충돌하지 않는다 (물리 / 충돌은 `ON_FIELD`만 대상). 착지 / 방출 지점이 로봇이나 기물과 겹치면 다음 틱 충돌 처리로 밀려남.
            - 경기 종료(6000틱)까지 도착하지 못한 비행은 득점에 반영하지 않는다 (기물은 `IN_FLIGHT`로 남음).
            - 타임라인 스냅샷은 대기열 배열 / 항목을 복제해 기록 보호.
        - **렌더링 (Step 8):** 렌더러는 프레임의 비행 대기열로 출발점 → 도착점을 선형 보간하고, 기록된 v0 · 발사각으로 높이 $z(t)$를 기물 크기 / 그림자 오프셋으로 연출한다. 필요한 정보가 모두 프레임에 있으므로 스크러빙 / 분기 재생에서도 동일하게 재현된다.
        - **탄도 계산 함수 (`ballistics.ts`, 06-2 구현 완료):** 궤적은 `Trajectory {x, y, z, heading, v0, pitch}`(발사구 위치 + 수평 방향)로 표현하고, 수평 거리 d의 높이 $z(d) = z_0 + d\tan\theta - g d^2 / (2 v_0^2 \cos^2\theta)$, 시간 $t(d) = d / (v_0\cos\theta)$로 조회한다.
            - 발사구 / 조준: `launchHeight`(53.5 − dz), `launchPoint`(조준 방향 `shooterOffset`), `bearingTo`.
            - 닫힌 해: `solveLaunchSpeed(D, Δz, θ)`(해 없으면 null), `solveAimLaunchSpeed`(로봇 위치 → 조준점), `sweetSpotLaunchSpeed`(스윗스팟 → `RED_AUDIENCE` 조준점, 06-3 v0 탐색 초기값 / 스윗스팟 닫힌 해 검증), `createAimTrajectory`.
            - 궤적 조회: `heightAtDistance`, `timeAtDistance`, `pointAtDistance`, `descendingDistanceAtHeight`(하강하며 높이에 도달하는 큰 근), `landingDistance` / `landingPoint`(공 중심 높이 = 반지름, 필드 경계 무시 — 벽 처리는 06-6 엔진).
            - HIVE 교차: `intersectHiveBox(traj, pieceRadius)` → `{x, y, z, distance, time, face}` 또는 null(넘어감 / 못 미침 / 비껴감).
        - **변경 범위 (Step 6 완료):** `types.ts`(기물 상태 `IN_FLIGHT`, `PendingShot`, `FieldState.pendingShots`, `ShooterBallistics`), `ballistics.ts`(v0 역산 / 탐색, 몬테카를로 LUT, 대칭 변환, `createLUTShotResolver`, 사거리 · 비행 시간 · HIVE 직육면체 교차, `planShotFlight` / `shotLaunchHeading` / `shooterBallisticsFrom`), 엔진(발사 / 도착 분리, 기존 빗맞음 즉시 방출 대체).
3. **FLOWER (꽃) 기물 조작 및 하단 추출 메커니즘:**
    - **슬롯 구조 및 유효 득점 볼륨(Scoring Volume) 분리:**
        - FLOWER는 수직 원통 구조물로, 하단 출구 밖으로 빠져나와 경기장 바닥 타일에 직접 맞닿아 있는 최하단 기물은 공식 룰상 득점 인정 영역 밖으로 판정됨.
        - **slot[0] (지면 접촉 슬롯 / 바닥 베이스):**
            - 하단 출구 아래 바닥에 맞닿아 있는 슬롯.
            - **경기 종료 득점 계산에서 완전 배제 (0점)**.
            - 로봇이 하단 인테이크로 추출을 시도할 때 가장 먼저 회수되는 대상.
            - FLOWER는 솔리드 장애물(반지름 2.0 in)이므로 필드 바닥에서 공을 밀어 넣을 수 없으며, 상단에서 투입된 NECTAR(3.6 in)는 하단 배출구(2.8 in)를 통과할 수 없으므로 `slot[0]`에는 오직 POLLEN만 위치할 수 있음.
        - **slot[1 .. N] (원통 내부 유효 스코어링 볼륨):**
            - 하단 턱에 걸려 지면으로 내려가지 못한 기물 및 그 위로 차례대로 수직 적재된 유효 기물 슬롯.
            - 경기 종료 시점의 정상 득점 인정 대상.
    - **경기 종료 득점 집계 (2 v 0 환경 단순화):**
        - 상대 진영 기물이 배제된 2 v 0 환경이므로, 경기 종료(남은 시간 0초, Tick 6000) 시점에 유효 스코어링 볼륨(`slot[1 .. N]`) 내에 아군 NECTAR가 1개 이상 존재하면 소유권과 하단 보너스가 동시에 100% 성립:
            - **소유권 득점:** 유효 스코어링 볼륨(`slot[1 .. N]`) 내 기물 전체 개수 × 2점.
            - **하단 보너스:** 추가 5점 일괄 가산.
        - 유효 스코어링 볼륨 내 NECTAR가 0개인 경우 해당 FLOWER 득점은 0점.
    - **하단 추출(deQ) 및 중력 침하(Settling) FSM:**
        - **추출 조건:** FLOWER 원통(반지름 2.0 in)의 바닥 정사영 원이 로봇의 인테이크 구역(`intakeZones`, 3.3항) 중 하나와 겹침 + `actionState === 'INTAKING'` + 로봇 적재 공간 여유(`controlledPieces.length < 적재 한도`, 적재 한도 = min(`maxControlledPieces`, 4)). 인테이크 구역이 없는 면으로는 추출할 수 없음. 여러 FLOWER가 동시에 걸리면 차체에 가장 가까운 FLOWER를 우선.
        - **deQ 실행:** `slot[0]`에 POLLEN이 존재하고 접촉 유지 시간(`intakeContactTimer`)이 최소 추출 쿨다운에 도달하면 `slot[0]` 기물을 로봇으로 회수 적재하고 `intakeContactTimer = 0` 리셋.
        - **연속 추출 중력 쿨다운:** 1회 추출 후 다음 기물 추출까지의 대기 시간은 `max(robotConfig.intakeDelay / 1000, 0.12초)`로 클램핑하여 중력에 의한 기물 낙하 한계 시간을 보장.
        - **NECTAR 하단 블로킹 (Jamming):** `slot[0]`이 비었을 때 상위 기물의 침하 판정:
            - 바로 위(`slot[1]`)가 POLLEN인 경우: `slot[1]` 기물이 `slot[0]`으로 낙하 안착하며 상위 기물들도 순차 1칸씩 하강.
            - 바로 위(`slot[1]`)가 NECTAR인 경우: NECTAR(3.6 in)는 하단 배출구(2.8 in)보다 커서 하단 턱에 걸림. NECTAR는 `slot[1]`에 영구 정지 고정되고 `slot[0]`은 빈 상태(`null`)로 유지됨.
            - `slot[0]`이 비어있는 상태에서는 추가 하단 deQ가 영구 차단됨 (물리적 잼 발생).
    - **상단 투입 (Drop):**
        - 투입 대상: 로봇 OBB 외곽과 FLOWER 원통 간 최단 거리 1.0 in 이내인 FLOWER 중 가장 가까운 것 (버전 1에서는 투입 방향 무관). 대상이 없으면 투입 불가 및 상태 복귀.
        - (확장 예정) 투입 방향 제한이 필요해지면 인테이크 구역과 같은 `BumperZone` 구조의 투입 구역(`flowerDropZones`)으로 대상 판정만 교체.
        - NECTAR는 잔여 60초 이하(ENDGAME) 시점에만 투입 가능.
        - **FLOWER 용량 테이블 (`FLOWER_MAX_POLLEN_BY_NECTAR`, `FLOWER_MAX_NECTAR_CAPACITY = 6`):** 바닥(`slot[0]` 포함)부터 높이 21.5 in 원통에 최대로 채울 수 있는 조합 {POLLEN, NECTAR} = {9, 0}, {8, 1}, {6, 2}, {5, 3}, {3, 4}, {2, 5}, {1, 6}. 투입 후 원통 내 전체 개수(`slot[0]` 포함)가 해당 NECTAR 개수의 최대 POLLEN 이하이고 NECTAR ≤ 6이어야 투입 가능.
            - **`slot[0]` 불변식:** `slot[0]`에는 NECTAR가 올 수 없다 (초기 배치는 POLLEN만, 하단 추출 후 NECTAR는 `slot[1]`에 걸림, 빈 원통에 투입된 NECTAR는 `[null, NECTAR]`). 따라서 NECTAR가 있는 FLOWER의 `slot[0]`은 항상 POLLEN이거나 POLLEN으로 계산하는 빈칸(아래 잼 처리)이며 계산상 POLLEN ≥ 1이다. 기하 계산상의 {0, 7} 조합은 `slot[0]`이 NECTAR여야 하므로 도달 불가능하여 테이블에서 제외했다.
            - 산출 기준: 원통 내 지그재그 적층 + 최상단 기물이 일부라도 원통 내부에 걸치면 인정. 사용자 계산값이며 실측이 가능해지면 실측값으로 교체 예정.
            - **NECTAR 잼 상태 처리 (단순화):** `slot[0]`이 비고 `slot[1]`에 NECTAR가 걸린 잼 상태(하단 추출 후 잼, 또는 빈 원통에 NECTAR 투입)에서는 빈 `slot[0]`을 **POLLEN 1개로 계산**하여 같은 테이블을 적용한다. 출구 턱 높이가 POLLEN 직경(2.8 in)과 같아, 턱에 걸린 NECTAR는 `slot[0]` POLLEN 위에 놓인 경우와 같은 높이에서 적층이 시작되기 때문이다. 턱(링) 위 받침과 공 위 받침에 따른 지그재그 적층의 미세한 차이는 **단순화를 위해 의도적으로 무시**한다 (별도 잼 전용 테이블 없음). 이 가상 POLLEN은 용량 판정에만 쓰이며 득점(`slot[1..N]` 개수)에는 포함되지 않는다.
        - 투입은 로봇 적재함 맨 앞 기물(FIFO, `controlledPieces.shift()`)을 FLOWER 최상단 슬롯에 추가 (`pieces.push(piece)`). 투입 가능 여부 = ① 도달 거리 내 FLOWER, ② NECTAR는 ENDGAME에만, ③ FLOWER 용량 테이블 (엔진 `findDropTarget`).
        - **리프트 FSM (07-1 확정, 07-2 구현 예정 — 이전 "요청 1회 → 준비 → 자동 투입" 흐름을 대체):** 리프트를 올리고(준비) → 올린 채 대기 → 투입 → 내리는 단계를 분리하여, 드라이버가 리프트를 올린 뒤 투입 시점을 고르고 실수로 올린 리프트를 다시 내릴 수 있게 한다.
            - **상태 (모두 Stationary Lock, 3.4항):** `FLOWER_SETUP`(올리는 중) → `FLOWER_READY`(올린 채 대기, 타이머 없음) ⇄ `FLOWER_DROPPING`(투입 중) → `FLOWER_LOWERING`(내리는 중) → `IDLE`.
            - **리프트 유지 요청** = 행동 요청이 `FLOWER_SETUP` 또는 `FLOWER_DROPPING`. 그 외 요청(`IDLE` / `INTAKING` / `SHOOTING`)은 리프트 상태에서 "내림" 요청으로 해석한다.
            - **`IDLE` / `INTAKING`에서:**
                - `FLOWER_SETUP` 요청: 투입 가능(①②③)할 때만 수락 → `FLOWER_SETUP` 진입 (`stateTimer = flowerSetupDelay`, 제동 후 정지 시점부터 차감). 불가능하면 거부 (리프트를 올리지 않음, 기존 요청 거부 규칙과 동일하게 `IDLE` / `INTAKING`).
                - `FLOWER_DROPPING` 요청: **무효** (리프트가 올라가 있지 않으면 투입 불가, 거부).
            - **`FLOWER_SETUP`(올리는 중):** 유지 요청이면 계속 올리고, 타이머 완료 시 `FLOWER_READY`. 내림 요청이면 즉시 `FLOWER_LOWERING`으로 전환하며 내리는 시간 = **지금까지 올린 시간**(`flowerSetupDelay − 남은 stateTimer`, 올림 시간 = 내림 시간). 아직 제동 중이라 올린 시간이 0이면 곧바로 `IDLE`.
            - **`FLOWER_READY`(대기):** `FLOWER_DROPPING` 요청 + 투입 가능 → `FLOWER_DROPPING` (`stateTimer = flowerDropDelay`). 투입 불가면 요청 무시하고 대기 유지. `FLOWER_SETUP` 요청이면 대기 유지. 내림 요청이면 `FLOWER_LOWERING` (`stateTimer = flowerSetupDelay`). 적재함이 비어도 자동으로 내리지 않는다 (내림 요청까지 대기).
            - **`FLOWER_DROPPING`(투입 중):** 진행 중에는 모든 요청을 무시한다 (내림 요청 포함, 커밋). 완료 시 투입 조건을 재검사해 가능하면 투입, 불가능하면 기물을 그대로 둔다. 이어서 요청이 `FLOWER_DROPPING`이고 다음 기물이 투입 가능하면 연속 투입(`stateTimer = flowerDropDelay`), 그 외에는 `FLOWER_READY`로 복귀 (리프트는 올린 채 유지).
            - **`FLOWER_LOWERING`(내리는 중):** 진행 중 모든 요청 무시 (커밋), 완료 시 `IDLE`.
            - 리프트 상태에서는 HIVE 슈팅 / 흡입 요청이 받아들여지지 않는다 (리프트를 내린 뒤 `IDLE`에서 다시 요청). 입력 계층은 리프트 상태 동안 트리거 입력을 요청에 반영하지 않는다 (3.6항).
4. **GARDEN & PARK (경기 종료 판정):**
    - 경기 진행 중에는 실시간 점수로 가산하지 않음.
    - 경기 종료 틱(Tick 6000, 남은 시간 0초) 시점에 필드 상태를 검사하여 일괄 가산:
        - **GARDEN:** 기물을 -z 방향에서 바닥(xy 평면)에 수직 정사영한 원(기물 반지름)이 아군 GARDEN AABB와 일부라도 겹친 상태로 완전히 정지(`speed === 0, state === 'IN_GARDEN'`)해 있는 기물 개당 1점 가산. 중심점이 구역 밖이어도 걸쳐 있으면 인정하며, 경계에 접하기만 한 경우(겹침 깊이 0)는 불인정. (판정: `collision.ts`의 `testCircleVsAABB`)
        - **PARK:** 아군 LOADING ZONE AABB 구역과 차체(OBB) 일부라도 겹친 상태로 정지한 로봇당 5점 가산 (FTC 룰상 부분 진입도 주차로 인정).
5. **랭킹 포인트 (RP):** SWARM (주차 10점) / POLLINATOR 1 (팁 4회) / POLLINATOR 2 (팁 7회). POLLINATOR 팁 횟수는 **오토 팁(`autoTipCount`) + 텔레옵 팁(`tipCount`) 합산**으로 판정한다. 점수(`totalScore`)는 텔레옵 시뮬레이션 구간의 팁(회당 20점)만 반영하며 오토 팁 점수는 포함하지 않는다.

## 3. 핵심 아키텍처 원칙 (Architecture Principles)

1. **상태와 렌더링의 완벽한 분리:** React는 UI만 담당. 시뮬레이션 상태 루프(50Hz)와 Canvas 2D 렌더링은 순수 TypeScript 로직으로 분리.
2. **50Hz Fixed Tick Loop:** `dt = 0.02` 고정 연산. 매 틱 스냅샷을 `TimelineFrame` 객체로 `Array`에 저장.
    - **기록 보호:** 엔진은 타임라인을 `timeline` getter / `getFrame()` / `step()` 반환값으로 **읽기 전용(`DeepReadonly<TimelineFrame>`)**으로만 공개하여 UI가 기록을 수정하지 못하게 한다. `reset()` 시 타임라인 배열이 새로 교체되므로 UI는 배열 참조를 보관하지 말고 매번 `engine.timeline` / `getFrame()`으로 읽는다.
    - **실시간 확정 득점과 경기 종료 득점의 분리:**
        - 경기 진행 중(Tick 0 ~ 5999) `TimelineFrame.totalScore`에는 공식 룰상 즉시 확정되는 **HIVE Tip 점수(회당 20점)**만 실시간 반영.
        - 미확정 요소(FLOWER 소유권/보너스, GARDEN 안치, PARK 주차)의 실시간 예측치를 타임라인 점수에 혼합하지 않음.
        - 경기 종료 틱(Tick 6000) 도달 시점에 HIVE 점수 + FLOWER 최종 점수 + GARDEN 점수 + PARK 점수를 일괄 합산하여 최종 점수를 확정 기록.
3. **충돌 엔진 역학 모델 (`src/core/collision.ts`):**
    - **로봇-환경 충돌:** 벽면 경계, HIVE AABB, 4개 FLOWER Circle에 대해 SAT 침투 보정(MTV). 벽을 파고드는 법선 속도는 0으로 차단하되, 접선 속도는 보존하여 미끄러짐 구현.
    - **로봇-로봇 충돌 (비탄성 슬라이딩):**
        - 법선 부호 규약: `mtvNormal`은 `testOBBvsOBB(r1, r2)`가 반환하는 단위 법선으로, r1을 r2 밖으로 밀어내는 방향(r2 → r1)이다. `MTV = mtvNormal * depth`.
        - 상호 위치 분할 보정: `r1`은 `+0.5 * MTV`, `r2`는 `-0.5 * MTV` 이동 (두 로봇이 서로 반대 방향으로 절반씩 분리).
        - 법선 상대 속도 상쇄: `vRel = v1 - v2`, `vn = dot(vRel, mtvNormal)` 계산 시 `vn < 0`(접근 중)이면: `r1.vx -= 0.5 * vn * mtvNormal.x`, `r1.vy -= 0.5 * vn * mtvNormal.y`, `r2.vx += 0.5 * vn * mtvNormal.x`, `r2.vy += 0.5 * vn * mtvNormal.y` (접선 속도는 100% 보존하여 차체 비비기 주행 허용).
    - **가상 Intake Zone 판정 메커니즘 (`RobotConfig.intakeZones: BumperZone[]`):**
        - **구역 정의 (`BumperZone`):** 로봇 범퍼 변 하나에 붙는 로봇 기준 직사각형. 개수 제한 없음(한 변에 여러 조각 가능, 구역 간 겹침 허용), 빈 배열이면 흡입 불가 로봇.
            - `side`: 붙는 변 (`FRONT` / `BACK` / `LEFT` / `RIGHT`, 로봇 기준 앞뒤좌우).
            - `offset`: 구역 중심점의 변 중점 기준 이동 거리(inch). 중심점은 항상 변 위에 있으며 `|offset| ≤ 변 길이 / 2`로 제한.
            - **offset 부호 규약:** `FRONT` / `BACK` 변은 **로봇 오른쪽**이 +, `LEFT` / `RIGHT` 변은 **로봇 앞쪽**이 +.
            - `width`: 변과 평행한 방향 길이(inch, > 0). 변 길이보다 길어도 됨(모서리 밖 돌출 허용).
            - `depth`: 변에서 차체 바깥 수직 방향으로 뻗는 깊이(inch, > 0).
            - 엔진은 로봇의 현재 위치/헤딩으로 각 구역을 필드 좌표 OBB로 변환(`getBumperZoneOBB`)하여 판정. 로봇 OBB 축은 `axes[0]` = 로봇 앞쪽, `axes[1]` = 로봇 오른쪽 (캔버스 y-down 좌표계).
        - **판정 기준 (z축 정사영):** GARDEN 판정(2.6.4항)과 동일하게, 기물을 -z 방향에서 바닥(xy 평면)에 수직 정사영한 원(기물 반지름 포함)이 인테이크 구역 중 하나와 일부라도 겹치면 유효. 공 중심이 구역 밖이어도 걸치면 인정하며, 경계에 접하기만 한 경우(겹침 깊이 0)는 불인정. FLOWER 하단 추출도 FLOWER 원통 정사영 원과 인테이크 구역의 겹침으로 동일하게 판정.
        - **프리셋 (`createIntakeZonePreset`):** `FRONT` / `ANY`는 별도 타입이 아니라 `BumperZone[]` 배열을 생성하는 편의 함수로 제공하며, 프리셋 기본 depth는 1.0 in.
            - `FRONT`: `FRONT` 변 전체 폭(`width` = 로봇 너비) 구역 1개.
            - `ANY`: 4면 구역 4개, 각 `width` = 해당 변 길이 + 2 × depth. 네 귀퉁이까지 덮어 차체를 사방으로 depth만큼 확장한 영역과 동일.
            - 프리셋 생성 후 로봇 크기가 바뀌면 프리셋을 다시 생성해야 함(설정에는 숫자 배열만 저장).
        - **Kinematic Pusher 흡착 트랩:** `actionState === 'INTAKING'` 가동 중 유효 Intake Zone에 걸친 공은 범퍼 밖으로 튕겨내는 반발 계수(restitution)를 0으로 감쇠하여 해당 범퍼 면에 안정적으로 머물도록 처리.
        - **흡입 조건 판정:** Intake Zone 접촉 유지 시간(`intakeContactTimer`)이 `intakeDelay` 이상 지속되고 로봇 적재 공간(`controlledPieces.length < 적재 한도`)이 있을 때 `CONTROLLED` 상태로 전환하여 적재함 맨 뒤에 추가 (FIFO).
    - **공 vs 정적 장애물 충돌:**
        - 위치 보정: 고정 장애물이므로 공 위치에만 100% MTV 가산.
        - 속도 반사: 공이 장애물로 파고드는 법선 속도 `vn = dot(v_ball, normal) < 0`일 때: `v_ball -= (1 + e) * vn * normal` (e는 기물별 restitution 적용).
    - **공 vs 로봇 충돌 (Kinematic Pusher):**
        - 로봇은 무한 질량으로 간주되어 감속되지 않음. 공에만 100% MTV 가산.
        - 접촉점 유효 선속도 (회전 성분 포함): 접촉점 오프셋 `dx = ball.x - robot.x`, `dy = ball.y - robot.y`에 대해`vEff.x = robot.vx - robot.omega * dy`, `vEff.y = robot.vy + robot.omega * dx`
        - 충격량 속도 전달: `mtvNormal`은 로봇 → 공 방향. `vRel = v_ball - vEff`, `vn = dot(vRel, mtvNormal) < 0`일 때: `v_ball -= (1 + e) * vn * mtvNormal` 적용 (달리는 로봇 범퍼에 맞은 공이 전방으로 튕겨 굴러감).
    - **끼인 공 역보정 (Pinned Piece, Step 4-2):**
        - 문제: 로봇은 공에 대해 무한 질량이라 공을 그대로 밀지만, 공이 벽/HIVE/FLOWER/다른 로봇에 막혀 더 밀려날 곳이 없으면 공-벽 보정이 마지막에 공을 되돌려 공이 로봇 몸체 안에 묻힌다 (특히 로봇 면이 벽과 평행할 때).
        - 해결: 공 충돌 완화 후에도 로봇과 겹친(겹침 깊이 > 0.01 in) 공을 로봇 입장의 장애물로 간주하여 로봇을 MTV만큼 되밀고, 공 쪽으로 파고드는 법선 속도만 0으로 차단한다 (접선 속도 보존 → 공을 누른 채 옆으로 미끄러질 수 있고, 공은 모서리를 돌아 빠져나감). 되밀린 로봇은 환경 충돌을 재보정한다.
        - 공이 로봇 하나에만 닿은 경우(정적 장애물과의 끼임): 그 로봇이 겹침을 전부 양보하여 공에 막혀 정지.
        - 공이 두 로봇 사이에 끼인 경우: 가장 깊이 겹친 로봇이 절반 양보를 시도하고, 양보하지 못한 만큼(벽에 막힘 등)은 공이 다른 로봇 쪽으로 밀려나 그 로봇이 양보한다. 마주 오는 두 로봇은 대칭으로 정지하며, 벽에 붙은 로봇 쪽으로 공을 밀어넣으면 밀고 들어온 로봇이 정지한다.
        - 인테이크 면으로 끼운 경우에도 동일하게 정지하며, 공이 구역에 닿아 있으므로 `intakeDelay` 경과 후 흡입된다.
    - **공 vs 공 충돌 (Circle vs Circle PBD):**
        - 중심 거리 `d < (rA + rB)`인 경우 겹침 깊이 `depth = (rA + rB) - d`.
        - 질량비 분할 위치 밀어내기: `pieceA`는 `-depth * (massB / (massA + massB)) * normal` 이동 `pieceB`는 `+depth * (massA / (massA + massB)) * normal` 이동
4. **틱당 물리 파이프라인 실행 순서:**
    - **Step 1: 로봇 기구학 갱신 (`kinematics.ts`) 및 FSM 주행 제어 이원화**
        - **`INTAKING` (주행 중 흡입 허용):** 외부 주행 입력(`vx, vy, omega`)을 차단하지 않고 정상 주행 적분. 주행하며 공을 빨아들이는 동작 허용.
        - **`SHOOTING`, `FLOWER_SETUP`, `FLOWER_DROPPING` (Stationary Lock 감속 제동, 리프트 상태 `FLOWER_READY` / `FLOWER_LOWERING` 포함 — 2.6.3항):**
            - 즉각적인 위치 고정이 아닌, 목표 속도를 `(0, 0, 0)`으로 강제하여 Slew Rate Limiter 기반 감속 주행 유도.
            - 차체 실제 속도가 완전 정지 임계치(`speed < 0.5 in/s` 및 `|omega| < 0.05 rad/s`)에 도달하기 전까지는 감속 제동 상태(`isBraking = true`)로 대기하며 액션 타이머를 차감하지 않음.
            - 완전 정지 도달 시 비로소 `isBraking = false`로 전환하고 `stateTimer -= dt` 차감 시작.
    - Step 2: 로봇-환경 및 로봇-로봇 충돌 해결 (위치/속도 보정)
    - Step 3: 필드 위 공(`ON_FIELD`) 마찰 감속 및 위치 적분 (`stepPieceDynamics`)
    - Step 4: 공 충돌 완화 루프 (공 vs 환경/로봇/공 충돌 해결, 2회 반복)
    - Step 4-2: 끼인 공 역보정 (`resolvePinnedPieces`): 완화 후에도 로봇과 겹친 공에 막힌 로봇을 되밀어 정지
    - Step 5: HIVE `tipProgressTimer += dt` 누적 및 `settleTime` 도달 공 순차 `ON_FIELD` 방출
    - Step 5-2: 발사 비행 도착 (`stepShotArrivals`): 도착 틱이 된 발사를 발사 순서대로 명중 적재 / 반사 방출 / 바닥 착지 (2.6.2항)
5. **Slew Rate Limiter:** RoadRunner / Pedro Pathing 오도메트리 제원 기반 속도 선형 보간.
6. **입력 계층 및 실시간 루프 (Step 7, 07-1 확정):** 엔진 바깥의 순수 TS 계층이 장치 입력을 틱별 `RobotDriveInput`으로 만들어 엔진에 넣는다. 엔진 입력 인터페이스(`step(r1Input, r2Input)`, `inputProvider`)는 그대로 쓴다.
    - **모듈 구성 (`src/input/`):**
        - `inputConfig.ts`: 키 매핑 / 데드존 / 임계값 / 장치 배정 / 루프 상수를 한곳에 모은 설정 파일 (`collision.ts` 실측 상수처럼 값만 바꿔 조정). 매핑 편집 GUI는 두지 않는다.
        - 순수 변환(축 처리, 행동 요청 결정, 탭 래치, 양자화), 입력 로그 / 입력 출처, 실시간 루프 컨트롤러: DOM 비의존, 시계 / 스케줄러 / 원시 입력을 주입받아 Node(Vitest)에서 가짜 시간으로 테스트.
        - 브라우저 어댑터(Gamepad 폴링, 키보드 이벤트, `requestAnimationFrame`, 포커스 / 가시성 이벤트): 원시 입력 수집과 콜백 연결만 하는 얇은 층.
    - **키 매핑 (`inputConfig.ts` 기본값, W3C Gamepad 표준 배열 `mapping === 'standard'` 기준, 인덱스는 0부터):**

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

        - 키보드는 물리 키 위치(`event.code`)로 읽어 한/영 입력 상태·자판 배열과 무관하게 동작. 매핑된 키는 `preventDefault`(방향키 스크롤, Firefox `/` 빠른 찾기 방지), 입력 폼(`input` / `textarea` / `select` / `contenteditable`)에 포커스가 있으면 무시, 자동 반복(`event.repeat`)은 눌림 에지로 세지 않음.
        - 트리거 임계값(`TRIGGER_THRESHOLD = 0.5`), 그 외 버튼은 `pressed`. 비표준 매핑 패드도 같은 인덱스를 적용 (연결 표시에서 경고, Step 9).
    - **장치 → 로봇 배정 (`inputConfig.ts` 고정값):** 게임패드 슬롯 0 → R1, 게임패드 슬롯 1 → R2, 키보드 → R2.
        - 게임패드 슬롯 = `navigator.getGamepads()` 배열 인덱스 (연결 순서, 브라우저 정책상 페이지에서 버튼을 한 번 눌러야 노출).
        - 키보드는 개발자 디버그용 비공개 입력 (사용자 안내 없음, 사용자에게는 게임패드 조작만 안내). `KEYBOARD_ENABLED` 플래그로 정식 배포 시 비활성화 가능.
        - 한 로봇에 장치가 여럿 배정되면(R2 = 패드 1 + 키보드) 합성: 축은 채널별로 절댓값이 큰 값, 유지형 버튼은 OR, 토글 눌림 에지는 OR.
    - **축 처리 (틱마다, 최신 샘플 사용):**
        - 좌스틱 원형 데드존 `DEADZONE_LEFT = 0.08`: 크기 m < 0.08이면 0, 아니면 크기를 (min(m, 1) − 0.08) / (1 − 0.08)로 재조정 (방향 유지, 크기 ≤ 1). 우스틱 X 축 데드존 `DEADZONE_RIGHT_X = 0.08` (같은 재조정).
        - 키보드: 전진 f = W − S, 오른쪽 s = D − A, 동시 입력 시 크기 1로 정규화 (대각선 0.707), 회전 r = Right − Left. 느린 이동 키는 두지 않음.
        - 드라이버 기준 전진 f(스틱 위 = +), 오른쪽 s → 필드 좌표 정규화 속도 (ux, uy):
            - **필드 기준 `FIELD` (기본):** 드라이버는 아군 벽에서 필드 안쪽을 바라본다 — RED는 x = 0 벽에서 +x 방향, BLUE는 x = 144 벽에서 −x 방향. RED: ux = f, uy = s / BLUE: ux = −f, uy = −s (캔버스 y-down에서 +x를 보는 드라이버의 오른쪽이 +y).
            - **로봇 기준 `ROBOT` (옵션):** 직전 프레임(현재 틱 상태)의 헤딩 h 기준. ux = f·cos h − s·sin h, uy = f·sin h + s·cos h (앞 = (cos h, sin h), 오른쪽 = (−sin h, cos h)).
            - 조작 모드(`DriveMode = 'FIELD' | 'ROBOT'`)는 로봇별 드라이버 입력 설정 (로봇 제원 `RobotConfig` / 시나리오가 아님). 로그에는 변환이 끝난 필드 좌표 값을 기록하므로 모드는 리플레이에 영향 없음.
        - 회전: 정규화 각속도 uω = r (두 모드 공통, + = 오른쪽 회전).
    - **행동 요청 결정 (틱마다, 로봇별 `ActionRequest` 1개):** 직전 프레임의 로봇 `actionState`와 이번 틱 버튼(탭 래치 적용)으로 결정한다. 리프트 토글 값은 입력 계층에 따로 저장하지 않고 **매 틱 엔진 상태에서 유도**하므로, 엔진이 요청을 거부 / 무효 판정하면 토글도 자동으로 그 상태를 따른다 (어긋날 수 없음).
        - 리프트 의도 기본값 = 직전 상태가 `FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING`이면 켜짐, 그 외 꺼짐.
        - A 눌림 에지: 직전 상태가 `IDLE` / `INTAKING`이면 켜짐(올림 요청), `FLOWER_SETUP` / `FLOWER_READY`면 꺼짐(내림 요청), `SHOOTING` / `FLOWER_DROPPING` / `FLOWER_LOWERING`이면 무효 (투입 중 내림 불가).
        - **직전 상태가 리프트 상태(`FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING`):** RT / LT는 반영하지 않음. 의도 켜짐 → B면 `FLOWER_DROPPING`, 아니면 `FLOWER_SETUP` / 의도 꺼짐 → `IDLE`(내림 요청).
        - **그 외 상태:** 우선순위 **`SHOOTING`(RT) > `FLOWER_DROPPING`(B) > `FLOWER_SETUP`(A 켜짐) > `INTAKING`(LT) > `IDLE`**. 리프트가 올라가 있지 않으면 B는 무효이므로 실제 선택은 RT → A → LT 순. 같은 틱에 RT와 A가 함께 들어오면 `SHOOTING`이 선택되고 A는 버려진다.
        - 우선순위 근거: 계속 쥐는 LT를 최하위로 두어 흡입 중에도 RT / A가 먹히게 하고(발사 후 LT를 쥐고 있으면 다시 흡입), 리프트 상태에서는 B가 A 토글보다 앞서야 투입이 가능. 엔진은 틱당 요청 1개만 받으므로 상위 요청이 거부되면 하위 요청도 그 틱에는 수행되지 않음 (예: 빈 적재함에서 LT + RT → RT를 쥐는 동안 흡입 정지).
        - `ActionRequest = 'IDLE' | 'INTAKING' | 'SHOOTING' | 'FLOWER_SETUP' | 'FLOWER_DROPPING'` (`FLOWER_READY` / `FLOWER_LOWERING`은 엔진 상태이며 요청 값이 아님).
    - **짧은 탭 래치:** 게임패드는 `requestAnimationFrame`마다 폴링하고 키보드는 이벤트로 받아 원시 입력 누적기에 모은다. 틱을 소비할 때:
        - 유지형 버튼(LT / RT / B / m / , / /): 눌림 = 현재 눌림 OR 직전 틱 소비 이후 눌림 에지 1회 이상. 20 ms 안에 눌렀다 뗀 입력도 최소 1틱 요청으로 반영된다 (RT 탭 = 1발, B 탭 = 1개 투입 — 해당 동작은 진입 후 커밋되므로).
        - 토글(A / .): 직전 틱 소비 이후 눌림 에지가 1회 이상이면 토글 1회.
        - 한 프레임에서 여러 틱을 소비하면 누적된 에지는 첫 틱에만 적용하고 이후 틱은 현재 레벨을 쓴다. 축은 소비 시점의 최신 샘플.
        - 게임패드는 폴링 간격(약 16.7 ms)보다 짧은 탭은 API 한계로 감지되지 않을 수 있음.
    - **양자화 (입력 수신 시점, 8비트):**
        - 로봇별 틱당 4바이트: `[qx, qy, qω]` int8 ∈ [−127, 127] + `[action]` (0 `IDLE`, 1 `INTAKING`, 2 `SHOOTING`, 3 `FLOWER_SETUP`, 4 `FLOWER_DROPPING`).
        - q = sign(u) · floor(|u| · 127 + 0.5), [−127, 127]로 제한 (u = 위 축 처리 결과 ux / uy / uω, 부호 대칭 반올림).
        - 엔진 입력 = 복호화 값: `targetVx = qx / 127 × maxSpeed`, `targetVy = qy / 127 × maxSpeed`, `targetOmega = qω / 127 × maxTurnRate`. **실시간 입력도 부호화 → 복호화를 거쳐 엔진에 들어가므로** 로그 재생 결과가 비트 단위로 같다.
        - 근거: 재현성은 해상도와 무관(엔진이 쓴 값 = 로그 값)하고 해상도는 조작감만 좌우한다. 1단계 = maxSpeed 60 in/s 기준 0.47 in/s(정지 임계 0.5 in/s 미만), 회전 4 rad/s 기준 0.03 rad/s, 풀스틱 방향 분해능 약 0.45°. 일반 패드는 8비트 원본이 많고 16비트 패드도 1% 이하는 잡음 / 데드존(8%) 범위. 크기: 로봇 2대 × 6000틱 × 4 B = 48 KB (원본, 저장 시 연속 중복 압축은 Step 10). int16은 크기 2배에 체감 이득 없음.
        - 메모리: 로봇별 `Int8Array(6000 × 4)` = 24 KB 미리 할당. 참고로 풀매치 타임라인은 힙 약 46 MB(07-1 측정)로 입력 로그는 그 0.1% 수준 — 메모리 관리의 초점은 타임라인(Step 10 분기).
    - **입력 로그 / 로봇별 입력 출처 / 녹화 덧입히기:**
        - 로그는 로봇별 채널 `{ data: Int8Array(6000 × 4), length }`. 인덱스 t = 틱 t → t + 1 스텝에 쓰인 입력 (`DriveInputProvider`의 tick 규약과 동일).
        - 로봇별 입력 출처 `InputSource = 'LIVE' | 'REPLAY' | 'NONE'`:
            - `LIVE`: 장치 입력 → 축 처리 / 요청 결정 → 부호화 → 로그 t에 기록 → 복호화 → 엔진.
            - `REPLAY`: 로그 t 복호화 → 엔진. 기록 길이를 넘은 틱은 `NONE`과 같음.
            - `NONE`: 0 입력 + `IDLE` (기록하지 않음).
        - **녹화 덧입히기:** 1회차 R1 `LIVE` / R2 `NONE`으로 R1 입력 기록 → 원하는 틱으로 되감기(`scrubTo`) → 2회차 R1 `REPLAY` / R2 `LIVE`로 한 경기장에서 두 로봇을 따로 조종한 결과를 만든다.
        - 되감은 틱 k에서 이어 진행하면 엔진은 k 이후 프레임을 폐기(기존 분기 규칙)하고, `LIVE` 로봇의 로그도 k 이후를 폐기한 뒤 이어서 기록한다. `REPLAY` 로봇의 로그는 유지.
        - `REPLAY`는 위치가 아니라 **조작 명령**을 재생한다. 2회차에 다른 로봇과 부딪히거나 기물을 먼저 가져가면 1회차와 궤적 / 결과가 달라질 수 있으며, 이는 결정론을 유지한 정상 동작이다. 리프트 요청도 기록된 요청을 그대로 보내고 수락 여부는 엔진이 다시 판정한다.
        - 두 로봇이 모두 `REPLAY` / `NONE`이면 실시간 루프 없이 `inputProvider` + `runFullMatch()`로 즉시 재계산할 수 있다.
        - 로그는 같은 로봇 설정 / 시나리오 / 시드 / 탄도 설정 / 엔진 버전을 전제로 한다 (저장 레시피, Step 10).
    - **실시간 루프 (`requestAnimationFrame` + 20 ms 고정 스텝 누산기):**
        - 프레임마다 누산 시간 += 경과 시간, 20 ms마다 1틱 소비 (입력 결정 → `engine.step`).
        - **따라잡기 상한 `MAX_CATCHUP_TICKS = 5`:** 한 프레임에 최대 5틱(100 ms)만 소비하고 남은 누산 시간은 버린다 (순간 끊김 시 게임 시간이 잠깐 느려질 뿐, 입력이 틱별로 기록되므로 결정론 유지).
        - **자동 일시정지:** 탭 숨김(`visibilitychange` → hidden), 창 포커스 소실(`blur`), 경기 중 배정된 게임패드 연결 해제(`gamepaddisconnected`). 탭이 숨겨지면 브라우저가 `requestAnimationFrame` 호출을 멈추고 게임패드 / 키 입력도 전달되지 않으므로(키를 뗀 이벤트 유실 → 키가 눌린 채 남음), 그대로 두면 복귀 시 밀린 시간 동안 마지막 입력이 유지된 채 한꺼번에 시뮬레이션된다.
        - 일시정지 시: 루프 정지, 누산 시간 0, 원시 입력 누적기(키 상태 / 탭 래치 에지) 초기화. 엔진은 마지막으로 완료한 틱에 멈춰 있다.
        - 재개: 사용자의 명시적 조작으로만 재개(Step 7에서는 `resume()` API, 버튼 / 단축키 배치는 Step 9 GUI). 일시정지된 틱에서 그대로 이어가며 재개 첫 프레임은 경과 시간 0으로 시작.
        - 경기 종료(6000틱) 시 루프 자동 정지.
        - **새로고침 / 탭 닫힘 / 크래시 등 외부 개입으로 페이지 상태가 사라지면 그 경기는 폐기한다** (v1은 자동 저장 / 복구 없음, 6.4항).

## 4. 데이터 인터페이스 명세 (`types.ts`)

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

// 텔레옵 시작 조건 (자율주행 결과 반영 시나리오 설정)
export interface ScenarioConfig {
  allianceColor: 'RED' | 'BLUE';

  // 로봇 시작 자세 (자율주행 종료 위치). 미지정 시 진영별 기본 스폰 적용
  r1Spawn?: RobotPose;
  r2Spawn?: RobotPose;
  
  // HIVE 초기 상태
  hiveUpwardCell?: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  hiveInitialPieces?: {
    pollenCount: number; // 상향 셀 POLLEN (기본 0)
    nectarCount: number; // 상향 셀 NECTAR (기본 3). {NECTAR, POLLEN}이 팁 임계 테이블 미만이어야 함
  };

  // 텔레옵 시작 시 로봇 적재물 (순서 있는 목록, FIFO: 0번이 가장 먼저 나감)
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

  // 오토 중 발생한 HIVE 팁 횟수 (기본 0): 텔레옵 직전 휴먼 플레이어가 그 수만큼 로딩 존에 NECTAR 투입,
  // POLLINATOR RP 팁 횟수에 합산 (텔레옵 점수에는 미포함)
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

// 틱별 행동 요청 (입력 계층 → 엔진, 3.6항). FLOWER_READY / FLOWER_LOWERING은 엔진 상태이며 요청 값이 아님
// (엔진 입력 RobotDriveInput.actionState의 타입, 07-2에서 RobotState['actionState']를 대체)
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
  tipCount: number; // 텔레옵 중 팁 횟수 (회당 20점)
  autoTipCount: number; // 오토 중 팁 횟수 (ScenarioConfig, RP 판정에만 합산)
  tipProgressTimer: number; // 전복 시작 후 누적 경과 시간 (초 단위)
  pendingDrops: PendingDrop[];
}

// 5. 필드 통합 상태 및 RP
// 발사 비행 대기열 (결과 / 도착 지점은 발사 시점에 확정, 도착 틱에 반영)
export interface PendingShot {
  pieceId: string;
  pieceType: 'POLLEN' | 'NECTAR';
  robotId: 'robot1' | 'robot2';
  result: 'HIT' | 'MISS_HIVE' | 'MISS_FLOOR';
  targetCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'; // 발사 시점 상향 셀
  launchTick: number;
  arriveTick: number;
  fromX: number; fromY: number; fromZ: number; // 발사구
  toX: number; toY: number; toZ: number; // 도착 지점
  heading: number; v0: number; pitch: number; // 명목 궤적 (렌더러 높이 연출)
  landingVx: number; landingVy: number; // 바닥 착지 직후 속도
  ejectSpeedRoll: number; ejectAngleRoll: number; // HIVE 반사 방출 난수 [0, 1) (발사 시점 소비)
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

1. **좌상단(0,0) 캔버스 좌표계 엄수:** 모든 기물 및 구역 좌표는 명세서 2.2항을 기준으로 작성하라.
2. **필드 초기화 및 시나리오 지원:**
    - 선택된 얼라이언스 색상에 맞춰 32개의 POLLEN과 8개의 NECTAR를 생성하라.
    - `ScenarioConfig`가 주어지지 않은 경우 기본 공식 룰(HIVE 상향 셀 기본 방향, NECTAR 3개 적재, 로봇당 POLLEN 4개 적재(적재 한도 이내), FLOWER/GARDEN 각 4개)로 초기화하라.
    - `ScenarioConfig`가 제공된 경우 해당 파라미터(HIVE 방향/적재량, 로봇 적재물, FLOWER/GARDEN 잔여 수, 오토 팁 횟수, 로봇 시작 자세, 난수 시드)를 우선 반영하고, 지정되지 않은 나머지 기물은 HIVE/FLOWER/로봇/기존 기물 데드존을 회피하여 `ON_FIELD` 정지 상태로 필드에 무작위 스폰하라 (2.4항 배치 순서 및 검증 규칙 준수).
    - 로봇 시작 자세는 `ScenarioConfig.r1Spawn` / `r2Spawn`을 우선 적용하고, 미지정 시 아래 진영별 기본 스폰을 적용하라.
    - Red 기본 스폰: R1 `(9, 36)`, R2 `(9, 108)`, Heading `0`.
    - Blue 기본 스폰: B1 `(135, 36)`, B2 `(135, 108)`, Heading `Math.PI`.
    - HIVE 초기화: Red HIVE의 `upwardCell`은 `AUDIENCE_CELL`, Blue HIVE는 `OPPOSITE_CELL`.
3. **충돌 및 기물 동역학 모듈 (`src/core/collision.ts`):**
    - SAT 기반 로봇-환경, 로봇-로봇 슬라이딩 충돌 보정을 구현하라.
    - 공(`ON_FIELD`)의 타일 마찰 감속(`stepPieceDynamics`) 및 공-환경/로봇/공 충돌 완화 루프를 구현하라.
    - HIVE 30도 틸트 기반 시차 낙하 큐 생성 함수(`generateTippedPiecePlan`)를 구현하고, 아군 진영에 따른 `Lip_X` 분기 및 데드존 Re-roll 로직을 엄수하라.
4. **의존성 분리:** `simulationEngine.ts`는 React Hook에 의존하지 않는 순수 TS 클래스로 작성하여 50Hz 루프(`dt = 0.02`)를 독자적으로 돌게 하라.
5. **상태 전이(FSM) 타이머 및 주행 제어 (리프트 상태 `FLOWER_READY` / `FLOWER_LOWERING`도 Stationary Lock, 리프트 전이는 2.6.3항 리프트 FSM):** `actionState === 'INTAKING'`일 때는 주행 입력을 유지하여 Mobile Intake를 수행하고 공 접촉 타이머를 누적하도록 지시. `SHOOTING`, `FLOWER_SETUP`, `FLOWER_DROPPING`일 때는 감속 제동(`isBraking = true`) 후 정지 완료 시점에 `stateTimer`를 차감하도록 지시.
6. **FLOWER 슬롯 구조 및 하단 추출/블로킹 구현:**
    - `flower.pieces[0]`을 지면 슬롯(`slot[0]`), `[1..N]`을 유효 스코어링 볼륨으로 취급하라.
    - 로봇 인테이크 구역(`intakeZones`)이 FLOWER 원통 정사영과 겹칠 때 `slot[0]`의 POLLEN만 추출(`shift`) 가능하며, 추출 쿨다운은 `max(intakeDelay, 0.12s)`를 적용하라.
    - 추출 후 바로 위 기물이 NECTAR인 경우 `slot[0]`을 `null`로 두고 NECTAR를 `slot[1]`에 고정시켜 추가 추출을 영구 차단하라.
    - FLOWER 득점 집계 시 `slot[0]`은 배제하고, `slot[1..N]` 내 NECTAR 존재 여부에 따라 소유권(개당 2점) 및 하단 보너스(5점)를 경기 종료 틱(Tick 6000)에 일괄 산출하라.
7. **탄도 모델 분리:** 슈터 몬테카를로 히트맵 생성기는 오프라인/별도 모듈로 격리하고, 엔진 루프는 필수 주입 인자인 판정 함수(`ShotProbabilityResolver`: R1/R2 × 기물 종류별 LUT + 조준 오차 판정)를 통해 결정론적으로 동작하도록 지시. 투입구 통과 명중 판정은 LUT 생성 시에만 사용.
8. **엔드게임 전환:** 남은 경기 시간 60초 도달 시 `ENDGAME` 페이즈 전환 및 잔여 NECTAR 재고 전량을 아군 로딩 존에 투입하라 (빈 슬롯이 없으면 `pendingHumanNectar`로 대기 후 순차 배치).
9. **점수 집계 타이밍 엄수:**
    - Tick 0 ~ 5999 구간에는 HIVE Tip 점수(회당 20점)만 실시간으로 `totalScore`에 누적하라.
    - GARDEN 점수, PARK 점수, FLOWER 점수는 Tick 6000(경기 종료)에 도달하는 순간 최종 합산하여 프레임에 기록하라.

## 6. 개발 진행 현황 및 로드맵 (Progress & Roadmap)

> 다음 작업은 새 대화에서 이어간다. 이 장은 지금까지 완료된 범위, 확정된 설계 결정, 남은 Step을 요약한다. 상세 규칙은 위 1~5장이 기준이다.

### 6.1 완료된 Step (커밋 기준, `claude` 브랜치)

| Step | 내용 | 핵심 파일 |
|---|---|---|
| 01 | 타입 정의 및 프로젝트 세팅 (Vite + React + TS) | `types.ts` |
| 02 | 룰북 좌표계 반영, HIVE 4-Cell 필드 렌더러 | `canvasRenderer.ts`, `FieldCanvas.tsx` |
| 03 | 기구학 (Slew Rate 가감속, 헤딩 적분) | `kinematics.ts` |
| 04 | 충돌 엔진 (SAT, 로봇-환경/로봇-로봇, 기물 동역학, PBD, HIVE 시차 낙하 계획) | `collision.ts` |
| 05 | 50Hz 결정론적 메인 루프 엔진 및 룰 전반 (아래 6.2) | `simulationEngine.ts` |
| 5.5 | 테스트 인프라: Vitest 도입, 엔진 통합 회귀 테스트 스위트 저장소 편입 (아래 6.2) | `src/core/__tests__/simulationEngine.test.ts` |
| 06-1 | 탄도 모듈 명세 구체화 및 기존 코드 정비 (아래 6.2.2) | `collision.ts`, `types.ts`, `simulationEngine.ts` |
| 06-2 | 탄도 계산 함수 (v0 닫힌 해, 비행 시간, 사거리, HIVE 직육면체 교차) (아래 6.2.3) | `ballistics.ts`, `__tests__/ballistics.test.ts` |
| 06-3 | 몬테카를로 명중 판정, v0 탐색, LUT 생성 / 4셀 대칭 복사 (아래 6.2.4) | `ballistics.ts`, `__tests__/ballistics.test.ts` |
| 06-4 | HIVE 진입 면 / 림 아래 벽 정확 판정, 1 in 격자 · 샘플 수 상향 · 보간 조회, 격자별 독립 난수 · 도달 불가 격자 생략 (아래 6.2.5) | `ballistics.ts`, `types.ts`, `__tests__/ballistics.test.ts` |
| 06-5 | LUT 명중 확률 판정 함수(`createLUTShotResolver`) + LUT 생성 실행 / 사용자 경험 명세 (아래 6.2.6) | `ballistics.ts`, `types.ts`, 두 테스트 파일 |
| 06-6 | 발사 비행 처리 (발사 / 도착 분리, `IN_FLIGHT`, 비행 대기열, 명중 / HIVE 반사 / 바닥 착지) (아래 6.2.7) | `ballistics.ts`, `simulationEngine.ts`, `types.ts`, 두 테스트 파일 |
| 07-1 | 입력 계층 / 실시간 루프 명세 구체화, FLOWER 리프트 FSM 명세 (아래 6.2.8) | 명세서 |

### 6.2 Step 05 (메인 루프) 세부 완료 항목

- **엔진 API:** `reset / step / runFullMatch / getFrame / scrubTo`, `inputProvider`, 읽기 전용 타임라인(`DeepReadonly<TimelineFrame>`), 스크러빙 후 `step()` 시 미래 프레임 폐기 분기.
- **결정론:** Mulberry32 시드 PRNG(`ScenarioConfig.rngSeed`), 틱별 PRNG 상태 기록으로 스크러빙 후 재시뮬레이션 완전 재현 (동일 JS 엔진 기준).
- **틱 파이프라인:** 기구학/Stationary Lock → 로봇 충돌 → 기물 동역학 → 기물 충돌 2회 → 끼인 공 역보정(Step 4-2) → HIVE 시차 낙하 → 발사 비행 도착(Step 5-2, 06-6) → 흡입/추출 → 액션 완료 → 엔드게임/휴먼 NECTAR 투입 → GARDEN 안착 → 점수.
- **로봇:** `RobotConfig`(하드웨어) / `ScenarioConfig`(시작 조건) 분리, 시작 자세는 시나리오(미지정 시 진영 기본), 적재 한도 `min(maxControlledPieces, 4)`, FIFO 적재함, 로봇 id 슬롯 강제.
- **인테이크:** `BumperZone[]`(면/offset/width/depth) 일반화, FRONT/ANY 프리셋, z축 정사영 원-사각형 판정, FLOWER 하단 추출도 인테이크 구역 기준.
- **HIVE:** {NECTAR, POLLEN} 팁 임계 테이블, 도달 즉시 팁, 팁 중 발사 전부 빗맞음(현실 연사 재현을 위해 의도적으로 유지), 오토 팁은 RP에만 합산.
- **FLOWER:** 21.5 in 원통 용량 테이블(지그재그 적층 계산값), `slot[0]` 불변식(NECTAR 불가), NECTAR 잼 시 빈 `slot[0]`을 POLLEN으로 계산(턱/공 받침 차이 의도적 무시), 투입 가능 여부 요청 시점 검사.
- **시작 상황:** 적재물 순서 목록, FLOWER/GARDEN/HIVE 잔여 수, 오토 팁 NECTAR 로딩 존 투입, 미지정 기물 자동 산포(GARDEN/로딩 존 제외), `validateScenario()`(GUI 확정 버튼 비활성화용).
- **득점:** Tick 0~5999는 텔레옵 팁(20점)만 실시간, Tick 6000에 FLOWER/GARDEN(정사영 걸침 인정)/PARK(로딩 존 부분 진입 인정) 확정.
- **물리 보정:** 끼인 공 역보정(로봇-벽/장애물/로봇 사이), 휴먼 NECTAR는 로딩 존 빈 슬롯이 없으면 대기(`pendingHumanNectar`).
- **검증:** 타입 체크(`tsc -b`), ESLint, 빌드, 통합 테스트 통과.

### 6.2.1 Step 5.5 (테스트 인프라) 완료 항목

- **러너:** Vitest 5 (`devDependencies`), `npm test` = `vitest run`, `npm run test:watch` = `vitest`.
- **스위트:** `src/core/__tests__/simulationEngine.test.ts` — 16개 테스트 그룹(A~P), 검증 196개(반복문 포함). 풀매치를 여러 번 돌리는 그룹이 있어 테스트당 제한 시간 120초, 전체 약 35초.
    - A 시작 자세 / B 초기화 / C 슈팅·팁 / D FLOWER 추출·잼·투입 / E 바닥 흡입 / F PARK / G 시드 / H 풀매치 결정론·스크러빙·분기 / I GARDEN 정사영 / J BumperZone 인테이크 / K 시작 상황·검증 / L 끼인 공 역보정 / M HIVE 팁 테이블·RP / N FLOWER 투입 요청 시점 거부 / O FLOWER 용량 테이블·잼 / P 코드 리뷰 반영(읽기 전용 기록, 로봇 id, 로딩 존 대칭, 산포 제외).
- **타입 검사 포함:** 테스트 파일도 `tsconfig.app.json`(`src` 포함) 대상이라 `tsc -b`로 함께 타입 검사됨.
- **동작 확인:** 엔진 상수를 일부러 틀리게 바꿨을 때 해당 그룹이 실패 메시지와 함께 실패함을 확인.

### 6.2.2 Step 06-1 (탄도 명세 구체화) 완료 항목

- **HIVE 셀 투입구 기하:** 오각형(20 × 7.61 직사각형 + 이등변 삼각형, 높이 14), 림 z 53.5, 지면과 60°, 4셀 대칭 좌표 표, 조준점(면적 중심), 비행 판정용 HIVE 직육면체 높이 65.62 (`HIVE_RIM_Z`, `HIVE_CELL_TILT`, `HIVE_RIM_Y`, `HIVE_HEIGHT`, `hiveCellAimPoint`).
- **스윗스팟 한 점 입력 확정:** 3-Tier 폐기, 기물 종류별 v0 탐색 → 72 × 72 LUT의 2단계 몬테카를로.
- **몬테카를로 명중 판정 기준:** 앞면 통과 + 반지름만큼 줄인 오각형 내부 + 림 통과 높이 (LUT 생성 전용).
- **LUT 16장:** 로봇 × 기물 종류 × 4셀, `Float32Array`, 기준 셀만 몬테카를로 후 대칭 복사 (약 2초, 324 KB).
- **`shooterAccuracy` 폐기:** 판정 함수를 엔진 생성자 필수 인자로 변경 (`(r1, r2, shotResolver, alliance?, scenario?)`), 판정 함수에 기물 종류 인자 추가.
- **조준 각도 규약:** `aimTolerance` / `turretRange`는 헤딩 기준 상대각(rad), [-π, π] 정규화, α > β는 ±π를 가로지르는 구간.
- **비행 처리 범위:** 궤도 결과(도착 지점 / 시점 / 착지 속도)는 Step 6, 렌더러 보간은 Step 8. 빗맞음은 HIVE 직육면체 충돌 또는 바닥 착지(`landingSpeedRetention`).
- **물리 상수:** `GRAVITY` ≈ 386.09 in/s², `landingSpeedRetention` 0.3 (실측 방법 2.5항).
- **엔진:** HIVE 내부 기물을 조준점 바닥 정사영에 배치. 테스트 그룹 Q 추가 (셀 기하 / 대칭 / 기물별 판정 함수 / 조준점 배치).

### 6.2.3 Step 06-2 (탄도 계산 함수) 완료 항목

- **`src/core/ballistics.ts` 신설:** 2.6.2항 "탄도 계산 함수" 목록 (발사구 / 조준, v0 닫힌 해, 궤적 조회, 사거리, HIVE 직육면체 교차). 순수 함수, 엔진 미연결.
- **HIVE 직육면체 교차 규칙 구체화:** 공 표면 기준(반지름만큼 박스 확장), 슬랩 방식 지면 구간 + 포물선 하강 근으로 옆면 / 윗면 판정, 착지 이후 구간 제외, 발사구가 박스 안이면 거리 0 옆면 충돌.
- **테스트:** `src/core/__tests__/ballistics.test.ts` 5개 그룹 (A 발사구 / 조준, B v0 닫힌 해 역대입 · 해 없음, C 스윗스팟 명목 궤적이 조준점 통과, D 비행 시간 · 높이 · 사거리 하강 근, E HIVE 옆면 / 넘어감 / 윗면 낙하 / 못 미침 / 비껴감 / 반지름 확장 / 박스 안 발사). 하강 근 대신 작은 근을 쓰거나 반지름 확장을 빼면 실패함을 확인.

### 6.2.4 Step 06-3 (몬테카를로 LUT 생성) 완료 항목

- **`ballistics.ts` 추가 (엔진 미연결):** `isShotInHiveCell`(투입구 명중 판정), `createRng`(Mulberry32), `estimateHitRate`, `validateBallisticsConfig`, `snapSweetSpot` / `lutGridIndex` / `lutCellCenter` / `lutIndex`, `searchLaunchSpeed`, `generateReferenceLUT`, `mirrorLUTSet`, `generateRobotLUTs`. `collision.ts`의 `sampleNormal`을 공개하여 재사용.
- **스윗스팟 격자 중심 스냅:** 근거리 상승 사격의 좁은 명중 띠 때문에 v0 탐색 위치와 LUT 격자 중심을 일치시킴 (2.6.2항).
- **테스트:** `ballistics.test.ts`에 5개 그룹 추가 (F 투입구 명중 판정: 4셀 대칭 / 변별 여유 / NECTAR 여유 / 짧음 · 김 / 뒷면 / 림 통과 높이 / 상승 사격, G 명중률 결정론 · NECTAR ≤ POLLEN · 점대칭 일치, H v0 탐색, I 검증 · 스냅, J 대칭 복사 인덱스 · LUT 생성 · 결정론 · 검증 실패 시 0). 큰 근 대신 작은 근, 림 조건 제거, 빗변 여유 제거, 대칭 뒤집기 오류, 스냅 제거 각각에서 실패함을 확인.
- **조회 방식:** 근거리 상승 사격은 명중 띠가 격자보다 좁을 수 있어 06-4에서 1 in 격자 + 쌍선형 보간으로 결정.

### 6.2.5 Step 06-4 (탄도 판정 정밀화 / LUT 정밀도) 완료 항목

- **HIVE 진입 면 조건 (④):** 셀 앞면(셀 폭 안) 또는 셀 위 윗면으로만 진입 허용. HIVE 옆에서의 명중과 y = 93 행 줄무늬 제거.
- **림 아래 벽 정확 판정 (③ 교체):** 벽 단면을 반지름만큼 넓힌 영역(옆 띠 / 윗면 띠 / 둥근 윗모서리)과의 교차를 정확히 판정. 이전 림 y 높이 조건(상승 진입 과대 인정)과 네모 모서리 근사(최대 약 40%p 과소 인정)를 대체.
- **LUT 정밀도:** 1 in 격자(144 × 144), 격자당 2000샘플, v0 탐색 후보당 20000샘플, 스윗스팟 1 in 격자 중심 스냅, 쌍선형 보간 조회 함수 `sampleLUT` (06-5 판정 함수에서 사용).
- **격자별 독립 난수 구간 + 도달 불가 격자 생략:** `createRng(seed, skip)` O(1) 점프, `RNG_DRAWS_PER_SAMPLE = 6`, `canPossiblyHit`(±6σ 보수 판정, 생략해도 결과 동일). 생략 비율 약 11~16%.
- **테스트:** 기존 F~J를 1 in 격자 / 몬테카를로 기준 설정(발사구 14 in, 발사각 70°, 스윗스팟 (60.5, 134.5))으로 갱신, K(진입 면: 옆면 / 프레임 차단, 앞면 / 윗면 진입), L(쌍선형 보간), M(난수 점프 / 격자별 구간 / 생략 동일성) 추가. 진입 면 제거, 벽 판정 제거, 모서리 판정 제거, 최근접 조회, 난수 점프 무시, 전부 생략, 과도한 생략(0.5σ), 공유 난수 스트림 각각에서 실패함을 확인.

### 6.2.6 Step 06-5 (LUT 명중 확률 판정 함수) 완료 항목

- **`createLUTShotResolver(luts, r1Config, r2Config)`:** 로봇 슬롯 · 기물 종류 · 아군 상향 셀 LUT를 쌍선형 보간으로 조회 + 조준 판정(고정형 허용 오차 / 터렛 범위). 보조 함수 `hiveCellKey`, `isAimWithinShooterRange`. 타입 `MatchHeatmapLUTs`. 엔진 수정 없이 생성자에 주입.
- **조준 규약 확정:** Δψ = 조준점 방위 − 헤딩 (+ = 로봇 오른쪽), 경계 포함, 비정상 허용 오차는 0, 비정상 터렛 범위는 조준 불가, 슈터 설정은 생성 시점 복사.
- **LUT 생성 실행 / 사용자 경험 명세 (Step 9 구현):** Web Worker 풀 병렬 생성, 진행 표시(v0 선표시 / 진행 막대 / 남은 시간 / 점진 히트맵), 비차단 작업 흐름(로봇별 상태 머신 / 취소 / 시뮬레이션 시작만 잠금), IndexedDB 캐시(`BALLISTICS_MODEL_VERSION`) — 2.6.2항. 저정밀 미리보기는 불채택 (6.4항).
- **테스트:** `ballistics.test.ts` N(합성 LUT로 슬롯 / 기물 / 셀 매핑, 보간, 고정형 경계 / 각도 감김 / 비정상 허용 오차, 터렛 전방 / 후방(±π 가로지름) / 정규화 / 360° / 부호, 비정상 LUT, 설정 복사), `simulationEngine.test.ts` R(생성한 LUT를 엔진에 주입: 스윗스팟 정면 사격 고확률 · 득점 · 팁 후 상향 셀 전환 반영, 조준 이탈 / 명중 띠 밖은 확률 0). 조준 판정 제거, 셀 키 고정, 후방 구간 논리 오류, Δψ 부호 반전, 최근접 조회, 설정 미복사 각각에서 실패함을 확인.

### 6.2.7 Step 06-6 (발사 비행 처리) 완료 항목

- **발사 / 도착 분리:** 발사 시점에 명중 확정(난수 3회 고정 소비) + `planShotFlight`로 명목 궤적 / 도착 지점 / 비행 시간 계산 → `IN_FLIGHT` + `pendingShots` 등록 → Step 5-2에서 도착 틱에 반영. 기존 즉시 적재 / 로봇 기준 즉시 빗맞음 방출(`ejectMissedShot`)을 대체 (`ejectFromHive`: 접촉 지점 기준).
- **명중 유효성:** 도착 시점에 전복 중이거나 상향 셀이 발사 시점과 달라졌으면 반사 방출. 팁은 명중 도착 틱에 발동.
- **슈터 탄도:** 엔진 생성자 선택 인자 `shooters`(`MatchShooterBallistics`), 기본 자동 슈터 `DEFAULT_SHOOTER_BALLISTICS`, 생성 결과 변환 `shooterBallisticsFrom`, 발사 방향 `shotLaunchHeading`(터렛 한계각 제한).
- **바닥 착지:** 사거리 지점, 착지 속도 = 발사 방향 v0·cosθ × `landingSpeedRetention`, 착지 전 벽에 닿으면 벽 앞 정지. 경기 종료까지 도착하지 못한 비행은 무득점.
- **테스트:** 엔진 C / K / M / Q / R을 도착 기준으로 갱신(비행 대기 헬퍼 `settle`), 엔진 S(발사 대기열 / IN_FLIGHT / 도착 틱 공식 / 도착 틱 적재 / 프레임 기록 보호 / HIVE 충돌 반사 방향 / 바닥 착지 속도 / 난수 소비 고정 / 비행 중 스크러빙 재시뮬레이션 동일 / 종료 시 비행 무득점), 탄도 O(발사 방향 · 터렛 제한, 명중 비행 시간, v0 우선순위, 발사각 기본값, HIVE 충돌 / 바닥 착지 / 벽 정지, 탄도 변환). 도착 시 유효성 검사 제거, 명중 시 난수 미소비, 즉시 도착, 착지 감쇠 제거, 대기열 미복제, 벽 정지 제거, 반사 방향 반전 각각에서 실패함을 확인.

### 6.2.8 Step 07-1 (입력 계층 명세 구체화) 완료 항목

- **FLOWER 리프트 FSM (2.6.3항):** 올림(`FLOWER_SETUP`) → 대기(`FLOWER_READY`) ⇄ 투입(`FLOWER_DROPPING`) → 내림(`FLOWER_LOWERING`). `IDLE`에서 투입 요청 무효, 내림 시간 = 올린 시간(`flowerSetupDelay` 기준), 투입 중 내림 요청 무시, 리프트 상태에서 슈팅 / 흡입 불가. 새 타입 `ActionRequest`.
- **입력 계층 (3.6항):** `inputConfig.ts` 키 매핑(표준 Gamepad 0부터: LT 6 흡입, RT 7 발사, A 0 리프트 토글, B 1 투입 / 키보드 WASD · ← → · m , . /), 장치 배정(패드 0 → R1, 패드 1 → R2, 키보드 → R2 비공개 디버그), 데드존, 필드 기준(기본) / 로봇 기준 조작, 우선순위 `SHOOTING > FLOWER_DROPPING > FLOWER_SETUP > INTAKING`, 리프트 토글의 엔진 상태 유도, 짧은 탭 래치.
- **8비트 양자화 / 입력 로그:** 로봇별 틱당 4 B, 입력 수신 시점 부호화 → 복호화 후 엔진 입력, 로봇별 입력 출처(`LIVE` / `REPLAY` / `NONE`)와 녹화 덧입히기.
- **실시간 루프:** 20 ms 누산기, 따라잡기 상한 5틱, 포커스 소실 / 탭 숨김 / 패드 분리 시 자동 일시정지(누산 시간 · 입력 초기화, 일시정지 틱에서 재개), 새로고침 등으로 사라진 경기는 폐기.
- **측정:** 풀매치 타임라인 힙 약 46 MB, `runFullMatch()` 약 1.6초 (Node, 로봇 1대 주행 입력).

### 6.3 남은 Step (권장 순서)

> 모든 Step은 완료 시 `npm test`(엔진 회귀 테스트)가 통과해야 하며, 새로 추가한 규칙에는 테스트 그룹을 추가한다.

- **Step 6 — 탄도 모듈 + 발사 비행 처리 (`src/core/ballistics.ts`):** 06-1(명세), 06-2(탄도 계산), 06-3(LUT 생성), 06-4(판정 / LUT 정밀화), 06-5(판정 함수), 06-6(비행 처리) 완료 — Step 6 완료.
    - ~~06-2: 탄도 계산 함수 ($v_0$ 닫힌 해, 비행 시간, 사거리 R, HIVE 직육면체 교차) + 테스트.~~ (완료, 6.2.3)
    - ~~06-3: 몬테카를로 명중 판정, 기물 종류별 v0 탐색, 기준 셀 72 × 72 LUT 생성, 4-Cell 대칭 복사 (로봇당 8장, 합계 16장).~~ (완료, 6.2.4)
    - ~~06-5: `createLUTShotResolver(luts, r1Config, r2Config)`: 쌍선형 보간 조회(`sampleLUT`) + 조준 판정(FIXED 허용 오차 / TURRET 회전 범위) → 엔진 생성자에 주입 (엔진 수정 불필요).~~ (완료, 6.2.6)
    - ~~06-6: 2.6.2항의 발사 비행 처리 구현 (`IN_FLIGHT`, 비행 대기열, 도착 규칙, 착지 속도) + 엔진 회귀 테스트.~~ (완료, 6.2.7)
- **Step 7 — 입력 계층 및 실시간 루프 (상세 규칙 3.6항, 리프트 FSM 2.6.3항):** 07-1(명세) 완료.
    - ~~07-1: 입력 계층 / 실시간 루프 / 리프트 FSM 명세 구체화.~~ (완료, 6.2.8)
    - 07-2: 엔진 리프트 FSM — `types.ts`(`actionState`에 `FLOWER_READY` / `FLOWER_LOWERING`, `ActionRequest`), `simulationEngine.ts`(요청 처리 / 완료 처리). 기존 FLOWER 테스트(D / N / O)를 두 단계 흐름(올림 → 투입)으로 갱신하고 리프트 FSM 테스트 그룹 추가 (`IDLE` 투입 무효, 대기 / 연속 투입 / 대기 복귀, 올리는 중 내림 = 올린 시간, 대기 중 내림 = `flowerSetupDelay`, 제동 중 취소 즉시 `IDLE`, 투입 / 내림 중 요청 무시, 투입 불가 시 대기 유지, 리프트 상태 슈팅 / 흡입 불가).
    - 07-3: `src/input/inputConfig.ts` + 순수 변환 — 장치 합성(R2 = 패드 1 + 키보드), 축 처리(데드존, 키보드 정규화, `FIELD` / `ROBOT`), 행동 요청 결정(리프트 의도 유도, 리프트 중 트리거 무시, 우선순위), 탭 래치 누적기, 8비트 부호화 / 복호화 + 단위 테스트.
    - 07-4: 입력 로그 + 로봇별 입력 출처(`LIVE` / `REPLAY` / `NONE`) + 녹화 덧입히기 — 되감은 틱 이후 `LIVE` 로그 폐기, 로그 기반 `inputProvider`. 테스트: 실시간 결과 = 로그 재생 결과(비트 동일), 2회차에서 R1 명령 재생 + R2 실시간, 분기 시 로그 절단.
    - 07-5: 실시간 루프 컨트롤러 — 20 ms 누산기, 따라잡기 상한 5틱, 일시정지 / 재개(누산 시간 · 입력 누적기 초기화, 일시정지 틱에서 재개), 경기 종료 자동 정지. 시계 / 스케줄러 주입으로 가짜 시간 테스트 (순간 끊김, 탭 숨김, 재개).
    - 07-6: 브라우저 어댑터 — Gamepad 폴링(슬롯 배정, 표준 매핑 확인), 키보드(`event.code`, `preventDefault`, 입력 폼 무시, 자동 반복 제외, `KEYBOARD_ENABLED`), `requestAnimationFrame` 스케줄러, `visibilitychange` / `blur` / `gamepaddisconnected` → 일시정지. 헤드리스 Chromium 점검(가짜 `navigator.getGamepads`, 키 이벤트). 화면 연결은 Step 8.
- **Step 8 — 렌더러 엔진 연결:** `TimelineFrame` 기반 렌더링 (로봇 OBB/헤딩, 인테이크 구역 시각화, 기물, HIVE 셀 개수/팁, FLOWER 게이지(지그재그 적층 표시 보정 필요), 비행 공 보간(비행 대기열 출발점 → 도착점 선형 보간 + 높이 연출, 2.6.2항), 대기 중 휴먼 NECTAR 표시).
- **Step 9 — 웹 GUI (React):**
    - 로봇 설정 폼: 제원, `BumperZone` 편집기(면/offset/width/depth, FRONT/ANY 프리셋, 로봇 기준 앞이 위인 미리보기), `maxControlledPieces`.
    - 시나리오 설정: 진영, 시작 자세 드래그/회전(배치 검증), 적재물 목록, FLOWER/GARDEN/HIVE 잔여 수, 오토 팁, 시드 — `validateScenario()` 결과가 비어 있지 않으면 확정 버튼 비활성화.
    - 로봇별 탄도 설정(`BallisticsConfig`) 및 스윗스팟 한 점 입력(144 × 144 격자(1 in) 클릭, 조준점을 향한 로봇 몸체 윤곽 / 검증 실패 사유 미리보기, 검증 규칙 2.6.2항), 스크러버/재생 컨트롤, 스코어보드/RP.
    - LUT 생성 실행 / 사용자 경험 (2.6.2항 "LUT 생성 실행 / 사용자 경험" 1~4): ① `ballistics.ts` 사전 준비(`generateReferenceLUTRows`, 시드 파생 공개, 분할 동일성 테스트) → ② Worker 풀 + 작업 대기열 + 조립 → ③ 로봇별 상태 머신 / 취소 / 시뮬레이션 시작 버튼 잠금 → ④ v0 선표시 / 진행 막대 / 남은 시간 / 점진 히트맵 → ⑤ IndexedDB 캐시(`BALLISTICS_MODEL_VERSION` 포함) 순서로 구현.
    - 입력 관련 (3.6항): 게임패드 연결 상태 표시(읽기 전용 — 슬롯별 패드 이름, 배정 로봇, 비표준 매핑 경고, "버튼을 한 번 눌러 연결" 안내, 매핑 편집 없음, 키보드는 표시 / 안내하지 않음), 로봇별 조작 모드(`FIELD` / `ROBOT`) 선택, 일시정지 / 재개 컨트롤, 로봇별 입력 출처 선택(녹화 덧입히기 흐름).
- **Step 10 — 분기 타임라인 및 경기 저장/공유:** 분기 트리(부모 프레임 공유, 분기 이후 프레임만 생성), 저장 레시피(설정 + 시나리오 + 시드 + 양자화 입력 로그 + 탄도 설정 / LUT 시드 / 샘플 수 / `BALLISTICS_MODEL_VERSION` + 엔진 버전 + 상태 체크섬, LUT 자체는 저장하지 않고 캐시 또는 재생성). 레시피 약 50 KB 수준으로 파일/IndexedDB 저장 가능. 입력 로그 형식(로봇별 틱당 4 B, 8비트)은 3.6항, 저장 시 연속 중복 압축.

### 6.4 보류 / 후속 검토 항목

- **시작 자세 배치 검증:** `validateRobotPlacement()`(필드 경계/HIVE/FLOWER/다른 로봇/기물 겹침, `collision.ts` 재사용)와 `reset()` 사전 보정(0번 프레임 이전 겹침 해소) — Step 9 GUI와 함께 구현 권장.
- **1프레임 겹침 스폰:** HIVE 팁 낙하 착지 지점, 발사 비행의 바닥 착지 / 반사 방출 지점이 그 사이 이동한 로봇이나 기물 위일 수 있음 (다음 틱 충돌 처리로 밀려남). 비행 중 FLOWER 원통과의 충돌도 무시.
- **조준 오차에 따른 비행 연출:** 고정형 슈터가 허용 오차 안에서 비스듬히 쏜 명중도 조준점으로 도착 처리 (LUT 결과 우선). 연출상 지면 직선과 조준점 사이 최대 약 ±3° 어긋남.
- **FLOWER 투입 방향 구역(`flowerDropZones`):** v1은 방향 무관(도달 거리 1.0 in). 필드 테스트 후 필요 시 `BumperZone` 재사용.
- **바닥 잔여 공 직접 배치 GUI:** v1 이후 (현재는 무작위 산포).
- **실측 보정:** FLOWER 용량 테이블, HIVE 팁 임계 테이블, 빗맞음 방출 파라미터, 착지 속도 유지 비율(`landingSpeedRetention`, 실측 방법 2.5항), 슈터 편차 파라미터(실측 명중률로 보정)는 실측 데이터 확보 시 교체.
- **저정밀 LUT 미리보기 (불채택):** 샘플을 줄인 빠른 미리보기 LUT를 먼저 보여주고 정밀본으로 교체하는 방식은 채택하지 않음. 미리보기로 경기를 돌리면 저장 레시피 재현 시 결과가 달라져 결정론이 깨지고, 표시용으로만 제한해도 정밀본과 달라 보이는 혼란이 생김. 대신 정밀본을 행 단위로 점진 표시 (2.6.2항 진행 상황 표시).
- **경기 자동 저장 / 복구:** v1은 새로고침 / 크래시 시 경기 폐기 (3.6항). 입력 로그를 주기적으로 저장해 두면 로그 재생으로 복구할 수 있으므로 필요 시 Step 10 이후 검토.
- **키보드 입력:** 개발자 디버그용 비공개 입력 (3.6항). 정식 배포 시 `KEYBOARD_ENABLED = false`로 비활성화 검토.
- **리프트 상태 주행:** v1은 리프트 상태 전체(올림 / 대기 / 투입 / 내림)를 Stationary Lock으로 둔다. 실제 로봇이 리프트를 올린 채 미세 이동이 가능하면 대기 상태의 저속 주행 허용을 검토.
- **교차 브라우저 결정론:** `Math.sin/cos/hypot` 등 초월함수 결과가 JS 엔진마다 최하위 비트에서 다를 수 있어, 다른 브라우저 간 리플레이는 비트 단위 동일성이 보장되지 않음 (저장 레시피에 상태 체크섬 포함 권장).
