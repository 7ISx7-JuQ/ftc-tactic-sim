// 상태 체크섬 (명세서 3.9 상태 체크섬, 10-3): 불러온 경기를 재계산한 결과가 파일 기록과 같은지 / 어디서부터 달라졌는지 검출.
// 위변조 방지가 아니라 불일치 검출 (다른 브라우저 / 다른 엔진 버전, 6.4항 교차 브라우저 결정론).
import { MATCH_TICKS } from './simulationEngine';
import type { DeepReadonly, TimelineFrame } from './types';

// 체크포인트 간격 (1초 = 50틱) / 개수 (0, 50, …, 6000틱 = 121개)
export const CHECKPOINT_INTERVAL = 50;
export const CHECKPOINT_COUNT = MATCH_TICKS / CHECKPOINT_INTERVAL + 1;
export const CHECKSUM_PATTERN = /^[0-9a-f]{8}$/;

/**
 * FNV-1a 32비트 (UTF-16 코드 단위마다 xor → FNV 소수 곱), 8자리 소문자 16진수.
 * JS 숫자 → 문자열은 왕복 정확(최단 표기)이라 부동소수 비트 차이를 잡고, 키 순서는 엔진의 프레임 복제 순서로 고정된다.
 */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function frameChecksum(frame: DeepReadonly<TimelineFrame>): string {
  return fnv1a32(JSON.stringify(frame));
}

/** 체크포인트 틱 목록: 0, 50, …, 6000 */
export const checkpointTicks = (): number[] => Array.from({ length: CHECKPOINT_COUNT }, (_, i) => i * CHECKPOINT_INTERVAL);

/** 타임라인의 체크포인트 체크섬 (기록된 체크포인트까지만: 끝까지 진행한 경기는 121개) */
export function timelineCheckpoints(timeline: readonly DeepReadonly<TimelineFrame>[]): string[] {
  const out: string[] = [];
  for (const tick of checkpointTicks()) {
    const frame = timeline[tick];
    if (!frame) break;
    out.push(frameChecksum(frame));
  }
  return out;
}

export type CheckpointComparison =
  | { match: true }
  // index = 처음 어긋난 체크포인트 번호, 그 사이(lastMatchTick ~ firstMismatchTick)부터 달라짐. 0번부터 다르면 lastMatchTick = null
  | { match: false; index: number; lastMatchTick: number | null; firstMismatchTick: number };

/** 파일 기록(expected)과 재계산 결과(actual) 비교. 개수가 다르면 짧은 쪽 끝 다음 체크포인트에서 어긋난 것으로 본다 */
export function compareCheckpoints(expected: readonly string[], actual: readonly string[]): CheckpointComparison {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      return { match: false, index: i, lastMatchTick: i === 0 ? null : (i - 1) * CHECKPOINT_INTERVAL, firstMismatchTick: i * CHECKPOINT_INTERVAL };
    }
  }
  return { match: true };
}
