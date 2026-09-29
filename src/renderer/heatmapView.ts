// 명중 확률표 히트맵 표시 규칙 (명세서 3.8 필드 편집 모드 / 09-10 확정 ⑦, 2.6.2 점진 히트맵): DOM 비의존 순수 함수
// - 히트맵은 진영 기준 셀 LUT를 관중석 시점 필드 좌표에 그린다: RED = 기준 셀 RED_AUDIENCE 그대로, BLUE = 필드 중심 점대칭(BLUE_OPPOSITE).
// - 색 척도는 진영별 파스텔 그라데이션. 0 %는 필드 바닥색(#d9d9d9)이라 명중 불가 구역은 바닥 그대로 보인다.
// - 아직 계산되지 않은 행은 바닥색으로 두고 그 위에 회색 빗금 (행 범위는 pendingRowRanges).

import { LUT_GRID_SIZE, lutIndex, sweetSpotBasisCell } from '../core/ballistics';
import { hiveCellAimPoint } from '../core/collision';
import type { HiveCellKey } from '../core/types';
import { COLORS } from './canvasRenderer';
import type { Alliance, HiveCell } from './canvasRenderer';

export type RGB = readonly [number, number, number];

/** 사용자 지정 진영별 파스텔 척도 (09-10 확정 ⑦, 낮음 → 높음). 0 % 쪽 밝은 색들은 바닥색이 대신한다 (heatmapStops) */
export const HEATMAP_PALETTES: Readonly<Record<Alliance, readonly string[]>> = {
  RED: ['#F8FAFC', '#FFF0F2', '#FFE4E6', '#FECDD3', '#FDA4AF', '#FB7185', '#F43F5E'],
  BLUE: ['#F8FAFC', '#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0284C7'],
};

export const HEATMAP_FLOOR = COLORS.fieldBg; // 인게임 바닥 회색 (217)
export const HEATMAP_PALETTE_START = 3;       // 척도에 쓰는 팔레트 첫 색 번호 (아래 heatmapStops)

export function parseHex(hex: string): RGB {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export interface HeatmapStop {
  at: number; // 0 ~ 1
  rgb: RGB;
}

/**
 * 색 척도 정지점: 0 = 바닥색, 이후 팔레트의 넷째 색부터 마지막 색까지 (0, 1]에 고르게.
 * 팔레트 앞 세 색(흰색에 가까움)은 회색 바닥보다 밝아 낮은 확률 구역이 흰 테두리처럼 떠 보이므로 쓰지 않는다
 * (09-10b 비교: 바닥색 다음 둘째 / 셋째 / 넷째 색부터 시작 중 넷째가 바닥에서 가장 자연스럽게 이어짐). 바닥색이 그 자리를 이어받는다.
 */
export function heatmapStops(alliance: Alliance): HeatmapStop[] {
  const colors = HEATMAP_PALETTES[alliance].slice(HEATMAP_PALETTE_START);
  return [{ at: 0, rgb: parseHex(HEATMAP_FLOOR) }, ...colors.map((c, i) => ({ at: (i + 1) / colors.length, rgb: parseHex(c) }))];
}

const STOPS: Readonly<Record<Alliance, HeatmapStop[]>> = { RED: heatmapStops('RED'), BLUE: heatmapStops('BLUE') };

/** 명중률 p (0 ~ 1, 범위 밖 / 비유한은 잘라냄) → 색 (정지점 사이 sRGB 선형 보간, 정수) */
export function heatmapColor(p: number, alliance: Alliance): RGB {
  const stops = STOPS[alliance];
  const v = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  let i = 1;
  while (i < stops.length - 1 && v > stops[i].at) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const u = (v - a.at) / (b.at - a.at);
  return [0, 1, 2].map(k => Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * u)) as unknown as RGB;
}

/** 범례용 CSS 그라데이션 (왼쪽 0 % → 오른쪽 100 %) */
export function heatmapGradientCss(alliance: Alliance): string {
  const parts = STOPS[alliance].map(s => `rgb(${s.rgb.join(', ')}) ${Math.round(s.at * 1000) / 10}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** 화면(진영 기준) 격자 (gx, gy) → 기준 셀 LUT 격자: RED 그대로, BLUE 점대칭 (mirrorLUTSet의 BLUE_OPPOSITE와 같은 변환) */
export function basisSourceIndex(gx: number, gy: number, alliance: Alliance): number {
  const n = LUT_GRID_SIZE;
  return alliance === 'RED' ? lutIndex(gx, gy) : lutIndex(n - 1 - gx, n - 1 - gy);
}

/** 화면 행 gy가 계산되었는지 (BLUE는 기준 LUT의 뒤집힌 행) */
export function displayRowDone(rowsDone: ArrayLike<number>, gy: number, alliance: Alliance): boolean {
  return rowsDone[alliance === 'RED' ? gy : LUT_GRID_SIZE - 1 - gy] === 1;
}

/**
 * 히트맵 픽셀 (RGBA, 144 × 144, 화면 격자 순서 = 필드 좌표 1 in 격자). 계산 안 된 행은 바닥색.
 * out을 주면 그 버퍼에 채워 반환 (매 그리기마다 새로 만들지 않음)
 */
export function heatmapPixels(reference: ArrayLike<number>, rowsDone: ArrayLike<number>, alliance: Alliance, out?: Uint8ClampedArray): Uint8ClampedArray {
  const n = LUT_GRID_SIZE;
  const px = out ?? new Uint8ClampedArray(n * n * 4);
  const floor = STOPS[alliance][0].rgb;
  for (let gy = 0; gy < n; gy++) {
    const done = displayRowDone(rowsDone, gy, alliance);
    for (let gx = 0; gx < n; gx++) {
      const rgb = done ? heatmapColor(reference[basisSourceIndex(gx, gy, alliance)], alliance) : floor;
      const o = (gy * n + gx) * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = 255;
    }
  }
  return px;
}

/** 계산 안 된 화면 행 구간 [시작, 끝) 목록 (빗금용, 위 → 아래) */
export function pendingRowRanges(rowsDone: ArrayLike<number>, alliance: Alliance): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let gy = 0; gy <= LUT_GRID_SIZE; gy++) {
    const pending = gy < LUT_GRID_SIZE && !displayRowDone(rowsDone, gy, alliance);
    if (pending && start < 0) start = gy;
    if (!pending && start >= 0) {
      ranges.push([start, gy]);
      start = -1;
    }
  }
  return ranges;
}

/** 진영 기준 셀 (명세서 3.8 스윗스팟 진영 기준 입력): RED → RED_AUDIENCE, BLUE → BLUE_OPPOSITE — 셀 키 / HIVE 칸 / 조준점 */
export function heatmapBasis(alliance: Alliance): { key: HiveCellKey; cell: HiveCell; aim: { x: number; y: number } } {
  const cell: HiveCell = alliance === 'RED' ? 'AUDIENCE_CELL' : 'OPPOSITE_CELL';
  const aim = hiveCellAimPoint(alliance, cell);
  return { key: sweetSpotBasisCell(alliance), cell, aim: { x: aim.x, y: aim.y } };
}
