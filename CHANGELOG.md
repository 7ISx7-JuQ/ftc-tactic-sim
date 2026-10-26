# Changelog

**English** · [한국어](#한국어)

## 2.0.0 (unreleased)

Match results differ from 1.x: the engine rules and several field values changed, so the same setup and inputs now give a different match. Files saved by 1.x still open (see *Files* below); files saved by 2.0 cannot be opened by 1.x.

### Engine and field

- **HIVE tunnel:** robots and floor pieces can pass under the HIVE (between its legs). Robots cannot shoot from inside the tunnel. The tunnel roof fades while something is under it.
- **Shots are judged by their actual path:** every shot gets its own random spread, and it scores if that path goes through the opening. Fixed shooters no longer have an aim tolerance; the left panel shows the expected hit rate for the current pose.
- **Wall bounces:** pieces in the air bounce off the field walls (and then off the HIVE or the opposite wall).
- **Landing spots:** a piece that lands on a robot or another piece is moved to the nearest free spot.
- **Measured tables:** FLOWER capacity (measured) and HIVE TIP thresholds (from a local workshop; may change with HIVE calibration). With 3 NECTAR in the upward CELL a TIP now takes 4 POLLEN.
- **BLUE default start poses** mirror the RED ones.

### Robots

- **Shooter setup:** none, POLLEN only (NECTAR is kept for FLOWERS), shared, or one shooter per piece with its own settings and sweet spot.
- **Side offset** of the shooter (the aim compensates for it).
- **Driving with the lift up:** a lift speed limit (0 keeps the 1.x lock).
- **FLOWER drop zones:** the sides of the robot that can drop into a FLOWER.

### Scenario

- **Edit on field:** drag robots, place and remove floor pieces, and click the HIVE, FLOWERS, GARDENS or robots to set counts, loadouts and auto moves, with undo / redo.
- **RP thresholds** (SWARM points, POLLINATOR TIPs) can be changed per event.
- **Auto moves** per robot: none / LEAVE / PARK / LEAVE + PARK, counted for the SWARM RP.
- **Seed** can be typed in to reproduce the same floor layout.

### Review and branches

- Unfinished branches and the whole branch tree are saved in match files.
- Up to 16 branches; switching recalculates other branches instead of keeping them in memory.
- Switch branches straight from the comparison row in the result popup.
- **Robot path** display option for reviews.
- **Smooth motion** (on by default): movement is drawn between ticks.

### Input

- **Devices:** assign gamepad slot 0, slot 1 and the keyboard to R1 / R2 / none, and swap R1 ↔ R2.
- **Gamepad mapping:** change the buttons per slot (press to assign) and swap the sticks.

### Saving in the browser

- **Autosave:** the last match is saved automatically and offered for restore after a refresh or crash.
- **Saved lists:** keep robots, scenarios, whole setups and matches by name in this browser.

### Files

- 1.x match files open with an "engine version differs" warning and are recalculated with the 2.0 rules.
- 1.x presets load; the new robot fields are filled with values that behave like 1.x.
- The aim tolerance field was removed.

## 1.0.0

First release.

---

## 한국어

## 2.0.0 (출시 전)

경기 결과가 1.x와 다릅니다. 엔진 규칙과 필드 값 몇 가지가 바뀌어 같은 설정과 입력에서도 다른 경기가 나옵니다. 1.x에서 저장한 파일은 열 수 있지만(아래 *파일*), 2.0에서 저장한 파일은 1.x에서 열 수 없습니다.

### 엔진과 필드

- **HIVE 터널:** 로봇과 바닥 기물이 HIVE 아래(다리 사이)로 지나갈 수 있습니다. 터널 안에서는 발사할 수 없고, 무언가 아래에 있으면 터널 지붕이 흐려집니다.
- **실제 궤적으로 명중 판정:** 발사마다 편차를 준 궤적을 하나 뽑아, 그 궤적이 투입구를 지나면 득점합니다. 고정형 슈터의 허용 조준 오차가 없어졌고, 좌측 패널에 지금 자세의 기대 명중률이 나옵니다.
- **벽 반사:** 공중의 기물이 필드 벽에 맞고 튕깁니다 (그 뒤 HIVE나 반대쪽 벽에도).
- **착지 자리:** 로봇이나 다른 기물 위에 떨어진 기물은 가장 가까운 빈 자리로 옮겨집니다.
- **실측 테이블:** FLOWER 수용 한도(실측)와 HIVE TIP 임계(지역 워크샵 값, HIVE 보정 상태에 따라 바뀔 수 있음). 상향 셀에 NECTAR 3개면 이제 POLLEN 4개에서 TIP합니다.
- **BLUE 기본 시작 자세**가 RED와 대칭이 됩니다.

### 로봇

- **슈터 구성:** 없음, POLLEN 전용(NECTAR는 FLOWER용으로 보관), 공용 1개, 기물별 2개(따로 설정 · 스윗스팟).
- 슈터 **좌우 오프셋** (조준이 보정함).
- **리프트를 올린 채 주행:** 리프트 상태 최고 속도 (0이면 1.x처럼 잠금).
- **FLOWER 투입 방향 구역:** FLOWER에 넣을 수 있는 로봇 면.

### 시나리오

- **필드에서 편집:** 로봇을 끌어 옮기고, 바닥 기물을 놓고 빼고, HIVE · FLOWER · GARDEN · 로봇을 눌러 개수 · 적재물 · 오토 이동을 정합니다. 되돌리기 / 다시 하기 지원.
- **RP 기준값**(SWARM 점수, POLLINATOR TIP 수)을 대회마다 바꿀 수 있습니다.
- 로봇별 **오토 이동**: 없음 / LEAVE / PARK / LEAVE + PARK (SWARM RP에 반영).
- **시드**를 직접 입력해 같은 바닥 배치를 재현할 수 있습니다.

### 복기와 가지

- 끝나지 않은 가지와 분기 트리 전체가 경기 파일에 저장됩니다.
- 가지는 최대 16개. 다른 가지는 메모리에 두지 않고 전환할 때 다시 계산합니다.
- 결과 팝업의 비교 줄에서 바로 가지를 전환합니다.
- 복기용 **로봇 동선** 표시 옵션.
- **부드러운 움직임**(기본 켜짐): 틱 사이 움직임을 이어서 그립니다.

### 입력

- **장치 배정:** 게임패드 슬롯 0 / 슬롯 1 / 키보드를 R1 / R2 / 없음에 배정하고, R1 ↔ R2를 바꿀 수 있습니다.
- **게임패드 매핑:** 슬롯별로 버튼을 바꾸고(눌러서 지정) 스틱 좌우를 바꿀 수 있습니다.

### 브라우저에 저장

- **자동 저장:** 마지막 경기가 자동으로 저장되고, 새로고침이나 크래시 뒤 복구를 묻습니다.
- **저장 목록:** 로봇 · 시나리오 · 전체 설정 · 경기를 이름 붙여 이 브라우저에 둡니다.

### 파일

- 1.x 경기 파일은 "엔진 버전 다름" 경고와 함께 열리고 2.0 규칙으로 다시 계산됩니다.
- 1.x 프리셋을 불러올 수 있습니다. 새 로봇 항목은 1.x처럼 동작하는 값으로 채워집니다.
- 허용 조준 오차 항목이 없어졌습니다.

## 1.0.0

첫 출시.
