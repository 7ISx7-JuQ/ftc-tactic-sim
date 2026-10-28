# FTC 2026-2027 BIOBUZZ Competition Manual (Markdown)

원본: [source/FTC_BIOBUZZ_RuleBook_TU06.pdf](source/FTC_BIOBUZZ_RuleBook_TU06.pdf) — *Competition Manual TU06* (2026-10-22, 173 pages, <https://ftc-resources.firstinspires.org/ftc/game/manual>에서 2026-10-26 받음 — TU05 PDF는 diff 기준으로 남겨 둠). Team Update 06 문서는 [source/BIOBUZZ_TeamUpdate06.pdf](source/BIOBUZZ_TeamUpdate06.pdf), 검사 체크리스트 V26-27.2는 [source/Inspection_Checklist_V26-27.2.pdf](source/Inspection_Checklist_V26-27.2.pdf). V1 원본은 [source/FTC_BIOBUZZ_RuleBook.pdf](source/FTC_BIOBUZZ_RuleBook.pdf) (변환 기준).

**현재 마크다운 = TU06.** V1에서 변환한 뒤 바뀐 부분만 고쳤음: [apply_tu04.py](../tools/rulebook-convert/apply_tu04.py)(V1 → TU04, 2026-10-11), [apply_tu05.py](../tools/rulebook-convert/apply_tu05.py)(TU04 → TU05, 2026-10-21), [apply_tu06.py](../tools/rulebook-convert/apply_tu06.py)(TU05 → TU06, 2026-10-26). 변경 요약과 설계 영향은 [../research/rule-updates.md](../research/rule-updates.md). 새 Team Update가 나오면 같은 방식(PDF 문장 diff → 변경분 패치)으로 갱신.

| 섹션 | TU06 변경 (2026-10-22) |
|---|---|
| 1 | 1.4.4 제목 오탈자 (Sprit → Spirit) |
| 6 | 6.6.1 Digital Animation Award(WPI 후원, 선택) 신설 — '곧 안내' 문장 대체 |
| 9 | 9.1 Field Acceptance Checklist·Field Mitigation Guide '(coming soon)' 삭제, 링크 갱신 |
| 10 | 10.6.1 문구('In the event that'), 10.8.3 Field Mitigation Guide '(coming soon)' 삭제 |
| 11 | **G401.B** 정지 버튼은 '팀 판단'만 (심판장 지시 T402 삭제). **G402 설명 상자: 오토 방해 예시 A(상대 진영 득점 요소 CONTROL)·B(상대 진영에서 상대 로봇 접촉) 추가.** G421 설명의 참조 G421.D → G421.B (TU04 때 오기로 적어 둔 것이 고쳐짐 — Team Update 문서에는 없음) |
| 그 밖 | 쪽 번호만 당겨짐 (9장 뒤 1쪽·뒤쪽 2쪽, 전체 175 → 173쪽 — 12.1은 119 → 118쪽). 래스터 그림 59장 동일, 표 변경 없음 |

| 섹션 | TU05 변경 (2026-10-15) |
|---|---|
| 10 | 10.8.4 FIELD Reset: 심판 신호 = 필드 리셋 시작·로봇 회수 (“로봇을 멈추라는” 표현 삭제) |
| 11 | G407 설명 상자에 “5개 이상 CONTROL이 반복되면 ‘4개 지키고 나머지 버리는’ 분류 기구가 있어도 STRATEGIC 가능” 추가. G408 설명 상자 신설: 상대 NECTAR를 자동으로 원래 상태로 돌려놓는 분류 기구가 있어도 반복 CONTROL은 STRATEGIC 가능 |
| 12 | R403 설명 상자: 작은 장식·숫자 틈은 12 ft(3.65 m)에서 읽히면 괜찮음 |
| 그 밖 | 쪽 번호만 밀림 (11장 뒤쪽부터 +1–2쪽, 전체 173 → 175쪽). 그림·표 변경 없음 |

| 섹션 | TU04 변경 |
|---|---|
| 1, 6 | "coming soon" 자료(Escalation Guidelines, 심사 매뉴얼·피드백 양식·질문 은행) 게시 → 문구와 링크 |
| 9 | Table 9-1: FLOWER Ownership Unlocked 신호 = "Chime" |
| 10 | 10.3.4 사전 장전 POLLEN은 자기 진영 안에. Table 10-6 반칙 적용 예시 정리 (행 1개 삭제, "MAJOR FOUL per MATCH" 행 교체) |
| 11 | G304.G 사전 장전 위치, G420 노출된 배선·인테이크 걸림은 보통 위반 아님 (항목 A–E로 재번호), G421 참조(원문이 "G421.D"로 표기, B의 오기로 보임), G423 벌칙 귀속, G425 문구, G426 NECTAR 투입 시점·재투입 |
| 13 | T301 "STUDENTS" → "representatives", Question Box 표기 |
| 12, 14–16, 그림 | 변경 없음 |

섹션별 마크다운 파일 + `figures/` (그림 PNG). 원본 PDF 하이퍼링크는 [links.md](links.md)에 모아둠.

## 섹션 목차

토큰은 대략치(문자 수 ÷ 4). ★ = 로봇 설계에 직접 필요.

| 파일 | 섹션 | PDF 쪽 | ~토큰 | 그림 | 설계 |
|---|---|---|---|---|---|
| [01-introduction.md](01-introduction.md) | 1 Introduction | 5–20 | 10.0k | 3 | |
| [02-season-overview.md](02-season-overview.md) | 2 FIRST Season Overview | 21 | 0.2k | 0 | |
| [03-eligibility-inspection.md](03-eligibility-inspection.md) | 3 Competition Eligibility and Inspection (I) | 22–26 | 2.4k | 0 | ★ |
| [04-advancement.md](04-advancement.md) | 4 Advancement | 27–32 | 2.6k | 3 | |
| [05-event-rules.md](05-event-rules.md) | 5 Event Rules (E) | 33–42 | 5.4k | 0 | |
| [06-awards.md](06-awards.md) | 6 Awards (A) | 43–60 | 8.7k | 4 | |
| [07-game-sponsor.md](07-game-sponsor.md) | 7 Game Sponsor Recognition | 61 | 0.1k | 0 | |
| [08-game-overview.md](08-game-overview.md) | 8 Game Overview | 62 | 0.3k | 1 | ★ |
| [09-arena.md](09-arena.md) | 9 ARENA (필드·HIVE·FLOWER·게임요소 치수, AprilTag) | 63–80 | 4.2k | 17 | ★ |
| [10-game-details.md](10-game-details.md) | 10 Game Details (경기 진행, 득점, 점수표, 반칙 체계) | 81–98 | 7.7k | 9 | ★ |
| [11-game-rules.md](11-game-rules.md) | 11 Game Rules (G) | 99–118 | 10.4k | 1 | ★ |
| [12-robot-construction-rules.md](12-robot-construction-rules.md) | 12 ROBOT Construction Rules (R) | 119–146 | 15.2k | 10 | ★ |
| [13-tournament.md](13-tournament.md) | 13 Tournament (T) | 147–166 | 8.9k | 11 | |
| [14-league-play.md](14-league-play.md) | 14 League Play Tournaments (L) | 167–168 | 0.5k | 0 | |
| [15-championship.md](15-championship.md) | 15 FIRST Championship (C) | 169–170 | 1.2k | 0 | |
| [16-glossary.md](16-glossary.md) | 16 Glossary (대문자 용어 정의) | 171–175 | 2.5k | 0 | ★ |

설계용 ★ 파일 전체 ≈ 43k 토큰. 보통은 필요한 섹션만 읽거나 `grep`으로 규칙 ID(`R105`, `G416` 등)를 찾으면 됨.

## 모델링에 자주 쓸 그림

| 내용 | 파일 |
|---|---|
| 필드 전체 / 존 배치 | `fig-09-01`, `fig-09-02`, `fig-10-01`, `img-08-game-overview.png` |
| LOADING ZONE·GARDEN 치수 | `fig-09-03-loading-zone-and-garden-shown-with-pollen-hidden.png` |
| 타일 좌표 | `fig-09-04`, `fig-09-05` |
| HIVE 프레임·HIVE·CELL 치수 | `fig-09-07` ~ `fig-09-11` |
| FLOWER 치수 / 득점 볼륨 | `fig-09-12-flower-details.png`, `cad-ref-10-04-flower-scoring-volume.png` |
| POLLEN(Ø~7.1 cm)·NECTAR(Ø~9.1 cm) | `fig-09-13`, `fig-09-14` |
| AprilTag 클러스터·위치 | `fig-09-15` ~ `fig-09-17` |
| 초기 배치 | `fig-10-02`, `fig-11-01` |
| 확장 한계(18×24×29 in) | `fig-12-01` ~ `fig-12-06` |
| ROBOT SIGN 규격 | `fig-12-07` ~ `fig-12-10` |

공식 필드 3D CAD·Field Setup Guide 링크는 [links.md](links.md)의 9-arena 항목에 있음. 도면 치수는 공칭값(±1 in)이고 공식 기준은 3D CAD 모델임(9.1절).

## 변환 규칙

- 규칙은 `**R105 *제목.**` 형식으로 굵게 표시. 규칙 ID 171개가 모두 들어 있음(검증 완료).
- 주황색 설명 박스(규칙 의도·예시)는 인용문(`>`)으로 표시.
- 그림은 캡션 바로 아래 `![Figure X-Y: …](figures/fig-XX-YY-….png)`로 연결. 그림 51개 + 기타 이미지 2개.
- 병합 셀 때문에 마크다운으로 옮길 수 없는 표는 이미지로 대체: Table 6-1, 13-3, 13-4, 13-5, 13-6, 13-8 (`figures/table-*.png`).
- 머리말·꼬리말·장식 이미지는 제거.

## 직접 보정한 부분

PDF 텍스트 레이어에서 일부 숫자·글자가 빈칸으로 추출되는 문제가 있어, 원본 페이지 렌더링과 대조해 고쳤음:

- AprilTag ID (9.9절: 30–33 / 34–37 / 38–41 / 42–45), 오디오 신호표 Table 9-1의 "3"
- 서보 정지 전류 `≤ 4 amps @6V` (Table 12-2), 레이저 규격 `IEC/EN 62471` (R710)
- “Red 1/Blue 1”(10.3.2), G-규칙 위반 문구의 “ROBOT is DISABLED”, “RED CARD”, 순위 ‘1’ through ‘n’(13장), 용지 규격(6장)
- 병합 셀 표 재작성: Table 10-1 (DRIVE TEAM), **Table 10-2 (점수표)**, 10-4, 10-6, 12-2 (서보), 12-7, **12-8 (전선 규격)**, 12-9, 13-7

남은 한계: 일부 인용문 안의 A/B/C 목록이 한 줄로 합쳐져 있고, 페이지 경계에서 문단이 끊긴 곳이 있음(내용 누락은 아님). 정확한 표현이 중요한 판정은 원본 PDF 해당 쪽을 확인할 것.

## 재생성 (매뉴얼 업데이트 시)

```bash
python3 -m venv .venv && .venv/bin/pip install pymupdf4llm   # 이미 설치돼 있으면 생략
bash tools/rulebook-convert/run.sh path/to/new-manual.pdf
```

새 버전은 쪽 번호가 바뀔 수 있으므로 `tools/rulebook-convert/convert.py`의 `SECTIONS` 쪽 범위와 `patches.py`의 보정 항목을 다시 확인해야 함.
