// LUT 생성 Worker 메시지 규약 + 작업 처리기 (명세서 2.6.2 LUT 생성 실행 1, 09-3)
// 처리기는 ballistics.ts 순수 함수만 쓰는 DOM / React 비의존 함수이다.
// 실제 Worker(lutWorker.ts)와 테스트의 가짜 Worker가 같은 처리기를 호출한다.

import { LUT_GRID_SIZE, generateReferenceLUTRows, searchLaunchSpeed } from '../core/ballistics';
import type { BallisticsConfig, GamePiece, RobotConfig } from '../core/types';

export type LUTRobotId = 'robot1' | 'robot2';
export type LUTPieceType = GamePiece['type'];
export type LUTRobotSize = Pick<RobotConfig, 'length' | 'width'>;

// 메인 → Worker: 작업 1개
//   search: 스윗스팟 v0 탐색 (config.sweetSpot은 격자 중심으로 스냅된 값, samples = 후보당 샘플 수, seed = 탐색 시드)
//   rows:   기준 셀 LUT 행 범위 [gyStart, gyEnd) (samples = 격자당 샘플 수, seed = LUT 시드, v0 = 탐색 결과)
export interface LUTJobMessage {
  kind: 'search' | 'rows';
  jobId: number;
  generation: number;
  robotId: LUTRobotId;
  pieceType: LUTPieceType;
  config: BallisticsConfig;
  robotSize: LUTRobotSize;
  samples: number;
  seed: number;
  gyStart?: number;
  gyEnd?: number;
  v0?: number;
}

// Worker → 메인
//   progress: 행 1개를 끝낼 때마다 (cellsDone = 이 작업에서 지금까지 끝낸 격자 수, 생략 격자 포함)
//   result:   search = v0 / hitRate (닫힌 해가 없으면 둘 다 없음), rows = 행 결과 (transferable)
//   error:    작업 실패
export type LUTWorkerMessage =
  | { kind: 'progress'; jobId: number; cellsDone: number }
  | { kind: 'result'; jobId: number; generation: number; v0?: number; hitRate?: number; rows?: Float32Array }
  | { kind: 'error'; jobId: number; message: string };

export type LUTPost = (message: LUTWorkerMessage, transfer?: Transferable[]) => void;

/** 작업 1개 처리: 결과 / 진행 / 오류 메시지를 post로 보낸다 (동기 실행) */
export function handleLUTJob(job: LUTJobMessage, post: LUTPost): void {
  try {
    if (job.kind === 'search') {
      const found = searchLaunchSpeed(job.config, job.pieceType, job.samples, job.seed);
      post(found
        ? { kind: 'result', jobId: job.jobId, generation: job.generation, v0: found.v0, hitRate: found.hitRate }
        : { kind: 'result', jobId: job.jobId, generation: job.generation });
      return;
    }
    const start = job.gyStart ?? 0;
    const end = job.gyEnd ?? LUT_GRID_SIZE;
    if (!(typeof job.v0 === 'number' && Number.isFinite(job.v0))) throw new Error('rows job requires a finite v0');
    const rows = new Float32Array(Math.max(0, end - start) * LUT_GRID_SIZE);
    // 행 1개씩 계산해 진행을 알린다 (격자 인덱스 / 난수 구간은 전체 LUT 기준이라 분할해도 결과 동일)
    for (let gy = start; gy < end; gy++) {
      const row = generateReferenceLUTRows(job.config, job.robotSize, job.pieceType, job.v0, job.samples, job.seed, gy, gy + 1);
      rows.set(row, (gy - start) * LUT_GRID_SIZE);
      post({ kind: 'progress', jobId: job.jobId, cellsDone: (gy - start + 1) * LUT_GRID_SIZE });
    }
    post({ kind: 'result', jobId: job.jobId, generation: job.generation, rows }, [rows.buffer]);
  } catch (err) {
    post({ kind: 'error', jobId: job.jobId, message: err instanceof Error ? err.message : String(err) });
  }
}
