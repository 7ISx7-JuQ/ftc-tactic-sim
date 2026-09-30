// 경기 파일 화면 규칙 (명세서 3.9 경기 불러오기 / 경기 내보내기, 10-4): React / DOM 비의존 순수 함수
// - 불러오기: 거부 사유 문구, 확인창(설정 교체 안내 + 버전 / LUT 설정 경고 줄), 준비 진행(두 로봇 명중 확률표), 체크섬 불일치 배너.
// - 내보내기: 경기 / 요약 파일 이름(원본이 아닌 가지는 _b{번호}, 10-6), 요약 텍스트(결과 팝업과 같은 규칙 resultRows / rpCards / resultBasisText, 현재 화면 언어).

import type { MatchResult } from '../app/appController';
import type { RecipeError, RecipeWarning } from '../app/matchRecipe';
import { BALLISTICS_MODEL_VERSION } from '../core/ballistics';
import type { CheckpointComparison } from '../core/checksum';
import { DT, ENGINE_VERSION, MATCH_TICKS } from '../core/simulationEngine';
import type { RobotId } from '../input/inputConfig';
import { t } from './i18n';
import type { Language, MessageKey } from './i18n';
import type { RobotLutView } from './lutView';
import { robotLabel } from './mainScreenModel';
import { fileTimestamp, safeFileName } from './presetFile';
import { resultBasisText, resultRows, rpCards } from './resultModel';
import { formatMatchTime } from './units';

const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const SHORT: Readonly<Record<RobotId, string>> = { robot1: 'R1', robot2: 'R2' };

// ============================================================
// 1. 불러오기
// ============================================================

/** 파일을 읽기 전에 난 오류 (파일 선택 도우미) 또는 레시피 거부 */
export type MatchImportError = RecipeError | { code: 'TOO_LARGE' | 'READ_FAILED' };

/** 거부 사유 문구 (MATCH 줄 아래 빨간 글자) */
export function matchImportErrorMessage(lang: Language, error: MatchImportError): string {
  switch (error.code) {
    case 'TOO_LARGE':
    case 'READ_FAILED':
    case 'NOT_JSON':
      return t(lang, `preset.error.${error.code}`);
    case 'RECIPE_VERSION':
      return t(lang, 'matchImport.error.RECIPE_VERSION', { version: error.version ?? '?' });
    case 'INVALID_FIELD':
    case 'INVALID_INPUTS':
      return t(lang, `matchImport.error.${error.code}`, { field: error.field ?? '?' });
    case 'INVALID_SETUP':
      return t(lang, 'matchImport.error.INVALID_SETUP', { issues: (error.issues ?? []).join(', ') });
    default:
      return t(lang, `matchImport.error.${error.code}` as MessageKey);
  }
}

/** 확인창 문구: 설정 교체 안내 + 해당될 때만 경고 줄 (줄바꿈으로 구분) */
export function matchImportConfirmMessage(lang: Language, warnings: readonly RecipeWarning[]): string {
  const lines = [t(lang, 'confirm.importMatch')];
  for (const w of warnings) {
    lines.push(w.code === 'LUT_SETTINGS' ? `⚠ ${t(lang, 'matchImport.warn.LUT_SETTINGS')}` : `⚠ ${t(lang, `matchImport.warn.${w.code}`, { file: w.file, current: w.current })}`);
  }
  return lines.join('\n');
}

/** 준비 진행: 두 로봇 명중 확률표 진행률 평균 (READY = 100%), 오류가 있으면 error */
export function matchImportProgress(views: Readonly<Record<RobotId, RobotLutView>>): { percent: number; error: boolean } {
  const done = (v: RobotLutView) => (v.phase === 'READY' ? 1 : Math.max(0, Math.min(1, v.progress)));
  const percent = Math.floor(((done(views.robot1) + done(views.robot2)) / 2) * 100);
  return { percent, error: ROBOTS.some(r => views[r].phase === 'ERROR') };
}

/** 체크섬 불일치 배너: 제목 + 처음 달라진 구간(경기 타이머 표시) + 버전이 달랐으면 그 사유. 일치하면 null */
export function mismatchBanner(lang: Language, comparison: CheckpointComparison, warnings: readonly RecipeWarning[]): { title: string; hint: string } | null {
  if (comparison.match) return null;
  const clock = (tick: number) => formatMatchTime((MATCH_TICKS - tick) * DT);
  let hint =
    comparison.lastMatchTick === null
      ? t(lang, 'matchImport.mismatchStart')
      : t(lang, 'matchImport.mismatchFrom', { from: clock(comparison.lastMatchTick), to: clock(comparison.firstMismatchTick) });
  if (warnings.some(w => w.code !== 'LUT_SETTINGS')) hint += t(lang, 'matchImport.mismatchVersion');
  return { title: t(lang, 'matchImport.mismatch'), hint };
}

// ============================================================
// 2. 내보내기
// ============================================================

/** 파일 이름 뒷부분: {YYYYMMDD-HHmm}_{진영}_{총점}pts, 원본이 아닌 가지는 _b{번호} (10-6) */
const fileStem = (date: Date, alliance: 'RED' | 'BLUE', total: number, branchNumber: number | null) =>
  `${fileTimestamp(date)}_${alliance}_${total}pts${branchNumber !== null ? `_b${branchNumber}` : ''}`;

/** 경기 파일 이름: tacticsim-match_{YYYYMMDD-HHmm}_{진영}_{총점}pts[_b{번호}].json */
export function matchFileName(date: Date, alliance: 'RED' | 'BLUE', total: number, branchNumber: number | null = null): string {
  return safeFileName(`tacticsim-match_${fileStem(date, alliance, total, branchNumber)}.json`);
}

/** 요약 파일 이름: 경기 파일과 같은 이름의 tacticsim-summary_….txt */
export function summaryFileName(date: Date, alliance: 'RED' | 'BLUE', total: number, branchNumber: number | null = null): string {
  return safeFileName(`tacticsim-summary_${fileStem(date, alliance, total, branchNumber)}.txt`);
}

export interface SummaryInput {
  lang: Language;
  result: MatchResult;
  alliance: 'RED' | 'BLUE';
  teams: Readonly<Record<RobotId, { teamNumber: string; teamName: string }>>;
  branchName: string | null;
  date: Date;
  seed: number;
}

/** 요약 텍스트 (UTF-8, 줄바꿈 \n, 마지막 줄바꿈 포함) */
export function matchSummaryText(s: SummaryInput): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = s.date;
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const robots = ROBOTS.map(id => {
    const team = s.teams[id];
    const number = robotLabel(id, team.teamNumber);
    return [SHORT[id], number !== SHORT[id] ? number : '', team.teamName.trim()].filter(Boolean).join(' ');
  }).join(' · ');
  const lines = [
    `${t(s.lang, 'app.name')} · ${t(s.lang, 'result.title')}`,
    [when, s.alliance, s.branchName].filter(Boolean).join(' · '),
    robots,
    `${t(s.lang, 'result.total')} ${s.result.total}`,
    ...resultRows(s.result).map(row => `${row.key.padEnd(7)}${String(row.points).padStart(3)}  ${resultBasisText(row, s.lang)}`),
    `${t(s.lang, 'result.rp')}  ${rpCards(s.result)
      .map(c => `${c.key}${c.achieved ? ' ✓' : ''} ${t(s.lang, 'result.rp.progress', { unit: c.unit, current: c.current, target: c.target })}`)
      .join(' · ')}`,
    t(s.lang, 'summary.footer', { seed: s.seed, engine: ENGINE_VERSION, ballistics: BALLISTICS_MODEL_VERSION }),
  ];
  return `${lines.join('\n')}\n`;
}
