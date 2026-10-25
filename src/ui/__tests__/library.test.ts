// 브라우저 안 목록 (명세서 3.8 저장된 시나리오 / 로봇 / 전체 설정, 3.9 브라우저 안 목록, 19-2a · 19-2b)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { createMemoryLibrary, newLibraryId } from '../../app/libraryStore';
import type { LibraryItem } from '../../app/libraryStore';
import {
  LIBRARY_MATCH_MAX_ITEMS,
  LIBRARY_MAX_ITEMS,
  LIBRARY_NAME_MAX,
  findByName,
  libraryMaxItems,
  libraryName,
  libraryTeamText,
  robotItemSummary,
  saveDecision,
  scenarioItemSummary,
  setupItemSummary,
  sortLibrary,
} from '../library';
import { buildPresetFile, parsePresetFile } from '../presetFile';
import { formatLocalDateTime } from '../units';

const V = DEFAULT_DRAFT_VALUES;
const item = (id: string, name: string, savedAt: number, text = buildPresetFile('scenario', V)): LibraryItem => ({ id, kind: 'SCENARIO', name, savedAt, text });

describe('브라우저 안 목록 (19-2a)', () => {
  it('A. 이름: 앞뒤 공백 제거, 1 ~ 40자, 같은 이름은 대소문자 무시 (이름 바꾸기는 자기 자신 제외)', () => {
    expect(libraryName('  Auto A  ')).toBe('Auto A');
    expect(libraryName('   ')).toBeNull();
    expect(libraryName('x'.repeat(LIBRARY_NAME_MAX))).not.toBeNull();
    expect(libraryName('x'.repeat(LIBRARY_NAME_MAX + 1))).toBeNull();
    const items = [item('a', 'Auto A', 1), item('b', '오토 B', 2)];
    expect(findByName(items, 'auto a')?.id).toBe('a');
    expect(findByName(items, '오토 B')?.id).toBe('b');
    expect(findByName(items, 'Auto A', 'a')).toBeNull(); // 자기 이름 그대로 바꾸기
    expect(findByName(items, 'Auto C')).toBeNull();
  });

  it('B. 저장 판단: 새 항목 / 같은 이름 = 덮어쓰기(확인) / 종류마다 최대 50개, 목록은 최근 저장 순', () => {
    const items = [item('a', 'Auto A', 10), item('b', 'Auto B', 30), item('c', 'Auto C', 30)];
    expect(saveDecision(items, 'Auto D')).toEqual({ kind: 'NEW' });
    expect(saveDecision(items, 'AUTO B')).toEqual({ kind: 'OVERWRITE', item: items[1] });
    const full = Array.from({ length: LIBRARY_MAX_ITEMS }, (_, i) => item(`i${i}`, `n${i}`, i));
    expect(saveDecision(full, 'new')).toEqual({ kind: 'FULL' });
    expect(saveDecision(full, 'n3').kind).toBe('OVERWRITE'); // 가득 차도 덮어쓰기는 됨
    expect(sortLibrary(items).map(i => i.id)).toEqual(['b', 'c', 'a']);
    // 종류별 최대 개수 (19-2b): 경기만 20개
    expect(LIBRARY_MAX_ITEMS).toBe(50);
    expect(LIBRARY_MATCH_MAX_ITEMS).toBe(20);
    expect(['SCENARIO', 'ROBOT', 'SETUP', 'MATCH'].map(k => libraryMaxItems(k as LibraryItem['kind']))).toEqual([50, 50, 50, 20]);
    expect(saveDecision(full.slice(0, 20), 'new', LIBRARY_MATCH_MAX_ITEMS)).toEqual({ kind: 'FULL' });
    expect(saveDecision(full.slice(0, 19), 'new', LIBRARY_MATCH_MAX_ITEMS)).toEqual({ kind: 'NEW' });
  });

  it('C. 설명 두 줄: 진영 · 오토 TIP · 시드 / 저장 시각, 읽을 수 없는 항목은 null / 항목 글자 = 시나리오 프리셋 파일 (시드 포함)', () => {
    const applied = { ...V, scenario: { allianceColor: 'BLUE' as const, autoTipCount: 2, rngSeed: 4242 } };
    const text = buildPresetFile('scenario', applied);
    const saved = new Date(2026, 9, 24, 14, 5).getTime();
    expect(scenarioItemSummary('en', item('x', 'Auto B', saved, text), V)).toEqual({ text: 'BLUE · auto TIP 2 · seed 4242', saved: 'saved 2026-10-24 14:05' });
    expect(scenarioItemSummary('ko', item('x', 'Auto B', saved, text), V)).toEqual({ text: 'BLUE · 오토 TIP 2 · 시드 4242', saved: '저장 2026-10-24 14:05' });
    const parsed = parsePresetFile(text, 'scenario', V);
    expect(parsed.ok && parsed.preset.values.scenario).toEqual(applied.scenario);
    expect(scenarioItemSummary('en', item('y', 'bad', saved, '{nope'), V)).toBeNull();
    expect(scenarioItemSummary('en', item('z', 'robot', saved, buildPresetFile('robot1', V)), V)).toBeNull(); // 종류가 다른 글자
    expect(formatLocalDateTime(new Date(Number.NaN))).toBe('—');
  });

  it('C2. 로봇 / 전체 설정 설명 (19-2b): 팀(없으면 "팀 없음") · 슈터 구성 / R1 · R2 · 진영, 종류가 다른 글자는 null', () => {
    const saved = new Date(2026, 9, 25, 9, 30).getTime();
    const robot = { ...V.robot1, teamNumber: ' 12345 ', teamName: 'Bumblebots', config: { ...V.robot1.config, shooterSetup: 'PER_PIECE' as const } };
    const applied = { ...V, robot2: robot, scenario: { ...V.scenario, allianceColor: 'BLUE' as const } };
    const robotItem = (text: string): LibraryItem => ({ id: 'r', kind: 'ROBOT', name: 'Worlds', savedAt: saved, text });
    // R2에서 저장한 로봇도 같은 목록 (슬롯 id 없음)
    expect(robotItemSummary('en', robotItem(buildPresetFile('robot2', applied)), V)).toEqual({ text: '#12345 Bumblebots · shooter: Per piece', saved: 'saved 2026-10-25 09:30' });
    expect(robotItemSummary('ko', robotItem(buildPresetFile('robot1', applied)), V)?.text).toBe(`${libraryTeamText('ko', V.robot1)} · 슈터 공용 1개`);
    expect(libraryTeamText('en', { teamNumber: ' ', teamName: '' })).toBe('no team');
    expect(libraryTeamText('ko', { teamNumber: '', teamName: '' })).toBe('팀 없음');
    expect(libraryTeamText('en', { teamNumber: '', teamName: 'Hive Mind' })).toBe('Hive Mind');
    expect(robotItemSummary('en', robotItem(buildPresetFile('scenario', V)), V)).toBeNull();
    const setupItem: LibraryItem = { id: 's', kind: 'SETUP', name: 'Practice', savedAt: saved, text: buildPresetFile('all', applied) };
    expect(setupItemSummary('en', setupItem, V)).toEqual({ text: `R1 ${libraryTeamText('en', V.robot1)} · R2 #12345 Bumblebots · BLUE`, saved: 'saved 2026-10-25 09:30' });
    expect(setupItemSummary('en', { ...setupItem, text: buildPresetFile('robot1', V) }, V)).toBeNull();
    expect(setupItemSummary('en', { ...setupItem, text: '{' }, V)).toBeNull();
  });

  it('D. 메모리 저장소: 종류별 목록, 같은 id = 바꾸기, 삭제, id는 매번 다름', async () => {
    const store = createMemoryLibrary([{ ...item('r', 'robot', 1), kind: 'ROBOT' }]);
    expect(await store.list('SCENARIO')).toEqual([]);
    expect(await store.put(item('a', 'Auto A', 1))).toBe(true);
    await store.put(item('a', 'Auto A2', 2));
    expect((await store.list('SCENARIO')).map(i => i.name)).toEqual(['Auto A2']);
    expect(await store.list('ROBOT')).toHaveLength(1);
    await store.delete('a');
    expect(await store.list('SCENARIO')).toEqual([]);
    expect(new Set(Array.from({ length: 20 }, newLibraryId)).size).toBe(20);
  });
});
