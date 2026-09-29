// 적용 값 → 경기 설정 (09-9b): 로봇 프로필의 슈터 탄도가 엔진 비행 처리에 전달되는지
import { describe, expect, it } from 'vitest';
import { HIVE_RIM_Z } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { DEFAULT_DRAFT_VALUES, setupFromDrafts } from '../defaultSetup';

const launchZ = (dz: number, pitch = Math.PI / 3) => {
  const values = {
    ...DEFAULT_DRAFT_VALUES,
    robot2: { ...DEFAULT_DRAFT_VALUES.robot2, ballistics: { ...DEFAULT_DRAFT_VALUES.robot2.ballistics, dz, shooterPitch: pitch } },
  };
  const setup = setupFromDrafts(values);
  const engine = new SimulationEngine(setup.r1Config, setup.r2Config, setup.shotResolver, 'RED', setup.scenario, setup.shooters);
  for (let i = 0; i < 40 && engine.field.pendingShots.length === 0; i++) {
    engine.step(undefined, { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' });
  }
  const shot = engine.field.pendingShots[0];
  return { shot, setup };
};

describe('경기 설정 (09-9b)', () => {
  it('A. 프로필 탄도 → 엔진 shooters (발사구 높이 / 발사각 / 오프셋), 적용한 발사구 높이에서 발사', () => {
    const { setup } = launchZ(HIVE_RIM_Z - 20, 0.9);
    expect(setup.shooters?.robot2).toEqual({ dz: HIVE_RIM_Z - 20, shooterPitch: 0.9, shooterOffset: 0 });
    expect(setup.shooters?.robot1).toEqual({ dz: HIVE_RIM_Z - 14, shooterPitch: Math.PI / 3, shooterOffset: 0 });
    const low = launchZ(HIVE_RIM_Z - 10).shot;
    const high = launchZ(HIVE_RIM_Z - 30).shot;
    expect(low && high).toBeTruthy();
    expect(low!.fromZ).toBeCloseTo(10, 9);
    expect(high!.fromZ).toBeCloseTo(30, 9);
  });
});
