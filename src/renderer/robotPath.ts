// 로봇 동선 (명세서 3.7 표시 옵션 robotPath, 16-3): 저장된 프레임에서 로봇 중심 위치를 뽑아 선으로 그릴 점 목록. DOM 비의존 순수 함수.
// - 0틱 ~ 보는 틱 = 지나온 동선(진하게), 보는 틱 ~ 머리 = 앞으로 갈 동선(흐리게). 복기 회의에서 전체 동선과 지금 위치를 함께 본다.
// - ROBOT_PATH_STEP틱마다 표본 + 보는 틱 / 머리 틱은 항상 포함 (선 끝 = 로봇 중심). 제자리(이전 점과 거의 같은 점)는 건너뛴다.

import type { DeepReadonly, TimelineFrame } from '../core/types';
import type { Point2 } from './viewTransform';

/** 표본 간격 (틱): 0.04초, 최고 속도에서도 점 사이 약 4 in 이하라 회전이 각지지 않는다 */
export const ROBOT_PATH_STEP = 2;
/** 이보다 가까운 연속 점은 하나로 (inch) */
const SAME_POINT_INCH = 0.01;

export interface RobotPath {
  past: Point2[];   // 0틱 ~ 보는 틱 (끝 = 보는 틱의 로봇 중심)
  future: Point2[]; // 보는 틱 ~ 머리 틱 (시작 = 보는 틱의 로봇 중심), 보는 틱 = 머리면 점 1개
}

export interface ScenePaths {
  robot1: RobotPath;
  robot2: RobotPath;
}

/** 표본 틱: from부터 ROBOT_PATH_STEP 간격 + 끝 틱 (from ≤ to) */
function sampleTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  for (let t = from; t < to; t += ROBOT_PATH_STEP) ticks.push(t);
  ticks.push(to);
  return ticks;
}

function pathOf(frames: readonly DeepReadonly<TimelineFrame>[], ticks: readonly number[], robot: 'r1' | 'r2'): Point2[] {
  const out: Point2[] = [];
  for (const t of ticks) {
    const { x, y } = frames[t][robot];
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - x) < SAME_POINT_INCH && Math.abs(last.y - y) < SAME_POINT_INCH) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * 두 로봇의 동선 (프레임 0 ~ 머리, 보는 틱으로 나눔). 보는 틱은 [0, 머리]로 자른다. 프레임이 없으면 null.
 * 지나온 / 앞으로 갈 동선은 보는 틱의 점을 함께 가져 선이 끊기지 않는다
 */
export function robotPaths(frames: readonly DeepReadonly<TimelineFrame>[], viewTick: number): ScenePaths | null {
  if (frames.length === 0) return null;
  const head = frames.length - 1;
  const view = Math.min(Math.max(Math.floor(Number.isFinite(viewTick) ? viewTick : 0), 0), head);
  const pastTicks = sampleTicks(0, view);
  const futureTicks = sampleTicks(view, head);
  const of = (robot: 'r1' | 'r2'): RobotPath => ({ past: pathOf(frames, pastTicks, robot), future: pathOf(frames, futureTicks, robot) });
  return { robot1: of('r1'), robot2: of('r2') };
}
