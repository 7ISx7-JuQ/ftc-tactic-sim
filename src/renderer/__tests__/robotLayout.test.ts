import { describe, expect, it } from 'vitest';
import type { RobotState } from '../../core/types';
import { badgeKeyFromPath } from '../badgeAssets';
import {
  BADGE_FALLBACK_TEXT,
  carriedPieceRadius,
  carriedPieceSlots,
  carriedTray,
  headingArrow,
  localToField,
  robotBadge,
  robotCircumradius,
  robotLabelOffset,
} from '../robotLayout';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe('로봇 표시 배치 (명세서 3.7, 08-4)', () => {
  it('A. 행동 상태 배지', () => {
    const b = (actionState: RobotState['actionState'], isBraking = false) => robotBadge({ actionState, isBraking });
    assert(b('IDLE') === null && b('INTAKING') === null, 'IDLE / INTAKING: no badge (intake shown by the zone highlight)');
    assert(b('SHOOTING')?.key === 'shooting' && b('FLOWER_SETUP')?.key === 'lift-up' && b('FLOWER_READY')?.key === 'lift-ready' && b('FLOWER_DROPPING')?.key === 'lift-drop' && b('FLOWER_LOWERING')?.key === 'lift-down', 'badge key per action state');
    assert(b('SHOOTING', true)?.alpha === 0.5 && b('SHOOTING')?.alpha === 1, 'braking (timer not running) -> 50% opacity');
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
});
