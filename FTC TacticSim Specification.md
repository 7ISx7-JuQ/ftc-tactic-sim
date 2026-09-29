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
    - 공기 저항을 무시하므로 비행 중 수평 속도는 v0·cosθ로 일정하다. 그러나 실제 공은 바닥(EVA 폼 타일)에 떨어질 때 여러 번 튀면서 에너지를 잃어, 굴러가기 시작하는 수평 속도가 v0·cosθ보다 훨씬 작다. 이 손실을 착지 순간 한 번에 반영하여, 빗맞음 바닥 착지 기물의 초기 속도 = 발사 방향 × v0·cosθ × `landingSpeedRetention`. HIVE에 맞고 반사되어 떨어진 기물도 착지 순간 수평 속도 × 같은 비율로 굴러가기 시작한다 (2.6.2항 충돌 후 낙하, 08-2).
    - (보정 전 예) 발사각 45°, 거리 60 in, 발사구 높이 12 in이면 v0 ≈ 274 in/s, 수평 194 in/s → 손실 없이 굴리면 POLLEN 마찰 65 in/s²로 약 290 in를 굴러 필드를 가로지름.
    - **실측 방법:** ① 슈터를 고정하고 바닥을 향해(HIVE를 피해) 기물 종류별로 여러 번(예: 10회 이상) 발사하며 측면에서 고fps 영상 촬영. ② 발사구 → 첫 착지 지점의 수평 거리 ÷ 비행 시간(프레임 수 ÷ fps)으로 착지 직전 수평 속도 v_h 측정 (또는 v0·cosθ 계산값 사용). ③ 첫 착지 지점 → 최종 정지 지점의 거리 L 측정. ④ 착지 후 운동을 마찰 감속도 a(POLLEN 65, NECTAR 85 in/s²)의 등감속 구름으로 보면 굴러가기 시작한 속도 = √(2·a·L)이므로 `landingSpeedRetention = √(2·a·L) / v_h`. ⑤ 반복 측정 평균값을 사용. (마찰 감속도 자체도 실측으로 검증하면 더 정확함: 알려진 속도로 굴린 공의 정지 거리 측정)

### 2.6 득점 및 구조물 로직 (Scoring Mechanics)

1. **HIVE (벌집) 팁 및 시차 낙하 로직:**
    - **초기 상태:** Red는 `AUDIENCE_CELL`이 위(UP)를, Blue는 `OPPOSITE_CELL`이 위(UP)를 향하도록 고정 시작.
    - **팁 임계 테이블 (`HIVE_TIP_POLLEN_BY_NECTAR`, FLOWER 용량 테이블과 같은 구조):** 상향 셀의 NECTAR 개수별로 팁이 발동하는 POLLEN 개수. 임계 조합 {NECTAR, POLLEN} = {5, 0}, {4, 1}, {3, 3}, {2, 5}, {1, 6}, {0, 8}. 상향 셀 POLLEN ≥ 해당 NECTAR 개수의 임계 POLLEN이면 팁 (NECTAR 5개 이상이면 POLLEN 0개로 즉시 팁). 상향 셀 개수는 NECTAR / POLLEN 별도 집계(`nectarInUpwardCell`, `pollenInUpwardCell`).
    - **팁 발동 시점:** 명중한 공이 **도착한 틱**(발사 비행 처리, 2.6.2항)에 상향 셀이 임계에 도달하면 그 틱에 즉시 팁 상태(`isTipping = true`, `tipProgressTimer = 0`)로 전환. 팁 진행 중(낙하 대기열 방출 완료 전)에 발사된 공은 명중 확률과 무관하게 **전부 빗맞음**이며, 팁 전에 명중으로 발사됐더라도 도착 시점에 팁 진행 중이거나 상향 셀이 발사 시점과 달라졌으면 조준점에서 셀 앞면 바깥으로 반사되어 떨어진다 (무효 명중, 2.6.2항 충돌 후 낙하).
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
        - **GUI 입력 기준 (09-1):** GUI는 현재 시나리오 진영의 공식 시작 상향 셀(RED → `RED_AUDIENCE`, BLUE → `BLUE_OPPOSITE`)을 기준으로 스윗스팟을 입력 / 표시하고, BLUE는 필드 중심 점대칭 (x, y) ↔ (144 − x, 144 − y)로 변환해 저장한다. 저장값(`sweetSpot`)은 항상 `RED_AUDIENCE` 기준이므로 진영 변경은 LUT를 무효화하지 않는다 (3.8항).
            - **구현 (09-2):** `sweetSpotBasisCell(alliance)`, `sweetSpotFromBasis(p, alliance)`(진영 기준 → 저장 좌표), `sweetSpotToBasis(p, alliance)`(저장 좌표 → 진영 기준). 두 변환 모두 **진영 기준 좌표에서 격자 중심으로 스냅한 뒤** 점대칭하여 격자 중심을 반환한다 → 격자 경계 위의 점(예: BLUE (84, 10))도 사용자가 화면에서 본 격자가 그대로 LUT / 검증에 쓰인다 (변환 후 스냅하면 경계에서 옆 격자가 선택됨).
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
            - **`ballistics.ts` 사전 준비 (Step 9 첫 작업, 09-2 구현 완료):**
                - `generateReferenceLUTRows(config, robotSize, pieceType, v0, samples, seed, gyStart, gyEnd, options) → Float32Array((gyEnd − gyStart) × 144)`: `generateReferenceLUT`의 행 범위 버전. 격자 인덱스 / 난수 구간 계산은 전체 LUT 기준 그대로.
                - `generateReferenceLUT`는 `generateReferenceLUTRows(…, 0, 144)`로 재작성하여 코드 중복 제거.
                - 용도별 시드 파생(`deriveSeed(seed, 2i)` 탐색, `deriveSeed(seed, 2i + 1)` LUT)을 공개 함수(예: `robotLUTSeeds(seed)`)로 노출하여 Worker 작업 계획이 `generateRobotLUTs`와 같은 시드를 쓰게 함.
                - 테스트: 임의 행 분할(예: 1행 / 7행 / 불균등)로 계산해 합친 LUT === `generateReferenceLUT` 결과, 작업 계획으로 만든 16장 === `generateRobotLUTs` 결과.
                - **구현 (09-2):** `generateReferenceLUTRows`는 범위를 정수로 내림한 뒤 [0, 144]로 제한하고 `gyEnd < gyStart`면 빈 배열 (반환 행 r = 전체 행 `gyStart + r`). `robotLUTSeeds(seed = DEFAULT_BALLISTICS_SEED) → Record<PieceType, { search, lut }>`(`generateRobotLUTs`도 이 함수를 사용). 리팩터링 전후 `generateRobotLUTs` 결과가 비트 단위로 같음을 확인.
            - **메시지 규약:** 메인 → Worker `{ kind: 'search' | 'rows', jobId, generation, robotId, pieceType, config, robotSize, samples, seed, gyStart?, gyEnd?, v0? }`, Worker → 메인 `{ kind: 'progress', jobId, cellsDone }` (행 1개마다) / `{ kind: 'result', jobId, generation, v0?, hitRate?, rows? }` / `{ kind: 'error', jobId, message }`. 결과 `Float32Array`는 transferable로 넘겨 복사 비용 0.
            - **조립:** 메인 스레드가 (로봇, 기물)별 기준 LUT `Float32Array(144 × 144)`에 행 결과를 복사하고, 모든 행이 모이면 `mirrorLUTSet`으로 4셀을 만들어 `RobotHeatmapLUTs` 완성.
            - **예상 시간:** 8코어 기준 로봇 1대 약 8~10초, 4코어 약 15~20초 (단일 스레드 30~60초 ÷ Worker 수 + 분배 오버헤드). 두 로봇이 동시에 진행되므로 전체 대기도 비슷한 수준. 모바일은 더 느림.
            - **구현 (09-3, `src/workers/`):**
                - `lutProtocol.ts`: 메시지 타입 + 순수 작업 처리기 `handleLUTJob(job, post)` (탐색 = `searchLaunchSpeed` 결과 1회, 행 = 행 1개마다 `progress` 후 `result` + transferable). 닫힌 해가 없으면 `v0` 없는 결과, 예외는 `error` 메시지.
                - `lutWorker.ts`: 처리기 연결만 하는 Worker 진입점. `createLUTWorker.ts`: `new Worker(new URL('./lutWorker.ts', import.meta.url), { type: 'module' })`.
                - `lutManager.ts` (`LUTManager`, Worker 생성 함수 주입): 풀(`defaultLUTPoolSize`, 코어 수를 모르면 4코어로 가정), **v0 탐색 작업이 행 작업보다 우선**(두 번째 로봇의 v0가 첫 번째 로봇 행 작업 뒤로 밀리지 않음), 행 작업은 요청 순서(FIFO), 조립 후 `mirrorLUTSet`으로 완성. 탐색 / LUT 작업에 보내는 설정은 스윗스팟을 스냅한 설정 (행 계산은 스윗스팟과 무관).
                - 상태 스냅샷 `getStatus(robotId)`: 상태 / 세대 / 검증 사유 / 오류 / 기물별 탐색 완료 · v0 · 스윗스팟 명중률 / 완료 격자(실행 중 작업의 행 단위 진행 포함) / 조립 중 기준 LUT + 행별 완료 표시(점진 히트맵용) / 결과. `onChange(robotId)`는 변화마다 호출하고 GUI가 rAF로 모은다. `matchLUTs()` = 두 로봇 `READY`일 때만 경기용 LUT.
                - **재요청 무시:** LUT를 결정하는 입력의 정규화 키 `lutRequestKey`(모델 버전 + 스냅한 스윗스팟 · 편차 기본값을 채운 탄도 설정 + 로봇 길이 / 폭 + 시드 + 샘플 수, 속성 순서 고정 JSON)가 진행 중 / `READY`인 요청과 같으면 아무것도 하지 않는다 (속도 등 무관한 제원 변경으로 다시 `APPLY`해도 재생성 없음). 09-4 캐시 키는 이 문자열의 SHA-256.
                - **오류:** Worker `error` 메시지 / `onerror` / 행 결과 길이 불일치 → 그 로봇 `ERROR`(사유 포함) + 대기 작업 제거, 다른 로봇은 계속. 같은 설정을 다시 요청하면 새로 생성.
                - **실측 (헤드리스 Chromium, 4코어 컨테이너, Worker 3개):** 로봇 2대 × 기물 2종 기본 정밀도(격자당 2000 / 후보당 20000 샘플) 전체 약 9.3초. 개발 서버와 정식 빌드(`lutWorker` 별도 청크) 모두에서 실제 Worker 결과가 `generateRobotLUTs`와 비트 단위로 같음을 확인 (저장소 밖 1회성 점검).
        2. **진행 상황 표시:**
            - **v0 결과 선표시:** 단계 ① 완료 즉시 기물 종류별 v0와 스윗스팟 명중률(`sweetSpotHitRate`) 표시. 0이면 경고 ("이 스윗스팟에서는 명중 불가 — 설정 확인"), 생성은 계속 진행.
            - **진행 막대:** 로봇별 `완료 격자 / 전체 격자` (기물 2종 합산, 전체 = 2 × 20,736). HIVE 겹침 / 도달 불가로 생략되는 격자는 행 처리 시 즉시 완료로 집계. 단계 ① 동안은 "v0 탐색 중" 표시.
            - **남은 시간:** `경과 시간 × (남은 격자 / 완료 격자)`를 지수 평활해 표시하고, 5% 완료 전에는 표시하지 않음 (초반 추정 불안정).
            - **점진 히트맵:** 로봇별 미리보기(09-1: 메인 필드의 히트맵 편집 모드, 3.8항)에 진영 기준 셀 LUT(RED = 기준 셀 `RED_AUDIENCE`, BLUE = 점대칭 `BLUE_OPPOSITE`)를 행 묶음이 도착할 때마다 그림 (미계산 행은 회색 빗금, 기물 종류 전환 가능). 사용자가 명중 띠가 드러나는 과정을 직접 보며 설정이 맞는지 판단할 수 있게 함. 필드 윤곽 / HIVE / 조준점 / 스윗스팟을 함께 표시. 보기는 관중석(`AUDIENCE`) 시점 고정 (3.7항).
            - **갱신 빈도:** 진행 / 히트맵 갱신은 `requestAnimationFrame`으로 모아 최대 약 10 Hz (메시지마다 React 상태를 바꾸지 않음).
        3. **비차단 작업 흐름:**
            - **로봇별 상태 머신:** `IDLE`(설정 없음 / 검증 실패) → `QUEUED` → `SEARCHING`(단계 ①) → `GENERATING`(단계 ②, 진행률) → `READY` | `ERROR`. 설정 변경 시 `CANCELLED`를 거쳐 다시 `QUEUED`.
            - **시작 시점:** 탄도 설정 확정 버튼(로봇 탭 `APPLY`, 검증 `validateBallisticsConfig` 통과 시에만 활성화)을 누를 때. 입력 중 자동 재생성은 하지 않음. **예외 (09-1):** 앱 시작 시 기본 프리셋 / 자동 보관 설정(3.8항)의 LUT는 자동으로 생성한다 (캐시 적중이면 즉시 `READY`).
            - **무효화 조건:** 해당 로봇의 `BallisticsConfig`, 로봇 `length` / `width`(HIVE 겹침 격자 / 검증에 영향), 기준 시드, 샘플 수가 바뀔 때만. 그 외 `RobotConfig` 변경(속도, 인테이크 등)과 시나리오 변경은 LUT를 무효화하지 않음.
            - **취소:** (09-3 구현: `request`의 설정 변경 / `cancel(robotId)`, `cancel`은 진행 중일 때만 `CANCELLED`로 멈추고 `READY`는 유지) 로봇별 세대 번호(`generation`)를 올리고, 대기열의 이전 세대 작업을 제거, 실행 중인 작업의 결과 / 진행 메시지는 세대가 다르면 무시. 행 묶음이 작아(수백 ms) Worker 강제 종료는 하지 않음 (종료 시 풀 재생성 비용 발생).
            - **막는 동작:** 시뮬레이션 시작(및 LUT가 필요한 경기 재생 / 분기 실행)만 두 로봇이 모두 `READY`일 때 활성화하고, 비활성 사유를 표시 ("로봇 2 확률표 생성 중 63%"). 로봇 / 시나리오 / 스윗스팟 편집, 필드 탐색 등 나머지는 모두 계속 가능.
            - **사용 흐름 예:** 로봇 1 탄도 확정 → 생성 시작 → 그동안 로봇 2 입력 / 확정 → 시나리오 입력 → 대부분 입력이 끝날 즈음 생성 완료.
        4. **IndexedDB 캐시:**
            - **캐시 키:** `crypto.subtle.digest('SHA-256')`로 만든 정규화 JSON의 해시 — `{ BALLISTICS_MODEL_VERSION, BallisticsConfig(스윗스팟은 스냅한 좌표, 편차 미지정 값은 기본값으로 채움), robot length / width, seed, samples, searchSamples }`. `skipUnreachable`은 결과가 같으므로 키에서 제외.
            - **`BALLISTICS_MODEL_VERSION`:** `ballistics.ts`의 정수 상수 (09-2에서 1로 시작). 명중 판정 / LUT 생성 규칙 / 투입구 기하가 바뀌는 커밋마다 올려서 이전 캐시를 자동 무효화 (예: 06-4의 진입 면 / 림 벽 판정 변경은 버전 증가 대상).
            - **저장 형식:** DB `ftc-tactic-sim`, 저장소 `lutCache`, 레코드 `{ key, modelVersion, createdAt, lastUsedAt, v0: {POLLEN, NECTAR}, sweetSpotHitRate: {POLLEN, NECTAR}, reference: {POLLEN: ArrayBuffer, NECTAR: ArrayBuffer} }`. 기준 셀 LUT만 저장(로봇당 2 × 82,944 B ≈ 166 KB)하고, 불러올 때 `mirrorLUTSet`으로 4셀 복원 (복원 비용 무시 가능).
            - **정리:** `lastUsedAt` 기준 LRU로 최대 20개(약 3.3 MB) 유지, 초과분은 저장 시 삭제.
            - **조회 흐름:** 확정 시 캐시 먼저 조회 → 적중하면 즉시 `READY` (Worker 미사용) → 없으면 생성 후 저장.
            - **저장 레시피(Step 10)와의 관계:** 레시피에는 LUT 대신 탄도 설정 + 시드 + 샘플 수 + `BALLISTICS_MODEL_VERSION`을 저장. 불러올 때 캐시가 있으면 즉시, 없으면 위 생성 흐름을 탐. 레시피의 모델 버전이 현재와 다르면 "재생성한 확률표로 결과가 달라질 수 있음"을 경고.
            - **실패 허용:** IndexedDB를 쓸 수 없으면(사생활 보호 모드, 용량 초과 등) 캐시 없이 매번 생성하며 기능은 동일.
            - **구현 (09-4, `src/workers/lutCache.ts`):**
                - 관리자용 인터페이스 `LUTCache { get(requestKey), put(requestKey, entry) }` (요청 키 원문 = `lutRequestKey`, 내부에서 `lutCacheKey` = SHA-256 16진 64자). 캐시 내용 `LUTCacheEntry` = 기물별 v0 / 스윗스팟 명중률 / 기준 셀 LUT.
                - 순수 규칙: `entryToRecord`(버퍼 복사, 모델 버전 / 시각 기록), `recordToEntry`(모델 버전 불일치 · 버퍼 길이 ≠ 82,944 B · v0 비유한값 · 명중률 누락 → 미스), `recordsToEvict`(다른 모델 버전 전부 + 현재 버전 최근 사용 순 20개 초과분, 동률은 키 순).
                - `StoreLUTCache(store)`: 레코드 저장소(`LUTRecordStore { get, put, list, delete }`) 위의 캐시. 적중 시 `lastUsedAt`만 갱신, 같은 키 재저장은 `createdAt` 유지, 저장 후 정리. `openIndexedDBRecordStore()`: DB `ftc-tactic-sim` / 저장소 `lutCache`(keyPath `key`), IndexedDB가 없거나 열기 실패면 `null`.
                - `createBrowserLUTCache()`: 앱 시작 시 동기로 만들어 관리자에 주입, 첫 사용 때 연다. IndexedDB 또는 `crypto.subtle`(비보안 연결 등)이 없으면 조회는 항상 미스, 저장은 무시.
                - **관리자 연동 (`LUTManagerOptions.cache`):** 요청 → `QUEUED`에서 캐시 조회 → 적중: Worker 작업 없이 기준 LUT 복원 + 4셀 대칭 복사 → `READY`(`fromCache = true`), 미스 / 조회 실패(비동기 · 동기 예외): v0 탐색부터 생성 → `READY` 직후 저장(저장 실패 무시). 적중 결과는 다시 저장하지 않는다. 조회가 끝났을 때 그 사이 재요청 / 취소 / 정리로 실행이 바뀌었으면 결과를 버린다 (옛 요청의 미스가 작업을 보내지 않음). 캐시를 주입하지 않으면 09-3과 같이 즉시 생성.
    - **런타임 판정 (`createLUTShotResolver(luts, r1Config, r2Config)`, 06-5 구현 완료):** 엔진 생성자에 주입하는 `ShotProbabilityResolver` (엔진 수정 없음). 엔진은 발사 완료 틱에 `(robotId, pieceType, robot.x, robot.y, robot.heading, alliance, upwardCell)`로 호출하고, 반환 확률과 시드 난수 1회로 명중을 정한다.
        - **입력:** `luts: MatchHeatmapLUTs` (로봇 슬롯별 `RobotHeatmapLUTs`), `r1Config` / `r2Config`의 `turretType` / `turretRange` / `aimTolerance`. 슈터 설정은 생성 시점에 복사해 고정한다 (이후 원본 객체 변경이 경기 중 판정에 새지 않음 → 결정론).
        - **$P_{\text{spatial}}$:** `luts[robotId][pieceType][hiveCellKey(alliance, upwardCell)]`를 로봇 중심 좌표에서 **쌍선형 보간**(`sampleLUT`)으로 조회. 둘러싼 격자 중심 4개 값을 거리 비례로 섞고, 필드 가장자리 격자 중심 바깥은 가장자리 값. 셀 키 = `${alliance}_${AUDIENCE | OPPOSITE}`. 팁으로 상향 셀이 바뀌면 다음 발사부터 새 셀의 LUT와 조준점을 쓴다.
        - **조준 오차:** $\Delta\psi$ = `angleDifference(조준점 방위, heading)` = 조준점 방위 − 헤딩, [-π, π] (`kinematics.ts` 재사용). 조준점 방위는 로봇 중심 → 상향 셀 조준점(투입구 오각형 면적 중심). 부호: + = 로봇 오른쪽 (캔버스 y-down에서 각도가 커지는 방향).
        - **조준 판정 (`isAimWithinShooterRange`):**
            - **고정형(`FIXED`):** $|\Delta\psi| \le$ `aimTolerance`(기본 3° ≈ 0.0524 rad, 경계 포함)이면 $P_{\text{final}} = P_{\text{spatial}}$, 아니면 0. 허용 오차가 비유한값 / 음수면 0으로 취급 (정확히 정렬될 때만).
            - **터렛형(`TURRET`):** `turretRange` $[\alpha, \beta]$를 [-π, π]로 정규화 (`normalizeAngle`은 ±π를 보존하므로 360° 터렛 [-π, π] 유지). $\alpha \le \beta$면 $\alpha \le \Delta\psi \le \beta$, $\alpha > \beta$면 ±π를 가로지르는 구간 ($\Delta\psi \ge \alpha$ 또는 $\Delta\psi \le \beta$, 예: 후방 터렛 [2.5, −2.5]). 범위가 비유한값이면 조준 불가.
            - 한계: 허용 오차 / 터렛 범위 안이면 조준 오차에 따른 명중률 감소는 반영하지 않는다 (LUT는 정면 조준 가정). 고정형은 허용 오차가 작아(±3°) 영향이 작다.
        - **안전장치:** LUT 값이 비유한값이면 0, 결과는 [0, 1]로 제한 (엔진도 한 번 더 제한).
    - **발사 비행 처리 (06-6 구현 완료, 08-2 충돌 후 낙하 개정):**
        - **목표:** 발사 순간 공이 HIVE로 순간이동하는 부자연스러움을 없애되, 결과(명중 여부)는 LUT 판정을 그대로 따르고, 3D 물리 엔진 없이 닫힌 해로 계산한다.
        - **범위 분리:** 엔진은 궤도 결과(충돌 / 도착 지점, 충돌 후 낙하 구간, 최종 착지 지점 / 시점 / 속도)를 발사 시점에 계산해 비행 대기열에 기록하고 도착 틱에 반영한다. 이 기록을 보간하는 렌더링은 Step 8 (3.7항).
        - **08-2 개정 배경:** 06-6은 HIVE / 벽에 공중에서 닿은 공을 그 틱에 바로 바닥에 놓았다(HIVE 반사 방출은 외곽 바닥에 무작위 속도 20~60 in/s). 화면에서 공이 최대 약 66 in 높이에서 1프레임 만에 바닥으로 옮겨지므로, 충돌 후 바닥까지의 낙하를 비행의 일부(반사 포물선)로 계산하도록 바꿨다. 낙하 중에는 `IN_FLIGHT`라 흡입 / 충돌 대상이 아니다 (현실과 일치).
        - **슈터 탄도 입력:** 엔진 생성자 선택 인자 `SimulationEngine(r1, r2, shotResolver, alliance?, scenario?, shooters?: MatchShooterBallistics)`. 로봇별 `ShooterBallistics {dz, shooterPitch, shooterOffset, v0?: {POLLEN?, NECTAR?}}` — LUT 생성 결과에서 `shooterBallisticsFrom(config, generateRobotLUTs 결과)`로 만든다 (판정 LUT와 같은 발사구 / 발사각 / 탐색 v0). 미지정 시 기본 자동 슈터 `DEFAULT_SHOOTER_BALLISTICS`(발사구 14 in, 발사각 60°, 오프셋 0, v0는 발사마다 조준점 닫힌 해). 생성 시점에 복사해 고정.
        - **결과 선확정 / 난수:** 발사 완료 틱에 판정 함수 확률과 시드 PRNG 난수로 명중을 확정한다. 난수는 발사마다 **항상 3회**(명중 판정, 반사 세기 산포 `bounceRestitutionRoll`, 반사 방향 산포 `bounceAngleRoll`) 소비하고 도착 시점에는 쓰지 않는다 (무효 명중의 반사도 발사 시점에 뽑아 둔 값 사용) → 결과와 무관하게 RNG 시퀀스 일정, 결정론 유지. 팁 진행 중 발사는 발사 시점에 빗맞음.
        - **명목 궤적 (`planShotFlight`, 편차 없는 포물선, 발사 1회당 상수 시간):**
            - 발사 방향 (`shotLaunchHeading`): 고정형 = 로봇 헤딩, 터렛형 = 조준점 방위 (터렛 범위 밖이면 가까운 한계각으로 제한).
            - 발사구 = 로봇 중심 + 발사 방향 × `shooterOffset`, 높이 53.5 − dz. 발사각이 (0, π/2) 밖이면 기본값.
            - v0 우선순위: 탄도 설정의 기물별 v0 → 조준점 닫힌 해 → (해가 없으면) 평지 사거리 = 조준점 거리인 속도 $\sqrt{g D / \sin 2\theta}$.
        - **도착 규칙:**
            - **명중:** 궤적과 무관하게 조준점에 도착 (LUT 결과 우선). 비행 시간 $T = D / (v_0\cos\theta)$ (D = 발사구 → 조준점 수평 거리).
            - **빗맞음 + HIVE 충돌 (`intersectHiveBox`):** HIVE 직육면체를 기물 반지름만큼 확장(xy 경계 ± r, 높이 `HIVE_HEIGHT` + r, 공 표면 접촉 기준)하고, 지면 직선이 확장 AABB 안에 있는 구간(착지 전까지)에서 공 중심 높이가 확장 높이 이하가 되는 첫 지점이 있으면 (진입 순간 이미 낮으면 옆면 `SIDE`, 위로 들어와 구간 안에서 내려오면 윗면 `TOP`) 그 접촉점에서 아래 **충돌 후 낙하** 규칙으로 반사해 바닥까지 떨어진다.
            - **빗맞음 + HIVE를 넘어가거나 닿지 않음:** 공 중심 높이가 기물 반지름이 되는 시점의 수평 거리 R 지점에 착지. 착지 후 발사 방향 수평 속도 = $v_0\cos\theta$ × `landingSpeedRetention`(2.5항)을 가진 `ON_FIELD` 기물로 전환되고, 이후는 기존 물리가 처리. 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 **벽 접촉점(공중)에서 수평 이동을 멈추고 수직으로 낙하**해 벽 앞 바닥에 속도 0으로 착지한다.
            - 고정형 슈터는 조준 이탈 시 확률 0이고 직선도 조준점을 비껴가므로 판정과 연출이 일치한다.
        - **충돌 후 낙하 (`planHiveBounce` / `planFallToFloor` / `planVoidedHitBounce`, 08-2):** 충돌 순간 상태(위치, 속도: 수평 $v_0\cos\theta$ 발사 방향, 수직 $v_0\sin\theta - g t$)에서 반사한 뒤 중력 포물선으로 바닥(공 중심 z = r)까지 떨어진다. 모두 닫힌 해이며 구간 목록(`FlightSegment`)으로 기록한다.
            - **반발 계수:** 기물별 `restitution`(POLLEN 0.35 / NECTAR 0.25, 2.5항) × 반사 세기 산포 (1 + 0.2 · (2 · `bounceRestitutionRoll` − 1)), 즉 0.8~1.2배 (`HIVE_BOUNCE_RESTITUTION_SPREAD`).
            - **옆면 (`SIDE`):** 접촉 면(확장 AABB에서 가장 가까운 면, 모서리 동률이면 속도가 더 깊이 파고드는 면)의 수평 바깥 법선 n으로, 파고드는 법선 성분만 $v_n \to -e\,v_n$ (접선 / 수직 성분 유지). 이어서 수평 속도를 반사 방향 산포 ±15°(`HIVE_BOUNCE_ANGLE_SPREAD`, `bounceAngleRoll`)만큼 회전하고, 바깥 법선 성분이 `HIVE_BOUNCE_MIN_SPEED`(20 in/s)보다 작으면 법선 방향으로 보충한다 (스치듯 맞아도 반드시 HIVE에서 멀어짐). 그 뒤 바닥까지 포물선.
            - **윗면 (`TOP`) 반복 튐:** 추상화 직육면체의 윗면(z = `HIVE_HEIGHT` + r)에 떨어진 공은 수직 속도만 $v_z \to e\,|v_z|$로 뒤집고 수평 속도는 유지한다 (첫 튐에서 ±15° 산포 회전). 다시 윗면 높이로 내려오기 전(체공 $2 v_z / g$)에 확장 AABB를 벗어나면 그 포물선 그대로 바닥까지 떨어지고 (수평 직선 + 볼록 박스이므로 다시 부딪히지 않음), 아니면 윗면에 다시 떨어져 튄다. 최대 `HIVE_TOP_MAX_BOUNCES`(3)회 튀고도 윗면 위면, 수평 속도 방향(정지 상태면 가장 가까운 면 바깥)으로 속도 max(수평 속도, 20 in/s)로 윗면을 굴러(`ROLL` 구간, 높이 유지) 가장자리에서 수직 속도 0으로 떨어진다. 실제 HIVE 윗부분은 평판이 아니므로 "윗면에 맞으면 낮게 튀며 진행 방향으로 넘어간다"를 근사한 것이며, HIVE 위에 걸려 멈추는 경우는 모델링하지 않는다.
            - **무효 명중:** 명중으로 발사됐지만 도착 시점에 전복 중이거나 상향 셀이 바뀐 공은 조준점에서 그 셀 쪽 HIVE 앞면의 수평 바깥 법선(AUDIENCE +y / OPPOSITE −y)으로 옆면 규칙과 같이 반사해 떨어진다. 도착 속도의 수평 방향은 발사구 → 조준점 (렌더러 명목 구간과 같은 방향). 결과는 `MISS_HIVE`로 바뀌고 착지 틱이 늦춰진다.
            - **벽:** 모든 낙하 포물선에서 지면 직선이 착지 전에 필드 벽(반지름 여유)에 닿으면 그 지점에서 수평 이동을 멈추고 수직 낙하한다 (착지 속도 0). 즉 **높이 무한 · 반발 계수 0인 벽**을 가정한다. 실제 경기에서는 벽보다 높이 날아간 공이 필드 밖으로 나가기도 하지만 이는 전술이 아닌 실수이므로 구현하지 않는다. 필드 테스트에서 어색하면 반발 계수 > 0인 벽 반사로 바꾼다 (구조 동일).
            - **착지:** 착지 속도 = 착지 순간 수평 속도 × `landingSpeedRetention` (벽 정지 시 0). 안전장치로 착지점을 필드 안 / HIVE 확장 AABB 밖으로 제한한다 (발사구가 HIVE에 걸친 비정상 입력에서만 작동).
        - **비행 대기열 (`FieldState.pendingShots: PendingShot[]`, 발사 순서):** `{pieceId, pieceType, robotId, result('HIT' | 'MISS_HIVE' | 'MISS_FLOOR'), targetCell(발사 시점 상향 셀), launchTick, arriveTick, contactTime, fromX/Y/Z, toX/Y/Z, heading, v0, pitch, segments: FlightSegment[], landX/Y, landingVx/Vy, bounceRestitutionRoll, bounceAngleRoll}` (4장). 발사 시 기물 상태를 `IN_FLIGHT`로 바꾸고 좌표는 발사구 지면 투영, 속도 0.
            - 명목 구간: 발사구(`from`) → `to`(명중 = 조준점, HIVE 충돌 = 첫 접촉점, 벽 = 벽 접촉점, 바닥 = 착지점), 끝 시각 `contactTime`(발사 후 초). 충돌 후 구간 `segments`는 시간순, 각 구간 `{kind: 'BALLISTIC' | 'ROLL', t0, t1, x, y, z, vx, vy, vz}`(발사 후 초, 구간 시작 상태). 마지막 구간 끝 = 착지점 `landX/Y`. 빈 배열이면 명목 구간 끝이 착지점(또는 명중).
            - 도착 틱: 명중 = 발사 틱 + max(1, round(`contactTime` / dt)) (조준점 도착, 유효성 판정), 그 외 = 발사 틱 + max(1, round(최종 착지 시각 / dt)).
            - 파이프라인 Step 5-2(HIVE 시차 낙하 다음)에서 도착 틱이 된 발사를 발사 순서대로 처리: 명중은 **도착 시점에 전복 중이 아니고 상향 셀이 발사 시점과 같을 때만** HIVE 적재 + 팁 판정 (같은 틱에 두 발이 도착하면 앞 발의 팁이 뒤 발을 무효화), 무효면 조준점에서 반사 낙하 구간을 붙이고 `MISS_HIVE`로 바꿔 착지 틱(현재 틱 이후)까지 비행 유지. 그 외는 착지점 / 착지 속도로 `ON_FIELD`.
            - 비행 중(낙하 포함) 기물은 로봇 / 기물 / FLOWER 위를 지나므로 충돌하지 않는다 (물리 / 충돌은 `ON_FIELD`만 대상). 착지 지점이 로봇이나 기물과 겹치면 다음 틱 충돌 처리로 밀려남.
            - 경기 종료(6000틱)까지 도착하지 못한 비행은 득점에 반영하지 않는다 (기물은 `IN_FLIGHT`로 남음).
            - 타임라인 스냅샷은 대기열 배열 / 항목 / 구간 목록을 복제해 기록 보호.
        - **렌더링 (Step 8, 3.7항 확정):** 렌더러는 명목 구간을 출발점 → `to` 선형 보간 + 명목 포물선 높이에 끝점을 맞추는 선형 보정으로, 충돌 후 구간은 기록된 포물선 / 굴러감을 그대로 계산해 기물 크기 / 그림자 오프셋으로 연출한다. 필요한 정보가 모두 프레임에 있으므로 스크러빙 / 분기 재생에서도 동일하게 재현된다.
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
        - **리프트 FSM (07-1 확정, 07-2 구현 완료 — 이전 "요청 1회 → 준비 → 자동 투입" 흐름을 대체):** 리프트를 올리고(준비) → 올린 채 대기 → 투입 → 내리는 단계를 분리하여, 드라이버가 리프트를 올린 뒤 투입 시점을 고르고 실수로 올린 리프트를 다시 내릴 수 있게 한다.
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
        - **득점 내역 기록 (08-1 확정, 08-3 구현 완료):** 종료 프레임에는 항목별 점수와 인정 근거(득점 FLOWER, 인정 GARDEN 기물 id, 주차 로봇)를 `TimelineFrame.scoreBreakdown`에 함께 기록하고, 그 외 프레임은 `null`이다. 항목 합 = `totalScore`. 렌더러의 경기 종료 강조(3.7항)와 Step 9 스코어보드가 이 기록만 읽으며 득점 규칙을 다시 계산하지 않는다 (규칙의 단일 출처 = 엔진).
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
    - Step 5-2: 발사 비행 도착 (`stepShotArrivals`): 도착 틱이 된 발사를 발사 순서대로 명중 적재 / 무효 명중 반사 낙하 연장 / 최종 착지 (2.6.2항)
5. **Slew Rate Limiter:** RoadRunner / Pedro Pathing 오도메트리 제원 기반 속도 선형 보간.
6. **입력 계층 및 실시간 루프 (Step 7, 07-1 확정):** 엔진 바깥의 순수 TS 계층이 장치 입력을 틱별 `RobotDriveInput`으로 만들어 엔진에 넣는다. 엔진 입력 인터페이스(`step(r1Input, r2Input)`, `inputProvider`)는 그대로 쓴다.
    - **모듈 구성 (`src/input/`):**
        - `inputConfig.ts`: 키 매핑 / 데드존 / 임계값 / 장치 배정 / 루프 상수를 한곳에 모은 설정 파일 (`collision.ts` 실측 상수처럼 값만 바꿔 조정). 매핑 편집 GUI는 두지 않는다.
        - 순수 변환(축 처리, 행동 요청 결정, 탭 래치, 양자화), 입력 로그 / 입력 출처, 실시간 루프 컨트롤러: DOM 비의존, 시계 / 스케줄러 / 원시 입력을 주입받아 Node(Vitest)에서 가짜 시간으로 테스트.
        - 브라우저 어댑터(Gamepad 폴링, 키보드 이벤트, `requestAnimationFrame`, 포커스 / 가시성 이벤트): 원시 입력 수집과 콜백 연결만 하는 얇은 층. 구현 `src/input/browserInput.ts`(07-6): `BrowserInputAdapter`(브라우저 환경 객체 주입 가능, `attach(onPause)` / `detach`, 루프의 `poll()`에서 배정 슬롯 게임패드 폴링 + 눌린 키 재샘플, `gamepadStatus()` 슬롯별 연결 / 표준 매핑 — Step 9 연결 표시용), `createAnimationFrameScheduler`, `createBrowserRealtimeLoop(engine, inputs, hooks)` → `{loop, adapter, dispose}`. 포커스 소실 / 탭 숨김 시 어댑터가 눌린 키 집합을 비운 뒤 일시정지를 요청한다 (키를 뗀 이벤트 유실 대비). 사용자 일시정지 / 재개에서는 키 집합을 유지해 누르고 있는 키가 다음 폴링에서 복원된다.
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
        - **(09-1 변경)** 키보드 주행은 정식 기능으로 유지하되 SETTINGS 탭의 런타임 토글(기본 켬)로 끌 수 있다 (`KEYBOARD_ENABLED` 상수는 토글 기본값 역할). 끄면 주행 키만 무시하고, 일시정지 / 스크러빙 단축키(Space, ← / →, Shift + ← / →)는 상태별로 키를 공유해 항상 동작한다 (3.8항).
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
        - 로그는 로봇별 채널 `{ data: Int8Array(6000 × 4), length }` (`src/input/inputLog.ts`의 `InputLogChannel`). 인덱스 t = 틱 t → t + 1 스텝에 쓰인 입력 (`DriveInputProvider`의 tick 규약과 동일). 틱 t에 쓰면 t 이후 기록은 폐기되고, 기록 끝보다 뒤에 쓰면 사이 틱은 중립(0, 0, 0, `IDLE`)으로 채운다 (예: 1회차 `NONE`이던 로봇을 중간 틱부터 `LIVE`로 기록).
        - 로봇별 입력 출처 `InputSource = 'LIVE' | 'REPLAY' | 'NONE'`:
            - `LIVE`: 장치 입력 → 축 처리 / 요청 결정 → 부호화 → 로그 t에 기록 → 복호화 → 엔진.
            - `REPLAY`: 로그 t 복호화 → 엔진. 기록 길이를 넘은 틱은 `NONE`과 같음.
            - `NONE`: 0 입력 + `IDLE` (기록하지 않음).
        - **녹화 덧입히기:** 1회차 R1 `LIVE` / R2 `NONE`으로 R1 입력 기록 → 원하는 틱으로 되감기(`scrubTo`) → 2회차 R1 `REPLAY` / R2 `LIVE`로 한 경기장에서 두 로봇을 따로 조종한 결과를 만든다.
        - 되감은 틱 k에서 이어 진행하면 엔진은 k 이후 프레임을 폐기(기존 분기 규칙)하고, `LIVE` 로봇의 로그도 k 이후를 폐기한 뒤 이어서 기록한다. `REPLAY` 로봇의 로그는 유지.
        - `REPLAY`는 위치가 아니라 **조작 명령**을 재생한다. 2회차에 다른 로봇과 부딪히거나 기물을 먼저 가져가면 1회차와 궤적 / 결과가 달라질 수 있으며, 이는 결정론을 유지한 정상 동작이다. 리프트 요청도 기록된 요청을 그대로 보내고 수락 여부는 엔진이 다시 판정한다.
        - 두 로봇이 모두 `REPLAY` / `NONE`이면 실시간 루프 없이 `inputProvider` + `runFullMatch()`로 즉시 재계산할 수 있다. 입력 허브 `MatchInputs`(로봇별 로그 / 출처 / 조작 모드)의 재생 공급 함수 `createReplayProvider()`는 만든 시점의 출처를 복사해 고정하고, `LIVE` 로봇도 기록된 로그를 읽기 전용으로 재생하며(방금 실시간으로 진행한 경기를 바로 재계산), `NONE`은 로그가 있어도 중립 입력이다. 실시간 진행은 `MatchInputs.step(engine, liveControls)`(틱 결정 → 기록 → 복호화 → `engine.step`).
        - 로그는 같은 로봇 설정 / 시나리오 / 시드 / 탄도 설정 / 엔진 버전을 전제로 한다 (저장 레시피, Step 10).
    - **실시간 루프 (`requestAnimationFrame` + 20 ms 고정 스텝 누산기):**
        - 프레임마다 누산 시간 += 경과 시간, 20 ms마다 1틱 소비 (입력 결정 → `engine.step`).
        - **따라잡기 상한 `MAX_CATCHUP_TICKS = 5`:** 한 프레임에 최대 5틱(100 ms)만 소비하고, 그러고도 1틱 이상 밀려 있으면 밀린 누산 시간을 버린다 (1틱 미만 나머지는 다음 프레임으로 이월). 순간 끊김 시 게임 시간이 잠깐 느려질 뿐, 입력이 틱별로 기록되므로 결정론 유지.
        - **구현 (`src/input/realtimeLoop.ts`, `src/input/liveControls.ts`, 07-5):** `RealtimeLoop(engine, inputs: MatchInputs, controls: LiveControlSource, scheduler: FrameScheduler, hooks)`. 프레임 스케줄러(`request` / `cancel`, 브라우저는 `requestAnimationFrame`)를 주입받아 가짜 시간으로 테스트한다. 상태 `READY` → `RUNNING` ⇄ `PAUSED` → `ENDED`, 일시정지 사유 `USER` / `HIDDEN` / `BLUR` / `GAMEPAD_DISCONNECTED`, 훅 `onFrame(소비 틱 수)`(렌더링 연결, Step 8) / `onStateChange`.
            - 루프가 `requestAnimationFrame`을 단독으로 소유하고, 프레임 시작 시 입력 공급의 `poll()`(게임패드 폴링 / 키 상태 재샘플, 07-6 어댑터)을 1회 호출한 뒤 틱을 소비한다 (폴링과 틱 소비의 순서 보장).
            - 입력 수집기 `LiveControlCollector`: 배정된 장치별 탭 래치(`sampleGamepad(slot, pad | null)` / `sampleKeyboard(codes)`), 틱마다 로봇별 합성(`consumeTick`), `reset`. 배정되지 않은 게임패드 슬롯은 무시, 연결 해제(`null`)는 중립.
        - **자동 일시정지:** 탭 숨김(`visibilitychange` → hidden), 창 포커스 소실(`blur`), 경기 중 배정된 게임패드 연결 해제(`gamepaddisconnected`). 탭이 숨겨지면 브라우저가 `requestAnimationFrame` 호출을 멈추고 게임패드 / 키 입력도 전달되지 않으므로(키를 뗀 이벤트 유실 → 키가 눌린 채 남음), 그대로 두면 복귀 시 밀린 시간 동안 마지막 입력이 유지된 채 한꺼번에 시뮬레이션된다.
        - 일시정지 시: 루프 정지, 누산 시간 0, 원시 입력 누적기(키 상태 / 탭 래치 에지) 초기화. 엔진은 마지막으로 완료한 틱에 멈춰 있다.
        - 재개: 사용자의 명시적 조작으로만 재개(Step 7에서는 `resume()` API, Step 9 GUI는 스크러버 줄 `RESUME` / `BRANCH` 버튼과 Space — 3.8항). 일시정지된 틱(일시정지 중 되감았으면 되감은 틱)에서 그대로 이어가며 재개 첫 프레임은 경과 시간 0으로 시작. 시작 / 재개 시에도 입력 누적기를 비워 일시정지 중 누른 탭은 재개 후 발동하지 않으며, 누르고 있는 입력은 다음 프레임 폴링에서 다시 샘플되어 이어진다.
        - **(09-7a 변경)** 경기 종료(`ENDED`) 뒤에도 엔진을 종료 전 틱으로 되감았으면(`scrubTo`, 분기) `resume()`으로 그 틱부터 다시 진행한다. 엔진이 6000틱이면 종전대로 무시.
        - 경기 종료(6000틱) 시 루프 자동 정지.
        - **새로고침 / 탭 닫힘 / 크래시 등 외부 개입으로 페이지 상태가 사라지면 그 경기는 폐기한다** (v1은 자동 저장 / 복구 없음, 6.4항).
7. **렌더러 및 화면 연결 (Step 8, 08-1 확정):**
    - **모듈 구성 / 원칙:**
        - `src/renderer/`는 React 비의존 순수 TS. 좌표 계산(보기 변환, 비행 / 낙하 보간, 게이지 배치, 가득 참 판정, 적재물 배치)은 DOM 없는 순수 함수로 분리해 Vitest로 테스트하고, 그리기 함수는 `CanvasRenderingContext2D`만 쓴다.
        - 렌더러 입력 = 장면 1개: `{ frame: DeepReadonly<TimelineFrame>, r1Config, r2Config, view, options, shotResolver? }`. `RobotState`에는 로봇 크기 / 인테이크 구역이 없으므로 제원(`RobotConfig`)을 따로 받는다. 렌더러는 프레임을 읽기만 하고 엔진을 호출하거나 수정하지 않는다.
        - **(09-6b 변경)** 장면 입력에서 `shotResolver`를 뺐다: 캔버스가 명중 확률 글자를 그리지 않으므로 렌더러는 판정 함수를 호출하지 않는다. 명중 확률 계산 함수 `hitProbabilities`(`renderOptions.ts`)는 그대로 두고 좌측 HTML 득점 패널(09-6d)이 호출한다.
        - 그림은 (프레임, 제원, 보기, 옵션)만의 함수다 → 스크러빙 / 재생 / 분기에서 같은 틱은 같은 그림. 벽시계 시간을 쓰는 것은 보기 전환 애니메이션뿐이다.
    - **캔버스 레이아웃 (논리 좌표, 1 in = 5 px 유지):**
        - **필드 뷰포트:** 필드 144 in + 사방 여백 8 in = 160 in 정사각형(800 px). 여백에는 FLOWER 게이지 / NECTAR 재고 게이지 / 라벨이 들어간다. 보기 회전은 이 뷰포트 안에서 필드 중심 (72, 72) 기준으로만 적용한다.
        - **좌우 정보 패널:** 필드 뷰포트 좌우에 각 40 in(200 px), 왼쪽 R1 / 오른쪽 R2. 표시 옵션의 글자 정보(실시간 명중 확률)를 둔다. 회전하지 않는다.
        - 전체 논리 캔버스 1200 × 800 px. 화면에서는 CSS로 컨테이너 폭에 맞춰 비율을 유지하며 확대 / 축소하고, 내부 버퍼는 `devicePixelRatio`만큼 키운다.
        - **(09-1 변경)** Step 9 GUI에서는 좌우 정보 패널을 삭제하고 캔버스 = 필드 뷰포트(논리 800 × 800 px)만 남긴다. 명중 확률 글자는 좌측 HTML 득점 패널로 옮기며(계산 규칙 동일), 장면 크기 / 중심 상수와 좌표 변환은 이에 맞게 수정한다 (3.8항). 아래 08-4 ~ 08-7 구현 기록의 1200 × 800 / 좌우 패널은 변경 전 기준이다.
        - **구현 (09-6b):** `SCENE_WIDTH_PX = SCENE_HEIGHT_PX = VIEWPORT_PX = 800`, `VIEWPORT_CENTER_PX = (400, 400)`, `SIDE_PANEL_PX` 삭제. 개발 하네스 캔버스도 800 × 800(CSS 1 : 1).
        - **좌표 변환 함수:** 필드 inch ↔ 논리 px ↔ 화면(CSS) px 양방향. 역변환은 Step 9 클릭 입력(스윗스팟 격자, 시작 자세 드래그)에 쓴다.
    - **보기 방향 (`AUDIENCE` / `DRIVER`):**
        - `AUDIENCE`: 좌표 그대로 (Y = 144 관중석이 화면 아래). **경기 시작 전 화면**(시나리오 / 로봇 / 탄도 설정, 스윗스팟 입력, LUT 생성 점진 히트맵, 2.6.2항)은 항상 이 시점이다.
        - `DRIVER`: 선택 진영 드라이버 시점, 아군 벽이 화면 아래. RED는 필드 중심 기준 −90°(화면 반시계, 필드 +x → 화면 위, +y → 화면 오른쪽), BLUE는 +90°(필드 −x → 화면 위, −y → 화면 오른쪽). 회전만 쓰고 뒤집지 않으므로, `FIELD` 조작(3.6항)에서 스틱 위 = 화면 위, 스틱 오른쪽 = 화면 오른쪽이 된다.
        - 경기 중 기본값은 `DRIVER`이고, 공통 설정으로 `AUDIENCE`로 바꿀 수 있다 (바꿀 때도 아래 애니메이션). **(09-1)** 기본 보기 방향은 SETTINGS 탭에서 정하고, 경기 중 전환은 스크러버 줄 `VIEW` 토글로 언제나 가능하다 (3.8항).
        - **전환 애니메이션:** 경기 시작(시작 버튼) 시 `AUDIENCE` → `DRIVER`를 700 ms easeInOutCubic으로 회전한다. 회전 각 θ 동안 회전된 정사각형이 뷰포트를 벗어나지 않도록 배율 1 / (|cos θ| + |sin θ|)로 줄인다 (45°에서 약 0.71). 실시간 루프는 **애니메이션이 끝난 뒤** `start()`한다 (회전 중 조종 방지). 경기 준비 화면으로 돌아가면(리셋) 반대로 회전한다. 일시정지 / 재개 / 스크러빙은 보기를 바꾸지 않는다. 애니메이션은 화면 연출일 뿐 엔진 / 기록과 무관하다.
        - 글자, 배지, 시계 방향 윤곽 애니메이션의 시작점(12시), 비행 공 높이 오프셋은 보기 회전을 상쇄해 항상 **화면 기준**으로 그린다 (글자는 똑바로, 높이는 화면 위쪽).
    - **그리기 순서 / 캐시 / 갱신:**
        1. 정적 도형 레이어(배경, 타일, 벽, GARDEN / 로딩 존 / HIVE 프레임 · 셀 바탕 / FLOWER 원통, 게이지 틀): 필드 좌표로 오프스크린 캔버스(뷰포트 크기, 진영 × `devicePixelRatio`별)에 한 번 그려 캐시하고 매 프레임 보기 변환으로 복사한다. 글자는 캐시에 넣지 않는다 (회전 시 똑바로 그리기 위해).
        2. 구조물 라벨 (화면 공간, 똑바로 — 기물 / 로봇 아래에 깔림)
        3. HIVE 셀 상태, FLOWER / 재고 게이지 내용
        4. 바닥 기물(`ON_FIELD`, `IN_GARDEN`), HIVE 시차 낙하 중인 기물
        5. 로봇 (인테이크 구역, 몸체, 헤딩 화살표, 적재물 받침)
        6. 비행 공 (그림자 → 공)
        7. 로봇 번호, 배지, 경기 종료 강조, 좌우 패널 글자
        - **구조물 라벨 배치 (08-4):** 라벨마다 구조물 가장자리 기준점과 바깥 방향(GARDEN: 필드 안쪽, HIVE: OPPOSITE 쪽 변 바깥, FLOWER: 필드 중심 쪽)을 두고, 화면에서 그 방향으로 글자 상자 반폭 / 반높이의 법선 성분 + 3 px만큼 밀어 놓는다 (`labelCenter`). 보기가 회전해 구조물이 화면에서 세로가 되어도 글자가 구조물 위에 겹치지 않는다. 로딩 존 라벨("LOADING")은 구역 중심.
        - **(09-6b 변경)** 구조물 이름표(GARDEN / HIVE / FLOWER n / LOADING ZONE)는 그리지 않는다 (사용자가 필드 구성을 알고 있음). 캔버스 글자는 HIVE 셀 알약, 로봇 번호, 행동 배지뿐이다.
        - 갱신: 루프 `RUNNING` 중에는 `onFrame` 훅마다 최신 틱 프레임(`engine.getFrame(engine.currentTick)`)을 그린다. 일시정지 / 스크러빙 / 옵션 변경 / 보기 애니메이션 중에는 요청이 있을 때 `requestAnimationFrame`으로 모아 한 번 그린다.
        - **프레임 간 보간 없음:** 최신 틱 프레임만 그린다. 주사율이 50의 배수가 아니면(60 / 144 Hz) 같은 틱이 불규칙하게 두 번 보이는 미세한 끊김이 있을 수 있다 (6.4항).
    - **정적 구조 스타일:** 2v0에서 쓰이지 않는 상대 진영 전용 구조물 — 상대 HIVE 셀 2개, 상대 로딩 존, 상대 NECTAR 재고 틀 — 은 채도를 크게 뺀(거의 무채색) 색으로 그려 한눈에 "사용 불가"로 보이게 한다. 상대 HIVE 셀에는 상향 방향 / 개수 / 임계 라벨을 그리지 않는다. (상대 GARDEN은 그 안의 POLLEN이 실제 기물이므로 정상 스타일 유지.)
        - **(09-6b 변경)** 채도를 완전히 뺀 공통 회색 대신 진영별 비활성 색을 쓴다 (진영은 알아보되 한눈에 비활성): 바탕 = 진영 색 8% 투명, HIVE 셀 = 진영 색 12% + 밝은 회색(222), 테두리 = 진영 색 35% + 회색(170). 상대 GARDEN에도 적용 (08-4 ~ 09-6b에서 누락됐던 부분).
    - **로봇:**
        - 몸체 OBB: 진영 색 채움, 앞쪽 변을 굵게 + 헤딩 화살표, 번호 라벨 "1" / "2" (똑바로).
        - 인테이크 구역(`getBumperZoneOBB`): 평소 옅은 반투명, `INTAKING` 상태에서 진하게.
        - 적재물: 몸체 안에 FIFO 순서대로 원 최대 4개 (종류별 색, 크기 통일, 로봇 앞쪽부터 0번, 차체와 함께 회전). 0번(다음에 나갈 기물)은 굵은 진한 테두리로 강조.
        - **몸체 안 배치 (08-4, `robotLayout.ts`):** 앞에서부터 헤딩 화살표(0.45L ~ 0.32L) → 적재물 받침(0.29L ~ −0.21L, 4칸, 원 반지름 = min(1.2 in, 칸 간격 × 0.42)) → 번호 라벨(−0.34L). 모두 몸체 길이 L의 비율이라 로봇 크기와 무관하게 겹치지 않는다. 받침은 밝은 반투명 바탕이라 몸체와 같은 진영색인 NECTAR도 구분되며, 적재 한도(`min(maxControlledPieces, 4)`)만큼 빈 칸 윤곽을 그려 남은 적재 공간을 보여준다.
        - **행동 상태 배지:** `SHOOTING` / `FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING` / `FLOWER_LOWERING`에서 로봇 외접원 바깥 화면 위쪽에 똑바로 그린다. `IDLE` / `INTAKING`은 배지 없음 (흡입은 인테이크 구역 강조로 표시). `isBraking` 중에는 배지를 50% 불투명도로 그려 "정지 대기(타이머 미차감)"를 나타낸다.
        - **(09-6b 변경)** `INTAKING`에도 배지(`intaking`)를 표시한다 (인테이크 구역 강조와 함께). 배지는 로봇 중심과 같은 화면 x, 화면에서 회전된 몸체의 가장 위 꼭짓점 바로 위(2 px)에 붙여 회전과 무관하게 몸체와 겹치지 않으면서 가장 가깝게 둔다 (`badgeCenter`, 이전: 외접원 바깥). 필드 위 물체가 아닌 표시임을 알리도록 불투명도 85%, 제동 중은 그 절반. **(09-7 전 변경)** 흰 원판 배지가 뒤의 기물 / 로봇 / 격자를 가리지 않도록 불투명도 60%(제동 중 30%)로 낮춤 (`BADGE_OPACITY`).
        - **배지 이미지 자산 (사용자 제공 예정):** `src/assets/badges/{key}.svg`(또는 `.png`), key = `shooting`, `lift-up`(`FLOWER_SETUP`), `lift-ready`(`FLOWER_READY`), `lift-drop`(`FLOWER_DROPPING`), `lift-down`(`FLOWER_LOWERING`). 정사각형, 투명 배경, 필드 표시 크기 약 6 in(30 논리 px)에서 식별 가능해야 한다. 자산이 없으면 글자 배지(둥근 사각형 + 짧은 글자)로 대신 그리므로 렌더러 구현은 자산 제공 시점과 무관하다.
        - **배지 자산 확정 (09-7 전):** 6종 모두 SVG로 들어감 (`intaking`, `shooting`, `lift-up`, `lift-ready`, `lift-drop`, `lift-down`). 사용자 시안(투명 배경 선화)은 실제 표시 크기(1366 화면 약 21 px)에서 세부가 뭉개지고 어두운 여백 위에서 보이지 않아, 같은 아이디어를 단순화해 다시 그렸다 (사용자 승인).
            - 공통 틀: `viewBox 0 0 24 24`, `width = height = 256`, 흰 원판(r 11) + 짙은 테두리 `#111827` 1.6 → 밝은 필드와 어두운 여백 모두에서 보임. 그림 선 `#111827` 굵기 2~2.4, 둥근 끝.
            - 강조색 보라 `#7C3AED` 하나만 사용 (필드에서 뜻이 있는 진영 빨강 / 파랑, POLLEN 노랑, 인테이크 초록, 강조 주황, FLOWER 분홍과 겹치지 않음). 기물 / 리프트처럼 움직이는 부분에 칠한다.
            - 모양: `intaking` 양쪽에서 가운데로 모이는 화살표 + 가운데 기물 점, `shooting` 왼쪽 아래 → 오른쪽 위 화살표 + 날아가는 기물 + 오른쪽 위 과녁, `lift-up` ▲ + 아래 막대, `lift-ready` 위 막대 + 일시정지 두 줄, `lift-drop` 기물이 바구니로 떨어짐, `lift-down` 위 막대 + ▼.
            - 불투명도는 렌더러가 입힌다: 평소 60%, 제동 중 30% (85%에서 낮춤 — 뒤의 POLLEN / 로봇 모서리가 비쳐 보이면서 21 px에서도 식별).
            - 이미지로 그리므로 고정 색만 (`currentColor` / `<text>` / 외부 참조 금지). 테스트 `robotLayout.test.ts` C가 키마다 자산 1개 + 정사각 viewBox + `width = height` + 고정 색 / 글자 없음을 검사한다.
        - (09-6b) 자산 키에 `intaking` 추가 (글자 대체 `INTAKE`). 권장 형식 SVG (PNG는 투명 배경 정사각형 256 px 이상), 표시 크기 6 in 정사각형.
    - **기물 상태별 표시:**

      | 상태 | 엔진 좌표 | 표시 |
      |---|---|---|
      | `ON_FIELD` | 실제 위치 | 좌표에 원 (실제 반지름, POLLEN 노랑 / NECTAR 아군 진영 색) |
      | `IN_GARDEN` | 실제 위치 | `ON_FIELD`와 같은 원 + 테두리로 구분 |
      | `IN_HIVE` | 셀 조준점 바닥 투영 (모두 한 점) | 개별로 그리지 않고 HIVE 셀 도형의 개수로 표시. 단 시차 낙하 대기열(`pendingDrops`)의 기물은 낙하 연출로 그림 (엔진은 방출 전까지 `IN_HIVE`로 둠) |
      | `IN_FLOWER` | FLOWER 중심 | FLOWER 게이지로만 |
      | `CONTROLLED` | 로봇 중심 | 로봇 적재물 표시로만 |
      | `IN_FLIGHT` | 발사구 바닥 투영 | 비행 대기열 보간으로만 |
      | `OUT_OF_BOUNDS` | 필드 밖 | NECTAR 재고 게이지로만 (POLLEN은 해당 없음) |

    - **HIVE:**
        - 아군 셀: 현행 표시 유지 (상향 셀 강조, `N{NECTAR} P{POLLEN}/{임계}` 라벨). `isTipping` 중에는 전복된 셀(= 현재 상향 셀의 반대편, 전복 중 추가 전복은 불가)에 "TIPPING" 표시.
        - **그리는 방식 (08-5):** 셀 바탕 / 테두리(상향 셀 진영색 + 노란 강조, 전복된 셀 주황 점선)는 필드 공간, 셀 안 내용은 화면 공간에서 똑바로 — 셀의 화면 경계 상자 안에 위에서부터 NECTAR 줄 / "▲ N{n} P{p}/{임계}" 알약 글자 / POLLEN 줄 (전복된 셀은 "TIPPING" 알약). 기물 줄을 필드 공간에 두면 드라이버 시점에서 세로줄이 되어 글자와 겹치므로 화면 공간으로 옮겼다.
        - **(09-6b 변경)** "TIPPING" 알약은 그리지 않는다. 전복된 셀은 주황 점선 테두리만으로 표시한다.
        - 상대 셀: 위 정적 구조 스타일.
        - **시차 낙하 연출:** `pendingDrops`의 각 항목에 진행률 u = clamp(`tipProgressTimer` / `settleTime`, 0, 1). 위치 = 전복된 셀의 립 기준점(Lip_X, Lip_Y, 2.6.1항) → (`targetX`, `targetY`) 선형 보간. 불투명도 = 0.25 + 0.75·u. 윤곽선은 화면 12시 방향에서 시계 방향으로 u × 360°까지 호로 그린다 (u = 1에서 완전한 원 = 착지). 방출되어 `ON_FIELD`가 된 기물은 일반 표시. 필요한 값이 모두 프레임에 있으므로 스크러빙에서도 같다.
    - **FLOWER 게이지 (필드 밖 직사각형, 기존 측면 단면 원통 게이지 폐기):**
        - FLOWER 4개는 필드 변을 2:1로 내분하는 점에 있고 필드 중심 기준 90° 회전 대칭이다: R(x, y) = (144 − y, x)를 반복 적용하면 (96, 142) → (2, 96) → (48, 2) → (142, 48).
        - 기준 게이지(관중석 벽 FLOWER (96, 142)): 필드 바깥 x ∈ [96, 120], y ∈ [144.6, 147.8] (벽과 0.6 in 간격, 두께 3.2 in, 양 끝 둥글게). FLOWER 쪽 끝(x = 96)이 bottom(`slot[0]`)이고, 필드 둘레를 따라 화면 기준 반시계 방향 끝(x = 120)이 top.
        - 나머지 3개는 R로 회전 복제: 왼쪽 벽 (2, 96) → x ∈ [−3.8, −0.6], y ∈ [96, 120], bottom y = 96 / 위쪽 벽 (48, 2) → x ∈ [24, 48], y ∈ [−3.8, −0.6], bottom x = 48 / 오른쪽 벽 (142, 48) → x ∈ [144.6, 147.8], y ∈ [24, 48], bottom y = 48.
        - **칸:** 길이 24 in를 9칸(칸당 약 2.667 in)으로 나눈다 (9 = 용량 테이블 최대 총 개수). 칸 k = `pieces[k]`. 기물은 종류별 색의 같은 크기 원(지름 2.2 in, 실제 크기 무시).
        - `slot[0]`이 `null`(NECTAR 잼)이면 칸 0을 검정으로 막는다. 칸 0과 칸 1 사이에 출구 턱 구분선을 그린다 (칸 0은 득점 제외).
        - **가득 참 표시:** 현재 조합 {POLLEN, NECTAR}(잼 상태의 빈 `slot[0]`은 POLLEN 1개로 계산, 2.6.3항)가 용량 테이블의 최대 조합(POLLEN = `FLOWER_MAX_POLLEN_BY_NECTAR[NECTAR]`)이면 `pieces.length`번 ~ 8번 칸에 X 표시를 그린다. 테이블이 NECTAR 개수에 대해 엄격히 감소하므로 최대 조합이 아니면 POLLEN 1개를 더 넣을 수 있어 "가득 참 ⇔ 최대 조합"이 성립한다 (예: {1, 6}은 7칸 + X 2칸, {9, 0}은 X 없음). 엔드게임 NECTAR 제한처럼 시점에 따라 달라지는 투입 조건은 반영하지 않는다.
        - "FLOWER n" 라벨은 필드 안쪽 현행 위치 유지 (똑바로).
        - **구현 (08-5, `gaugeLayout.ts`):** 게이지 틀(둥근 직사각형, 빈 칸 윤곽 9개, 칸 0 / 1 사이 출구 턱 점선)은 정적 레이어, 칸 내용은 매 프레임. "가득 참"은 엔진 용량 판정 `canFlowerAccept`를 재사용해 POLLEN / NECTAR 둘 다 넣을 수 없을 때로 판정한다 (위 "가득 참 ⇔ 최대 조합"과 동치, 용량 규칙의 단일 출처 = 엔진).
    - **NECTAR 재고 게이지 (휴먼 플레이어, 룰북 Figure 10-2 ALLIANCE AREA):**
        - 각 진영 벽 바깥 y = 72 중심. RED: x ∈ [−3.8, −0.6], y ∈ [65.33, 78.67] (5칸, 칸당 약 2.667 in, FLOWER 게이지와 같은 두께 / 간격 / 원 크기). BLUE: 필드 중심 점대칭 x ∈ [144.6, 147.8], 같은 y 범위.
        - 칸 채우는 순서: 아군 로딩 존에 가까운 끝부터 (RED는 y가 작은 쪽, BLUE는 y가 큰 쪽 — 점대칭). 앞에서부터 `pendingHumanNectar`개 = **투입 대기**(반투명 + 점선 테두리), 이어서 `nectarStock`개 = **재고**(정상 색), 나머지는 빈 칸 (이미 필드로 투입된 수 = 5 − 대기 − 재고).
        - 두 값의 차이: `nectarStock`은 휴먼 플레이어가 아직 투입을 결정하지 않은 재고이고, `pendingHumanNectar`는 투입이 결정됐지만(팁 / 엔드게임 / 오토 팁) 로딩 존 빈 슬롯이 없어(로봇이 막고 있음 등) 기다리는 수다 (2.4항). 예: 엔드게임 진입 시 로봇이 로딩 존에 서 있으면 재고 3 → 0, 대기 3이 되고 자리가 나는 대로 대기가 줄어든다.
        - 상대 진영 재고 틀은 정적 구조 스타일(채도 제거), 내용 없음.
        - **(09-6b 변경)** 재고 게이지 틀은 칸 5개 양 끝에 칸 하나 길이(`STOCK_GAUGE_END_PAD`)만큼 여유를 둔다 (칸 위치 / 간격은 그대로). 상대 재고 틀은 진영별 비활성 색.
    - **비행 공 (`pendingShots`):**
        - 경과 시간 t = (tick − `launchTick`) · dt (발사 후 초). t < `contactTime`이면 명목 구간, 그 뒤는 충돌 후 구간(`segments`)에서 t를 담는 구간 (08-2).
        - **명목 구간:** 진행률 s = clamp(t / `contactTime`, 0, 1). 수평 위치 = (`fromX`, `fromY`) → (`toX`, `toY`) 선형 보간.
        - **명목 구간 높이 (명목 포물선 + 선형 보정):** 명목 궤적 `Trajectory {fromX, fromY, fromZ, heading, v0, pitch}`의 `heightAtDistance`(`ballistics.ts` 재사용)로 z_nom(d)를 구하고, D = from → to 수평 거리일 때 z(s) = z_nom(s·D) + s·(`toZ` − z_nom(D)). s = 0에서 발사구, s = 1에서 `to`(조준점 / HIVE 접촉점 / 벽 접촉점 / 바닥 착지점)와 정확히 일치한다 (명중의 탐색 v0 / 고정형 조준 오차로 명목 포물선이 조준점을 비껴가도 끝점이 맞음).
        - **충돌 후 구간:** 기록된 구간을 그대로 계산한다 (`flightSegmentPoint`: `BALLISTIC` 중력 포물선, `ROLL` 높이 유지). 선형 근사나 투명도 연출 없이 실제 공으로 그리며, 구간이 명목 구간 끝 / 서로 / 착지점과 연속이므로 공중 → 바닥 점프가 없다.
        - **높이 연출:** 바닥 위치 (x, y)에 반투명 그림자(기물 반지름), 공은 화면 위쪽으로 0.3·z in 띄운 위치에 반지름 × (1 + z / 100)으로 그린다.
        - 결과(`HIT` / `MISS_*`)는 도착 전까지 구분하지 않는다 (같은 색). 도착 틱 프레임에서는 기물이 이미 결과 상태(`IN_HIVE` / `ON_FIELD`)로 그려진다.
        - **구현 (08-6, `flightView.ts`):** `shotElapsed`(프레임 틱 → 발사 후 초), `shotPositionAt`(위 두 구간 규칙, 충돌 후 구간이 없으면 명목 구간 끝에서 고정, 포물선이 정의되지 않는 비정상 궤적은 높이를 발사구 → to 선형), `shotTrail`(틱 간격 표본), `airborneDisplay`. 비행 대기열의 모든 발사를 그린다 (연속 발사로 여러 발이 동시에 날 수 있음).
    - **경기 종료 강조:** 프레임에 `scoreBreakdown`이 있을 때(Tick 6000 프레임)만 득점 인정 GARDEN 기물 테두리, 주차 인정 로봇 외곽, 득점 FLOWER 게이지 테두리 + 점수 글자를 강조한다. **경기 중 예측 표시(로딩 존 / GARDEN 걸침 등)는 하지 않는다** (3.2항 실시간 / 확정 분리).
        - **구현 (08-5):** 강조색 주황. GARDEN 기물은 반지름 + 0.8 in 고리, 주차 로봇은 몸체보다 사방 1.5 in 큰 외곽선, 득점 FLOWER는 게이지 테두리 + "+{점수}" 알약. 점수 알약은 게이지 쪽 여백(8 in)이 좁아 잘리므로 필드 안쪽 "FLOWER n" 라벨 바로 바깥에 둔다.
        - **(09-6b 변경)** 경기 종료 강조를 다음으로 바꾼다 (점수 알약 `+{점수}` 삭제 — 결과 팝업이 항목별 점수를 보여 줌):
            - GARDEN: 경기 중 `IN_GARDEN` 기물은 초록 테두리(유지). 경기 종료 프레임에서 득점 인정된 기물은 초록 대신 주황 테두리 (겹쳐 그리지 않음).
            - FLOWER 소유권 득점: 필드의 FLOWER 원을 분홍 대신 진영 공식 색으로 (게이지 테두리 강조 삭제). FLOWER는 평소 중립이라 진영색 테두리를 두지 않는다.
            - 하단 보너스: 게이지에서 유효 스코어링 볼륨(`slot[1 .. N]`)의 **가장 아래 NECTAR 하나**에만 주황 테두리 (`bottomBonusSlot`). 2v0 단순화 규칙상 소유권과 하단 보너스는 항상 함께 성립하므로 득점 FLOWER는 두 표시를 모두 받는다.
            - 주차: 로봇 외곽 주황선 (그대로).
    - **표시 옵션 (`RenderOptions`):** 사용자에게 공개하는 **공통 환경설정**(로봇별 설정 아님), 기본값 모두 꺼짐. Step 9 SETTINGS 탭에서 켜고 끄며, Step 8 개발 하네스에서는 간이 체크박스로 조작한다. **(09-1)** 변경은 경기 전 또는 일시정지 중(config 창을 열 수 있을 때)에만 가능하다 (3.8항).
        - `aimGuide` 조준선: 고정형은 헤딩 방향 선 + ±`aimTolerance` 부채꼴, 터렛형은 `turretRange` 부채꼴 + 발사 방향 선(`shotLaunchHeading`, 범위 밖이면 한계각).
        - `intakeProgress` 흡입 접촉 진행: `intakeTargetPieceId` 기물 둘레에 `intakeContactTimer` / 필요 시간 호. 대상이 바닥 기물이면 그 기물 둘레(필요 시간 `intakeDelay`), FLOWER `slot[0]`이면 FLOWER 원통 둘레(필요 시간 max(`intakeDelay`, 0.12 s)). 필요 시간이 0이면 그리지 않는다.
        - `hitProbability` 실시간 명중 확률: 좌우 패널에 글자로 로봇별 POLLEN / NECTAR 확률 (적재함 0번 종류 강조, 적재 없음 표시). 렌더 시점에 장면의 `shotResolver`(엔진에 주입된 판정 함수)를 현재 프레임의 로봇 자세 / 진영 / 상향 셀로 호출한다. 옵션이 꺼져 있으면 호출하지 않으며, 켜져 있어도 틱이 아니라 **그리는 프레임마다** 4회(로봇 2 × 기물 2)다. 엔진은 여전히 발사 시에만 판정 함수를 호출하므로 결정론과 무관하다. 비용 실측(Node V8, LUT 판정 함수, 360° 터렛 최악 조건): 약 0.5 µs/회 → 프레임당 약 2 µs, 144 Hz에서도 초당 약 0.3 ms (CPU 0.03%) 수준으로 무시 가능.
        - `flightTrail` 비행 잔상: 발사구 → 현재 위치까지 위 높이 보간 곡선을 점선으로.
        - `flightResult` 비행 결과 색: 비행 중 공을 결과별 색(`HIT` / `MISS_HIVE` / `MISS_FLOOR`)으로 구분 (기본은 도착 전까지 숨김).
        - **구현 (08-6, `renderOptions.ts` + `sceneRenderer.ts`):** 장면 입력에 `options`(미지정 = `DEFAULT_RENDER_OPTIONS`, 모두 꺼짐)와 `shotResolver`(선택)를 추가.
            - `aimGuide`: 반지름 24 in 부채꼴 + 로봇 중심에서 발사 방향으로 조준점 거리만큼 점선. 터렛 범위 해석은 엔진 조준 판정과 같다 — 각 끝을 [-π, π]로 정규화하므로 360°는 `[-π, π]`뿐이고 `[0, 2π]`는 `[0, 0]`(폭 0)이다.
            - `intakeProgress`: 대상 둘레 + 0.6 in 반지름, 화면 12시부터 시계 방향 호, 진행률 [0, 1] 제한.
            - `hitProbability`: 왼쪽 패널 "R1 명중 확률" / 오른쪽 "R2 명중 확률", POLLEN / NECTAR 백분율, 적재함 0번 종류는 "▶"와 큰 글자, 적재 없음 표시, 판정 함수 미주입 시 "판정 함수 없음". 값은 엔진과 같이 [0, 1] 제한 / 비유한값 0.
            - (09-6b) 캔버스 좌우 패널이 삭제되어 이 글자는 좌측 HTML 득점 패널로 옮긴다 (09-6d). 그 사이 하네스에서는 표시하지 않는다.
            - (09-6d) 좌측 패널 로봇 이름 아래에 `POLLEN` / `NECTAR` 정수 % (적재함 0번 종류 줄은 밝게, 다른 줄은 흐리게, 기물 색 점). 옵션이 꺼져 있으면 줄 자체가 없다.
            - `flightTrail`: 발사구부터 현재까지 공 표시 위치(높이 오프셋 포함)를 점선으로. `flightResult`: 공 테두리를 `HIT` 초록 / `MISS_HIVE` 주황 / `MISS_FLOOR` 회색으로.
            - 그리기 위치: 조준선은 로봇 아래, 흡입 진행은 로봇 위, 잔상 / 결과 색은 비행 공과 함께, 명중 확률은 뷰포트 밖 좌우 패널 (회전 없음).
    - **개발 하네스 (Step 8, 사용자 비공개):**
        - 개발 서버(`import.meta.env.DEV`)에서만 `App`이 하네스를 띄우고, 정식 빌드는 Step 9 GUI 전까지 현행 정적 필드(관중석 시점)를 보여준다. Step 9 GUI(3.8항)가 들어오면 정식 빌드 / 개발 서버 모두 GUI를 띄우고 하네스는 Step 9 마지막 하위 Step에서 삭제한다.
        - 구성: 하네스 파일의 고정 기본 `RobotConfig` 2개, 기본 시나리오(진영 RED / BLUE 선택), **간이 판정 함수**(`isAimWithinShooterRange` 통과 시 0.6, 아니면 0 — LUT 생성 없음), 기본 슈터 탄도, `MatchInputs`(R1 / R2 `LIVE`), `createBrowserRealtimeLoop`. **엔진 / 입력 계층 / 실시간 루프 / 렌더러는 정식 코드를 그대로 쓰고, 판정 함수와 설정값만 다르다.**
        - 조작: 시작(회전 애니메이션 후 루프 시작) / 일시정지 / 재개 / 리셋, 보기 전환, 표시 옵션 체크박스, 틱 / 남은 시간 / 점수 임시 글자. Step 9 GUI가 들어오면 대체된다.
        - **구현 (08-7, `src/dev/`):**
            - `devSetup.ts`: 고정 제원 `DEV_ROBOT_CONFIGS`(18 in, 앞면 흡입, 고정형 ±3°), 간이 판정 함수 `createDevResolver`(조준 가능 0.6 / 아니면 0), `createDevEngine(진영)`.
            - `harnessController.ts` (React 비의존, 시계 / 프레임 스케줄러 / 브라우저 환경 주입): 단계 `SETUP`(관중석, 진영 선택) → 시작 → `ROTATING_IN`(보기 회전, 루프 `READY` 유지) → 회전 완료 프레임에 `loop.start()` → `MATCH` → 리셋 → 새 엔진(0틱) + `ROTATING_OUT`(관중석으로 회전) → `SETUP`. 진영은 `SETUP`에서만 바꿀 수 있다. 입력은 `MatchInputs`(R1 / R2 `LIVE`) + `createBrowserRealtimeLoop`(게임패드 0 → R1, 게임패드 1 + 키보드 → R2).
            - **(09-6c 변경)** `harnessController.ts`는 삭제하고, 같은 흐름을 일반화한 `src/app/appController.ts`(`AppController`)에 하네스 고정 설정(`devSetup.ts` `createDevSetup(진영)`)을 주입해 쓴다. 진영 선택 = `setSetup(createDevSetup(진영))`. 흐름 테스트도 `src/app/__tests__/appController.test.ts`로 옮겼다.
            - 다시 그리기: 루프 `RUNNING` 중에는 `onFrame`마다, 그 외에는 요청을 rAF 1회로 모아서 (옵션 여러 번 변경 = 1회), 보기 애니메이션 중에는 끝날 때까지 매 프레임. 상태 알림(React 표시)은 진행 중 최대 약 10 Hz, 단계 / 루프 상태 변화는 즉시.
            - `DevHarness.tsx`: 버튼 / 라디오 / 체크박스 / 상태 글자(단계, 루프 상태와 일시정지 사유, 틱, 남은 시간, 점수, 게임패드 슬롯 연결)와 키보드 안내(개발용). 캔버스는 논리 1200 × 800을 CSS 폭 100% · 비율 3:2로 확대 / 축소, 버퍼는 `devicePixelRatio` 배.
            - `App.tsx`: `import.meta.env.DEV`일 때만 `lazy(import('./dev/DevHarness'))`. 정식 빌드 번들에 하네스 코드가 없음을 확인 (빌드 결과물 문자열 검사 + 미리보기에서 정적 필드만 표시).
            - 경기 보기를 관중석으로 두고 시작하면 회전 없이 700 ms 전환 시간 뒤 시작한다 (같은 흐름 유지).
            - **(09-6d 변경)** 새 GUI(메인 화면)가 정식 빌드와 개발 서버 모두의 기본 화면이 되고, 하네스는 개발 서버에서 주소에 `?harness`가 있을 때만 뜬다 (정식 빌드는 `?harness`를 무시). 고정 설정 본체는 정식 코드 `src/app/defaultSetup.ts`(`DEFAULT_ROBOT_CONFIGS` — 이름 `R1` / `R2`, `createSimpleResolver`, `createDefaultSetup(진영)`)로 옮기고 `devSetup.ts`는 이를 다시 내보낸다. 정적 필드 화면(`FieldCanvas.tsx`, `renderField` / `drawHive` 등 720 × 720 옛 그리기 함수)은 삭제.
    - **테스트:** 순수 계산 함수는 Vitest — 보기 변환(RED / BLUE 회전 방향, 역변환 왕복, 애니메이션 배율), 비행 보간(s = 0 발사구, s = 1 도착점 일치, 보정항), 낙하 보간(립 → 착지, 불투명도 / 호 진행), FLOWER 게이지(4개 회전 대칭 좌표, 칸 위치, 가득 참 판정 — 테이블 7조합 + 잼), 재고 게이지 칸 배정, 적재물 배치. 그리기 결과는 각 단계 끝에 저장소 밖 1회성 헤드리스 Chromium 점검(07-6 방식)으로 확인하고, Playwright는 저장소에 넣지 않는다.

8. **웹 GUI (Step 9, 09-1 확정):** 엔진 / 입력 계층 / 실시간 루프 / 렌더러 / LUT Worker를 한 화면으로 묶는 정식 사용자 화면. 세부 배치(폼 필드 배열, 컨트롤 모양, 색 척도 등)는 각 하위 Step 시작 시 확정하고, 여기서는 구조 / 흐름 / 규칙만 정한다.
    - **기본 원칙:**
        - **대상 환경:** 데스크톱 / 노트북 브라우저 전용. 모바일 최적화 없음 (태블릿 가로 화면은 동작하면 좋으나 보장하지 않음).
        - **화면 크기:** 최소 1366 × 768 (브라우저 창 안쪽 가용 영역 약 1366 × 650 기준으로 설계), 최대 3840 × 2160. UI 치수(글자 / 패널 폭 / 버튼)는 기준 단위 `--u = min(100vw / 1366, 100vh / 650)`에 비례해 4K에서도 1366 화면과 같은 비율로 보인다. 최소 크기보다 작으면 더 줄이지 않고 스크롤. 캔버스는 기존대로 `devicePixelRatio`만큼 버퍼를 키운다.
        - **앱 표시 이름:** `FTC TacticSim`.
        - **문구 사전 구현 (09-6a, `src/ui/i18n.ts`):** `t(lang, key, params?)`, 영어 사전 키 기준 + 한국어 사전은 타입으로 모든 키를 강제, 런타임에 없는 언어 / 키는 영어 → 키 문자열로 대체, 자리표시자 `{name}`. 한국어는 짧은 명사형. 엔진 검증 오류 코드(`issue.*`) / LUT 상태(`lut.*`) / 일시정지 사유(`pause.*`)마다 문구를 두고 GUI는 엔진 메시지 대신 코드로 문구를 찾는다. 문구는 화면을 만드는 하위 Step마다 추가한다.
        - **타이머 (09-6a 확정, `formatMatchTime`):** 10초 초과는 `M:SS`, 10초 이하는 `0:SS.s`, 두 구간 모두 올림이라 표시가 건너뛰지 않는다 (2:00 → 1:59 … 0:11 → 0:10.0 → 0:09.9 … 0:00.1 → 종료 0:00.0). 틱 × 0.02의 부동소수점 오차는 1e-6초로 흡수. `ENDGAME`(남은 60초 이하, 엔진 전환 틱과 같음)부터 글자색 변경.
        - **언어:** 기본 영어, 한국어 토글(SETTINGS 탭). 모든 화면 문구(캔버스 글자 포함)는 문구 사전 `t(key)`를 거친다. 게임 용어는 언어와 무관하게 **원어 대문자**: `POLLEN`, `NECTAR`, `HIVE`, `CELL`, `FLOWER`, `GARDEN`, `LOADING ZONE`, `TIP`, `PARK`, `ENDGAME`, `TELEOP`, `SWARM`, `POLLINATOR`, `RP`, `RED`, `BLUE`, `ALLIANCE`.
        - **진영 공식 색 (UI + 렌더러 공통):** RED `rgb(223, 0, 27)` = `#DF001B`, BLUE `rgb(15, 83, 167)` = `#0F53A7`. 그 외 색은 구현하며 정하고 사용자 검토로 수정.
        - **테마 (09-6b 확정):** 필드 바닥은 밝은 회색 타일(기물 / 로봇 구분이 가장 잘 됨), 필드 둘레(게이지 여백)와 주변 UI / 팝업은 어두운 계열(`#15171C`, 결과창 시안과 같은 톤).
        - **진영 색 적용 (09-6b 확정, `canvasRenderer.ts` `ALLIANCE_COLORS`):** 공식 RGB에서 계산 — 기본(로봇 몸체 / 진영 NECTAR / 상향 셀) RED `#DF001B` · BLUE `#0F53A7`, 15% 어둡게(테두리 / 라벨 글자) `#BE0017` · `#0D478E`, 흰색과 7 : 3(하향 셀) `#F5B3BB` · `#B7CBE5`, 25% 투명(GARDEN / 로딩 존 바탕). 상대 진영 전용 구조물은 진영별 비활성 색(3.7항 정적 구조 스타일 09-6b 변경). FLOWER는 중립이라 분홍 바탕 + 중립 테두리(진영색 테두리 없음). POLLEN 노랑 / HIVE 틀 회색 / 인테이크 초록 / 비행 결과색 / 강조 주황은 유지. 로봇 몸체 윤곽선 2.25 px (1.5 px에서 1.5배).
        - **캔버스 글자 (09-6b 확정):** 로봇 행동 배지의 글자 대체 문구(`SHOOT`, `LIFT ▲` 등, 이미지 자산 전 임시)는 영어로 고정 (언어 토글 대상 아님). 구조물 이름표 / `TIPPING` / 경기 종료 점수 알약은 그리지 않고, 캔버스 글자는 HIVE 셀 알약(`▲ N{n} P{p}/{임계}`) / 로봇 번호 / 행동 배지뿐이다. 캔버스에는 한국어 문자열을 그리지 않는다 (한국어 화면 글자는 문구 사전 → HTML).
        - **React 역할:** 컨트롤 UI / 스크러버 / 스코어보드 / 설정 폼만. 엔진 / 실시간 루프 / 렌더러 / LUT Worker는 React 밖 순수 TS 앱 컨트롤러가 소유하고, React는 약 10 Hz 상태 알림을 구독한다 (08-7 하네스 컨트롤러 방식 확장).
        - **앱 컨트롤러 구현 (09-6c, `src/app/appController.ts`):** `AppController({ ctx, setup, dpr?, env?, scheduler?, now?, onStatus?, statusIntervalMs? })`.
            - 경기 설정 `MatchSetup { r1Config, r2Config, shotResolver, scenario, shooters? }`(진영 = `scenario.allianceColor`)을 주입받아 엔진을 만든다. `setSetup(setup)`은 경기 전(`SETUP`)에만 받아들여 새 0틱 엔진을 만들고(경기 중 false), 리셋은 현재 설정으로 0틱 새 엔진. 09-6d까지는 하네스 고정 설정, 09-8 이후 config 창의 적용된 설정이 들어온다.
            - 흐름 / 다시 그리기 / 상태 알림(진행 중 최대 약 10 Hz, 단계 · 루프 상태 변화는 즉시)은 08-7 하네스와 동일: `SETUP → ROTATING_IN(회전 중 루프 대기) → MATCH → 리셋 → ROTATING_OUT → SETUP`, 시작 / 일시정지 / 재개 / 리셋 / 보기 전환 / 표시 옵션. 분기 / 재생 / 결과 등 3.8항 전체 흐름은 09-7에서 확장한다 (아래 "경기 흐름 구현 (09-7a)"). 입력 출처는 당분간 R1 / R2 모두 `LIVE` (기본 출처 규칙은 09-8).
            - 상태 `AppStatus`: 단계, 진영, 경기 보기, 보기 각도, 루프 상태 / 일시정지 사유, 틱, 남은 시간, 확정 점수, 텔레옵 / 오토 TIP 횟수, RP, 게임패드 슬롯 상태, 명중 확률(표시 옵션 `hitProbability`가 켜져 있을 때만 `hitProbabilities` — 상태를 만들 때마다 판정 함수 4회, 꺼져 있으면 `null`이고 호출 없음). 좌측 득점 패널(09-6d)이 이 값만 읽는다.
        - **개발 하네스 대체:** Step 9 GUI가 정식 빌드와 개발 서버 모두의 화면이 된다. 하네스(`src/dev/`)는 Step 9 마지막 하위 Step에서 삭제. **(09-6d)** 그 사이 하네스는 개발 서버 `?harness`로만 연다.
        - **글꼴 (09-6d 확정):** `'Apple SD Gothic Neo', 'Pretendard Variable', Pretendard, system-ui, sans-serif` (`src/renderer/fonts.ts` `FONT_FAMILY` 한 곳에서 정의 — `main.tsx`가 HTML 루트에, `canvasFont(크기, 굵기)`가 캔버스 글자에 사용). macOS는 설치된 Apple SD 산돌고딕 Neo, 그 외는 Pretendard(OFL, npm `pretendard`, 사용 글자만 나눠 받는 dynamic subset 웹폰트). 굵기는 세미볼드 600 / 볼드 700 / 엑스트라볼드 800만 쓴다. 웹폰트가 늦게 도착하면 캔버스를 한 번 다시 그린다 (`document.fonts.ready` → `AppController.redraw()`).
        - **파비콘 (09-7 전 확정):** `public/favicon.svg` = lucide Gamepad2 선(흰색)을 어두운 둥근 사각형(`#15171C`)에 넣고 두 버튼을 진영 빨강 `#DF001B` / 파랑 계열로 칠함. 밝은 / 어두운 탭 모두에서 16 px 식별 가능.
        - **아이콘 (09-6d 임시 확정 → 09-7 전 확정: TIP 아이콘 포함 그대로 사용):** `lucide-react`(ISC) 선 아이콘, `currentColor`. TIP 옆 HIVE 아이콘만 자체 제작(`HiveIcon.tsx`, 같은 24 × 24 / 선 굵기 2 규격). 사용자가 바꾸고 싶은 아이콘은 같은 규격(24 × 24 viewBox, `currentColor`) SVG로 제공하면 교체한다. 역할 대응: `START` Play / `PAUSE` Pause / `RESUME` Gamepad2 / `BRANCH` GitBranch / 1초 이동 Rewind · FastForward / 1틱 이동 ChevronLeft · ChevronRight / 재생 CirclePlay / `VIEW` SwitchCamera / `NEW` RotateCcw / `RESULT` Trophy / 로봇 Bot / 시나리오 Flag(진영색 채움) / 게임패드 Gamepad2 / 펼치기 PanelRightOpen / 준비 CircleCheck / 경고 TriangleAlert.
        - **화면 뼈대 구현 (09-6d, `src/components/MainScreen.tsx` / `LeftPanel.tsx` / `ConfigRail.tsx` / `ScrubberBar.tsx` / `MainScreen.css`, 순수 규칙 `src/ui/mainScreenModel.ts`):**
            - 배치: CSS 그리드 `좌측 패널 | 필드 | config 띠` + 아래 줄 전체 스크러버. 치수(기준 1366 × 650, 260u / 72u / 56u, 간격 12u)는 `LAYOUT_U` / `layoutCssVars()`가 루트 CSS 변수로 넘기고, CSS가 `--u = max(1px, min(100vw / 기준 폭, 100vh / 기준 높이))`로 곱한다. 1366 × 650 기준 필드 약 558 px, 3840 × 2160 약 1900 px.
            - 필드: `fieldCanvasSize(영역 폭, 높이, dpr)` → CSS 크기 = 짧은 변 내림, 버퍼 = CSS × dpr 반올림, 렌더 배율 = 버퍼 / 800. `ResizeObserver` + 창 `resize`(dpr만 바뀐 경우)마다 `AppController.setRenderScale(배율)`, 버퍼가 바뀌었으면 `redraw()`. 컨트롤러 생성 시 첫 배율을 넘긴다.
            - 테마: 배경 `#15171C`, 상자 `#1D2027` + 테두리 `#2C313B`, 보조 글자 `#9CA3AF`, 강조 / `ENDGAME` 타이머 주황 `#F59E0B`, 준비 초록 `#22C55E`. 진영 점수 상자 = 진영 기본색 바탕 + 15% 어두운 테두리 + 흰 글자 (`ALLIANCE_COLORS`와 같은 값).
            - 좌측 패널: 타이머(`formatMatchTime`, 경기 전은 항상 기본색 / 경기 시작 후 남은 60초 이하 주황), 진영 점수(`AppStatus.score`), `TIP` = HIVE 아이콘 + `{오토 + 텔레옵} / {목표}`(`tipDisplay`: 4 → 7, 7 이상이면 초록 체크), 로봇 이름(`robotLabel`: 팀 번호가 있으면 `#번호`, 없으면 `R1` / `R2` — 팀 번호 입력은 09-9) + 명중 확률(표시 옵션 켜짐일 때).
            - 스크러버 줄 (09-6d는 기존 동작만): 주 버튼(`mainButton`: 경기 전 `START` / 회전 중 비활성 / 진행 `PAUSE` / 일시정지 `RESUME` / 경기 종료 비활성), `VIEW`(드라이버 ↔ 관중석, 언제나), `NEW`(경기 전 제외, 확인창 없이 리셋 — 확인창은 09-7). 1초 / 1틱 이동, 타임라인 끌기, 재생, 배속(1× 선택 표시), `RESULT`는 자리만 두고 비활성. 타임라인 막대는 현재 틱 위치 + 기록 구간 + 10초 눈금 13개(`ENDGAME` 시작 눈금만 주황). 버튼은 누른 뒤 포커스를 풀어 Space / Enter가 버튼을 다시 누르지 않게 한다 (단축키는 09-7).
            - 접힌 config 띠 (표시만): R1 / R2 로봇 + 초록 체크, 시나리오 진영색 깃발 + 체크(09-6d 고정 설정은 간이 판정 함수라 LUT가 없고 항상 적용 상태), 게임패드 연결 수 + 비표준 매핑 경고(`gamepadSummary`, 마우스 올리면 슬롯별 패드 이름 / 배정 로봇), 펼치기 버튼 비활성(09-8). 준비 신호 / 진행률 링 / 빨간 느낌표는 09-8 ~ 09-10.
            - 경기 설정은 config 창 전까지 `createDefaultSetup('RED')`, 언어는 SETTINGS 탭(09-8) 전까지 주소 `?lang=ko`.
            - 브라우저 탭 제목 `FTC TacticSim`.
    - **화면 구성:** 화면은 **메인 화면 하나**다. 경기 / 일시정지 / 복기가 모두 같은 화면이고, 설정은 우측 config 창, 경기 결과는 팝업이다. 별도 복기 창은 두지 않는다.

        ```
        ┌──────────────┬──────────────────────────────────────────┬──────┐
        │  1:57 (타이머) │               [경고 토스트]                  │ R1 ◔ │
        ├──────────────┤                                          │ R2 ✓ │
        │  RED  20     │                                          │  ⚑ ✓ │
        │  (진영 점수)    │           필드 뷰포트 (정사각형)              │  🎮 1 │
        ├──────────────┤                                          │      │
        │ HIVE TIP 1/4 │                                          │      │
        ├──────────────┤                                          │      │
        │ R1 #19049    │                                          │      │
        │ R2 #24909    │                                          │      │
        │ (명중 확률)     │                                          │  ≡   │
        ├──────────────┴──────────────────────────────────────────┴──────┤
        │ [주 버튼] [⏮][◀] ━━━━━━━●━━━━━━━ [▶][⏭] [▶ 재생] 0.25 0.5 1 2× [VIEW] [NEW] [RESULT] │
        └────────────────────────────────────────────────────────────────┘
          좌측 패널 ≈ 260u    필드 = 가용 높이 − 스크러버 줄 (≈ 590u)     접힌 config ≈ 72u (펼침 ≈ 480u, 필드 영역을 밀어냄)
        ```

        - 1366 폭 기준 config를 펼쳐도 260 + 590 + 480 ≈ 1330u로 필드가 줄지 않는다. 폭이 부족한 화면에서는 필드가 줄어든다.
        - **좌측 패널 (득점 현황, HTML):**
            - 타이머: 남은 시간 `M:SS`. `ENDGAME`(남은 60초 이하)부터 글자색 변경.
            - 진영 점수: 진영 공식 색 바탕 + 진영 이름 + 현재 `totalScore`. 경기 중에는 엔진 규칙대로 확정 점수(텔레옵 `TIP` × 20)만 올라가고 `FLOWER` / `GARDEN` / `PARK`는 종료 시 합산 (3.2항 실시간 확정 원칙 그대로).
            - `TIP` 횟수: HIVE 아이콘 + `{오토 팁 + 텔레옵 팁} / {다음 RP 목표}`. 목표는 4(`POLLINATOR 1`) → 달성 후 7(`POLLINATOR 2`) → 7 달성 후 `n / 7` + 달성 표시. 점수에는 오토 팁을 넣지 않는다 (2.6.5항 그대로).
            - 로봇: R1 / R2 팀 번호(+ 이름). 표시 옵션 `hitProbability`가 켜져 있으면 그 아래에 로봇별 `POLLEN` / `NECTAR` 명중 확률 (기존 캔버스 좌우 패널 내용을 이동, 계산 규칙은 3.7항 그대로).
            - 주차(P) 표시는 두지 않는다 (경기 중 확정 불가).
        - **필드 영역 (캔버스):** 필드 뷰포트만 그린다 (3.7항 캔버스 레이아웃).
            - **경고 토스트 (중앙 상단, 빨간색, 짧게 표시 후 사라짐):** 로봇이 리프트 상태(`FLOWER_SETUP` / `FLOWER_READY` / `FLOWER_DROPPING` / `FLOWER_LOWERING`)인데 그 로봇의 주행 입력(스틱 / 키)이 0이 아니면 경고 표시 (영어 "`LOWER LIFT (A) TO MOVE`", 한국어 "A로 리프트를 내려야 이동 가능", 문구 사전 `toast.lowerLift`). 같은 로봇은 약 2초에 한 번만. 리프트 상태 자체(올리는 중 / 올림 대기 / 투입 중 / 내리는 중)는 로봇 행동 상태 배지로 표시한다 (3.7항). 이 둘로 2.6.3항의 "리프트를 내려야 이동 가능" 안내 요구를 충족한다.
            - **자동 일시정지 배너:** 자동 일시정지 사유(창 포커스 소실 / 탭 숨김 / 게임패드 연결 해제)는 일시정지 동안 유지되는 배너로 표시.
            - **편집 모드 오버레이:** 경기 전에만 (아래 "필드 편집 모드").
        - **스크러버 줄 (필드 아래):**

            | 요소 | 동작 |
            |---|---|
            | 주 버튼 | 상태에 따라 하나: `START`(경기 전) / `PAUSE`(진행 중) / **`RESUME`**(게임패드 아이콘, 일시정지 + 보는 틱 = 마지막 기록 틱 + 경기 미종료) / **`BRANCH`**(갈라지는 화살표 아이콘, 일시정지 + 보는 틱 < 마지막 기록 틱) |
            | 재생 `▶` / `⏸` | 기록된 프레임을 배속으로 보기만 함 (기록 불변). 마지막 기록 틱에서 자동 정지 |
            | 한 틱 `◀` / `▶`, 1초(50틱) `⏮` / `⏭` | 빨리감기 모양 버튼, 일시정지 / 복기 중에만 |
            | 타임라인 막대 | 0 ~ 6000틱 눈금, 기록된 구간 안에서만 이동, 끌어서 이동 |
            | 배속 | 0.25 / 0.5 / 1 / 2× (재생에만 적용, 조종은 항상 1×) |
            | `VIEW` | 드라이버 / 관중석 시점 토글 (언제나 가능, 3.7항 전환 애니메이션) |
            | `NEW` | 설정 유지 새 경기 (확인창 → 관중석으로 회전 → `SETUP`, 시드 유지) |
            | `RESULT` | 경기 종료 후 결과 팝업 다시 열기 |

        - **분기 확인창:** "이 시점(`M:SS`) 이후 기록 {N.N}초가 삭제됩니다. 여기서부터 다시 조종할까요?" → 확인 시 엔진 `scrubTo(보는 틱)` 후 루프 재개. 기록 폐기는 3.6항 규칙 그대로 (`LIVE` 로봇 로그도 그 틱 이후 폐기, `REPLAY` 로그 유지). 분기 트리 보존은 Step 10.
    - **우측 config 창:**
        - **접힌 상태 (세로 아이콘 띠):**

            | 아이콘 | 상태 표시 |
            |---|---|
            | R1 / R2 로봇 | 초록 체크 = 준비 완료(LUT `READY` + 적용 안 된 수정 없음) / 진행률 링 = LUT `QUEUED` · `SEARCHING` · `GENERATING` (마우스 올리면 "63% · 약 7초 남음") / 빨간 느낌표 = 설정 미완료 · 검증 실패 · 적용 안 된 수정 · `ERROR` |
            | 시나리오 깃발 | 진영색 깃발 + 체크 = 유효 · 적용됨 / 빨간 느낌표 = 무효 또는 적용 안 된 수정 |
            | 게임패드 | 연결된 패드 수, 비표준 매핑 경고. 마우스 올리면 슬롯별 패드 이름 / 배정 로봇 |
            | 펼치기 | 아래 "열 수 있는 시점"에서만 활성 |

        - 경기 전 `START`를 눌렀는데 준비가 안 됐으면 config 창이 펼쳐지며 첫 문제 탭(R1 → R2 → 시나리오 순)으로 이동하고, 문제 입력칸으로 스크롤 + 강조한다. 설정은 모두 끝났고 LUT 생성만 남았으면 "R2 LUT 생성 중 63%" 안내만 한다.
        - **펼친 상태 = 탭 4개:** `R1` / `R2`(로봇 제원) / `SCENARIO` / `SETTINGS`(환경 및 조작).
        - **초안 / 적용:** 각 탭은 편집 중 값(초안)과 적용된 값을 따로 가진다. 탭 하단 `APPLY`는 초안이 유효하고 적용된 값과 다를 때만 활성. 검증 실패 입력칸은 빨간 테두리 + 빨간 설명 글자(구글 폼 방식). 적용 안 된 수정이 있으면 해당 아이콘이 빨간 느낌표가 되고 `START`를 막는다 (옛 값으로 조용히 시작하지 않도록).
        - **되돌리기:** 탭별 `RESET TAB`(해당 탭 초안을 공식 기본값 / 기본 프리셋으로), SETTINGS 탭의 `RESET ALL`(모든 설정을 기본값으로). 되돌리기는 초안에만 적용되고 `APPLY`로 확정.
        - **열 수 있는 시점 / 편집 가능 범위:**

            | 앱 상태 | config 펼치기 | R1 / R2 / SCENARIO 탭 | SETTINGS 탭 |
            |---|---|---|---|
            | `SETUP` (경기 전) | 가능 | 편집 가능 | 전부 편집 가능 |
            | 회전 애니메이션 / 진행 중 / 재생 중 | **불가** (펼쳐져 있었으면 자동으로 접힘) | — | — |
            | 일시정지 (경기 중 또는 복기) | 가능 | **읽기 전용** (경기가 존재하는 동안 잠금) | 표시 옵션 / 입력 출처 / 조작 모드 / 키보드 토글 / 언어 / 단위 / 기본 보기 편집 가능, `RESET ALL` 불가 |

        - 표시 옵션은 경기 전 또는 일시정지 중에만 바꿀 수 있다 (보기 방향 `VIEW`는 예외로 언제나 가능). `RESUME` / `BRANCH` / 재생을 누르면 config 창은 자동으로 접힌다.
    - **앱 상태 흐름:**

        ```
        SETUP ──START(모두 준비)──▶ ROTATING_IN ──(700 ms)──▶ RUNNING ◀──────RESUME──────┐
          ▲                                                   │                        │
          │                                   PAUSE / Space / 자동 일시정지                │
          │                                                   ▼                        │
          │                                                PAUSED ──(보는 틱 = 마지막 기록 틱)
          │                                                 │  ▲
          │                                          재생 ▶  │  │ 재생 끝 / ⏸
          │                                                 ▼  │
          │                                               PLAYBACK
          │
          │    RUNNING ──(6000틱)──▶ ENDED_HIGHLIGHT(5초) ──▶ RESULT(팝업) ──REVIEW──▶ REVIEW
          │                          (클릭 / Space로 건너뛰기)              (= 경기 종료 후 PAUSED, 재생 가능, RESUME 없음)
          │
          └── ROTATING_OUT ◀── NEW(확인창) ── 경기 시작 이후 모든 상태
              (관중석 회전, 같은 설정 · 같은 시드로 0틱 새 엔진)

        PAUSED / REVIEW ──BRANCH(보는 틱 < 마지막 기록 틱, 확인창)──▶ RUNNING  (그 틱 이후 기록 폐기)
        ```

        - **보는 틱(view tick)과 엔진 머리(head)를 구분한다.** 일시정지 중 스크러빙 / 재생 / 틱 이동은 보는 틱만 바꾸고 `engine.getFrame(보는 틱)`을 그린다. 보는 틱은 기록된 범위(0 ~ 마지막 기록 틱) 안에서 앞뒤로 자유롭게 움직인다. 엔진 상태를 되돌리는 `scrubTo`는 분기할 때만 호출한다.
        - **기록을 바꾸는 동작은 재개 / 분기뿐이다.** 재개는 마지막 기록 틱에서만 가능하고, 되감은 틱에서 이어 조종하려면 반드시 분기(확인창)를 거친다. 재생은 기록을 바꾸지 않으므로 제한이 없다.
        - 경기 종료 후에는 `RESUME`이 없고, 종료 전 틱으로 되감으면 `BRANCH`는 가능하다 (종료 경기의 90초 지점부터 다시 조종 등).
        - `NEW`는 설정과 시드를 유지한다. 시드는 SCENARIO 탭 `REROLL`로만 바뀐다.
        - 입력 출처 / 조작 모드 변경은 경기 전 또는 일시정지 중에만 가능하고, 다음 시작 / `RESUME` / `BRANCH`부터 적용.
        - **09-7 확정 (사용자 결정):** ① 마지막 기록 틱에서 재생을 누르면(경기 종료 후 Space 포함) 처음(0틱)부터 재생 ② 재생 중 주 버튼은 보는 틱 기준 `RESUME` / `BRANCH`, 누르면 재생을 멈추고 그 동작(`BRANCH`는 확인창) ③ 진행 중 `NEW`는 먼저 일시정지 후 확인창, 취소하면 일시정지 상태로 남음 ④ 경기 종료: 종료 강조를 보인 채 5초 대기(필드 클릭 / Space로 건너뜀) → 결과 팝업(점수 집계표) → `REVIEW`로 복기, `RESULT`로 다시 열기. 결과 팝업 기본형은 09-7a에 두고 세부 디자인은 09-12에서 확정.
        - **09-7 기본안 (사용자 승인):** 좌측 패널 / 필드는 보는 틱 기준. 확인창은 필드 위 중앙 어두운 모달 + 뒤 흐림(Enter 확인 / Esc 취소, 열린 동안 단축키 무시). 경고 토스트는 필드 위쪽 중앙 빨강 바탕 흰 글자 약 1.5초 + 흐려지며 사라짐, 같은 로봇 2초에 한 번, 로봇 이름 접두(`R2 · LOWER LIFT (A) TO MOVE`). 자동 일시정지 배너는 창 포커스 소실 / 탭 숨김 / 게임패드 해제로 멈췄을 때만 필드 위쪽 중앙 어두운 띠 + 주황 테두리(사유 + "Space / RESUME으로 재개"), 재개 · 분기 · 재생 시작 시 사라짐 (사용자 일시정지는 배너 없음). 타임라인 막대는 클릭 / 끌기로 보는 틱 이동(기록 밖은 마지막 기록 틱에 붙음, 끄는 동안 재생 멈춤, 동그라미 위 시간 표시). 1틱 / 1초 버튼은 길게 누르면 0.4초 뒤부터 반복(키보드 방향키는 키 자동 반복). 재생 중 창 포커스를 잃어도 재생 계속(자동 일시정지는 조종 중에만). 재생은 마지막 기록 틱에서 멈춤. 배속은 재생에만, 새 경기에서도 유지.
        - **경기 흐름 구현 (09-7a, `AppController`):**
            - 보는 틱 `viewTick`(진행 중에는 엔진 현재 틱을 따라감, 멈추면 멈춘 틱) / 머리 `headTick`(진행 중 = 현재 틱, 그 외 = 기록 마지막 프레임). 그리기와 상태 값(타이머 / 점수 / TIP / 명중 확률)은 보는 틱 프레임. 보는 틱 이동 / 재생은 엔진을 건드리지 않는다.
            - 조작: `setViewTick` / `stepView`(기록 구간 [0, 머리]로 제한, 재생 멈춤), `play`(머리면 0틱부터) / `stopPlayback` / `togglePlayback` / `setPlaybackSpeed`(0.25 / 0.5 / 1 / 2×, 벽시계 × 배속 × 50틱/초, 머리에 닿으면 멈춤), `resume`(일시정지 + 보는 틱 = 머리 + 미종료), `branch`(보는 틱 < 머리: `scrubTo` + `LIVE` 로봇 입력 로그를 그 틱 이후 폐기 + 재개, 이후 프레임은 첫 틱 진행 때 엔진이 폐기), `reset`(`NEW`), `skipHighlight` / `closeResult` / `openResult`, `setShortcutsEnabled`(확인창 / 팝업 동안 끔).
            - 종료 단계 `endStage`: 루프 `ENDED` → `HIGHLIGHT`(`END_HIGHLIGHT_MS` = 5000, 대기 중 프레임마다 시간 확인) → `RESULT` → `REVIEW`. 종료 강조 / 결과 팝업 중에는 보는 틱 이동 / 재생 / 재개 / 분기 불가. 종료 후 분기하면 `NONE`으로 돌아가고 다시 6000틱이면 다시 `HIGHLIGHT`.
            - 상태 추가: `headTick`, `matchEnded`, `canScrub`, `canResume`, `canBranch`, `playing`, `playbackSpeed`, `endStage`, `result`(종료 프레임의 총점 / `scoreBreakdown` / RP / 오토 + 텔레옵 TIP — 보는 틱과 무관). `tick` 이하 프레임 값은 보는 틱 기준.
            - 단축키(컨트롤러가 창 `keydown` 직접 처리, 주행 키는 입력 어댑터): Space = 경기 중 [종료 강조 → 건너뛰기, 결과 팝업 → 무시, 진행 → 일시정지, 재생 → 멈춤, 재개 가능 → 재개, 그 외 → 재생] (분기하지 않음, 자동 반복 무시, 텍스트 입력칸 제외 항상 기본 동작 막음). ← / →(Shift = 50틱)는 보는 틱을 움직일 수 있을 때만(진행 중에는 R2 회전), 키 자동 반복 = 연속 이동.
            - 화면(09-7a): 주 버튼 `mainButton` = `START` / 회전 중 비활성 / `PAUSE` / `BRANCH`(`GitBranch`, 주황) / `RESUME` / 비활성(종료 강조 · 결과 중, 종료 틱은 `BRANCH` 비활성). 1초 / 1틱 버튼(길게 누르면 반복), 재생 버튼(`CirclePlay` ↔ `CirclePause`), 배속, `NEW`(회전 중 비활성), `RESULT`(복기 중만). 타임라인은 보는 틱 동그라미 + 기록 구간 채움(끌기는 09-7b). 확인창은 09-7b 전까지 브라우저 기본 `confirm`(문구 `confirm.branch` = `branchConfirmParams`: 보는 틱 경기 시계 + 삭제될 기록 초 소수 1자리). 결과 팝업 기본형 `ResultPopup.tsx`: 뒤 흐림, 앱 이름 / `TELEOP MATCH COMPLETED` / 진영, 총점, `HIVE` / `FLOWER` / `GARDEN` / `PARK` 점수, `RP` 카드 3개(달성 초록 체크) + TIP 횟수, `RESTART`(= `NEW`, 확인창) / `REVIEW`. 종료 강조 중 필드 클릭 = 건너뛰기.
    - **로봇 제원 탭 (R1 / R2):**

        | 구역 | 항목 |
        |---|---|
        | 식별 | 팀 번호(GUI 전용, 엔진 미전달), 로봇 이름(`name`) |
        | 하드웨어 | 가로 / 세로, 최고 속도, 최고 각속도, 최대 선형 가속도, 최대 각가속도, 최대 적재 수 |
        | 인테이크 | `intakeZones` 편집기(면 / offset / width / depth, `FRONT` / `ANY` 프리셋, 로봇 기준 앞이 위인 미리보기), 흡입 딜레이, `NECTAR` 흡입 가능 |
        | 슈터 | 형식(`FIXED` / `TURRET`), 터렛 범위 또는 허용 조준 오차, 발사 딜레이, 발사구 지상고, 발사각, 발사구 오프셋, [고급 설정, 기본 접힘] 편차 3종 |
        | `FLOWER` 리프트 | 리프트 준비 시간, 투입 간격 |
        | 스윗스팟 → LUT | 스윗스팟 좌표 + 기준 셀 라벨 + `SET ON FIELD`(편집 모드), LUT 상태 / 기물별 v0 · 스윗스팟 명중률(0이면 경고) / 진행 막대 / 남은 시간, `SHOW HEATMAP`(히트맵 편집 모드) |
        | 편의 | `COPY TO R2`(R1 탭) / `COPY TO R1`(R2 탭): 팀 번호 / 이름을 뺀 전 항목을 상대 탭 초안으로 복사 |

        - 팀 번호 / 이름은 GUI 프로필(`RobotProfile { teamNumber, config: RobotConfig, ballistics: BallisticsConfig }`)에 두고 `RobotConfig` 타입은 수정하지 않는다.
        - LUT 시드 / 샘플 수는 고정값(`DEFAULT_BALLISTICS_SEED`, 격자당 2000 / v0 후보당 20000)이며 화면에 표시하지 않는다.
        - **단위 (화면 ↔ 엔진 변환은 GUI가 수행, 엔진에는 항상 명세 단위 = inch 기반):**

            | 항목 | 화면 단위 | 엔진 단위 |
            |---|---|---|
            | 길이 (가로 / 세로 / 인테이크 구역 / 오프셋 / 발사구 지상고 / 좌표) | in (토글 시 cm) | in |
            | 속도 / 가속도 | in/s, in/s² (토글 시 cm/s, cm/s²) | in/s, in/s² |
            | 최고 각속도 / 최대 각가속도 | **rad/s, rad/s²** (RoadRunner / Pedro Pathing 튜닝값과 같은 단위) | rad/s, rad/s² |
            | 터렛 범위 / 허용 조준 오차 / 발사각 / 방위 · 피치 편차 / 시작 헤딩 | ° (도) | rad |
            | 딜레이 / 준비 시간 / 투입 간격 | ms | ms |
            | 속도 편차 | % | 비율 (0.02 = 2%) |

            - **발사구 지상고 h**(바닥에서 잰 높이)를 받아 `dz = HIVE_RIM_Z − h = 53.5 − h`로 변환.
            - in / cm 토글은 SETTINGS 탭 공통 설정. **내부 값은 항상 inch로 보관**하고 표시할 때만 변환한다 (토글을 반복해도 반올림 누적 없음). 입력값은 입력한 단위에서 inch로 한 번만 변환.
            - 시작 헤딩 표시 규약: 0° = 필드 +x(관중석 시점 오른쪽), 양수 = 관중석 시점 시계 방향 (캔버스 y-down, 엔진과 같은 부호).
            - **표시 소수 자리 (09-6a 확정):** 길이 계열(길이 / 발사구 지상고 / 속도 / 가속도) 2자리, 좌표 1자리, ° 1자리, rad/s · rad/s² 2자리, ms 정수, % 1자리. 시작 헤딩 표시 범위 (−180°, 180°].
            - **구현 (09-6a, `src/ui/units.ts`):** 물리량 종류(`QuantityKind`: length / coordinate / launchHeight / speed / accel / angle / heading / angularRate / angularAccel / timeMs / percent)별 `toDisplay` / `fromDisplay` / `unitLabel` / `formatQuantity`, `parseNumberInput`(공백, 소수점 `.` · `,`, 부호, 지수 허용, 그 외 null). 길이 계열 입력은 변환 결과를 **1e-6 in 격자로 반올림**해, cm로 표시된 값을 그대로 다시 입력해도 원래 inch 값과 정확히 같다 (예: 45.72 cm → 18 in, 로봇 크기가 바뀐 것으로 보여 LUT를 다시 만드는 일 방지). 단, 표시 반올림으로 정보가 줄어드는 값(0.25 in = 0.635 cm → "0.64")은 표시값을 다시 넣으면 바뀌므로 **폼은 사용자가 실제로 고친 칸만 변환해 저장한다** (09-9 폼 구현 규칙).
        - **기본 프리셋:** R1 / R2 모두 개발 하네스 제원(`DEV_ROBOT_CONFIGS`: 18 in, 앞면 흡입, 고정형 ±3°) + **기본 탄도 설정 + 기본 스윗스팟** (값은 탄도 사전 준비 하위 Step 이후 LUT 결과를 보고 명중 띠가 드러나는 위치로 정함).
        - **스윗스팟 진영 기준 입력:** 사용자는 **현재 시나리오 진영(SCENARIO 탭 초안 값)의 공식 시작 상향 셀**(RED → `RED_AUDIENCE`, BLUE → `BLUE_OPPOSITE`)을 기준으로 스윗스팟을 찍는다. 스윗스팟 입력칸 옆에 기준 셀 라벨(예: "기준: `BLUE_OPPOSITE`")을 표시한다.
            - 저장은 기존대로 기준 셀 `RED_AUDIENCE` 좌표(`BallisticsConfig.sweetSpot`). BLUE는 입력 / 표시 때 필드 중심 점대칭 (x, y) ↔ (144 − x, 144 − y)로 변환한다 (`mirrorLUTSet`의 `BLUE_OPPOSITE` = 가로 · 세로 모두 뒤집기와 같은 변환, 격자 중심 x.5는 x.5로 옮겨짐).
            - 진영을 먼저 정할 필요는 없다 (진영은 항상 값이 있음, 기본 `RED`). 나중에 진영을 바꿔도 저장값은 그대로이므로 LUT는 무효화되지 않고, 같은 스윗스팟이 새 진영 기준으로 대칭 이동해 보일 뿐이다. 시나리오에서 상향 셀을 바꿔도 표시 기준 셀은 바뀌지 않는다.
            - 히트맵 미리보기도 같은 기준으로 표시한다 (BLUE는 기준 LUT를 점대칭 복사한 `BLUE_OPPOSITE` 장).
    - **시나리오 탭:**

        | 항목 | 입력 |
        |---|---|
        | 진영 | `RED` / `BLUE` |
        | `HIVE` 초기 상태 | 상향 셀(`AUDIENCE` / `OPPOSITE`), 상향 셀 `POLLEN` / `NECTAR` 수 |
        | 로봇 적재물 | R1 / R2 순서 있는 목록(FIFO, 0번이 먼저 나감), 칸별 `POLLEN` / `NECTAR` / 빈 칸 |
        | 잔여 기물 | `FLOWER` 4개 각 `POLLEN` 수, `GARDEN` 아군 / 상대 `POLLEN` 수 |
        | 오토 팁 | `autoTipCount` 조절기 (0 ~ 5) |
        | 시작 자세 | R1 / R2 x, y, 헤딩 숫자 입력 + `EDIT ON FIELD`(편집 모드: 드래그 + 회전 핸들, 스냅 없음) |
        | 시드 | 현재 경기 시드 표시(읽기 전용) + `REROLL` 버튼 (경기 전에만) |
        | 유효 배지 | 유효 = 초록 배지. 무효 = 빨간 배지 + 오류 목록, 해당 입력칸 빨간 표시, `APPLY` 비활성 |

        - 검증 = `validateScenario()`(2.4항) + `validateRobotPlacement()`(아래). 둘 중 하나라도 오류가 있으면 적용할 수 없다.
        - 바닥 잔여 공은 기존대로 자동 계산 + 무작위 산포 (직접 배치 GUI는 v1 이후).
    - **SETTINGS 탭 (환경 및 조작):**

        | 구역 | 항목 | 변경 가능 시점 |
        |---|---|---|
        | 게임패드 | 슬롯별 패드 이름 / 배정 로봇 / 비표준 매핑 경고 / "버튼을 한 번 눌러 연결" 안내 (읽기 전용, 매핑 편집 없음) | — |
        | 입력 | 로봇별 입력 출처(`LIVE` / `REPLAY` / `NONE`), 로봇별 조작 모드(`FIELD` / `ROBOT`), 키보드 주행 켜기 / 끄기 (기본 켬) | 경기 전 / 일시정지 |
        | 표시 옵션 | 3.7항 5종 (조준선, 흡입 진행, 명중 확률, 비행 잔상, 비행 결과 색) | 경기 전 / 일시정지 |
        | 화면 | 언어(English / 한국어), 길이 단위(in / cm), 기본 보기 방향(`DRIVER` / `AUDIENCE`) | 경기 전 / 일시정지 |
        | 초기화 | `RESET ALL` | 경기 전만 |
        | 프리셋 관리 (JSON 내보내기 / 불러오기) | Step 10 (Step 9에서는 숨김) | — |

        - **기본 입력 출처:** 경기 시작 시 R1 = 슬롯 0 패드 연결 시 `LIVE`, 아니면 `NONE` / R2 = 슬롯 1 패드 연결 **또는 키보드 켜짐**이면 `LIVE`, 아니면 `NONE` (패드 없이 키보드로 R2를 몰 수 있고, 키보드를 끄면 패드 1개일 때 R2 = `NONE`). 이후 일시정지 중 변경 가능.
        - **설정 자동 보관 (`localStorage`):** 마지막으로 적용한 로봇 프로필 / 시나리오와 UI 환경설정(언어, 단위, 기본 보기, 표시 옵션, 키보드 토글)을 보관해 새로고침 후 복원한다. 경기 기록은 보관하지 않는다 (3.6항, 새로고침 시 경기 폐기 유지). 저장소를 쓸 수 없으면 기본값으로 시작. JSON 내보내기 / 불러오기는 Step 10.
        - **키보드 단축키 (상태별 키 공유):** 주행 키는 루프 `RUNNING`에서만, 스크러빙 단축키는 일시정지 / 복기 중에만 쓰이므로 같은 키를 겹쳐 쓴다. 키보드 주행을 꺼도 단축키는 항상 동작.

            | 키 | 진행 중 (`RUNNING`) | 일시정지 / 복기 | 재생 중 |
            |---|---|---|---|
            | Space | 일시정지 | 보는 틱 = 마지막 기록 틱이고 경기 미종료면 `RESUME`, 그 외에는 재생 시작 (**Space는 분기하지 않음**) | 재생 멈춤 |
            | ← / → | R2 회전 (3.6항) | ∓1틱 | 재생 멈추고 ∓1틱 |
            | Shift + ← / → | — | ∓1초 (50틱) | 재생 멈추고 ∓1초 |
            | 그 외 주행 키 (W / A / S / D, M, `,` `.` `/`) | R2 주행 / 행동 (3.6항) | 무시 | 무시 |

            - 일시정지 중 누른 방향키가 재개 후 주행으로 새지 않는 것은 3.6항 규칙(시작 / 재개 시 입력 누적기 초기화)으로 보장된다.
            - 텍스트 입력칸에 초점이 있으면 단축키를 무시한다. Space는 브라우저 기본 동작(스크롤 / 버튼 누름)을 막는다. 게임패드에는 일시정지 / 재개를 매핑하지 않는다.
    - **필드 편집 모드 (경기 전 `SETUP`에서만, 관중석 시점):** config 창의 편집 버튼을 누르면 메인 필드가 그 편집 모드로 바뀐다. 필드 위쪽에 안내 띠(모드 이름, `DONE` / `CANCEL`, Esc = 취소)를 띄우고, config 창에는 같은 값의 숫자 입력칸이 함께 보인다. 한 번에 한 모드만. 편집 중 `START`를 누르면 편집을 취소하고 시작 절차로.

        | 모드 | 조작 | 표시 |
        |---|---|---|
        | 스윗스팟 (`SWEET_SPOT`) | 클릭 = 그 격자 중심으로 스윗스팟 초안 설정 | 마우스를 올린 격자 강조 + 좌표, 조준점을 향해 돌린 로봇 몸체 윤곽, 검증 실패 사유(`validateBallisticsConfig`, 2.6.2항), 기준 셀 조준점, (LUT가 있으면) 히트맵 반투명 |
        | 시작 자세 (`SPAWN`) | 로봇 몸체 드래그 = 위치, 회전 핸들 드래그 = 헤딩 | 두 로봇 + 배치 검증 결과(겹친 로봇 빨간색 + 사유), 좌표 / 헤딩 글자 |
        | 히트맵 (`HEATMAP`) | 기물 종류 전환 | 진영 기준 셀 LUT (명중률 색 척도, 미계산 행 회색 빗금), 필드 윤곽 / `HIVE` / 조준점 / 스윗스팟. 생성 중이면 행 묶음 도착마다 갱신 (최대 약 10 Hz, 2.6.2항 점진 히트맵) |

        - 클릭 / 드래그 좌표는 3.7항 역변환(`cssToCanvas` → `canvasToField`)을 쓴다.
        - 편집 화면을 config 창 안에 따로 두지 않는 이유: 1366 × 768에서 config 창 폭(약 480u)의 캔버스는 1 in 격자가 약 2.5 px라 클릭이 불가능하고, 경기 전 메인 필드는 비어 있으며 보기도 같은 관중석 시점이다.
    - **시작 자세 배치 검증 (`validateRobotPlacement(scenario, r1Config, r2Config) → PlacementIssue[]`):** `collision.ts`의 OBB / SAT를 재사용하는 순수 함수. 시작 자세 미지정 로봇은 진영별 기본 스폰(2.3항)으로 검사.

        | 코드 | 조건 |
        |---|---|
        | `PLACEMENT_OUT_OF_FIELD` | 로봇 OBB가 필드 [0, 144]² 밖으로 나감 |
        | `PLACEMENT_IN_HIVE` | OBB가 `HIVE` AABB와 겹침 |
        | `PLACEMENT_IN_FLOWER` | OBB가 `FLOWER` 원(반지름 2 in)과 겹침 |
        | `PLACEMENT_ROBOT_OVERLAP` | R1 / R2 OBB끼리 겹침 |
        | `PLACEMENT_PIECE_OVERLAP` | OBB가 시나리오로 결정되는 고정 배치 기물(`GARDEN` 기물)과 겹침 |

        - **닿음은 허용, 파고듦만 오류** (침투 깊이 > 1e-6 in). 기본 스폰은 벽에 붙어 있으므로 통과해야 한다.
        - 바닥 무작위 산포 기물과 오토 팁 `NECTAR` 로딩 존 슬롯은 이미 로봇을 피해 배치되므로 검사 대상이 아니다.
        - **`reset()` 사전 보정 (엔진 안전장치):** GUI를 거치지 않은 겹친 시작 자세에 대비해, 0번 프레임 기록 전에 로봇 – 환경 / 로봇 – 로봇 겹침을 기존 충돌 보정으로 해소한다 (시간 진행 없음, 결정론 유지). `validateScenario`의 "잘라서 수용"과 같은 역할. 반복 횟수 / 순서는 구현 하위 Step에서 정한다.
        - **구현 (09-5, `simulationEngine.ts`):**
            - `validateRobotPlacement(scenario, r1Config, r2Config) → PlacementIssue[]`(`{ code, robots, message }`, `robots` = 문제 로봇 id, 로봇끼리 겹침은 두 로봇), `PLACEMENT_TOLERANCE = 1e-6`. 필드 경계 = `testOBBvsFieldBounds`, HIVE = `testOBBvsAABB`, FLOWER = `testOBBvsCircle`(메시지에 FLOWER 번호), 로봇끼리 = `testOBBvsOBB`, GARDEN 기물 = `testOBBvsCircle`. 시작 자세는 엔진과 같은 `resolveSpawnPose`(비유한값 → 기본 스폰), 로봇별 크기 사용.
            - GARDEN 기물 좌표는 `reset()`과 검증이 같은 함수(`gardenPiecePositions`)를 쓴다 (시나리오 아군 / 상대 수량, 0 ~ 8 제한).
            - 사전 보정은 **로봇 생성 직후 · 기물 배치 전**에 한다 → 바닥 산포가 보정된 로봇 자리를 피한다. 로봇 – 환경 / 로봇 – 로봇 겹침(검증과 같은 판정, 기물 제외)이 있는 동안 틱마다 쓰는 로봇 충돌 해결(`resolveRobotCollisions`)을 최대 50회 반복한다 (한 로봇이 장애물에 막히면 로봇끼리 겹침이 반복마다 절반씩 줄어들므로 최대 겹침 18 in도 허용 오차 안으로 수렴). 겹침이 없으면 아무것도 바꾸지 않으므로 기존 시나리오의 프레임은 비트 단위로 그대로다 (이전 커밋 엔진과 비교 확인).
            - GARDEN 기물과의 겹침은 사전 보정 대상이 아니다 (로봇은 그대로, 다음 틱 기물 충돌 처리에서 기물이 밀림 — 6.4항 1프레임 겹침과 같은 성격). GUI는 검증으로 막는다.
    - **경기 종료와 결과 팝업:** 6000틱 도달 → 루프 정지 → **5초 동안 필드 경기 종료 강조만**(3.7항) → 뒷배경 블러 + **큰 결과 팝업**. 클릭 / Space로 5초 대기를 건너뛸 수 있다.
        - 팝업 구성(사용자 제공 시안 기준, 세부는 해당 하위 Step에서 사용자와 확정): 헤더(`FTC TacticSim` / `TELEOP MATCH COMPLETED` / 진영), 로봇(팀 번호 + 이름), 총점, 항목별 득점(`HIVE` / `FLOWER` / `GARDEN` / `PARK`, `scoreBreakdown`만 읽음, 3.2항), `RP` 카드(`SWARM` / `POLLINATOR 1` / `POLLINATOR 2`, 팁 횟수는 오토 포함), 동작 `REVIEW`(팝업 닫고 복기) / `RESTART`(= `NEW`). 로그 / JSON 내보내기는 Step 10.
    - **LUT 생성 흐름 연결 (2.6.2항 보완):** 생성 시작 = 로봇 탭 `APPLY`에서 LUT 무효화 조건이 바뀌었을 때 + 앱 시작 시 기본 프리셋 / 자동 보관 설정 (캐시 적중이면 즉시 `READY`). 진행 표시 위치 = 접힌 config 띠의 로봇 아이콘 진행률 링 + 로봇 탭(진행 막대, 남은 시간, v0 / 스윗스팟 명중률) + 히트맵 편집 모드. `START` 비활성 사유는 config 창 / 아이콘으로 안내.

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
// (엔진 입력 RobotDriveInput.actionState의 타입, 07-2 적용)
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
// 충돌 후 자유 비행 구간 (08-2). 시각은 발사 후 초, τ = t − t0
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

// 경기 종료(Tick 6000) 득점 내역 (08-1 확정, 08-3 구현 완료). hive + flower + garden + park = totalScore
export interface ScoreBreakdown {
  hive: number;   // 텔레옵 팁 × 20
  flower: number; // 득점 FLOWER의 (slot[1..N] 기물 수 × 2 + 하단 보너스 5) 합
  garden: number; // 아군 GARDEN 인정 기물 수 × 1
  park: number;   // 주차 인정 로봇 수 × 5
  // FLOWER별 (FLOWER_IDS 순서): scoringPieces = slot[1..N] 기물 수 (소유 여부와 무관), owned = 아군 NECTAR 존재, points = 그 FLOWER 점수
  flowers: { id: string; scoringPieces: number; owned: boolean; points: number }[];
  gardenPieceIds: string[];               // 득점 인정 GARDEN 기물 id
  parkedRobots: ('robot1' | 'robot2')[];  // 주차 인정 로봇
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
  scoreBreakdown: ScoreBreakdown | null; // 종료 프레임(Tick 6000)만 기록, 그 외 null
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
    - 종료 프레임에는 항목별 득점 내역과 인정 근거(`scoreBreakdown`, 3.2항)를 함께 기록하고, 그 외 프레임은 `null`로 두라.
10. **렌더러 (3.7항):** 렌더러는 프레임 / 로봇 제원 / 보기 / 표시 옵션만으로 그리며 엔진을 호출하거나 득점 규칙을 다시 계산하지 않는다. 좌표 계산은 순수 함수로 분리해 테스트하라.

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
| 07-2 | FLOWER 리프트 FSM 엔진 구현 (올림 / 대기 / 투입 / 내림, `ActionRequest`) (아래 6.2.9) | `simulationEngine.ts`, `types.ts`, `__tests__/simulationEngine.test.ts` |
| 07-3 | 입력 설정 + 순수 변환 (장치 읽기, 탭 래치, 장치 합성, 조작 모드, 행동 요청, 8비트 부호화) (아래 6.2.10) | `src/input/inputConfig.ts`, `src/input/controls.ts`, `src/input/__tests__/controls.test.ts` |
| 07-4 | 입력 로그 + 로봇별 입력 출처 + 녹화 덧입히기 + 로그 재생 공급 함수 (아래 6.2.11) | `src/input/inputLog.ts`, `src/input/__tests__/inputLog.test.ts` |
| 07-5 | 실시간 루프 컨트롤러 + 입력 수집기 (20 ms 누산기, 따라잡기 5틱, 일시정지 / 재개, 종료) (아래 6.2.12) | `src/input/realtimeLoop.ts`, `src/input/liveControls.ts`, `src/input/inputConfig.ts`, `src/input/__tests__/realtimeLoop.test.ts` |
| 07-6 | 브라우저 입력 어댑터 (게임패드 폴링, 키보드, rAF, 자동 일시정지 이벤트) + 헤드리스 Chromium 점검 (아래 6.2.13) — Step 7 완료 | `src/input/browserInput.ts`, `src/input/__tests__/browserInput.test.ts` |
| 08-1 | 렌더러 / 화면 연결 명세 구체화 (보기 방향, 캔버스 레이아웃, 로봇 / 기물 / HIVE / FLOWER · 재고 게이지 / 비행 공 표시, 표시 옵션, 경기 종료 득점 내역, 개발 하네스) (아래 6.2.14) | 명세서 |
| 08-2 | 발사 비행 개정(06-6): HIVE / 벽 충돌 후 반사 포물선 낙하, 충돌 후 구간 기록, 무효 명중 반사 (아래 6.2.15) | `ballistics.ts`, `simulationEngine.ts`, `types.ts`, 두 엔진 테스트 파일, 입력 테스트 제한 시간 |
| 08-3 | 경기 종료 득점 내역 `scoreBreakdown` 기록 (항목별 점수 + 인정 근거) (아래 6.2.16) | `simulationEngine.ts`, `types.ts`, `__tests__/simulationEngine.test.ts` |
| 08-4 | 장면 렌더러 1: 캔버스 레이아웃 / 좌표 변환 / 보기 회전 · 애니메이션, 정적 레이어 캐시(상대 진영 채도 제거), 구조물 라벨, 로봇, 바닥 기물 (아래 6.2.17) | `src/renderer/viewTransform.ts`, `robotLayout.ts`, `badgeAssets.ts`, `sceneRenderer.ts`, `canvasRenderer.ts`, `src/renderer/__tests__/` |
| 08-5 | 장면 렌더러 2: HIVE 셀 상태 / 팁 낙하 연출, FLOWER 9칸 게이지, NECTAR 재고 게이지, 경기 종료 강조 (아래 6.2.18) | `src/renderer/gaugeLayout.ts`, `sceneRenderer.ts`, `canvasRenderer.ts`, `collision.ts`, `simulationEngine.ts`, `__tests__/gaugeLayout.test.ts` |
| 08-6 | 장면 렌더러 3: 비행 공(명목 구간 보간 + 끝점 보정, 충돌 후 구간, 그림자 / 높이 오프셋 / 크기), 표시 옵션 5종 (아래 6.2.19) | `src/renderer/flightView.ts`, `renderOptions.ts`, `sceneRenderer.ts`, `__tests__/flightView.test.ts`, `__tests__/renderOptions.test.ts` |
| 08-7 | 개발 하네스: 정식 엔진 / 입력 / 실시간 루프 / 렌더러 화면 연결, 회전 후 루프 시작, 옵션 체크박스 (아래 6.2.20) — Step 8 완료 | `src/dev/devSetup.ts`, `harnessController.ts`, `DevHarness.tsx`, `src/dev/__tests__/harness.test.ts`, `App.tsx`, `App.css` |
| 09-1 | 웹 GUI 명세 구체화 (메인 화면 / config 창 / 앱 상태 흐름 / 재생 · 재개 · 분기 / 단위 / 스윗스팟 진영 기준 / 배치 검증 / 결과 팝업 / 하위 Step 분할) (아래 6.2.21) | 명세서 |
| 09-2 | `ballistics.ts` LUT 병렬 생성 사전 준비: 행 범위 LUT, 시드 파생 공개, 모델 버전, 스윗스팟 진영 기준 변환 (아래 6.2.22) | `ballistics.ts`, `__tests__/ballistics.test.ts` |
| 09-3 | LUT Worker 풀 + 작업 대기열(v0 탐색 우선) + 조립 + 로봇별 상태 머신 / 취소 / 재요청 무시 / 오류 처리 (아래 6.2.23) | `src/workers/lutProtocol.ts`, `lutWorker.ts`, `createLUTWorker.ts`, `lutManager.ts`, `src/workers/__tests__/lutManager.test.ts` |
| 09-4 | IndexedDB LUT 캐시 (SHA-256 키, 기준 셀 LUT 저장 / 4셀 복원, 최근 사용 20개 + 다른 모델 버전 삭제, 실패 허용) + 관리자 연동 (아래 6.2.24) | `src/workers/lutCache.ts`, `lutManager.ts`, `src/workers/__tests__/lutCache.test.ts`, `fakeWorker.ts` |
| 09-5 | 시작 자세 배치 검증 `validateRobotPlacement`(오류 코드 5종, 닿음 허용) + `reset()` 사전 보정 (아래 6.2.25) | `simulationEngine.ts`, `__tests__/simulationEngine.test.ts` |
| 09-6a | GUI 순수 기반: 문구 사전 `t()`(영어 / 한국어), 단위 변환 · 표시(길이 소수 2자리, 1e-6 in 입력 반올림), 입력 문자열 해석, 경기 타이머 표시 (아래 6.2.26) | `src/ui/i18n.ts`, `src/ui/units.ts`, `src/ui/__tests__/` |
| 09-6b | 렌더러 전환: 캔버스 = 필드 뷰포트 800 × 800(좌우 패널 삭제, 장면 입력 `shotResolver` 제거), 혼합 테마, 진영 공식 색, `LOADING ZONE` 두 줄 라벨 (아래 6.2.27) | `viewTransform.ts`, `canvasRenderer.ts`, `sceneRenderer.ts`, `renderOptions.ts`, 하네스, `src/renderer/__tests__/` |
| 09-6c | 앱 컨트롤러 `AppController`(경기 설정 주입, 하네스 흐름 일반화, 상태에 TIP / RP / 명중 확률), 하네스를 그 위로 이전 (아래 6.2.28) | `src/app/appController.ts`, `src/dev/devSetup.ts`, `DevHarness.tsx`, `src/app/__tests__/appController.test.ts` |
| 09-6d | 화면 뼈대: 좌측 득점 패널 / 필드 / 접힌 config 띠(표시만) / 스크러버 줄(기존 동작만), 화면 비례 단위 `--u`, 글꼴(Apple SD Gothic Neo → Pretendard) / lucide 아이콘, 새 GUI 기본 화면 + 하네스 `?harness` (아래 6.2.29) | `src/components/`, `src/ui/mainScreenModel.ts`, `src/app/defaultSetup.ts`, `src/renderer/fonts.ts`, `App.tsx`, `main.tsx`, `src/ui/__tests__/mainScreenModel.test.ts` |
| 09-7a | 경기 흐름: 보는 틱 / 재생 · 배속 / 틱 · 1초 이동 / 재개 · 분기 / 종료 강조 5초 → 결과 팝업(기본형) → 복기, 상태별 단축키, 스크러버 줄 연결 (아래 6.2.30) | `appController.ts`, `realtimeLoop.ts`, `ScrubberBar.tsx`, `ResultPopup.tsx`, `MainScreen.tsx`, `mainScreenModel.ts`, 테스트 |

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

- **08-2 개정:** 위 반사 방출(`ejectFromHive`: HIVE 외곽 바닥에 무작위 속도 즉시 스폰)과 벽 앞 즉시 정지는 08-2에서 충돌 후 반사 포물선 낙하로 교체됨 (6.2.15).

### 6.2.8 Step 07-1 (입력 계층 명세 구체화) 완료 항목

- **FLOWER 리프트 FSM (2.6.3항):** 올림(`FLOWER_SETUP`) → 대기(`FLOWER_READY`) ⇄ 투입(`FLOWER_DROPPING`) → 내림(`FLOWER_LOWERING`). `IDLE`에서 투입 요청 무효, 내림 시간 = 올린 시간(`flowerSetupDelay` 기준), 투입 중 내림 요청 무시, 리프트 상태에서 슈팅 / 흡입 불가. 새 타입 `ActionRequest`.
- **입력 계층 (3.6항):** `inputConfig.ts` 키 매핑(표준 Gamepad 0부터: LT 6 흡입, RT 7 발사, A 0 리프트 토글, B 1 투입 / 키보드 WASD · ← → · m , . /), 장치 배정(패드 0 → R1, 패드 1 → R2, 키보드 → R2 비공개 디버그), 데드존, 필드 기준(기본) / 로봇 기준 조작, 우선순위 `SHOOTING > FLOWER_DROPPING > FLOWER_SETUP > INTAKING`, 리프트 토글의 엔진 상태 유도, 짧은 탭 래치.
- **8비트 양자화 / 입력 로그:** 로봇별 틱당 4 B, 입력 수신 시점 부호화 → 복호화 후 엔진 입력, 로봇별 입력 출처(`LIVE` / `REPLAY` / `NONE`)와 녹화 덧입히기.
- **실시간 루프:** 20 ms 누산기, 따라잡기 상한 5틱, 포커스 소실 / 탭 숨김 / 패드 분리 시 자동 일시정지(누산 시간 · 입력 초기화, 일시정지 틱에서 재개), 새로고침 등으로 사라진 경기는 폐기.
- **측정:** 풀매치 타임라인 힙 약 46 MB, `runFullMatch()` 약 1.6초 (Node, 로봇 1대 주행 입력).

### 6.2.9 Step 07-2 (FLOWER 리프트 FSM) 완료 항목

- **타입:** `RobotState.actionState`에 `FLOWER_READY` / `FLOWER_LOWERING` 추가, 요청 타입 `ActionRequest` 신설 (`RobotDriveInput.actionState`). 리프트 상태는 `IDLE` / `INTAKING` 외 상태로서 기구학상 자동으로 Stationary Lock.
- **엔진 (`applyActionRequest` / `processActionCompletion`):** `IDLE` / `INTAKING`에서 올림 요청만 수락(투입 가능할 때), 투입 요청 무효. 올리는 중 내림 = 올린 시간(제동 중이면 즉시 `IDLE`), 올림 완료 → `FLOWER_READY`. 대기 중 투입 요청(투입 가능할 때) → `FLOWER_DROPPING`, 내림 요청 → `FLOWER_LOWERING`(`flowerSetupDelay`). 투입 / 내림 / 발사는 커밋. 투입 완료 후 투입 요청 유지 + 다음 기물 가능 → 연속 투입, 그 외 대기 복귀. 내림 완료 → `IDLE`.
- **테스트:** 기존 D / J / K / N / O를 올림 → 투입 흐름(헬퍼 `stepDrop`: A 켬 + B 유지와 같은 입력)으로 갱신 — 투입 후 리프트는 `FLOWER_READY` 유지, 가득 찬 FLOWER에 투입 요청 시 대기 유지, 투입 중 FLOWER가 가득 차면 완료 시 거부 후 대기 복귀. 엔진 T(리프트 FSM: `IDLE` 투입 무효, 올림 25틱 후 대기, 투입 탭 1개 커밋, 대기 중 내림 25틱, 올리는 중 내림 = 올린 시간, 제동 중 취소 즉시 `IDLE`, 투입 중 내림 무시, 내림 중 올림 무시, 리프트 상태 슈팅 / 흡입 불가, 정지 유지) 추가. 올림 완료 시 자동 투입, 부분 내림을 전체 시간으로, 투입 중 내림 수용, `IDLE` 투입 수락, 제동 중 즉시 `IDLE` 제거, 대기 중 주행 허용, 내림 중 올림 수용, 투입 후 `IDLE` 복귀 각각에서 실패함을 확인.

### 6.2.10 Step 07-3 (입력 설정 + 순수 변환) 완료 항목

- **`src/input/inputConfig.ts`:** 게임패드 축 / 버튼 매핑(`GAMEPAD_AXES`, `GAMEPAD_BUTTONS`: 표준 배열 0부터, 트리거는 아날로그 임계값), 키보드 매핑(`KEYBOARD_BINDINGS`, `event.code`), `KEYBOARD_ENABLED`, 장치 배정(`DEVICE_ASSIGNMENT`), `TRIGGER_THRESHOLD`, `DEADZONE_LEFT` / `DEADZONE_RIGHT_X`, `DEFAULT_DRIVE_MODE`, `QUANT_MAX`. 루프 상수(20 ms, 따라잡기 상한 5틱)는 07-5에서 추가.
- **`src/input/controls.ts` (DOM 비의존 순수 함수):**
    - 장치 읽기: `readGamepad`(구조적 `GamepadSnapshot`, 원형 / 축 데드존 `applyRadialDeadzone` / `applyAxialDeadzone`, 비유한값 0), `readKeyboard`(눌린 코드 집합, 대각선 정규화) → 드라이버 기준 `ControlSample`.
    - 탭 래치: 장치별 `ControlLatch`(`sample` / `consume` / `reset`) → `TickControls`(유지형 = 현재 OR 에지, 토글 = 에지, 여러 틱 소비 시 에지는 첫 틱만).
    - 장치 배정 / 합성: `assignedDevices`, `mergeTickControls`(축 절댓값 큰 값, 버튼 / 토글 OR).
    - 조작 모드: `driverToField`(FIELD RED / BLUE, ROBOT 헤딩 회전, 합성 후 단위원 제한).
    - 행동 요청: `resolveActionRequest`(직전 엔진 상태에서 리프트 의도 유도, 리프트 중 RT / LT 무시, 투입 중 A 무효, 우선순위), `buildDriveCommand`.
    - 8비트: `quantizeUnit`(부호 대칭 반올림), `encodeDriveCommand` → `[qx, qy, qω, action]`, `decodeDriveInput`(튜플 / `Int8Array` 오프셋, ±127 제한, 알 수 없는 행동 코드는 `IDLE`), `ACTION_CODES` 고정 순서.
- **테스트 (`src/input/__tests__/controls.test.ts`, 그룹 A~I):** A 설정 기본값, B 게임패드(축 방향 / 데드존 / 트리거 임계값 / X·Y 미배정), C 키보드, D 짧은 탭 래치(유지형 3종 / 토글 / 캐치업 첫 틱 / 최신 축 / reset), E 장치 합성, F 조작 모드, G 행동 요청(상태 × 버튼 조합), H 8비트 부호화 / 복호화, I 엔진 연동(부호화 → 복호화 → `step`: RED / BLUE 전진, 리프트 전체 흐름, 리프트 중 RT / 스틱 무시, 투입 중 A 무효, 거부된 A가 FLOWER 옆에서 다시 발동하지 않음). Y축 반전 제거, 데드존 재조정 제거, 래치 에지 무시(흡입 / 투입) / 미초기화, 축 합산, BLUE 미반전, 로봇 기준 부호 반전, 흡입 우선, 리프트 중 RT 반영, 투입 중 A 내림, `IDLE`에서 B 유효, 비대칭 반올림, 복호화 제한 제거, 단위원 제한 제거 각각에서 실패함을 확인.

### 6.2.11 Step 07-4 (입력 로그 / 입력 출처 / 녹화 덧입히기) 완료 항목

- **`src/input/inputLog.ts`:**
    - `InputLogChannel`: `Int8Array(6000 × 4)` 미리 할당, `write(t, record)`(t 이후 폐기, 끝 뒤에 쓰면 사이 틱 중립 채움, 범위 밖 `RangeError`), `has` / `truncate` / `clear`, `length`.
    - `MatchInputs`: 로봇별 `logs` / `sources`(기본 둘 다 `LIVE`) / `modes`(기본 `FIELD`). `resolve(engine, live)`: 엔진 현재 틱에서 `LIVE`는 직전 로봇 상태 · 엔진 진영 · 로봇별 모드로 명령을 만들어 기록 후 복호화, `REPLAY`는 로그 복호화(기록 범위 밖 중립), `NONE`은 중립. `step(engine, live)` = `resolve` + `engine.step`(경기 종료 후 기록 없음). `createReplayProvider()`: 출처 복사, `LIVE`도 읽기 전용 재생, 로그에 쓰지 않음.
    - 되감기 분기는 별도 처리 없이 성립: 되감은 틱 k에서 `LIVE` 로봇이 기록하면 k 이후 로그가 폐기되고, 엔진은 k 이후 프레임을 폐기(기존 규칙), `REPLAY` 로봇 로그는 유지.
- **테스트 (`src/input/__tests__/inputLog.test.ts`, 그룹 A~F):** A 로그 채널(기록 / 앞 틱 덮어쓰기 절단 / 빈 틱 중립 채움 / 범위 밖 거부), B 입력 출처(LIVE 기록 = 부호화 값, 로봇별 제원 복호화, NONE 미기록, REPLAY 절단된 옛 데이터 미재생, 로봇별 헤딩 · 모드, 엔진 진영, 로봇별 리프트 의도), C 풀매치 실시간 = 로그 재생(6000틱 전 프레임 동일, 발사 포함 / 명중 확률 0.6, R2 로봇 기준 모드, 재생 중 로그 불변), D 녹화 덧입히기(1회차 R1 기록 → 되감기 → 2회차 R1 재생 + R2 실시간: 간섭 없으면 R1 궤적 동일, R2가 경로에 들어오면 명령은 같고 궤적은 달라짐, R1 로그 불변, 덧입힌 결과 로그 재생 재현), E 되감기 분기(LIVE 로그 400틱 이후 교체 / REPLAY 로그 유지 / 분기 결과 재현), F 재생 공급 함수(출처 복사 고정, NONE은 로그 무시). 복호화 생략(원시 값 입력), 덮어쓰기 절단 제거, 빈 틱 채움 제거, 재생 중 기록, 출처 미복사(R1 / R2), NONE 로그 재생, 절단 데이터 재생, 다른 로봇 상태 사용, 진영 무시, 모드 공유(R1 / R2) 각각에서 실패함을 확인.

### 6.2.12 Step 07-5 (실시간 루프) 완료 항목

- **`inputConfig.ts`:** 루프 상수 `TICK_MS = 20`(엔진 DT), `MAX_CATCHUP_TICKS = 5` 추가.
- **`src/input/liveControls.ts`:** `LiveControlSource` 인터페이스(`poll?` / `consumeTick` / `reset`), `LiveControlCollector`(배정 장치별 탭 래치 → 로봇별 합성, 미배정 슬롯 무시, 연결 해제 중립, 키보드 비활성화 반영).
- **`src/input/realtimeLoop.ts`:** `RealtimeLoop`(주입 스케줄러, 20 ms 누산기, 따라잡기 상한 후 밀린 시간 버림 / 1틱 미만 나머지 이월, 프레임마다 `poll` 후 틱 소비, 일시정지 시 요청 취소 · 누산 0 · 입력 초기화, 재개 첫 프레임 경과 0 · 입력 초기화, 6000틱 도달 시 `ENDED`).
- **테스트 (`src/input/__tests__/realtimeLoop.test.ts`, 그룹 A~H, 가짜 스케줄러 / 가짜 시간):** A 상수, B 누산기(20 / 10 ms 프레임, 30 / 60 / 120 / 144 Hz에서 초당 50틱), C 따라잡기(70 ms → 3틱 + 나머지 이월, 110 ms → 5틱 + 나머지 유지, 250 ms 끊김 → 5틱 후 밀린 시간 버림), D 일시정지 / 재개(사유, 요청 취소, 정지 중 틱 없음, 30초 후 재개 첫 프레임 0틱, 상태 이벤트 순서, 잘못된 순서 호출 무시), E 경기 종료(남은 틱만 소비 후 `ENDED`, 이후 호출 무시, 끝난 경기 시작 시 즉시 `ENDED`), F 틱당 입력 1회 소비 / 프레임당 폴링 1회(소비 전), G 통합(키보드 → R2 주행, 따라잡기 프레임 중 탭은 첫 틱만 발사, 탭 숨김 중 뗀 키 유실 후 재개 시 저절로 달리지 않음, 일시정지 중 되감기 후 재개, 불규칙 프레임 간격 · 끊김 · 일시정지가 섞인 풀매치 실시간 결과 = 로그 재생 결과), H 입력 수집기(배정 / 합성 / 미배정 슬롯 / 연결 해제 / 초기화 / 키보드 비활성화).

### 6.2.13 Step 07-6 (브라우저 입력 어댑터) 완료 항목

- **`src/input/browserInput.ts`:** `BrowserInputAdapter`(`LiveControlSource` 구현) — 키보드: 매핑 키만 처리(`event.code`), `preventDefault`(방향키 / `/`), 입력 폼 대상 무시(`isEditableTarget`), 자동 반복은 새 눌림 아님, `KEYBOARD_ENABLED = false`면 가로채지도 않음. 게임패드: `poll()`에서 배정 슬롯만 `navigator.getGamepads()` 폴링(연결 해제 / API 없음 / 예외 → 중립). 자동 일시정지: `blur` / `visibilitychange`(hidden) → 눌린 키 비우고 `BLUR` / `HIDDEN`, 배정 슬롯 `gamepaddisconnected` → `GAMEPAD_DISCONNECTED`. `gamepadStatus()`, `detach()`. `createAnimationFrameScheduler`, `createBrowserRealtimeLoop`.
- **테스트 (`src/input/__tests__/browserInput.test.ts`, 그룹 A~F, Node `EventTarget` 가짜 환경):** A 입력 폼 판정, B 키보드(차단 / 미매핑 키 통과 / 자동 반복 / 입력 폼 / 짧은 탭 / 비활성화), C 게임패드 폴링(슬롯 배정 / 연결 해제 / 미배정 슬롯 / API 예외 · 없음 / 연결 상태 · 비표준 매핑), D 자동 일시정지(포커스 소실 · 탭 숨김 시 키 제거, 보이게 될 때는 무시, 미배정 패드 분리 무시, `detach`), E 루프 연결(키보드 주행, 사용자 일시정지 / 재개 후 누르고 있는 키 유지, 포커스 소실 후 재개 시 정지, `dispose`), F rAF 스케줄러. 차단 제거, 입력 폼 가로채기, 키보드 플래그 무시, 포커스 소실 / 탭 숨김 시 키 유지, 보이게 될 때도 일시정지, 미배정 패드 분리 일시정지, 폴링 시 키 재샘플 누락, 연결 해제 플래그 무시, 예외 처리 제거, `detach` 누락, 일시정지 사유 오류, 표준 매핑 판정 누락 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 일회성 스크립트, 실제 `KeyboardEvent` / `requestAnimationFrame` / 가짜 `navigator.getGamepads`, 12항목 통과):** 실시간 루프 초당 약 50틱(49), 실제 W 키로 R2 주행, 매핑 키 기본 동작 차단 / 미매핑 키 통과, `,` 짧은 탭 = 발사 1회, 입력 폼에 `,` 입력 시 가로채지 않음, 게임패드 슬롯 0 → R1 주행 · 연결 상태, 포커스 소실 → 일시정지 중 틱 정지 · 재개 후 눌린 키 제거, 탭 숨김 / 배정 패드 분리 → 일시정지, 상태 이벤트 순서, 브라우저 실시간 결과 = 로그 재생 결과.

### 6.2.14 Step 08-1 (렌더러 명세 구체화) 완료 항목

- **렌더러 / 화면 연결 (3.7항):** 렌더러 입력 = (프레임, 로봇 제원, 보기, 표시 옵션, 판정 함수), 좌표 계산 순수 함수 분리. 논리 캔버스 1200 × 800 px(필드 뷰포트 160 in 정사각형 + 좌우 R1 / R2 패널), CSS 비율 유지 확대 / 축소, 양방향 좌표 변환.
- **보기 방향:** 경기 전 화면(설정 / 스윗스팟 / LUT 점진 히트맵)은 관중석 시점, 경기 중 기본 드라이버 시점(RED −90°, BLUE +90°, 회전만), 공통 설정으로 전환. 경기 시작 시 700 ms easeInOutCubic 회전 + 배율 1 / (|cos θ| + |sin θ|) 후 루프 시작. 글자 / 배지 / 높이 오프셋은 화면 기준.
- **표시 규칙:** 상대 진영 전용 구조물 채도 제거, 로봇(진영 색 몸체 · 헤딩 · 번호, 인테이크 구역 강조, FIFO 적재물, 행동 상태 배지 — 이미지 자산은 사용자 제공, 없으면 글자 배지, 제동 중 50%), 기물 상태별 표시 표, HIVE 시차 낙하(립 → 착지 선형 보간, 불투명도 증가, 12시부터 시계 방향 윤곽 호).
- **FLOWER 게이지:** 필드 밖 직사각형(관중석 FLOWER 기준 x 96~120, y 144.6~147.8, FLOWER 쪽이 bottom, 반시계 방향이 top), 90° 회전 복제, 9칸 · 크기 통일 원, 잼 = 검정 칸, 최대 조합 도달 시 나머지 칸 X. 기존 측면 단면 원통 게이지 폐기.
- **NECTAR 재고 게이지:** 벽 바깥 y = 72 중심 5칸, 로딩 존 쪽 끝부터 투입 대기 → 재고 → 빈 칸.
- **비행 공:** 수평 선형 보간 + 명목 포물선 높이에 선형 보정(끝점 일치, `MISS_FLOOR`는 바닥 높이로 보정), 그림자 + 화면 위 0.3·z in 오프셋 + 크기 1 + z / 100, 결과는 도착 시 표시.
- **표시 옵션(공통, 사용자 공개, 기본 꺼짐):** 조준선, 흡입 접촉 진행, 실시간 명중 확률(좌우 패널 글자, 그리는 프레임마다 4회 호출, 실측 약 0.5 µs/회 → 무시 가능), 비행 잔상, 비행 결과 색.
- **경기 종료 득점 내역:** `TimelineFrame.scoreBreakdown`(`ScoreBreakdown`, 종료 프레임만) — 렌더러 / 스코어보드는 규칙을 재계산하지 않음. 경기 중 예측 표시 없음.
- **개발 하네스:** 개발 서버 전용, 정식 엔진 / 입력 / 루프 / 렌더러 + 고정 제원 + 간이 판정 함수(조준 가능 시 0.6).
- **테스트 방침:** 순수 계산 함수 Vitest + 단계별 1회성 헤드리스 Chromium 점검, Playwright 저장소 편입 안 함.

### 6.2.15 Step 08-2 (발사 비행 개정: 충돌 후 낙하) 완료 항목

- **배경:** 08-1 렌더러 명세 중 발견 — HIVE / 벽에 공중에서 닿은 공(빗맞음, 무효 명중, 벽에 막힌 바닥 착지)이 도착 틱에 바로 바닥에 놓여 화면에서 최대 약 66 in 높이에서 1프레임 만에 떨어짐. 렌더러만으로는 고칠 수 없음 (도착 후 기물은 이미 `ON_FIELD`라 흡입 / 충돌 대상).
- **규칙 (2.6.2항 충돌 후 낙하):** 충돌 순간 속도를 반사한 뒤 중력 포물선으로 바닥까지. 옆면 = 수평 법선 성분 −e배 + 산포 ±15° + 최소 이탈 속도 20 in/s, 윗면 = 수직 성분 −e배 반복 튐(최대 3회) 후 박스 이탈 또는 굴러 떨어짐, 무효 명중 = 조준점에서 셀 쪽 앞면 법선 반사, 벽 = 수평 정지 후 수직 낙하(높이 무한 · 반발 0 벽). 착지 속도 = 수평 속도 × `landingSpeedRetention`. 반발 계수는 기물별 restitution × (0.8~1.2).
- **`ballistics.ts`:** `FlightState`, `BounceRolls`, `PostContactFlight`, `flightSegmentPoint`, `planFallToFloor`, `planHiveBounce`, `planVoidedHitBounce`, 상수 `HIVE_BOUNCE_RESTITUTION_SPREAD` / `HIVE_BOUNCE_ANGLE_SPREAD` / `HIVE_TOP_MAX_BOUNCES` / `HIVE_BOUNCE_MIN_SPEED`. `planShotFlight`가 `contactTime` / `flightTime`(최종 착지) / `segments` / `landing`을 반환, 반사 산포 난수 입력(`bounceRolls`).
- **`types.ts`:** `FlightSegment` 신설, `PendingShot`에 `contactTime` / `segments` / `landX` / `landY` 추가, 난수 이름 `ejectSpeedRoll` / `ejectAngleRoll` → `bounceRestitutionRoll` / `bounceAngleRoll`.
- **엔진:** 발사 시 반사 산포 난수를 비행 계획에 전달, 도착 틱 = 명중은 조준점 도착 / 그 외는 최종 착지, 무효 명중은 도착 틱에 반사 낙하 구간을 붙여 `MISS_HIVE`로 바꾸고 착지 틱까지 `IN_FLIGHT` 유지, 착지는 `landX` / `landY`. `ejectFromHive`와 고정 방출 상수(20~60 in/s, ±60°) 삭제. 스냅샷이 구간 목록까지 복제. 난수 소비(발사마다 3회)는 그대로.
- **테스트:** 탄도 O(명중 = 접촉 시각 · 구간 없음, HIVE 충돌 후 착지가 접촉보다 늦음, 바닥 착지 = 명목 끝, 벽 접촉 후 수직 낙하) 갱신, 탄도 P(구간 위치 공식, 옆면 반사 방향 / 크기, 산포 세기 · 각도, 스침 충돌 최소 이탈 속도, 윗면 한 번 튀고 이탈, 느린 공 3회 튐 → 굴러감 → 낙하, 정지 공 가장 가까운 면으로 굴러감, 벽 수평 정지 · 수직 속도 연속, 무효 명중 AUDIENCE / OPPOSITE 반사, 착지 안전장치, 모든 경우 구간 연속 · 바닥 착지 · HIVE 밖) 추가. 엔진 S(HIVE 충돌 후 낙하 중 `IN_FLIGHT` · 착지 틱 = 최종 착지 · 착지점, 무효 명중: 팁 중 도착 → `MISS_HIVE` · 착지 틱 연장 · 셀 앞 착지 · 미득점, 프레임 구간 목록 복제) 갱신. 벽 무시, 옆면 반사 제거, 최소 이탈 속도 제거, 윗면 튐 제거, 착지 속도 감쇠 제거, 무효 명중 즉시 착지, 구간 목록 미복제 각각에서 실패함을 확인.
- **입력 테스트 제한 시간:** 풀매치를 도는 입력 테스트(입력 로그 C~F, 실시간 루프 E / G)에 엔진 테스트와 같은 120초 제한 시간을 지정 (기본 5초는 병렬 실행 부하에서 부족해 입력 로그 C가 6.3초로 시간 초과한 것을 08-2 검증 중 확인).

### 6.2.16 Step 08-3 (경기 종료 득점 내역) 완료 항목

- **`types.ts`:** `ScoreBreakdown {hive, flower, garden, park, flowers[{id, scoringPieces, owned, points}], gardenPieceIds, parkedRobots}`, `TimelineFrame.scoreBreakdown: ScoreBreakdown | null`.
- **엔진:** `finalizeScore`가 기존 합산과 같은 판정으로 항목별 점수와 인정 근거(FLOWER별 slot[1..N] 수 / 소유 / 점수, 득점 GARDEN 기물 id, 주차 로봇 슬롯 id)를 함께 만든다 (규칙 변경 없음, 항목 합 = `totalScore`). 종료 전 틱은 `null`, `reset` 시 `null`, 프레임 기록 / 스크러빙 복원 시 복제.
- **테스트:** 엔진 U(기본 경기 RED / BLUE: 종료 전 프레임 `null`, GARDEN 4 + 주차 5 = 9, 주차 로봇 · GARDEN 기물 id 식별, FLOWER 4개 미소유 / slot[1..] 3 / 전 항목 경기: 팁 20 + FLOWER 1개 소유 9 + GARDEN 4 + 주차 5 = 38, 항목 합 = `totalScore`, 득점 FLOWER만 owner 설정 / 종료 전으로 되감으면 내역 없음, 재시뮬레이션 종료 프레임 동일, 종료 프레임 되감기 유지 / 같은 설정 결정론). 하단 보너스 누락, slot[0] 포함, GARDEN 아군 필터 누락, 내역 미기록, 매 틱 내역 기록, 주차 로봇 id 오류 각각에서 실패함을 확인.

### 6.2.17 Step 08-4 (장면 렌더러 1: 보기 / 정적 레이어 / 로봇 / 바닥 기물) 완료 항목

- **`viewTransform.ts` (순수):** 레이아웃 상수(뷰포트 160 in = 800 px, 좌우 패널 200 px, 장면 1200 × 800), `viewAngle` / `restingView`(AUDIENCE 0, DRIVER RED −90° / BLUE +90°), `fitScale`, `easeInOutCubic`, `ViewAnimator`(700 ms, 벽시계 주입, 도중 전환 시 현재 각도에서 이어감, `jump`), `fieldToCanvas` / `canvasToField` / `cssToCanvas`, `fieldPxMatrix`(필드 px 공간 그리기용 캔버스 행렬 × dpr), `labelCenter`, `screenUpInField`.
- **`robotLayout.ts` (순수):** 행동 상태 배지 키 / 제동 중 50% / 글자 배지 문구, 헤딩 화살표 · 적재물 받침 · 칸 · 번호 라벨 배치(몸체 길이 비율), `localToField`, 외접원 반지름.
- **`badgeAssets.ts`:** `src/assets/badges/{key}.svg | .png`를 `import.meta.glob`으로 찾아 로드, 없으면 null(글자 배지). 아직 자산 없음 (09-7 전에 6종 SVG 추가, 3.7항 "배지 자산 확정").
- **`sceneRenderer.ts`:** `renderScene(ctx, {frame, r1Config, r2Config, view}, dpr)` — 배경 / 좌우 패널, 뷰포트 클립, 정적 레이어(오프스크린 캐시, 없으면 직접 그림), 구조물 라벨, 바닥 기물(`IN_GARDEN` 초록 테두리), 로봇(인테이크 구역 / 몸체 / 앞 변 / 화살표 / 받침 · 적재물 · 빈 칸), 번호, 배지. HIVE 셀 상태 / 게이지 / 비행 공 / 경기 종료 강조 / 표시 옵션은 이후 단계.
- **`canvasRenderer.ts`:** 색상 / `pieceColors` 공개, 라벨 없이 그리기 옵션, 상대 로딩 존 채도 제거, `drawHiveBase`(아군 셀 기본색 / 상대 셀 채도 제거, 상태 표시 없음). 기존 `renderField`(정식 빌드 정적 화면) 출력은 그대로.
- **`collision.ts`:** `getRobotOBB` 매개변수 타입을 사용하는 필드(위치 / 헤딩 / 크기)로 좁힘 (읽기 전용 프레임에서 호출, 로직 변경 없음).
- **테스트 (`src/renderer/__tests__/`):** 보기 변환 A~D(레이아웃, RED / BLUE 드라이버 방향 · 뒤집기 없음 · 아군 벽 아래, 역변환 왕복 · 행렬 = 변환 · CSS 변환 · 라벨 배치(세로 구조물에서 반폭만큼 밀림), 이징 · 배율 · −180~180° 회전 중 뷰포트 꼭짓점 이탈 없음 · 애니메이터 중간 / 끝 / 도중 전환 / 즉시 이동), 로봇 배치 A~B(배지 키 / 제동 반투명 / 자산 경로, 18 · 14 · 12 in에서 화살표 → 받침 → 라벨 순서 · 원 겹침 없음 · 받침 안 · 최대 4칸).
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 5장면 스크린샷 확인):** RED 관중석 / RED · BLUE 드라이버 / 45° 회전 중 / 행동 상태(제동 중 발사 배지, 흡입 구역 강조, 바닥 산포 기물, NECTAR 선두 적재). 첫 점검에서 발견한 적재물 0번 · 화살표 겹침, 진영색 NECTAR가 몸체에 묻힘, 회전 시 라벨이 구조물 · 기물과 겹침을 몸체 안 비율 배치 / 밝은 받침 / 라벨 바깥 밀기 / 라벨을 로봇 아래로로 고친 뒤 재확인. 12 in 로봇에서 적재물 원이 겹치는 문제는 단위 테스트로 발견해 반지름을 칸 간격에서 유도하도록 수정.

### 6.2.18 Step 08-5 (장면 렌더러 2: HIVE / 게이지 / 경기 종료 강조) 완료 항목

- **`gaugeLayout.ts` (순수):** `flowerGaugeLayout`(관중석 벽 기준 게이지를 R(x, y) = (144 − y, x)로 회전 복제, 칸 중심 / bottom → top 방향 / 바깥 법선), `stockGaugeLayout`(벽 바깥 y = 72, RED 로딩 존 쪽 bottom, BLUE 점대칭), `stockSlotStates`(대기 → 재고 → 빈 칸), `flowerGaugeSlots` / `isFlowerFull`(잼 = JAM, 가득 참 = 남은 칸 FULL), `tipDropView`(립 → 착지 선형 보간, 불투명도, 호 진행률).
- **`sceneRenderer.ts`:** 정적 레이어에 게이지 틀(FLOWER 4 + 재고 2, 상대 재고 채도 제거) 추가, HIVE 셀 상태(필드 공간 바탕 / 테두리 + 화면 공간 기물 줄 / 알약 글자), 게이지 내용(기물 / 검정 잼 / X / 투입 대기 반투명 점선), 팁 낙하(전복된 셀 립 → 착지점, 화면 12시부터 시계 방향 윤곽 호), 경기 종료 강조(GARDEN 고리, 주차 외곽, 득점 게이지 테두리 + 점수 알약). 그리기 순서: 정적 레이어 → 라벨 → HIVE / 게이지 → 바닥 기물 → 종료 강조(GARDEN / FLOWER) → 로봇 → 주차 강조 → 팁 낙하 → 화면 글자.
- **공유 규칙 추출 (로직 변경 없음):** `collision.ts` `hiveTipLipOrigin`(엔진 낙하 계획과 렌더러 낙하 연출이 같은 립 기준점 사용), `simulationEngine.ts` `canFlowerAccept` 공개(읽기 전용 FLOWER 인자 허용, 게이지 가득 참 판정 재사용). `canvasRenderer.ts` `hiveCellBox` 추출, 폐기된 측면 단면 원통 게이지(`drawFlowerGauge`) 삭제.
- **테스트 (`src/renderer/__tests__/gaugeLayout.test.ts`, A~D):** A FLOWER 게이지(4개 좌표 명세 일치, 칸 0 = FLOWER 옆, 칸 간격 24 / 9, 반시계 방향, 필드 밖 · 여백 안, 게이지 6개 서로 안 겹침), B 재고 게이지(y = 72 중심, 점대칭, 로딩 존 쪽 bottom, 칸 상태 순서 / 제한), C FLOWER 칸(용량 테이블 7개 최대 조합 가득 참 · POLLEN 하나 적으면 아님 · X 칸 수, {1, 6} X 2칸, 잼 가득 / 비가득, 빈 / 기본 FLOWER X 없음), D 팁 낙하(립 기준점, 시작 / 중간 / 착지 / 착지 시간 0).
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 6장면):** RED 드라이버 기본(게이지 / 재고 5 / 상향 셀), 팁 진행 중 드라이버 · 관중석(낙하 공 윤곽 호, TIPPING, 상향 셀 전환, 로딩 존이 막혀 투입 대기 1), FLOWER 잼 가득 / {1, 6} X / 기본 / 빈, 경기 종료(38점: 주차 · GARDEN · FLOWER +9 강조), BLUE 엔드게임(로딩 존이 막혀 투입 대기 5). 첫 점검에서 드라이버 시점 HIVE 셀 기물 줄이 세로가 되어 글자와 겹침, 게이지 쪽 점수 알약이 여백에서 잘림을 발견해 기물 줄을 화면 공간으로 / 점수 알약을 FLOWER 라벨 옆으로 옮긴 뒤 재확인.

### 6.2.19 Step 08-6 (장면 렌더러 3: 비행 공 / 표시 옵션) 완료 항목

- **`flightView.ts` (순수):** `shotElapsed`, `shotPositionAt`(명목 구간: 수평 선형 + 명목 포물선 높이에 끝점 오차를 진행률만큼 보정 / 충돌 후 구간: 기록된 포물선 · 굴러감), `shotTrail`, `airborneDisplay`(0.3·z in 오프셋, 반지름 × (1 + z / 100)).
- **`renderOptions.ts` (순수):** `RenderOptions` / `DEFAULT_RENDER_OPTIONS`(모두 꺼짐), `aimGuide`(고정형 헤딩 ± 허용 오차, 터렛 헤딩 + 범위 — 엔진과 같은 정규화, 발사 방향 `shotLaunchHeading`), `intakeProgress`(바닥 기물 `intakeDelay` / FLOWER slot[0] max(`intakeDelay`, 0.12 s), 필요 시간 0이면 없음), `hitProbabilities`(로봇 2 × 기물 2 호출, [0, 1] 제한, 다음 기물 종류).
- **`sceneRenderer.ts`:** 장면 입력 `options` / `shotResolver`, 비행 공(그림자 → [잔상] → 공, [결과 색 테두리]), 조준선(로봇 아래), 흡입 진행 호(로봇 위), 좌우 패널 명중 확률. 옵션이 꺼져 있으면 판정 함수를 호출하지 않음.
- **테스트:** `flightView.test.ts` A~C(엔진이 실제 기록한 비행으로: 탐색 v0 가정 명중에서 명목 포물선이 조준 높이를 비껴가도 t = contact에서 조준점과 정확히 일치 · 중간 높이 = 명목 + 절반 보정, HIVE 반사 / 바닥 착지 / 벽 낙하에서 접촉점 → 충돌 후 구간 연속 · 착지점 z = 반지름, 잔상 시작 / 끝 / 표본 수, 높이 연출), `renderOptions.test.ts` A~D(조준선 고정형 / 터렛 ±90° / 후방 ±π 가로지름 / 360° [-π, π] / [0, 2π] = 폭 0, 흡입 진행 바닥 · FLOWER · 필요 시간 0 · 제한, 명중 확률 4회 · 제한 · 다음 기물, 모든 프레임을 호출 없는 가짜 캔버스로 그리기: 옵션 꺼짐 호출 0회 · 켜짐 프레임당 4회 · 판정 함수 없음). 끝점 보정 제거, 충돌 후 구간 무시, 패널 항상 그림, FLOWER 쿨다운 무시, 확률 미제한 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 5장면):** 명중 비행 중(옵션 끔 / 전부 켬: 고정형 · 터렛 부채꼴, 흡입 호, 잔상, 결과 색, 좌우 패널), HIVE 반사 낙하, 긴 빗맞음, 벽 낙하. 점검 중 연속 발사 2발이 동시에 그려지는 것을 확인 (마지막 발사 요청 틱에 완료되면 다음 기물로 재장전되는 엔진 규칙, 07-2).

### 6.2.20 Step 08-7 (개발 하네스) 완료 항목 — Step 8 완료

- **구현:** 3.7항 개발 하네스 "구현" 참고 (`devSetup.ts` / `harnessController.ts` / `DevHarness.tsx`, `App.tsx` 개발 서버 전용 지연 로딩).
- **테스트 (`src/dev/__tests__/harness.test.ts`, A~C, 가짜 브라우저 환경 / 프레임 / 시계):** A 간이 판정 함수(조준 / ±3° 안 0.6, 5° 이탈 0, 360° 터렛, 진영별 엔진), B 경기 흐름(준비 화면 관중석 · 루프 대기, 진영 선택 / 경기 중 잠금, 회전 중 루프 대기 · 틱 없음 → 회전 완료 후 시작 · 드라이버 각도, 초당 약 50틱 · 남은 시간, 키보드 W로 R2 +x 주행 · R1 정지, 일시정지 중 틱 정지 · 옵션 2회 변경 = 다시 그리기 1회, 일시정지 중 보기 전환 애니메이션, 재개, 창 포커스 소실 자동 일시정지, 리셋 → 0틱 새 경기 → 관중석으로 반대 회전 → 준비 화면, 해제 시 대기 프레임 없음), C BLUE 드라이버 +90°, 진행 중 상태 알림 약 10 Hz, 관중석 경기 시작.
- **헤드리스 Chromium 종단 점검 (저장소 밖 1회성, 실제 개발 서버 + `App`):** 준비 화면 → 시작 클릭 → 회전 중(루프 대기, 틱 0) → 회전 후 루프 동작 → 실제 W 키 1초(R2 주행, 초당 약 50틱) / `,` 발사(비행 공) → 옵션 5종 체크 → 일시정지(틱 고정) → 관중석 시점 → 리셋(0틱, 준비 화면). 콘솔 오류 없음. 정식 빌드 미리보기는 정적 필드(720 × 720)만 표시, 하네스 없음.

### 6.2.21 Step 09-1 (웹 GUI 명세 구체화) 완료 항목

- **3.8항 신설 (웹 GUI):** 데스크톱 전용(1366 × 768 ~ 3840 × 2160, 화면 비례 단위 `--u`), 영어 기본 + 한국어 토글(게임 용어 원어 대문자), 진영 공식 색(RED `#DF001B`, BLUE `#0F53A7`), 앱 이름 `FTC TacticSim`.
- **화면:** 메인 화면 하나 = 좌측 득점 패널(타이머 / `ENDGAME` 색 변경, 진영 점수 = 확정 점수, `TIP` 횟수 = 오토 + 텔레옵 / 다음 RP 목표 4 → 7, 팀 번호, 명중 확률) + 필드(뷰포트만, 경고 토스트 / 자동 일시정지 배너) + 우측 config 창(접힌 아이콘 띠: 로봇 준비 신호 · LUT 진행률 링 / 시나리오 깃발 / 게임패드, 펼친 탭 4개) + 스크러버 줄. 별도 복기 창 없음, 결과는 팝업. 주차(P) 표시 없음.
- **경기 흐름:** 재생(기록 불변, 0.25 / 0.5 / 1 / 2×) / 재개(게임패드 아이콘, 마지막 기록 틱에서만) / 분기(분기 아이콘, 확인창, 이후 기록 폐기) 분리, 보는 틱과 엔진 머리 구분, 틱 / 1초 이동, `NEW` = 설정 · 시드 유지 새 경기, 종료 후 5초 강조 → 블러 결과 팝업 → 복기, `RESULT`로 다시 열기.
- **config 창:** 탭 `R1` / `R2` / `SCENARIO` / `SETTINGS`, 초안 / `APPLY` / 탭별 · 전체 되돌리기, 경기 전 / 일시정지 중에만 펼침, 경기가 있는 동안 로봇 · 시나리오 읽기 전용, 표시 옵션은 경기 전 / 일시정지 중에만 변경 (3.7항 수정), 준비 안 된 채 `START` → 첫 문제 탭으로 유도.
- **입력 규칙:** 단위(길이 in / cm 토글, 각속도 · 각가속도 rad/s · rad/s², 그 외 각도 °, 시간 ms, 발사구 지상고 → `dz`, 내부 값 항상 inch), 팀 번호 GUI 전용(`RobotProfile`), 기본 프리셋 = 하네스 제원 + 기본 탄도 / 스윗스팟 + 앱 시작 시 LUT 자동 생성(2.6.2항 예외), 스윗스팟 진영 기준 입력 + 점대칭 저장, 시드 읽기 전용 + `REROLL`, 편집 모드는 메인 필드(스윗스팟 / 시작 자세 / 히트맵).
- **키보드 / 입력 출처 (3.6항 수정):** 키보드 주행 유지 + 런타임 끄기 토글, 상태별 키 공유(Space 일시정지 / 재개 / 재생, ← / → 1틱, Shift 1초, Space는 분기하지 않음), 기본 입력 출처(R2는 슬롯 1 패드 또는 키보드 켜짐이면 `LIVE`).
- **배치 검증:** `validateRobotPlacement()` 오류 코드 5종(닿음 허용, 침투 > 1e-6 in만 오류) + `reset()` 사전 보정 (6.4항에서 Step 9로 이동).
- **설정 자동 보관:** 마지막 적용 설정 + UI 환경설정을 `localStorage`에 보관 (경기 기록 제외). JSON 내보내기 / 불러오기는 Step 10.

### 6.2.22 Step 09-2 (LUT 병렬 생성 사전 준비) 완료 항목

- **`ballistics.ts`:** `generateReferenceLUTRows`(행 범위 [gyStart, gyEnd), 전체 LUT 기준 격자 인덱스 / 난수 구간, 범위 내림 · [0, 144] 제한 · 역순 = 빈 배열), `generateReferenceLUT` = `generateReferenceLUTRows(…, 0, 144)`, `robotLUTSeeds(seed)`(기물 종류별 탐색 / LUT 시드, `generateRobotLUTs`가 사용), `BALLISTICS_MODEL_VERSION = 1`, `sweetSpotBasisCell` / `sweetSpotFromBasis` / `sweetSpotToBasis`(진영 기준 좌표에서 스냅 후 점대칭).
- **리팩터링 동일성:** 이전 커밋의 `ballistics.ts`와 `generateRobotLUTs` 결과(탄도 설정 2종 × 로봇 크기 2종, v0 / 명중률 / LUT 8장)가 비트 단위로 같음을 일회성 비교로 확인.
- **테스트 (`__tests__/ballistics.test.ts` Q):** 행 분할(1행 / 7행 / 불균등 / 전체, 역순 처리) 조립 === `generateReferenceLUT`, 부분 행 = 전체의 해당 구간, 빈 / 역순 / 범위 밖 / 소수 범위, `skipUnreachable` 전달, 시드 파생(기본값 고정 값, 4개 서로 다름, 기준 시드 의존), 작업 계획(로봇 2대 × 기물 2종, v0 탐색 → 4행 묶음 역순 → 조립 → 대칭 복사) 16장 === `generateRobotLUTs`, 모델 버전 양의 정수, 스윗스팟 진영 기준(RED 스냅만, BLUE 점대칭, 경계 클릭 격자 유지, 필드 가장자리 포함 왕복, BLUE 조준점 = 기준 조준점 점대칭, BLUE 기준 HIVE 앞 → `SWEET_SPOT_IN_HIVE`, BLUE 기준 스윗스팟 격자의 `BLUE_OPPOSITE` 값 = 기준 값). 난수 구간 지역 인덱스 사용, 행 오프셋 누락, 변환 후 스냅, 시드 용도 뒤바뀜, 점대칭 143 기준, 범위 제한 누락 각각에서 실패함을 확인.

### 6.2.23 Step 09-3 (LUT Worker 풀 / 대기열 / 상태 머신) 완료 항목

- **구현:** 2.6.2항 "LUT 생성 실행 / 사용자 경험" 1의 "구현 (09-3)" 참고 (`handleLUTJob`, `lutWorker.ts`, `createBrowserLUTWorker`, `LUTManager`, `defaultLUTPoolSize`, `lutRequestKey`).
- **테스트 (`src/workers/__tests__/lutManager.test.ts` A~E, 가짜 Worker가 실제 처리기를 구조화 복제 경계로 호출, 처리 순서를 테스트가 조종):** A 처리기(탐색 결과 = `searchLaunchSpeed`, 행마다 진행 144 / 288 / 432, 행 결과 = `generateReferenceLUTRows`, transferable, v0 없는 행 작업 오류, 닫힌 해 없음), B 결정론(풀 1 / 3 / 8 / 2, 행 묶음 4 / 7 / 144, 완료 순서 역순 → 로봇 2대 결과 === `generateRobotLUTs`, 진행 완료, `matchLUTs`), C 상태 전이(`QUEUED > SEARCHING > GENERATING > READY`, 탐색 직후 v0 선표시, 부분 조립 행 = 최종 LUT 행, 두 번째 로봇 탐색이 대기 중 행 작업보다 먼저, 진행 단조 증가 · 행 단위 진행), D 재요청(같은 입력 무시, 로봇 크기 변경 재생성, 생성 중 설정 변경 → `CANCELLED > QUEUED` · 새 세대 · 이전 작업 결과 무시, `cancel` 유지 / `READY`에는 무시, 검증 실패 → `IDLE` + 사유), E 오류(`error` 메시지 / `onerror` / 행 길이 불일치 → `ERROR`, 다른 로봇 계속, 재요청 복구, 잃은 작업의 늦은 응답 무시), 풀 크기 공식, `dispose`, 요청 키 정규화. v0 탐색 우선 없음, 세대 확인 없음, 대기열 정리 없음, 재요청 무시 없음, 실행 중 진행 미집계, 오류 시 작업 유지, 기물 LUT 뒤바뀜, `CANCELLED` 알림 없음, 행 길이 검사 없음 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 1회성):** 임시 페이지에서 실제 Worker 3개로 로봇 2대 생성 → 개발 서버 / 정식 빌드(미리보기) 모두 `generateRobotLUTs`와 비트 단위 동일, 콘솔 오류는 리소스 404 1건뿐(임시 페이지에 파비콘이 없어 생긴 것 — 09-4 점검에서 파비콘을 넣자 사라짐). 기본 정밀도 전체 약 9.3초 (4코어).

### 6.2.24 Step 09-4 (IndexedDB LUT 캐시) 완료 항목

- **구현:** 2.6.2항 "LUT 생성 실행 / 사용자 경험" 4의 "구현 (09-4)" 참고. 새 의존성 없음 (IndexedDB 연결부는 브라우저 점검, 규칙은 메모리 저장소로 Node 테스트).
- **테스트 (`src/workers/__tests__/lutCache.test.ts` A~E, 가짜 Worker는 `fakeWorker.ts`로 관리자 테스트와 공용):** A 캐시 키(SHA-256 표준 테스트 벡터, 정규화 요청 키 64자), 레코드 변환(버퍼 복사, 원본 변경 무영향, v0 null 허용), 깨진 레코드 5종 → 미스, B 정리 규칙(다른 버전 + 최근 사용 20개 초과분, 20개면 없음, 동률 키 순), C 저장소 캐시(해시 키 저장, 적중 시 사용 시각만 갱신, 재저장 시 생성 시각 유지, 21개 추가 저장 중 사용한 레코드 생존 · 가장 오래된 것 삭제 · 20개 유지, 깨진 레코드 미스 · 미갱신, IndexedDB 없음 → 항상 미스), D 관리자 연동(미스: 조회 중 `QUEUED` · 작업 없음 → 생성 → 저장 내용 = 생성 결과, 새 관리자 적중: Worker 작업 0 · `QUEUED > READY` · 결과 === `generateRobotLUTs` · 4셀 대칭 복원 · 재저장 없음), E 조회 도중 설정 변경(옛 요청 미스 무시 · 최신 요청 결과), 조회 도중 취소 / 정리, 조회 실패(비동기 / 동기 예외) → 생성, 저장 실패 → `READY`. 사용 시각 미갱신, 다른 버전 유지, 최신 것 삭제, 버전 미검사, 버퍼 미복사, 생성 시각 초기화, 적중 재저장, 옛 조회 결과 적용, 조회 실패 무대응, 적중 후 생성, 동기 예외 미처리 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 실제 IndexedDB / `crypto.subtle` / Worker):** 1회차(DB 삭제 후) 생성 → 레코드 2개 저장, 새 페이지 2회차 → Worker 작업 0개 · 48 ms에 두 로봇 `READY`(캐시) · 결과 생성본과 비트 단위 동일, 22개 추가 저장 → 20개 유지 · 다른 모델 버전 삭제 · 레코드 기준 LUT 82,944 B. 콘솔 오류 없음.

### 6.2.25 Step 09-5 (시작 자세 배치 검증 / 사전 보정) 완료 항목

- **구현:** 3.8항 "시작 자세 배치 검증"의 "구현 (09-5)" 참고 (`validateRobotPlacement`, `PlacementIssue`, `PLACEMENT_TOLERANCE`, `gardenPiecePositions`, `reset()` 사전 보정).
- **동일성:** 이전 커밋 엔진과 겹침 없는 시나리오 4종(기본 RED / BLUE, HIVE · 벽에 닿은 자세 + 회전 헤딩 + GARDEN 8 / 0, 오토 팁 + NECTAR 적재)을 조작 입력과 함께 1500틱 진행해 프레임이 같음을 일회성 비교로 확인.
- **테스트 (엔진 V):** 기본 스폰 RED / BLUE 통과, 닿음 허용(HIVE 면 · 회전 헤딩 π/2 / π의 부동소수점 잔차, 벽, 나란한 로봇, FLOWER 가장자리), 코드별(HIVE 0.01 in, 벽 0.1 in, 45° 회전 모서리, 필드 밖, FLOWER 번호, 로봇끼리 두 로봇, 문제 누적, 로봇별 크기, 비유한 자세 → 기본 스폰), GARDEN(아군 기물, 빈 GARDEN, BLUE 진영에서 RED GARDEN = 상대, 상대 GARDEN, 수량 1 / 3 / 8에서 엔진이 놓은 기물의 윗가장자리 · 마지막 기물 오른쪽 가장자리와 검증 경계 일치), 사전 보정(HIVE 침투, 로봇끼리, 필드 밖, FLOWER + 벽 모서리, 한 로봇이 HIVE에 밀림, HIVE 옆 완전 겹침 18 in → 0번 프레임 겹침 없음 · 시간 / 헤딩 유지 · 산포 기물이 보정 자리 회피 · 결정론, 시드 6개 × 산포 32개도 회피), 겹침 없으면 그대로, GARDEN 기물 겹침은 보정하지 않음. 허용 오차 없음, 사전 보정 없음, 반복 20회, GARDEN 수량 무시, 아군 / 상대 뒤바뀜, 로봇끼리 한 로봇만 표시, 로봇 크기 혼동, 자세 기본값 미적용, 기물 검사 없음, 보정 시 로봇끼리 무시, 보정을 기물 배치 뒤에 수행 각각에서 실패함을 확인.

### 6.2.26 Step 09-6a (GUI 순수 기반) 완료 항목

- **분할 (09-6 → 09-6a ~ 09-6d):** 09-6은 순수 계산 / 렌더러 / 컨트롤러 / React 화면이 한꺼번에 들어 있어, 시각 결정이 여러 곳에 동시에 퍼지지 않도록 눈으로 확인할 수 있는 단위로 나눈다. 화면이 바뀌는 단계(09-6b, 09-6d)는 1366 × 768 / 3840 × 2160 스크린샷으로 사용자 확인을 받는다.
- **구현:** 3.8항 "문구 사전 구현 (09-6a)", "타이머 (09-6a 확정)", 로봇 제원 탭 단위의 "표시 소수 자리 / 구현 (09-6a)" 참고.
- **테스트 (`src/ui/__tests__/`):** `i18n.test.ts` A~C(한국어 = 영어 키 집합, 빈 문구 없음, 자리표시자 일치, 두 언어 모든 문구에서 게임 용어는 대문자 원형만, 영어에 쓴 게임 용어는 한국어에도 원어로, 엔진 오류 코드 18종 / LUT 상태 7종 / 일시정지 사유 4종 문구 존재(타입으로 목록 강제), 조회 · 치환 · 대체), `units.test.ts` A~E(종류별 변환, 발사구 지상고 ↔ dz, 헤딩 범위, cm 표시값 재입력 = 원래 inch 값, 반올림 격자, 손실 표시 사례, 토글 표시만 변경, 소수 자리 / 단위 기호 / 음수 0 / 비유한값, 입력 문자열 해석, 타이머 경계 · 전체 경기 틱에서 역행 없음 · 모든 초 / 10초 이하 모든 0.1초 표시 · 정수 초 틱 오차 흡수, `ENDGAME` 전환 틱 일치). 반올림 격자 없음, 헤딩 −180 유지, 음수 0, 0.1초 내림, 오차 흡수 없음, 속도 cm 미적용, 쉼표 거부, `ENDGAME` 경계, 게임 용어 소문자, 한국어에서 용어 번역, 자리표시자 누락, 영어 대체 없음, 치환 없음 각각에서 실패함을 확인.

### 6.2.27 Step 09-6b (렌더러 전환) 완료 항목

- **결정 (사용자 확정):** 테마 = 혼합(필드 밝게, 둘레 / UI 어둡게), 진영 색 적용 = 기본안, 나머지 색 유지, 배지 글자 영어 고정, 로딩 존 라벨 `LOADING ZONE`, 전환 기간 하네스 명중 확률 표시 없음, 캔버스 스크린샷 5장으로 확인.
- **구현:** 3.7항 "구현 (09-6b)" / "(09-6b 변경)", 3.8항 "테마 / 진영 색 적용 / 캔버스 글자 (09-6b 확정)" 참고. 정식 빌드의 정적 필드 화면(`renderField`, 720 × 720)은 09-6d에서 대체되므로 색과 로딩 존 라벨만 바뀐다.
- **테스트:** 보기 변환 A / D 갱신(장면 800 × 800, 중심 (400, 400), AUDIENCE 필드 40 ~ 760, 회전 중 꼭짓점이 캔버스 안), 표시 옵션 D 갱신(렌더러는 옵션과 무관하게 판정 함수 호출 0회, `hitProbabilities` 자체는 4회), 신규 `palette.test.ts` A~B(공식 RGB, 파생 색 값, 팔레트 / 진영 NECTAR가 공식 색 사용, `LOADING ZONE` 라벨 2개, 렌더러 소스의 문자열 리터럴에 한국어 없음). 옅은 색 비율 변경, 테두리 = 기본색, 한 줄 라벨, 한국어 배지, 옛 뷰포트 중심 각각에서 실패함을 확인. 한국어 경고 토스트 문구(`toast.lowerLift`) 번역 누락도 함께 수정.
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 캔버스 800 × 800 스크린샷 5장):** RED / BLUE 드라이버 시점 시작, 관중석 시점 경기 중(산포 기물 · 회전한 로봇 · 두 줄 로딩 존 라벨), 팁 낙하 + 비행 공 + 게이지 + 표시 옵션 전부(조준선 / 잔상 / 결과 색 / 배지), 경기 종료 강조(주차 · GARDEN). 콘솔 오류 없음.
- **사용자 검토 반영 (같은 Step, 09-6c와 함께 커밋):** ① 구조물 이름표 / `TIPPING` / 경기 종료 점수 알약 삭제 (HIVE 셀 알약 / 로봇 번호 유지) ② 상대 GARDEN도 비활성 스타일 ③ FLOWER 중립 테두리, 경기 종료 소유 FLOWER = 진영색 원, 하단 보너스 = 가장 아래 NECTAR 주황 테두리 (게이지 테두리 강조 삭제) ④ 재고 게이지 양 끝 여유 ⑤ 득점 GARDEN 기물은 초록 대신 주황 (겹침 없음) ⑥ 비활성 색을 진영별 희미한 색으로 ⑦ 로봇 윤곽선 1.5배 ⑧ 상향 셀 안 NECTAR 흰 윤곽선 1.5배(2.25 px) ⑨ 소유 FLOWER 원에 주황 테두리 ⑩ 배지: `INTAKING` 배지 추가(구역 강조와 함께), 몸체 윗꼭짓점 바로 위로 붙임, 불투명도 85%. 테스트 `palette.test.ts` A~C 갱신(비활성 색 값, 가짜 캔버스로 실제 그린 글자 = 알약 / 번호 / 배지뿐 · `TIPPING` / 점수 알약 없음, `bottomBonusSlot`, 득점 GARDEN 초록 테두리 없음, 소유 FLOWER 주황 테두리 1개 추가, 재고 게이지 여유, 셀 NECTAR 윤곽선 2.25 px, 소유 FLOWER 주황 테두리 2개), 로봇 배치 A 갱신(`INTAKING` 배지, 불투명도, `badgeCenter` 보기 4종 × 헤딩 6종에서 윗꼭짓점 2 px 위). 스크린샷 5장 재확인 + 경기 종료 게이지 4배 확대 확인 (R2가 ENDGAME에 FLOWER 2에 NECTAR부터 투입한 경기).

### 6.2.28 Step 09-6c (앱 컨트롤러) 완료 항목

- **구현:** 3.8항 "앱 컨트롤러 구현 (09-6c)" 참고. `src/dev/harnessController.ts` 삭제, `DevHarness.tsx`는 `AppController` + `createDevSetup`, `devSetup.ts`에 `createDevSetup(진영) → MatchSetup` 추가(`createDevEngine`은 그 설정으로 생성).
- **테스트:** `src/app/__tests__/appController.test.ts` B~D — B / C는 08-7 하네스 흐름 테스트를 옮긴 것(관중석 준비, 회전 중 루프 대기, 회전 후 드라이버 시점에서 시작, 초당 약 50틱, 키보드 R2 주행, 일시정지 중 옵션 2회 = 다시 그리기 1회, 일시정지 중 보기 전환, 재개, 포커스 소실 자동 일시정지, 리셋 반대 회전, BLUE +90°, 상태 알림 약 10 Hz, 관중석 경기), 진영 선택 대신 설정 교체(경기 중 거부)로 바꿈. D 신규(주입한 시나리오로 엔진 생성, 오토 / 텔레옵 TIP · 점수 · RP, 명중 확률 꺼짐 = null · 호출 0 / 켜짐 = 4회 · 주입한 판정 함수 값, 경기 전 설정 교체 = 새 0틱 엔진, 경기 중 거부, 리셋은 현재 설정 유지, `SETUP` 복귀 후 다시 교체 가능). 테스트 설정은 하네스와 독립(하네스 삭제 후에도 유지). `src/dev/__tests__/harness.test.ts`는 하네스 설정 검사(A + `createDevSetup`)만 남김. 경기 중 설정 교체 허용, 명중 확률 항상 계산, 시나리오 무시, 오토 TIP 필드 혼동, 회전 전 루프 시작 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 실제 개발 서버 + 하네스):** 준비 화면 → 진영 교체 → 시작 → 회전 후 `MATCH` / `RUNNING` → 키보드 W 주행 → 일시정지(틱 고정). 콘솔 오류 없음.

### 6.2.29 Step 09-6d (화면 뼈대) 완료 항목

- **구현:** 3.8항 "글꼴 / 아이콘 (09-6d)", "화면 뼈대 구현 (09-6d)", 3.7항 개발 하네스 "(09-6d 변경)" 참고. `AppController`에 `setRenderScale(배율)`(잘못된 값 / 같은 값 무시) / `redraw()` 추가, 정적 레이어 캐시 최대 4개(창 크기를 바꿀 때마다 배율별 캐시가 쌓이지 않도록 가득 차면 비움). 의존성 추가: `lucide-react`(ISC), `pretendard`(OFL). 09-6b에 실수로 커밋된 임시 점검 페이지 `shotcheck.html` 삭제.
- **테스트 (`src/ui/__tests__/mainScreenModel.test.ts` A~D):** A CSS 변수 값, 기준 화면 필드 크기(≈ 558 px), 캔버스 크기(짧은 변 내림 / dpr 반올림 / 배율, 비정상 dpr · 0 크기), B `TIP` 표시(4 → 7 → 달성, 음수 제한), 로봇 이름(팀 번호 공백 = R1 / R2), 명중 확률 %, 타이머 `ENDGAME` 색(엔진 `ENDGAME_START_TICK` 경계, 경기 전 제외), C 주 버튼 6가지 상태, 타임라인 비율 / 눈금, 게임패드 요약, D 글꼴 순서 / `canvasFont`. 문구 사전에 `rail.*`, `panel.tipTarget` / `tipAllDone`, `control.timeline` 추가 (게임 용어 대문자 검사 통과). 하네스 테스트는 로봇 이름 `R1` 기대로 갱신.
- **헤드리스 Chromium 점검 (저장소 밖 1회성):** 실제 개발 서버 1366 × 650 / 1366 × 768 / 3840 × 2160 경기 전 화면, 한국어, 시작 → 회전 → 키보드 주행 → 일시정지(`RESUME`) 화면, 가짜 상태(0:48 `ENDGAME` 주황, 60점, `TIP` 7 / 7 체크, 명중 확률, 비표준 게임패드 경고) RED / BLUE 한국어 / 4K, 기준보다 작은 창(1200 × 560 → 1366 × 650 스크롤), 아이콘 표. 점검 중 개발 모드 StrictMode 재마운트에서 새 컨트롤러가 이미 맞춰진 캔버스를 만나 배율 1로 그리는 문제를 발견해 생성 시 배율 전달 + 매번 배율 전달로 수정 후 재확인. 개발 서버 `?harness` = 하네스, 정식 빌드 미리보기 `?harness` = 메인 화면. 콘솔 오류는 임시 페이지의 파비콘 404뿐.

### 6.2.30 Step 09-7a (경기 흐름: 보는 틱 / 재생 / 분기 / 종료 → 결과) 완료 항목

- **결정:** 3.8항 앱 상태 흐름 "09-7 확정" / "09-7 기본안" 참고 (09-7을 09-7a 컨트롤러 흐름 + 단축키 + 버튼 연결 / 09-7b 확인창 모달 · 토스트 · 배너 · 타임라인 끌기로 분할).
- **구현:** 3.8항 "경기 흐름 구현 (09-7a)", 3.6항 실시간 루프 "(09-7a 변경)" 참고. 문구 사전 `result.*` 추가.
- **테스트:** `appController.test.ts` E(Space 경기 전 무반응 · 진행 중 일시정지, ← 1틱 / Shift + ← 50틱 / 머리 · 0 제한, 되감은 틱에서 재개 무시, Space 재생(분기 아님) 1× ≈ 25틱 / 0.5초 · 2× ≈ 50틱, 재생 멈춤 유지, 머리에서 자동 정지 → 재개 가능, 머리에서 재생 = 0틱부터, 틱 이동이 재생 멈춤, 분기 → 이후 기록 교체(주행 안 한 R2가 원래 주행 위치보다 뒤) · 옛 프레임 사라짐, 단축키 끔, 진행 중 ←는 주행), F(6000틱 → 종료 강조 · 조작 잠금 · 결과 총점 = 항목 합, 5초 전 / 후, 결과 팝업 중 단축키 무시, 복기 RESUME / BRANCH 없음 · Space 처음부터 재생, RESULT 다시 열기, 종료 후 분기 → 다시 종료 강조, 클릭 / Space 건너뛰기, NEW 초기화), `mainScreenModel.test.ts` 주 버튼 9상태 + 분기 확인 문구 값, `realtimeLoop.test.ts` E 종료 후 되감으면 재개. 재개 조건에서 머리 비교 누락, 머리에서 재생 시 0틱 복귀 누락, Space 분기, 5초 대기 없음, 결과 팝업 중 Space 허용, 멈출 때 보는 틱 미갱신, 배속 무시, Shift 1초 무시, 분기 시 종료 단계 미초기화, 결과 팝업 조건 뒤집힘 각각에서 실패함을 확인.
- **헤드리스 Chromium 점검 (저장소 밖 1회성, 실제 개발 서버):** 시작 → W 주행 → Space 일시정지(`RESUME`) → Shift + ← / ←(`BRANCH`, 타이머 되감김) → Space 재생 → 머리에서 멈춤(`RESUME`) → 되감고 `BRANCH` 클릭 → 확인창 문구 "Recorded match after 1:59 (1.0 s) will be deleted…" 확인 → 진행 → 120초 경기 끝까지 → 종료 강조(주 버튼 비활성) → 5초 뒤 결과 팝업(9점: GARDEN 4 + PARK 5) → `REVIEW`. 콘솔 오류 없음.

### 6.3 남은 Step (권장 순서)

> 모든 Step은 완료 시 `npm test`(엔진 회귀 테스트)가 통과해야 하며, 새로 추가한 규칙에는 테스트 그룹을 추가한다.

- **Step 6 — 탄도 모듈 + 발사 비행 처리 (`src/core/ballistics.ts`):** 06-1(명세), 06-2(탄도 계산), 06-3(LUT 생성), 06-4(판정 / LUT 정밀화), 06-5(판정 함수), 06-6(비행 처리) 완료 — Step 6 완료.
    - ~~06-2: 탄도 계산 함수 ($v_0$ 닫힌 해, 비행 시간, 사거리 R, HIVE 직육면체 교차) + 테스트.~~ (완료, 6.2.3)
    - ~~06-3: 몬테카를로 명중 판정, 기물 종류별 v0 탐색, 기준 셀 72 × 72 LUT 생성, 4-Cell 대칭 복사 (로봇당 8장, 합계 16장).~~ (완료, 6.2.4)
    - ~~06-5: `createLUTShotResolver(luts, r1Config, r2Config)`: 쌍선형 보간 조회(`sampleLUT`) + 조준 판정(FIXED 허용 오차 / TURRET 회전 범위) → 엔진 생성자에 주입 (엔진 수정 불필요).~~ (완료, 6.2.6)
    - ~~06-6: 2.6.2항의 발사 비행 처리 구현 (`IN_FLIGHT`, 비행 대기열, 도착 규칙, 착지 속도) + 엔진 회귀 테스트.~~ (완료, 6.2.7)
- **Step 7 — 입력 계층 및 실시간 루프 (상세 규칙 3.6항, 리프트 FSM 2.6.3항):** 07-1(명세), 07-2(리프트 FSM), 07-3(입력 변환), 07-4(입력 로그 / 덧입히기), 07-5(실시간 루프), 07-6(브라우저 어댑터) 완료 — Step 7 완료.
    - ~~07-1: 입력 계층 / 실시간 루프 / 리프트 FSM 명세 구체화.~~ (완료, 6.2.8)
    - ~~07-2: 엔진 리프트 FSM (`actionState` 확장, `ActionRequest`, 요청 / 완료 처리, FLOWER 테스트 갱신 + 테스트 그룹 T).~~ (완료, 6.2.9)
    - ~~07-3: `src/input/inputConfig.ts` + 순수 변환 (장치 읽기 / 탭 래치 / 장치 합성 / 조작 모드 / 행동 요청 / 8비트 부호화) + 단위 테스트.~~ (완료, 6.2.10)
    - ~~07-4: 입력 로그 + 로봇별 입력 출처(`LIVE` / `REPLAY` / `NONE`) + 녹화 덧입히기 + 로그 기반 `inputProvider`.~~ (완료, 6.2.11)
    - ~~07-5: 실시간 루프 컨트롤러 + 입력 수집기 — 20 ms 누산기, 따라잡기 상한 5틱, 일시정지 / 재개, 경기 종료 자동 정지, 가짜 시간 테스트.~~ (완료, 6.2.12)
    - ~~07-6: 브라우저 어댑터 (게임패드 폴링, 키보드, `requestAnimationFrame`, 자동 일시정지 이벤트) + 헤드리스 Chromium 점검.~~ (완료, 6.2.13). 화면 연결은 Step 8.
- **Step 8 — 렌더러 엔진 연결 (상세 규칙 3.7항):** 08-1(명세), 08-2(발사 비행 개정), 08-3(득점 내역), 08-4(보기 / 정적 레이어 / 로봇 / 바닥 기물), 08-5(HIVE / 게이지 / 경기 종료 강조), 08-6(비행 공 / 표시 옵션), 08-7(개발 하네스) 완료 — Step 8 완료.
    - ~~08-1: 렌더러 / 화면 연결 명세 구체화.~~ (완료, 6.2.14)
    - ~~08-2: 발사 비행 개정(06-6) — HIVE / 벽 충돌 후 반사 포물선 낙하 (명세 + `ballistics.ts` + 엔진 + 테스트).~~ (완료, 6.2.15)
    - ~~08-3: 엔진 경기 종료 득점 내역 `scoreBreakdown` 기록 (`types.ts`, 엔진, 회귀 테스트 그룹 추가 — 항목 합 = `totalScore`, 인정 근거, 종료 전 프레임 `null`, 스크러빙 후 재기록).~~ (완료, 6.2.16)
    - ~~08-4: 캔버스 레이아웃 / 좌표 변환 / 보기 회전(애니메이션 배율 포함), 정적 레이어 캐시(상대 진영 채도 제거), 로봇(몸체 / 인테이크 구역 / 적재물 / 배지 — 글자 배지 대체), 바닥 기물.~~ (완료, 6.2.17)
    - ~~08-5: HIVE(아군 셀 상태, 시차 낙하 연출), FLOWER 게이지(필드 밖 9칸, 잼, 가득 참 X), NECTAR 재고 게이지(게이지 틀은 정적 레이어에 추가), 경기 종료 강조.~~ (완료, 6.2.18)
    - ~~08-6: 비행 공(명목 구간 보간 + 높이 보정, 충돌 후 구간, 그림자 / 오프셋 / 크기), 표시 옵션 5종.~~ (완료, 6.2.19)
    - ~~08-7: 개발 하네스(정식 엔진 / 입력 / 루프 + 간이 판정 함수, 시작 회전 후 루프 시작, 옵션 체크박스) + 헤드리스 Chromium 점검.~~ (완료, 6.2.20)
- **Step 9 — 웹 GUI (React, 상세 규칙 3.8항):** 09-1(명세), 09-2(탄도 사전 준비), 09-3(LUT Worker 풀), 09-4(LUT 캐시), 09-5(배치 검증), 09-6a(GUI 순수 기반), 09-6b(렌더러 전환), 09-6c(앱 컨트롤러), 09-6d(화면 뼈대), 09-7a(경기 흐름) 완료.
    - ~~09-1: 웹 GUI 명세 구체화.~~ (완료, 6.2.21)
    - ~~09-2: `ballistics.ts` 사전 준비 — `generateReferenceLUTRows`, `robotLUTSeeds`, `BALLISTICS_MODEL_VERSION`, 스윗스팟 진영 기준 변환 함수 + 분할 / 작업 계획 동일성 테스트.~~ (완료, 6.2.22)
    - ~~09-3: LUT Worker 풀(`src/workers/lutWorker.ts`) + 작업 대기열 + 조립 + 로봇별 상태 머신 / 취소 (React 비의존, 가짜 Worker 테스트).~~ (완료, 6.2.23)
    - ~~09-4: IndexedDB LUT 캐시 (캐시 키 / LRU 20개 / 실패 허용).~~ (완료, 6.2.24)
    - ~~09-5: `validateRobotPlacement()` + `reset()` 사전 보정 + 엔진 회귀 테스트 그룹.~~ (완료, 6.2.25)
    - 09-6: GUI 기반 — 아래 4단계로 분할 (6.2.26).
        - ~~09-6a: 순수 기반 — 문구 사전 / 언어, 단위 변환 · 표시, 입력 문자열 해석, 경기 타이머 표시.~~ (완료, 6.2.26)
        - ~~09-6b: 렌더러 전환 — 캔버스를 필드 뷰포트(800 × 800)만 남기고 좌우 정보 패널 삭제, 진영 공식 색, 캔버스 글자 정리, 하네스를 새 캔버스 크기에 맞춤 (스크린샷 확인).~~ (완료, 6.2.27)
        - ~~09-6c: 앱 컨트롤러 — 하네스 컨트롤러를 React 비의존 `AppController`로 확장 (엔진 / 입력 / 루프 / 렌더링 예약 / 10 Hz 상태 알림, 기능은 하네스 수준: 시작 · 일시정지 · 재개 · 리셋).~~ (완료, 6.2.28)
        - ~~09-6d: 화면 뼈대 — 좌측 득점 패널 / 필드 / 접힌 config 아이콘 띠(표시만) / 스크러버 줄(기존 동작만), 화면 비례 단위 `--u`, 명중 확률 좌측 패널 (스크린샷 확인).~~ (완료, 6.2.29)
    - (09-7 전 자산) 행동 배지 SVG 6종 + 파비콘 추가, TIP 아이콘은 09-6d 것 유지 (3.7항 "배지 자산 확정", 3.8항 "파비콘").
    - 09-7: 경기 흐름 — 시작 / 일시정지 / 재개 / 분기(확인창) / 재생 / 배속 / 틱 · 1초 이동 / 새 경기, 상태별 키 공유, 경고 토스트 / 자동 일시정지 배너 (`ENDGAME` 타이머 색은 09-6d에서 완료). 행동 상태 배지 이미지 자산은 09-7 전에 추가 완료. 2단계로 분할:
        - ~~09-7a: 컨트롤러 흐름(보는 틱 / 재생 · 배속 / 틱 · 1초 이동 / 재개 · 분기 / 종료 강조 5초 → 결과 → 복기) + 상태별 단축키 + 스크러버 줄 버튼 연결 + 결과 팝업 기본형(점수 집계표), 확인창은 임시 `confirm`.~~ (완료, 6.2.30)
        - 09-7b: 확인창 모달, 경고 토스트, 자동 일시정지 배너, 타임라인 클릭 / 끌기 (스크린샷 확인).
    - 09-8: config 창 — 아이콘 띠(준비 신호 / 진행률 링 / 깃발 / 게임패드) + 탭 틀 + 초안 / 적용 / 되돌리기 + SETTINGS 탭(게임패드 상태, 입력 출처, 조작 모드, 키보드 토글, 표시 옵션, 언어, 단위, 기본 보기) + 설정 자동 보관.
    - 09-9: 로봇 탭 — 제원 폼, `BumperZone` 편집기, 슈터 / 리프트, 팀 번호, 상대 탭 복사, 탭 되돌리기.
    - 09-10: 스윗스팟 / 히트맵 편집 모드 + LUT 진행 표시(v0 선표시 / 진행 막대 / 남은 시간 / 점진 히트맵) + 기본 프리셋 자동 생성.
    - 09-11: 시나리오 탭 + 시작 자세 편집 모드 + 시드 `REROLL` + 유효 배지.
    - 09-12: 결과 팝업 세부 디자인 확정(09-7a 기본형 기반, 사용자와 확정), 개발 하네스 삭제 — Step 9 완료.
- **Step 10 — 분기 타임라인 및 경기 저장/공유:** (09-1 추가) 로봇 프로필 / 시나리오 JSON 내보내기 · 불러오기(SETTINGS 탭 프리셋 관리), 결과 팝업 로그 / JSON 내보내기. 분기 트리(부모 프레임 공유, 분기 이후 프레임만 생성), 저장 레시피(설정 + 시나리오 + 시드 + 양자화 입력 로그 + 탄도 설정 / LUT 시드 / 샘플 수 / `BALLISTICS_MODEL_VERSION` + 엔진 버전 + 상태 체크섬, LUT 자체는 저장하지 않고 캐시 또는 재생성). 레시피 약 50 KB 수준으로 파일/IndexedDB 저장 가능. 입력 로그 형식(로봇별 틱당 4 B, 8비트)은 3.6항, 저장 시 연속 중복 압축.

### 6.4 보류 / 후속 검토 항목

- ~~**시작 자세 배치 검증:**~~ → Step 9로 이동 (09-1, 3.8항 시작 자세 배치 검증, 09-5 구현 완료).
- **1프레임 겹침 스폰:** HIVE 팁 낙하 착지 지점, 발사 비행(충돌 후 낙하 포함)의 착지 지점이 그 사이 이동한 로봇이나 기물 위일 수 있음 (다음 틱 충돌 처리로 밀려남). 비행 중 FLOWER 원통 / 로봇과의 충돌도 무시.
- **필드 벽 반사 / 필드 밖 이탈:** 공중에서 벽에 닿은 공은 높이 무한 · 반발 0 벽으로 가정해 수평 정지 후 수직 낙하한다 (2.6.2항, 08-2). 필드 테스트에서 어색하면 반발 계수 > 0 반사로 교체. 벽을 넘어 필드 밖으로 나가는 공은 전술이 아닌 실수이므로 구현하지 않음.
- **HIVE 충돌 후 낙하 파라미터:** 반발 계수(기물별 restitution 재사용), 산포(세기 ±20%, 방향 ±15°), 윗면 최대 튐 3회, 최소 이탈 속도 20 in/s는 실측 전 임시값. HIVE 윗부분의 실제 형상(평판 아님)과 공이 HIVE 위에 걸려 멈추는 경우는 모델링하지 않음.
- **조준 오차에 따른 비행 연출:** 고정형 슈터가 허용 오차 안에서 비스듬히 쏜 명중도 조준점으로 도착 처리 (LUT 결과 우선). 연출상 지면 직선과 조준점 사이 최대 약 ±3° 어긋남.
- **FLOWER 투입 방향 구역(`flowerDropZones`):** v1은 방향 무관(도달 거리 1.0 in). 필드 테스트 후 필요 시 `BumperZone` 재사용.
- **바닥 잔여 공 직접 배치 GUI:** v1 이후 (현재는 무작위 산포).
- **실측 보정:** FLOWER 용량 테이블, HIVE 팁 임계 테이블, 빗맞음 방출 파라미터, 착지 속도 유지 비율(`landingSpeedRetention`, 실측 방법 2.5항), 슈터 편차 파라미터(실측 명중률로 보정)는 실측 데이터 확보 시 교체.
- **저정밀 LUT 미리보기 (불채택):** 샘플을 줄인 빠른 미리보기 LUT를 먼저 보여주고 정밀본으로 교체하는 방식은 채택하지 않음. 미리보기로 경기를 돌리면 저장 레시피 재현 시 결과가 달라져 결정론이 깨지고, 표시용으로만 제한해도 정밀본과 달라 보이는 혼란이 생김. 대신 정밀본을 행 단위로 점진 표시 (2.6.2항 진행 상황 표시).
- **경기 자동 저장 / 복구:** v1은 새로고침 / 크래시 시 경기 폐기 (3.6항). 입력 로그를 주기적으로 저장해 두면 로그 재생으로 복구할 수 있으므로 필요 시 Step 10 이후 검토.
- ~~**키보드 입력:**~~ → 해결 (09-1): 키보드 주행 유지 + SETTINGS 탭 런타임 끄기 토글 + 상태별 키 공유로 스크러빙 단축키와 공존 (3.6항, 3.8항).
- **브라우저 자동 테스트:** 07-6의 헤드리스 Chromium 점검은 저장소 밖 일회성 스크립트(`playwright-core`, 작업 공간에만 설치)로 수행했다. 08-1에서 Step 8도 같은 방식(순수 계산 함수 Vitest + 단계별 1회성 점검)으로 결정하고 Playwright는 저장소에 넣지 않았다 (스크린샷 비교는 폰트 / 안티앨리어싱 차이로 불안정). Step 9 GUI 상호작용이 복잡해지면 Vitest 브라우저 모드 편입을 다시 검토.
- **렌더링 프레임 간 보간:** v1은 최신 틱 프레임만 그린다 (3.7항). 50의 배수가 아닌 주사율(60 / 144 Hz)에서 같은 틱이 불규칙하게 반복되는 미세한 끊김이 거슬리면, 실시간 루프 `onFrame`에 누산기 잔여 비율(alpha)을 넘겨 직전 / 현재 프레임을 보간하는 방식을 검토 (화면이 최대 1틱 20 ms 늦게 보임). 모니터 주사율을 100 Hz 등 50의 배수로 맞추면 틱당 같은 수의 화면 프레임이 대응되어 이 끊김이 없어진다 (60 Hz로 낮추는 것은 해결되지 않음).
- **리프트 상태 주행:** v1은 리프트 상태 전체(올림 / 대기 / 투입 / 내림)를 Stationary Lock으로 둔다. 실제 로봇이 리프트를 올린 채 미세 이동이 가능하면 대기 상태의 저속 주행 허용을 검토. (09-1 검토: 실제 로봇이 리프트를 올린 채 주행 가능한지 확인되면 `RobotConfig` 옵션(리프트 중 최고 속도, 0 = 잠금)으로 추가. 그 전까지 Step 9 범위 밖.)
- **교차 브라우저 결정론:** `Math.sin/cos/hypot` 등 초월함수 결과가 JS 엔진마다 최하위 비트에서 다를 수 있어, 다른 브라우저 간 리플레이는 비트 단위 동일성이 보장되지 않음 (저장 레시피에 상태 체크섬 포함 권장).
- **복기 중 로봇 동선 표시 (09-1 신규):** 저장된 프레임에서 틱 구간의 로봇 위치를 선으로 그려 동선 최적화 회의에 활용 (표시 옵션 후보). 프레임이 모두 저장돼 있어 구현 비용이 작다. Step 9 이후.
- **드라이버 연습용 3D 보기 (09-1 참고):** 드라이버 감각 연습은 3D 시점이 유리하다는 의견. 현재 범위 밖, 참고로만 기록.
