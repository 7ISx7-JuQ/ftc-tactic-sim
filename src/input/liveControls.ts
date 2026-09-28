// ============================================================
// 실시간 입력 수집기 (명세서 3.6항: 원시 입력 누적기)
// 장치별 탭 래치에 원시 입력을 모으고, 틱마다 로봇별로 합성한 조작을 내준다.
// DOM 비의존: 브라우저 어댑터(Step 07-6)가 게임패드 폴링 / 키 상태를 넘겨준다.
// ============================================================

import { ControlLatch, NEUTRAL_SAMPLE, mergeTickControls, readGamepad, readKeyboard } from './controls';
import type { GamepadSnapshot, TickControls } from './controls';
import { DEVICE_ASSIGNMENT, KEYBOARD_ENABLED } from './inputConfig';
import type { RobotId } from './inputConfig';

// 실시간 루프가 쓰는 입력 공급 인터페이스 (테스트는 가짜 구현 주입 가능)
export interface LiveControlSource {
  // 프레임 시작 시 1회 (틱 소비 전): 게임패드 폴링 / 키 상태 재샘플 (브라우저 어댑터가 구현, Step 07-6)
  poll?(): void;
  // 틱 1개 소비: 로봇별 조작 (탭 래치 에지는 이 호출에서 소모)
  consumeTick(): Record<RobotId, TickControls>;
  // 일시정지 / 포커스 소실: 눌린 키 / 누적 에지 제거
  reset(): void;
}

export class LiveControlCollector implements LiveControlSource {
  private readonly gamepadLatches = new Map<number, ControlLatch>(); // 배정된 게임패드 슬롯만
  private readonly keyboardLatch = new ControlLatch();
  private readonly assignment: typeof DEVICE_ASSIGNMENT;
  private readonly keyboardEnabled: boolean;

  constructor(assignment = DEVICE_ASSIGNMENT, keyboardEnabled = KEYBOARD_ENABLED) {
    this.assignment = assignment;
    this.keyboardEnabled = keyboardEnabled;
    for (const slot of Object.keys(assignment.gamepads)) this.gamepadLatches.set(Number(slot), new ControlLatch());
  }

  // 게임패드 폴링 결과 (requestAnimationFrame마다). null = 연결 없음 / 해제 → 중립. 배정되지 않은 슬롯은 무시
  sampleGamepad(slot: number, pad: GamepadSnapshot | null): void {
    this.gamepadLatches.get(slot)?.sample(pad ? readGamepad(pad) : NEUTRAL_SAMPLE);
  }

  // 키보드: 현재 눌린 키 코드 집합 (키 이벤트마다). 비활성화 시 무시
  sampleKeyboard(down: ReadonlySet<string>): void {
    if (this.keyboardEnabled) this.keyboardLatch.sample(readKeyboard(down));
  }

  consumeTick(): Record<RobotId, TickControls> {
    const perRobot: Record<RobotId, TickControls[]> = { robot1: [], robot2: [] };
    // 모든 배정 장치의 래치를 틱마다 정확히 한 번 소비 (슬롯 순서 → 키보드 순, 축 동률이면 앞 장치)
    const slots = [...this.gamepadLatches.keys()].sort((a, b) => a - b);
    for (const slot of slots) perRobot[this.assignment.gamepads[slot]].push(this.gamepadLatches.get(slot)!.consume());
    if (this.keyboardEnabled) perRobot[this.assignment.keyboard].push(this.keyboardLatch.consume());
    return { robot1: mergeTickControls(perRobot.robot1), robot2: mergeTickControls(perRobot.robot2) };
  }

  reset(): void {
    for (const latch of this.gamepadLatches.values()) latch.reset();
    this.keyboardLatch.reset();
  }
}
