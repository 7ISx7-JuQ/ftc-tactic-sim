import { describe, expect, it } from 'vitest';
import { BALLISTICS_MODEL_VERSION, generateRobotLUTs, LUT_GRID_SIZE, mirrorLUTSet } from '../../core/ballistics';
import type { RobotBallisticsResult } from '../../core/ballistics';
import type { BallisticsConfig, HiveCellKey } from '../../core/types';
import {
  LUT_CACHE_MAX_ENTRIES,
  StoreLUTCache,
  createBrowserLUTCache,
  entryToRecord,
  lutCacheKey,
  openIndexedDBRecordStore,
  recordToEntry,
  recordsToEvict,
} from '../lutCache';
import type { LUTCache, LUTCacheEntry, LUTCacheRecord, LUTRecordMeta, LUTRecordStore } from '../lutCache';
import { lutRequestKey } from '../lutManager';
import type { LUTRequest } from '../lutManager';
import { setupLUTManager } from './fakeWorker';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const deg = (d: number) => (d * Math.PI) / 180;
const bitEqual = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const N = LUT_GRID_SIZE * LUT_GRID_SIZE;

const CFG1: BallisticsConfig = { dz: 39.5, shooterPitch: deg(70), sweetSpot: { x: 60.5, y: 134.5 }, shooterOffset: 6 };
const REQ1: LUTRequest = { config: CFG1, robotSize: { length: 18, width: 18 } };
const REQ2: LUTRequest = { config: { ...CFG1, dz: 41.5, shooterPitch: deg(55), sweetSpot: { x: 59.5, y: 130.5 } }, robotSize: { length: 14, width: 12 } };
const OPTS = { samples: 12, searchSamples: 150, seed: 5 };

// 메모리 레코드 저장소 (IndexedDB처럼 구조화 복제로 저장 / 반환)
class MemoryStore implements LUTRecordStore {
  map = new Map<string, LUTCacheRecord>();
  failGet = false;
  failPut = false;
  async get(key: string) {
    if (this.failGet) throw new Error('get failed');
    const r = this.map.get(key);
    return r && structuredClone(r);
  }
  async put(record: LUTCacheRecord) {
    if (this.failPut) throw new Error('put failed');
    this.map.set(record.key, structuredClone(record));
  }
  async list(): Promise<LUTRecordMeta[]> {
    return [...this.map.values()].map(r => ({ key: r.key, modelVersion: r.modelVersion, lastUsedAt: r.lastUsedAt }));
  }
  async delete(keys: string[]) {
    for (const k of keys) this.map.delete(k);
  }
}

const sampleEntry = (fill: number): LUTCacheEntry => ({
  v0: { POLLEN: 250 + fill, NECTAR: null },
  sweetSpotHitRate: { POLLEN: 0.5, NECTAR: 0 },
  reference: { POLLEN: new Float32Array(N).fill(fill / 100), NECTAR: Float32Array.from({ length: N }, (_, i) => (i % 97) / 97) },
});

// 비동기 작업(SHA-256 / 저장소)이 끝날 때까지 이벤트 루프를 돌림
async function until(cond: () => boolean, label: string) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 0));
  }
  throw new Error(`timed out: ${label}`);
}

const sameResult = (a: RobotBallisticsResult, b: RobotBallisticsResult) =>
  (['POLLEN', 'NECTAR'] as const).every(t => a.v0[t] === b.v0[t] && a.sweetSpotHitRate[t] === b.sweetSpotHitRate[t]
    && (Object.keys(a.luts[t]) as HiveCellKey[]).every(k => bitEqual(a.luts[t][k], b.luts[t][k])));

describe('LUT 캐시 (09-4)', () => {
  it('A. 캐시 키 (SHA-256) / 레코드 변환 / 검증', async () => {
    const raw = lutRequestKey(REQ1, 2000, 20000, 0x0ba1157);
    const key = await lutCacheKey(raw);
    // FIPS 180-2 테스트 벡터: SHA-256("abc")
    assert(await lutCacheKey('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 hex (test vector)');
    assert(/^[0-9a-f]{64}$/.test(key) && key === await lutCacheKey(raw), 'normalized request key -> 64 hex chars, deterministic');
    assert(key !== await lutCacheKey(lutRequestKey(REQ2, 2000, 20000, 0x0ba1157)), 'different request -> different key');

    const entry = sampleEntry(7);
    const record = entryToRecord('k', entry, 1000);
    assert(record.modelVersion === BALLISTICS_MODEL_VERSION && record.createdAt === 1000 && record.lastUsedAt === 1000, 'record metadata');
    assert(record.reference.POLLEN.byteLength === N * 4 && record.reference.POLLEN !== entry.reference.POLLEN.buffer, 'reference stored as copied ArrayBuffer (82,944 B)');
    entry.reference.POLLEN[0] = 99;
    const back = recordToEntry(structuredClone(record))!;
    assert(back.reference.POLLEN[0] === Math.fround(0.07) && bitEqual(back.reference.NECTAR, entry.reference.NECTAR), 'round trip, later mutation of the source does not leak');
    assert(back.v0.POLLEN === 257 && back.v0.NECTAR === null && back.sweetSpotHitRate.POLLEN === 0.5, 'v0 (null allowed) / hit rate');
    const broken: [string, LUTCacheRecord | undefined][] = [
      ['missing', undefined],
      ['other model version', { ...record, modelVersion: BALLISTICS_MODEL_VERSION + 1 }],
      ['short buffer', { ...record, reference: { ...record.reference, NECTAR: new ArrayBuffer(16) } }],
      ['NaN v0', { ...record, v0: { POLLEN: NaN, NECTAR: null } }],
      ['bad hit rate', { ...record, sweetSpotHitRate: { POLLEN: 0.5, NECTAR: undefined as unknown as number } }],
    ];
    for (const [name, r] of broken) assert(recordToEntry(r) === null, `${name} -> cache miss`);
  });

  it('B. 정리 규칙 (최근 사용 20개, 다른 모델 버전 삭제)', () => {
    const metas: LUTRecordMeta[] = Array.from({ length: 23 }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, modelVersion: BALLISTICS_MODEL_VERSION, lastUsedAt: 100 + i }));
    metas.push({ key: 'old1', modelVersion: BALLISTICS_MODEL_VERSION - 1, lastUsedAt: 9999 }, { key: 'old2', modelVersion: 0, lastUsedAt: 1 });
    const evict = recordsToEvict(metas);
    assert(evict.join() === 'old1,old2,k02,k01,k00', `other versions + least recently used beyond 20 (${evict.join()})`);
    assert(LUT_CACHE_MAX_ENTRIES === 20 && recordsToEvict(metas.slice(0, 20)).length === 0, 'exactly 20 current -> nothing evicted');
    const tie = recordsToEvict([{ key: 'b', modelVersion: BALLISTICS_MODEL_VERSION, lastUsedAt: 5 }, { key: 'a', modelVersion: BALLISTICS_MODEL_VERSION, lastUsedAt: 5 }], 1);
    assert(tie.join() === 'b', 'ties broken by key (deterministic)');
  });

  it('C. 저장소 위 캐시: 저장 / 조회 / 사용 시각 갱신 / LRU', async () => {
    let clock = 1000;
    const store = new MemoryStore();
    const cache = new StoreLUTCache(store, { now: () => clock });
    assert(await cache.get('nothing') === null, 'miss on empty cache');
    await cache.put('req-a', sampleEntry(1));
    const keyA = await lutCacheKey('req-a');
    assert(store.map.size === 1 && store.map.get(keyA)!.createdAt === 1000, 'stored under the hashed key');
    clock = 2000;
    const got = (await cache.get('req-a'))!;
    assert(bitEqual(got.reference.POLLEN, sampleEntry(1).reference.POLLEN) && got.v0.POLLEN === 251, 'get returns the stored entry');
    assert(store.map.get(keyA)!.lastUsedAt === 2000 && store.map.get(keyA)!.createdAt === 1000, 'hit refreshes lastUsedAt only');
    clock = 3000;
    await cache.put('req-a', sampleEntry(2));
    assert(store.map.get(keyA)!.createdAt === 1000 && store.map.get(keyA)!.lastUsedAt === 3000 && store.map.size === 1, 're-put keeps createdAt');
    // 21개 더 저장: 처음 것(req-a)을 도중에 사용하면 살아남고, 그다음으로 오래된 것이 지워짐
    for (let i = 0; i < 21; i++) {
      clock = 4000 + i;
      await cache.put(`req-${i}`, sampleEntry(i));
      if (i === 10) {
        clock = 4010.5;
        await cache.get('req-a');
      }
    }
    assert(store.map.size === 20, `capped at 20 (${store.map.size})`);
    assert(store.map.has(keyA) && !store.map.has(await lutCacheKey('req-0')) && !store.map.has(await lutCacheKey('req-1')) && store.map.has(await lutCacheKey('req-2')),
      'least recently used evicted, recently used survives');
    // 깨진 레코드: 미스, 사용 시각 갱신 없음
    const broken = await lutCacheKey('req-20');
    store.map.set(broken, { ...store.map.get(broken)!, modelVersion: 999, lastUsedAt: 1 });
    assert(await cache.get('req-20') === null && store.map.get(broken)!.lastUsedAt === 1, 'invalid record -> miss, untouched');
    // IndexedDB가 없으면: 저장소 null, 브라우저 캐시는 항상 미스 / 저장 무시
    assert(await openIndexedDBRecordStore(undefined) === null, 'no IndexedDB -> no store');
    const noIdb = createBrowserLUTCache({ idb: undefined });
    await noIdb.put('x', sampleEntry(1));
    assert(await noIdb.get('x') === null, 'browser cache without IndexedDB behaves as always-miss');
  });

  it('D. 관리자 연동: 미스 → 생성 후 저장, 적중 → Worker 없이 즉시 READY', async () => {
    const store = new MemoryStore();
    const inner = new StoreLUTCache(store);
    let putCalls = 0;
    const cache: LUTCache = { get: key => inner.get(key), put: (key, entry) => { putCalls++; return inner.put(key, entry); } };
    const direct = generateRobotLUTs(CFG1, REQ1.robotSize, OPTS);
    // 1회차: 미스 → 조회 중에는 QUEUED(작업 없음) → 생성 → 저장
    {
      const { manager, workers, drain } = setupLUTManager({ ...OPTS, poolSize: 2, cache });
      manager.request('robot1', REQ1);
      assert(manager.getStatus('robot1').state === 'QUEUED' && workers.every(w => w.received.length === 0), 'cache lookup first: QUEUED, no jobs yet');
      await until(() => workers.some(w => w.pending.length > 0), 'miss -> jobs dispatched');
      drain();
      const s = manager.getStatus('robot1');
      assert(s.state === 'READY' && !s.fromCache && sameResult(s.result!, direct), 'generated after a miss');
      await until(() => store.map.size === 1, 'saved after READY');
      const saved = recordToEntry([...store.map.values()][0])!;
      assert(bitEqual(saved.reference.POLLEN, direct.luts.POLLEN.RED_AUDIENCE) && bitEqual(saved.reference.NECTAR, direct.luts.NECTAR.RED_AUDIENCE)
        && saved.v0.POLLEN === direct.v0.POLLEN && saved.sweetSpotHitRate.NECTAR === direct.sweetSpotHitRate.NECTAR, 'saved reference LUTs + search results');
    }
    // 2회차 (새 관리자 = 새로고침): 적중 → Worker 작업 없이 READY, 4셀 복원 결과 동일
    {
      const { manager, workers, changes } = setupLUTManager({ ...OPTS, poolSize: 2, cache });
      manager.request('robot1', REQ1);
      await until(() => manager.getStatus('robot1').state === 'READY', 'cache hit -> READY');
      const s = manager.getStatus('robot1');
      assert(s.fromCache && workers.every(w => w.received.length === 0), 'hit uses no worker');
      assert(sameResult(s.result!, direct) && s.cellsDone === s.cellsTotal && s.rowsDone.POLLEN.every(v => v === 1) && s.searched.NECTAR, 'restored result === generateRobotLUTs, progress complete');
      assert(changes.map(c => c.state).join('>') === 'QUEUED>READY', `hit states ${changes.map(c => c.state).join('>')}`);
      assert(bitEqual(s.result!.luts.NECTAR.BLUE_OPPOSITE, mirrorLUTSet(s.reference.NECTAR).BLUE_OPPOSITE), '4 cells rebuilt by mirroring the reference');
      await new Promise(r => setTimeout(r, 0));
      assert(putCalls === 1, `a hit is not saved again (put calls ${putCalls})`);
    }
  }, 120_000);

  it('E. 조회 도중 변경 / 실패 허용', async () => {
    // 느린 캐시: 조회 결과를 테스트가 풀어 줌
    const pending: ((e: LUTCacheEntry | null) => void)[] = [];
    const slow: LUTCache = { get: () => new Promise(r => pending.push(r)), put: async () => {} };
    {
      const { manager, workers, drain } = setupLUTManager({ ...OPTS, poolSize: 1, cache: slow });
      manager.request('robot1', REQ1);
      manager.request('robot1', REQ2);   // 조회 도중 설정 변경
      assert(pending.length === 2, 'two lookups started');
      pending[0](null);                  // 이전 요청의 미스 결과 → 무시 (옛 세대 작업을 보내지 않음)
      await new Promise(r => setTimeout(r, 0));
      assert(manager.getStatus('robot1').state === 'QUEUED' && workers[0].received.length === 0, 'stale lookup miss ignored: no jobs for the old request');
      pending[1](null);                  // 현재 요청 미스 → 생성
      await until(() => workers[0].pending.length > 0, 'current lookup miss -> generate');
      drain();
      assert(sameResult(manager.getStatus('robot1').result!, generateRobotLUTs(REQ2.config, REQ2.robotSize, OPTS)), 'result for the latest request');
      // 조회 도중 취소 → 적중이 와도 CANCELLED 유지
      manager.request('robot2', REQ1);
      manager.cancel('robot2');
      pending[2](sampleEntry(4));
      await new Promise(r => setTimeout(r, 0));
      assert(manager.getStatus('robot2').state === 'CANCELLED' && manager.getStatus('robot2').result === null, 'cancel during lookup wins');
      // 조회 도중 정리 → 아무 작업도 보내지 않음 (R1과 다른 설정: 같은 설정이면 09-10a 공유로 조회 없이 READY)
      manager.request('robot2', { ...REQ1, robotSize: { length: 16, width: 18 } });
      manager.dispose();
      pending[3](null);
      await new Promise(r => setTimeout(r, 0));
      assert(workers[0].received.every(j => j.robotId === 'robot1'), 'dispose during lookup -> nothing dispatched');
    }
    // 조회 실패(비동기 / 동기 예외) → 생성으로 대체, 저장 실패 → 무시하고 READY
    const store = new MemoryStore();
    store.failGet = true;
    store.failPut = true;
    const throwing: LUTCache = { get: () => { throw new Error('sync'); }, put: () => { throw new Error('sync'); } };
    for (const [name, cache] of [['store failures', new StoreLUTCache(store)], ['sync throws', throwing]] as const) {
      const { manager, workers, drain } = setupLUTManager({ ...OPTS, poolSize: 2, cache });
      manager.request('robot1', REQ1);
      await until(() => workers.some(w => w.pending.length > 0), `${name}: lookup failure -> generate`);
      drain();
      await new Promise(r => setTimeout(r, 0));
      assert(manager.getStatus('robot1').state === 'READY' && !manager.getStatus('robot1').fromCache, `${name}: READY despite cache failures`);
    }
  }, 120_000);
});
