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
import { HIVE_TIP_THRESHOLD } from '../core/types';
import type { FlowerState, GamePiece } from '../core/types';

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

// HIVE 표시용 상태 (엔진 연동 전 기본값: 명세서 2.5 초기 UP 상태)
export const HIVE_CELL_CAPACITY = HIVE_TIP_THRESHOLD; // TIP 임계값 (types.ts 룰 튜닝 상수)

export interface HiveView {
  upwardCell: HiveCell;
  ballsInUpwardCell: number;
}

export const INITIAL_HIVE_VIEW: Record<Alliance, HiveView> = {
  RED: { upwardCell: 'AUDIENCE_CELL', ballsInUpwardCell: 0 },
  BLUE: { upwardCell: 'OPPOSITE_CELL', ballsInUpwardCell: 0 },
};

// 4. 색상 팔레트
const COLORS = {
  fieldBg: '#d9d9d9',
  tileLine: 'rgba(0, 0, 0, 0.12)',
  wall: '#222222',
  hiveFrame: '#4b5563',
  hiveFrameStroke: '#1f2937',
  upHighlight: '#facc15',
  slotEmpty: 'rgba(255, 255, 255, 0.55)',
  flowerFill: '#f28ad0',
  flowerStroke: '#8e2f6f',
  redFill: 'rgba(220, 38, 38, 0.30)',
  redCellDown: '#e8b4b4',
  redCellUp: '#dc2626',
  redStroke: '#b91c1c',
  blueFill: 'rgba(37, 99, 235, 0.30)',
  blueCellDown: '#b4c6e8',
  blueCellUp: '#2563eb',
  blueStroke: '#1d4ed8',
  label: '#111111',
  labelOnDark: '#ffffff',
  pollenFill: '#fde047',
  pollenStroke: '#a16207',
  gaugeTube: 'rgba(142, 47, 111, 0.85)',
  gaugeLip: '#8e2f6f',
};

// 5. 기본 도형 헬퍼
const STROKE_WIDTH = 2;

function fillStrokeRect(
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
export function drawGardens(ctx: CanvasRenderingContext2D): void {
  const { RED, BLUE } = FIELD_LAYOUT.gardens;
  fillStrokeRect(ctx, RED, COLORS.redFill, COLORS.redStroke);
  fillStrokeRect(ctx, BLUE, COLORS.blueFill, COLORS.blueStroke);

  const rc = rectCenter(RED);
  const bc = rectCenter(BLUE);
  drawLabel(ctx, 'RED GARDEN', { x: rc.x, y: RED.y - 2.5 }, { size: 10, color: COLORS.redStroke });
  drawLabel(ctx, 'BLUE GARDEN', { x: bc.x, y: BLUE.y + BLUE.height + 2.5 }, { size: 10, color: COLORS.blueStroke });
}

// LOADING ZONE은 세로로 긴 구역(11 x 23)이라 라벨을 90° 회전해 내부에 배치
export function drawLoadingZones(ctx: CanvasRenderingContext2D): void {
  const { RED, BLUE } = FIELD_LAYOUT.loadingZones;
  fillStrokeRect(ctx, RED, COLORS.redFill, COLORS.redStroke, true);
  fillStrokeRect(ctx, BLUE, COLORS.blueFill, COLORS.blueStroke, true);
  drawLabel(ctx, 'RED LOADING', rectCenter(RED), { size: 10, color: COLORS.redStroke, rotate: -Math.PI / 2 });
  drawLabel(ctx, 'BLUE LOADING', rectCenter(BLUE), { size: 10, color: COLORS.blueStroke, rotate: Math.PI / 2 });
}

const HIVE_CELL_INSET = 0.8;   // 프레임 안쪽 셀 박스 여백 (inch)
const NECTAR_RADIUS = PIECE_PHYSICS.NECTAR.radius; // 슬롯 크기 = NECTAR 직경 3.6"

function drawHiveCell(
  ctx: CanvasRenderingContext2D,
  alliance: Alliance,
  cell: HiveCell,
  view: HiveView,
): void {
  const outer = FIELD_LAYOUT.hiveCells[alliance][cell];
  const box: Rect = {
    x: outer.x + HIVE_CELL_INSET,
    y: outer.y + HIVE_CELL_INSET,
    width: outer.width - HIVE_CELL_INSET * 2,
    height: outer.height - HIVE_CELL_INSET * 2,
  };
  const isUp = view.upwardCell === cell;
  const balls = isUp ? view.ballsInUpwardCell : 0;
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

  // 볼 슬롯 (NECTAR 크기 원, 채워진 개수만큼 채움)
  const slotGap = NECTAR_RADIUS * 2 + 1.2;
  const slotY = box.y + box.height / 2 + 0.3;
  for (let i = 0; i < HIVE_CELL_CAPACITY; i++) {
    const { pxX, pxY } = toCanvasPoint(cx + (i - (HIVE_CELL_CAPACITY - 1) / 2) * slotGap, slotY);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pxX, pxY, inchToPx(NECTAR_RADIUS), 0, Math.PI * 2);
    ctx.fillStyle = i < balls ? upFill : COLORS.slotEmpty;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.setLineDash(i < balls ? [] : [3, 2]);
    ctx.strokeStyle = isUp ? COLORS.labelOnDark : allianceStroke;
    ctx.stroke();
    ctx.restore();
  }

  drawLabel(ctx, `${balls}/${HIVE_CELL_CAPACITY}`, { x: cx, y: box.y + box.height - 3 }, {
    size: 11,
    color: textColor,
  });
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

// FLOWER 슬롯 게이지: 탑다운 뷰에서는 수직 적재 높이를 표현할 수 없으므로 FLOWER 옆에 측면 단면 미니 게이지를 그림
const FLOWER_GAUGE_SCALE = 0.5;        // 게이지 1인치 = 필드 0.5인치
const FLOWER_GAUGE_TUBE_HEIGHT = 18;   // 게이지 원통 표시 높이 (inch, 실제 스케일)
// 하단 출구 턱 높이 = slot[0] POLLEN 직경. slot[0]이 비어도(null) 이 높이는 유지됨
const FLOWER_EXIT_LIP_HEIGHT = PIECE_PHYSICS.POLLEN.radius * 2;

// 슬롯 인덱스 기준 각 기물의 바닥 높이 (inch)
// slot[0]은 항상 출구 턱 높이만큼 공간을 차지하므로, slot[0]이 null이면
// slot[1]의 NECTAR는 지면이 아닌 턱 위에 걸려 떠 있는 높이로 계산됨
function flowerSlotBaseHeights(pieces: readonly (GamePiece | null)[]): number[] {
  const bases: number[] = [];
  let z = 0;
  pieces.forEach((piece, i) => {
    bases.push(z);
    if (i === 0) z += FLOWER_EXIT_LIP_HEIGHT;
    else if (piece) z += PIECE_PHYSICS[piece.type].radius * 2;
  });
  return bases;
}

function pieceColors(piece: GamePiece): { fill: string; stroke: string } {
  if (piece.type === 'POLLEN') return { fill: COLORS.pollenFill, stroke: COLORS.pollenStroke };
  return piece.alliance === 'BLUE'
    ? { fill: COLORS.blueCellUp, stroke: COLORS.blueStroke }
    : { fill: COLORS.redCellUp, stroke: COLORS.redStroke };
}

// floor: 게이지 원통 바닥 중심 (필드 inch 좌표)
function drawFlowerGauge(ctx: CanvasRenderingContext2D, floor: Point, flower: FlowerState): void {
  const s = FLOWER_GAUGE_SCALE;
  const halfW = NECTAR_RADIUS * s + 0.3;
  const toPx = (dx: number, z: number) => toCanvasPoint(floor.x + dx, floor.y - z * s);

  // 원통 외곽 (좌/우 벽 + 바닥)
  const topL = toPx(-halfW, FLOWER_GAUGE_TUBE_HEIGHT);
  const botL = toPx(-halfW, 0);
  const botR = toPx(halfW, 0);
  const topR = toPx(halfW, FLOWER_GAUGE_TUBE_HEIGHT);
  ctx.save();
  ctx.strokeStyle = COLORS.gaugeTube;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(topL.pxX, topL.pxY);
  ctx.lineTo(botL.pxX, botL.pxY);
  ctx.lineTo(botR.pxX, botR.pxY);
  ctx.lineTo(topR.pxX, topR.pxY);
  ctx.stroke();

  // 하단 출구 턱: 이 선 아래(slot[0])는 득점 제외 볼륨
  const lipL = toPx(-halfW, FLOWER_EXIT_LIP_HEIGHT);
  const lipR = toPx(halfW, FLOWER_EXIT_LIP_HEIGHT);
  ctx.strokeStyle = COLORS.gaugeLip;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(lipL.pxX, lipL.pxY);
  ctx.lineTo(lipR.pxX, lipR.pxY);
  ctx.stroke();
  ctx.restore();

  const bases = flowerSlotBaseHeights(flower.pieces);
  flower.pieces.forEach((piece, i) => {
    if (piece === null) return; // NECTAR 블로킹으로 비어 있는 slot[0]
    const r = PIECE_PHYSICS[piece.type].radius;
    const { pxX, pxY } = toPx(0, bases[i] + r);
    const { fill, stroke } = pieceColors(piece);
    ctx.save();
    ctx.globalAlpha = i === 0 ? 0.45 : 1; // slot[0]은 득점 제외이므로 흐리게
    ctx.beginPath();
    ctx.arc(pxX, pxY, inchToPx(r * s), 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  });
}

// FLOWER는 반지름 2인치(10px)라 라벨을 가장 가까운 벽의 반대편(필드 안쪽) 바깥에 배치
// flowers가 주어지면 id가 일치하는 FLOWER 옆에 슬롯 게이지를 함께 그림
export function drawFlowers(
  ctx: CanvasRenderingContext2D,
  flowers: readonly FlowerState[] = [],
): void {
  const gaugeHeight = FLOWER_GAUGE_TUBE_HEIGHT * FLOWER_GAUGE_SCALE;

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

    const offset = flower.radius + 1;
    const distX = Math.min(flower.x, FIELD_SIZE_INCH - flower.x);
    const distY = Math.min(flower.y, FIELD_SIZE_INCH - flower.y);
    let labelAt: Point;
    let gaugeFloor: Point;
    let align: CanvasTextAlign = 'center';
    if (distX <= distY) {
      // 좌/우 벽에 붙은 FLOWER → 가로 방향으로 라벨, 게이지는 라벨 위쪽
      const fromLeft = flower.x < FIELD_CENTER;
      labelAt = { x: flower.x + (fromLeft ? offset : -offset), y: flower.y };
      align = fromLeft ? 'left' : 'right';
      gaugeFloor = { x: flower.x + (fromLeft ? offset + 3 : -(offset + 3)), y: flower.y - 2 };
    } else {
      // 위/아래 벽에 붙은 FLOWER → 세로 방향으로 라벨, 게이지는 라벨 오른쪽
      const fromTop = flower.y < FIELD_CENTER;
      labelAt = { x: flower.x, y: flower.y + (fromTop ? offset + 1 : -(offset + 1)) };
      gaugeFloor = {
        x: flower.x + flower.radius + 6,
        y: fromTop ? flower.y + flower.radius + gaugeHeight : flower.y,
      };
    }
    drawLabel(ctx, `FLOWER ${i + 1}`, labelAt, { size: 10, align, color: COLORS.flowerStroke });

    const state = flowers.find((f) => f.id === flower.id);
    if (state) drawFlowerGauge(ctx, gaugeFloor, state);
  }
}

// 7. 필드 전체 렌더 진입점
export function renderField(
  ctx: CanvasRenderingContext2D,
  flowers: readonly FlowerState[] = [],
): void {
  ctx.clearRect(0, 0, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
  drawFieldBackground(ctx);
  drawGardens(ctx);
  drawLoadingZones(ctx);
  drawHive(ctx);
  drawFlowers(ctx, flowers);
}
