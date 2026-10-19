// HIVE 터널 지붕 불투명도 (명세서 3.7 HIVE 터널 지붕, 13-1): 순수 계산 함수
// 로봇 / 바닥 공이 HIVE 아래 터널(12-1)로 들어가면 그 위의 HIVE(터널 부분 = 지붕)를 흐리게 그려 아래가 보이게 한다.
// t = max(로봇별 "몸체 OBB ∩ 터널 AABB 넓이 / 몸체 넓이", 바닥 기물별 "기물 원 ∩ 터널 AABB 넓이 / 원 넓이"),
// 불투명도 = 1 − t × (1 − ROOF_MIN_OPACITY). 겹친 비율로 연속적으로 바뀌어 입구를 오갈 때 깜빡이지 않고,
// 프레임만의 함수라 스크러빙 / 재생 / 분기에서 같은 틱은 같은 그림.

import { HIVE_TUNNEL, PIECE_PHYSICS, getRobotOBB } from '../core/collision';
import type { AABB, OBB } from '../core/collision';
import type { GamePiece, RobotConfig, RobotState } from '../core/types';
import type { Point2 } from './viewTransform';

/** 터널에 무언가 꽉 찼을 때(t = 1)의 지붕 불투명도 (임시값, 화면을 보며 조정) */
export const ROOF_MIN_OPACITY = 0.4;

// 원 ∩ 직사각형 넓이의 수치 적분 표본 수 (x = cx + r·sinθ 치환으로 양 끝 특이점이 없어 64개면 상대 오차 1e-4 수준)
const CIRCLE_AREA_SAMPLES = 64;

function obbCorners(obb: OBB): Point2[] {
  const [f, r] = obb.axes;
  const [hl, hw] = obb.halfExtents;
  const at = (a: number, b: number) => ({ x: obb.center.x + f.x * a + r.x * b, y: obb.center.y + f.y * a + r.y * b });
  return [at(hl, -hw), at(hl, hw), at(-hl, hw), at(-hl, -hw)];
}

// 볼록 다각형을 축 정렬 반평면 하나로 자름 (Sutherland–Hodgman 한 단계)
function clipHalfPlane(poly: Point2[], inside: (p: Point2) => boolean, cross: (a: Point2, b: Point2) => Point2): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = inside(a);
    const inb = inside(b);
    if (ina) out.push(a);
    if (ina !== inb) out.push(cross(a, b));
  }
  return out;
}

function polygonArea(poly: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** OBB ∩ AABB 넓이 (정확) */
export function obbBoxOverlapArea(obb: OBB, box: AABB): number {
  const atX = (x: number) => (a: Point2, b: Point2) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const atY = (y: number) => (a: Point2, b: Point2) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  let poly = obbCorners(obb);
  poly = clipHalfPlane(poly, (p) => p.x >= box.minX, atX(box.minX));
  poly = clipHalfPlane(poly, (p) => p.x <= box.maxX, atX(box.maxX));
  poly = clipHalfPlane(poly, (p) => p.y >= box.minY, atY(box.minY));
  poly = clipHalfPlane(poly, (p) => p.y <= box.maxY, atY(box.maxY));
  return poly.length < 3 ? 0 : polygonArea(poly);
}

/** 원 ∩ AABB 넓이: 세로 현 길이 ∩ [minY, maxY]를 x로 적분 (x = cx + r·sinθ, 중점 규칙) */
export function circleBoxOverlapArea(cx: number, cy: number, r: number, box: AABB): number {
  if (!(r > 0)) return 0;
  if (cx - r >= box.maxX || cx + r <= box.minX || cy - r >= box.maxY || cy + r <= box.minY) return 0;
  if (cx - r >= box.minX && cx + r <= box.maxX && cy - r >= box.minY && cy + r <= box.maxY) return Math.PI * r * r;
  const lo = Math.asin(Math.max(-1, (box.minX - cx) / r));
  const hi = Math.asin(Math.min(1, (box.maxX - cx) / r));
  if (!(hi > lo)) return 0;
  const step = (hi - lo) / CIRCLE_AREA_SAMPLES;
  let sum = 0;
  for (let i = 0; i < CIRCLE_AREA_SAMPLES; i++) {
    const theta = lo + (i + 0.5) * step;
    const h = r * Math.cos(theta); // 현의 반길이
    const len = Math.min(box.maxY, cy + h) - Math.max(box.minY, cy - h);
    if (len > 0) sum += len * r * Math.cos(theta);
  }
  return sum * step;
}

/** 지붕 아래를 가리는 정도 t의 대상: 로봇 몸체 / 바닥 기물 (ON_FIELD / IN_GARDEN — 렌더러가 바닥에 그리는 기물) */
export interface RoofRobot {
  pose: Pick<RobotState, 'x' | 'y' | 'heading'>;
  size: Pick<RobotConfig, 'length' | 'width'>;
}
export type RoofPiece = Pick<GamePiece, 'type' | 'state' | 'x' | 'y'>;

/** 터널에 들어간 정도 t ∈ [0, 1]: 로봇 / 바닥 기물별 "터널과 겹친 넓이 / 자기 넓이"의 최댓값 */
export function tunnelOccupancy(robots: readonly RoofRobot[], pieces: readonly RoofPiece[]): number {
  let t = 0;
  for (const { pose, size } of robots) {
    const area = size.length * size.width;
    if (area > 0) t = Math.max(t, obbBoxOverlapArea(getRobotOBB(pose, size), HIVE_TUNNEL) / area);
  }
  for (const piece of pieces) {
    // IN_HIVE 좌표는 조준점 바닥 투영(늘 터널 안), CONTROLLED / IN_FLIGHT 등도 바닥에 그리지 않으므로 제외
    if (piece.state !== 'ON_FIELD' && piece.state !== 'IN_GARDEN') continue;
    const r = PIECE_PHYSICS[piece.type].radius;
    t = Math.max(t, circleBoxOverlapArea(piece.x, piece.y, r, HIVE_TUNNEL) / (Math.PI * r * r));
  }
  return Math.min(1, Math.max(0, t));
}

/** 지붕 불투명도 = 1 − t × (1 − ROOF_MIN_OPACITY). 터널이 비면 1 (v1과 같은 불투명) */
export function tunnelRoofOpacity(robots: readonly RoofRobot[], pieces: readonly RoofPiece[]): number {
  return 1 - tunnelOccupancy(robots, pieces) * (1 - ROOF_MIN_OPACITY);
}
