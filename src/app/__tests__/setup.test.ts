// 적용 값 → 경기 설정 (09-9b): 로봇 프로필의 슈터 탄도가 엔진 비행 처리에 전달되는지. 09-10a: LUT 결과 → 판정 함수 / 사출 속도
import { describe, expect, it } from 'vitest';
import { LUT_GRID_SIZE, bearingTo, mirrorLUTSet } from '../../core/ballistics';
import type { RobotBallisticsResult } from '../../core/ballistics';
import { HIVE_RIM_Z, hiveCellAimPoint } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { DEFAULT_DRAFT_VALUES, SIMPLE_HIT_PROBABILITY, setupFromDrafts } from '../defaultSetup';

const launchZ = (dz: number, pitch = Math.PI / 3, luts: Record<'robot1' | 'robot2', RobotBallisticsResult> | null = null) => {
  const values = {
    ...DEFAULT_DRAFT_VALUES,
    robot2: { ...DEFAULT_DRAFT_VALUES.robot2, ballistics: { ...DEFAULT_DRAFT_VALUES.robot2.ballistics, dz, shooterPitch: pitch } },
  };
  const setup = setupFromDrafts(values, luts);
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

  it('B. (09-10a) LUT 결과가 있으면 LUT 판정 함수 + 기물별 사출 속도, 없으면 간이 판정', () => {
    // 모든 격자가 일정한 가짜 LUT (로봇마다 다른 값)
    const fake = (p: number, v0: { POLLEN: number | null; NECTAR: number | null }): RobotBallisticsResult => {
      const make = (v: number) => mirrorLUTSet(new Float32Array(LUT_GRID_SIZE * LUT_GRID_SIZE).fill(v));
      return { luts: { POLLEN: make(p), NECTAR: make(p / 2) }, v0, sweetSpotHitRate: { POLLEN: 1, NECTAR: 1 }, issues: [] };
    };
    const luts = { robot1: fake(0.375, { POLLEN: 210, NECTAR: 220 }), robot2: fake(0.75, { POLLEN: 230, NECTAR: null }) };
    const { setup, shot } = launchZ(HIVE_RIM_Z - 14, Math.PI / 3, luts);
    expect(setup.shooters?.robot1.v0).toEqual({ POLLEN: 210, NECTAR: 220 });
    expect(setup.shooters?.robot2.v0).toEqual({ POLLEN: 230 }); // 찾지 못한 기물은 엔진 기본 계산
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const facing = bearingTo(60, 130, aim.x, aim.y);
    expect(setup.shotResolver('robot1', 'POLLEN', 60, 130, facing, 'RED', 'AUDIENCE_CELL')).toBeCloseTo(0.375, 6);
    expect(setup.shotResolver('robot2', 'POLLEN', 60, 130, facing, 'RED', 'AUDIENCE_CELL')).toBeCloseTo(0.75, 6);
    expect(setup.shotResolver('robot1', 'NECTAR', 60, 130, facing, 'RED', 'AUDIENCE_CELL')).toBeCloseTo(0.1875, 6);
    expect(setup.shotResolver('robot1', 'POLLEN', 60, 130, facing + 0.5, 'RED', 'AUDIENCE_CELL')).toBe(0); // 조준 범위 밖 (고정형 ±3°)
    // 엔진이 LUT 사출 속도로 발사 (R2 = 발사한 로봇)
    expect(shot?.pieceType).toBe('POLLEN');
    expect(shot!.v0).toBe(230);
    // LUT가 없으면 간이 판정 (조준되면 0.6)
    const simple = setupFromDrafts(DEFAULT_DRAFT_VALUES);
    expect(simple.shotResolver('robot1', 'POLLEN', 60, 130, facing, 'RED', 'AUDIENCE_CELL')).toBe(SIMPLE_HIT_PROBABILITY);
    expect(simple.shooters?.robot1.v0).toBeUndefined();
  });
});
