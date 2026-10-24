// 입력 출처 선택 규칙 (명세서 3.8 SETTINGS 탭 "기본 입력 출처", 09-8b / 18-2 장치 배정)
import { describe, expect, it } from 'vitest';
import { DEVICE_ASSIGNMENT, swapAssignment } from '../../input/inputConfig';
import type { DeviceAssignment } from '../../input/inputConfig';
import { autoSource, resolveSource, sourceChoiceAllowed } from '../inputPlan';

const pads = (...connected: number[]) => [0, 1].map(slot => ({ slot, connected: connected.includes(slot) }));
const NO_KEYBOARD: DeviceAssignment = { ...DEVICE_ASSIGNMENT, keyboard: null };

describe('입력 출처 규칙 (09-8b)', () => {
  it('A. AUTO 기본 규칙: R1 = 패드 0, R2 = 패드 1 또는 키보드 배정', () => {
    expect([autoSource('robot1', pads()), autoSource('robot2', pads())]).toEqual(['NONE', 'LIVE']); // 패드 없이 키보드로 R2
    expect([autoSource('robot1', pads(), NO_KEYBOARD), autoSource('robot2', pads(), NO_KEYBOARD)]).toEqual(['NONE', 'NONE']);
    expect([autoSource('robot1', pads(0), NO_KEYBOARD), autoSource('robot2', pads(0), NO_KEYBOARD)]).toEqual(['LIVE', 'NONE']); // 패드 1개 + 키보드 없음 → R2 없음
    expect([autoSource('robot1', pads(1), NO_KEYBOARD), autoSource('robot2', pads(1), NO_KEYBOARD)]).toEqual(['NONE', 'LIVE']);
    expect([autoSource('robot1', pads(0, 1)), autoSource('robot2', pads(0, 1))]).toEqual(['LIVE', 'LIVE']);
    expect(autoSource('robot1', [{ slot: 5, connected: true }], NO_KEYBOARD)).toBe('NONE'); // 배정할 수 없는 슬롯
  });

  it('A2. (18-2) 설정한 배정을 따름: 바꾸기 / 한 로봇에 여러 장치 / 배정 없는 패드', () => {
    const swapped = swapAssignment(DEVICE_ASSIGNMENT);
    expect(swapped).toEqual({ gamepads: { 0: 'robot2', 1: 'robot1' }, keyboard: 'robot1' });
    expect(swapAssignment(swapped)).toEqual(DEVICE_ASSIGNMENT);
    expect([autoSource('robot1', pads(0), swapped), autoSource('robot2', pads(0), swapped)]).toEqual(['LIVE', 'LIVE']); // 패드 0 → R2, 키보드 → R1
    const both: DeviceAssignment = { gamepads: { 0: 'robot1', 1: 'robot1' }, keyboard: null };
    expect([autoSource('robot1', pads(1), both), autoSource('robot2', pads(0, 1), both)]).toEqual(['LIVE', 'NONE']);
    const none: DeviceAssignment = { gamepads: { 0: null, 1: 'robot2' }, keyboard: null };
    expect(autoSource('robot1', pads(0), none)).toBe('NONE'); // 배정 없는 패드는 연결돼 있어도 무시
    expect(swapAssignment(none)).toEqual({ gamepads: { 0: null, 1: 'robot1' }, keyboard: null });
  });

  it('B. 선택 풀이 / 고를 수 있는 선택지 (경기 전 AUTO · LIVE · NONE, 경기 중 LIVE · NONE · 기록 있으면 REPLAY)', () => {
    expect(resolveSource('AUTO', 'robot2', pads())).toBe('LIVE');
    expect(resolveSource('AUTO', 'robot2', pads(), swapAssignment(DEVICE_ASSIGNMENT))).toBe('NONE');
    expect(resolveSource('NONE', 'robot2', pads())).toBe('NONE');
    expect(resolveSource('LIVE', 'robot1', pads(), NO_KEYBOARD)).toBe('LIVE');
    expect(['AUTO', 'LIVE', 'NONE'].every(c => sourceChoiceAllowed(c as 'AUTO', false, true))).toBe(true);
    expect(sourceChoiceAllowed('REPLAY', false, true)).toBe(false);
    expect(sourceChoiceAllowed('AUTO', true, true)).toBe(false);
    expect(sourceChoiceAllowed('LIVE', true, false) && sourceChoiceAllowed('NONE', true, false)).toBe(true);
    expect(sourceChoiceAllowed('REPLAY', true, false)).toBe(false);
    expect(sourceChoiceAllowed('REPLAY', true, true)).toBe(true);
  });
});
