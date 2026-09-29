// 메인 화면 표시 규칙 (명세서 3.8 화면 구성, 09-6d): React 컴포넌트가 쓰는 순수 계산. DOM / React 비의존
import type { AppStatus } from '../app/appController';
import type { GamepadSlotStatus } from '../input/browserInput';
import { formatMatchTime } from './units';

// ------------------------------------------------------------
// 화면 비례 단위 (명세서 3.8 기본 원칙): --u = min(창 폭 / 1366, 창 높이 / 650), 1u = 기준 화면에서 1 px.
// 기준(1366 × 650 가용 영역)보다 작으면 더 줄이지 않고 스크롤 (1u = 1 px 유지). 식은 MainScreen.css, 수치는 아래 상수를
// MainScreen이 CSS 변수(--design-w / --design-h / --left-panel / --rail / --scrubber / --gap-u)로 넘긴다.
// ------------------------------------------------------------
export const DESIGN_WIDTH_PX = 1366;
export const DESIGN_HEIGHT_PX = 650;

// 레이아웃 치수 (u 단위, 명세서 3.8: 좌측 패널 ≈ 260u, 접힌 config 띠 ≈ 72u, 스크러버 줄 ≈ 56u)
export const LAYOUT_U = {
  leftPanel: 260,
  rail: 72,
  scrubber: 56,
  gap: 12,
} as const;

/** 메인 화면 루트의 CSS 변수 (MainScreen.css의 --u 식 / 그리드 치수가 이 값을 쓴다) */
export function layoutCssVars(): Record<string, string> {
  return {
    '--design-w': String(DESIGN_WIDTH_PX),
    '--design-h': String(DESIGN_HEIGHT_PX),
    '--left-panel': String(LAYOUT_U.leftPanel),
    '--rail': String(LAYOUT_U.rail),
    '--scrubber': String(LAYOUT_U.scrubber),
    '--gap-u': String(LAYOUT_U.gap),
  };
}

// ------------------------------------------------------------
// 필드 캔버스 크기 / 버퍼 배율: 필드 영역(w × h CSS px)에 맞는 정사각형, 버퍼 = CSS px × devicePixelRatio,
// 렌더 배율 = 버퍼 px / 논리 800 px (4K에서도 선명)
// ------------------------------------------------------------
export const FIELD_LOGICAL_PX = 800;

export function fieldCanvasSize(areaWidth: number, areaHeight: number, devicePixelRatio: number): { cssPx: number; bufferPx: number; scale: number } {
  const cssPx = Math.max(1, Math.floor(Math.min(areaWidth, areaHeight)));
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const bufferPx = Math.max(1, Math.round(cssPx * dpr));
  return { cssPx, bufferPx, scale: bufferPx / FIELD_LOGICAL_PX };
}

// ------------------------------------------------------------
// 좌측 패널
// ------------------------------------------------------------

export const POLLINATOR_1_TIPS = 4;
export const POLLINATOR_2_TIPS = 7;

/** TIP 표시: {오토 + 텔레옵} / {다음 RP 목표} — 4(POLLINATOR 1) → 달성 후 7(POLLINATOR 2) → 7 달성 후 n / 7 + 달성 */
export function tipDisplay(autoTips: number, teleopTips: number): { count: number; target: number; allDone: boolean } {
  const count = Math.max(0, autoTips) + Math.max(0, teleopTips);
  return { count, target: count < POLLINATOR_1_TIPS ? POLLINATOR_1_TIPS : POLLINATOR_2_TIPS, allDone: count >= POLLINATOR_2_TIPS };
}

/** 로봇 표시 이름: 팀 번호가 있으면 #번호, 없으면 R1 / R2 (09-6d 확정) */
export function robotLabel(robotId: 'robot1' | 'robot2', teamNumber?: string | null): string {
  const team = teamNumber?.trim();
  return team ? `#${team}` : robotId === 'robot1' ? 'R1' : 'R2';
}

export function formatPercent(probability: number): string {
  const p = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  return `${Math.round(p * 100)}%`;
}

/** 타이머 ENDGAME 색: 경기가 시작된 뒤(회전 / 진행 / 종료)에만 */
export function timerIsEndgame(status: Pick<AppStatus, 'phase' | 'remainingSec'>, endgameSec = 60): boolean {
  return status.phase !== 'SETUP' && status.remainingSec <= endgameSec;
}

// ------------------------------------------------------------
// 스크러버 줄 주 버튼 (명세서 3.8 스크러버 줄, 09-7a): 상태에 따라 하나
//   경기 전 START / 회전 중 START 비활성 / 진행 중 PAUSE / 보는 틱 < 머리 BRANCH / 보는 틱 = 머리 + 미종료 RESUME
//   재생 중에도 보는 틱 기준으로 RESUME / BRANCH (누르면 재생을 멈추고 그 동작). 종료 강조 / 결과 팝업 중과 종료 틱에서는 비활성
// ------------------------------------------------------------

export type MainButton = { kind: 'START' | 'PAUSE' | 'RESUME' | 'BRANCH'; enabled: boolean };

export function mainButton(
  status: Pick<AppStatus, 'phase' | 'loopState' | 'canResume' | 'canBranch' | 'tick' | 'headTick' | 'matchEnded'>,
): MainButton {
  if (status.phase === 'SETUP') return { kind: 'START', enabled: true };
  if (status.phase !== 'MATCH') return { kind: 'START', enabled: false }; // 회전 애니메이션 중
  if (status.loopState === 'RUNNING') return { kind: 'PAUSE', enabled: true };
  if (status.canBranch) return { kind: 'BRANCH', enabled: true };
  if (status.canResume) return { kind: 'RESUME', enabled: true };
  // 비활성: 되감은 틱이지만 종료 강조 / 결과 팝업 중 → BRANCH, 종료된 경기의 마지막 틱 → BRANCH(되감아야 가능), 그 외 RESUME
  return { kind: status.tick < status.headTick || status.matchEnded ? 'BRANCH' : 'RESUME', enabled: false };
}

/** 분기 확인창 문구 값: 보는 틱의 경기 시계, 삭제될 기록 길이 (초, 소수 1자리) */
export function branchConfirmParams(viewTick: number, headTick: number, matchTicks: number, dt: number): { time: string; seconds: string } {
  return { time: formatMatchTime(Math.max(0, (matchTicks - viewTick) * dt)), seconds: (Math.max(0, headTick - viewTick) * dt).toFixed(1) };
}

// ------------------------------------------------------------
// 스크러버 줄 타임라인 막대 (09-6d: 표시만 — 끌어서 이동은 09-7)
// ------------------------------------------------------------

/** 0 ~ 6000틱에서 현재 틱 위치 비율 [0, 1] */
export function timelineFraction(tick: number, matchTicks: number): number {
  if (!(matchTicks > 0) || !Number.isFinite(tick)) return 0;
  return Math.min(1, Math.max(0, tick / matchTicks));
}

/** 타임라인 눈금: 10초마다 (0, 500, …, 6000틱), ENDGAME 시작(남은 60초) 눈금은 major */
export function timelineMarks(matchTicks: number, ticksPerSecond: number, endgameSec = 60): { fraction: number; major: boolean }[] {
  const step = 10 * ticksPerSecond;
  const endgameTick = matchTicks - endgameSec * ticksPerSecond;
  const marks: { fraction: number; major: boolean }[] = [];
  for (let tick = 0; tick <= matchTicks; tick += step) marks.push({ fraction: tick / matchTicks, major: tick === endgameTick });
  return marks;
}

// ------------------------------------------------------------
// 접힌 config 아이콘 띠: 게임패드 요약 (연결 수, 비표준 매핑 경고)
// ------------------------------------------------------------

export function gamepadSummary(gamepads: readonly Pick<GamepadSlotStatus, 'connected' | 'standard'>[]): { connected: number; nonStandard: boolean } {
  const connected = gamepads.filter(g => g.connected);
  return { connected: connected.length, nonStandard: connected.some(g => !g.standard) };
}
