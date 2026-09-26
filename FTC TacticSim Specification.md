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
    - **CELL 분할 구조:** 각 진영별 HIVE는 2개의 CELL(너비 20.0인치)로 분할된다. Y축을 기준으로 상단의 `OPPOSITE_CELL`(Y < 72)과 하단의 `AUDIENCE_CELL`(Y > 72)로 나뉘며 렌더링 시 시각적으로 명확히 구분한다.
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
- **정지 임계 속도:** `speed < 0.5 in/s` 도달 시 수치 진동 방지를 위해 `vx = 0, vy = 0`으로 강제 스냅.

### 2.6 득점 및 구조물 로직 (Scoring Mechanics)

1. **HIVE (벌집) 팁 및 시차 낙하 로직:**
    - **초기 상태:** Red는 `AUDIENCE_CELL`이 위(UP)를, Blue는 `OPPOSITE_CELL`이 위(UP)를 향하도록 고정 시작.
    - **팁 임계 테이블 (`HIVE_TIP_POLLEN_BY_NECTAR`, FLOWER 용량 테이블과 같은 구조):** 상향 셀의 NECTAR 개수별로 팁이 발동하는 POLLEN 개수. 임계 조합 {NECTAR, POLLEN} = {5, 0}, {4, 1}, {3, 3}, {2, 5}, {1, 6}, {0, 8}. 상향 셀 POLLEN ≥ 해당 NECTAR 개수의 임계 POLLEN이면 팁 (NECTAR 5개 이상이면 POLLEN 0개로 즉시 팁). 상향 셀 개수는 NECTAR / POLLEN 별도 집계(`nectarInUpwardCell`, `pollenInUpwardCell`).
    - **팁 발동 시점:** 명중으로 상향 셀이 임계에 도달한 **같은 틱**에 즉시 팁 상태(`isTipping = true`, `tipProgressTimer = 0`)로 전환. 팁 진행 중(낙하 대기열 방출 완료 전)에 발사된 공은 명중 확률과 무관하게 **전부 빗맞음** 처리되어 튕겨 나옴.
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
2. **HIVE 슈팅 메커니즘 및 탄도 모델 (신설):**
    - **Sweet Spot 기반 $v_0$ 역산 공식 도입:**
        
        사용자가 입력한 전술 사격 거점 좌표 $(X_s, Y_s)$와 목표 셀 중심 $(X_g, Y_g)$ 사이의 수평 거리 $D_{\text{sweet}}$, 슈터 높이차 $\Delta z$, 발사각 $\theta$를 통해 최적 사출 속도 $v_0$를 닫힌 해(Closed-form)로 자동 계산:
        
        $$v_0 = \frac{D_{\text{sweet}}}{\cos\theta} \sqrt{\frac{g}{2(D_{\text{sweet}}\tan\theta - \Delta z)}}$$
        
    - **스윗스팟 3-Tier GUI 입력 및 4-Cell 대칭 변환:**
        - 사용자는 72×72 그리드(2인치 해상도) 인터페이스에서 기준 셀(`RED_AUDIENCE`)을 타깃으로 하는 사격 구역을 3단계 티어로 지정:
            - Tier 1 (100% Core): 최적 전술 거점 (v0 역산 기준점)
            - Tier 2 (80% Reliable): 안정 사격 구역
            - Tier 3 (60% Marginal): 한계 사격 구역
        - 단일 셀(`RED_AUDIENCE`) 입력 데이터를 기하학적 대칭 변환을 통해 4개 셀 전체로 자동 매핑:
            - `RED_OPPOSITE`: Y축 선대칭 (x, 144 - y)
            - `BLUE_AUDIENCE`: X축 선대칭 (144 - x, y)
            - `BLUE_OPPOSITE`: (72, 72) 원점 점대칭 (144 - x, 144 - y)
        - 도출된 거점 데이터를 기반으로 로봇별(R1, R2) 독립 몬테카를로 시뮬레이션을 수행하여 4개 셀 LUT(총 8장)를 생성.
    - **로봇별(R1, R2) 독립 몬테카를로 히트맵 생성:**
        
        두 로봇은 하드웨어 스펙(발사각, 슈터 지상고, 조향각, 스윗스팟 등)이 서로 다르므로, R1과 R2 각각 독립된 몬테카를로 시뮬레이션을 수행.
        
    - **셀별 4종 독립 2D LUT (로봇당 4장, 총 8장 관리):**
        
        HIVE의 4개 셀(`RED_AUDIENCE`, `RED_OPPOSITE`, `BLUE_AUDIENCE`, `BLUE_OPPOSITE`) 각각을 타깃으로 하는 $72 \times 72$ 그리드(2인치 해상도) 2D 명중률 테이블을 생성. 런타임에는 현재 활성화된 아군 상향 셀 키에 해당하는 히트맵을 매핑하여 공간 명중률 $P_{\text{spatial}}(x, y)$ 도출.
        
    - **조준 방위각(Yaw Alignment) 런타임 판정 분리:**
        - 2D 히트맵은 로봇이 골대를 정면 조준했을 때의 공간 명중률 $P_{\text{spatial}}$만 담당.
        - 런타임 사격 시 로봇 헤딩과 목표 셀 중심 방향 간의 각도 오차 $\vert{}\Delta \psi\vert{}$를 계산.
        - **고정형 슈터(`FIXED`):** $\vert{}\Delta \psi\vert{} \le \text{aimTolerance}$ (기본 $\pm 3^\circ$) 이내일 때만 $P_{\text{final}} = P_{\text{spatial}}$, 벗어나면 $0\%$ 처리 (조준 회전 비용 반영).
        - **터렛형 슈터(`TURRET`):** 목표 방향이 터렛 회전 한계선 $[\alpha, \beta]$ 이내이면 $P_{\text{final}} = P_{\text{spatial}}$ 적용.
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
        - 리프트 준비 완료 후 로봇 적재함 맨 앞 기물(FIFO, `controlledPieces.shift()`)을 FLOWER 최상단 슬롯에 추가 (`pieces.push(piece)`). 투입 가능 여부(① 도달 거리 내 FLOWER, ② NECTAR는 ENDGAME에만, ③ FLOWER 용량 테이블)는 **투입 요청 시점**에 검사하여 불가능하면 리프트 준비(`FLOWER_SETUP`)에 진입하지 않고 요청을 거부(IDLE 유지)한다. 연속 투입도 다음 기물이 투입 가능할 때만 이어간다. 준비 중 상황 변화에 대비해 투입 완료 시점에도 같은 조건을 재검사하며, 불가능하면 기물은 그대로 둔 채 상태만 복귀.
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
        - **`SHOOTING`, `FLOWER_SETUP`, `FLOWER_DROPPING` (Stationary Lock 감속 제동):**
            - 즉각적인 위치 고정이 아닌, 목표 속도를 `(0, 0, 0)`으로 강제하여 Slew Rate Limiter 기반 감속 주행 유도.
            - 차체 실제 속도가 완전 정지 임계치(`speed < 0.5 in/s` 및 `|omega| < 0.05 rad/s`)에 도달하기 전까지는 감속 제동 상태(`isBraking = true`)로 대기하며 액션 타이머를 차감하지 않음.
            - 완전 정지 도달 시 비로소 `isBraking = false`로 전환하고 `stateTimer -= dt` 차감 시작.
    - Step 2: 로봇-환경 및 로봇-로봇 충돌 해결 (위치/속도 보정)
    - Step 3: 필드 위 공(`ON_FIELD`) 마찰 감속 및 위치 적분 (`stepPieceDynamics`)
    - Step 4: 공 충돌 완화 루프 (공 vs 환경/로봇/공 충돌 해결, 2회 반복)
    - Step 4-2: 끼인 공 역보정 (`resolvePinnedPieces`): 완화 후에도 로봇과 겹친 공에 막힌 로봇을 되밀어 정지
    - Step 5: HIVE `tipProgressTimer += dt` 누적 및 `settleTime` 도달 공 순차 `ON_FIELD` 방출
5. **Slew Rate Limiter:** RoadRunner / Pedro Pathing 오도메트리 제원 기반 속도 선형 보간.

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

  // HIVE 득점 (슈터) 런타임 제원
  shooterDelay: number; // 발사 딜레이 (ms)
  shooterAccuracy: number; // 0.0 ~ 1.0 (명중률)
  turretType: 'FIXED' | 'TURRET';
  turretRange: [number, number];
  aimTolerance: number;

  // FLOWER 득점 옵션
  flowerSetupDelay: number; // 리프트 준비 시간 (ms)
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

// 독립 모듈용 탄도학 설정 및 히트맵 타입
export interface BallisticsConfig {
  dz: number; // 림 높이 - 발사구 지상고 (in)
  shooterPitch: number; // 발사각 (rad)
  sweetSpot: { x: number; y: number }; // 전술 거점 좌표
  shooterOffset: number; // 차체 중심 기준 발사구 전방 오프셋 (in)
  v0NoisePercent?: number; // 속도 편차 (기본 0.02)
  headingNoiseRad?: number; // 방위각 편차 (기본 0.02 rad)
  pitchNoiseRad?: number; // 피치각 편차 (기본 0.006 rad)
}

export type HiveCellKey = 'RED_AUDIENCE' | 'RED_OPPOSITE' | 'BLUE_AUDIENCE' | 'BLUE_OPPOSITE';
export type HeatmapLUTSet = Record<HiveCellKey, number[][]>; // 72x72 배열 (0.0 ~ 1.0)

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
  isBraking: boolean; // Stationary Lock 액션 진입 후 완전 정지 대기 중인지 여부
  intakeContactTimer: number; // 유효 흡입 영역 내 기물 접촉 유지 시간 누적치 (초 단위)
  intakeTargetPieceId: string | null; // 현재 접촉 흡입 중인 기물 식별자
  controlledPieces: GamePiece[]; // FIFO 적재함 (0번이 다음에 나감), 최대 길이 = 로봇 적재 한도
}

// 슈팅 판정 인터페이스
export type ShotProbabilityResolver = (
  robotId: 'robot1' | 'robot2',
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
export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number; // 5개로 시작 (휴먼 플레이어가 아직 투입 결정하지 않은 재고)
  pendingHumanNectar: number; // 투입이 결정됐으나 로딩 존 빈 자리를 기다리는 NECTAR 수 (자리가 나면 즉시 배치)
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
5. **상태 전이(FSM) 타이머 및 주행 제어:** `actionState === 'INTAKING'`일 때는 주행 입력을 유지하여 Mobile Intake를 수행하고 공 접촉 타이머를 누적하도록 지시. `SHOOTING`, `FLOWER_SETUP`, `FLOWER_DROPPING`일 때는 감속 제동(`isBraking = true`) 후 정지 완료 시점에 `stateTimer`를 차감하도록 지시.
6. **FLOWER 슬롯 구조 및 하단 추출/블로킹 구현:**
    - `flower.pieces[0]`을 지면 슬롯(`slot[0]`), `[1..N]`을 유효 스코어링 볼륨으로 취급하라.
    - 로봇 인테이크 구역(`intakeZones`)이 FLOWER 원통 정사영과 겹칠 때 `slot[0]`의 POLLEN만 추출(`shift`) 가능하며, 추출 쿨다운은 `max(intakeDelay, 0.12s)`를 적용하라.
    - 추출 후 바로 위 기물이 NECTAR인 경우 `slot[0]`을 `null`로 두고 NECTAR를 `slot[1]`에 고정시켜 추가 추출을 영구 차단하라.
    - FLOWER 득점 집계 시 `slot[0]`은 배제하고, `slot[1..N]` 내 NECTAR 존재 여부에 따라 소유권(개당 2점) 및 하단 보너스(5점)를 경기 종료 틱(Tick 6000)에 일괄 산출하라.
7. **탄도 모델 분리:** 슈터 몬테카를로 히트맵 생성기는 오프라인/별도 모듈로 격리하고, 엔진 루프는 R1/R2 각각에 배정된 히트맵 LUT 및 조준 오차 판정 인터페이스를 통해 결정론적으로 동작하도록 지시.
8. **엔드게임 전환:** 남은 경기 시간 60초 도달 시 `ENDGAME` 페이즈 전환 및 잔여 NECTAR 재고 전량을 아군 로딩 존에 투입하라 (빈 슬롯이 없으면 `pendingHumanNectar`로 대기 후 순차 배치).
9. **점수 집계 타이밍 엄수:**
    - Tick 0 ~ 5999 구간에는 HIVE Tip 점수(회당 20점)만 실시간으로 `totalScore`에 누적하라.
    - GARDEN 점수, PARK 점수, FLOWER 점수는 Tick 6000(경기 종료)에 도달하는 순간 최종 합산하여 프레임에 기록하라.