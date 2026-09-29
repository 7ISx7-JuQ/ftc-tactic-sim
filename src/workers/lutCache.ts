// LUT IndexedDB 캐시 (명세서 2.6.2 LUT 생성 실행 4, 09-4)
// 캐시 키 = lutRequestKey(정규화 JSON)의 SHA-256. 기준 셀 LUT만 저장(로봇당 2 × 82,944 B)하고 불러올 때 4셀을 대칭 복사로 복원.
// 최근 사용(lastUsedAt) 기준 최대 20개 유지, 다른 모델 버전 레코드는 저장 시 삭제.
// 실패 허용: IndexedDB / crypto.subtle을 쓸 수 없거나 조회 / 저장이 실패하면 캐시 없이 동작한다 (관리자가 생성으로 대체).
// 직렬화 / 검증 / 정리 규칙은 작은 레코드 저장소 인터페이스 위에서 동작하므로 Node에서 메모리 저장소로 테스트하고,
// IndexedDB 연결부(openIndexedDBRecordStore)는 브라우저 점검으로 확인한다.

import { BALLISTICS_MODEL_VERSION, LUT_GRID_SIZE } from '../core/ballistics';
import type { LUTPieceType } from './lutProtocol';

export const LUT_CACHE_DB_NAME = 'ftc-tactic-sim';
export const LUT_CACHE_STORE = 'lutCache';
export const LUT_CACHE_DB_VERSION = 1;
export const LUT_CACHE_MAX_ENTRIES = 20;
const CELLS_PER_PIECE = LUT_GRID_SIZE * LUT_GRID_SIZE;

// 관리자가 주고받는 캐시 내용 (기준 셀 LUT + 탐색 결과)
export interface LUTCacheEntry {
  v0: Record<LUTPieceType, number | null>;
  sweetSpotHitRate: Record<LUTPieceType, number>;
  reference: Record<LUTPieceType, Float32Array>;
}

// 관리자가 쓰는 캐시 (요청 키 원문을 받아 내부에서 해시)
export interface LUTCache {
  get(requestKey: string): Promise<LUTCacheEntry | null>;
  put(requestKey: string, entry: LUTCacheEntry): Promise<void>;
}

// IndexedDB 레코드 (명세서 저장 형식)
export interface LUTCacheRecord {
  key: string;
  modelVersion: number;
  createdAt: number;
  lastUsedAt: number;
  v0: Record<LUTPieceType, number | null>;
  sweetSpotHitRate: Record<LUTPieceType, number>;
  reference: Record<LUTPieceType, ArrayBuffer>;
}

export interface LUTRecordMeta {
  key: string;
  modelVersion: number;
  lastUsedAt: number;
}

// 레코드 저장소 (IndexedDB 또는 테스트용 메모리)
export interface LUTRecordStore {
  get(key: string): Promise<LUTCacheRecord | undefined>;
  put(record: LUTCacheRecord): Promise<void>;
  list(): Promise<LUTRecordMeta[]>;
  delete(keys: string[]): Promise<void>;
}

type Subtle = Pick<SubtleCrypto, 'digest'>;

function defaultSubtle(): Subtle | undefined {
  return typeof globalThis.crypto !== 'undefined' ? globalThis.crypto.subtle : undefined;
}

/** 요청 키 원문 → SHA-256 16진 문자열 (64자) */
export async function lutCacheKey(requestKey: string, subtle: Subtle = defaultSubtle()!): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(requestKey));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** 캐시 내용 → 저장 레코드 (버퍼는 복사해 저장, 조립 버퍼와 분리) */
export function entryToRecord(key: string, entry: LUTCacheEntry, now: number, createdAt = now): LUTCacheRecord {
  return {
    key,
    modelVersion: BALLISTICS_MODEL_VERSION,
    createdAt,
    lastUsedAt: now,
    v0: { POLLEN: entry.v0.POLLEN, NECTAR: entry.v0.NECTAR },
    sweetSpotHitRate: { POLLEN: entry.sweetSpotHitRate.POLLEN, NECTAR: entry.sweetSpotHitRate.NECTAR },
    reference: { POLLEN: entry.reference.POLLEN.slice().buffer, NECTAR: entry.reference.NECTAR.slice().buffer },
  };
}

const validV0 = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const validRate = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const validBuffer = (b: unknown) => b instanceof ArrayBuffer && b.byteLength === CELLS_PER_PIECE * Float32Array.BYTES_PER_ELEMENT;

/** 저장 레코드 → 캐시 내용. 모델 버전이 다르거나 형식이 깨졌으면 null (캐시 미스로 처리) */
export function recordToEntry(record: LUTCacheRecord | undefined): LUTCacheEntry | null {
  if (!record || record.modelVersion !== BALLISTICS_MODEL_VERSION) return null;
  const { v0, sweetSpotHitRate: rate, reference } = record;
  if (!v0 || !rate || !reference) return null;
  if (!validV0(v0.POLLEN) || !validV0(v0.NECTAR) || !validRate(rate.POLLEN) || !validRate(rate.NECTAR)) return null;
  if (!validBuffer(reference.POLLEN) || !validBuffer(reference.NECTAR)) return null;
  return {
    v0: { POLLEN: v0.POLLEN, NECTAR: v0.NECTAR },
    sweetSpotHitRate: { POLLEN: rate.POLLEN, NECTAR: rate.NECTAR },
    reference: { POLLEN: new Float32Array(reference.POLLEN.slice(0)), NECTAR: new Float32Array(reference.NECTAR.slice(0)) },
  };
}

/** 정리 대상: 다른 모델 버전 전부 + 현재 버전 중 최근 사용 순으로 max개를 넘는 오래된 것 */
export function recordsToEvict(metas: readonly LUTRecordMeta[], max = LUT_CACHE_MAX_ENTRIES): string[] {
  const stale = metas.filter(m => m.modelVersion !== BALLISTICS_MODEL_VERSION).map(m => m.key);
  const current = metas
    .filter(m => m.modelVersion === BALLISTICS_MODEL_VERSION)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [...stale, ...current.slice(Math.max(0, max)).map(m => m.key)];
}

export interface StoreLUTCacheOptions {
  now?: () => number;       // 시각 (ms, 기본 Date.now)
  subtle?: Subtle;          // SHA-256 (기본 crypto.subtle)
  maxEntries?: number;      // 기본 20
}

/** 레코드 저장소 위의 캐시: 조회 적중 시 lastUsedAt 갱신, 저장 후 정리. 오류는 호출자에게 전달 (관리자가 무시) */
export class StoreLUTCache implements LUTCache {
  private readonly now: () => number;
  private readonly subtle: Subtle;
  private readonly maxEntries: number;
  private readonly store: LUTRecordStore;

  constructor(store: LUTRecordStore, options: StoreLUTCacheOptions = {}) {
    const subtle = options.subtle ?? defaultSubtle();
    if (!subtle) throw new Error('crypto.subtle is not available');
    this.store = store;
    this.subtle = subtle;
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? LUT_CACHE_MAX_ENTRIES;
  }

  async get(requestKey: string): Promise<LUTCacheEntry | null> {
    const key = await lutCacheKey(requestKey, this.subtle);
    const record = await this.store.get(key);
    const entry = recordToEntry(record);
    if (!entry || !record) return null;
    await this.store.put({ ...record, lastUsedAt: this.now() });
    return entry;
  }

  async put(requestKey: string, entry: LUTCacheEntry): Promise<void> {
    const key = await lutCacheKey(requestKey, this.subtle);
    const previous = await this.store.get(key);
    const now = this.now();
    // 같은 키의 유효한 레코드가 있으면 처음 만든 시각 유지
    await this.store.put(entryToRecord(key, entry, now, previous && recordToEntry(previous) ? previous.createdAt : now));
    const evict = recordsToEvict(await this.store.list(), this.maxEntries);
    if (evict.length > 0) await this.store.delete(evict);
  }
}

// ------------------------------------------------------------
// IndexedDB 연결부 (브라우저)
// ------------------------------------------------------------

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** IndexedDB 레코드 저장소 열기. IndexedDB가 없거나 열기에 실패하면 null */
export async function openIndexedDBRecordStore(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<LUTRecordStore | null> {
  if (!idb) return null;
  let db: IDBDatabase;
  try {
    const open = idb.open(LUT_CACHE_DB_NAME, LUT_CACHE_DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(LUT_CACHE_STORE)) open.result.createObjectStore(LUT_CACHE_STORE, { keyPath: 'key' });
    };
    db = await request(open);
  } catch {
    return null;
  }
  const run = async <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const tx = db.transaction(LUT_CACHE_STORE, mode);
    const req = body(tx.objectStore(LUT_CACHE_STORE));
    const [result] = await Promise.all([req ? request(req) : Promise.resolve(undefined), transactionDone(tx)]);
    return result;
  };
  return {
    get: key => run('readonly', store => store.get(key) as IDBRequest<LUTCacheRecord | undefined>) as Promise<LUTCacheRecord | undefined>,
    put: async record => {
      await run('readwrite', store => store.put(record));
    },
    list: async () => {
      const all = (await run('readonly', store => store.getAll() as IDBRequest<LUTCacheRecord[]>)) ?? [];
      return all.map(r => ({ key: r.key, modelVersion: r.modelVersion, lastUsedAt: r.lastUsedAt }));
    },
    delete: async keys => {
      await run('readwrite', store => {
        for (const key of keys) store.delete(key);
      });
    },
  };
}

/**
 * 브라우저 캐시 (앱 시작 시 동기로 만들어 관리자에 주입): 첫 사용 때 IndexedDB를 연다.
 * IndexedDB / crypto.subtle을 쓸 수 없으면(사생활 보호 모드, 비보안 연결 등) 조회는 항상 미스, 저장은 무시.
 */
export function createBrowserLUTCache(options: StoreLUTCacheOptions & { idb?: IDBFactory } = {}): LUTCache {
  let opened: Promise<LUTCache | null> | null = null;
  const open = () => {
    opened ??= (async () => {
      const subtle = options.subtle ?? defaultSubtle();
      if (!subtle) return null;
      const store = await openIndexedDBRecordStore('idb' in options ? options.idb : globalThis.indexedDB);
      return store ? new StoreLUTCache(store, { ...options, subtle }) : null;
    })();
    return opened;
  };
  return {
    get: async key => {
      const cache = await open();
      return cache ? cache.get(key) : null;
    },
    put: async (key, entry) => {
      const cache = await open();
      if (cache) await cache.put(key, entry);
    },
  };
}
