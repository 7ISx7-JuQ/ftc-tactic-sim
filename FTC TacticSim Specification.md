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
    - (※ UI에서 사용자가 수정할 수 있는 기본값으로 제공됨)

### 2.4 득점 기물 초기화 (Game Pieces Setup)

총 40개의 기물(Pollen 32개, Nectar 8개)을 초기화한다.

1. **POLLEN (직경 2.8인치, 구형):** 총 32개.
    - 로봇 프리로드 (8개): 내 동맹 로봇 2대에 각각 4개씩 적재 (`CONTROLLED`).
    - FLOWER 내부 (16개): 4개의 FLOWER에 4개씩 배치 (`IN_FLOWER`).
    - GARDEN (8개): Red GARDEN 4개, Blue GARDEN 4개 배치 (`IN_GARDEN`).
2. **NECTAR (직경 3.6인치, 대형 구형/캡슐):** 아군 진영 색상 총 8개 (상대 진영 배제).
    - HIVE 내부 (3개): 아군 HIVE의 위를 향하고 있는(UP) CELL 내부에 배치 (`IN_HIVE`).
    - 휴먼 플레이어 스톡 (5개): 필드 밖 대기 (`OUT_OF_BOUNDS`). HIVE 팁 시 1개씩 로딩 존에 스폰되며, 60초 돌입(ENDGAME) 시 잔여 재고 전량 로딩 존 스폰.
3. **텔레옵 시작 조건 및 자율주행(Autonomous) 시나리오 커스터마이징:**
    - 공식 경기 기본값(Default Setup):
        * HIVE 상향 셀: RED는 `AUDIENCE_CELL`, BLUE는 `OPPOSITE_CELL`
        * HIVE 내부 적재: 상향 셀에 NECTAR 3개
        * 로봇 프리로드: R1 4개, R2 4개 (POLLEN)
        * FLOWER: 4개 플라워에 각각 POLLEN 4개씩 적재
        * 바닥 잔여 공: GARDEN에 각각 4개씩 배치
    - 커스텀 시나리오(`ScenarioConfig` 전달 시):
        * HIVE 상향 셀 방향(`hiveUpwardCell`) 및 내부 기물 수(Pollen/Nectar)를 사용자 정의값으로 덮어씀.
        * R1, R2의 초기 프리로드 수량(0~4개)을 개별 지정 가능.
        * 자율주행 중 필드 바닥에 흩어진 잔여 공은 정적 장애물(HIVE AABB, FLOWER 원통, 로봇 스폰 OBB)과 겹치지 않는 안전 데드존 회피 난수 알고리즘을 통해 필드 바닥(`state: 'ON_FIELD', vx: 0, vy: 0`)에 자동 산포 스폰.

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
    - **초기 상태:** Red는 `AUDIENCE_CELL`이 위(UP)를, Blue는 `OPPOSITE_CELL`이 위(UP)를 향하도록 고정 시작.
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
            - HIVE 임계치 도달 시 20점 획득, `tipCount++`, `isTipping = true`, `tipProgressTimer = 0` 설정.
            - 셀 내부의 공들에 대해 각각 목표 좌표와 `settleTime`을 계산하여 `pendingDrops` 큐에 등록.
            - 50Hz 엔진이 매 틱 `tipProgressTimer += 0.02`를 누적하며, 개별 `settleTime` 도달 시점에 해당 좌표에 정지 상태(`vx=0, vy=0, state='ON_FIELD'`)로 순차 스폰.
            - 큐의 모든 공이 스폰 완료되면(약 2.1~2.2초 소요) `isTipping = false`로 복귀하고 다음 득점 수용 가능.
            - 팁 발생 즉시 로딩 존에 NECTAR 1개가 스폰됨.
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
        - **추출 조건:** 로봇 OBB 외곽과 FLOWER 솔리드 원통 간 최단 거리 1.0 in 이내 접촉 + `actionState === 'INTAKING'` + 로봇 적재 공간 여유(`controlledPieces.length < 4`).
        - **deQ 실행:** `slot[0]`에 POLLEN이 존재하고 접촉 유지 시간(`intakeContactTimer`)이 최소 추출 쿨다운에 도달하면 `slot[0]` 기물을 로봇으로 회수 적재하고 `intakeContactTimer = 0` 리셋.
        - **연속 추출 중력 쿨다운:** 1회 추출 후 다음 기물 추출까지의 대기 시간은 `max(robotConfig.intakeDelay / 1000, 0.12초)`로 클램핑하여 중력에 의한 기물 낙하 한계 시간을 보장.
        - **NECTAR 하단 블로킹 (Jamming):** `slot[0]`이 비었을 때 상위 기물의 침하 판정:
            - 바로 위(`slot[1]`)가 POLLEN인 경우: `slot[1]` 기물이 `slot[0]`으로 낙하 안착하며 상위 기물들도 순차 1칸씩 하강.
            - 바로 위(`slot[1]`)가 NECTAR인 경우: NECTAR(3.6 in)는 하단 배출구(2.8 in)보다 커서 하단 턱에 걸림. NECTAR는 `slot[1]`에 영구 정지 고정되고 `slot[0]`은 빈 상태(`null`)로 유지됨.
            - `slot[0]`이 비어있는 상태에서는 추가 하단 deQ가 영구 차단됨 (물리적 잼 발생).
    - **상단 투입 (Drop):**
        - NECTAR는 잔여 60초 이하(ENDGAME) 시점에만 투입 가능.
        - 리프트 준비 완료 후 FLOWER 최상단 슬롯에 기물 추가 (`pieces.push(piece)`).
4. **GARDEN & PARK (경기 종료 판정):**
    - 경기 진행 중에는 실시간 점수로 가산하지 않음.
    - 경기 종료 틱(Tick 6000, 남은 시간 0초) 시점에 필드 상태를 검사하여 일괄 가산:
        - **GARDEN:** 아군 GARDEN AABB 구역 내에 완전히 정지(`speed === 0, state === 'IN_GARDEN'`)해 있는 기물 개당 1점 가산.
        - **PARK:** 아군 LOADING ZONE AABB 구역과 차체(OBB) 일부라도 겹친 상태로 정지한 로봇당 5점 가산 (FTC 룰상 부분 진입도 주차로 인정).
5. **랭킹 포인트 (RP):** SWARM (주차 10점) / POLLINATOR 1 (팁 4회) / POLLINATOR 2 (팁 7회).

## 3. 핵심 아키텍처 원칙 (Architecture Principles)

1. **상태와 렌더링의 완벽한 분리:** React는 UI만 담당. 시뮬레이션 상태 루프(50Hz)와 Canvas 2D 렌더링은 순수 TypeScript 로직으로 분리.
2. **50Hz Fixed Tick Loop:** `dt = 0.02` 고정 연산. 매 틱 스냅샷을 `TimelineFrame` 객체로 `Array`에 저장.
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
    - **가상 Intake Zone 판정 메커니즘 구체화 (신설):**
        - **`ANY` (4면 흡입):** 로봇 차체 OBB(18×18 in) 외곽 사방으로 `intakeDepth`만큼 확장된 영역에 공 중심이 접촉할 때 유효.
        - **`FRONT` (전면 흡입):** 로봇 전면 범퍼 기준 너비 `intakeWidth`, 전방 돌출 깊이 `intakeDepth`의 가상 센서 OBB 박스 내에 공 중심이 접촉할 때 유효.
        - **Kinematic Pusher 흡착 트랩:** `actionState === 'INTAKING'` 가동 중 유효 Intake Zone 내에 들어온 공은 범퍼 밖으로 튕겨내는 반발 계수(restitution)를 0으로 감쇠하여 차체 전면에 안정적으로 머물도록 처리.
        - **흡입 조건 판정:** Intake Zone 접촉 유지 시간(`intakeContactTimer`)이 `intakeDelay` 이상 지속되고 로봇 적재 공간(`controlledPieces.length < 4`)이 있을 때 `CONTROLLED` 상태로 전환.
    - **공 vs 정적 장애물 충돌:**
        - 위치 보정: 고정 장애물이므로 공 위치에만 100% MTV 가산.
        - 속도 반사: 공이 장애물로 파고드는 법선 속도 `vn = dot(v_ball, normal) < 0`일 때: `v_ball -= (1 + e) * vn * normal` (e는 기물별 restitution 적용).
    - **공 vs 로봇 충돌 (Kinematic Pusher):**
        - 로봇은 무한 질량으로 간주되어 감속되지 않음. 공에만 100% MTV 가산.
        - 접촉점 유효 선속도 (회전 성분 포함): 접촉점 오프셋 `dx = ball.x - robot.x`, `dy = ball.y - robot.y`에 대해`vEff.x = robot.vx - robot.omega * dy`, `vEff.y = robot.vy + robot.omega * dx`
        - 충격량 속도 전달: `mtvNormal`은 로봇 → 공 방향. `vRel = v_ball - vEff`, `vn = dot(vRel, mtvNormal) < 0`일 때: `v_ball -= (1 + e) * vn * mtvNormal` 적용 (달리는 로봇 범퍼에 맞은 공이 전방으로 튕겨 굴러감).
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
    - Step 5: HIVE `tipProgressTimer += dt` 누적 및 `settleTime` 도달 공 순차 `ON_FIELD` 방출
5. **Slew Rate Limiter:** RoadRunner / Pedro Pathing 오도메트리 제원 기반 속도 선형 보간.

## 4. 데이터 인터페이스 명세 (`types.ts`)

```tsx
// 1. 로봇 하드웨어 제원 (RoadRunner 튜닝 상수 호환)
export interface RobotConfig {
  id: 'robot1' | 'robot2';
  name: string;
  width: number;
  length: number;
  maxSpeed: number; // 최고 속도 (inch/s)
  maxTurnRate: number; // 최고 각속도 (rad/s)
  maxLinearAccel: number; // 최대 선형 가속도 (inch/s^2)
  maxAngularAccel: number; // 최대 각가속도 (rad/s^2)

  // 초기 스폰 설정
  spawnX: number;
  spawnY: number;
  spawnHeading: number; // 라디안

  // 인테이크 옵션
  intakeDelay: number; // 흡입 딜레이 (ms)
  canIntakeNectar: boolean; // Nectar 무시 전략 옵션
  intakeDirection: 'FRONT' | 'ANY';
  intakeWidth: number; // 전면 인테이크 유효 너비 (inch) - 필수
  intakeDepth: number; // 전면 흡입 감지 여유 깊이 (inch) - 필수

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

// 텔레옵 시작 조건 (자율주행 결과 반영 시나리오 설정)
export interface ScenarioConfig {
  allianceColor: 'RED' | 'BLUE';
  
  // HIVE 초기 상태
  hiveUpwardCell?: 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
  hiveInitialPieces?: {
    pollenCount: number; // 0 ~ 8
    nectarCount: number; // 0 ~ 5
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
  controlledPieces: GamePiece[]; // 최대 4개
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
  ballsInUpwardCell: number;
  isTipping: boolean;
  tipCount: number;
  tipProgressTimer: number; // 전복 시작 후 누적 경과 시간 (초 단위)
  pendingDrops: PendingDrop[];
}

// 5. 필드 통합 상태 및 RP
export interface FieldState {
  allianceColor: 'RED' | 'BLUE';
  matchPhase: 'TELEOP' | 'ENDGAME';
  hive: HiveState;
  flowers: FlowerState[];
  nectarStock: number; // 5개로 시작
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
    - `ScenarioConfig`가 주어지지 않은 경우 기본 공식 룰(HIVE 상향 셀 기본 방향, NECTAR 3개 적재, 로봇당 4개 프리로드)로 초기화하라.
    - `ScenarioConfig`가 제공된 경우 해당 파라미터(HIVE 방향/적재량, 로봇 프리로드 수)를 우선 반영하고, 지정된 바닥 잔여 기물(`groundPiecesCount`)은 HIVE/FLOWER/로봇 데드존을 회피하여 `ON_FIELD` 정지 상태로 필드에 무작위 스폰하라.
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
    - 로봇 인테이크 접촉 시 `slot[0]`의 POLLEN만 추출(`shift`) 가능하며, 추출 쿨다운은 `max(intakeDelay, 0.12s)`를 적용하라.
    - 추출 후 바로 위 기물이 NECTAR인 경우 `slot[0]`을 `null`로 두고 NECTAR를 `slot[1]`에 고정시켜 추가 추출을 영구 차단하라.
    - FLOWER 득점 집계 시 `slot[0]`은 배제하고, `slot[1..N]` 내 NECTAR 존재 여부에 따라 소유권(개당 2점) 및 하단 보너스(5점)를 경기 종료 틱(Tick 6000)에 일괄 산출하라.
7. **탄도 모델 분리:** 슈터 몬테카를로 히트맵 생성기는 오프라인/별도 모듈로 격리하고, 엔진 루프는 R1/R2 각각에 배정된 히트맵 LUT 및 조준 오차 판정 인터페이스를 통해 결정론적으로 동작하도록 지시.
8. **엔드게임 전환:** 남은 경기 시간 60초 도달 시 `ENDGAME` 페이즈 전환 및 잔여 NECTAR 재고 전량을 아군 로딩 존에 스폰하라.
9. **점수 집계 타이밍 엄수:**
    - Tick 0 ~ 5999 구간에는 HIVE Tip 점수(회당 20점)만 실시간으로 `totalScore`에 누적하라.
    - GARDEN 점수, PARK 점수, FLOWER 점수는 Tick 6000(경기 종료)에 도달하는 순간 최종 합산하여 프레임에 기록하라.