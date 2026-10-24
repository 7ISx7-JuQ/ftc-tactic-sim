// 게임패드 버튼 매핑 화면 규칙 (명세서 3.8 SETTINGS 탭 장치 — 버튼 매핑, 18-3): React / DOM 비의존 순수 함수
// - 버튼 이름: 표준 배열(mapping === 'standard') 이름 (A / B / … / LT / RT / D-pad), 비표준 패드는 인덱스 번호만 믿을 수 있어 번호로.
// - 버튼을 눌러 지정: 지정을 시작한 순간 눌려 있던 버튼은 한 번 뗄 때까지 무시하고, 새로 눌린(올라간 에지) 첫 버튼을 고른다.

import { GAMEPAD_SLOTS } from '../input/inputConfig';
import type { ControlButton, GamepadMapping, GamepadMappings } from '../input/inputConfig';

/** W3C Gamepad 표준 배열의 버튼 이름 (인덱스 0 ~ 16) */
export const STANDARD_BUTTON_NAMES: readonly string[] = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home',
];

/** 버튼 이름: 표준 패드(또는 연결 전)면 표준 이름, 비표준 패드거나 표준 범위 밖이면 null (화면이 "버튼 n"으로) */
export function standardButtonName(index: number, standard: boolean): string | null {
  return standard ? (STANDARD_BUTTON_NAMES[index] ?? null) : null;
}

/**
 * 버튼 지정 폴링 한 번: 직전 눌림(prev) → 지금 눌림(now)에서 새로 눌린 첫 버튼 인덱스 (없으면 null).
 * prev는 지정을 시작할 때의 눌림으로 시작하므로, 그때 쥐고 있던 버튼은 떼었다가 다시 눌러야 잡힌다
 */
export function firstNewPress(prev: readonly boolean[], now: readonly boolean[]): number | null {
  const i = now.findIndex((down, k) => down && !prev[k]);
  return i >= 0 ? i : null;
}

/** 도움말 조작표의 게임패드 칸 (18-3): 두 슬롯이 같으면 하나, 다르면 "슬롯 0 · 슬롯 1" */
export function mappingLabels(mappings: GamepadMappings): Record<ControlButton | 'move' | 'turn', string> {
  const both = (f: (m: GamepadMapping) => string) => {
    const [a, b] = GAMEPAD_SLOTS.map(s => f(mappings[s]));
    return a === b ? a : `${a} · ${b}`;
  };
  const name = (m: GamepadMapping, k: ControlButton) => STANDARD_BUTTON_NAMES[m.buttons[k]] ?? `#${m.buttons[k]}`;
  return {
    move: both(m => (m.swapSticks ? 'R-stick' : 'L-stick')),
    turn: both(m => (m.swapSticks ? 'L-stick ←→' : 'R-stick ←→')),
    intake: both(m => name(m, 'intake')),
    shoot: both(m => name(m, 'shoot')),
    lift: both(m => name(m, 'lift')),
    drop: both(m => name(m, 'drop')),
  };
}
