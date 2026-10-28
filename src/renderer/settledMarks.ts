// 종료 정착 위치 표시 (명세서 3.7 경기 종료 강조, 12-14): 득점은 0:00 뒤 모두 멈춘 상태로 판정하므로(2.6.4항),
// 종료 프레임(0:00 상태) 위에 0:00 뒤 움직인 로봇 / 바닥 기물의 정착 자리를 흐린 점선 윤곽으로 겹쳐 그린다.
// 판정 강조(주차 외곽 / GARDEN 인정 테두리)는 판정한 자리에 그리므로, 움직인 것은 0:00 자리 대신 정착 자리에 그린다.
// 값은 scoreBreakdown.settle만 읽는다 (규칙의 단일 출처 = 엔진).

import type { DeepReadonly, GamePiece, ScoreBreakdown } from '../core/types';

export const SETTLED_FILL_ALPHA = 0.35;          // 정착 자리 채움 불투명도 (진영색 / 기물색)
export const SETTLED_DASH: readonly number[] = [5, 4]; // 정착 자리 윤곽 점선 (px)

export interface SettledView {
  robots: { id: 'robot1' | 'robot2'; x: number; y: number; heading: number; parked: boolean }[];
  pieces: { id: string; type: GamePiece['type']; x: number; y: number; scored: boolean }[];
  // 판정 강조를 0:00 자리에 그리지 않을 것 (정착 자리에 그림)
  movedRobots: ReadonlySet<'robot1' | 'robot2'>;
  movedPieces: ReadonlySet<string>;
}

/** 종료 프레임의 정착 표시. 내역이 없거나(종료 전) 0:00 뒤 움직인 것이 없으면 null */
export function settledView(breakdown: DeepReadonly<ScoreBreakdown> | null | undefined): SettledView | null {
  const settle = breakdown?.settle;
  if (!breakdown || !settle || (settle.robots.length === 0 && settle.pieces.length === 0)) return null;
  const parked = new Set(breakdown.parkedRobots);
  const scored = new Set(breakdown.gardenPieceIds);
  return {
    robots: settle.robots.map((r) => ({ id: r.id, x: r.x, y: r.y, heading: r.heading, parked: parked.has(r.id) })),
    pieces: settle.pieces.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, scored: scored.has(p.id) })),
    movedRobots: new Set(settle.robots.map((r) => r.id)),
    movedPieces: new Set(settle.pieces.map((p) => p.id)),
  };
}
