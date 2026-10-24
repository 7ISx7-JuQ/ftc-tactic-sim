// 렌더링 프레임 보간 (명세서 3.7 프레임 보간, 17-1a): 두 틱 프레임 사이의 표시용 프레임. DOM 비의존 순수 함수.
// - 로봇 자세(x, y, heading)만 내삽한다. 로봇 기준으로 그리는 것(적재물 / 조준선 / 배지 등)은 그 자세를 따라 함께 움직인다.
// - 그 밖의 항목(바닥 기물, 비행 / 낙하, HIVE, 점수)은 다음 프레임 b 그대로다. b를 바탕으로 해 로봇이 미는 바닥 공보다
//   로봇이 앞서 그려지지 않는다 (로봇은 b보다 최대 1틱 뒤 → 겹쳐 보이지 않음).
// - 외삽은 하지 않는다 (로봇이 실제로 가지 않은 자리를 보여 주므로).

import { angleDifference, normalizeAngle } from '../core/kinematics';
import type { DeepReadonly, RobotState, TimelineFrame } from '../core/types';

type Frame = DeepReadonly<TimelineFrame>;

function lerpRobot(a: DeepReadonly<RobotState>, b: DeepReadonly<RobotState>, alpha: number): DeepReadonly<RobotState> {
  return {
    ...b,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    heading: normalizeAngle(a.heading + angleDifference(b.heading, a.heading) * alpha), // 짧은 쪽 회전 (179° → −179°는 2°)
  };
}

/**
 * 프레임 a(직전 틱) → b(다음 틱) 사이 alpha ∈ [0, 1]의 표시용 프레임. alpha는 [0, 1]로 자르고(비유한값 = 1),
 * alpha = 1이면 b 자체(같은 참조 — 보간 전 그림과 같음). 로봇 2개와 프레임 객체만 새로 만들고 입력 프레임은 바꾸지 않는다
 */
export function interpolateFrame(a: Frame, b: Frame, alpha: number): Frame {
  const t = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
  if (t >= 1) return b;
  return { ...b, r1: lerpRobot(a.r1, b.r1, t), r2: lerpRobot(a.r2, b.r2, t) };
}
