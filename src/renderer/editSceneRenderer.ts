// 필드 편집 모드 장면 (명세서 3.8 필드 편집 모드, 09-10b): 경기 전 관중석 시점에서 경기 장면 대신 그린다.
// 09-10b = 히트맵(HEATMAP) 모드: 회색 바닥 + 진영 기준 셀 명중 확률표(파스텔 척도, 미계산 행 회색 빗금)
//   + 타일 / 벽 + HIVE(기준 셀 강조) + 조준점 + 스윗스팟. 생성 중이면 호출할 때마다 조립 중 버퍼를 다시 읽어 행이 채워진다.
// 09-10c = 스윗스팟(SWEET_SPOT) 모드: 같은 바닥 위에 적용한 확률표를 반투명(계산된 행만, 빗금 없음)으로 깔고,
//   마우스를 올린 격자 강조 + 그 자리에서 조준점을 향해 돌린 로봇 몸체 윤곽(올바르면 초록 / 틀리면 빨강),
//   초안 스윗스팟의 몸체 윤곽 + 조준 점선 + 표시, 확률표를 만든(적용한) 스윗스팟은 초안과 다를 때 빈 고리로.
// 09-11b = 시작 자세(SPAWN) 모드: 경기 바닥 그대로(타일 / GARDEN / 로딩 존 / HIVE / FLOWER) + GARDEN 기물 + 두 로봇
//   (흡입 구역 / 몸체 / 앞 변 / 헤딩 화살표 / 번호) + 회전 핸들. 배치 검증에 걸린 로봇은 빨간 테두리 + 빨간 덧칠.
//   바닥 산포 공은 그리지 않는다 (09-11 확정 ④: 로봇 자리를 피해 다시 뿌려지므로 끌 때마다 공이 튀는 것 방지).
// 히트맵 / 스윗스팟 모드는 로봇 / 기물 / 게이지를 그리지 않는다 (편집 모드의 필드는 비어 있음). 색 / 행 계산은 heatmapView.ts (순수 함수).

import { LUT_GRID_SIZE, aimingRobotOBB } from '../core/ballistics';
import { PIECE_PHYSICS, getBumperZoneOBB, getRobotOBB } from '../core/collision';
import type { RobotConfig, RobotPose } from '../core/types';
import { ALLIANCE_COLORS, COLORS, drawFieldBackground, drawFieldLines, drawFlowers, drawGardens, drawHiveBase, drawLoadingZones, hiveCellBox, inchToPx } from './canvasRenderer';
import { canvasFont } from './fonts';
import { headingArrow, localToField, robotLabelOffset } from './robotLayout';
import { HANDLE_RADIUS, spawnHandlePoint } from './spawnEditLayout';
import type { SpawnPart, SpawnRobotId } from './spawnEditLayout';
import type { Alliance } from './canvasRenderer';
import { heatmapBasis, heatmapPixels, pendingRowRanges } from './heatmapView';
import { PX_PER_INCH, SCENE_HEIGHT_PX, SCENE_WIDTH_PX, VIEWPORT_PX, fieldPxMatrix, fieldToCanvas } from './viewTransform';
import type { Point2, ViewTransform } from './viewTransform';

export interface HeatmapEditScene {
  mode: 'HEATMAP';
  alliance: Alliance;                     // 진영 (기준 셀 / 색 척도)
  reference: ArrayLike<number> | null;    // 기준 셀 RED_AUDIENCE LUT (조립 중 버퍼 가능, 없으면 전부 미계산)
  rowsDone: ArrayLike<number> | null;     // 기준 LUT 행별 완료 (1 = 계산 끝남)
  sweetSpot: Point2 | null;               // 진영 기준 좌표 (관중석 시점 필드 좌표)
}

export interface SweetSpotEditScene {
  mode: 'SWEET_SPOT';
  alliance: Alliance;
  reference: ArrayLike<number> | null;    // 적용한 설정의 기준 셀 LUT (반투명, 계산된 행만)
  rowsDone: ArrayLike<number> | null;
  sweetSpot: Point2;                      // 초안 스윗스팟 (진영 기준)
  sweetSpotValid: boolean;                // 초안 스윗스팟 검증 통과 (아니면 빨간 윤곽)
  appliedSweetSpot: Point2 | null;        // 확률표를 만든 스윗스팟 (초안과 다를 때만 빈 고리로 표시)
  robotSize: { length: number; width: number }; // 초안 로봇 크기 (몸체 윤곽)
  hover: (Point2 & { valid: boolean }) | null;   // 마우스를 올린 격자 중심 (진영 기준) + 검증 통과
}

export interface SpawnEditRobot {
  pose: RobotPose;                                // 초안 시작 자세 (지정 안 했으면 진영 기본 스폰)
  config: Pick<RobotConfig, 'length' | 'width' | 'intakeZones'>; // 초안 로봇 크기 / 흡입 구역
  bad: boolean;                                   // 배치 검증에 걸림 (빨간 표시)
}

export interface SpawnEditScene {
  mode: 'SPAWN';
  alliance: Alliance;
  robots: Record<SpawnRobotId, SpawnEditRobot>;
  gardenPieces: readonly Point2[];                // GARDEN POLLEN (배치 검증 대상, 엔진 gardenPiecePositions)
  active: { robot: SpawnRobotId; part: SpawnPart } | null; // 끄는 중 / 마우스를 올린 로봇 부분 (강조)
}

/** 편집 모드 장면 */
export type EditScene = HeatmapEditScene | SweetSpotEditScene | SpawnEditScene;

const EDIT_COLORS = {
  pageBg: '#15171c', // 필드 둘레 (경기 장면과 같음)
  hatch: 'rgba(17, 24, 39, 0.22)',
  marker: '#111827',
  markerFill: '#ffffff',
  aimLine: 'rgba(17, 24, 39, 0.55)',
  valid: '#15803d',
  validFill: 'rgba(22, 163, 74, 0.35)',
  invalid: '#dc2626',
  invalidFill: 'rgba(220, 38, 38, 0.35)',
  applied: 'rgba(17, 24, 39, 0.5)',
};
const SWEET_SPOT_HEATMAP_ALPHA = 0.5;
const SPAWN_COLORS = {
  robot: { RED: ALLIANCE_COLORS.RED.base, BLUE: ALLIANCE_COLORS.BLUE.base } as Record<Alliance, string>,
  robotStroke: '#111827',
  heading: '#ffffff',
  intake: 'rgba(22, 163, 74, 0.25)',
  intakeStroke: 'rgba(21, 128, 61, 0.6)',
  bad: '#dc2626',
  badStripe: 'rgba(255, 255, 255, 0.6)', // 배치 문제 로봇 빗금 (진영색과 무관하게 보이게)
  handle: '#ffffff',
  handleActive: '#f59e0b',
  activeRing: 'rgba(245, 158, 11, 0.9)',
};
const HATCH_SPACING_PX = 8;
const AIM_MARK_INCH = 1.6;
const SWEET_SPOT_MARK_INCH = 2.2;

// 144 × 144 히트맵 이미지 (필드 px로 늘려 그림, 확대 보간 = 런타임 쌍선형 조회와 같은 모양)
type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;
let heatmapCanvas: ImageCanvas | null | undefined;
let heatmapBuffer: Uint8ClampedArray | null = null;

function heatmapImage(scene: HeatmapEditScene | SweetSpotEditScene): ImageCanvas | null {
  if (heatmapCanvas === undefined) {
    const n = LUT_GRID_SIZE;
    heatmapCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(n, n)
        : typeof document !== 'undefined'
          ? Object.assign(document.createElement('canvas'), { width: n, height: n })
          : null;
  }
  const hctx = heatmapCanvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!heatmapCanvas || !hctx || !scene.reference || !scene.rowsDone) return null;
  const image = hctx.createImageData(LUT_GRID_SIZE, LUT_GRID_SIZE);
  heatmapBuffer = heatmapPixels(scene.reference, scene.rowsDone, scene.alliance, heatmapBuffer ?? undefined);
  image.data.set(heatmapBuffer);
  hctx.putImageData(image, 0, 0);
  return heatmapCanvas;
}

// 미계산 행: 바닥 위 사선 빗금 (행 구간마다 잘라서)
function drawPendingHatch(ctx: CanvasRenderingContext2D, ranges: readonly [number, number][]): void {
  const size = inchToPx(LUT_GRID_SIZE);
  ctx.save();
  ctx.strokeStyle = EDIT_COLORS.hatch;
  ctx.lineWidth = 1.5;
  for (const [start, end] of ranges) {
    const top = inchToPx(start);
    const bottom = inchToPx(end);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, size, bottom - top);
    ctx.clip();
    ctx.beginPath();
    for (let x = -(bottom - top); x < size; x += HATCH_SPACING_PX) {
      ctx.moveTo(x, bottom);
      ctx.lineTo(x + (bottom - top), top);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawBasisCell(ctx: CanvasRenderingContext2D, alliance: Alliance): void {
  const box = hiveCellBox(alliance, heatmapBasis(alliance).cell);
  ctx.save();
  ctx.fillStyle = ALLIANCE_COLORS[alliance].base;
  ctx.fillRect(inchToPx(box.x), inchToPx(box.y), inchToPx(box.width), inchToPx(box.height));
  const w = 4;
  ctx.lineWidth = w;
  ctx.strokeStyle = COLORS.upHighlight;
  ctx.strokeRect(inchToPx(box.x) + w / 2, inchToPx(box.y) + w / 2, inchToPx(box.width) - w, inchToPx(box.height) - w);
  ctx.restore();
}

function obbCornersPx(center: Point2, aim: Point2, size: { length: number; width: number }): Point2[] {
  const obb = aimingRobotOBB(center.x, center.y, aim, size);
  const [f, r] = obb.axes;
  const [hl, hw] = obb.halfExtents;
  const at = (a: number, b: number) => ({ x: inchToPx(obb.center.x + f.x * a + r.x * b), y: inchToPx(obb.center.y + f.y * a + r.y * b) });
  return [at(hl, -hw), at(hl, hw), at(-hl, hw), at(-hl, -hw)]; // 앞-왼, 앞-오른, 뒤-오른, 뒤-왼
}

// 조준점을 향해 돌린 로봇 몸체 윤곽 (앞 변 굵게)
function drawAimingBody(ctx: CanvasRenderingContext2D, center: Point2, aim: Point2, size: { length: number; width: number }, stroke: string, fill: string | null, dashed: boolean): void {
  const pts = obbCornersPx(center, aim, size);
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

// 스윗스팟 모드: 확률표를 만든 스윗스팟(빈 고리) → 마우스를 올린 격자 + 몸체 윤곽 → 초안 몸체 윤곽
function drawSweetSpotEdit(ctx: CanvasRenderingContext2D, scene: SweetSpotEditScene): void {
  const aim = heatmapBasis(scene.alliance).aim;
  const a = scene.appliedSweetSpot;
  if (a && (a.x !== scene.sweetSpot.x || a.y !== scene.sweetSpot.y)) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(inchToPx(a.x), inchToPx(a.y), inchToPx(SWEET_SPOT_MARK_INCH), 0, Math.PI * 2);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = EDIT_COLORS.applied;
    ctx.stroke();
    ctx.restore();
  }
  const h = scene.hover;
  if (h) {
    const stroke = h.valid ? EDIT_COLORS.valid : EDIT_COLORS.invalid;
    drawAimingBody(ctx, h, aim, scene.robotSize, stroke, null, true);
    ctx.save();
    ctx.fillStyle = h.valid ? EDIT_COLORS.validFill : EDIT_COLORS.invalidFill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    const x = inchToPx(h.x - 0.5);
    const y = inchToPx(h.y - 0.5);
    ctx.fillRect(x, y, PX_PER_INCH, PX_PER_INCH);
    ctx.strokeRect(x, y, PX_PER_INCH, PX_PER_INCH);
    ctx.restore();
  }
  drawAimingBody(ctx, scene.sweetSpot, aim, scene.robotSize, scene.sweetSpotValid ? EDIT_COLORS.marker : EDIT_COLORS.invalid, null, false);
}

function drawMarkers(ctx: CanvasRenderingContext2D, scene: HeatmapEditScene | SweetSpotEditScene): void {
  const aim = heatmapBasis(scene.alliance).aim;
  ctx.save();
  // 스윗스팟 → 조준점 점선 (정면 조준 방향)
  if (scene.sweetSpot) {
    ctx.beginPath();
    ctx.moveTo(inchToPx(scene.sweetSpot.x), inchToPx(scene.sweetSpot.y));
    ctx.lineTo(inchToPx(aim.x), inchToPx(aim.y));
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = EDIT_COLORS.aimLine;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 조준점: 흰 원 + 십자
  const r = inchToPx(AIM_MARK_INCH);
  const ax = inchToPx(aim.x);
  const ay = inchToPx(aim.y);
  ctx.beginPath();
  ctx.arc(ax, ay, r, 0, Math.PI * 2);
  ctx.fillStyle = EDIT_COLORS.markerFill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDIT_COLORS.marker;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax - r * 1.6, ay);
  ctx.lineTo(ax + r * 1.6, ay);
  ctx.moveTo(ax, ay - r * 1.6);
  ctx.lineTo(ax, ay + r * 1.6);
  ctx.stroke();
  // 스윗스팟: 흰 원 + 굵은 테두리 + 가운데 점
  if (scene.sweetSpot) {
    const sx = inchToPx(scene.sweetSpot.x);
    const sy = inchToPx(scene.sweetSpot.y);
    ctx.beginPath();
    ctx.arc(sx, sy, inchToPx(SWEET_SPOT_MARK_INCH), 0, Math.PI * 2);
    ctx.fillStyle = EDIT_COLORS.markerFill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = EDIT_COLORS.marker;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, PX_PER_INCH * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = EDIT_COLORS.marker;
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------
// 시작 자세 모드 (09-11b)
// ------------------------------------------------------------

function pathCorners(ctx: CanvasRenderingContext2D, pts: readonly Point2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(inchToPx(p.x), inchToPx(p.y)) : ctx.lineTo(inchToPx(p.x), inchToPx(p.y))));
  ctx.closePath();
}

function obbPoints(obb: ReturnType<typeof getRobotOBB>): Point2[] {
  const [f, r] = obb.axes;
  const [hl, hw] = obb.halfExtents;
  const at = (a: number, b: number) => ({ x: obb.center.x + f.x * a + r.x * b, y: obb.center.y + f.y * a + r.y * b });
  return [at(hl, -hw), at(hl, hw), at(-hl, hw), at(-hl, -hw)]; // 앞-왼, 앞-오른, 뒤-오른, 뒤-왼
}

// 로봇 한 대: 흡입 구역 → 몸체(진영색, 문제면 빨간 덧칠 + 빨간 테두리) → 앞 변 굵게 → 헤딩 화살표 → 핸들 막대 / 원
function drawSpawnRobot(ctx: CanvasRenderingContext2D, robot: SpawnEditRobot, ally: Alliance, active: SpawnPart | null): void {
  const { pose, config } = robot;
  const body = getRobotOBB(pose, config);
  const corners = obbPoints(body);
  ctx.save();
  for (const zone of config.intakeZones) {
    const obb = getBumperZoneOBB(body, zone);
    if (!obb) continue;
    pathCorners(ctx, obbPoints(obb));
    ctx.fillStyle = SPAWN_COLORS.intake;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = SPAWN_COLORS.intakeStroke;
    ctx.stroke();
  }
  pathCorners(ctx, corners);
  ctx.fillStyle = SPAWN_COLORS.robot[ally];
  ctx.fill();
  if (robot.bad) {
    // 흰 사선 빗금 (RED 로봇에 빨간 덧칠은 안 보이므로)
    ctx.save();
    ctx.clip();
    const r = Math.hypot(config.length, config.width) / 2;
    ctx.beginPath();
    for (let d = -2 * r; d <= 2 * r; d += 3) {
      ctx.moveTo(inchToPx(pose.x + d - r), inchToPx(pose.y + r));
      ctx.lineTo(inchToPx(pose.x + d + r), inchToPx(pose.y - r));
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = SPAWN_COLORS.badStripe;
    ctx.stroke();
    ctx.restore();
    pathCorners(ctx, corners);
  }
  ctx.lineWidth = robot.bad ? 3.5 : 2.25;
  ctx.strokeStyle = robot.bad ? SPAWN_COLORS.bad : SPAWN_COLORS.robotStroke;
  ctx.stroke();
  if (active === 'body') {
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = SPAWN_COLORS.activeRing;
    pathCorners(ctx, obbPoints({ ...body, halfExtents: [body.halfExtents[0] + 1.2, body.halfExtents[1] + 1.2] }));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 앞 변 굵게 + 헤딩 화살표
  ctx.beginPath();
  ctx.moveTo(inchToPx(corners[0].x), inchToPx(corners[0].y));
  ctx.lineTo(inchToPx(corners[1].x), inchToPx(corners[1].y));
  ctx.lineWidth = 4;
  ctx.strokeStyle = robot.bad ? SPAWN_COLORS.bad : SPAWN_COLORS.robotStroke;
  ctx.stroke();
  pathCorners(ctx, headingArrow(config.length).map(p => localToField(pose, p)));
  ctx.fillStyle = SPAWN_COLORS.heading;
  ctx.fill();
  // 회전 핸들: 앞 변 가운데 → 핸들 원
  const front = { x: pose.x + Math.cos(pose.heading) * (config.length / 2), y: pose.y + Math.sin(pose.heading) * (config.length / 2) };
  const h = spawnHandlePoint(pose, config);
  const handleColor = active === 'handle' ? SPAWN_COLORS.handleActive : SPAWN_COLORS.handle;
  ctx.beginPath();
  ctx.moveTo(inchToPx(front.x), inchToPx(front.y));
  ctx.lineTo(inchToPx(h.x), inchToPx(h.y));
  ctx.lineWidth = 2;
  ctx.strokeStyle = SPAWN_COLORS.robotStroke;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(inchToPx(h.x), inchToPx(h.y), inchToPx(HANDLE_RADIUS), 0, Math.PI * 2);
  ctx.fillStyle = handleColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = SPAWN_COLORS.robotStroke;
  ctx.stroke();
  ctx.restore();
}

function renderSpawnField(ctx: CanvasRenderingContext2D, scene: SpawnEditScene): void {
  const ally = scene.alliance;
  drawFieldBackground(ctx);
  drawGardens(ctx, false, ally);
  drawLoadingZones(ctx, false, ally);
  drawHiveBase(ctx, ally);
  drawFlowers(ctx, false);
  ctx.save();
  const r = PIECE_PHYSICS.POLLEN.radius;
  for (const p of scene.gardenPieces) {
    ctx.beginPath();
    ctx.arc(inchToPx(p.x), inchToPx(p.y), inchToPx(r), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pollenFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.pollenStroke;
    ctx.stroke();
  }
  ctx.restore();
  // 끄는 로봇을 위에 (R1 → R2 순서, 끄는 로봇은 마지막)
  const order: SpawnRobotId[] = scene.active?.robot === 'robot1' ? ['robot2', 'robot1'] : ['robot1', 'robot2'];
  for (const id of order) drawSpawnRobot(ctx, scene.robots[id], ally, scene.active?.robot === id ? scene.active.part : null);
}

// 로봇 번호 (화면 공간, 똑바로)
function drawSpawnLabels(ctx: CanvasRenderingContext2D, scene: SpawnEditScene, view: ViewTransform): void {
  ctx.save();
  ctx.font = canvasFont(12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [id, num] of [['robot1', '1'], ['robot2', '2']] as const) {
    const { pose, config } = scene.robots[id];
    const p = localToField(pose, robotLabelOffset(config.length));
    const at = fieldToCanvas(view, p.x, p.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = SPAWN_COLORS.robotStroke;
    ctx.strokeText(num, at.x, at.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(num, at.x, at.y);
  }
  ctx.restore();
}

/**
 * 편집 모드 장면 전체 (히트맵 / 스윗스팟 / 시작 자세 모드). ctx는 경기 장면과 같은 800 × 800 논리 크기 × dpr 버퍼의 캔버스, view는 관중석 시점(경기 전)
 * 순서: 둘레 배경 → 바닥 회색 → 히트맵(스윗스팟 모드는 반투명) → 미계산 행 빗금(히트맵 모드만) → 타일 / 벽 → HIVE(기준 셀 강조)
 *       → [스윗스팟 모드: 적용한 스윗스팟 고리 / 마우스 격자 + 윤곽 / 초안 몸체 윤곽] → 스윗스팟 → 조준점 점선 / 표시
 */
export function renderEditScene(ctx: CanvasRenderingContext2D, scene: EditScene, view: ViewTransform, dpr = 1): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);
  ctx.fillStyle = EDIT_COLORS.pageBg;
  ctx.fillRect(0, 0, SCENE_WIDTH_PX, SCENE_HEIGHT_PX);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEWPORT_PX, VIEWPORT_PX);
  ctx.clip();
  ctx.setTransform(...fieldPxMatrix(view, dpr));

  if (scene.mode === 'SPAWN') {
    renderSpawnField(ctx, scene);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSpawnLabels(ctx, scene, view);
    ctx.restore();
    return;
  }

  const size = inchToPx(LUT_GRID_SIZE);
  ctx.fillStyle = COLORS.fieldBg;
  ctx.fillRect(0, 0, size, size);
  const image = heatmapImage(scene);
  if (image) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = scene.mode === 'SWEET_SPOT' ? SWEET_SPOT_HEATMAP_ALPHA : 1;
    ctx.drawImage(image, 0, 0, size, size);
    ctx.globalAlpha = 1;
  }
  if (scene.mode === 'HEATMAP') drawPendingHatch(ctx, scene.rowsDone ? pendingRowRanges(scene.rowsDone, scene.alliance) : [[0, LUT_GRID_SIZE]]);
  drawFieldLines(ctx);
  drawHiveBase(ctx, scene.alliance);
  drawBasisCell(ctx, scene.alliance);
  if (scene.mode === 'SWEET_SPOT') drawSweetSpotEdit(ctx, scene);
  drawMarkers(ctx, scene);
  ctx.restore();
}
