// LUT 생성 연결 (명세서 3.8 "LUT 생성 흐름 연결", 09-10a): React 비의존.
// - 적용한 로봇 프로필로 LUT 관리자에 요청 (앱 시작 = 자동 보관 / 기본 프리셋, 로봇 탭 APPLY). 관리자가 같은 입력 재요청은 무시하고,
//   두 로봇이 같은 입력이면 한 번만 생성한다 (09-10a 공유).
// - 관리자 알림(행 단위로 잦음)을 모아 약 10 Hz로 onUpdate. 상태 변화(단계가 바뀜)는 바로 알림.
// - 화면 요약(lutView)과 남은 시간 추정용 생성 시작 시각을 로봇별로 보관한다.

import type { RobotBallisticsResult } from '../core/ballistics';
import type { RobotId } from '../input/inputConfig';
import { LUTManager } from '../workers/lutManager';
import type { LUTManagerOptions, LUTGenState } from '../workers/lutManager';
import type { DraftValues } from '../ui/configDraft';
import { lutView, nextTiming } from '../ui/lutView';
import type { LutTiming, RobotLutView } from '../ui/lutView';
import { profileBallisticsConfig } from '../ui/robotForm';
import type { RobotProfile } from '../ui/robotForm';

export const LUT_UPDATE_INTERVAL_MS = 100;
const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];

export interface LUTTrackerOptions extends Omit<LUTManagerOptions, 'onChange'> {
  onUpdate: () => void;
  now?: () => number;
  /** 지연 실행 (기본 setTimeout). 반환값 = 취소 함수 */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export type MatchLUTResults = Record<RobotId, RobotBallisticsResult>;

export class LUTTracker {
  private readonly manager: LUTManager;
  private readonly onUpdate: () => void;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly timing: Record<RobotId, LutTiming | null> = { robot1: null, robot2: null };
  private readonly lastState: Record<RobotId, LUTGenState> = { robot1: 'IDLE', robot2: 'IDLE' };
  private readonly profiles: Partial<Record<RobotId, RobotProfile>> = {};
  private cancelPending: (() => void) | null = null;
  private disposed = false;

  constructor(options: LUTTrackerOptions) {
    const { onUpdate, now, schedule, ...managerOptions } = options;
    this.onUpdate = onUpdate;
    this.now = now ?? (() => performance.now());
    this.schedule =
      schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.manager = new LUTManager({ ...managerOptions, onChange: robotId => this.onChange(robotId) });
  }

  /** 적용 값으로 두 로봇 LUT 요청 (입력이 같으면 관리자가 무시) */
  request(values: Pick<DraftValues, 'robot1' | 'robot2'>): void {
    for (const id of ROBOTS) {
      this.profiles[id] = values[id];
      this.manager.request(id, requestOf(values[id]));
    }
  }

  /** 오류 뒤 다시 시도: 마지막 요청을 다시 보냄 (관리자가 진행 중 / READY인 같은 입력은 무시하므로 오류 · 취소일 때만 새로 생성) */
  retry(robotId: RobotId): void {
    const profile = this.profiles[robotId];
    if (profile) this.manager.request(robotId, requestOf(profile));
  }

  view(robotId: RobotId): RobotLutView {
    return lutView(this.manager.getStatus(robotId), this.timing[robotId], this.now());
  }

  /** 두 로봇 모두 READY면 결과 (경기 판정 함수 / 사출 속도), 아니면 null */
  results(): MatchLUTResults | null {
    const r1 = this.manager.getStatus('robot1');
    const r2 = this.manager.getStatus('robot2');
    return r1.state === 'READY' && r2.state === 'READY' && r1.result && r2.result ? { robot1: r1.result, robot2: r2.result } : null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending?.();
    this.cancelPending = null;
    this.manager.dispose();
  }

  private onChange(robotId: RobotId): void {
    if (this.disposed) return;
    const status = this.manager.getStatus(robotId);
    this.timing[robotId] = nextTiming(this.timing[robotId], status, this.now());
    const stateChanged = status.state !== this.lastState[robotId];
    this.lastState[robotId] = status.state;
    if (stateChanged) {
      this.flush();
      return;
    }
    // 진행만 바뀜: 모아서 약 10 Hz
    this.cancelPending ??= this.schedule(() => this.flush(), LUT_UPDATE_INTERVAL_MS);
  }

  private flush(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    if (!this.disposed) this.onUpdate();
  }
}

function requestOf(profile: RobotProfile) {
  return { config: profileBallisticsConfig(profile), robotSize: { length: profile.config.length, width: profile.config.width } };
}
