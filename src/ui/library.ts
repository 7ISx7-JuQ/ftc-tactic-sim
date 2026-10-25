// 브라우저 안 목록 화면 규칙 (명세서 3.8 시나리오 탭 저장된 시나리오, 3.9 브라우저 안 목록, 19-2): React / DOM 비의존 순수 함수
// - 항목 = 파일 대신 이름 붙여 두는 칸: 저장 = 프리셋 EXPORT(적용 값, buildPresetFile), 불러오기 = 프리셋 IMPORT(초안, parsePresetFile).
// - 이름: 앞뒤 공백을 지우고 1 ~ LIBRARY_NAME_MAX자. 같은 종류 안에서 이름(대소문자 무시)이 같으면 같은 항목으로 보고 덮어쓸지 묻는다.
// - 목록: 최근 저장 순, 종류마다 최대 LIBRARY_MAX_ITEMS개.

import type { LibraryItem } from '../app/libraryStore';
import type { DraftValues } from './configDraft';
import { t } from './i18n';
import type { Language } from './i18n';
import { parsePresetFile } from './presetFile';
import { readScenario } from './scenarioForm';
import { formatLocalDateTime } from './units';

export const LIBRARY_NAME_MAX = 40;
export const LIBRARY_MAX_ITEMS = 50;

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
export function saveDecision(items: readonly LibraryItem[], name: string): { kind: 'NEW' } | { kind: 'OVERWRITE'; item: LibraryItem } | { kind: 'FULL' } {
  const same = findByName(items, name);
  if (same) return { kind: 'OVERWRITE', item: same };
  return items.length >= LIBRARY_MAX_ITEMS ? { kind: 'FULL' } : { kind: 'NEW' };
}

/** 최근 저장 순 (같으면 이름 순) */
export function sortLibrary(items: readonly LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/** 시나리오 항목 한 줄 설명: "{진영} · 오토 TIP n · 시드 s · 저장 YYYY-MM-DD HH:mm", 읽을 수 없으면 null */
export function scenarioItemSummary(lang: Language, item: LibraryItem, defaults: DraftValues): string | null {
  const parsed = parsePresetFile(item.text, 'scenario', defaults);
  const scenario = parsed.ok ? parsed.preset.values.scenario : undefined;
  if (!scenario) return null;
  const view = readScenario(scenario, defaults.robot1.config, defaults.robot2.config);
  return t(lang, 'library.scenarioSummary', {
    color: scenario.allianceColor,
    tips: view.autoTipCount,
    seed: view.seed,
    time: formatLocalDateTime(new Date(item.savedAt)),
  });
}
