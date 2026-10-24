// 게임패드 버튼 매핑 화면 규칙 (명세서 3.8 SETTINGS 탭 장치 — 버튼 매핑, 18-3)
import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPAD_MAPPING, DEFAULT_GAMEPAD_MAPPINGS, assignGamepadButton } from '../../input/inputConfig';
import { controlRows } from '../helpInfo';
import { firstNewPress, mappingLabels, standardButtonName } from '../gamepadMapping';

describe('게임패드 버튼 매핑 (18-3)', () => {
  it('A. 버튼 이름: 표준 패드 = 표준 이름, 비표준 / 범위 밖 = null (화면이 "버튼 n")', () => {
    expect([0, 1, 6, 7, 12, 16].map(i => standardButtonName(i, true))).toEqual(['A', 'B', 'LT', 'RT', 'D-pad ↑', 'Home']);
    expect(standardButtonName(17, true)).toBeNull();
    expect(standardButtonName(0, false)).toBeNull();
  });

  it('B. 눌러 지정: 새로 눌린 첫 버튼만, 시작할 때 쥐고 있던 버튼은 뗀 뒤 다시 눌러야', () => {
    expect(firstNewPress([], [false, false, true])).toBe(2);
    expect(firstNewPress([false, true], [false, true])).toBeNull(); // 쥐고 있던 버튼
    expect(firstNewPress([false, true, false], [true, true, true])).toBe(0); // 여러 개면 앞 인덱스
    expect(firstNewPress([true], [false])).toBeNull();
  });

  it('C. 도움말 조작표: 두 슬롯이 같으면 하나, 다르면 "슬롯 0 · 슬롯 1", 스틱 바꾸기 반영', () => {
    expect(mappingLabels(DEFAULT_GAMEPAD_MAPPINGS)).toEqual({ move: 'L-stick', turn: 'R-stick ←→', intake: 'LT', shoot: 'RT', lift: 'A', drop: 'B' });
    const slot1 = { ...assignGamepadButton(DEFAULT_GAMEPAD_MAPPING, 'shoot', 5), swapSticks: true };
    const labels = mappingLabels({ 0: DEFAULT_GAMEPAD_MAPPING, 1: slot1 });
    expect(labels).toEqual({ move: 'L-stick · R-stick', turn: 'R-stick ←→ · L-stick ←→', intake: 'LT', shoot: 'RT · RB', lift: 'A', drop: 'B' });
    expect(mappingLabels({ 0: assignGamepadButton(DEFAULT_GAMEPAD_MAPPING, 'drop', 20), 1: DEFAULT_GAMEPAD_MAPPING }).drop).toBe('#20 · B');
    const rows = controlRows({ 0: DEFAULT_GAMEPAD_MAPPING, 1: slot1 });
    expect(rows.find(r => r.label === 'settings.keys.shoot')!.gamepad).toBe('RT · RB');
    expect(controlRows().find(r => r.label === 'settings.keys.lift')!.gamepad).toBe('A');
  });
});
