// 임시 기본 경기 설정 (09-6d): config 창(09-8 ~ 09-11)과 LUT 판정(09-10)이 들어오기 전까지 새 GUI가 쓰는 고정 설정.
// 08-7 개발 하네스 설정을 정식 코드로 옮긴 것 (하네스 src/dev는 09-12에서 삭제). 09-9 기본 프리셋과 09-10 LUT 판정으로 대체된다.
// 09-10a: LUT가 준비되면 경기 판정 = LUT 판정(createLUTShotResolver) + 기물별 사출 속도. 준비 전 간이 판정은 START가 막힌 동안의 자리 채움.

import { PIECE_TYPES, bearingTo, createLUTShotResolver, isAimWithinShooterRange, isPieceFireable, shooterFor } from '../core/ballistics';
import type { RobotBallisticsResult } from '../core/ballistics';
import { createIntakeZonePreset, hiveCellAimPoint } from '../core/collision';
import { angleDifference } from '../core/kinematics';
import type { GamePiece, RobotConfig, ScenarioConfig, ShooterBallistics, ShotProbabilityResolver } from '../core/types';
import { DEFAULT_PROFILE_BALLISTICS, profileShooterBallistics } from '../ui/robotForm';
import type { MatchSetup } from './appController';
import type { DraftValues } from '../ui/configDraft';

// 고정 기본 로봇 제원 (18 in 정사각, 앞면 흡입, 고정형 슈터 ±3°). v2.0.0 새 항목은 v1 동작 값 (NECTAR 슈터 = 주 슈터와 같은 값)
const base = (id: 'robot1' | 'robot2', name: string): RobotConfig => ({
  id,
  name,
  width: 18,
  length: 18,
  maxSpeed: 60,
  maxTurnRate: 4,
  maxLinearAccel: 120,
  maxAngularAccel: 10,
  intakeDelay: 100,
  canIntakeNectar: true,
  maxControlledPieces: 4,
  intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }),
  shooterSetup: 'SHARED',
  shooterDelay: 300,
  turretType: 'FIXED',
  turretRange: [0, 0],
  aimTolerance: (3 * Math.PI) / 180,
  nectarShooter: { shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: (3 * Math.PI) / 180 },
  flowerSetupDelay: 500,
  flowerDropDelay: 200,
  flowerDropZones: [],
  liftMaxSpeed: 0,
});

export const DEFAULT_ROBOT_CONFIGS: Readonly<Record<'robot1' | 'robot2', RobotConfig>> = {
  robot1: base('robot1', 'R1'),
  robot2: base('robot2', 'R2'),
};

/** 간이 명중 판정 (LUT 생성 없음): 발사 가능 기물이고 조준 가능(그 기물 슈터의 고정형 허용 오차 / 터렛 범위)하면 0.6, 아니면 0 */
export const SIMPLE_HIT_PROBABILITY = 0.6;

export function createSimpleResolver(r1: RobotConfig, r2: RobotConfig): ShotProbabilityResolver {
  const shooters = { robot1: r1, robot2: r2 };
  return (robotId, pieceType, x, y, heading, alliance, upwardCell) => {
    const config = shooters[robotId];
    if (!isPieceFireable(config, pieceType)) return 0;
    const aim = hiveCellAimPoint(alliance, upwardCell);
    const deltaPsi = angleDifference(bearingTo(x, y, aim.x, aim.y), heading);
    return isAimWithinShooterRange(deltaPsi, shooterFor(config, pieceType)) ? SIMPLE_HIT_PROBABILITY : 0;
  };
}

/** 경기 설정에 넘기는 슈터 탄도 (로봇별 · 기물별, v0 제외) */
export type SetupShooterBallistics = Record<'robot1' | 'robot2', Record<GamePiece['type'], Pick<ShooterBallistics, 'dz' | 'shooterPitch' | 'shooterOffset' | 'shooterLateralOffset'>>>;

/** 고정 제원 + 간이 판정 함수 + 기본 시나리오(진영만 선택) + 기본 슈터 탄도 */
export function createDefaultSetup(alliance: 'RED' | 'BLUE'): MatchSetup {
  const { robot1, robot2 } = DEFAULT_ROBOT_CONFIGS;
  return buildMatchSetup(robot1, robot2, { allianceColor: alliance });
}

/**
 * config 창에서 적용된 로봇 제원 / 시나리오 / 슈터 탄도로 경기 설정 (09-8a: 판정 함수는 간이 판정, LUT 판정은 09-10).
 * 09-9b: 탄도(발사구 높이 dz / 발사각 / 오프셋)를 엔진 비행 처리에 넘긴다. 사출 속도 v0는 LUT 전까지 엔진 기본 계산.
 * 12-3: 탄도는 기물별 (그 기물을 쏘는 슈터의 값, 좌우 오프셋 포함), 판정 함수도 기물별 슈터 / 좌우 오프셋을 쓴다
 */
export function buildMatchSetup(
  r1Config: RobotConfig,
  r2Config: RobotConfig,
  scenario: ScenarioConfig,
  ballistics?: SetupShooterBallistics,
  luts?: Record<'robot1' | 'robot2', RobotBallisticsResult> | null,
): MatchSetup {
  // 사출 속도: LUT가 찾은 기물별 v0 (없는 기물은 엔진 기본 계산)
  const shooterOf = (id: 'robot1' | 'robot2', type: GamePiece['type']): ShooterBallistics => {
    const b = ballistics![id][type];
    const v0 = luts?.[id].v0[type];
    return { dz: b.dz, shooterPitch: b.shooterPitch, shooterOffset: b.shooterOffset, shooterLateralOffset: b.shooterLateralOffset ?? 0, ...(v0 != null ? { v0 } : {}) };
  };
  const robotShooters = (id: 'robot1' | 'robot2') => Object.fromEntries(PIECE_TYPES.map(type => [type, shooterOf(id, type)])) as Record<GamePiece['type'], ShooterBallistics>;
  const shooters = ballistics && { robot1: robotShooters('robot1'), robot2: robotShooters('robot2') };
  const shotResolver = luts
    ? createLUTShotResolver({ robot1: luts.robot1.luts, robot2: luts.robot2.luts }, r1Config, r2Config, shooters)
    : createSimpleResolver(r1Config, r2Config);
  return { r1Config, r2Config, shotResolver, scenario, ...(shooters ? { shooters } : {}) };
}

/** 적용 값(프로필 + 시나리오) → 경기 설정. LUT 결과가 있으면 LUT 판정 + 사출 속도 (09-10a), 탄도는 기물별 (12-3) */
export function setupFromDrafts(values: DraftValues, luts: Record<'robot1' | 'robot2', RobotBallisticsResult> | null = null): MatchSetup {
  const perPiece = (id: 'robot1' | 'robot2') => ({ POLLEN: profileShooterBallistics(values[id], 'POLLEN'), NECTAR: profileShooterBallistics(values[id], 'NECTAR') });
  return buildMatchSetup(values.robot1.config, values.robot2.config, values.scenario, { robot1: perPiece('robot1'), robot2: perPiece('robot2') }, luts);
}

/** config 창 탭 기본값 (RESET TAB / 첫 실행): 팀 번호 / 팀명 없음 + 고정 제원 + RED 기본 시나리오 + 기본 탄도(09-9b) · 기본 스윗스팟(09-10a) */
export const DEFAULT_DRAFT_VALUES: Readonly<DraftValues> = {
  robot1: { teamNumber: '', teamName: '', config: DEFAULT_ROBOT_CONFIGS.robot1, ballistics: DEFAULT_PROFILE_BALLISTICS },
  robot2: { teamNumber: '', teamName: '', config: DEFAULT_ROBOT_CONFIGS.robot2, ballistics: DEFAULT_PROFILE_BALLISTICS },
  scenario: { allianceColor: 'RED' },
};
