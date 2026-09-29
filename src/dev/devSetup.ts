// 개발 하네스 설정 (명세서 3.7 개발 하네스, 08-7, 사용자 비공개)
// 엔진 / 입력 계층 / 실시간 루프 / 렌더러는 정식 코드를 그대로 쓰고, 여기서는 설정값과 간이 판정 함수만 정한다.

import { bearingTo, isAimWithinShooterRange } from '../core/ballistics';
import { createIntakeZonePreset, hiveCellAimPoint } from '../core/collision';
import { angleDifference } from '../core/kinematics';
import { SimulationEngine } from '../core/simulationEngine';
import type { RobotConfig, ShotProbabilityResolver } from '../core/types';
import type { MatchSetup } from '../app/appController';

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

export const DEV_ROBOT_CONFIGS: Readonly<Record<'robot1' | 'robot2', RobotConfig>> = {
  robot1: base('robot1', 'DEV R1'),
  robot2: base('robot2', 'DEV R2'),
};

/** 간이 명중 판정 (LUT 생성 없음): 조준 가능(고정형 허용 오차 / 터렛 범위) 하면 0.6, 아니면 0 */
export const DEV_HIT_PROBABILITY = 0.6;

export function createDevResolver(r1: RobotConfig, r2: RobotConfig): ShotProbabilityResolver {
  const shooters = { robot1: r1, robot2: r2 };
  return (robotId, _pieceType, x, y, heading, alliance, upwardCell) => {
    const aim = hiveCellAimPoint(alliance, upwardCell);
    const deltaPsi = angleDifference(bearingTo(x, y, aim.x, aim.y), heading);
    return isAimWithinShooterRange(deltaPsi, shooters[robotId]) ? DEV_HIT_PROBABILITY : 0;
  };
}

/** 하네스 경기 설정 (AppController 주입용, 09-6c): 고정 제원 + 간이 판정 함수 + 기본 시나리오(진영만 선택) + 기본 슈터 탄도 */
export function createDevSetup(alliance: 'RED' | 'BLUE'): MatchSetup {
  const { robot1, robot2 } = DEV_ROBOT_CONFIGS;
  return { r1Config: robot1, r2Config: robot2, shotResolver: createDevResolver(robot1, robot2), scenario: { allianceColor: alliance } };
}

/** 하네스 설정의 엔진 */
export function createDevEngine(alliance: 'RED' | 'BLUE'): SimulationEngine {
  const { r1Config, r2Config, shotResolver, scenario } = createDevSetup(alliance);
  return new SimulationEngine(r1Config, r2Config, shotResolver, alliance, scenario);
}
