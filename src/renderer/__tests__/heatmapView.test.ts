// 명중 확률표 히트맵 표시 규칙 (명세서 3.8 필드 편집 모드 / 09-10 확정 ⑦, 09-10b)
import { describe, expect, it } from 'vitest';
import { LUT_GRID_SIZE, lutIndex, mirrorLUTSet } from '../../core/ballistics';
import { hiveCellAimPoint } from '../../core/collision';
import {
  HEATMAP_FLOOR,
  HEATMAP_PALETTES,
  HEATMAP_PALETTE_START,
  basisSourceIndex,
  heatmapBasis,
  heatmapColor,
  heatmapGradientCss,
  heatmapPixels,
  heatmapStops,
  parseHex,
  pendingRowRanges,
} from '../heatmapView';

const N = LUT_GRID_SIZE;
const ALLIANCES = ['RED', 'BLUE'] as const;
// 격자마다 다른 값 (0 ~ 1)
const pattern = () => Float32Array.from({ length: N * N }, (_, i) => ((i * 37) % 101) / 100);
const allRows = (v: number) => new Uint8Array(N).fill(v);

describe('히트맵 표시 규칙 (09-10b)', () => {
  it('A. 색 척도: 0 % = 바닥색, 100 % = 진영 팔레트 마지막 색, 정지점 그대로, 범위 밖 / 비유한은 잘라냄', () => {
    expect(parseHex('#D9D9D9')).toEqual([217, 217, 217]);
    for (const a of ALLIANCES) {
      const stops = heatmapStops(a);
      const palette = HEATMAP_PALETTES[a];
      expect(stops.length).toBe(palette.length - HEATMAP_PALETTE_START + 1); // 앞쪽 밝은 색 자리를 바닥색이 대신
      expect(stops[0]).toEqual({ at: 0, rgb: parseHex(HEATMAP_FLOOR) });
      stops.slice(1).forEach((s, i) => expect(s.rgb).toEqual(parseHex(palette[i + HEATMAP_PALETTE_START])));
      stops.slice(1).forEach((s, i) => expect(s.at).toBeCloseTo((i + 1) / (stops.length - 1), 12));
      for (const s of stops) expect(heatmapColor(s.at, a)).toEqual(s.rgb);
      expect(heatmapColor(0, a)).toEqual([217, 217, 217]);
      expect(heatmapColor(1, a)).toEqual(parseHex(palette[palette.length - 1]));
      expect(heatmapColor(-0.5, a)).toEqual(heatmapColor(0, a));
      expect(heatmapColor(3, a)).toEqual(heatmapColor(1, a));
      expect(heatmapColor(Number.NaN, a)).toEqual(heatmapColor(0, a));
      // 정지점 사이는 선형 보간 (중간값은 두 정지점 사이)
      const mid = heatmapColor((stops[1].at + stops[2].at) / 2, a);
      mid.forEach((v, k) => expect(v).toBe(Math.round((stops[1].rgb[k] + stops[2].rgb[k]) / 2)));
      const css = heatmapGradientCss(a);
      expect(css.startsWith('linear-gradient(90deg, rgb(217, 217, 217) 0%')).toBe(true);
      expect(css.endsWith(`rgb(${parseHex(palette[palette.length - 1]).join(', ')}) 100%)`)).toBe(true);
    }
    expect(heatmapColor(1, 'RED')).not.toEqual(heatmapColor(1, 'BLUE'));
  });

  it('B. 픽셀: RED = 기준 LUT 그대로, BLUE = 점대칭(mirrorLUTSet BLUE_OPPOSITE와 같음), 미계산 행 = 바닥색, 버퍼 재사용', () => {
    const ref = pattern();
    expect(basisSourceIndex(3, 5, 'RED')).toBe(lutIndex(3, 5));
    expect(basisSourceIndex(3, 5, 'BLUE')).toBe(lutIndex(N - 4, N - 6));
    const blue = mirrorLUTSet(ref).BLUE_OPPOSITE;
    const pxRed = heatmapPixels(ref, allRows(1), 'RED');
    const pxBlue = heatmapPixels(ref, allRows(1), 'BLUE');
    expect(pxRed.length).toBe(N * N * 4);
    for (const [gx, gy] of [[0, 0], [10, 131], [71, 72], [143, 143], [59, 131]]) {
      const o = lutIndex(gx, gy) * 4;
      expect(Array.from(pxRed.slice(o, o + 4))).toEqual([...heatmapColor(ref[lutIndex(gx, gy)], 'RED'), 255]);
      expect(Array.from(pxBlue.slice(o, o + 4))).toEqual([...heatmapColor(blue[lutIndex(gx, gy)], 'BLUE'), 255]);
    }
    // 기준 행 0 ~ 3만 계산됨: RED는 화면 위쪽 4행, BLUE는 화면 아래쪽 4행만 색, 나머지 바닥색
    const rows = allRows(0);
    rows.fill(1, 0, 4);
    const out = new Uint8ClampedArray(N * N * 4);
    expect(heatmapPixels(ref, rows, 'RED', out)).toBe(out);
    const floor = [217, 217, 217, 255];
    expect(Array.from(out.slice(lutIndex(5, 3) * 4, lutIndex(5, 3) * 4 + 4))).toEqual([...heatmapColor(ref[lutIndex(5, 3)], 'RED'), 255]);
    expect(Array.from(out.slice(lutIndex(5, 4) * 4, lutIndex(5, 4) * 4 + 4))).toEqual(floor);
    heatmapPixels(ref, rows, 'BLUE', out);
    expect(Array.from(out.slice(lutIndex(5, 3) * 4, lutIndex(5, 3) * 4 + 4))).toEqual(floor);
    expect(Array.from(out.slice(lutIndex(5, N - 1) * 4, lutIndex(5, N - 1) * 4 + 4))).toEqual([...heatmapColor(blue[lutIndex(5, N - 1)], 'BLUE'), 255]);
  });

  it('C. 미계산 행 구간 (빗금): 화면 행 기준, BLUE는 뒤집힘', () => {
    expect(pendingRowRanges(allRows(1), 'RED')).toEqual([]);
    expect(pendingRowRanges(allRows(0), 'BLUE')).toEqual([[0, N]]);
    const rows = allRows(0);
    rows.fill(1, 0, 8);
    rows.fill(1, 20, 24);
    expect(pendingRowRanges(rows, 'RED')).toEqual([[8, 20], [24, N]]);
    expect(pendingRowRanges(rows, 'BLUE')).toEqual([[0, N - 24], [N - 20, N - 8]]);
  });

  it('D. 진영 기준 셀 / 조준점: RED → RED_AUDIENCE, BLUE → BLUE_OPPOSITE (점대칭)', () => {
    const red = heatmapBasis('RED');
    const blue = heatmapBasis('BLUE');
    expect(red.key).toBe('RED_AUDIENCE');
    expect(blue.key).toBe('BLUE_OPPOSITE');
    expect(red.cell).toBe('AUDIENCE_CELL');
    expect(blue.cell).toBe('OPPOSITE_CELL');
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    expect(red.aim).toEqual({ x: aim.x, y: aim.y });
    expect(blue.aim.x).toBeCloseTo(144 - red.aim.x, 9);
    expect(blue.aim.y).toBeCloseTo(144 - red.aim.y, 9);
  });
});
