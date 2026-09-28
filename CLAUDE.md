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

## 빌드 및 검증 커맨드
- 개발 서버: `npm run dev`
- 타입 체크: `npx tsc -b`
  - (주의) 루트 `tsconfig.json`은 `files: []` + `references` 구조라 `npx tsc --noEmit`을 루트에서 실행하면 검사 대상이 없어 항상 통과함. 반드시 `tsc -b`(또는 `npx tsc --noEmit -p tsconfig.app.json`)로 검사할 것.
- 빌드: `npm run build`
- 테스트: `npm test` (Vitest, `src/core/__tests__/`의 엔진 통합 회귀 테스트 + 탄도 계산 / 몬테카를로 LUT 단위 테스트, `src/input/__tests__/`의 입력 계층 테스트, `src/renderer/__tests__/`의 렌더러 순수 계산 테스트, `src/dev/__tests__/`의 개발 하네스 흐름 테스트, 약 50~80초)
  - 엔진 규칙을 바꾸면 관련 테스트도 함께 갱신하고, 새 규칙에는 테스트 그룹을 추가할 것.