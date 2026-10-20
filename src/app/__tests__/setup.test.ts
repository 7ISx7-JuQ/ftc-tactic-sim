// 적용 값 → 경기 설정 (09-9b): 로봇 프로필의 슈터 탄도가 엔진 비행 처리에 전달되는지. 09-10a: LUT 결과 → 표시용 확률 / 사출 속도.
// 12-11: 엔진 판정 = 실제 궤적 판정 (슈터 탄도에 발사 편차 포함)
import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADING_NOISE_RAD, DEFAULT_PITCH_NOISE_RAD, DEFAULT_V0_NOISE_PERCENT, LUT_GRID_SIZE, bearingTo, estimateShotHitRate, judgeShotTrajectory, mirrorLUTSet, shooterFor } from '../../core/ballistics';
import type { RobotBallisticsResult } from '../../core/ballistics';
import { HIVE_RIM_Z, hiveCellAimPoint } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import { DEFAULT_DRAFT_VALUES, setupFromDrafts } from '../defaultSetup';

const launchZ = (dz: number, pitch = Math.PI / 3, luts: Record<'robot1' | 'robot2', RobotBallisticsResult> | null = null) => {
  const values = {
    ...DEFAULT_DRAFT_VALUES,
    robot2: { ...DEFAULT_DRAFT_VALUES.robot2, ballistics: { ...DEFAULT_DRAFT_VALUES.robot2.ballistics, dz, shooterPitch: pitch } },
  };
  const setup = setupFromDrafts(values, luts);
  const engine = new SimulationEngine(setup.r1Config, setup.r2Config, setup.shotJudge, 'RED', setup.scenario, setup.shooters);
  for (let i = 0; i < 40 && engine.field.pendingShots.length === 0; i++) {
    engine.step(undefined, { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' });
  }
  const shot = engine.field.pendingShots[0];
  return { shot, setup };
};

describe('경기 설정 (09-9b)', () => {
  it('A. 프로필 탄도 → 엔진 shooters (발사구 높이 / 발사각 / 오프셋), 적용한 발사구 높이에서 발사', () => {
    const { setup } = launchZ(HIVE_RIM_Z - 20, 0.9);
    // 12-3: 기물별 (SHARED = 두 기물이 주 슈터 값), 좌우 오프셋 포함. 12-11: 발사 편차 포함 (기본 프로필 = 기본 편차값)
    const noise = { v0NoisePercent: DEFAULT_V0_NOISE_PERCENT, headingNoiseRad: DEFAULT_HEADING_NOISE_RAD, pitchNoiseRad: DEFAULT_PITCH_NOISE_RAD };
    const r2 = { dz: HIVE_RIM_Z - 20, shooterPitch: 0.9, shooterOffset: 0, shooterLateralOffset: 0, ...noise };
    const r1 = { dz: HIVE_RIM_Z - 14, shooterPitch: Math.PI / 3, shooterOffset: 0, shooterLateralOffset: 0, ...noise };
    expect(setup.shotJudge).toBe(judgeShotTrajectory);
    expect(setup.shooters?.robot2).toEqual({ POLLEN: r2, NECTAR: r2 });
    expect(setup.shooters?.robot1).toEqual({ POLLEN: r1, NECTAR: r1 });
    const low = launchZ(HIVE_RIM_Z - 10).shot;
    const high = launchZ(HIVE_RIM_Z - 30).shot;
    expect(low && high).toBeTruthy();
    expect(low!.fromZ).toBeCloseTo(10, 9);
    expect(high!.fromZ).toBeCloseTo(30, 9);
  });

  it('B. (09-10a) LUT 결과가 있으면 기물별 사출 속도, 엔진 판정 = 실제 궤적 판정 (12-11), 표시 = 지금 자세의 기대 명중률 (13-5)', () => {
    // 모든 격자가 일정한 가짜 LUT (로봇마다 다른 값)
    const fake = (p: number, v0: { POLLEN: number | null; NECTAR: number | null }): RobotBallisticsResult => {
      const make = (v: number) => mirrorLUTSet(new Float32Array(LUT_GRID_SIZE * LUT_GRID_SIZE).fill(v));
      return { luts: { POLLEN: make(p), NECTAR: make(p / 2) }, v0, sweetSpotHitRate: { POLLEN: 1, NECTAR: 1 }, issues: [] };
    };
    const luts = { robot1: fake(0.375, { POLLEN: 210, NECTAR: 220 }), robot2: fake(0.75, { POLLEN: 230, NECTAR: null }) };
    const { setup, shot } = launchZ(HIVE_RIM_Z - 14, Math.PI / 3, luts);
    expect([setup.shooters?.robot1.POLLEN.v0, setup.shooters?.robot1.NECTAR.v0]).toEqual([210, 220]);
    expect([setup.shooters?.robot2.POLLEN.v0, setup.shooters?.robot2.NECTAR.v0]).toEqual([230, undefined]); // 찾지 못한 기물은 엔진 기본 계산
    // 엔진이 LUT 사출 속도로 발사 (R2 = 발사한 로봇, 실제 궤적 = 사출 속도 × (1 + 편차 N(0, 2%)))
    expect(shot?.pieceType).toBe('POLLEN');
    expect(shot!.v0).not.toBe(230);
    expect(Math.abs(shot!.v0 / 230 - 1)).toBeLessThan(0.1);
    expect(setup.shotJudge).toBe(judgeShotTrajectory);
    // LUT가 없어도 같은 판정 / 표시 (사출 속도는 엔진 기본 계산)
    const simple = setupFromDrafts(DEFAULT_DRAFT_VALUES);
    expect(simple.shooters?.robot1.POLLEN.v0).toBeUndefined();
    expect(simple.shotJudge).toBe(judgeShotTrajectory);
    // 표시 = 지금 자세의 기대 명중률: 엔진과 같은 슈터 / 탄도로 estimateShotHitRate (기본 스윗스팟 정면이면 높음)
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const [sx, sy] = [59.5, 131.5];
    const facing = bearingTo(sx, sy, aim.x, aim.y);
    const rate = (heading: number, x = sx, y = sy) => simple.hitRate('robot1', 'POLLEN', x, y, heading, 'RED', 'AUDIENCE_CELL');
    const direct = estimateShotHitRate({ robotX: sx, robotY: sy, robotHeading: facing, shooter: shooterFor(simple.r1Config, 'POLLEN'), ballistics: simple.shooters!.robot1.POLLEN, pieceType: 'POLLEN', alliance: 'RED', upwardCell: 'AUDIENCE_CELL' });
    expect(rate(facing)).toBe(direct);
    expect(direct).toBeGreaterThan(0.9);
    expect(rate(facing)).toBe(rate(facing)); // 같은 자세 = 같은 값 (고정 시드, 캐시)
    // 고정형: 이전 ±3° 컷이 없음 — 5° 틀어도 기대값이 남고, 크게 틀면 0
    expect(rate(facing + (5 * Math.PI) / 180)).toBeGreaterThan(0.5);
    expect(rate(facing + 0.5)).toBe(0);
    // 터널 안(12-2)은 발사할 수 없으므로 0
    expect(rate(-Math.PI / 2, 72, 72)).toBe(0);
  });

  it('C. (12-3) 기물별 슈터: PER_PIECE면 NECTAR 비행 / 판정 / 기대 명중률이 NECTAR 슈터 카드, 좌우 오프셋 전달, 발사 불가 기물은 0', () => {
    const d = DEFAULT_DRAFT_VALUES.robot1;
    const nectarCard = { ...d.ballistics.nectarShooter, dz: HIVE_RIM_Z - 24, shooterLateralOffset: -2 };
    const values = {
      ...DEFAULT_DRAFT_VALUES,
      robot1: {
        ...d,
        config: { ...d.config, shooterSetup: 'PER_PIECE' as const, nectarShooter: { ...d.config.nectarShooter, turretType: 'TURRET' as const, turretRange: [-Math.PI, Math.PI] as [number, number] } },
        ballistics: { ...d.ballistics, shooterLateralOffset: 3, nectarShooter: nectarCard },
      },
    };
    const setup = setupFromDrafts(values);
    const noiseOf = (b: typeof nectarCard) => ({ v0NoisePercent: b.v0NoisePercent, headingNoiseRad: b.headingNoiseRad, pitchNoiseRad: b.pitchNoiseRad });
    expect(setup.shooters?.robot1.POLLEN).toEqual({ dz: d.ballistics.dz, shooterPitch: d.ballistics.shooterPitch, shooterOffset: 0, shooterLateralOffset: 3, ...noiseOf(d.ballistics) });
    expect(setup.shooters?.robot1.NECTAR).toEqual({ dz: HIVE_RIM_Z - 24, shooterPitch: nectarCard.shooterPitch, shooterOffset: 0, shooterLateralOffset: -2, ...noiseOf(nectarCard) });
    // 발사 편차도 그 기물 슈터의 값 (NECTAR 카드 편차를 바꾸면 NECTAR만)
    const noisy = setupFromDrafts({ ...values, robot1: { ...values.robot1, ballistics: { ...values.robot1.ballistics, nectarShooter: { ...nectarCard, headingNoiseRad: 0.05 } } } });
    expect([noisy.shooters?.robot1.NECTAR.headingNoiseRad, noisy.shooters?.robot1.POLLEN.headingNoiseRad]).toEqual([0.05, d.ballistics.headingNoiseRad]);
    // SHARED면 NECTAR 카드를 쓰지 않음
    const shared = setupFromDrafts({ ...values, robot1: { ...values.robot1, config: { ...values.robot1.config, shooterSetup: 'SHARED' } } });
    expect(shared.shooters?.robot1.NECTAR).toEqual(shared.shooters?.robot1.POLLEN);
    // 기대 명중률: NECTAR는 360° 터렛이라 헤딩이 1 rad 틀어져도 조준점으로 쏨, POLLEN은 고정형이라 헤딩 방향으로 쏴서 0
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const off = bearingTo(59.5, 131.5, aim.x, aim.y) + 1;
    expect(setup.hitRate('robot1', 'POLLEN', 59.5, 131.5, off, 'RED', 'AUDIENCE_CELL')).toBe(0);
    expect(setup.hitRate('robot1', 'NECTAR', 59.5, 131.5, off, 'RED', 'AUDIENCE_CELL')).toBe(
      estimateShotHitRate({ robotX: 59.5, robotY: 131.5, robotHeading: off, shooter: shooterFor(setup.r1Config, 'NECTAR'), ballistics: setup.shooters!.robot1.NECTAR, pieceType: 'NECTAR', alliance: 'RED', upwardCell: 'AUDIENCE_CELL' }),
    );
    const none = setupFromDrafts({ ...values, robot1: { ...values.robot1, config: { ...values.robot1.config, shooterSetup: 'NONE' } } });
    expect(none.hitRate('robot1', 'NECTAR', 59.5, 131.5, off, 'RED', 'AUDIENCE_CELL')).toBe(0);
    // 엔진: R1이 NECTAR를 NECTAR 슈터 높이에서 발사
    const engine = new SimulationEngine(setup.r1Config, setup.r2Config, setup.shotJudge, 'RED', { allianceColor: 'RED', r1Loadout: ['NECTAR'], gardenPiecesCount: { ally: 7, opponent: 4 } }, setup.shooters);
    for (let i = 0; i < 40 && engine.field.pendingShots.length === 0; i++) engine.step({ targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' });
    const shot = engine.field.pendingShots[0];
    expect(shot?.pieceType).toBe('NECTAR');
    expect(shot!.fromZ).toBeCloseTo(24, 9);
  });
});
