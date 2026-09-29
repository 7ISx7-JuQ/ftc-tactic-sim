// 필드 편집 모드 장면 (명세서 3.8 필드 편집 모드, 09-10b): 경기 전 관중석 시점에서 경기 장면 대신 그린다.
// 09-10b = 히트맵(HEATMAP) 모드: 회색 바닥 + 진영 기준 셀 명중 확률표(파스텔 척도, 미계산 행 회색 빗금)
//   + 타일 / 벽 + HIVE(기준 셀 강조) + 조준점 + 스윗스팟. 생성 중이면 호출할 때마다 조립 중 버퍼를 다시 읽어 행이 채워진다.
// 로봇 / 기물 / 게이지는 그리지 않는다 (편집 모드의 필드는 비어 있음). 색 / 행 계산은 heatmapView.ts (순수 함수).

import { LUT_GRID_SIZE } from '../core/ballistics';
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

/** 편집 모드 장면 (09-10c 스윗스팟 / 09-11 시작 자세 모드가 늘어남) */
export type EditScene = HeatmapEditScene;

const EDIT_COLORS = {
  pageBg: '#15171c', // 필드 둘레 (경기 장면과 같음)
  hatch: 'rgba(17, 24, 39, 0.22)',
  marker: '#111827',
  markerFill: '#ffffff',
  aimLine: 'rgba(17, 24, 39, 0.55)',
};
const HATCH_SPACING_PX = 8;
const AIM_MARK_INCH = 1.6;
const SWEET_SPOT_MARK_INCH = 2.2;

// 144 × 144 히트맵 이미지 (필드 px로 늘려 그림, 확대 보간 = 런타임 쌍선형 조회와 같은 모양)
type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;
let heatmapCanvas: ImageCanvas | null | undefined;
let heatmapBuffer: Uint8ClampedArray | null = null;

function heatmapImage(scene: HeatmapEditScene): ImageCanvas | null {
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

function drawMarkers(ctx: CanvasRenderingContext2D, scene: HeatmapEditScene): void {
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
 * 편집 모드 장면 전체. ctx는 경기 장면과 같은 800 × 800 논리 크기 × dpr 버퍼의 캔버스, view는 관중석 시점(경기 전)
 * 순서: 둘레 배경 → 바닥 회색 → 히트맵 → 미계산 행 빗금 → 타일 / 벽 → HIVE(기준 셀 강조) → 스윗스팟 → 조준점 점선 / 표시
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
    ctx.drawImage(image, 0, 0, size, size);
  }
  drawPendingHatch(ctx, scene.rowsDone ? pendingRowRanges(scene.rowsDone, scene.alliance) : [[0, LUT_GRID_SIZE]]);
  drawFieldLines(ctx);
  drawHiveBase(ctx, scene.alliance);
  drawBasisCell(ctx, scene.alliance);
  drawMarkers(ctx, scene);
  ctx.restore();
}
