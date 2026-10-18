// 브라우저 점검 (명세서 3.7 테스트, 2.6.2 LUT 생성 실행): 실제 Chromium에서 번들된 LUT Worker와 IndexedDB 캐시.
// Node 테스트는 처리기(handleLUTJob)와 메모리 저장소로 규칙을 검사하고, 여기서는 브라우저 연결부만 확인한다.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BALLISTICS_SEED, generateReferenceLUTRows, robotLUTSeeds, searchLaunchSpeed } from '../../core/ballistics';
import type { BallisticsConfig } from '../../core/types';
import { createBrowserLUTWorker } from '../createLUTWorker';
import { createBrowserLUTCache } from '../lutCache';
import type { LUTCacheEntry } from '../lutCache';
import type { LUTJobMessage, LUTWorkerMessage } from '../lutProtocol';

const CONFIG: BallisticsConfig = { dz: 39.5, shooterPitch: Math.PI / 3, sweetSpot: { x: 59.5, y: 131.5 }, shooterOffset: 0 };
const ROBOT = { length: 18, width: 18 };
const SEEDS = robotLUTSeeds(DEFAULT_BALLISTICS_SEED).POLLEN;

// Worker에 작업 하나를 보내고 결과(또는 오류) 메시지를 기다림
function runJob(job: LUTJobMessage): Promise<Extract<LUTWorkerMessage, { kind: 'result' }>> {
  const worker = createBrowserLUTWorker();
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.kind === 'result') resolve(data);
      else if (data.kind === 'error') reject(new Error(data.message));
    };
    worker.onerror = e => reject(new Error(e.message ?? 'worker error'));
    worker.postMessage(job);
  }).finally(() => worker.terminate()) as Promise<Extract<LUTWorkerMessage, { kind: 'result' }>>;
}

describe('LUT Worker (실제 Web Worker)', () => {
  const base = { generation: 1, robotId: 'robot1', pieceType: 'POLLEN', config: CONFIG, robotSize: ROBOT } as const;

  it('v0 탐색 결과가 메인 스레드 계산과 같다', async () => {
    const result = await runJob({ ...base, kind: 'search', jobId: 1, samples: 400, seed: SEEDS.search });
    const expected = searchLaunchSpeed(CONFIG, 'POLLEN', 400, SEEDS.search);
    expect(expected).not.toBeNull();
    expect(result.v0).toBe(expected!.v0);
    expect(result.hitRate).toBe(expected!.hitRate);
  });

  it('행 묶음 결과가 메인 스레드 계산과 비트 단위로 같다', async () => {
    const v0 = searchLaunchSpeed(CONFIG, 'POLLEN', 400, SEEDS.search)!.v0;
    const result = await runJob({ ...base, kind: 'rows', jobId: 2, samples: 200, seed: SEEDS.lut, gyStart: 129, gyEnd: 133, v0 });
    const expected = generateReferenceLUTRows(CONFIG, ROBOT, 'POLLEN', v0, 200, SEEDS.lut, 129, 133);
    expect(result.rows).toBeInstanceOf(Float32Array);
    expect(Array.from(result.rows!)).toEqual(Array.from(expected));
    expect(expected.some(p => p > 0)).toBe(true); // 스윗스팟 근처 행이라 명중 격자가 있음
  });
});

describe('LUT 캐시 (실제 IndexedDB + crypto.subtle)', () => {
  it('저장한 기준 LUT를 같은 요청 키로 다시 읽는다', async () => {
    const cache = createBrowserLUTCache();
    const reference = (fill: number) => new Float32Array(144 * 144).map((_, i) => (i % 97) / 97 * fill);
    const entry: LUTCacheEntry = {
      v0: { POLLEN: 271.5, NECTAR: 280.25 },
      sweetSpotHitRate: { POLLEN: 0.99, NECTAR: 0.97 },
      reference: { POLLEN: reference(1), NECTAR: reference(0.5) },
    };
    const key = `browser-test-${Date.now()}`;
    await cache.put(key, entry);
    const got = await cache.get(key);
    expect(got).not.toBeNull();
    expect(got!.v0).toEqual(entry.v0);
    expect(got!.sweetSpotHitRate).toEqual(entry.sweetSpotHitRate);
    expect(Array.from(got!.reference.POLLEN)).toEqual(Array.from(entry.reference.POLLEN));
    expect(Array.from(got!.reference.NECTAR)).toEqual(Array.from(entry.reference.NECTAR));
    expect(await cache.get(`${key}-missing`)).toBeNull();
  });
});
