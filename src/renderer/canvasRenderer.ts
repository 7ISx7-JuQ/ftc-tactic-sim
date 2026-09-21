// Canvas 2D 렌더러 (React 비의존 순수 함수 모음)
// 좌표계 (명세서 2.1): 좌상단 (0,0) ~ 우하단 (144,144), +x 오른쪽, +y 아래쪽, Y=144 방향이 AUDIENCE

// 1. 필드 스케일 상수 (명세서 2.1)
export const FIELD_SIZE_INCH = 144;
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
// Red/Blue 구조물은 필드 중심 (72, 72) 기준 180° 점대칭: (x, y) ↔ (144 - x, 144 - y)
export type Alliance = 'RED' | 'BLUE';
export type HiveCell = 'OPPOSITE_CELL' | 'AUDIENCE_CELL';

const FIELD_CENTER = FIELD_SIZE_INCH / 2;
const HIVE_WIDTH = 49.46;
const HIVE_HEIGHT = 38.95;
const HIVE_LEFT = FIELD_CENTER - HIVE_WIDTH / 2;   // 47.27
const HIVE_TOP = FIELD_CENTER - HIVE_HEIGHT / 2;   // 52.525
const HIVE_CENTER_X: Record<Alliance, number> = { RED: 59.25, BLUE: 84.75 };
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
  hive: { x: HIVE_LEFT, y: HIVE_TOP, width: HIVE_WIDTH, height: HIVE_HEIGHT } as Rect,
  // 진영별 HIVE 2-Cell (좌측 C열 Red, 우측 D열 Blue)
  hiveCells: {
    RED: { OPPOSITE_CELL: hiveCellRect('RED', 'OPPOSITE_CELL'), AUDIENCE_CELL: hiveCellRect('RED', 'AUDIENCE_CELL') },
    BLUE: { OPPOSITE_CELL: hiveCellRect('BLUE', 'OPPOSITE_CELL'), AUDIENCE_CELL: hiveCellRect('BLUE', 'AUDIENCE_CELL') },
  } as Record<Alliance, Record<HiveCell, Rect>>,
  // 솔리드 장애물: 반지름 2.0 원형
  flowers: [
    { id: 'flower1', side: 'RED', x: 2, y: 96, radius: 2 },
    { id: 'flower2', side: 'RED', x: 48, y: 2, radius: 2 },
    { id: 'flower3', side: 'BLUE', x: 142, y: 48, radius: 2 },
    { id: 'flower4', side: 'BLUE', x: 96, y: 142, radius: 2 },
  ] as (Circle & { id: string; side: Alliance })[],
  // 통과 가능 구역: 23 x 2
  gardens: {
    RED: { x: 0, y: 142, width: 23, height: 2 },
    BLUE: { x: 121, y: 0, width: 23, height: 2 },
  } as Record<Alliance, Rect>,
  // 통과 가능 구역: 11 x 23
  loadingZones: {
    RED: { x: 0, y: 24, width: 11, height: 23 },
    BLUE: { x: 133, y: 97, width: 11, height: 23 },
  } as Record<Alliance, Rect>,
};

// HIVE 표시용 상태 (엔진 연동 전 기본값: 명세서 2.5 초기 UP 상태)
export const HIVE_CELL_CAPACITY = 3; // TIP 임계값 (명세서 2.5 예시값)

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
const NECTAR_RADIUS = 1.8;     // 슬롯 크기 = NECTAR 직경 3.6"

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

// FLOWER는 반지름 2인치(10px)라 라벨을 가장 가까운 벽의 반대편(필드 안쪽) 바깥에 배치
export function drawFlowers(ctx: CanvasRenderingContext2D): void {
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
