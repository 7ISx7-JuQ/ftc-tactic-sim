// 엔진 결과 버전 올림 누락 방지 (명세서 3.9 버전 상수, 10-3)
// 고정 제원 / 시나리오 / 시드 / 입력 경기의 체크포인트 체크섬을 기대값으로 박아 둔다.
// 이 테스트가 실패하면 같은 입력의 프레임 결과가 바뀐 것이다 → 의도한 변경이면 ENGINE_VERSION을 올리고
// 아래 EXPECTED(버전 + 체크섬)를 새 값으로 갱신한다 (이전 버전의 저장 레시피는 불러올 때 "엔진 버전 다름" 경고가 뜬다).
import { describe, expect, it } from 'vitest';
import { createIntakeZonePreset } from '../collision';
import { fnv1a32, timelineCheckpoints } from '../checksum';
import { ENGINE_VERSION, SimulationEngine } from '../simulationEngine';
import type { DriveInputProvider, RobotDriveInput } from '../simulationEngine';
import type { RobotConfig } from '../types';

const EXPECTED = { engineVersion: 1, final: '890034f7', all: '955d25cd' };

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});

// 흡입 / 발사 / 리프트 / 투입이 모두 섞이는 고정 입력 (틱의 순수 함수)
const drive = (t: number, phase: number, c: RobotConfig): RobotDriveInput => {
  const cycle = (t + phase * 97) % 500;
  return {
    targetVx: c.maxSpeed * Math.sin(t / 43 + phase),
    targetVy: 0.7 * c.maxSpeed * Math.cos(t / 61 + phase),
    targetOmega: 0.5 * c.maxTurnRate * Math.sin(t / 37 + 2 * phase),
    actionState: cycle < 180 ? 'INTAKING' : cycle < 210 ? 'SHOOTING' : cycle < 260 ? 'FLOWER_SETUP' : cycle < 280 ? 'FLOWER_DROPPING' : 'IDLE',
  };
};

describe('엔진 결과 버전 (10-3)', () => {
  it('A. 고정 입력 경기의 체크포인트 = 기대값 (다르면 ENGINE_VERSION 올림 + 기대값 갱신)', () => {
    const r1 = cfg('robot1');
    const r2 = cfg('robot2', { maxSpeed: 45, turretType: 'TURRET', turretRange: [-1.5, 1.5] });
    const engine = new SimulationEngine(r1, r2, () => 0.6, 'RED', { allianceColor: 'RED', autoTipCount: 2, rngSeed: 20260930 });
    const provider: DriveInputProvider = tick => ({ r1: drive(tick, 0, r1), r2: drive(tick, 1, r2) });
    engine.inputProvider = provider;
    engine.runFullMatch();
    const sums = timelineCheckpoints(engine.timeline);
    const last = engine.getFrame(6000)!;
    const first = engine.getFrame(0)!;
    // 기대값이 의미가 있으려면 경기가 여러 규칙을 거쳐야 한다: 로봇 이동, 바닥 기물 이동, 발사 (득점 / 적재 변화)
    const moved = last.pieces.filter((p, i) => p.x !== first.pieces[i].x || p.y !== first.pieces[i].y || p.state !== first.pieces[i].state).length;
    expect(moved).toBeGreaterThan(5);
    expect(Math.hypot(last.r1.x - first.r1.x, last.r1.y - first.r1.y)).toBeGreaterThan(1);
    expect(sums).toHaveLength(121);
    expect({ engineVersion: ENGINE_VERSION, final: sums[120], all: fnv1a32(sums.join('')) }).toEqual(EXPECTED);
  }, 120_000);
});
