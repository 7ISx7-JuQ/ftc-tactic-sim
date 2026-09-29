// LUT 관리자 테스트용 가짜 Worker / 관리자 준비 (lutManager.test.ts, lutCache.test.ts 공용)
import { handleLUTJob } from '../lutProtocol';
import type { LUTJobMessage, LUTRobotId, LUTWorkerMessage } from '../lutProtocol';
import { LUTManager } from '../lutManager';
import type { LUTGenState, LUTManagerOptions, LUTWorkerLike } from '../lutManager';

// 가짜 Worker: 받은 작업을 쌓아 두고, step()에서 실제 처리기(handleLUTJob)로 1개 처리해 응답을 onmessage로 전달.
// 메시지는 structuredClone으로 복사해 Worker 경계(구조화 복제)를 흉내 낸다.
export class FakeWorker implements LUTWorkerLike {
  onmessage: ((event: { data: LUTWorkerMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  pending: LUTJobMessage[] = [];
  received: LUTJobMessage[] = [];
  terminated = false;
  failNext: 'error' | 'badRows' | null = null;

  postMessage(message: LUTJobMessage): void {
    this.received.push(message);
    this.pending.push(structuredClone(message));
  }
  terminate(): void {
    this.terminated = true;
  }
  step(): boolean {
    const job = this.pending.shift();
    if (!job) return false;
    const deliver = (data: LUTWorkerMessage) => this.onmessage?.({ data: structuredClone(data) });
    if (this.failNext === 'error') {
      this.failNext = null;
      deliver({ kind: 'error', jobId: job.jobId, message: 'boom' });
    } else if (this.failNext === 'badRows' && job.kind === 'rows') {
      this.failNext = null;
      deliver({ kind: 'result', jobId: job.jobId, generation: job.generation, rows: new Float32Array(3) });
    } else {
      handleLUTJob(job, deliver);
    }
    return true;
  }
}

export function setupLUTManager(options: Partial<LUTManagerOptions> = {}) {
  const workers: FakeWorker[] = [];
  const changes: { robotId: LUTRobotId; state: LUTGenState; cellsDone: number }[] = [];
  const manager: LUTManager = new LUTManager({
    ...options,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    onChange: robotId => {
      const s = manager.getStatus(robotId);
      changes.push({ robotId, state: s.state, cellsDone: s.cellsDone });
    },
  });
  // 모든 Worker의 작업을 끝까지 처리 (reverse = 뒤 Worker부터 → 완료 순서가 바뀜)
  const drain = (reverse = false) => {
    for (let guard = 0; guard < 100000; guard++) {
      const order = reverse ? [...workers].reverse() : workers;
      if (!order.some(w => w.step())) return;
    }
    throw new Error('drain did not finish');
  };
  const pendingJobs = () => workers.flatMap(w => w.pending);
  return { manager, workers, changes, drain, pendingJobs };
}

