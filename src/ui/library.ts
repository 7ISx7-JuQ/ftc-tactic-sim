// 브라우저 안 목록 화면 규칙 (명세서 3.8 시나리오 탭 저장된 시나리오, 3.9 브라우저 안 목록, 19-2): React / DOM 비의존 순수 함수
// - 항목 = 파일 대신 이름 붙여 두는 칸: 저장 = 프리셋 EXPORT(적용 값, buildPresetFile), 불러오기 = 프리셋 IMPORT(초안, parsePresetFile).
// - 이름: 앞뒤 공백을 지우고 1 ~ LIBRARY_NAME_MAX자. 같은 종류 안에서 이름(대소문자 무시)이 같으면 같은 항목으로 보고 덮어쓸지 묻는다.
// - 목록: 최근 저장 순, 종류마다 최대 libraryMaxItems개 (경기는 항목이 커서 LIBRARY_MATCH_MAX_ITEMS, 19-2b).

import type { LibraryItem, LibraryKind } from '../app/libraryStore';
import type { DraftValues } from './configDraft';
import { t } from './i18n';
import type { Language } from './i18n';
import { parsePresetFile } from './presetFile';
import { readScenario } from './scenarioForm';
import { formatLocalDateTime } from './units';

export const LIBRARY_NAME_MAX = 40;
export const LIBRARY_MAX_ITEMS = 50;
export const LIBRARY_MATCH_MAX_ITEMS = 20;

/** 종류별 최대 개수 (경기 항목은 하나가 수 MB) */
export const libraryMaxItems = (kind: LibraryKind): number => (kind === 'MATCH' ? LIBRARY_MATCH_MAX_ITEMS : LIBRARY_MAX_ITEMS);

/** 이름 정리: 앞뒤 공백 제거, 비었거나 너무 길면 null */
export function libraryName(text: string): string | null {
  const name = text.trim();
  return name.length >= 1 && name.length <= LIBRARY_NAME_MAX ? name : null;
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** 이름이 같은 항목 (except = 이름을 바꾸는 그 항목은 빼고) */
export function findByName(items: readonly LibraryItem[], name: string, except: string | null = null): LibraryItem | null {
  return items.find(i => i.id !== except && sameName(i.name, name)) ?? null;
}

/** 저장할 때: 새 항목 / 같은 이름 덮어쓰기(확인) / 목록이 가득 참 */
export function saveDecision(items: readonly LibraryItem[], name: string, max = LIBRARY_MAX_ITEMS): { kind: 'NEW' } | { kind: 'OVERWRITE'; item: LibraryItem } | { kind: 'FULL' } {
  const same = findByName(items, name);
  if (same) return { kind: 'OVERWRITE', item: same };
  return items.length >= max ? { kind: 'FULL' } : { kind: 'NEW' };
}

/** 최근 저장 순 (같으면 이름 순) */
export function sortLibrary(items: readonly LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/** 항목 설명 두 줄 (첫째 줄 = 종류별 요약, 둘째 줄 = "저장 YYYY-MM-DD HH:mm"), 읽을 수 없으면 null */
export interface LibrarySummary {
  text: string;
  saved: string;
}

const savedLine = (lang: Language, item: LibraryItem) => t(lang, 'library.savedAt', { time: formatLocalDateTime(new Date(item.savedAt)) });

/** 팀 표시: "#번호 이름", 둘 다 비었으면 "팀 없음" */
export function libraryTeamText(lang: Language, { teamNumber, teamName }: { teamNumber: string; teamName: string }): string {
  return [teamNumber.trim() && `#${teamNumber.trim()}`, teamName.trim()].filter(Boolean).join(' ') || t(lang, 'library.noTeam');
}

/** 시나리오: "{진영} · 오토 TIP n · 시드 s" */
export function scenarioItemSummary(lang: Language, item: LibraryItem, defaults: DraftValues): LibrarySummary | null {
  const parsed = parsePresetFile(item.text, 'scenario', defaults);
  const scenario = parsed.ok ? parsed.preset.values.scenario : undefined;
  if (!scenario) return null;
  const view = readScenario(scenario, defaults.robot1.config, defaults.robot2.config);
  return { text: t(lang, 'library.scenarioSummary', { color: scenario.allianceColor, tips: view.autoTipCount, seed: view.seed }), saved: savedLine(lang, item) };
}

/** 로봇 (19-2b): "{팀} · 슈터 {구성}" */
export function robotItemSummary(lang: Language, item: LibraryItem, defaults: DraftValues): LibrarySummary | null {
  const parsed = parsePresetFile(item.text, 'robot1', defaults);
  const robot = parsed.ok ? parsed.preset.values.robot1 : undefined;
  if (!robot) return null;
  return {
    text: t(lang, 'library.robotSummary', { team: libraryTeamText(lang, robot), setup: t(lang, `robot.setup.${robot.config.shooterSetup}`) }),
    saved: savedLine(lang, item),
  };
}

/** 전체 설정 (19-2b): "R1 {팀} · R2 {팀} · {진영}" */
export function setupItemSummary(lang: Language, item: LibraryItem, defaults: DraftValues): LibrarySummary | null {
  const parsed = parsePresetFile(item.text, 'all', defaults);
  const { robot1, robot2, scenario } = parsed.ok ? parsed.preset.values : {};
  if (!robot1 || !robot2 || !scenario) return null;
  return {
    text: t(lang, 'library.setupSummary', { r1: libraryTeamText(lang, robot1), r2: libraryTeamText(lang, robot2), color: scenario.allianceColor }),
    saved: savedLine(lang, item),
  };
}
