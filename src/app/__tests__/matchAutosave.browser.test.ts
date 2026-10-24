// 경기 자동 저장 IndexedDB 저장소 (명세서 3.9 경기 자동 저장 / 복구, 19-1) — 실제 Chromium IndexedDB
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_DB_NAME, createBrowserAutosave } from '../matchAutosave';
import { LUT_CACHE_DB_NAME, openIndexedDBRecordStore } from '../../workers/lutCache';

describe('경기 자동 저장 IndexedDB (19-1)', () => {
  it('저장 → 읽기 → 덮어쓰기 → 지우기, 확률표 캐시 DB와 따로 (캐시 열기에 영향 없음), IndexedDB가 없으면 없음으로 동작', async () => {
    indexedDB.deleteDatabase(AUTOSAVE_DB_NAME);
    const store = createBrowserAutosave();
    expect(await store.load()).toBeNull();
    const big = 'x'.repeat(1_600_000); // 경기 파일 최대 크기 정도
    await store.save(big);
    expect((await createBrowserAutosave().load())?.length).toBe(big.length); // 새 연결로 다시 읽음
    await store.save('{"a":1}');
    expect(await store.load()).toBe('{"a":1}');
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(AUTOSAVE_DB_NAME).not.toBe(LUT_CACHE_DB_NAME);
    expect(await openIndexedDBRecordStore()).not.toBeNull(); // 캐시 DB 버전 / 저장소 그대로
    const none = createBrowserAutosave(null);
    expect(await none.load()).toBeNull();
    await none.save('y'); // 오류 없이 무시
    expect(await none.load()).toBeNull();
    const broken = createBrowserAutosave({ open: () => { throw new Error('blocked'); } } as unknown as IDBFactory);
    await broken.save('z');
    expect(await broken.load()).toBeNull(); // 열기 실패 = 자동 저장 없음
  });
});
