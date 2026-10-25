// 브라우저 안 목록 IndexedDB 저장소 (명세서 3.9 브라우저 안 목록, 19-2) — 실제 Chromium IndexedDB
import { describe, expect, it } from 'vitest';
import { LIBRARY_BODY_STORE, LIBRARY_DB_NAME, LIBRARY_STORE, createBrowserLibrary } from '../libraryStore';
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
    expect(await broken.body('a')).toBeNull();
  });

  it('경기 본문 (19-2b-2): 항목과 같은 id로 따로 저장, 이름 바꾸기(본문 없이 put)는 본문 유지, 삭제는 둘 다, 버전 1 DB는 항목을 지키고 본문 저장소만 더함', async () => {
    // 버전 1 DB (항목 저장소만, 19-2a)
    await new Promise<void>(resolve => {
      const del = indexedDB.deleteDatabase(LIBRARY_DB_NAME);
      del.onsuccess = del.onerror = () => resolve();
    });
    const old = { id: 'old', kind: 'SCENARIO' as const, name: 'Old', savedAt: 1, text: '{}' };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(LIBRARY_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(LIBRARY_STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
      req.onsuccess = () => {
        const tx = req.result.transaction(LIBRARY_STORE, 'readwrite');
        tx.objectStore(LIBRARY_STORE).put(old);
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    const store = createBrowserLibrary();
    expect(await store.list('SCENARIO')).toEqual([old]);
    const body = 'x'.repeat(2_000_000);
    const m = { id: 'm', kind: 'MATCH' as const, name: 'Match', savedAt: 5, text: '{"alliance":"RED"}' };
    expect(await store.put(m, body)).toBe(true);
    expect(await store.list('MATCH')).toEqual([m]); // 목록에는 본문 없음
    await store.put({ ...m, name: 'Renamed' });
    expect(await createBrowserLibrary().body('m')).toBe(body);
    expect(await store.body('nope')).toBeNull();
    expect(await store.delete('m')).toBe(true);
    expect(await store.list('MATCH')).toEqual([]);
    expect(await store.body('m')).toBeNull();
    const db = await new Promise<IDBDatabase>(resolve => {
      const req = indexedDB.open(LIBRARY_DB_NAME);
      req.onsuccess = () => resolve(req.result);
    });
    expect([...db.objectStoreNames].sort()).toEqual([LIBRARY_BODY_STORE, LIBRARY_STORE]);
    db.close();
  });
});
