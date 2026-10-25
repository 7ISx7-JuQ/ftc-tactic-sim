// 브라우저 안 목록 저장소 (명세서 3.9 브라우저 안 목록, 19-2): React 비의존
// - 이름 붙인 항목 = {id, kind, name, savedAt, text}. text는 파일과 같은 글자(프리셋 파일 / 경기 파일)라 해석 / 정리 규칙을 그대로 쓴다.
// - 종류(kind): SCENARIO(19-2a), ROBOT / SETUP / MATCH(19-2b)를 같은 저장소에 둔다.
// - 경기(MATCH, 19-2b-2)는 글자가 수 MB라 목록에는 작은 요약(text = 요약 JSON)만 두고 경기 파일 글자는 본문 저장소(bodies, 같은 id)에 따로 둔다
//   — 목록을 읽을 때 본문을 읽지 않음. 이름 바꾸기는 목록 항목만 바꾸고, 삭제는 둘 다 지운다.
// - 저장소 = IndexedDB DB ftc-tactic-sim-library(확률표 캐시 / 자동 저장 DB와 따로 — 버전을 서로 묶지 않음). 버전 2 = 본문 저장소 추가.
//   쓸 수 없거나 실패하면 목록 없이 동작한다 (읽기 = 빈 목록, 쓰기 실패 = false).

export const LIBRARY_DB_NAME = 'ftc-tactic-sim-library';
export const LIBRARY_DB_VERSION = 2;
export const LIBRARY_STORE = 'items';
export const LIBRARY_BODY_STORE = 'bodies';

export type LibraryKind = 'SCENARIO' | 'ROBOT' | 'SETUP' | 'MATCH';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['SCENARIO', 'ROBOT', 'SETUP', 'MATCH'];

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  savedAt: number; // ms (Date.now)
  text: string;    // 파일과 같은 글자 (MATCH = 목록용 요약 JSON, 경기 파일 글자는 본문)
}

export interface LibraryStore {
  /** 그 종류의 항목 (순서 없음 — 화면이 정렬) */
  list(kind: LibraryKind): Promise<LibraryItem[]>;
  /** 추가 / 같은 id면 바꿈 (body = 본문도 함께 씀, 없으면 본문은 그대로). 성공하면 true */
  put(item: LibraryItem, body?: string): Promise<boolean>;
  /** 본문 (없거나 읽지 못하면 null) */
  body(id: string): Promise<string | null>;
  /** 항목과 본문을 지움 */
  delete(id: string): Promise<boolean>;
}

/** 새 항목 id (브라우저는 crypto.randomUUID, 없으면 시각 + 난수) */
export function newLibraryId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return typeof c?.randomUUID === 'function' ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 메모리 저장소 (테스트용, items = 지금 항목, bodies = 본문) */
export function createMemoryLibrary(initial: LibraryItem[] = []): LibraryStore & { items: LibraryItem[]; bodies: Map<string, string> } {
  const store = {
    items: [...initial],
    bodies: new Map<string, string>(),
    list: async (kind: LibraryKind) => store.items.filter(i => i.kind === kind).map(i => ({ ...i })),
    put: async (item: LibraryItem, body?: string) => {
      store.items = [...store.items.filter(i => i.id !== item.id), { ...item }];
      if (body !== undefined) store.bodies.set(item.id, body);
      return true;
    },
    body: async (id: string) => store.bodies.get(id) ?? null,
    delete: async (id: string) => {
      store.items = store.items.filter(i => i.id !== id);
      store.bodies.delete(id);
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
          // 버전 1 → 2: 있는 항목은 그대로 두고 본문 저장소만 더함
          const names = req.result.objectStoreNames;
          if (!names.contains(LIBRARY_STORE)) req.result.createObjectStore(LIBRARY_STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
          if (!names.contains(LIBRARY_BODY_STORE)) req.result.createObjectStore(LIBRARY_BODY_STORE);
        };
        const db = await request(req);
        // 다른 탭이 새 버전으로 열거나 DB를 지우면 연결을 닫고 다음에 다시 엶 (막힘 방지)
        db.onversionchange = () => {
          db.close();
          opened = null;
        };
        return db;
      } catch {
        return null;
      }
    })());
  const store = async (mode: IDBTransactionMode, name = LIBRARY_STORE) => (await open())?.transaction(name, mode).objectStore(name) ?? null;
  const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
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
    put: async (item, body) => {
      try {
        const db = await open();
        if (!db) return false;
        // 항목과 본문을 한 트랜잭션에 (본문만 남거나 항목만 남지 않게)
        const tx = db.transaction(body === undefined ? [LIBRARY_STORE] : [LIBRARY_STORE, LIBRARY_BODY_STORE], 'readwrite');
        tx.objectStore(LIBRARY_STORE).put(item);
        if (body !== undefined) tx.objectStore(LIBRARY_BODY_STORE).put(body, item.id);
        await done(tx);
        return true;
      } catch {
        return false;
      }
    },
    body: async id => {
      try {
        const s = await store('readonly', LIBRARY_BODY_STORE);
        if (!s) return null;
        const text = (await request(s.get(id))) as unknown;
        return typeof text === 'string' ? text : null;
      } catch {
        return null;
      }
    },
    delete: async id => {
      try {
        const db = await open();
        if (!db) return false;
        const tx = db.transaction([LIBRARY_STORE, LIBRARY_BODY_STORE], 'readwrite');
        tx.objectStore(LIBRARY_STORE).delete(id);
        tx.objectStore(LIBRARY_BODY_STORE).delete(id);
        await done(tx);
        return true;
      } catch {
        return false;
      }
    },
  };
}
