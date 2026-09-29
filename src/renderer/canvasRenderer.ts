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
  PIECE_PHYSICS,
} from '../core/collision';
import type { AABB } from '../core/collision';
import { hiveTipPollenThreshold } from '../core/types';
import type { GamePiece } from '../core/types';

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

// HIVE 표시용 상태 (엔진 연동 전 기본값: 명세서 2.6.1 초기 UP 상태)
export interface HiveView {
  upwardCell: HiveCell;
  nectarInUpwardCell: number;
  pollenInUpwardCell: number;
}

export const INITIAL_HIVE_VIEW: Record<Alliance, HiveView> = {
  RED: { upwardCell: 'AUDIENCE_CELL', nectarInUpwardCell: 0, pollenInUpwardCell: 0 },
  BLUE: { upwardCell: 'OPPOSITE_CELL', nectarInUpwardCell: 0, pollenInUpwardCell: 0 },
};

// 4. 색상 팔레트
// 진영 공식 색 (명세서 3.8, 09-6b): RGB 두 값에서 모든 진영 색을 계산 — 기본(로봇 몸체 / 진영 NECTAR / 상향 셀),
// 어둡게 15%(테두리 / 라벨 글자 가독성), 흰색과 7 : 3으로 섞은 옅은 색(하향 셀), 25% 투명(GARDEN / 로딩 존 바탕)
export const ALLIANCE_RGB: Readonly<Record<Alliance, readonly [number, number, number]>> = {
  RED: [223, 0, 27],
  BLUE: [15, 83, 167],
};

export interface AllianceShades {
  base: string;
  dark: string;
  tint: string;
  fill: string;
}

const toHex = (rgb: readonly number[]) =>
  `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function allianceShades(rgb: readonly [number, number, number]): AllianceShades {
  return {
    base: toHex(rgb),
    dark: toHex(rgb.map((v) => v * 0.85)),
    tint: toHex(rgb.map((v) => v * 0.3 + 255 * 0.7)),
    fill: `rgba(${rgb.join(', ')}, 0.25)`,
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
  // 2v0에서 쓰이지 않는 상대 진영 전용 구조물 (채도 제거, 명세서 3.7)
  unusedFill: 'rgba(156, 163, 175, 0.22)',
  unusedCell: '#d1d5db',
  unusedStroke: '#9ca3af',
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
  ctx.font = `bold ${size}px system-ui, sans-serif`;
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
export function drawGardens(ctx: CanvasRenderingContext2D, withLabels = true): void {
  const { RED, BLUE } = FIELD_LAYOUT.gardens;
  fillStrokeRect(ctx, RED, COLORS.redFill, COLORS.redStroke);
  fillStrokeRect(ctx, BLUE, COLORS.blueFill, COLORS.blueStroke);
  if (!withLabels) return;

  const rc = rectCenter(RED);
  const bc = rectCenter(BLUE);
  drawLabel(ctx, 'RED GARDEN', { x: rc.x, y: RED.y - 2.5 }, { size: 10, color: COLORS.redStroke });
  drawLabel(ctx, 'BLUE GARDEN', { x: bc.x, y: BLUE.y + BLUE.height + 2.5 }, { size: 10, color: COLORS.blueStroke });
}

// LOADING ZONE은 세로로 긴 구역(11 x 23)이라 라벨을 90° 회전해 내부에 배치
// ally가 주어지면 상대 진영 로딩 존은 채도를 뺀 "사용 불가" 스타일 (2v0, 명세서 3.7)
export function drawLoadingZones(ctx: CanvasRenderingContext2D, withLabels = true, ally?: Alliance): void {
  const { RED, BLUE } = FIELD_LAYOUT.loadingZones;
  const unused = (side: Alliance) => ally !== undefined && side !== ally;
  fillStrokeRect(ctx, RED, unused('RED') ? COLORS.unusedFill : COLORS.redFill, unused('RED') ? COLORS.unusedStroke : COLORS.redStroke, true);
  fillStrokeRect(ctx, BLUE, unused('BLUE') ? COLORS.unusedFill : COLORS.blueFill, unused('BLUE') ? COLORS.unusedStroke : COLORS.blueStroke, true);
  if (!withLabels) return;
  drawLabel(ctx, 'RED LOADING ZONE', rectCenter(RED), { size: 10, color: COLORS.redStroke, rotate: -Math.PI / 2 });
  drawLabel(ctx, 'BLUE LOADING ZONE', rectCenter(BLUE), { size: 10, color: COLORS.blueStroke, rotate: Math.PI / 2 });
}

const HIVE_CELL_INSET = 0.8;   // 프레임 안쪽 셀 박스 여백 (inch)
const NECTAR_RADIUS = PIECE_PHYSICS.NECTAR.radius; // 슬롯 크기 = NECTAR 직경 3.6"

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

function drawHiveCell(
  ctx: CanvasRenderingContext2D,
  alliance: Alliance,
  cell: HiveCell,
  view: HiveView,
): void {
  const box = hiveCellBox(alliance, cell);
  const isUp = view.upwardCell === cell;
  const nectar = isUp ? view.nectarInUpwardCell : 0;
  const pollen = isUp ? view.pollenInUpwardCell : 0;
  const isRed = alliance === 'RED';
  const upFill = isRed ? COLORS.redCellUp : COLORS.blueCellUp;
  const downFill = isRed ? COLORS.redCellDown : COLORS.blueCellDown;
  const allianceStroke = isRed ? COLORS.redStroke : COLORS.blueStroke;
  const textColor = isUp ? COLORS.labelOnDark : allianceStroke;

  // 셀 박스: UP 셀은 진한 진영색 + 노란 하이라이트 테두리
  const r = toCanvasRect(box);
  ctx.save();
  ctx.fillStyle = isUp ? upFill : downFill;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.lineWidth = isUp ? 4 : STROKE_WIDTH;
  ctx.strokeStyle = isUp ? COLORS.upHighlight : allianceStroke;
  const inset = ctx.lineWidth / 2;
  ctx.strokeRect(r.x + inset, r.y + inset, r.width - ctx.lineWidth, r.height - ctx.lineWidth);
  ctx.restore();

  const cx = box.x + box.width / 2;
  const cellName = cell === 'OPPOSITE_CELL' ? 'OPPOSITE' : 'AUDIENCE';
  drawLabel(ctx, isUp ? `▲ UP · ${cellName}` : cellName, { x: cx, y: box.y + 3 }, {
    size: 9,
    color: isUp ? COLORS.upHighlight : textColor,
  });

  // 셀 내부 기물: NECTAR 줄 / POLLEN 줄 (개수가 많으면 셀 폭에 맞춰 축소)
  const drawRow = (count: number, radius: number, y: number, fill: string, stroke: string): void => {
    if (count <= 0) return;
    const gap = Math.min(radius * 2 + 0.6, (box.width - 1) / count);
    const r = Math.min(radius, gap / 2 - 0.1);
    for (let i = 0; i < count; i++) {
      const { pxX, pxY } = toCanvasPoint(cx + (i - (count - 1) / 2) * gap, y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(pxX, pxY, inchToPx(r), 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.restore();
    }
  };
  drawRow(nectar, NECTAR_RADIUS, box.y + box.height * 0.38, upFill, COLORS.labelOnDark);
  drawRow(pollen, PIECE_PHYSICS.POLLEN.radius, box.y + box.height * 0.63, COLORS.pollenFill, COLORS.pollenStroke);

  // 개수 + 현재 NECTAR 수 기준 팁까지 필요한 POLLEN 수 (임계 테이블)
  const label = isUp ? `N${nectar} P${pollen}/${hiveTipPollenThreshold(nectar)}` : '-';
  drawLabel(ctx, label, { x: cx, y: box.y + box.height - 3 }, { size: 11, color: textColor });
}

// HIVE: 49.46 x 38.95 프레임 안에 Red(C열) / Blue(D열) x OPPOSITE / AUDIENCE 2x2 셀
export function drawHive(
  ctx: CanvasRenderingContext2D,
  view: Record<Alliance, HiveView> = INITIAL_HIVE_VIEW,
): void {
  const hive = FIELD_LAYOUT.hive;
  fillStrokeRect(ctx, hive, COLORS.hiveFrame, COLORS.hiveFrameStroke);

  const alliances: Alliance[] = ['RED', 'BLUE'];
  const cells: HiveCell[] = ['OPPOSITE_CELL', 'AUDIENCE_CELL'];
  for (const alliance of alliances) {
    for (const cell of cells) drawHiveCell(ctx, alliance, cell, view[alliance]);
  }

  // Y=72 상하 분할선
  ctx.save();
  ctx.strokeStyle = COLORS.hiveFrameStroke;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(inchToPx(hive.x), inchToPx(FIELD_CENTER));
  ctx.lineTo(inchToPx(hive.x + hive.width), inchToPx(FIELD_CENTER));
  ctx.stroke();
  ctx.restore();

  // 진영 라벨 (프레임 위쪽 바깥)
  drawLabel(ctx, 'RED HIVE', { x: HIVE_CENTER_X.RED, y: hive.y - 2.2 }, { size: 11, color: COLORS.redStroke });
  drawLabel(ctx, 'BLUE HIVE', { x: HIVE_CENTER_X.BLUE, y: hive.y - 2.2 }, { size: 11, color: COLORS.blueStroke });
}

// HIVE 정적 바탕 (장면 렌더러 정적 레이어용, 라벨 / 상태 없음): 프레임 + 셀 박스
// 아군 셀은 진영 기본색, 상대 셀은 채도를 뺀 "사용 불가" 스타일 (상향 방향 / 개수 표시 없음, 명세서 3.7)
export function drawHiveBase(ctx: CanvasRenderingContext2D, ally: Alliance): void {
  const hive = FIELD_LAYOUT.hive;
  fillStrokeRect(ctx, hive, COLORS.hiveFrame, COLORS.hiveFrameStroke);
  const alliances: Alliance[] = ['RED', 'BLUE'];
  const cells: HiveCell[] = ['OPPOSITE_CELL', 'AUDIENCE_CELL'];
  for (const alliance of alliances) {
    const isAlly = alliance === ally;
    const fill = isAlly ? (alliance === 'RED' ? COLORS.redCellDown : COLORS.blueCellDown) : COLORS.unusedCell;
    const stroke = isAlly ? (alliance === 'RED' ? COLORS.redStroke : COLORS.blueStroke) : COLORS.unusedStroke;
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

// FLOWER 원통 (FLOWER 내용물은 장면 렌더러의 필드 밖 게이지로 표시, 명세서 3.7)
// FLOWER는 반지름 2인치(10px)라 라벨을 가장 가까운 벽의 반대편(필드 안쪽) 바깥에 배치
export function drawFlowers(ctx: CanvasRenderingContext2D, withLabels = true): void {
  for (const [i, flower] of FIELD_LAYOUT.flowers.entries()) {
    const { pxX, pxY } = toCanvasPoint(flower.x, flower.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pxX, pxY, inchToPx(flower.radius), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.flowerFill;
    ctx.fill();
    ctx.strokeStyle = flower.side === 'RED' ? COLORS.redStroke : COLORS.blueStroke;
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

// 7. 필드 전체 렌더 진입점
export function renderField(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
  drawFieldBackground(ctx);
  drawGardens(ctx);
  drawLoadingZones(ctx);
  drawHive(ctx);
  drawFlowers(ctx);
}
