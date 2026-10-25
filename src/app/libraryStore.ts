// 브라우저 안 목록 저장소 (명세서 3.9 브라우저 안 목록, 19-2): React 비의존
// - 이름 붙인 항목 = {id, kind, name, savedAt, text}. text는 파일과 같은 글자(프리셋 파일 / 경기 파일)라 해석 / 정리 규칙을 그대로 쓴다.
// - 종류(kind): 19-2a는 SCENARIO만, 19-2b에서 ROBOT / SETUP / MATCH를 같은 저장소에 더한다.
// - 저장소 = IndexedDB DB ftc-tactic-sim-library(확률표 캐시 / 자동 저장 DB와 따로 — 버전을 서로 묶지 않음).
//   쓸 수 없거나 실패하면 목록 없이 동작한다 (읽기 = 빈 목록, 쓰기 실패 = false).

export const LIBRARY_DB_NAME = 'ftc-tactic-sim-library';
export const LIBRARY_DB_VERSION = 1;
export const LIBRARY_STORE = 'items';

export type LibraryKind = 'SCENARIO' | 'ROBOT' | 'SETUP' | 'MATCH';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  savedAt: number; // ms (Date.now)
  text: string;    // 파일과 같은 글자
}

export interface LibraryStore {
  /** 그 종류의 항목 (순서 없음 — 화면이 정렬) */
  list(kind: LibraryKind): Promise<LibraryItem[]>;
  /** 추가 / 같은 id면 바꿈. 성공하면 true */
  put(item: LibraryItem): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

/** 새 항목 id (브라우저는 crypto.randomUUID, 없으면 시각 + 난수) */
export function newLibraryId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return typeof c?.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 메모리 저장소 (테스트용, items = 지금 항목) */
export function createMemoryLibrary(initial: LibraryItem[] = []): LibraryStore & { items: LibraryItem[] } {
  const store = {
    items: [...initial],
    list: async (kind: LibraryKind) => store.items.filter(i => i.kind === kind).map(i => ({ ...i })),
    put: async (item: LibraryItem) => {
      store.items = [...store.items.filter(i => i.id !== item.id), { ...item }];
      return true;
    },
    delete: async (id: string) => {
      store.items = store.items.filter(i => i.id !== id);
      return true;
    },
  };
  return store;
}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const isItem = (v: unknown): v is LibraryItem => {
  const r = v as Partial<LibraryItem> | null;
  return !!r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.name === 'string' && typeof r.savedAt === 'number' && typeof r.text === 'string';
};

/** IndexedDB 저장소 (처음 쓸 때 열기, null = IndexedDB 없음) */
export function createBrowserLibrary(idb: IDBFactory | null = globalThis.indexedDB ?? null): LibraryStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (opened ??= (async () => {
      if (!idb) return null;
      try {
        const req = idb.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(LIBRARY_STORE)) req.result.createObjectStore(LIBRARY_STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
        };
        return await request(req);
      } catch {
        return null;
      }
    })());
  const store = async (mode: IDBTransactionMode) => (await open())?.transaction(LIBRARY_STORE, mode).objectStore(LIBRARY_STORE) ?? null;
  return {
    list: async kind => {
      try {
        const s = await store('readonly');
        if (!s) return [];
        const all = (await request(s.index('kind').getAll(kind))) as unknown[];
        return all.filter(isItem);
      } catch {
        return [];
      }
    },
    put: async item => {
      try {
        const s = await store('readwrite');
        if (!s) return false;
        await request(s.put(item));
        return true;
      } catch {
        return false;
      }
    },
    delete: async id => {
      try {
        const s = await store('readwrite');
        if (!s) return false;
        await request(s.delete(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
