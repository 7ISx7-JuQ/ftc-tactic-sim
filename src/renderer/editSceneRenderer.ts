// 필드 편집 모드 장면 (명세서 3.8 필드 편집 모드, 09-10b): 경기 전 관중석 시점에서 경기 장면 대신 그린다.
// 09-10b = 히트맵(HEATMAP) 모드: 회색 바닥 + 진영 기준 셀 명중 확률표(파스텔 척도, 미계산 행 회색 빗금)
//   + 타일 / 벽 + HIVE(기준 셀 강조) + 조준점 + 스윗스팟. 생성 중이면 호출할 때마다 조립 중 버퍼를 다시 읽어 행이 채워진다.
// 09-10c = 스윗스팟(SWEET_SPOT) 모드: 같은 바닥 위에 적용한 확률표를 반투명(계산된 행만, 빗금 없음)으로 깔고,
//   마우스를 올린 격자 강조 + 그 자리에서 조준점을 향해 돌린 로봇 몸체 윤곽(올바르면 초록 / 틀리면 빨강),
//   초안 스윗스팟의 몸체 윤곽 + 조준 점선 + 표시, 확률표를 만든(적용한) 스윗스팟은 초안과 다를 때 빈 고리로.
// 로봇 / 기물 / 게이지는 그리지 않는다 (편집 모드의 필드는 비어 있음). 색 / 행 계산은 heatmapView.ts (순수 함수).

import { LUT_GRID_SIZE, aimingRobotOBB } from '../core/ballistics';
import { ALLIANCE_COLORS, COLORS, drawFieldLines, drawHiveBase, hiveCellBox, inchToPx } from './canvasRenderer';
import type { Alliance } from './canvasRenderer';
import { heatmapBasis, heatmapPixels, pendingRowRanges } from './heatmapView';
import { PX_PER_INCH, SCENE_HEIGHT_PX, SCENE_WIDTH_PX, VIEWPORT_PX, fieldPxMatrix } from './viewTransform';
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

/** 편집 모드 장면 (09-11 시작 자세 모드가 늘어남) */
export type EditScene = HeatmapEditScene | SweetSpotEditScene;

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
const HATCH_SPACING_PX = 8;
const AIM_MARK_INCH = 1.6;
const SWEET_SPOT_MARK_INCH = 2.2;

// 144 × 144 히트맵 이미지 (필드 px로 늘려 그림, 확대 보간 = 런타임 쌍선형 조회와 같은 모양)
type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;
let heatmapCanvas: ImageCanvas | null | undefined;
let heatmapBuffer: Uint8ClampedArray | null = null;

function heatmapImage(scene: EditScene): ImageCanvas | null {
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

function drawMarkers(ctx: CanvasRenderingContext2D, scene: EditScene): void {
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

/**
 * 편집 모드 장면 전체 (히트맵 / 스윗스팟 모드). ctx는 경기 장면과 같은 800 × 800 논리 크기 × dpr 버퍼의 캔버스, view는 관중석 시점(경기 전)
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
