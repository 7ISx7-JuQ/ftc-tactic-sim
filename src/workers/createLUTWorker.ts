// 브라우저 LUT Worker 생성 (명세서 2.6.2 LUT 생성 실행 1, 09-3)
// Vite가 Worker 모듈을 별도 청크로 묶도록 new Worker(new URL(...), { type: 'module' }) 형태를 그대로 쓴다.

import type { LUTWorkerLike } from './lutManager';

export function createBrowserLUTWorker(): LUTWorkerLike {
  return new Worker(new URL('./lutWorker.ts', import.meta.url), { type: 'module' }) as unknown as LUTWorkerLike;
}
