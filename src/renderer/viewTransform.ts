// 캔버스 레이아웃 / 보기 방향 / 좌표 변환 (명세서 3.7, 08-4)
// DOM 비의존 순수 함수. 좌표 단위: 필드 inch, 논리 px (1 in = 5 px, devicePixelRatio 적용 전), 화면(CSS) px

import { FIELD_SIZE } from '../core/collision';

// 1. 레이아웃 (논리 px)
export const PX_PER_INCH = 5;
export const FIELD_MARGIN_INCH = 8;                                   // 필드 사방 여백 (게이지 / 재고 / 라벨)
export const VIEWPORT_INCH = FIELD_SIZE + 2 * FIELD_MARGIN_INCH;       // 160 in 정사각형
export const VIEWPORT_PX = VIEWPORT_INCH * PX_PER_INCH;                // 800
export const SIDE_PANEL_PX = 40 * PX_PER_INCH;                         // 좌우 정보 패널 각 200 px (왼쪽 R1, 오른쪽 R2)
export const SCENE_WIDTH_PX = VIEWPORT_PX + 2 * SIDE_PANEL_PX;         // 1200
export const SCENE_HEIGHT_PX = VIEWPORT_PX;                            // 800
export const VIEWPORT_CENTER_PX = { x: SIDE_PANEL_PX + VIEWPORT_PX / 2, y: VIEWPORT_PX / 2 }; // (600, 400)
const FIELD_CENTER_INCH = FIELD_SIZE / 2;

export interface Point2 {
  x: number;
  y: number;
}

// 2. 보기 방향
// AUDIENCE: 좌표 그대로 (관중석 Y = 144가 화면 아래) / DRIVER: 선택 진영 드라이버 시점 (아군 벽이 화면 아래)
export type ViewMode = 'AUDIENCE' | 'DRIVER';

/** 보기 회전각 θ (rad, 캔버스 회전 규약: 양수 = 화면 시계 방향). RED 드라이버 −90°, BLUE +90° */
export function viewAngle(mode: ViewMode, alliance: 'RED' | 'BLUE'): number {
  if (mode === 'AUDIENCE') return 0;
  return alliance === 'RED' ? -Math.PI / 2 : Math.PI / 2;
}

/** 회전된 정사각형이 뷰포트를 벗어나지 않는 배율 1 / (|cos θ| + |sin θ|) (0 / ±90°에서 1, 45°에서 약 0.71) */
export function fitScale(angle: number): number {
  return 1 / (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
}

/** 현재 보기 변환: 필드 중심 기준 회전각 + 배율 */
export interface ViewTransform {
  angle: number;
  scale: number;
}

export function restingView(mode: ViewMode, alliance: 'RED' | 'BLUE'): ViewTransform {
  const angle = viewAngle(mode, alliance);
  return { angle, scale: fitScale(angle) };
}

// 3. 전환 애니메이션 (700 ms easeInOutCubic, 벽시계 시간 주입 — 화면 연출 전용, 엔진 / 기록과 무관)
export const VIEW_ANIMATION_MS = 700;

export function easeInOutCubic(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class ViewAnimator {
  private from: number;
  private to: number;
  private startMs: number | null = null;

  constructor(initialAngle = 0) {
    this.from = initialAngle;
    this.to = initialAngle;
  }

  /** 현재 표시 각도(now 기준)에서 target으로 회전 시작 */
  start(targetAngle: number, nowMs: number): void {
    this.from = this.sample(nowMs).angle;
    this.to = targetAngle;
    this.startMs = nowMs;
  }

  /** 애니메이션 없이 즉시 이동 */
  jump(angle: number): void {
    this.from = angle;
    this.to = angle;
    this.startMs = null;
  }

  sample(nowMs: number): ViewTransform & { done: boolean } {
    if (this.startMs === null) return { angle: this.to, scale: fitScale(this.to), done: true };
    const u = (nowMs - this.startMs) / VIEW_ANIMATION_MS;
    if (!(u < 1)) {
      this.startMs = null;
      this.from = this.to;
      return { angle: this.to, scale: fitScale(this.to), done: true };
    }
    const angle = this.from + (this.to - this.from) * easeInOutCubic(u);
    return { angle, scale: fitScale(angle), done: false };
  }
}

// 4. 좌표 변환: 필드 inch ↔ 논리 px (필드 중심 → 뷰포트 중심, 회전 θ, 배율 s)
export function fieldToCanvas(view: ViewTransform, x: number, y: number): Point2 {
  const k = view.scale * PX_PER_INCH;
  const dx = x - FIELD_CENTER_INCH;
  const dy = y - FIELD_CENTER_INCH;
  const c = Math.cos(view.angle);
  const s = Math.sin(view.angle);
  return { x: VIEWPORT_CENTER_PX.x + k * (dx * c - dy * s), y: VIEWPORT_CENTER_PX.y + k * (dx * s + dy * c) };
}

export function canvasToField(view: ViewTransform, px: number, py: number): Point2 {
  const k = view.scale * PX_PER_INCH;
  const dx = (px - VIEWPORT_CENTER_PX.x) / k;
  const dy = (py - VIEWPORT_CENTER_PX.y) / k;
  const c = Math.cos(view.angle);
  const s = Math.sin(view.angle);
  return { x: FIELD_CENTER_INCH + dx * c + dy * s, y: FIELD_CENTER_INCH - dx * s + dy * c };
}

/** 화면(CSS) px → 논리 px (캔버스를 CSS로 비율 유지 확대 / 축소한 경우, 클릭 입력용) */
export function cssToCanvas(cssX: number, cssY: number, cssWidth: number, cssHeight: number): Point2 {
  return { x: (cssX * SCENE_WIDTH_PX) / cssWidth, y: (cssY * SCENE_HEIGHT_PX) / cssHeight };
}

/**
 * 똑바로 그리는 글자 상자(폭 w, 높이 h 논리 px)의 중심: 구조물 가장자리 anchor(필드)에서 바깥 방향 outward(필드 단위 벡터)로,
 * 화면에서 글자 상자가 가장자리에 닿지 않을 만큼(상자 반폭 / 반높이의 법선 성분 + gap) 떨어뜨림. 보기 회전과 무관하게 겹치지 않음
 */
export function labelCenter(view: ViewTransform, anchor: Point2, outward: Point2, w: number, h: number, gap: number): Point2 {
  const a = fieldToCanvas(view, anchor.x, anchor.y);
  const c = Math.cos(view.angle);
  const s = Math.sin(view.angle);
  const nx = outward.x * c - outward.y * s;
  const ny = outward.x * s + outward.y * c;
  const d = (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2 + gap;
  return { x: a.x + nx * d, y: a.y + ny * d };
}

/** 화면 위쪽(논리 px −y)에 해당하는 필드 단위 벡터 (높이 오프셋 / 배지 배치용) */
export function screenUpInField(view: ViewTransform): Point2 {
  return { x: -Math.sin(view.angle), y: -Math.cos(view.angle) };
}

/**
 * 캔버스 변환 행렬 [a, b, c, d, e, f] (setTransform 인자): 필드 px(= inch × 5, 원점 필드 좌상단) → 논리 px에
 * devicePixelRatio를 곱한 버퍼 px. 필드 px로 그리는 기존 렌더 함수를 그대로 회전 / 배율 적용해 쓰기 위함
 */
export function fieldPxMatrix(view: ViewTransform, dpr = 1): [number, number, number, number, number, number] {
  const c = Math.cos(view.angle) * view.scale * dpr;
  const s = Math.sin(view.angle) * view.scale * dpr;
  const half = (FIELD_SIZE * PX_PER_INCH) / 2;
  // p' = dpr·center + R·s·(p − half)
  return [c, s, -s, c, dpr * VIEWPORT_CENTER_PX.x - (c * half - s * half), dpr * VIEWPORT_CENTER_PX.y - (s * half + c * half)];
}
