# FTC TacticSim 개발 가이드

## 프로젝트 개요
- FTC BioBuzz 텔레옵(120초) 2D 전술 시뮬레이터 (2v0).
- 상세 게임 룰, 필드 제원 및 아키텍처 원칙은 루트의 `FTC TacticSim Specification.md`를 절대 기준으로 따른다.

## 핵심 개발 원칙
1. 상태 연산과 렌더링 분리:
   - 시뮬레이션 상태(50Hz 고정 틱, dt = 0.02)와 캔버스 렌더링은 React State 바깥 순수 TS 엔진으로 구동.
   - React는 컨트롤 UI, 스크러버, 스코어보드 표시에만 관여.
2. 100% 결정론적(Deterministic) 모델:
   - 모든 틱의 상태는 `TimelineFrame` 배열에 기록되어 앞뒤 탐색(Scrubbing) 가능.
3. 단계별 미세 구현:
   - 한 번에 여러 모듈을 만들지 않고, 사용자가 지시한 '작은 단위(Step)'만 정확히 구현.
   - 지시받지 않은 다른 파일의 로직을 임의로 앞서 구현하지 말 것.

## Git 브랜치
- 작업 브랜치는 `claude` 하나뿐이다. `claude` 위에 커밋을 선형으로 쌓고 `git push origin claude`로 올린다.
- 세션이 자동으로 지정하는 작업 브랜치 이름(예: `claude/…`)은 무시하고 만들지 않는다. `claude` 브랜치와 이름 경로가 겹쳐(`refs/heads/claude` 파일 vs `claude/` 폴더) push가 거부된다.

## 빌드 및 검증 커맨드
- 개발 서버: `npm run dev`
- 타입 체크: `npx tsc -b`
  - (주의) 루트 `tsconfig.json`은 `files: []` + `references` 구조라 `npx tsc --noEmit`을 루트에서 실행하면 검사 대상이 없어 항상 통과함. 반드시 `tsc -b`(또는 `npx tsc --noEmit -p tsconfig.app.json`)로 검사할 것.
- 빌드: `npm run build`
- 테스트: `npm test` (Vitest `unit` 프로젝트, Node, `src/core/__tests__/`의 엔진 통합 회귀 테스트 + 탄도 계산 / 몬테카를로 LUT 단위 테스트 + 엔진 결과 버전 기대값 / 가지 타임라인 테스트, `src/input/__tests__/`의 입력 계층 테스트(적용 입력 기록 / 실시간 루프 보간 비율 포함), `src/renderer/__tests__/`의 렌더러 순수 계산 테스트(히트맵 색 척도 / 진영 기준 픽셀 / 시작 자세 편집 기하 / 터널 지붕 불투명도 / 로봇 동선 / 프레임 보간 포함), `src/app/__tests__/`의 앱 컨트롤러 흐름 / 입력 출처 규칙 / 경기 자동 저장 예약 / 경기 설정(탄도 · LUT 판정 연결) / LUT 생성 연결 / 저장 레시피 / 분기 트리 규칙 테스트, `src/workers/__tests__/`의 LUT 생성 관리자 / 캐시 테스트(가짜 Worker, 메모리 저장소), `src/ui/__tests__/`의 문구 사전 / 단위 변환 / 메인 화면 표시 규칙 / config 초안 · 적용 규칙 / 설정 자동 보관 / 로봇 폼 규칙 / 명중 확률표 상태 표시 / 필드 편집 모드 규칙 / 시나리오 탭 폼 규칙 / 결과 팝업 표시 규칙 / 프리셋 파일 규칙 / 경기 파일 화면 규칙 / 분기 트리 화면 규칙 / 게임패드 버튼 매핑 / 도움말 · 버그 리포트 테스트, 약 50~80초)
  - 엔진 규칙을 바꾸면 관련 테스트도 함께 갱신하고, 새 규칙에는 테스트 그룹을 추가할 것.
  - 같은 입력에 대한 프레임 결과가 바뀌는 커밋(엔진 규칙 / 충돌 · 동역학 상수 / 시나리오 초기화 / 난수 사용 순서 / 프레임 형식)은 `simulationEngine.ts`의 `ENGINE_VERSION`을 올리고 `src/core/__tests__/engineVersion.test.ts`의 기대값을 갱신할 것 (저장 레시피 호환, 명세서 3.9).
    - 예외 (배포는 출시 때만 하므로 출시 전 중간 결과로 만든 파일이 없음): 한 릴리스의 개발 중에는 결과가 처음 바뀌는 커밋에서만 `ENGINE_VERSION`을 올리고(v2.0.0은 1 → 2, Step 12-1), 같은 릴리스의 이후 커밋은 `engineVersion.test.ts` 기대값만 갱신한다 (명세서 5.2 v2.0.0 구현 순서).
- 브라우저 테스트: `npm run test:browser` (Vitest 브라우저 모드 `browser` 프로젝트, 실제 headless Chromium, `*.browser.test.{ts,tsx}` — 메인 화면 상호작용 흐름 + 실제 LUT Worker / IndexedDB 캐시 + 경기 자동 저장 IndexedDB + 터널 지붕 · 로봇 동선 합성 픽셀, 약 10초). 처음 한 번 `npx playwright install chromium` 필요(브라우저가 미리 설치된 환경은 생략). 둘 다: `npm run test:all`
  - 화면 기능을 바꾸거나 더하면 `src/components/__tests__/mainScreen.browser.test.tsx`의 흐름 테스트도 함께 갱신 / 추가할 것 (명세서 3.7 테스트).