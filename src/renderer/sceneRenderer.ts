// 장면 렌더러 (명세서 3.7, 08-4 ~ 08-6): TimelineFrame 한 장 + 로봇 제원 + 보기 변환 + 표시 옵션으로 캔버스를 그림
// 엔진을 호출 / 수정하지 않으며, 그림은 (프레임, 제원, 보기, 옵션)만의 함수 (스크러빙 / 재생에서 같은 틱 = 같은 그림)
// 캔버스 = 필드 뷰포트(800 × 800)만 (09-6b). 표시 옵션 hitProbability의 글자는 좌측 HTML 득점 패널이 그린다 (명세서 3.8).
// 테마 (09-6b 확정): 필드 바닥은 밝은 회색 타일, 필드 둘레(게이지 여백)는 어두운 배경 — 주변 UI / 팝업과 같은 톤.
// 구조물 이름표는 그리지 않는다 (09-6b 확정: 사용자가 필드 구성을 알고 있음). 글자는 HIVE 셀 알약 / 로봇 번호 / 행동 배지만.
// 좌표계: 필드 도형은 필드 px(inch × 5) 공간에서 그리고 보기 변환 행렬(회전 / 배율)로 옮긴다.
//         글자 / 배지는 보기 회전을 상쇄해 화면 기준으로 똑바로 그린다.

import {
  FLOWER_IDS,
  PIECE_PHYSICS,
  getBumperZoneOBB,
  getRobotOBB,
  hiveTipLipOrigin,
} from '../core/collision';
import type { OBB } from '../core/collision';
import { getCarryCapacity } from '../core/simulationEngine';
import { hiveTipPollenThreshold } from '../core/types';
import type { DeepReadonly, HiveState, RobotConfig, RobotState, TimelineFrame } from '../core/types';
import { airborneDisplay, shotElapsed, shotPositionAt, shotTrail } from './flightView';
import { DEFAULT_RENDER_OPTIONS, aimGuide, intakeProgress } from './renderOptions';
import type { RenderOptions } from './renderOptions';
import { badgeImage } from './badgeAssets';
import { canvasFont } from './fonts';
import {
  ALLIANCE_COLORS,
  COLORS,
  FIELD_LAYOUT,
  drawFieldBackground,
  drawFlowers,
  drawGardens,
  drawHiveBase,
  drawLoadingZones,
  hiveCellBox,
  inchToPx,
  pieceColors,
} from './canvasRenderer';
import type { Alliance, HiveCell, Rect } from './canvasRenderer';
import {
  GAUGE_PIECE_RADIUS,
  GAUGE_THICKNESS,
  bottomBonusSlot,
  flowerGaugeLayout,
  flowerGaugeSlots,
  stockGaugeLayout,
  stockSlotStates,
  tipDropView,
} from './gaugeLayout';
import type { GaugeLayout } from './gaugeLayout';
import {
  BADGE_FALLBACK_TEXT,
  BADGE_SIZE_INCH,
  badgeCenter,
  carriedPieceRadius,
  carriedPieceSlots,
  carriedTray,
  headingArrow,
  localToField,
  robotBadge,
  robotLabelOffset,
} from './robotLayout';
import {
  FIELD_MARGIN_INCH,
  PX_PER_INCH,
  SCENE_HEIGHT_PX,
  SCENE_WIDTH_PX,
  VIEWPORT_PX,
  fieldPxMatrix,
  fieldToCanvas,
  screenUpInField,
} from './viewTransform';
import type { Point2, ViewTransform } from './viewTransform';

export interface SceneInput {
  frame: DeepReadonly<TimelineFrame>;
  r1Config: RobotConfig;
  r2Config: RobotConfig;
  view: ViewTransform;
  options?: RenderOptions;                 // 미지정 = 모두 꺼짐
}

const SCENE_COLORS = {
  pageBg: '#15171c', // 필드 둘레 (어두운 테마)
  robot: { RED: ALLIANCE_COLORS.RED.base, BLUE: ALLIANCE_COLORS.BLUE.base } as Record<Alliance, string>,
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
  gaugeBg: 'rgba(255, 255, 255, 0.92)',
  gaugeSlot: 'rgba(17, 24, 39, 0.22)',
  gaugeLip: '#8e2f6f',
  jam: '#111827',
  fullMark: 'rgba(17, 24, 39, 0.55)',
  pendingStroke: '#111827',
  pillBg: 'rgba(17, 24, 39, 0.78)',
  pillText: '#ffffff',
  tipping: '#f59e0b',
  tipOutline: '#111827',
  scored: '#f59e0b',
  shadow: 'rgba(17, 24, 39, 0.28)',
  trail: 'rgba(17, 24, 39, 0.45)',
  result: { HIT: '#16a34a', MISS_HIVE: '#f59e0b', MISS_FLOOR: '#6b7280' } as Record<'HIT' | 'MISS_HIVE' | 'MISS_FLOOR', string>,
  aimLine: 'rgba(17, 24, 39, 0.7)',
  aimSector: 'rgba(250, 204, 21, 0.25)',
  aimSectorStroke: 'rgba(161, 98, 7, 0.6)',
  intakeArc: '#15803d',
};

const MARGIN_PX = FIELD_MARGIN_INCH * PX_PER_INCH;
const ROBOT_OUTLINE_PX = 2.25; // 로봇 몸체 윤곽선 (09-6b: 1.5 → 2.25)
const CELL_NECTAR_OUTLINE_PX = 2.25; // HIVE 상향 셀 안 NECTAR 윤곽선 (09-6b: 1.5 → 2.25)

// ------------------------------------------------------------
// 1. 정적 레이어 (배경 / 타일 / 벽 / GARDEN / 로딩 존 / HIVE 바탕 / FLOWER 원통 / 게이지 틀): 진영 × dpr별로 한 번 그려 캐시
// ------------------------------------------------------------

type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
const staticLayers = new Map<string, LayerCanvas | null>();

// 필드 px 공간에 정적 도형 (글자 제외 — 회전 시 똑바로 그리기 위해 매 프레임 따로 그림)
function drawStaticField(ctx: CanvasRenderingContext2D, ally: Alliance): void {
  drawFieldBackground(ctx);
  drawGardens(ctx, false, ally);
  drawLoadingZones(ctx, false, ally);
  drawHiveBase(ctx, ally);
  drawFlowers(ctx, false);
  drawGaugeFrames(ctx, ally);
}

// 게이지 틀 (필드 밖): 둥근 직사각형 + 빈 칸 윤곽. FLOWER 게이지는 칸 0 / 1 사이 출구 턱 구분선 (칸 0 = 득점 제외)
function gaugeFramePath(ctx: CanvasRenderingContext2D, g: GaugeLayout): void {
  const { rect } = g;
  ctx.beginPath();
  ctx.roundRect(inchToPx(rect.minX), inchToPx(rect.minY), inchToPx(rect.maxX - rect.minX), inchToPx(rect.maxY - rect.minY), inchToPx(GAUGE_THICKNESS / 2));
}

function drawGaugeFrame(ctx: CanvasRenderingContext2D, g: GaugeLayout, fill: string, stroke: string, slots: boolean): void {
  gaugeFramePath(ctx, g);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (!slots) return;
  for (const slot of g.slots) drawCircle(ctx, slot.x, slot.y, GAUGE_PIECE_RADIUS, 'transparent', SCENE_COLORS.gaugeSlot, 1);
}

function drawGaugeFrames(ctx: CanvasRenderingContext2D, ally: Alliance): void {
  ctx.save();
  FLOWER_IDS.forEach((_, i) => {
    const g = flowerGaugeLayout(i);
    drawGaugeFrame(ctx, g, SCENE_COLORS.gaugeBg, COLORS.flowerStroke, true);
    // 출구 턱: 칸 0과 1 사이, 게이지 두께 방향
    const mid = { x: (g.slots[0].x + g.slots[1].x) / 2, y: (g.slots[0].y + g.slots[1].y) / 2 };
    const h = GAUGE_THICKNESS / 2;
    ctx.beginPath();
    ctx.moveTo(inchToPx(mid.x - g.outward.x * h), inchToPx(mid.y - g.outward.y * h));
    ctx.lineTo(inchToPx(mid.x + g.outward.x * h), inchToPx(mid.y + g.outward.y * h));
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = SCENE_COLORS.gaugeLip;
    ctx.stroke();
    ctx.setLineDash([]);
  });
  // NECTAR 재고: 아군은 진영색 틀 + 빈 칸, 상대는 비활성 틀만 (2v0에서 쓰이지 않음)
  for (const side of ['RED', 'BLUE'] as const) {
    const used = side === ally;
    const shades = ALLIANCE_COLORS[side];
    drawGaugeFrame(ctx, stockGaugeLayout(side), used ? SCENE_COLORS.gaugeBg : shades.inactiveFill, used ? shades.dark : shades.inactiveStroke, used);
  }
  ctx.restore();
}

function createLayerCanvas(width: number, height: number): LayerCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  return null;
}

// 창 크기에 따라 배율(dpr)이 계속 바뀌므로 캐시가 쌓이지 않게 상한을 둔다 (09-6d)
const STATIC_LAYER_CACHE_MAX = 4;

function staticLayer(ally: Alliance, dpr: number): LayerCanvas | null {
  const key = `${ally}@${dpr}`;
  if (!staticLayers.has(key)) {
    if (staticLayers.size >= STATIC_LAYER_CACHE_MAX) staticLayers.clear();
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
// IN_GARDEN은 초록 테두리. 경기 종료 프레임에서 득점 인정된 GARDEN 기물은 초록 대신 주황 테두리 (09-6b, 겹쳐 그리지 않음)
function drawFloorPieces(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>): void {
  const scored = new Set(frame.scoreBreakdown?.gardenPieceIds ?? []);
  ctx.save();
  for (const piece of frame.pieces) {
    if (piece.state !== 'ON_FIELD' && piece.state !== 'IN_GARDEN') continue;
    const { fill, stroke } = pieceColors(piece);
    const radius = PIECE_PHYSICS[piece.type].radius;
    if (scored.has(piece.id)) drawCircle(ctx, piece.x, piece.y, radius, fill, SCENE_COLORS.scored, 3);
    else if (piece.state === 'IN_GARDEN') drawCircle(ctx, piece.x, piece.y, radius, fill, SCENE_COLORS.gardenMark, 2.5);
    else drawCircle(ctx, piece.x, piece.y, radius, fill, stroke, 1.5);
  }
  ctx.restore();
}

// HIVE 아군 셀 상태 (필드 공간): 상향 셀 진영색 + 노란 강조 테두리, 전복 중이면 전복된 셀에 주황 점선 테두리
// (셀 안 NECTAR / POLLEN 줄과 개수 글자는 화면 공간에서 똑바로 — drawHiveLabels)
const oppositeCell = (cell: HiveCell): HiveCell => (cell === 'AUDIENCE_CELL' ? 'OPPOSITE_CELL' : 'AUDIENCE_CELL');

function strokeBox(ctx: CanvasRenderingContext2D, box: Rect, color: string, width: number, dash: number[] = []): void {
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.strokeRect(inchToPx(box.x) + width / 2, inchToPx(box.y) + width / 2, inchToPx(box.width) - width, inchToPx(box.height) - width);
  ctx.setLineDash([]);
}

function drawHiveState(ctx: CanvasRenderingContext2D, hive: DeepReadonly<HiveState>, ally: Alliance): void {
  ctx.save();
  const up = hiveCellBox(ally, hive.upwardCell);
  ctx.fillStyle = ally === 'RED' ? COLORS.redCellUp : COLORS.blueCellUp;
  ctx.fillRect(inchToPx(up.x), inchToPx(up.y), inchToPx(up.width), inchToPx(up.height));
  strokeBox(ctx, up, COLORS.upHighlight, 4);
  if (hive.isTipping) strokeBox(ctx, hiveCellBox(ally, oppositeCell(hive.upwardCell)), SCENE_COLORS.tipping, 3, [8, 5]);
  ctx.restore();
}

// FLOWER / 재고 게이지 내용
function drawGaugeContents(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, ally: Alliance): void {
  ctx.save();
  for (const flower of frame.field.flowers) {
    const index = FLOWER_IDS.indexOf(flower.id as (typeof FLOWER_IDS)[number]);
    if (index < 0) continue;
    const g = flowerGaugeLayout(index);
    flowerGaugeSlots(flower.pieces).forEach((slot, k) => {
      const at = g.slots[k];
      if (slot.kind === 'PIECE') {
        const { fill, stroke } = pieceColors(slot.piece);
        drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS, fill, stroke, 1);
      } else if (slot.kind === 'JAM') {
        drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS, SCENE_COLORS.jam, SCENE_COLORS.jam, 1);
      } else if (slot.kind === 'FULL') {
        const d = GAUGE_PIECE_RADIUS * 0.75;
        ctx.beginPath();
        ctx.moveTo(inchToPx(at.x - d), inchToPx(at.y - d));
        ctx.lineTo(inchToPx(at.x + d), inchToPx(at.y + d));
        ctx.moveTo(inchToPx(at.x + d), inchToPx(at.y - d));
        ctx.lineTo(inchToPx(at.x - d), inchToPx(at.y + d));
        ctx.lineWidth = 2;
        ctx.strokeStyle = SCENE_COLORS.fullMark;
        ctx.stroke();
      }
    });
  }
  const stock = stockGaugeLayout(ally);
  const nectar = pieceColors({ type: 'NECTAR', alliance: ally });
  stockSlotStates(frame.field.pendingHumanNectar, frame.field.nectarStock).forEach((state, i) => {
    const at = stock.slots[i];
    if (state === 'STOCK') drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS, nectar.fill, nectar.stroke, 1);
    if (state === 'PENDING') {
      // 투입 대기: 반투명 + 점선 테두리
      ctx.globalAlpha = 0.45;
      drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS, nectar.fill, 'transparent', 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([3, 2]);
      drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS, 'transparent', SCENE_COLORS.pendingStroke, 1.5);
      ctx.setLineDash([]);
    }
  });
  ctx.restore();
}

// HIVE 시차 낙하 연출: 전복된 셀의 립 기준점 → 착지점 선형 보간, 불투명도 증가, 화면 12시부터 시계 방향 윤곽 호 (u = 1에서 완전한 원)
function drawTipDrops(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, ally: Alliance, view: ViewTransform): void {
  const { hive } = frame.field;
  if (!hive.isTipping || hive.pendingDrops.length === 0) return;
  const lip = hiveTipLipOrigin(ally, oppositeCell(hive.upwardCell));
  const up = screenUpInField(view);
  const start = Math.atan2(up.y, up.x);
  ctx.save();
  for (const drop of hive.pendingDrops) {
    const piece = frame.pieces.find((p) => p.id === drop.pieceId);
    if (!piece) continue;
    const v = tipDropView(lip, { x: drop.targetX, y: drop.targetY }, drop.settleTime, hive.tipProgressTimer);
    const { fill } = pieceColors(piece);
    const r = PIECE_PHYSICS[piece.type].radius;
    ctx.globalAlpha = v.alpha;
    drawCircle(ctx, v.x, v.y, r, fill, 'transparent', 0);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(inchToPx(v.x), inchToPx(v.y), inchToPx(r), start, start + v.progress * Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = SCENE_COLORS.tipOutline;
    ctx.stroke();
  }
  ctx.restore();
}

// 경기 종료 강조 (필드 공간, scoreBreakdown이 있는 종료 프레임만, 09-6b):
//   득점 FLOWER(소유권) = 필드의 FLOWER 원을 진영색 + 주황 테두리로, 하단 보너스 = 게이지에서 그 원인인 가장 아래 NECTAR에 주황 테두리
//   (득점 GARDEN 기물은 drawFloorPieces가 주황 테두리로 그림)
function drawScoredFieldMarks(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, ally: Alliance): void {
  const breakdown = frame.scoreBreakdown;
  if (!breakdown) return;
  ctx.save();
  for (const f of breakdown.flowers) {
    const index = FLOWER_IDS.indexOf(f.id as (typeof FLOWER_IDS)[number]);
    if (!f.owned || index < 0) continue;
    const circle = FIELD_LAYOUT.flowers[index];
    drawCircle(ctx, circle.x, circle.y, circle.radius, ALLIANCE_COLORS[ally].base, SCENE_COLORS.scored, 2.5);
    const flower = frame.field.flowers.find((fl) => fl.id === f.id);
    const k = flower ? bottomBonusSlot(flower.pieces) : -1;
    if (k < 0) continue;
    const at = flowerGaugeLayout(index).slots[k];
    drawCircle(ctx, at.x, at.y, GAUGE_PIECE_RADIUS + 0.35, 'transparent', SCENE_COLORS.scored, 2.5);
  }
  ctx.restore();
}

// 경기 종료 강조: 주차 인정 로봇 외곽 (몸체보다 1.5 in 크게)
function drawParkedMarks(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, scene: SceneInput): void {
  const breakdown = frame.scoreBreakdown;
  if (!breakdown) return;
  ctx.save();
  for (const id of breakdown.parkedRobots) {
    const [robot, config] = id === 'robot1' ? [frame.r1, scene.r1Config] : [frame.r2, scene.r2Config];
    const body = getRobotOBB(robot, config);
    pathPolygon(ctx, obbCorners({ ...body, halfExtents: [body.halfExtents[0] + 1.5, body.halfExtents[1] + 1.5] }));
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = SCENE_COLORS.scored;
    ctx.stroke();
  }
  ctx.restore();
}

// 비행 공 (명세서 3.7): 바닥 위치에 그림자, 공은 화면 위쪽으로 0.3·z in 띄우고 반지름 × (1 + z / 100)
// 표시 옵션: flightTrail = 발사구부터 현재까지 점선, flightResult = 결과별 색 테두리 (기본은 도착 전까지 구분 없음)
function drawFlights(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, view: ViewTransform, options: RenderOptions): void {
  const shots = frame.field.pendingShots;
  if (shots.length === 0) return;
  const up = screenUpInField(view);
  const lifted = (p: { x: number; y: number; z: number }) => {
    const { offset } = airborneDisplay(p.z);
    return { x: p.x + up.x * offset, y: p.y + up.y * offset };
  };
  ctx.save();
  for (const shot of shots) {
    const piece = frame.pieces.find((p) => p.id === shot.pieceId);
    if (!piece) continue;
    const t = shotElapsed(shot, frame.tick);
    const pos = shotPositionAt(shot, t);
    const r = PIECE_PHYSICS[piece.type].radius;
    if (options.flightTrail) {
      pathPolyline(ctx, shotTrail(shot, t).map(lifted));
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = SCENE_COLORS.trail;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawCircle(ctx, pos.x, pos.y, r, SCENE_COLORS.shadow, 'transparent', 0);
    const ball = lifted(pos);
    const { fill, stroke } = pieceColors(piece);
    const resultRing = options.flightResult ? SCENE_COLORS.result[shot.result] : null;
    drawCircle(ctx, ball.x, ball.y, r * airborneDisplay(pos.z).scale, fill, resultRing ?? stroke, resultRing ? 3 : 1.5);
  }
  ctx.restore();
}

function pathPolyline(ctx: CanvasRenderingContext2D, pts: Point2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(inchToPx(p.x), inchToPx(p.y)) : ctx.lineTo(inchToPx(p.x), inchToPx(p.y))));
}

// 표시 옵션 aimGuide: 조준 가능 부채꼴 + 발사 방향 선 (조준점 거리까지)
const AIM_SECTOR_RADIUS = 24; // inch

function drawAimGuides(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, scene: SceneInput): void {
  ctx.save();
  const { allianceColor, hive } = frame.field;
  for (const [robot, config] of [[frame.r1, scene.r1Config], [frame.r2, scene.r2Config]] as const) {
    const g = aimGuide(robot, config, allianceColor, hive.upwardCell);
    const cx = inchToPx(g.center.x);
    const cy = inchToPx(g.center.y);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, inchToPx(AIM_SECTOR_RADIUS), g.sectorStart, g.sectorEnd);
    ctx.closePath();
    ctx.fillStyle = SCENE_COLORS.aimSector;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = SCENE_COLORS.aimSectorStroke;
    ctx.stroke();
    const reach = Math.hypot(g.aim.x - g.center.x, g.aim.y - g.center.y);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(inchToPx(g.center.x + Math.cos(g.launchHeading) * reach), inchToPx(g.center.y + Math.sin(g.launchHeading) * reach));
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = SCENE_COLORS.aimLine;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// 표시 옵션 intakeProgress: 흡입 대상 둘레에 진행 호 (화면 12시부터 시계 방향)
function drawIntakeProgress(ctx: CanvasRenderingContext2D, frame: DeepReadonly<TimelineFrame>, scene: SceneInput, view: ViewTransform): void {
  const up = screenUpInField(view);
  const start = Math.atan2(up.y, up.x);
  ctx.save();
  for (const [robot, config] of [[frame.r1, scene.r1Config], [frame.r2, scene.r2Config]] as const) {
    const p = intakeProgress(robot, config, frame);
    if (!p || p.fraction <= 0) continue;
    ctx.beginPath();
    ctx.arc(inchToPx(p.x), inchToPx(p.y), inchToPx(p.radius), start, start + p.fraction * Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = SCENE_COLORS.intakeArc;
    ctx.stroke();
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
  ctx.lineWidth = ROBOT_OUTLINE_PX;
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

function drawText(ctx: CanvasRenderingContext2D, text: string, at: Point2, size: number, color: string, outline?: string): void {
  ctx.font = canvasFont(size);
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

function drawPill(ctx: CanvasRenderingContext2D, text: string, at: Point2, size: number, bg: string, fg: string): void {
  ctx.font = canvasFont(size);
  const w = ctx.measureText(text).width + 8;
  const h = size + 6;
  ctx.beginPath();
  ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  drawText(ctx, text, at, size, fg);
}

// 셀 박스의 화면 경계 상자 (중심, 폭, 높이 — 논리 px)
function cellScreenBox(ally: Alliance, cell: HiveCell, view: ViewTransform): { cx: number; cy: number; w: number; h: number } {
  const box = hiveCellBox(ally, cell);
  const pts = [
    fieldToCanvas(view, box.x, box.y),
    fieldToCanvas(view, box.x + box.width, box.y),
    fieldToCanvas(view, box.x, box.y + box.height),
    fieldToCanvas(view, box.x + box.width, box.y + box.height),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

// 화면 가로 줄로 기물 원 count개 (셀 폭에 맞춰 축소)
function drawScreenRow(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, count: number, radius: number, fill: string, stroke: string, lineWidth = 1.5): void {
  if (count <= 0) return;
  const gap = Math.min(radius * 2 + 3, (width - 6) / count);
  const r = Math.min(radius, gap / 2 - 0.5);
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(cx + (i - (count - 1) / 2) * gap, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// HIVE 셀 내용 (화면 공간, 똑바로): 상향 셀은 NECTAR 줄 / 개수 글자 "▲ N{NECTAR} P{POLLEN}/{임계}" / POLLEN 줄을 위에서 아래로.
// 보기가 회전해도 줄과 글자가 겹치지 않음. 전복 중인 셀은 글자 없이 주황 점선 테두리만 (drawHiveState, 09-6b)
function drawHiveLabels(ctx: CanvasRenderingContext2D, hive: DeepReadonly<HiveState>, ally: Alliance, view: ViewTransform): void {
  const k = view.scale * PX_PER_INCH;
  const up = cellScreenBox(ally, hive.upwardCell, view);
  const n = hive.nectarInUpwardCell;
  const nectar = pieceColors({ type: 'NECTAR', alliance: ally });
  // NECTAR는 상향 셀 바탕과 같은 진영색이라 흰 윤곽선을 굵게 (09-6b: 1.5 → 2.25 px)
  drawScreenRow(ctx, up.cx, up.cy - up.h * 0.3, up.w, n, PIECE_PHYSICS.NECTAR.radius * k, nectar.fill, COLORS.labelOnDark, CELL_NECTAR_OUTLINE_PX);
  drawScreenRow(ctx, up.cx, up.cy + up.h * 0.3, up.w, hive.pollenInUpwardCell, PIECE_PHYSICS.POLLEN.radius * k, COLORS.pollenFill, COLORS.pollenStroke);
  drawPill(ctx, `▲ N${n} P${hive.pollenInUpwardCell}/${hiveTipPollenThreshold(n)}`, { x: up.cx, y: up.cy }, 11, SCENE_COLORS.pillBg, SCENE_COLORS.pillText);
}

function drawBadge(ctx: CanvasRenderingContext2D, robot: DeepReadonly<RobotState>, config: RobotConfig, view: ViewTransform): void {
  const badge = robotBadge(robot);
  if (!badge) return;
  const k = view.scale * PX_PER_INCH;
  const size = BADGE_SIZE_INCH * k;
  ctx.save();
  ctx.globalAlpha = badge.alpha;
  const img = badgeImage(badge.key);
  if (img) {
    // 몸체의 화면 윗꼭짓점 바로 위 (회전과 무관하게 몸체와 겹치지 않는 가장 가까운 위치)
    const at = badgeCenter(robot, config, view, size);
    ctx.drawImage(img, at.x - size / 2, at.y - size / 2, size, size);
  } else {
    const text = BADGE_FALLBACK_TEXT[badge.key];
    ctx.font = canvasFont(Math.max(8, Math.round(size / 3)));
    const w = Math.max(size, ctx.measureText(text).width + 8);
    const h = size * 0.6;
    const at = badgeCenter(robot, config, view, h);
    ctx.beginPath();
    ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, h / 3);
    ctx.fillStyle = SCENE_COLORS.badgeBg;
    ctx.fill();
    ctx.fillStyle = SCENE_COLORS.badgeText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, at.y);
  }
  ctx.restore();
}

// ------------------------------------------------------------
// 4. 진입점
// ------------------------------------------------------------

/**
 * 장면 전체를 그림. ctx는 SCENE_WIDTH_PX × SCENE_HEIGHT_PX(= 필드 뷰포트 800 × 800) 논리 크기 × dpr 버퍼의 캔버스
 * 순서: 둘레 배경 → 정적 레이어(게이지 틀 포함) → HIVE 셀 상태 / 게이지 내용 → 바닥 기물(득점 GARDEN 포함) → 종료 강조(FLOWER)
 *       → [조준선] → 로봇 → 종료 강조(주차) → [흡입 진행] → 팁 낙하 → 비행 공([잔상] / [결과 색])
 *       → HIVE 셀 알약 / 번호 / 배지   ([ ] = 표시 옵션)
 */
export function renderScene(ctx: CanvasRenderingContext2D, scene: SceneInput, dpr = 1): void {
  const { frame, view } = scene;
  const options = scene.options ?? DEFAULT_RENDER_OPTIONS;
  const ally = frame.field.allianceColor;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);
  ctx.fillStyle = SCENE_COLORS.pageBg;
  ctx.fillRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);

  // 필드 뷰포트로 제한 (회전 중 필드 모서리가 캔버스 밖으로 번지지 않게)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEWPORT_PX, VIEWPORT_PX);
  ctx.clip();

  ctx.setTransform(...fieldPxMatrix(view, dpr));
  const layer = staticLayer(ally, dpr);
  if (layer) ctx.drawImage(layer, -MARGIN_PX, -MARGIN_PX, VIEWPORT_PX, VIEWPORT_PX);
  else drawStaticField(ctx, ally);

  drawHiveState(ctx, frame.field.hive, ally);
  drawGaugeContents(ctx, frame, ally);
  drawFloorPieces(ctx, frame);
  drawScoredFieldMarks(ctx, frame, ally);
  if (options.aimGuide) drawAimGuides(ctx, frame, scene);
  drawRobotBody(ctx, frame.r1, scene.r1Config, ally);
  drawRobotBody(ctx, frame.r2, scene.r2Config, ally);
  drawParkedMarks(ctx, frame, scene);
  if (options.intakeProgress) drawIntakeProgress(ctx, frame, scene, view);
  drawTipDrops(ctx, frame, ally, view);
  drawFlights(ctx, frame, view, options);

  // 화면 공간: HIVE 셀 알약 / 로봇 번호 / 배지는 똑바로
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHiveLabels(ctx, frame.field.hive, ally, view);
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
