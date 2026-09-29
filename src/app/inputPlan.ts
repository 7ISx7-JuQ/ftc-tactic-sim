// 로봇별 입력 출처 선택 규칙 (명세서 3.8 SETTINGS 탭 "기본 입력 출처", 09-8b): React / DOM 비의존
// - 경기 전: AUTO(기본 규칙) / LIVE / NONE. AUTO는 시작 순간의 장치 상태로 정해진다.
// - 경기 중(일시정지 / 복기): LIVE / REPLAY / NONE. REPLAY는 그 로봇의 입력 기록이 있을 때만.
// - 선택은 다음 START / RESUME / BRANCH부터 적용 (조작 모드 / 키보드 토글도 같음).

import { DEVICE_ASSIGNMENT } from '../input/inputConfig';
import type { RobotId } from '../input/inputConfig';
import type { GamepadSlotStatus } from '../input/browserInput';
import type { InputSource } from '../input/inputLog';

export type SourceChoice = 'AUTO' | InputSource;
export const SETUP_SOURCE_CHOICES: readonly SourceChoice[] = ['AUTO', 'LIVE', 'NONE'];
export const MATCH_SOURCE_CHOICES: readonly InputSource[] = ['LIVE', 'REPLAY', 'NONE'];

/**
 * 기본 규칙: 그 로봇에 배정된 게임패드 슬롯 중 하나라도 연결 → LIVE, 키보드가 그 로봇에 배정되어 있고 켜져 있으면 → LIVE, 아니면 NONE
 * (기본 배정: R1 = 패드 0, R2 = 패드 1 + 키보드 → 패드 없이도 키보드로 R2 조종, 키보드를 끄면 패드 1개일 때 R2 = NONE)
 */
export function autoSource(
  robot: RobotId,
  gamepads: readonly Pick<GamepadSlotStatus, 'slot' | 'connected'>[],
  keyboardEnabled: boolean,
  assignment: typeof DEVICE_ASSIGNMENT = DEVICE_ASSIGNMENT,
): InputSource {
  const padConnected = gamepads.some(g => g.connected && assignment.gamepads[g.slot] === robot);
  const keyboard = keyboardEnabled && assignment.keyboard === robot;
  return padConnected || keyboard ? 'LIVE' : 'NONE';
}

/** 선택 → 실제 출처 (AUTO만 규칙으로 풀림) */
export function resolveSource(
  choice: SourceChoice,
  robot: RobotId,
  gamepads: readonly Pick<GamepadSlotStatus, 'slot' | 'connected'>[],
  keyboardEnabled: boolean,
): InputSource {
  return choice === 'AUTO' ? autoSource(robot, gamepads, keyboardEnabled) : choice;
}

/** 지금 고를 수 있는 선택지인지: 경기 전 = AUTO / LIVE / NONE, 경기 중 = LIVE / NONE / (입력 기록이 있으면) REPLAY */
export function sourceChoiceAllowed(choice: SourceChoice, inMatch: boolean, hasLog: boolean): boolean {
  if (!inMatch) return SETUP_SOURCE_CHOICES.includes(choice);
  if (choice === 'REPLAY') return hasLog;
  return choice === 'LIVE' || choice === 'NONE';
}
