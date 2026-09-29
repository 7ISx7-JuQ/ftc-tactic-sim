// Canvas 2D 렌더러 (React 비의존 순수 함수 모음)
// 좌표계 (명세서 2.1): 좌상단 (0,0) ~ 우하단 (144,144), +x 오른쪽, +y 아래쪽, Y=144 방향이 AUDIENCE

import {
  FIELD_SIZE,
  FLOWER_ALLIANCES,
  FLOWER_CIRCLES,
  FLOWER_IDS,
  GARDEN_AABB,
  HIVE_AABB,
  HIVE_CENTER_X,
  LOADING_ZONE_AABB,
} from '../core/collision';
import type { AABB } from '../core/collision';
import type { GamePiece } from '../core/types';
import { canvasFont } from './fonts';

// 1. 필드 스케일 상수 (명세서 2.1)
export const FIELD_SIZE_INCH = FIELD_SIZE;
export const PX_PER_INCH = 5;
export const CANVAS_SIZE_PX = FIELD_SIZE_INCH * PX_PER_INCH; // 720

// 2. 좌표 변환 유틸
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;      // 좌상단 x
  y: number;      // 좌상단 y
  width: number;
  height: number;
}

export interface Circle {
  x: number;      // 중심 x
  y: number;      // 중심 y
  radius: number;
}

export function inchToPx(inch: number): number {
  return inch * PX_PER_INCH;
}

export function toCanvasPoint(x: number, y: number): { pxX: number; pxY: number } {
  return { pxX: inchToPx(x), pxY: inchToPx(y) };
}

export function toCanvasRect(rect: Rect): Rect {
  return {
    x: inchToPx(rect.x),
    y: inchToPx(rect.y),
    width: inchToPx(rect.width),
    height: inchToPx(rect.height),
  };
}

// 3. 필드 구조물 배치 (명세서 2.2, 인치 단위)
// 좌표의 단일 출처는 코어(collision.ts)이며, 렌더러는 이를 그리기용 Rect/Circle 형식으로만 변환
// Red/Blue 구조물은 필드 중심 (72, 72) 기준 180° 점대칭: (x, y) ↔ (144 - x, 144 - y)
export type Alliance = 'RED' | 'BLUE';
export type HiveCell = 'OPPOSITE_CELL' | 'AUDIENCE_CELL';

function aabbToRect(box: AABB): Rect {
  return { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

const FIELD_CENTER = FIELD_SIZE_INCH / 2;
const HIVE_LEFT = HIVE_AABB.minX;                  // 47.27
const HIVE_TOP = HIVE_AABB.minY;                   // 52.525
const HIVE_HEIGHT = HIVE_AABB.maxY - HIVE_AABB.minY; // 38.95
// 진영별 HIVE 폭: 바깥 모서리는 전체 프레임에 맞추고 중심은 명세 좌표 유지 (가운데 약 2.9" 중앙 프레임)
const HIVE_UNIT_WIDTH = 2 * (HIVE_CENTER_X.RED - HIVE_LEFT); // 23.96

function hiveCellRect(alliance: Alliance, cell: HiveCell): Rect {
  return {
    x: HIVE_CENTER_X[alliance] - HIVE_UNIT_WIDTH / 2,
    y: cell === 'OPPOSITE_CELL' ? HIVE_TOP : FIELD_CENTER, // Y=72 기준 상하 분할
    width: HIVE_UNIT_WIDTH,
    height: HIVE_HEIGHT / 2,
  };
}

export const FIELD_LAYOUT = {
  // 솔리드 장애물: 정중앙 (72, 72) 중심 49.46 x 38.95 프레임
  hive: aabbToRect(HIVE_AABB),
  // 진영별 HIVE 2-Cell (좌측 C열 Red, 우측 D열 Blue)
  hiveCells: {
    RED: { OPPOSITE_CELL: hiveCellRect('RED', 'OPPOSITE_CELL'), AUDIENCE_CELL: hiveCellRect('RED', 'AUDIENCE_CELL') },
    BLUE: { OPPOSITE_CELL: hiveCellRect('BLUE', 'OPPOSITE_CELL'), AUDIENCE_CELL: hiveCellRect('BLUE', 'AUDIENCE_CELL') },
  } as Record<Alliance, Record<HiveCell, Rect>>,
  // 솔리드 장애물: 반지름 2.0 원형
  flowers: FLOWER_CIRCLES.map((c, i) => ({
    id: FLOWER_IDS[i],
    side: FLOWER_ALLIANCES[i],
    x: c.center.x,
    y: c.center.y,
    radius: c.radius,
  })) as (Circle & { id: string; side: Alliance })[],
  // 통과 가능 구역: 23 x 2
  gardens: { RED: aabbToRect(GARDEN_AABB.RED), BLUE: aabbToRect(GARDEN_AABB.BLUE) } as Record<Alliance, Rect>,
  // 통과 가능 구역: 11 x 23
  loadingZones: {
    RED: aabbToRect(LOADING_ZONE_AABB.RED),
    BLUE: aabbToRect(LOADING_ZONE_AABB.BLUE),
  } as Record<Alliance, Rect>,
};

// 4. 색상 팔레트
// 진영 공식 색 (명세서 3.8, 09-6b): RGB 두 값에서 모든 진영 색을 계산 — 기본(로봇 몸체 / 진영 NECTAR / 상향 셀),
// 어둡게 15%(테두리 가독성), 흰색과 7 : 3으로 섞은 옅은 색(하향 셀), 25% 투명(GARDEN / 로딩 존 바탕)
// 비활성(2v0에서 쓰이지 않는 상대 진영 전용 구조물): 회색에 진영 색을 조금만 섞어 진영은 알아보되 한눈에 비활성으로 보이게
export const ALLIANCE_RGB: Readonly<Record<Alliance, readonly [number, number, number]>> = {
  RED: [223, 0, 27],
  BLUE: [15, 83, 167],
};

export interface AllianceShades {
  base: string;
  dark: string;
  tint: string;
  fill: string;
  inactiveFill: string;   // 비활성 구역 바탕 (진영 색 8% 투명)
  inactiveCell: string;   // 비활성 HIVE 셀 (진영 색 12% + 밝은 회색)
  inactiveStroke: string; // 비활성 테두리 (진영 색 35% + 회색)
}

const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function allianceShades(rgb: readonly [number, number, number]): AllianceShades {
  return {
    base: toHex(rgb),
    dark: toHex(rgb.map((v) => v * 0.85)),
    tint: toHex(rgb.map((v) => v * 0.3 + 255 * 0.7)),
    fill: `rgba(${rgb.join(', ')}, 0.25)`,
    inactiveFill: `rgba(${rgb.join(', ')}, 0.08)`,
    inactiveCell: toHex(rgb.map((v) => v * 0.12 + 222 * 0.88)),
    inactiveStroke: toHex(rgb.map((v) => v * 0.35 + 170 * 0.65)),
  };
}

export const ALLIANCE_COLORS: Readonly<Record<Alliance, AllianceShades>> = {
  RED: allianceShades(ALLIANCE_RGB.RED),
  BLUE: allianceShades(ALLIANCE_RGB.BLUE),
};

export const COLORS = {
  fieldBg: '#d9d9d9',
  tileLine: 'rgba(0, 0, 0, 0.12)',
  wall: '#222222',
  hiveFrame: '#4b5563',
  hiveFrameStroke: '#1f2937',
  upHighlight: '#facc15',
  flowerFill: '#f28ad0',
  flowerStroke: '#8e2f6f',
  redFill: ALLIANCE_COLORS.RED.fill,
  redCellDown: ALLIANCE_COLORS.RED.tint,
  redCellUp: ALLIANCE_COLORS.RED.base,
  redStroke: ALLIANCE_COLORS.RED.dark,
  blueFill: ALLIANCE_COLORS.BLUE.fill,
  blueCellDown: ALLIANCE_COLORS.BLUE.tint,
  blueCellUp: ALLIANCE_COLORS.BLUE.base,
  blueStroke: ALLIANCE_COLORS.BLUE.dark,
  label: '#111111',
  labelOnDark: '#ffffff',
  pollenFill: '#fde047',
  pollenStroke: '#a16207',
};

// 5. 기본 도형 헬퍼
const STROKE_WIDTH = 2;

export function fillStrokeRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fill: string,
  stroke: string,
  dashed = false,
): void {
  const r = toCanvasRect(rect);
  const inset = STROKE_WIDTH / 2; // 테두리를 구역 안쪽에 그려 필드 경계에서 잘리지 않게 함
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = STROKE_WIDTH;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.strokeRect(r.x + inset, r.y + inset, r.width - STROKE_WIDTH, r.height - STROKE_WIDTH);
  ctx.restore();
}

interface LabelOptions {
  size?: number;
  align?: CanvasTextAlign;
  color?: string;
  rotate?: number; // 라디안
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Point,
  { size = 12, align = 'center', color = COLORS.label, rotate = 0 }: LabelOptions = {},
): void {
  const { pxX, pxY } = toCanvasPoint(at.x, at.y);
  ctx.save();
  ctx.translate(pxX, pxY);
  ctx.rotate(rotate);
  ctx.fillStyle = color;
  ctx.font = canvasFont(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// 6. 구조물별 렌더 함수
export function drawFieldBackground(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLORS.fieldBg;
  ctx.fillRect(0, 0, CANVAS_SIZE_PX, CANVAS_SIZE_PX);

  // 24인치 타일 그리드
  ctx.strokeStyle = COLORS.tileLine;
  ctx.lineWidth = 1;
  for (let i = 24; i < FIELD_SIZE_INCH; i += 24) {
    const p = inchToPx(i);
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_SIZE_PX);
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_SIZE_PX, p);
    ctx.stroke();
  }

  // 외곽 벽
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, CANVAS_SIZE_PX - 4, CANVAS_SIZE_PX - 4);
  ctx.restore();
}

// GARDEN은 높이 2인치(10px)라 라벨을 필드 안쪽 방향 바깥에 배치
// ally가 주어지면 상대 진영 GARDEN은 비활성 스타일 (2v0, 명세서 3.8)
export function drawGardens(ctx: CanvasRenderingContext2D, withLabels = true, ally?: Alliance): void {
  const { RED, BLUE } = FIELD_LAYOUT.gardens;
  const style = (side: Alliance) =>
    ally !== undefined && side !== ally
      ? [ALLIANCE_COLORS[side].inactiveFill, ALLIANCE_COLORS[side].inactiveStroke] as const
      : [ALLIANCE_COLORS[side].fill, ALLIANCE_COLORS[side].dark] as const;
  fillStrokeRect(ctx, RED, ...style('RED'));
  fillStrokeRect(ctx, BLUE, ...style('BLUE'));
  if (!withLabels) return;

  const rc = rectCenter(RED);
  const bc = rectCenter(BLUE);
  drawLabel(ctx, 'RED GARDEN', { x: rc.x, y: RED.y - 2.5 }, { size: 10, color: COLORS.redStroke });
  drawLabel(ctx, 'BLUE GARDEN', { x: bc.x, y: BLUE.y + BLUE.height + 2.5 }, { size: 10, color: COLORS.blueStroke });
}

// LOADING ZONE은 세로로 긴 구역(11 x 23)이라 라벨을 90° 회전해 내부에 배치
// ally가 주어지면 상대 진영 로딩 존은 비활성 스타일 (2v0, 명세서 3.8)
export function drawLoadingZones(ctx: CanvasRenderingContext2D, withLabels = true, ally?: Alliance): void {
  const { RED, BLUE } = FIELD_LAYOUT.loadingZones;
  const style = (side: Alliance) =>
    ally !== undefined && side !== ally
      ? [ALLIANCE_COLORS[side].inactiveFill, ALLIANCE_COLORS[side].inactiveStroke] as const
      : [ALLIANCE_COLORS[side].fill, ALLIANCE_COLORS[side].dark] as const;
  fillStrokeRect(ctx, RED, ...style('RED'), true);
  fillStrokeRect(ctx, BLUE, ...style('BLUE'), true);
  if (!withLabels) return;
  drawLabel(ctx, 'RED LOADING ZONE', rectCenter(RED), { size: 10, color: COLORS.redStroke, rotate: -Math.PI / 2 });
  drawLabel(ctx, 'BLUE LOADING ZONE', rectCenter(BLUE), { size: 10, color: COLORS.blueStroke, rotate: Math.PI / 2 });
}

const HIVE_CELL_INSET = 0.8;   // 프레임 안쪽 셀 박스 여백 (inch)

// 셀 박스 (진영 HIVE 칸에서 프레임 안쪽 여백을 뺀 영역, inch)
export function hiveCellBox(alliance: Alliance, cell: HiveCell): Rect {
  const outer = FIELD_LAYOUT.hiveCells[alliance][cell];
  return {
    x: outer.x + HIVE_CELL_INSET,
    y: outer.y + HIVE_CELL_INSET,
    width: outer.width - HIVE_CELL_INSET * 2,
    height: outer.height - HIVE_CELL_INSET * 2,
  };
}

// HIVE 정적 바탕 (장면 렌더러 정적 레이어용, 라벨 / 상태 없음): 프레임 + 셀 박스
// 아군 셀은 진영 기본색, 상대 셀은 비활성 스타일 (상향 방향 / 개수 표시 없음, 명세서 3.8)
export function drawHiveBase(ctx: CanvasRenderingContext2D, ally: Alliance): void {
  const hive = FIELD_LAYOUT.hive;
  fillStrokeRect(ctx, hive, COLORS.hiveFrame, COLORS.hiveFrameStroke);
  const alliances: Alliance[] = ['RED', 'BLUE'];
  const cells: HiveCell[] = ['OPPOSITE_CELL', 'AUDIENCE_CELL'];
  for (const alliance of alliances) {
    const isAlly = alliance === ally;
    const fill = isAlly ? ALLIANCE_COLORS[alliance].tint : ALLIANCE_COLORS[alliance].inactiveCell;
    const stroke = isAlly ? ALLIANCE_COLORS[alliance].dark : ALLIANCE_COLORS[alliance].inactiveStroke;
    for (const cell of cells) fillStrokeRect(ctx, hiveCellBox(alliance, cell), fill, stroke);
  }
  ctx.save();
  ctx.strokeStyle = COLORS.hiveFrameStroke;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(inchToPx(hive.x), inchToPx(FIELD_CENTER));
  ctx.lineTo(inchToPx(hive.x + hive.width), inchToPx(FIELD_CENTER));
  ctx.stroke();
  ctx.restore();
}

export function pieceColors(piece: Pick<GamePiece, 'type' | 'alliance'>): { fill: string; stroke: string } {
  if (piece.type === 'POLLEN') return { fill: COLORS.pollenFill, stroke: COLORS.pollenStroke };
  return piece.alliance === 'BLUE'
    ? { fill: COLORS.blueCellUp, stroke: COLORS.blueStroke }
    : { fill: COLORS.redCellUp, stroke: COLORS.redStroke };
}

// FLOWER 원통 (FLOWER 내용물은 장면 렌더러의 필드 밖 게이지로 표시, 명세서 3.7). FLOWER는 중립이라 진영색 테두리 없음 (09-6b)
// FLOWER는 반지름 2인치(10px)라 라벨을 가장 가까운 벽의 반대편(필드 안쪽) 바깥에 배치
export function drawFlowers(ctx: CanvasRenderingContext2D, withLabels = true): void {
  for (const [i, flower] of FIELD_LAYOUT.flowers.entries()) {
    const { pxX, pxY } = toCanvasPoint(flower.x, flower.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pxX, pxY, inchToPx(flower.radius), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.flowerFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.flowerStroke;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.stroke();
    ctx.restore();
    if (!withLabels) continue;

    const offset = flower.radius + 1;
    const distX = Math.min(flower.x, FIELD_SIZE_INCH - flower.x);
    const distY = Math.min(flower.y, FIELD_SIZE_INCH - flower.y);
    let labelAt: Point;
    let align: CanvasTextAlign = 'center';
    if (distX <= distY) {
      // 좌/우 벽에 붙은 FLOWER → 가로 방향으로 라벨
      const fromLeft = flower.x < FIELD_CENTER;
      labelAt = { x: flower.x + (fromLeft ? offset : -offset), y: flower.y };
      align = fromLeft ? 'left' : 'right';
    } else {
      // 위/아래 벽에 붙은 FLOWER → 세로 방향으로 라벨
      const fromTop = flower.y < FIELD_CENTER;
      labelAt = { x: flower.x, y: flower.y + (fromTop ? offset + 1 : -(offset + 1)) };
    }
    drawLabel(ctx, `FLOWER ${i + 1}`, labelAt, { size: 10, align, color: COLORS.flowerStroke });
  }
}
