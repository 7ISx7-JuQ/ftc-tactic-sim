// 표시 옵션 (명세서 3.7, 08-6): 사용자에게 공개하는 공통 환경설정 (로봇별 아님), 기본값 모두 꺼짐
// 옵션별 표시 계산은 DOM 비의존 순수 함수 (그리기는 sceneRenderer)

import { bearingTo, shotLaunchHeading } from '../core/ballistics';
import { FLOWER_CIRCLES, FLOWER_IDS, FLOWER_RADIUS, PIECE_PHYSICS, hiveCellAimPoint } from '../core/collision';
import { normalizeAngle } from '../core/kinematics';
import { FLOWER_DEQ_GRAVITY_COOLDOWN } from '../core/types';
import type { DeepReadonly, GamePiece, RobotConfig, RobotState, ShotProbabilityResolver, TimelineFrame } from '../core/types';

export interface RenderOptions {
  aimGuide: boolean;       // 조준선 (고정형 허용 오차 부채꼴 / 터렛 범위 부채꼴 + 발사 방향)
  intakeProgress: boolean; // 흡입 접촉 진행 호
  hitProbability: boolean; // 실시간 명중 확률 (좌우 패널 글자)
  flightTrail: boolean;    // 비행 잔상
  flightResult: boolean;   // 비행 중 결과 색 (기본은 도착 전까지 숨김)
}

export const DEFAULT_RENDER_OPTIONS: Readonly<RenderOptions> = {
  aimGuide: false,
  intakeProgress: false,
  hitProbability: false,
  flightTrail: false,
  flightResult: false,
};

type Robot = DeepReadonly<RobotState>;
type Frame = DeepReadonly<TimelineFrame>;

// 1. 조준선
export interface AimGuide {
  center: { x: number; y: number };
  aim: { x: number; y: number };  // 상향 셀 조준점 (바닥 투영)
  launchHeading: number;          // 발사 방향 (고정형 = 헤딩, 터렛 = 조준 방위, 범위 밖이면 한계각)
  sectorStart: number;            // 조준 가능 부채꼴 (시작 → 끝, 시계 방향 = 각도 증가, 필드 좌표 rad)
  sectorEnd: number;
}

/**
 * 조준선 계산: 고정형 부채꼴 = 헤딩 ± aimTolerance, 터렛 부채꼴 = 헤딩 + turretRange (±π를 가로지르면 끝에 2π 더함)
 * 터렛 범위 해석은 엔진 판정(isAimWithinShooterRange)과 같다: 각 끝을 [-π, π]로 정규화하므로 360°는 [-π, π]만 해당
 */
export function aimGuide(robot: Robot, config: RobotConfig, alliance: 'RED' | 'BLUE', upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'): AimGuide {
  const aim = hiveCellAimPoint(alliance, upwardCell);
  const launchHeading = shotLaunchHeading(config, robot.heading, bearingTo(robot.x, robot.y, aim.x, aim.y));
  let lo: number;
  let hi: number;
  if (config.turretType === 'TURRET') {
    lo = normalizeAngle(config.turretRange[0]);
    hi = normalizeAngle(config.turretRange[1]);
    if (lo > hi) hi += Math.PI * 2;
  } else {
    const tol = Number.isFinite(config.aimTolerance) ? Math.max(0, config.aimTolerance) : 0;
    lo = -tol;
    hi = tol;
  }
  return { center: { x: robot.x, y: robot.y }, aim: { x: aim.x, y: aim.y }, launchHeading, sectorStart: robot.heading + lo, sectorEnd: robot.heading + hi };
}

// 2. 흡입 접촉 진행
export interface IntakeProgress {
  x: number;
  y: number;
  radius: number;   // 호 반지름 (대상 둘레 + 0.6 in)
  fraction: number; // intakeContactTimer / 필요 시간 ∈ [0, 1]
}

/**
 * 흡입 대상 둘레 진행 호: 바닥 기물이면 그 기물(필요 시간 intakeDelay),
 * FLOWER slot[0]이면 FLOWER 원통(필요 시간 max(intakeDelay, 0.12 s)). 대상 없음 / 필요 시간 0이면 null
 */
export function intakeProgress(robot: Robot, config: RobotConfig, frame: Frame): IntakeProgress | null {
  const id = robot.intakeTargetPieceId;
  if (id === null) return null;
  const delay = Math.max(0, config.intakeDelay) / 1000;
  const flowerIndex = frame.field.flowers.findIndex((f) => f.pieces[0]?.id === id);
  let at: { x: number; y: number; radius: number; required: number } | null = null;
  if (flowerIndex >= 0) {
    const index = FLOWER_IDS.indexOf(frame.field.flowers[flowerIndex].id as (typeof FLOWER_IDS)[number]);
    const center = FLOWER_CIRCLES[index]?.center;
    if (center) at = { ...center, radius: FLOWER_RADIUS, required: Math.max(delay, FLOWER_DEQ_GRAVITY_COOLDOWN) };
  } else {
    const piece = frame.pieces.find((p) => p.id === id);
    if (piece && piece.state === 'ON_FIELD') at = { x: piece.x, y: piece.y, radius: PIECE_PHYSICS[piece.type].radius, required: delay };
  }
  if (!at || !(at.required > 0)) return null;
  return { x: at.x, y: at.y, radius: at.radius + 0.6, fraction: Math.min(1, Math.max(0, robot.intakeContactTimer / at.required)) };
}

// 3. 실시간 명중 확률 (그리는 프레임마다 로봇 2 × 기물 2회 호출, 엔진과 같은 [0, 1] 제한 / 비유한값 0)
export interface RobotHitProbability {
  POLLEN: number;
  NECTAR: number;
  next: GamePiece['type'] | null; // 적재함 0번 (다음에 나갈 기물) 종류, 적재 없음 = null
}

export function hitProbabilities(frame: Frame, resolver: ShotProbabilityResolver): Record<'robot1' | 'robot2', RobotHitProbability> {
  const { allianceColor, hive } = frame.field;
  const of = (id: 'robot1' | 'robot2', robot: Robot): RobotHitProbability => {
    const p = (type: GamePiece['type']) => {
      const raw = resolver(id, type, robot.x, robot.y, robot.heading, allianceColor, hive.upwardCell);
      return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    };
    return { POLLEN: p('POLLEN'), NECTAR: p('NECTAR'), next: robot.controlledPieces[0]?.type ?? null };
  };
  return { robot1: of('robot1', frame.r1), robot2: of('robot2', frame.r2) };
}
