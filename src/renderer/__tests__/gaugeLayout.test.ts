import { describe, expect, it } from 'vitest';
import { FIELD_SIZE, FLOWER_CIRCLES, hiveTipLipOrigin } from '../../core/collision';
import { FLOWER_MAX_POLLEN_BY_NECTAR } from '../../core/types';
import type { GamePiece } from '../../core/types';
import {
  FLOWER_GAUGE_SLOTS,
  GAUGE_SLOT_PITCH,
  GAUGE_THICKNESS,
  GAUGE_WALL_GAP,
  flowerGaugeLayout,
  flowerGaugeSlots,
  isFlowerFull,
  stockBottomFacesLoadingZone,
  stockGaugeLayout,
  stockSlotStates,
  tipDropView,
} from '../gaugeLayout';
import type { GaugeLayout } from '../gaugeLayout';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;
const rectIs = (g: GaugeLayout, minX: number, maxX: number, minY: number, maxY: number) =>
  near(g.rect.minX, minX) && near(g.rect.maxX, maxX) && near(g.rect.minY, minY) && near(g.rect.maxY, maxY);
const overlaps = (a: GaugeLayout, b: GaugeLayout) =>
  a.rect.minX < b.rect.maxX && b.rect.minX < a.rect.maxX && a.rect.minY < b.rect.maxY && b.rect.minY < a.rect.maxY;
const P = (): Pick<GamePiece, 'type' | 'alliance'> => ({ type: 'POLLEN', alliance: 'NONE' });
const N = (): Pick<GamePiece, 'type' | 'alliance'> => ({ type: 'NECTAR', alliance: 'RED' });

describe('게이지 배치 / 칸 내용 (명세서 3.7, 08-5)', () => {
  it('A. FLOWER 게이지: 필드 밖 직사각형, FLOWER 쪽 bottom, 90° 회전 복제', () => {
    const gauges = FLOWER_CIRCLES.map((_, i) => flowerGaugeLayout(i));
    // FLOWER_CIRCLES 순서: (2, 96) 왼쪽 벽, (48, 2) 위쪽 벽, (142, 48) 오른쪽 벽, (96, 142) 관중석 벽
    const lo = FIELD_SIZE + GAUGE_WALL_GAP;
    const hi = lo + GAUGE_THICKNESS;
    assert(rectIs(gauges[3], 96, 120, lo, hi), 'audience-wall FLOWER (96, 142): x 96~120, y 144.6~147.8');
    assert(rectIs(gauges[0], -(GAUGE_WALL_GAP + GAUGE_THICKNESS), -GAUGE_WALL_GAP, 96, 120), 'left-wall FLOWER (2, 96): x −3.8~−0.6, y 96~120');
    assert(rectIs(gauges[1], 24, 48, -(GAUGE_WALL_GAP + GAUGE_THICKNESS), -GAUGE_WALL_GAP), 'top-wall FLOWER (48, 2): x 24~48, y −3.8~−0.6');
    assert(rectIs(gauges[2], lo, hi, 24, 48), 'right-wall FLOWER (142, 48): x 144.6~147.8, y 24~48');
    gauges.forEach((g, i) => {
      const flower = FLOWER_CIRCLES[i].center;
      const d0 = Math.hypot(g.slots[0].x - flower.x, g.slots[0].y - flower.y);
      const d8 = Math.hypot(g.slots[8].x - flower.x, g.slots[8].y - flower.y);
      // FLOWER 중심 → 벽 2 in + 틈 0.6 + 반두께 1.6 = 4.2 in, 칸 반길이 1.33 in → 약 4.4 in
      assert(g.slots.length === FLOWER_GAUGE_SLOTS && d0 < d8 && d0 < 5, `gauge ${i + 1}: 9 slots, slot 0 (bottom) next to the FLOWER (${d0.toFixed(2)} in)`);
      assert(g.slots.every((s, k) => k === 0 || near(Math.hypot(s.x - g.slots[k - 1].x, s.y - g.slots[k - 1].y), GAUGE_SLOT_PITCH)), `gauge ${i + 1}: slot pitch 24 / 9`);
      // bottom → top이 필드 둘레를 따라 화면 기준 반시계 방향 (y-down 좌표에서 외적 < 0)
      const r0 = { x: g.slots[0].x - 72, y: g.slots[0].y - 72 };
      const r8 = { x: g.slots[8].x - 72, y: g.slots[8].y - 72 };
      assert(r0.x * r8.y - r0.y * r8.x < 0, `gauge ${i + 1}: bottom -> top runs counterclockwise around the field`);
      const outside = g.rect.maxX <= 0 || g.rect.minX >= FIELD_SIZE || g.rect.maxY <= 0 || g.rect.minY >= FIELD_SIZE;
      assert(outside && g.rect.minX >= -8 && g.rect.maxX <= FIELD_SIZE + 8 && g.rect.minY >= -8 && g.rect.maxY <= FIELD_SIZE + 8, `gauge ${i + 1}: outside the field, inside the 8 in margin`);
    });
    const all = [...gauges, stockGaugeLayout('RED'), stockGaugeLayout('BLUE')];
    assert(all.every((a, i) => all.every((b, j) => i === j || !overlaps(a, b))), 'no two gauges overlap (FLOWER × 4, stock × 2)');
  });

  it('B. NECTAR 재고 게이지 (벽 바깥 y = 72, 로딩 존 쪽 bottom, 점대칭)', () => {
    const red = stockGaugeLayout('RED');
    const blue = stockGaugeLayout('BLUE');
    assert(red.slots.length === 5 && near((red.rect.minY + red.rect.maxY) / 2, 72) && red.rect.maxX === -GAUGE_WALL_GAP, 'RED: 5 slots outside the x = 0 wall, centered on y = 72');
    assert(red.slots.every((s, i) => near(blue.slots[i].x, FIELD_SIZE - s.x) && near(blue.slots[i].y, FIELD_SIZE - s.y)), 'BLUE = RED point-symmetric about the field center');
    assert(stockBottomFacesLoadingZone('RED') && stockBottomFacesLoadingZone('BLUE'), 'slot 0 at the end nearer the ally loading zone');
    const s = (p: number, k: number) => stockSlotStates(p, k).join();
    assert(s(0, 5) === 'STOCK,STOCK,STOCK,STOCK,STOCK' && s(3, 0) === 'PENDING,PENDING,PENDING,EMPTY,EMPTY' && s(1, 2) === 'PENDING,STOCK,STOCK,EMPTY,EMPTY', 'pending first, then stock, then empty (released)');
    assert(s(-1, 9) === 'STOCK,STOCK,STOCK,STOCK,STOCK' && s(7, 3) === 'PENDING,PENDING,PENDING,PENDING,PENDING', 'counts clamped to 5 slots');
  });

  it('C. FLOWER 칸 내용 (잼 = 검정, 가득 참 = 최대 조합 → 남은 칸 X)', () => {
    // 용량 테이블의 최대 조합마다 가득 참, POLLEN 하나 적으면 가득 차지 않음 (slot[0] = POLLEN)
    for (const [nectarKey, maxPollen] of Object.entries(FLOWER_MAX_POLLEN_BY_NECTAR)) {
      const nectar = Number(nectarKey);
      const at = (pollen: number) => [...Array.from({ length: pollen }, P), ...Array.from({ length: nectar }, N)];
      const full = at(maxPollen);
      const slots = flowerGaugeSlots(full);
      assert(isFlowerFull(full) && !isFlowerFull(at(maxPollen - 1)), `{POLLEN ${maxPollen}, NECTAR ${nectar}} full, one POLLEN less not full`);
      assert(slots.every((sl, k) => (k < full.length ? sl.kind === 'PIECE' : sl.kind === 'FULL')), `{${maxPollen}, ${nectar}}: ${full.length} pieces then X marks`);
    }
    const onesix = flowerGaugeSlots([P(), N(), N(), N(), N(), N(), N()]);
    assert(onesix.filter(sl => sl.kind === 'FULL').length === 2, '{1, 6}: 7 slots filled, 2 X marks');
    // 잼: 빈 slot[0]은 검정, 용량 판정에서 POLLEN 1개로 계산 ([null, N, P×7] = {8, 1} 최대 조합)
    const jam = flowerGaugeSlots([null, N(), ...Array.from({ length: 7 }, P)]);
    assert(jam[0].kind === 'JAM' && jam.slice(1).every(sl => sl.kind === 'PIECE') && isFlowerFull([null, N(), ...Array.from({ length: 7 }, P)]), 'jam [null, N, P×7]: black slot 0, full');
    const jamOpen = flowerGaugeSlots([null, N()]);
    assert(jamOpen[0].kind === 'JAM' && jamOpen[1].kind === 'PIECE' && jamOpen.slice(2).every(sl => sl.kind === 'EMPTY'), 'jam [null, N]: not full, rest empty');
    assert(flowerGaugeSlots([]).every(sl => sl.kind === 'EMPTY') && flowerGaugeSlots([P(), P(), P(), P()]).slice(4).every(sl => sl.kind === 'EMPTY'), 'empty / default FLOWER: no X');
  });

  it('D. HIVE 시차 낙하 연출 보간', () => {
    const lip = hiveTipLipOrigin('RED', 'AUDIENCE_CELL');
    assert(near(lip.x, 59.25) && near(lip.y, 91.475) && near(hiveTipLipOrigin('BLUE', 'OPPOSITE_CELL').x, 84.75) && near(hiveTipLipOrigin('BLUE', 'OPPOSITE_CELL').y, 52.525), 'lip origin = alliance center line × spilled-side frame edge');
    const target = { x: 65, y: 120 };
    const a = tipDropView(lip, target, 2, 0);
    const b = tipDropView(lip, target, 2, 1);
    const c = tipDropView(lip, target, 2, 3);
    assert(near(a.x, lip.x) && near(a.y, lip.y) && near(a.alpha, 0.25) && a.progress === 0, 'start: at the lip, 25% opacity, no outline');
    assert(near(b.x, (lip.x + target.x) / 2) && near(b.y, (lip.y + target.y) / 2) && near(b.alpha, 0.625) && near(b.progress, 0.5), 'halfway: linear midpoint, half outline');
    assert(c.x === target.x && c.y === target.y && c.alpha === 1 && c.progress === 1, 'settled: at the target, opaque, full circle');
    assert(tipDropView(lip, target, 0, 0).progress === 1, 'zero settle time -> already landed');
  });
});
