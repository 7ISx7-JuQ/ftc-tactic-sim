// 브라우저 안 목록 IndexedDB 저장소 (명세서 3.9 브라우저 안 목록, 19-2) — 실제 Chromium IndexedDB
import { describe, expect, it } from 'vitest';
import { LIBRARY_DB_NAME, createBrowserLibrary } from '../libraryStore';
import { AUTOSAVE_DB_NAME } from '../matchAutosave';
import { LUT_CACHE_DB_NAME } from '../../workers/lutCache';

describe('브라우저 안 목록 IndexedDB (19-2)', () => {
  it('종류별 목록 / 같은 id = 바꾸기 / 삭제 / 새 연결로 다시 읽기, 다른 DB와 따로, IndexedDB 없음 · 열기 실패 = 빈 목록', async () => {
    indexedDB.deleteDatabase(LIBRARY_DB_NAME);
    const store = createBrowserLibrary();
    expect(await store.list('SCENARIO')).toEqual([]);
    const a = { id: 'a', kind: 'SCENARIO' as const, name: 'Auto A', savedAt: 1, text: '{}' };
    expect(await store.put(a)).toBe(true);
    await store.put({ id: 'r', kind: 'ROBOT', name: 'R', savedAt: 2, text: '{}' });
    await store.put({ ...a, name: 'Auto A2', savedAt: 3 });
    const again = await createBrowserLibrary().list('SCENARIO');
    expect(again).toEqual([{ ...a, name: 'Auto A2', savedAt: 3 }]);
    expect((await store.list('ROBOT')).map(i => i.id)).toEqual(['r']);
    expect(await store.delete('a')).toBe(true);
    expect(await store.list('SCENARIO')).toEqual([]);
    expect(new Set([LIBRARY_DB_NAME, AUTOSAVE_DB_NAME, LUT_CACHE_DB_NAME]).size).toBe(3);
    const none = createBrowserLibrary(null);
    expect(await none.list('SCENARIO')).toEqual([]);
    expect(await none.put(a)).toBe(false);
    const broken = createBrowserLibrary({ open: () => { throw new Error('blocked'); } } as unknown as IDBFactory);
    expect(await broken.put(a)).toBe(false);
    expect(await broken.list('SCENARIO')).toEqual([]);
  });
});
