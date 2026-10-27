// 표시 옵션 (명세서 3.7, 08-6): 사용자에게 공개하는 공통 환경설정 (로봇별 아님), 기본값 모두 꺼짐
// 옵션별 표시 계산은 DOM 비의존 순수 함수 (그리기는 sceneRenderer)

import {
  DEFAULT_SHOOTER_BALLISTICS,
  PIECE_TYPES,
  bearingTo,
  isPieceFireable,
  launchPoint,
  nextFireablePieceIndex,
  shooterAimHeading,
  shooterFor,
  shotLaunchHeading,
} from '../core/ballistics';
import { FLOWER_CIRCLES, FLOWER_IDS, FLOWER_RADIUS, PIECE_PHYSICS, hiveCellAimPoint } from '../core/collision';
import { normalizeAngle } from '../core/kinematics';
import { FLOWER_DEQ_GRAVITY_COOLDOWN } from '../core/types';
import type { DeepReadonly, GamePiece, RobotConfig, RobotShooterBallistics, RobotState, ShotProbabilityResolver, TimelineFrame } from '../core/types';

export interface RenderOptions {
  aimGuide: boolean;       // 조준선 (발사 방향 + 터렛 범위 부채꼴)
  muzzleMark: boolean;     // 사출구 (비행 공이 출발하는 점, 조준경 모양 — 13-6에서 조준선과 분리)
  intakeProgress: boolean; // 흡입 접촉 진행 호
  hitProbability: boolean; // 실시간 명중 확률 (좌측 HTML 득점 패널 글자, 09-6d — 캔버스에는 그리지 않음)
  flightTrail: boolean;    // 비행 잔상
  flightResult: boolean;   // 비행 중 결과 색 (기본은 도착 전까지 숨김)
  robotPath: boolean;      // 로봇 동선 (진행 중이 아닐 때 — 복기 / 일시정지 / 재생, 16-3)
}

export const DEFAULT_RENDER_OPTIONS: Readonly<RenderOptions> = {
  aimGuide: false,
  muzzleMark: false,
  intakeProgress: false,
  hitProbability: false,
  flightTrail: false,
  flightResult: false,
  robotPath: false,
};

type Robot = DeepReadonly<RobotState>;
type Frame = DeepReadonly<TimelineFrame>;

// 1. 조준선 (13-2: 다음에 발사할 기물의 슈터 / 사출구 기준)
export interface AimGuide {
  pieceType: GamePiece['type'];   // 이 조준선의 기물 (그 기물을 쏘는 슈터)
  center: { x: number; y: number }; // 로봇 중심
  muzzle: { x: number; y: number }; // 사출구 바닥 투영 (앞뒤 / 좌우 오프셋, 발사 비행 계획의 발사구와 같은 점)
  aim: { x: number; y: number };  // 상향 셀 조준점 (바닥 투영)
  launchHeading: number;          // 발사 방향 (고정형 = 헤딩, 터렛 = 좌우 오프셋 보정한 조준 방향 ψ, 범위 밖이면 한계각)
  // 터렛 회전 범위 부채꼴 (시작 → 끝, 시계 방향 = 각도 증가, 필드 좌표 rad, 꼭짓점 = 사출구). 고정형은 null (13-5: 발사 방향 선만)
  sector: { start: number; end: number } | null;
}

/**
 * 조준선을 그릴 기물: 적재함의 다음 발사 기물(첫 발사 가능 기물, 엔진 발사 대기열과 같은 nextFireablePieceIndex),
 * 적재함에 발사 가능 기물이 없으면 그 로봇이 쏠 수 있는 첫 기물 종류(POLLEN → NECTAR), 슈터가 없으면(NONE) null
 */
export function aimGuidePiece(robot: Pick<Robot, 'controlledPieces'>, config: Partial<Pick<RobotConfig, 'shooterSetup'>>): GamePiece['type'] | null {
  const next = nextFireablePieceIndex(config, robot.controlledPieces);
  if (next >= 0) return robot.controlledPieces[next].type;
  return PIECE_TYPES.find((type) => isPieceFireable(config, type)) ?? null;
}

/**
 * 조준선 계산 (13-2): 그 기물을 쏘는 슈터(shooterFor)와 탄도(shooters[기물], 없으면 엔진 기본 슈터)로
 * - 발사 방향 = 발사 비행 계획(planShotFlight)과 같은 shotLaunchHeading(좌우 오프셋 보정 ψ, 조준 불가 자리면 조준점 방위)
 * - 사출구 = launchPoint(로봇 중심, 발사 방향, 앞뒤 / 좌우 오프셋) — 비행 공이 출발하는 점
 * - 부채꼴: 터렛 = 헤딩 + turretRange (±π를 가로지르면 끝에 2π 더함), 고정형 = 없음 (13-5 — 엔진 판정에 조준 범위가 없음, 12-11)
 * 터렛 범위 해석은 발사 방향(isWithinTurretRange)과 같다: 각 끝을 [-π, π]로 정규화하므로 360°는 [-π, π]만 해당.
 * 쏠 수 있는 기물이 없으면(NONE) null
 */
export function aimGuide(
  robot: Robot,
  config: RobotConfig,
  alliance: 'RED' | 'BLUE',
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL',
  shooters?: DeepReadonly<RobotShooterBallistics>,
): AimGuide | null {
  const pieceType = aimGuidePiece(robot, config);
  if (!pieceType) return null;
  const shooter = shooterFor(config, pieceType);
  const ballistics = shooters?.[pieceType] ?? DEFAULT_SHOOTER_BALLISTICS;
  const lateral = Number.isFinite(ballistics.shooterLateralOffset) ? (ballistics.shooterLateralOffset as number) : 0;
  const aim = hiveCellAimPoint(alliance, upwardCell);
  const aimHeading = shooterAimHeading(robot.x, robot.y, aim, lateral) ?? bearingTo(robot.x, robot.y, aim.x, aim.y);
  const launchHeading = shotLaunchHeading(shooter, robot.heading, aimHeading);
  const offset = Number.isFinite(ballistics.shooterOffset) ? ballistics.shooterOffset : 0;
  const muzzle = launchPoint(robot.x, robot.y, launchHeading, { dz: 0, shooterOffset: offset, shooterLateralOffset: lateral });
  let sector: AimGuide['sector'] = null;
  if (shooter.turretType === 'TURRET') {
    const lo = normalizeAngle(shooter.turretRange[0]);
    let hi = normalizeAngle(shooter.turretRange[1]);
    if (lo > hi) hi += Math.PI * 2;
    sector = { start: robot.heading + lo, end: robot.heading + hi };
  }
  return {
    pieceType,
    center: { x: robot.x, y: robot.y },
    muzzle: { x: muzzle.x, y: muzzle.y },
    aim: { x: aim.x, y: aim.y },
    launchHeading,
    sector,
  };
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
  next: GamePiece['type'] | null; // 다음에 발사할 기물 종류 (첫 발사 가능 기물, 13-3 — 엔진 발사 대기열과 같음), 없음 = null
  fireable: Record<GamePiece['type'], boolean>; // 슈터 구성상 쏠 수 있는 기물 (13-3: 못 쏘는 기물은 패널에 값 대신 —)
}

/**
 * 명중 확률 + 다음 발사 기물 (좌측 패널 밝은 줄). configs = 로봇 제원(슈터 구성), 미지정이면 SHARED (v1: 적재함 0번 종류, 둘 다 발사 가능)
 */
export function hitProbabilities(
  frame: Frame,
  resolver: ShotProbabilityResolver,
  configs?: Readonly<Record<'robot1' | 'robot2', Partial<Pick<RobotConfig, 'shooterSetup'>>>>,
): Record<'robot1' | 'robot2', RobotHitProbability> {
  const { allianceColor, hive } = frame.field;
  const of = (id: 'robot1' | 'robot2', robot: Robot): RobotHitProbability => {
    const p = (type: GamePiece['type']) => {
      const raw = resolver(id, type, robot.x, robot.y, robot.heading, allianceColor, hive.upwardCell);
      return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    };
    const config = configs?.[id] ?? {};
    const next = nextFireablePieceIndex(config, robot.controlledPieces);
    return {
      POLLEN: p('POLLEN'),
      NECTAR: p('NECTAR'),
      next: next >= 0 ? robot.controlledPieces[next].type : null,
      fireable: { POLLEN: isPieceFireable(config, 'POLLEN'), NECTAR: isPieceFireable(config, 'NECTAR') },
    };
  };
  return { robot1: of('robot1', frame.r1), robot2: of('robot2', frame.r2) };
}
