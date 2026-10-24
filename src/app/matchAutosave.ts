// 경기 자동 저장 / 복구 (명세서 3.9 경기 자동 저장 / 복구, 19-1): React 비의존
// - 저장 내용 = 경기 파일과 같은 레시피 글자(분기 트리 전체, 미종료 가지 포함, serializeMatchRecipe) 하나 — 마지막 경기 1개만.
// - 저장소 = IndexedDB(레시피가 최대 약 1.6 MB라 localStorage 한도에 걸릴 수 있음). 확률표 캐시 DB(ftc-tactic-sim, 버전 1)와 따로 둔다
//   (같은 DB에 저장소를 더하면 DB 버전을 올려야 해 캐시 쪽 열기가 실패함). 쓸 수 없거나 실패하면 자동 저장 없이 동작한다.
// - 언제 저장하나(AutosaveScheduler): 상태 알림의 저장 표식(autosaveSignature)이 바뀌면 — 진행 중이 아니면 잠시 뒤 바로,
//   진행 중이면 최대 AUTOSAVE_RUNNING_INTERVAL_MS마다 한 번. 저장 내용은 저장하는 순간의 컨트롤러에서 읽는다.

import type { AppStatus } from './appController';

export const AUTOSAVE_DB_NAME = 'ftc-tactic-sim-matches';
export const AUTOSAVE_DB_VERSION = 1;
export const AUTOSAVE_STORE = 'autosave';
const AUTOSAVE_KEY = 'latest';
/** 진행 중 저장 간격 (크래시 / 새로고침 때 잃는 최대 시간) */
export const AUTOSAVE_RUNNING_INTERVAL_MS = 5000;
/** 진행 중이 아닐 때 바뀐 뒤 저장까지 (연속 조작을 한 번으로 모음) */
export const AUTOSAVE_IDLE_DELAY_MS = 300;

export interface AutosaveStore {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  clear(): Promise<void>;
}

/** 메모리 저장소 (테스트용, text = 지금 저장된 글자) */
export function createMemoryAutosave(initial: string | null = null): AutosaveStore & { text: string | null } {
  const store = {
    text: initial,
    load: async () => store.text,
    save: async (text: string) => {
      store.text = text;
    },
    clear: async () => {
      store.text = null;
    },
  };
  return store;
}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** IndexedDB 저장소 (처음 쓸 때 열기, null = IndexedDB 없음). 열기 / 읽기 / 쓰기 실패는 조용히 무시 (읽기 = 없음) */
export function createBrowserAutosave(idb: IDBFactory | null = globalThis.indexedDB ?? null): AutosaveStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (opened ??= (async () => {
      if (!idb) return null;
      try {
        const req = idb.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(AUTOSAVE_STORE)) req.result.createObjectStore(AUTOSAVE_STORE, { keyPath: 'key' });
        };
        return await request(req);
      } catch {
        return null;
      }
    })());
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
    const db = await open();
    if (!db) return null;
    try {
      return await request(fn(db.transaction(AUTOSAVE_STORE, mode).objectStore(AUTOSAVE_STORE)));
    } catch {
      return null;
    }
  };
  return {
    load: async () => {
      const record = (await run('readonly', s => s.get(AUTOSAVE_KEY))) as { text?: unknown } | null | undefined;
      return typeof record?.text === 'string' ? record.text : null;
    },
    save: async text => {
      await run('readwrite', s => s.put({ key: AUTOSAVE_KEY, savedAt: Date.now(), text }));
    },
    clear: async () => {
      await run('readwrite', s => s.delete(AUTOSAVE_KEY));
    },
  };
}

/**
 * 저장 표식: 저장할 경기가 있을 때 기록을 바꾸는 값(지금 가지 · 가지마다 이름 / 부모 / 분기 틱 / 머리)을 이은 글자, 없으면 null.
 * 경기 중(MATCH)이 아니거나(경기 전 / 회전 중) 0틱짜리 원본 하나뿐이면 저장하지 않는다
 */
export function autosaveSignature(status: Pick<AppStatus, 'phase' | 'currentBranchId' | 'branches'>): string | null {
  if (status.phase !== 'MATCH') return null;
  if (status.branches.length === 1 && status.branches[0].headTick === 0) return null;
  return JSON.stringify([status.currentBranchId, status.branches.map(b => [b.id, b.name, b.parentId, b.forkTick, b.headTick])]);
}

export interface AutosaveSchedulerDeps {
  save: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
}

/** 언제 저장할지 (상태 알림마다 update): 바뀌었으면 진행 중이 아닐 때 AUTOSAVE_IDLE_DELAY_MS 뒤, 진행 중이면 직전 저장에서 간격이 지난 뒤 */
export class AutosaveScheduler {
  private readonly deps: AutosaveSchedulerDeps;
  private savedSig: string | null = null;  // 마지막으로 저장한 표식
  private pendingSig: string | null = null; // 저장을 예약한 표식
  private timer: number | null = null;
  private lastSaveAt = -Infinity;
  private disposed = false;

  constructor(deps: AutosaveSchedulerDeps) {
    this.deps = deps;
  }

  update(sig: string | null, running: boolean): void {
    if (this.disposed) return; // 화면을 내린 뒤 컨트롤러 정리(일시정지)가 보내는 마지막 상태 알림
    if (sig === null || sig === this.savedSig) {
      if (sig === null) this.cancel();
      return;
    }
    this.pendingSig = sig;
    if (running) {
      if (this.timer !== null) return; // 이미 예약됨 (진행 중 간격 / 곧 저장)
      this.schedule(Math.max(0, this.lastSaveAt + AUTOSAVE_RUNNING_INTERVAL_MS - this.deps.now()));
    } else {
      // 연속 조작은 마지막 뒤 한 번, 진행이 멈췄으면 진행 중 간격을 기다리지 않음
      if (this.timer !== null) this.deps.clearTimer(this.timer);
      this.schedule(AUTOSAVE_IDLE_DELAY_MS);
    }
  }

  /** 지금 예약된 저장을 바로 (탭을 떠나기 전 등). 예약이 없으면 무시 */
  flush(): void {
    if (this.timer === null) return;
    this.deps.clearTimer(this.timer);
    this.fire();
  }

  /** 저장을 지운 뒤(NEW / 복구 버리기): 예약을 버리고 처음 상태로 */
  reset(): void {
    this.cancel();
    this.savedSig = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private schedule(ms: number): void {
    this.timer = this.deps.setTimer(() => this.fire(), ms);
  }

  private fire(): void {
    this.timer = null;
    this.savedSig = this.pendingSig;
    this.lastSaveAt = this.deps.now();
    this.deps.save();
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.pendingSig = null;
  }
}
