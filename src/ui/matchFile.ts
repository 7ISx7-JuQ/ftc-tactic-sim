// 경기 파일 화면 규칙 (명세서 3.9 경기 불러오기 / 경기 내보내기, 10-4): React / DOM 비의존 순수 함수
// - 자동 저장 복구 확인창 (19-1, 지금 가지 / 저장 시각 / 가지 수 / 불러오기와 같은 경고 줄).
// - 불러오기: 거부 사유 문구, 확인창(설정 교체 안내 + 가지 수 + 버전 / LUT 설정 경고 줄), 준비 진행(두 로봇 명중 확률표 → 가지 단위 재계산, 15-3),
//   체크섬 불일치 배너(처음 어긋난 가지 이름 + 구간, 15-3). 체크포인트(0 ~ 6000틱)가 같아도 판정 결과(0:00 뒤 정착 구간)가 다르면 같은 배너 (12-16).
// - 내보내기: 경기 파일 이름(지금 가지 상태 / _b{번호} / _{가지 수}br, 15-3), 요약 파일 이름, 요약 텍스트(결과 팝업과 같은 규칙, 현재 화면 언어).

import type { MatchResult } from '../app/appController';
import { MAX_BRANCHES } from '../app/branchTree';
import type { MatchRecipe, RecipeError, RecipeResult, RecipeWarning } from '../app/matchRecipe';
import { BALLISTICS_MODEL_VERSION } from '../core/ballistics';
import { compareCheckpoints } from '../core/checksum';
import type { CheckpointComparison } from '../core/checksum';
import { DT, ENGINE_VERSION, MATCH_TICKS } from '../core/simulationEngine';
import type { RobotId } from '../input/inputConfig';
import { t } from './i18n';
import type { Language, MessageKey } from './i18n';
import type { RobotLutView } from './lutView';
import { branchLabel } from './branchView';
import { robotLabel } from './mainScreenModel';
import { fileTimestamp, safeFileName } from './presetFile';
import { resultBasisText, resultRows, rpCardProgressText, rpCards } from './resultModel';
import { formatLocalDateTime, formatMatchTime } from './units';

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
    case 'TOO_MANY_BRANCHES':
      return t(lang, 'matchImport.error.TOO_MANY_BRANCHES', { count: error.count ?? '?', max: MAX_BRANCHES });
    default:
      return t(lang, `matchImport.error.${error.code}` as MessageKey);
  }
}

/** 확인창 문구: 설정 교체 안내 + 가지가 2개 이상이면 가지 수 줄(15-3) + 해당될 때만 경고 줄 (줄바꿈으로 구분) */
export function matchImportConfirmMessage(lang: Language, warnings: readonly RecipeWarning[], branchCount = 1): string {
  const lines = [t(lang, 'confirm.importMatch')];
  if (branchCount >= 2) lines.push(t(lang, 'matchImport.branches', { count: branchCount }));
  return [...lines, ...warningLines(lang, warnings)].join('\n');
}

/** 버전 / LUT 설정 경고 줄 (불러오기 확인창 · 자동 저장 복구 확인창 공용) */
function warningLines(lang: Language, warnings: readonly RecipeWarning[]): string[] {
  return warnings.map(w =>
    w.code === 'LUT_SETTINGS' ? `⚠ ${t(lang, 'matchImport.warn.LUT_SETTINGS')}` : `⚠ ${t(lang, `matchImport.warn.${w.code}`, { file: w.file, current: w.current })}`,
  );
}

/**
 * 자동 저장 복구 확인창 (19-1): "지난 경기를 복구할까요?" + "저장 {YYYY-MM-DD HH:mm} · {지금 가지 이름} {끝났으면 점수, 아니면 머리의 남은 시간}"
 * (+ 가지가 2개 이상이면 가지 수) + 불러오기와 같은 버전 경고 줄
 */
export function autosaveRestoreMessage(lang: Language, recipe: Pick<MatchRecipe, 'createdAt' | 'branches' | 'current'>, warnings: readonly RecipeWarning[]): string {
  const current = recipe.branches.find(b => b.number === recipe.current) ?? recipe.branches[0];
  const label = branchLabel(lang, { name: current.name, number: current.number, parentId: current.parent });
  const state =
    current.headTick >= MATCH_TICKS && current.result
      ? t(lang, 'autosave.ended', { score: current.result.totalScore })
      : formatMatchTime((MATCH_TICKS - current.headTick) * DT);
  const time = formatLocalDateTime(new Date(recipe.createdAt));
  const lines = [t(lang, 'autosave.confirm'), t(lang, 'autosave.detail', { time, branch: label, state })];
  if (recipe.branches.length >= 2) lines.push(t(lang, 'matchImport.branches', { count: recipe.branches.length }));
  return [...lines, ...warningLines(lang, warnings)].join('\n');
}

/** 준비 진행: 두 로봇 명중 확률표 진행률 평균 (READY = 100%), 오류가 있으면 error */
export function matchImportProgress(views: Readonly<Record<RobotId, RobotLutView>>): { percent: number; error: boolean } {
  const done = (v: RobotLutView) => (v.phase === 'READY' ? 1 : Math.max(0, Math.min(1, v.progress)));
  const percent = Math.floor(((done(views.robot1) + done(views.robot2)) / 2) * 100);
  return { percent, error: ROBOTS.some(r => views[r].phase === 'ERROR') };
}

/** 재계산 진행 문구 (15-3): 가지 단위 "재계산 n / m" — 가지가 하나면 지금처럼 "재계산 중" */
export function matchComputingText(lang: Language, done: number, total: number): string {
  return total >= 2 ? t(lang, 'matchImport.computingBranches', { done: Math.min(done + 1, total), total }) : t(lang, 'matchImport.computing');
}

/** 배너가 가리키는 가지 (15-3): 처음 어긋난 가지의 화면 이름 + 그 밖에 어긋난 가지 수 */
export interface MismatchBranch {
  label: string;
  others: number;
}

/**
 * 불러온 가지 비교 (12-16): 체크포인트(0 ~ 6000틱)를 먼저 보고, 같으면 판정 결과(총점 · RP)를 비교한다.
 * 정착 구간(0:00 뒤)은 입력 없이 다시 계산되어 체크포인트에 들어가지 않으므로, 그 구간만 어긋나면 결과로만 드러난다
 */
export type MatchComparison = CheckpointComparison | { match: false; settle: { file: number | null; now: number | null } };

export function compareLoadedBranch(
  file: { checksums: readonly string[]; result: RecipeResult | null },
  loaded: { checksums: readonly string[]; result: RecipeResult | null },
): MatchComparison {
  const checkpoints = compareCheckpoints(file.checksums, loaded.checksums);
  if (!checkpoints.match) return checkpoints;
  const a = file.result;
  const b = loaded.result;
  const same = a === null || b === null
    ? a === b
    : a.totalScore === b.totalScore && a.rp.swarm === b.rp.swarm && a.rp.pollinator1 === b.rp.pollinator1 && a.rp.pollinator2 === b.rp.pollinator2;
  return same ? checkpoints : { match: false, settle: { file: a?.totalScore ?? null, now: b?.totalScore ?? null } };
}

/**
 * 체크섬 불일치 배너: 제목 + (가지가 2개 이상인 트리면 처음 어긋난 가지 이름) 처음 달라진 구간(경기 타이머 표시)
 * 또는 정착 구간 판정 결과 차이(파일 점수 → 다시 계산한 점수, 12-16) + 그 밖에 어긋난 가지 수 + 버전이 달랐으면 그 사유. 일치하면 null
 */
export function mismatchBanner(
  lang: Language,
  comparison: MatchComparison,
  warnings: readonly RecipeWarning[],
  branch: MismatchBranch | null = null,
): { title: string; hint: string } | null {
  if (comparison.match) return null;
  const clock = (tick: number) => formatMatchTime((MATCH_TICKS - tick) * DT);
  const points = (n: number | null) => (n === null ? '–' : String(n));
  let hint =
    'settle' in comparison
      ? t(lang, 'matchImport.mismatchSettle', { file: points(comparison.settle.file), now: points(comparison.settle.now) })
      : comparison.lastMatchTick === null
        ? t(lang, 'matchImport.mismatchStart')
        : t(lang, 'matchImport.mismatchFrom', { from: clock(comparison.lastMatchTick), to: clock(comparison.firstMismatchTick) });
  if (branch) hint = `${branch.label} · ${hint}${branch.others > 0 ? t(lang, 'matchImport.mismatchOthers', { count: branch.others }) : ''}`;
  if (warnings.some(w => w.code !== 'LUT_SETTINGS')) hint += t(lang, 'matchImport.mismatchVersion');
  return { title: t(lang, 'matchImport.mismatch'), hint };
}

// ============================================================
// 2. 내보내기
// ============================================================

/** 파일 이름 뒷부분: {YYYYMMDD-HHmm}_{진영}_{총점}pts, 원본이 아닌 가지는 _b{번호} (10-6) */
const fileStem = (date: Date, alliance: 'RED' | 'BLUE', total: number, branchNumber: number | null) =>
  `${fileTimestamp(date)}_${alliance}_${total}pts${branchNumber !== null ? `_b${branchNumber}` : ''}`;

/** 경기 파일 이름의 지금 가지 상태 (15-3): 끝난 가지 = 총점, 미종료 = 머리 틱 (남은 시간 M-SS로 씀) */
export type MatchFileState = { total: number } | { headTick: number };

/**
 * 경기 파일 이름 (15-3, 트리 전체): tacticsim-match_{YYYYMMDD-HHmm}_{진영}_{지금 가지 상태}[_b{번호}][_{가지 수}br].json
 * 지금 가지 상태 = 끝났으면 {총점}pts, 아니면 머리의 남은 시간 {M-SS}. _b{번호} = 지금 가지가 원본이 아닐 때, _{가지 수}br = 가지가 2개 이상일 때
 */
export function matchFileName(date: Date, alliance: 'RED' | 'BLUE', state: MatchFileState, branchNumber: number | null = null, branchCount = 1): string {
  const head = 'total' in state ? `${state.total}pts` : formatMatchTime((MATCH_TICKS - state.headTick) * DT).replace(':', '-');
  const tail = `${branchNumber !== null ? `_b${branchNumber}` : ''}${branchCount >= 2 ? `_${branchCount}br` : ''}`;
  return safeFileName(`tacticsim-match_${fileTimestamp(date)}_${alliance}_${head}${tail}.json`);
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
      .map(c => `${c.key}${c.achieved ? ' ✓' : ''} ${rpCardProgressText(c, s.lang)}`)
      .join(' · ')}`,
    t(s.lang, 'summary.footer', { seed: s.seed, engine: ENGINE_VERSION, ballistics: BALLISTICS_MODEL_VERSION }),
  ];
  return `${lines.join('\n')}\n`;
}
