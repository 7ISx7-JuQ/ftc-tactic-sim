// 임시 기본 경기 설정 (09-6d): config 창(09-8 ~ 09-11)과 LUT 판정(09-10)이 들어오기 전까지 새 GUI가 쓰는 고정 설정.
// 08-7 개발 하네스 설정을 정식 코드로 옮긴 것 (하네스 src/dev는 09-12에서 삭제). 09-9 기본 프리셋과 09-10 LUT 판정으로 대체된다.

import { bearingTo, isAimWithinShooterRange } from '../core/ballistics';
import { createIntakeZonePreset, hiveCellAimPoint } from '../core/collision';
import { angleDifference } from '../core/kinematics';
import type { RobotConfig, ScenarioConfig, ShooterBallistics, ShotProbabilityResolver } from '../core/types';
import { DEFAULT_PROFILE_BALLISTICS } from '../ui/robotForm';
import type { MatchSetup } from './appController';
import type { DraftValues } from '../ui/configDraft';

// 고정 기본 로봇 제원 (18 in 정사각, 앞면 흡입, 고정형 슈터 ±3°)
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
  shooterDelay: 300,
  turretType: 'FIXED',
  turretRange: [0, 0],
  aimTolerance: (3 * Math.PI) / 180,
  flowerSetupDelay: 500,
  flowerDropDelay: 200,
});

export const DEFAULT_ROBOT_CONFIGS: Readonly<Record<'robot1' | 'robot2', RobotConfig>> = {
  robot1: base('robot1', 'R1'),
  robot2: base('robot2', 'R2'),
};

/** 간이 명중 판정 (LUT 생성 없음): 조준 가능(고정형 허용 오차 / 터렛 범위) 하면 0.6, 아니면 0 */
export const SIMPLE_HIT_PROBABILITY = 0.6;

export function createSimpleResolver(r1: RobotConfig, r2: RobotConfig): ShotProbabilityResolver {
  const shooters = { robot1: r1, robot2: r2 };
  return (robotId, _pieceType, x, y, heading, alliance, upwardCell) => {
    const aim = hiveCellAimPoint(alliance, upwardCell);
    const deltaPsi = angleDifference(bearingTo(x, y, aim.x, aim.y), heading);
    return isAimWithinShooterRange(deltaPsi, shooters[robotId]) ? SIMPLE_HIT_PROBABILITY : 0;
  };
}

/** 고정 제원 + 간이 판정 함수 + 기본 시나리오(진영만 선택) + 기본 슈터 탄도 */
export function createDefaultSetup(alliance: 'RED' | 'BLUE'): MatchSetup {
  const { robot1, robot2 } = DEFAULT_ROBOT_CONFIGS;
  return buildMatchSetup(robot1, robot2, { allianceColor: alliance });
}

/**
 * config 창에서 적용된 로봇 제원 / 시나리오 / 슈터 탄도로 경기 설정 (09-8a: 판정 함수는 간이 판정, LUT 판정은 09-10).
 * 09-9b: 탄도(발사구 높이 dz / 발사각 / 오프셋)를 엔진 비행 처리에 넘긴다. 사출 속도 v0는 LUT 전까지 엔진 기본 계산
 */
export function buildMatchSetup(
  r1Config: RobotConfig,
  r2Config: RobotConfig,
  scenario: ScenarioConfig,
  ballistics?: Record<'robot1' | 'robot2', Pick<ShooterBallistics, 'dz' | 'shooterPitch' | 'shooterOffset'>>,
): MatchSetup {
  const shooters = ballistics && {
    robot1: { dz: ballistics.robot1.dz, shooterPitch: ballistics.robot1.shooterPitch, shooterOffset: ballistics.robot1.shooterOffset },
    robot2: { dz: ballistics.robot2.dz, shooterPitch: ballistics.robot2.shooterPitch, shooterOffset: ballistics.robot2.shooterOffset },
  };
  return { r1Config, r2Config, shotResolver: createSimpleResolver(r1Config, r2Config), scenario, ...(shooters ? { shooters } : {}) };
}

/** 적용 값(프로필 + 시나리오) → 경기 설정 */
export function setupFromDrafts(values: DraftValues): MatchSetup {
  return buildMatchSetup(values.robot1.config, values.robot2.config, values.scenario, { robot1: values.robot1.ballistics, robot2: values.robot2.ballistics });
}

/** config 창 탭 기본값 (RESET TAB / 첫 실행): 팀 번호 / 팀명 없음 + 고정 제원 + RED 기본 시나리오 + 기본 탄도(09-9b). 스윗스팟은 09-10 */
export const DEFAULT_DRAFT_VALUES: Readonly<DraftValues> = {
  robot1: { teamNumber: '', teamName: '', config: DEFAULT_ROBOT_CONFIGS.robot1, ballistics: DEFAULT_PROFILE_BALLISTICS },
  robot2: { teamNumber: '', teamName: '', config: DEFAULT_ROBOT_CONFIGS.robot2, ballistics: DEFAULT_PROFILE_BALLISTICS },
  scenario: { allianceColor: 'RED' },
};
