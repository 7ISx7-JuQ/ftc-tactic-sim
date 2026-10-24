// 렌더링 프레임 보간 (명세서 3.7 프레임 보간, 17-1a / 17-1b): 두 틱 프레임 사이의 표시용 프레임. DOM 비의존 순수 함수.
// - 로봇 자세(x, y, heading)를 내삽한다. 로봇 기준으로 그리는 것(적재물 / 조준선 / 배지 등)은 그 자세를 따라 함께 움직인다.
// - 17-1b: 바닥 기물(두 프레임에서 같은 상태 ON_FIELD / IN_GARDEN일 때만)과 HIVE TIP 낙하 진행 시간도 같은 비율로 내삽한다.
//   흡입 / 착지 / GARDEN 진입 / TIP 내려놓기처럼 상태가 바뀌는 틱은 b 그대로 (착지 겹침 보정의 자리 이동도 착지 틱이라 여기서 빠짐).
//   모두 같은 비율이라 로봇이 미는 공과 로봇의 간격도 함께 내삽된다. 비행 공은 렌더러가 틱 안 시간(tickOffset)으로 그린다.
// - 그 밖의 항목(HIVE 셀 / 게이지 / 점수)은 다음 프레임 b 그대로다. 외삽은 하지 않는다 (실제로 가지 않은 자리를 보여 주므로).

import { angleDifference, normalizeAngle } from '../core/kinematics';
import type { DeepReadonly, GamePiece, HiveState, RobotState, TimelineFrame } from '../core/types';

type Frame = DeepReadonly<TimelineFrame>;
type Piece = DeepReadonly<GamePiece>;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpRobot(a: DeepReadonly<RobotState>, b: DeepReadonly<RobotState>, alpha: number): DeepReadonly<RobotState> {
  return {
    ...b,
    x: lerp(a.x, b.x, alpha),
    y: lerp(a.y, b.y, alpha),
    heading: normalizeAngle(a.heading + angleDifference(b.heading, a.heading) * alpha), // 짧은 쪽 회전 (179° → −179°는 2°)
  };
}

const FLOOR_STATES: ReadonlySet<GamePiece['state']> = new Set(['ON_FIELD', 'IN_GARDEN']);

/** 바닥 기물: 같은 id가 두 프레임에서 같은 바닥 상태일 때만 위치 내삽. 아무것도 움직이지 않았으면 b의 배열 그대로 */
function lerpPieces(a: readonly Piece[], b: readonly Piece[], alpha: number): readonly Piece[] {
  let byId: Map<string, Piece> | null = null;
  let out: Piece[] | null = null;
  b.forEach((pb, i) => {
    if (!FLOOR_STATES.has(pb.state)) return;
    let pa: Piece | undefined = a[i];
    if (pa?.id !== pb.id) pa = (byId ??= new Map(a.map(p => [p.id, p]))).get(pb.id); // 배열 순서는 보통 같음
    if (!pa || pa.state !== pb.state || (pa.x === pb.x && pa.y === pb.y)) return;
    out ??= [...b];
    out[i] = { ...pb, x: lerp(pa.x, pb.x, alpha), y: lerp(pa.y, pb.y, alpha) };
  });
  return out ?? b;
}

/** TIP 낙하 진행 시간: 두 프레임 모두 TIP 진행 중일 때만 내삽 (시작 / 끝 틱은 b 그대로) */
function lerpHive(a: DeepReadonly<HiveState>, b: DeepReadonly<HiveState>, alpha: number): DeepReadonly<HiveState> {
  if (!a.isTipping || !b.isTipping || b.tipProgressTimer <= a.tipProgressTimer) return b;
  return { ...b, tipProgressTimer: lerp(a.tipProgressTimer, b.tipProgressTimer, alpha) };
}

/**
 * 프레임 a(직전 틱) → b(다음 틱) 사이 alpha ∈ [0, 1]의 표시용 프레임. alpha는 [0, 1]로 자르고(비유한값 = 1),
 * alpha = 1이면 b 자체(같은 참조 — 보간 전 그림과 같음). 바뀐 항목만 새로 만들고 입력 프레임은 바꾸지 않는다.
 * 비행 공은 렌더러에 틱 안 시간 tickOffset = alpha − 1을 함께 넘겨 그린다 (frameTickOffset)
 */
export function interpolateFrame(a: Frame, b: Frame, alpha: number): Frame {
  const t = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
  if (t >= 1) return b;
  const hive = lerpHive(a.field.hive, b.field.hive, t);
  return {
    ...b,
    r1: lerpRobot(a.r1, b.r1, t),
    r2: lerpRobot(a.r2, b.r2, t),
    pieces: lerpPieces(a.pieces, b.pieces, t),
    field: hive === b.field.hive ? b.field : { ...b.field, hive },
  };
}

/** interpolateFrame(a, b, alpha)를 그릴 때 렌더러에 넘길 틱 안 시간 (틱, [−1, 0]): 비행 공 경과 시간 = (b.tick + 이 값 − 발사 틱) · dt */
export function frameTickOffset(alpha: number): number {
  const t = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
  return t - 1;
}
