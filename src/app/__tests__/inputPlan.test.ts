// 입력 출처 선택 규칙 (명세서 3.8 SETTINGS 탭 "기본 입력 출처", 09-8b)
import { describe, expect, it } from 'vitest';
import { autoSource, resolveSource, sourceChoiceAllowed } from '../inputPlan';

const pads = (...connected: number[]) => [0, 1].map(slot => ({ slot, connected: connected.includes(slot) }));

describe('입력 출처 규칙 (09-8b)', () => {
  it('A. AUTO 기본 규칙: R1 = 패드 0, R2 = 패드 1 또는 키보드 켜짐', () => {
    expect([autoSource('robot1', pads(), true), autoSource('robot2', pads(), true)]).toEqual(['NONE', 'LIVE']); // 패드 없이 키보드로 R2
    expect([autoSource('robot1', pads(), false), autoSource('robot2', pads(), false)]).toEqual(['NONE', 'NONE']);
    expect([autoSource('robot1', pads(0), false), autoSource('robot2', pads(0), false)]).toEqual(['LIVE', 'NONE']); // 패드 1개 + 키보드 끔 → R2 없음
    expect([autoSource('robot1', pads(1), false), autoSource('robot2', pads(1), false)]).toEqual(['NONE', 'LIVE']);
    expect([autoSource('robot1', pads(0, 1), true), autoSource('robot2', pads(0, 1), true)]).toEqual(['LIVE', 'LIVE']);
    expect(autoSource('robot1', [{ slot: 5, connected: true }], false)).toBe('NONE'); // 배정 안 된 슬롯
  });

  it('B. 선택 풀이 / 고를 수 있는 선택지 (경기 전 AUTO · LIVE · NONE, 경기 중 LIVE · NONE · 기록 있으면 REPLAY)', () => {
    expect(resolveSource('AUTO', 'robot2', pads(), true)).toBe('LIVE');
    expect(resolveSource('NONE', 'robot2', pads(), true)).toBe('NONE');
    expect(resolveSource('LIVE', 'robot1', pads(), false)).toBe('LIVE');
    expect(['AUTO', 'LIVE', 'NONE'].every(c => sourceChoiceAllowed(c as 'AUTO', false, true))).toBe(true);
    expect(sourceChoiceAllowed('REPLAY', false, true)).toBe(false);
    expect(sourceChoiceAllowed('AUTO', true, true)).toBe(false);
    expect(sourceChoiceAllowed('LIVE', true, false) && sourceChoiceAllowed('NONE', true, false)).toBe(true);
    expect(sourceChoiceAllowed('REPLAY', true, false)).toBe(false);
    expect(sourceChoiceAllowed('REPLAY', true, true)).toBe(true);
  });
});
