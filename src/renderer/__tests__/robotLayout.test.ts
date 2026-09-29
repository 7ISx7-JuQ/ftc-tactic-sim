import { describe, expect, it } from 'vitest';
import type { RobotState } from '../../core/types';
import { badgeKeyFromPath } from '../badgeAssets';
import {
  BADGE_FALLBACK_TEXT,
  BADGE_GAP_PX,
  BADGE_OPACITY,
  badgeCenter,
  carriedPieceRadius,
  carriedPieceSlots,
  carriedTray,
  headingArrow,
  localToField,
  robotBadge,
  robotCircumradius,
  robotLabelOffset,
} from '../robotLayout';
import { PX_PER_INCH, fieldToCanvas, restingView } from '../viewTransform';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe('로봇 표시 배치 (명세서 3.7, 08-4)', () => {
  it('A. 행동 상태 배지', () => {
    const b = (actionState: RobotState['actionState'], isBraking = false) => robotBadge({ actionState, isBraking });
    assert(b('IDLE') === null && b('INTAKING')?.key === 'intaking', 'IDLE: no badge, INTAKING: badge (with the zone highlight, 09-6b)');
    assert(b('SHOOTING')?.key === 'shooting' && b('FLOWER_SETUP')?.key === 'lift-up' && b('FLOWER_READY')?.key === 'lift-ready' && b('FLOWER_DROPPING')?.key === 'lift-drop' && b('FLOWER_LOWERING')?.key === 'lift-down', 'badge key per action state');
    assert(BADGE_OPACITY === 0.85 && b('SHOOTING')?.alpha === 0.85 && b('SHOOTING', true)?.alpha === 0.425, 'slightly transparent (not a field object), braking -> half of that');
    // 배지 위치: 화면에서 회전된 몸체의 가장 위 꼭짓점 바로 위, 로봇 중심과 같은 x (보기 / 헤딩과 무관하게 겹치지 않음)
    for (const view of [restingView('AUDIENCE', 'RED'), restingView('DRIVER', 'RED'), restingView('DRIVER', 'BLUE'), { angle: 0.7, scale: 0.8 }]) {
      for (const heading of [0, 0.3, Math.PI / 4, Math.PI / 2, 2.5, -1]) {
        const robot = { x: 50, y: 70, heading };
        const size = { length: 18, width: 14 };
        const h = 12;
        const at = badgeCenter(robot, size, view, h);
        const corners = [[9, 7], [9, -7], [-9, 7], [-9, -7]].map(([f, r]) => {
          const p = localToField(robot, { forward: f, right: r });
          return fieldToCanvas(view, p.x, p.y);
        });
        const top = Math.min(...corners.map(c => c.y));
        assert(near(at.y + h / 2 + BADGE_GAP_PX, top) && near(at.x, fieldToCanvas(view, 50, 70).x), `badge sits ${BADGE_GAP_PX}px above the top corner (view ${view.angle.toFixed(2)}, heading ${heading})`);
      }
    }
    const flat = badgeCenter({ x: 50, y: 70, heading: 0 }, { length: 18, width: 18 }, restingView('AUDIENCE', 'RED'), 12);
    assert(near(flat.y, fieldToCanvas(restingView('AUDIENCE', 'RED'), 50, 70).y - 9 * PX_PER_INCH - BADGE_GAP_PX - 6), 'unrotated robot: badge right above the top edge (closer than the old circumradius placement)');
    assert(Object.values(BADGE_FALLBACK_TEXT).every(t => t.length > 0), 'text fallback for every badge');
    assert(badgeKeyFromPath('/src/assets/badges/lift-up.svg') === 'lift-up' && badgeKeyFromPath('../assets/badges/shooting.png') === 'shooting' && badgeKeyFromPath('x/badges/a.gif') === null, 'asset path -> badge key');
  });

  it('B. 몸체 안 배치 (화살표 → 적재물 받침 → 번호 라벨, FIFO 앞쪽부터 0번)', () => {
    for (const length of [18, 14, 12]) {
      const r = carriedPieceRadius(length);
      const slots = carriedPieceSlots(length, 4);
      const tray = carriedTray(length);
      const arrow = headingArrow(length);
      assert(slots.length === 4 && slots.every(s => s.right === 0), `${length} in: 4 slots on the center line`);
      assert(slots.every((s, i) => i === 0 || s.forward < slots[i - 1].forward), `${length} in: slot 0 is the frontmost, then toward the back`);
      assert(slots.every((s, i) => i === 0 || slots[i - 1].forward - s.forward > 2 * r), `${length} in: circles do not overlap`);
      assert(slots[0].forward + r <= tray.front && slots[3].forward - r >= tray.back && tray.halfWidth > r, `${length} in: circles inside the tray`);
      assert(arrow[0].forward < length / 2 && arrow[1].forward > tray.front && arrow[1].forward === arrow[2].forward, `${length} in: arrow inside the front bumper, ahead of the tray`);
      assert(robotLabelOffset(length).forward < tray.back && robotLabelOffset(length).forward > -length / 2, `${length} in: number label behind the tray, inside the body`);
      assert(r > 0 && r <= 1.2, `${length} in: uniform circle radius ${r.toFixed(2)}`);
    }
    assert(carriedPieceSlots(18, 6).length === 4, 'at most 4 slots (rule cap)');
    assert(carriedPieceSlots(18, 0).length === 0 && carriedPieceSlots(18, 2).length === 2, 'one slot per carried piece');
    // 로봇 기준 → 필드: 앞 = (cos h, sin h), 오른쪽 = (−sin h, cos h)
    const p = localToField({ x: 10, y: 20, heading: Math.PI / 2 }, { forward: 3, right: 2 });
    assert(near(p.x, 8) && near(p.y, 23), 'heading 90° (facing +y): forward 3 -> +y, right 2 -> −x');
    assert(near(robotCircumradius(18, 18), 9 * Math.SQRT2), 'circumradius');
  });

  it('C. 배지 이미지 자산 (src/assets/badges, 09-7 전 확정): 키마다 SVG 1개, 캔버스 이미지로 그릴 수 있는 규격', () => {
    const files = import.meta.glob('../../assets/badges/*.{svg,png}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
    const keys = Object.keys(BADGE_FALLBACK_TEXT);
    const found = Object.keys(files).map(badgeKeyFromPath);
    assert(found.length === keys.length && keys.every(k => found.filter(f => f === k).length === 1), `exactly one asset per badge key (found ${found.join(', ')})`);
    for (const [path, svg] of Object.entries(files)) {
      assert(path.endsWith('.svg'), `${path}: SVG`);
      // 정사각형으로 늘려 그리므로 정사각 viewBox, 브라우저가 크기를 알도록 width = height 명시
      const vb = /viewBox="0 0 (\S+) (\S+)"/.exec(svg);
      const w = /<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1];
      const h = /<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1];
      assert(!!vb && vb[1] === vb[2] && !!w && w === h, `${path}: square viewBox + width = height`);
      // 이미지 SVG에서는 currentColor / 웹폰트 / 외부 참조가 동작하지 않음
      assert(!/currentColor|<text|<image|href=|@import/.test(svg), `${path}: self-contained, fixed colors, no text`);
    }
  });
});
