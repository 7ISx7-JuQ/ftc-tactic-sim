// ============================================================
// 입력 로그 / 로봇별 입력 출처 / 녹화 덧입히기 (명세서 3.6항)
// 로그 인덱스 t = 틱 t → t + 1 스텝에 쓰인 입력 (DriveInputProvider의 tick 규약과 동일)
// 10-3: 적용 입력 기록(applied) — 녹화 로그와 별개로 엔진에 실제로 들어간 입력을 출처와 무관하게 틱마다 기록 (명세서 3.9, 레시피 재현 전용)
// ============================================================

import { MATCH_TICKS } from '../core/simulationEngine';
import type { DriveInputProvider, RobotDriveInput, SimulationEngine } from '../core/simulationEngine';
import type { DeepReadonly, RobotConfig, RobotState, TimelineFrame } from '../core/types';
import { NEUTRAL_TICK, buildDriveCommand, decodeDriveInput, encodeDriveCommand } from './controls';
import type { EncodedDriveInput, TickControls } from './controls';
import { DEFAULT_DRIVE_MODE } from './inputConfig';
import type { DriveMode, RobotId } from './inputConfig';

export const LOG_RECORD_BYTES = 4; // [qx, qy, qω, action]

// LIVE: 장치 입력을 기록하며 엔진에 넣음 / REPLAY: 로그 재생 / NONE: 0 입력 + IDLE (기록 없음)
export type InputSource = 'LIVE' | 'REPLAY' | 'NONE';

const NEUTRAL_INPUT: Readonly<RobotDriveInput> = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'IDLE' };
// 중립 입력의 부호화 값 (0, 0, 0, IDLE) — 복호화하면 NEUTRAL_INPUT과 같다
export const NEUTRAL_RECORD: EncodedDriveInput = [0, 0, 0, 0];

// ============================================================
// 1. 로봇별 입력 로그 채널
// ============================================================

export class InputLogChannel {
  // 경기 전체 분량을 미리 할당 (6000틱 × 4 B = 24 KB)
  readonly data = new Int8Array(MATCH_TICKS * LOG_RECORD_BYTES);
  private recorded = 0;

  // 기록된 틱 수 (인덱스 0 ~ length − 1이 유효)
  get length(): number {
    return this.recorded;
  }

  // 틱 t에 기록하고 t 이후를 폐기 (되감은 틱에서 이어 기록하면 그 뒤 기록이 사라짐).
  // 기록 끝보다 뒤에 쓰면 사이 틱은 0 입력 + IDLE(= NONE과 같은 입력)로 채운다.
  write(tick: number, record: EncodedDriveInput): void {
    if (!Number.isInteger(tick) || tick < 0 || tick >= MATCH_TICKS) {
      throw new RangeError(`input log tick out of range: ${tick}`);
    }
    if (tick > this.recorded) this.data.fill(0, this.recorded * LOG_RECORD_BYTES, tick * LOG_RECORD_BYTES);
    this.data.set(record, tick * LOG_RECORD_BYTES);
    this.recorded = tick + 1;
  }

  // 기록 여부 (범위 밖 / 미기록 틱은 false)
  has(tick: number): boolean {
    return Number.isInteger(tick) && tick >= 0 && tick < this.recorded;
  }

  // 틱 t 이후 기록 폐기 (length = min(length, t))
  truncate(tick: number): void {
    this.recorded = Math.max(0, Math.min(this.recorded, Math.floor(tick)));
  }

  clear(): void {
    this.recorded = 0;
  }
}

// ============================================================
// 2. 경기 입력 허브: 로봇별 입력 출처 / 조작 모드 / 로그
// ============================================================

export class MatchInputs {
  readonly logs: Record<RobotId, InputLogChannel> = { robot1: new InputLogChannel(), robot2: new InputLogChannel() };
  // 적용 입력 기록 (10-3): resolve / step이 틱마다 기록 (LIVE = 기록한 값, REPLAY = 읽은 값, NONE / 기록 끝 너머 = 중립). 길이 = 엔진 머리 틱.
  // 녹화 로그와 달리 REPLAY의 재료가 아니며, 되감은 틱에서 진행하면 그 틱 이후가 자동으로 폐기된다 (분기 시 컨트롤러가 명시적으로도 자름)
  readonly applied: Record<RobotId, InputLogChannel> = { robot1: new InputLogChannel(), robot2: new InputLogChannel() };
  readonly sources: Record<RobotId, InputSource> = { robot1: 'LIVE', robot2: 'LIVE' };
  readonly modes: Record<RobotId, DriveMode> = { robot1: DEFAULT_DRIVE_MODE, robot2: DEFAULT_DRIVE_MODE };

  /**
   * 엔진 현재 틱(currentTick)의 두 로봇 입력을 결정한다. LIVE 로봇은 그 틱에 조작을 기록한다.
   * live: LIVE 로봇의 틱 조작 (탭 래치 / 장치 합성 결과, 없으면 중립 조작으로 기록)
   */
  resolve(engine: SimulationEngine, live: Partial<Record<RobotId, TickControls>> = {}): { r1: RobotDriveInput; r2: RobotDriveInput } {
    return {
      r1: this.inputFor('robot1', this.sources.robot1, engine, live.robot1, true),
      r2: this.inputFor('robot2', this.sources.robot2, engine, live.robot2, true),
    };
  }

  // resolve + engine.step (경기 종료 후에는 기록 없이 마지막 프레임 반환)
  step(engine: SimulationEngine, live: Partial<Record<RobotId, TickControls>> = {}): DeepReadonly<TimelineFrame> {
    const { r1, r2 } = this.resolve(engine, live);
    return engine.step(r1, r2);
  }

  /**
   * 로그 재생 전용 입력 공급 함수 (engine.inputProvider + runFullMatch()로 즉시 재계산).
   * 만든 시점의 입력 출처를 복사해 고정하며, LIVE 로봇도 기록된 로그를 읽기 전용으로 재생하고 NONE은 중립 입력.
   * 로그에 쓰지 않는다.
   */
  createReplayProvider(): DriveInputProvider {
    const sources: Record<RobotId, InputSource> = {
      robot1: this.sources.robot1 === 'NONE' ? 'NONE' : 'REPLAY',
      robot2: this.sources.robot2 === 'NONE' ? 'NONE' : 'REPLAY',
    };
    return (_tick, engine) => ({
      r1: this.inputFor('robot1', sources.robot1, engine, undefined, false),
      r2: this.inputFor('robot2', sources.robot2, engine, undefined, false),
    });
  }

  private inputFor(
    robot: RobotId,
    source: InputSource,
    engine: SimulationEngine,
    controls: TickControls | undefined,
    record: boolean,
  ): RobotDriveInput {
    const tick = engine.currentTick;
    if (tick < 0 || tick >= MATCH_TICKS) return { ...NEUTRAL_INPUT };
    const log = this.logs[robot];
    const config: RobotConfig = robot === 'robot1' ? engine.r1Config : engine.r2Config;

    if (source === 'LIVE' && record) {
      const state: RobotState = robot === 'robot1' ? engine.r1 : engine.r2;
      const settings = { alliance: engine.field.allianceColor, mode: this.modes[robot] };
      log.write(tick, encodeDriveCommand(buildDriveCommand(controls ?? NEUTRAL_TICK, state, settings)));
    }
    if (source === 'NONE' || !log.has(tick)) {
      if (record) this.applied[robot].write(tick, NEUTRAL_RECORD);
      return { ...NEUTRAL_INPUT };
    }
    // LIVE도 방금 기록한 값을 복호화해 엔진에 넣음 → 로그 재생과 비트 단위로 같은 입력
    const offset = tick * LOG_RECORD_BYTES;
    if (record) this.applied[robot].write(tick, [log.data[offset], log.data[offset + 1], log.data[offset + 2], log.data[offset + 3]]);
    return decodeDriveInput(log.data, offset, config);
  }
}

// ============================================================
// 3. 입력 기록 재생 (레시피 재현, 10-3)
// ============================================================

/**
 * 로봇별 입력 기록(틱당 4 B, 0 ~ 5999틱) → engine.inputProvider (runFullMatch로 재계산). 출처 개념 없이 기록 그대로 복호화한다.
 * 적용 입력 기록 / 레시피에서 해독한 입력에 쓴다. 기록 길이를 넘은 틱은 중립 (채널은 유효 구간만 넘길 것:
 * `channel.data.subarray(0, channel.length * LOG_RECORD_BYTES)` — 자른 뒤의 배열 뒷부분에는 옛 값이 남아 있다).
 */
export function createInputRecordProvider(records: Readonly<Record<RobotId, ArrayLike<number>>>): DriveInputProvider {
  const input = (data: ArrayLike<number>, tick: number, config: RobotConfig): RobotDriveInput => {
    const offset = tick * LOG_RECORD_BYTES;
    return tick >= 0 && offset + LOG_RECORD_BYTES <= data.length ? decodeDriveInput(data, offset, config) : { ...NEUTRAL_INPUT };
  };
  return (tick, engine) => ({ r1: input(records.robot1, tick, engine.r1Config), r2: input(records.robot2, tick, engine.r2Config) });
}
