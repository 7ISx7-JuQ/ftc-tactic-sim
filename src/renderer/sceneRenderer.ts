// 장면 렌더러 (명세서 3.7, 08-4): TimelineFrame 한 장 + 로봇 제원 + 보기 변환으로 캔버스를 그림
// 엔진을 호출 / 수정하지 않으며, 그림은 (프레임, 제원, 보기)만의 함수 (스크러빙 / 재생에서 같은 틱 = 같은 그림)
// 좌표계: 필드 도형은 필드 px(inch × 5) 공간에서 그리고 보기 변환 행렬(회전 / 배율)로 옮긴다.
//         글자 / 배지는 보기 회전을 상쇄해 화면 기준으로 똑바로 그린다.

import { FIELD_SIZE, HIVE_CENTER_X, PIECE_PHYSICS, getBumperZoneOBB, getRobotOBB } from '../core/collision';
import type { OBB } from '../core/collision';
import { getCarryCapacity } from '../core/simulationEngine';
import type { DeepReadonly, GamePiece, RobotConfig, RobotState, TimelineFrame } from '../core/types';
import { badgeImage } from './badgeAssets';
import {
  COLORS,
  FIELD_LAYOUT,
  drawFieldBackground,
  drawFlowers,
  drawGardens,
  drawHiveBase,
  drawLoadingZones,
  inchToPx,
  pieceColors,
} from './canvasRenderer';
import type { Alliance } from './canvasRenderer';
import {
  BADGE_FALLBACK_TEXT,
  BADGE_SIZE_INCH,
  carriedPieceRadius,
  carriedPieceSlots,
  carriedTray,
  headingArrow,
  localToField,
  robotBadge,
  robotCircumradius,
  robotLabelOffset,
} from './robotLayout';
import {
  FIELD_MARGIN_INCH,
  PX_PER_INCH,
  SCENE_HEIGHT_PX,
  SCENE_WIDTH_PX,
  SIDE_PANEL_PX,
  VIEWPORT_PX,
  fieldPxMatrix,
  fieldToCanvas,
  labelCenter,
} from './viewTransform';
import type { Point2, ViewTransform } from './viewTransform';

export interface SceneInput {
  frame: DeepReadonly<TimelineFrame>;
  r1Config: RobotConfig;
  r2Config: RobotConfig;
  view: ViewTransform;
}

const SCENE_COLORS = {
  pageBg: '#f3f4f6',
  robot: { RED: '#dc2626', BLUE: '#2563eb' } as Record<Alliance, string>,
  robotStroke: '#111827',
  heading: '#ffffff',
  intakeIdle: 'rgba(22, 163, 74, 0.18)',
  intakeIdleStroke: 'rgba(21, 128, 61, 0.45)',
  intakeActive: 'rgba(22, 163, 74, 0.55)',
  intakeActiveStroke: '#15803d',
  gardenMark: '#16a34a',
  tray: 'rgba(255, 255, 255, 0.85)',
  traySlot: 'rgba(17, 24, 39, 0.25)',
  carriedNext: '#111827',
  badgeBg: 'rgba(17, 24, 39, 0.85)',
  badgeText: '#ffffff',
};

const MARGIN_PX = FIELD_MARGIN_INCH * PX_PER_INCH;

// ------------------------------------------------------------
// 1. 정적 레이어 (배경 / 타일 / 벽 / GARDEN / 로딩 존 / HIVE 바탕 / FLOWER 원통): 진영 × dpr별로 한 번 그려 캐시
// ------------------------------------------------------------

type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
const staticLayers = new Map<string, LayerCanvas | null>();

// 필드 px 공간에 정적 도형 (글자 제외 — 회전 시 똑바로 그리기 위해 매 프레임 따로 그림)
function drawStaticField(ctx: CanvasRenderingContext2D, ally: Alliance): void {
  drawFieldBackground(ctx);
  drawGardens(ctx, false);
  drawLoadingZones(ctx, false, ally);
  drawHiveBase(ctx, ally);
  drawFlowers(ctx, [], false);
}

function createLayerCanvas(width: number, height: number): LayerCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return null;
}

function staticLayer(ally: Alliance, dpr: number): LayerCanvas | null {
  const key = `${ally}@${dpr}`;
  if (!staticLayers.has(key)) {
    const size = Math.round(VIEWPORT_PX * dpr);
    const layer = createLayerCanvas(size, size);
    const lctx = layer?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (layer && lctx) {
      // 레이어 = 뷰포트 (필드 + 사방 여백), 필드 px 원점은 여백만큼 안쪽
      lctx.setTransform(dpr, 0, 0, dpr, dpr * MARGIN_PX, dpr * MARGIN_PX);
      drawStaticField(lctx, ally);
    }
    staticLayers.set(key, layer && lctx ? layer : null);
  }
  return staticLayers.get(key) ?? null;
}

// ------------------------------------------------------------
// 2. 필드 공간 동적 요소 (필드 px, 보기 변환 적용된 상태에서 호출)
// ------------------------------------------------------------

function obbCorners(obb: OBB): Point2[] {
  const [f, r] = obb.axes;
  const [hl, hw] = obb.halfExtents;
  const at = (a: number, b: number) => ({ x: obb.center.x + f.x * a + r.x * b, y: obb.center.y + f.y * a + r.y * b });
  return [at(hl, -hw), at(hl, hw), at(-hl, hw), at(-hl, -hw)]; // 앞-왼, 앞-오른, 뒤-오른, 뒤-왼
}

function pathPolygon(ctx: CanvasRenderingContext2D, pts: Point2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(inchToPx(p.x), inchToPx(p.y)) : ctx.lineTo(inchToPx(p.x), inchToPx(p.y))));
  ctx.closePath();
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, stroke: string, lineWidth: number): void {
  ctx.beginPath();
  ctx.arc(inchToPx(x), inchToPx(y), inchToPx(radius), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

// 바닥 기물: ON_FIELD / IN_GARDEN만 좌표에 그림 (다른 상태는 HIVE / 게이지 / 적재물 / 비행 표시로, 명세서 3.7 표)
function drawFloorPieces(ctx: CanvasRenderingContext2D, pieces: readonly DeepReadonly<GamePiece>[]): void {
  ctx.save();
  for (const piece of pieces) {
    if (piece.state !== 'ON_FIELD' && piece.state !== 'IN_GARDEN') continue;
    const { fill, stroke } = pieceColors(piece);
    const inGarden = piece.state === 'IN_GARDEN';
    drawCircle(ctx, piece.x, piece.y, PIECE_PHYSICS[piece.type].radius, fill, inGarden ? SCENE_COLORS.gardenMark : stroke, inGarden ? 2.5 : 1.5);
  }
  ctx.restore();
}

function drawRobotBody(
  ctx: CanvasRenderingContext2D,
  robot: DeepReadonly<RobotState>,
  config: RobotConfig,
  ally: Alliance,
): void {
  const body = getRobotOBB(robot, config);
  ctx.save();

  // 인테이크 구역: 평소 옅게, INTAKING 중 진하게
  const active = robot.actionState === 'INTAKING';
  for (const zone of config.intakeZones) {
    const obb = getBumperZoneOBB(body, zone);
    if (!obb) continue;
    pathPolygon(ctx, obbCorners(obb));
    ctx.fillStyle = active ? SCENE_COLORS.intakeActive : SCENE_COLORS.intakeIdle;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = active ? SCENE_COLORS.intakeActiveStroke : SCENE_COLORS.intakeIdleStroke;
    ctx.stroke();
  }

  // 몸체
  const corners = obbCorners(body);
  pathPolygon(ctx, corners);
  ctx.fillStyle = SCENE_COLORS.robot[ally];
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SCENE_COLORS.robotStroke;
  ctx.stroke();

  // 앞쪽 변 굵게 + 헤딩 화살표
  ctx.beginPath();
  ctx.moveTo(inchToPx(corners[0].x), inchToPx(corners[0].y));
  ctx.lineTo(inchToPx(corners[1].x), inchToPx(corners[1].y));
  ctx.lineWidth = 4;
  ctx.stroke();
  pathPolygon(ctx, headingArrow(config.length).map((p) => localToField(robot, p)));
  ctx.fillStyle = SCENE_COLORS.heading;
  ctx.fill();

  // 적재물 받침 (밝은 바탕: 진영색 NECTAR도 몸체와 구분) + 적재 한도만큼 빈 칸 윤곽
  const tray = carriedTray(config.length);
  pathPolygon(ctx, [
    localToField(robot, { forward: tray.front, right: -tray.halfWidth }),
    localToField(robot, { forward: tray.front, right: tray.halfWidth }),
    localToField(robot, { forward: tray.back, right: tray.halfWidth }),
    localToField(robot, { forward: tray.back, right: -tray.halfWidth }),
  ]);
  ctx.fillStyle = SCENE_COLORS.tray;
  ctx.fill();
  const radius = carriedPieceRadius(config.length);
  const capacity = getCarryCapacity(config);
  carriedPieceSlots(config.length, capacity).forEach((slot, i) => {
    const at = localToField(robot, slot);
    const piece = robot.controlledPieces[i];
    if (!piece) {
      drawCircle(ctx, at.x, at.y, radius, 'transparent', SCENE_COLORS.traySlot, 1);
      return;
    }
    // FIFO: 앞쪽부터 0번, 0번(다음에 나갈 기물)은 굵은 테두리 강조
    const { fill, stroke } = pieceColors(piece);
    drawCircle(ctx, at.x, at.y, radius, fill, i === 0 ? SCENE_COLORS.carriedNext : stroke, i === 0 ? 2.5 : 1);
  });
  ctx.restore();
}

// ------------------------------------------------------------
// 3. 화면 공간 요소 (보기 회전 상쇄, 똑바로)
// ------------------------------------------------------------

interface FieldLabel {
  text: string;
  anchor: Point2;          // 필드 inch: 구조물 가장자리 (outward가 없으면 글자 중심)
  outward: Point2 | null;  // 구조물 바깥 방향 필드 단위 벡터 — 화면에서 글자 상자를 이 방향으로 밀어 겹치지 않게 함
  size: number;
  color: string;
}

/** 정적 구조물 라벨 (화면에서 항상 똑바로, 구조물 바깥에 배치) */
export function fieldLabels(ally: Alliance): FieldLabel[] {
  const allyColor = (side: Alliance, used = true) =>
    !used ? COLORS.unusedStroke : side === 'RED' ? COLORS.redStroke : COLORS.blueStroke;
  const { gardens, loadingZones, hive, flowers } = FIELD_LAYOUT;
  const midX = (r: { x: number; width: number }) => r.x + r.width / 2;
  const labels: FieldLabel[] = [
    // GARDEN: 필드 안쪽 가장자리 바깥 (RED는 −y, BLUE는 +y 쪽)
    { text: 'RED GARDEN', anchor: { x: midX(gardens.RED), y: gardens.RED.y }, outward: { x: 0, y: -1 }, size: 10, color: allyColor('RED') },
    { text: 'BLUE GARDEN', anchor: { x: midX(gardens.BLUE), y: gardens.BLUE.y + gardens.BLUE.height }, outward: { x: 0, y: 1 }, size: 10, color: allyColor('BLUE') },
  ];
  for (const side of ['RED', 'BLUE'] as const) {
    const zone = loadingZones[side];
    labels.push({ text: 'LOADING', anchor: { x: midX(zone), y: zone.y + zone.height / 2 }, outward: null, size: 9, color: allyColor(side, side === ally) });
    // HIVE: 프레임 OPPOSITE(−y) 쪽 변 바깥
    labels.push({ text: `${side} HIVE`, anchor: { x: HIVE_CENTER_X[side], y: hive.y }, outward: { x: 0, y: -1 }, size: 11, color: allyColor(side, side === ally) });
  }
  flowers.forEach((f, i) => {
    // FLOWER: 원통에서 필드 중심 방향 바깥
    const dx = FIELD_SIZE / 2 - f.x;
    const dy = FIELD_SIZE / 2 - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const outward = { x: dx / len, y: dy / len };
    labels.push({ text: `FLOWER ${i + 1}`, anchor: { x: f.x + outward.x * f.radius, y: f.y + outward.y * f.radius }, outward, size: 10, color: COLORS.flowerStroke });
  });
  return labels;
}

const LABEL_GAP_PX = 3;

function drawFieldLabels(ctx: CanvasRenderingContext2D, ally: Alliance, view: ViewTransform): void {
  for (const label of fieldLabels(ally)) {
    ctx.font = `bold ${label.size}px system-ui, sans-serif`;
    const w = ctx.measureText(label.text).width;
    const at = label.outward
      ? labelCenter(view, label.anchor, label.outward, w, label.size, LABEL_GAP_PX)
      : fieldToCanvas(view, label.anchor.x, label.anchor.y);
    drawText(ctx, label.text, at, label.size, label.color);
  }
}

function drawText(ctx: CanvasRenderingContext2D, text: string, at: Point2, size: number, color: string, outline?: string): void {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, at.x, at.y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, at.x, at.y);
}

function drawBadge(ctx: CanvasRenderingContext2D, robot: DeepReadonly<RobotState>, config: RobotConfig, view: ViewTransform): void {
  const badge = robotBadge(robot);
  if (!badge) return;
  const k = view.scale * PX_PER_INCH;
  const size = BADGE_SIZE_INCH * k;
  const center = fieldToCanvas(view, robot.x, robot.y);
  const y = center.y - robotCircumradius(config.length, config.width) * k - 2 - size / 2; // 차체 외접원 바깥 화면 위쪽
  ctx.save();
  ctx.globalAlpha = badge.alpha;
  const img = badgeImage(badge.key);
  if (img) {
    ctx.drawImage(img, center.x - size / 2, y - size / 2, size, size);
  } else {
    const text = BADGE_FALLBACK_TEXT[badge.key];
    ctx.font = `bold ${Math.max(8, Math.round(size / 3))}px system-ui, sans-serif`;
    const w = Math.max(size, ctx.measureText(text).width + 8);
    const h = size * 0.6;
    ctx.beginPath();
    ctx.roundRect(center.x - w / 2, y - h / 2, w, h, h / 3);
    ctx.fillStyle = SCENE_COLORS.badgeBg;
    ctx.fill();
    ctx.fillStyle = SCENE_COLORS.badgeText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, center.x, y);
  }
  ctx.restore();
}

// ------------------------------------------------------------
// 4. 진입점
// ------------------------------------------------------------

/**
 * 장면 전체를 그림. ctx는 SCENE_WIDTH_PX × SCENE_HEIGHT_PX 논리 크기 × dpr 버퍼의 캔버스
 * 순서: 배경 / 좌우 패널 → 정적 레이어 → 구조물 라벨 → 바닥 기물 → 로봇 → 번호 / 배지 (HIVE 상태, 게이지, 비행 공은 이후 단계)
 */
export function renderScene(ctx: CanvasRenderingContext2D, scene: SceneInput, dpr = 1): void {
  const { frame, view } = scene;
  const ally = frame.field.allianceColor;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);
  ctx.fillStyle = SCENE_COLORS.pageBg;
  ctx.fillRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);

  // 필드 뷰포트 (좌우 패널 사이 정사각형)로 제한
  ctx.save();
  ctx.beginPath();
  ctx.rect(SIDE_PANEL_PX, 0, VIEWPORT_PX, VIEWPORT_PX);
  ctx.clip();

  ctx.setTransform(...fieldPxMatrix(view, dpr));
  const layer = staticLayer(ally, dpr);
  if (layer) ctx.drawImage(layer, -MARGIN_PX, -MARGIN_PX, VIEWPORT_PX, VIEWPORT_PX);
  else drawStaticField(ctx, ally);

  // 구조물 라벨 (화면 공간, 똑바로): 기물 / 로봇 아래에 깔리도록 먼저
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFieldLabels(ctx, ally, view);

  ctx.setTransform(...fieldPxMatrix(view, dpr));
  drawFloorPieces(ctx, frame.pieces);
  drawRobotBody(ctx, frame.r1, scene.r1Config, ally);
  drawRobotBody(ctx, frame.r2, scene.r2Config, ally);

  // 화면 공간: 로봇 번호 / 배지는 똑바로
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const robots: [DeepReadonly<RobotState>, RobotConfig, string][] = [
    [frame.r1, scene.r1Config, '1'],
    [frame.r2, scene.r2Config, '2'],
  ];
  for (const [robot, config, num] of robots) {
    const at = localToField(robot, robotLabelOffset(config.length));
    drawText(ctx, num, fieldToCanvas(view, at.x, at.y), 12, '#ffffff', SCENE_COLORS.robotStroke);
  }
  for (const [robot, config] of robots) drawBadge(ctx, robot, config, view);
  ctx.restore();
}
