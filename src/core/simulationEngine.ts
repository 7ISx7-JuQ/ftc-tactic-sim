// 50Hz 결정론적 메인 루프 엔진 (React/DOM 비의존 순수 TS)
// 좌표계 (명세서 2.1): 좌상단 (0,0) ~ 우하단 (144,144), +x 오른쪽, +y 아래쪽, Y=144 방향이 AUDIENCE

import {
  FIELD_SIZE,
  FLOWER_CIRCLES,
  FLOWER_IDS,
  FLOWER_RADIUS,
  GARDEN_AABB,
  HIVE_AABB,
  LOADING_ZONE_AABB,
  PIECE_PHYSICS,
  STOP_SPEED_THRESHOLD,
  generateTippedPiecePlan,
  getBumperZoneOBB,
  getRobotOBB,
  hiveCellAimPoint,
  resolvePiecesCollisions,
  resolveRobotEnvironmentCollisions,
  resolvePinnedPieces,
  resolveRobotRobotCollision,
  stepPieceDynamics,
  testCircleVsAABB,
  testOBBvsAABB,
  testOBBvsCircle,
  testOBBvsFieldBounds,
  testOBBvsOBB,
} from './collision';
import type { AABB, Circle, OBB, RobotBody, Vector2D } from './collision';
import { DEFAULT_SHOOTER_BALLISTICS, planShotFlight, planVoidedHitBounce } from './ballistics';
import { stepRobotKinematics } from './kinematics';
import {
  FLOWER_DEQ_GRAVITY_COOLDOWN,
  FLOWER_MAX_NECTAR_CAPACITY,
  FLOWER_MAX_POLLEN_BY_NECTAR,
  hiveTipPollenThreshold,
  isHiveTipReached,
} from './types';
import type {
  ActionRequest,
  DeepReadonly,
  FieldState,
  FlowerState,
  GamePiece,
  MatchShooterBallistics,
  PendingDrop,
  PendingShot,
  RobotConfig,
  RobotPose,
  RobotState,
  RPState,
  ScenarioConfig,
  ScoreBreakdown,
  ShotProbabilityResolver,
  TimelineFrame,
} from './types';

// ============================================================
// 1. 엔진 상수 (명세서 2.1 ~ 2.6)
// ============================================================

export const DT = 0.02;               // 고정 틱 간격 (초)
export const MATCH_TICKS = 6000;      // 120초 × 50Hz
export const ENDGAME_START_TICK = 3000; // 남은 시간 60초 시점

// 부동소수점 오차 허용 범위 (타이머 만료 판정 등)
const EPSILON = 1e-9;

// Stationary Lock 완전 정지 각속도 임계치 (rad/s)
const ANGULAR_STOP_THRESHOLD = 0.05;

// 기물 총량 및 시작 상황 룰 (명세서 2.4)
export const TOTAL_POLLEN = 32;
export const TOTAL_NECTAR = 8;
export const RULE_MAX_CONTROLLED_PIECES = 4;         // 룰상 로봇 적재 상한
export const INITIAL_HUMAN_NECTAR_STOCK = 5;         // 경기 시작 시 휴먼 플레이어 NECTAR 재고
export const NECTAR_IN_PLAY = TOTAL_NECTAR - INITIAL_HUMAN_NECTAR_STOCK; // 필드에 풀린 NECTAR (HIVE/로봇/바닥)
export const FLOWER_MAX_START_PIECES = 4;            // 텔레옵 시작 시 FLOWER당 최대 POLLEN (오토 중 투입 불가)
export const GARDEN_MAX_PIECES = 8;                  // GARDEN 물리적 수용 한도 (23in / POLLEN 직경 2.8in)
export const DEFAULT_FLOWER_PIECES = 4;
export const DEFAULT_GARDEN_PIECES = 4;
export const DEFAULT_HIVE_NECTAR = 3;

// FLOWER 상단 투입 도달 거리: 로봇 OBB 외곽 ↔ FLOWER 원통 최단 거리 (inch)
// (하단 추출은 인테이크 구역 겹침으로 판정하므로 이 값을 쓰지 않음)
const FLOWER_DROP_REACH = 1.0;

// 공 충돌 완화 루프 호출 횟수 (Step 4)
const PIECE_COLLISION_PASSES = 2;

const HIVE_TIP_POINTS = 20;
const PARK_POINTS = 5;
const FLOWER_POINTS_PER_PIECE = 2;
const FLOWER_BOTTOM_BONUS = 5;

// 자율주행 잔여 공 산포 최대 시도 횟수
const MAX_SCATTER_ATTEMPTS = 200;
// 시작 자세 사전 보정 최대 반복 (겹침이 없어질 때까지 로봇 충돌 해결을 반복, 명세서 3.8).
// 한 로봇이 장애물에 막히면 로봇끼리 겹침이 반복마다 절반씩 줄어들므로, 최대 겹침 18 in도 허용 오차 안으로 줄도록 50회
const SPAWN_CORRECTION_ITERATIONS = 50;
// 산포 실패 시 기준점 주변 링 탐색 간격 (inch) / 최대 링 수 (반경 = 링 × 간격)
const SCATTER_FALLBACK_STEP = 3;
const SCATTER_FALLBACK_RINGS = 40;

// 필드 밖 대기 좌표 (OUT_OF_BOUNDS 기물)
const OFF_FIELD = -10;

// ScenarioConfig.rngSeed 미지정 시 사용하는 기본 시드 (UI 기본값 표시용으로 공개)
export const DEFAULT_RNG_SEED = 0x5eed2026;

// 진영별 기본 스폰 (명세서 2.3): ScenarioConfig.r1Spawn / r2Spawn 미지정 시 적용
export const DEFAULT_SPAWN_POSES: Readonly<Record<'RED' | 'BLUE', Record<'robot1' | 'robot2', RobotPose>>> = {
  RED: {
    robot1: { x: 9.0, y: 36.0, heading: 0 },
    robot2: { x: 9.0, y: 108.0, heading: 0 },
  },
  BLUE: {
    robot1: { x: 135.0, y: 36.0, heading: Math.PI },
    robot2: { x: 135.0, y: 108.0, heading: Math.PI },
  },
};

// ============================================================
// 2. 외부 입력 타입
// ============================================================

export interface RobotDriveInput {
  targetVx: number;     // 필드 좌표계 목표 속도 (inch/s)
  targetVy: number;
  targetOmega: number;  // 목표 각속도 (rad/s)
  // 요청 행동. SHOOTING / FLOWER_DROPPING / FLOWER_LOWERING은 진입 후 완료까지 커밋되며(Stationary Lock),
  // 완료 시점에 같은 요청이 유지되고 있으면 다음 발사/투입을 연속 수행.
  // 리프트(FLOWER_SETUP → READY → DROPPING → LOWERING, 명세서 2.6.3): FLOWER_SETUP / FLOWER_DROPPING 요청은
  // 리프트 유지, 그 외 요청은 리프트 상태에서 내림 요청으로 해석
  actionState: ActionRequest;
}

// runFullMatch()용 틱별 입력 스케줄 (tick = 이번 step 직전의 currentTick)
export type DriveInputProvider = (
  tick: number,
  engine: SimulationEngine,
) => { r1?: RobotDriveInput; r2?: RobotDriveInput } | undefined;

const DEFAULT_INPUT: RobotDriveInput = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'IDLE' };

type RobotSlot = 'r1' | 'r2';

// ============================================================
// 3. 순수 헬퍼
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  const v = value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
  return clamp(v, 0, max);
}

// 로봇 적재 한도 = min(maxControlledPieces, 룰 상한 4), 0 이상 정수
export function getCarryCapacity(config: RobotConfig): number {
  return clampCount(config.maxControlledPieces, RULE_MAX_CONTROLLED_PIECES, RULE_MAX_CONTROLLED_PIECES);
}

// 시나리오 적재물 정규화: 미지정 시 한도만큼 POLLEN, NECTAR는 canIntakeNectar 로봇만, 길이는 한도 이내
function resolveLoadout(loadout: readonly GamePiece['type'][] | undefined, config: RobotConfig): GamePiece['type'][] {
  const capacity = getCarryCapacity(config);
  if (!loadout) return Array.from({ length: capacity }, () => 'POLLEN' as const);
  return loadout
    .filter((type) => type === 'POLLEN' || (type === 'NECTAR' && config.canIntakeNectar))
    .slice(0, capacity);
}

// ------------------------------------------------------------
// 시나리오 검증 (GUI는 결과가 비어 있지 않으면 설정 확정을 비활성화, 명세서 2.4)
// ------------------------------------------------------------

export interface ScenarioIssue {
  code:
    | 'FLOWER_COUNT'
    | 'GARDEN_COUNT'
    | 'HIVE_COUNT'
    | 'HIVE_OVER_THRESHOLD'
    | 'LOADOUT_OVER_CAPACITY'
    | 'LOADOUT_NECTAR_NOT_ALLOWED'
    | 'NECTAR_IN_PLAY_EXCEEDED'
    | 'POLLEN_TOTAL_EXCEEDED'
    | 'AUTO_TIP_COUNT';
  message: string;
}

function isCount(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

export function validateScenario(
  scenario: ScenarioConfig,
  r1Config: RobotConfig,
  r2Config: RobotConfig,
): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const add = (code: ScenarioIssue['code'], message: string): void => {
    issues.push({ code, message });
  };

  const flowers = scenario.flowerPiecesCount ?? [4, 4, 4, 4];
  flowers.forEach((n, i) => {
    if (!isCount(n, FLOWER_MAX_START_PIECES)) {
      add('FLOWER_COUNT', `FLOWER ${i + 1} POLLEN 수는 0 ~ ${FLOWER_MAX_START_PIECES} 정수여야 함 (입력 ${n})`);
    }
  });

  const garden = scenario.gardenPiecesCount ?? { ally: DEFAULT_GARDEN_PIECES, opponent: DEFAULT_GARDEN_PIECES };
  for (const [side, n] of [['아군', garden.ally], ['상대', garden.opponent]] as const) {
    if (!isCount(n, GARDEN_MAX_PIECES)) {
      add('GARDEN_COUNT', `${side} GARDEN POLLEN 수는 0 ~ ${GARDEN_MAX_PIECES} 정수여야 함 (입력 ${n})`);
    }
  }

  const hivePollen = scenario.hiveInitialPieces?.pollenCount ?? 0;
  const hiveNectar = scenario.hiveInitialPieces?.nectarCount ?? DEFAULT_HIVE_NECTAR;
  if (!isCount(hivePollen, TOTAL_POLLEN) || !isCount(hiveNectar, NECTAR_IN_PLAY)) {
    add('HIVE_COUNT', `HIVE POLLEN은 0 이상, NECTAR는 0 ~ ${NECTAR_IN_PLAY} 정수여야 함 (POLLEN ${hivePollen}, NECTAR ${hiveNectar})`);
  } else if (isHiveTipReached(hiveNectar, hivePollen)) {
    add('HIVE_OVER_THRESHOLD', `HIVE 상향 셀 {NECTAR ${hiveNectar}, POLLEN ${hivePollen}}이 팁 임계(NECTAR ${hiveNectar}개일 때 POLLEN ${hiveTipPollenThreshold(hiveNectar)}개)에 도달 (시작 전에 이미 전복된 상태)`);
  }

  let loadoutPollen = 0;
  let loadoutNectar = 0;
  const robots = [['R1', scenario.r1Loadout, r1Config], ['R2', scenario.r2Loadout, r2Config]] as const;
  for (const [name, loadout, config] of robots) {
    const resolved = loadout ?? resolveLoadout(undefined, config);
    const capacity = getCarryCapacity(config);
    if (resolved.length > capacity) {
      add('LOADOUT_OVER_CAPACITY', `${name} 적재물 ${resolved.length}개가 적재 한도 ${capacity}개를 초과`);
    }
    if (!config.canIntakeNectar && resolved.includes('NECTAR')) {
      add('LOADOUT_NECTAR_NOT_ALLOWED', `${name}는 NECTAR 흡입 불가 로봇이라 NECTAR를 적재할 수 없음`);
    }
    loadoutPollen += resolved.filter((t) => t === 'POLLEN').length;
    loadoutNectar += resolved.filter((t) => t === 'NECTAR').length;
  }

  if (hiveNectar + loadoutNectar > NECTAR_IN_PLAY) {
    add('NECTAR_IN_PLAY_EXCEEDED', `HIVE(${hiveNectar}) + 로봇(${loadoutNectar}) NECTAR가 필드에 풀린 NECTAR ${NECTAR_IN_PLAY}개를 초과`);
  }

  const flowerTotal = flowers.reduce((a, b) => a + b, 0);
  const pollenTotal = loadoutPollen + flowerTotal + hivePollen + garden.ally + garden.opponent;
  if (pollenTotal > TOTAL_POLLEN) {
    add('POLLEN_TOTAL_EXCEEDED', `지정된 POLLEN 합계 ${pollenTotal}개가 총량 ${TOTAL_POLLEN}개를 초과`);
  }

  const autoTips = scenario.autoTipCount ?? 0;
  if (!isCount(autoTips, INITIAL_HUMAN_NECTAR_STOCK)) {
    add('AUTO_TIP_COUNT', `오토 팁 횟수는 0 ~ ${INITIAL_HUMAN_NECTAR_STOCK} 정수여야 함 (입력 ${autoTips})`);
  }

  return issues;
}

// ------------------------------------------------------------
// 시작 자세 배치 검증 (GUI는 결과가 비어 있지 않으면 시나리오 확정을 비활성화, 명세서 3.8)
// ------------------------------------------------------------

// 닿음은 허용하고 이 깊이(inch)보다 깊이 파고들 때만 겹침 (벽에 붙은 기본 스폰 / 부동소수점 잔차 허용)
export const PLACEMENT_TOLERANCE = 1e-6;

export interface PlacementIssue {
  code:
    | 'PLACEMENT_OUT_OF_FIELD'
    | 'PLACEMENT_IN_HIVE'
    | 'PLACEMENT_IN_FLOWER'
    | 'PLACEMENT_ROBOT_OVERLAP'
    | 'PLACEMENT_PIECE_OVERLAP';
  robots: ('robot1' | 'robot2')[]; // 문제가 된 로봇 (GUI가 해당 로봇을 빨간색으로 표시)
  message: string;
}

// GARDEN 기물 배치 좌표 (reset과 배치 검증이 공유): 지정 수를 구역 길이에 균등 배치, 벽 밀착
function gardenPiecePositions(side: 'RED' | 'BLUE', count: number): Vector2D[] {
  const box = GARDEN_AABB[side];
  const r = PIECE_PHYSICS.POLLEN.radius;
  const spacing = (box.maxX - box.minX) / Math.max(1, count);
  const y = box.minY < FIELD_SIZE / 2 ? r : FIELD_SIZE - r;
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ x: box.minX + spacing * (i + 0.5), y }));
}

type RobotPlacement = { id: 'robot1' | 'robot2'; name: string; pose: RobotPose; config: RobotConfig };

// 로봇 자세별 배치 문제: 필드 경계 / HIVE / FLOWER / 로봇끼리 / 고정 배치 기물 (침투 깊이 > PLACEMENT_TOLERANCE)
function placementIssues(robots: readonly RobotPlacement[], fixedPieces: readonly Circle[]): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const deep = (hit: { colliding: boolean; depth: number }) => hit.colliding && hit.depth > PLACEMENT_TOLERANCE;
  const bodies = robots.map(r => getRobotOBB(r.pose, r.config));
  robots.forEach((robot, i) => {
    const body = bodies[i];
    const add = (code: PlacementIssue['code'], message: string) => issues.push({ code, robots: [robot.id], message });
    if (deep(testOBBvsFieldBounds(body))) add('PLACEMENT_OUT_OF_FIELD', `${robot.name} 몸체가 필드 밖으로 나감`);
    if (deep(testOBBvsAABB(body, HIVE_AABB))) add('PLACEMENT_IN_HIVE', `${robot.name} 몸체가 HIVE와 겹침`);
    const flowers = FLOWER_CIRCLES.flatMap((circle, k) => (deep(testOBBvsCircle(body, circle)) ? [k + 1] : []));
    if (flowers.length > 0) add('PLACEMENT_IN_FLOWER', `${robot.name} 몸체가 FLOWER ${flowers.join(', ')}와 겹침`);
    if (fixedPieces.some(piece => deep(testOBBvsCircle(body, piece)))) add('PLACEMENT_PIECE_OVERLAP', `${robot.name} 몸체가 GARDEN 기물과 겹침`);
  });
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      if (deep(testOBBvsOBB(bodies[i], bodies[j]))) {
        issues.push({ code: 'PLACEMENT_ROBOT_OVERLAP', robots: [robots[i].id, robots[j].id], message: `${robots[i].name}와 ${robots[j].name} 몸체가 겹침` });
      }
    }
  }
  return issues;
}

/**
 * 시작 자세 배치 검증: 시작 자세 미지정 로봇은 진영별 기본 스폰으로 검사.
 * 고정 배치 기물 = 시나리오가 정하는 GARDEN 기물 (바닥 산포 기물 / 오토 팁 NECTAR 슬롯은 이미 로봇을 피해 배치되므로 제외)
 */
export function validateRobotPlacement(scenario: ScenarioConfig, r1Config: RobotConfig, r2Config: RobotConfig): PlacementIssue[] {
  const alliance = scenario.allianceColor;
  const opponent = alliance === 'RED' ? 'BLUE' : 'RED';
  const robots: RobotPlacement[] = [
    { id: 'robot1', name: 'R1', pose: resolveSpawnPose(scenario.r1Spawn, DEFAULT_SPAWN_POSES[alliance].robot1), config: r1Config },
    { id: 'robot2', name: 'R2', pose: resolveSpawnPose(scenario.r2Spawn, DEFAULT_SPAWN_POSES[alliance].robot2), config: r2Config },
  ];
  const r = PIECE_PHYSICS.POLLEN.radius;
  const gardenPieces = [
    ...gardenPiecePositions(alliance, clampCount(scenario.gardenPiecesCount?.ally, DEFAULT_GARDEN_PIECES, GARDEN_MAX_PIECES)),
    ...gardenPiecePositions(opponent, clampCount(scenario.gardenPiecesCount?.opponent, DEFAULT_GARDEN_PIECES, GARDEN_MAX_PIECES)),
  ].map(center => ({ center, radius: r }));
  return placementIssues(robots, gardenPieces);
}

// FLOWER 용량 테이블 판정: 기물 1개를 더 넣은 뒤에도 NECTAR/POLLEN 한도 이내인지 (slot[0] 포함 전체 개수 기준)
// NECTAR 잼 상태(slot[0] = null, slot[1] = NECTAR)는 빈 slot[0]을 POLLEN 1개로 계산 (명세서 2.6.3):
//   출구 턱 높이 = POLLEN 직경(2.8in)이므로 턱에 걸린 NECTAR는 slot[0] POLLEN 위에 놓인 것과 같은 높이에서 적층이 시작됨.
//   턱(링) 위 받침과 공 위 받침의 지그재그 적층 미세 차이는 단순화를 위해 의도적으로 무시함.
// (렌더러의 FLOWER 게이지 "가득 참" 표시도 이 판정을 재사용: POLLEN / NECTAR 둘 다 불가 = 최대 조합, 명세서 3.7)
export function canFlowerAccept(
  flower: { readonly pieces: readonly (Pick<GamePiece, 'type'> | null)[] },
  type: GamePiece['type'],
): boolean {
  let nectar = type === 'NECTAR' ? 1 : 0;
  let pollen = type === 'POLLEN' ? 1 : 0;
  for (const p of flower.pieces) {
    if (p?.type === 'NECTAR') nectar++;
    else if (p?.type === 'POLLEN') pollen++;
  }
  // 이미 잼 상태이거나, 빈 원통에 NECTAR를 넣어 잼 상태가 되는 경우 빈 slot[0]을 POLLEN으로 계산
  const jammed = flower.pieces.length > 0 ? flower.pieces[0] === null : type === 'NECTAR';
  if (jammed) pollen++;
  return nectar <= FLOWER_MAX_NECTAR_CAPACITY && pollen <= (FLOWER_MAX_POLLEN_BY_NECTAR[nectar] ?? 0);
}

// Stationary Lock 상태: 주행 입력 차단 + 정지 후 타이머 차감 (IDLE / INTAKING 외 전부)
function isLockAction(state: RobotState['actionState']): boolean {
  return state !== 'IDLE' && state !== 'INTAKING';
}

// 리프트 유지 요청: 리프트 상태에서 이 외의 요청은 내림 요청으로 해석
function isLiftHoldRequest(request: ActionRequest): boolean {
  return request === 'FLOWER_SETUP' || request === 'FLOWER_DROPPING';
}

// GARDEN 판정: 기물을 바닥(xy 평면)에 수직 정사영한 원이 구역 사각형과 겹치면 인정 (걸침 포함)
function pieceOverlapsAABB(piece: GamePiece, box: AABB): boolean {
  const circle = { center: { x: piece.x, y: piece.y }, radius: PIECE_PHYSICS[piece.type].radius };
  return testCircleVsAABB(circle, box).colliding;
}

// OBB 위에서 점 p에 가장 가까운 점 (p가 내부면 p 자신)
function closestPointOnOBB(obb: OBB, p: Vector2D): Vector2D {
  const [u, v] = obb.axes;
  const dx = p.x - obb.center.x;
  const dy = p.y - obb.center.y;
  const lu = clamp(dx * u.x + dy * u.y, -obb.halfExtents[0], obb.halfExtents[0]);
  const lv = clamp(dx * v.x + dy * v.y, -obb.halfExtents[1], obb.halfExtents[1]);
  return {
    x: obb.center.x + lu * u.x + lv * v.x,
    y: obb.center.y + lu * u.y + lv * v.y,
  };
}

function distancePointToOBB(obb: OBB, p: Vector2D): number {
  const c = closestPointOnOBB(obb, p);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

// 가상 Intake Zone (명세서 3.3): RobotConfig.intakeZones를 필드 좌표 OBB 목록으로 변환
function getIntakeZoneOBBs(body: OBB, config: RobotConfig): OBB[] {
  const zones: OBB[] = [];
  for (const zone of config.intakeZones) {
    const obb = getBumperZoneOBB(body, zone);
    if (obb) zones.push(obb);
  }
  return zones;
}

// z축 정사영 판정: 기물/구조물의 바닥 투영 원이 구역 중 하나와 겹치면 true (접하기만 하면 false)
function circleOverlapsAnyZone(zones: readonly OBB[], center: Vector2D, radius: number): boolean {
  const circle = { center, radius };
  return zones.some((zone) => testOBBvsCircle(zone, circle).colliding);
}

function isRobotStationary(robot: RobotState): boolean {
  return (
    Math.hypot(robot.vx, robot.vy) < STOP_SPEED_THRESHOLD &&
    Math.abs(robot.omega) < ANGULAR_STOP_THRESHOLD
  );
}

// 시나리오 지정 자세가 유효(모든 성분 유한값)하면 사용, 아니면 진영별 기본 자세
function resolveSpawnPose(pose: RobotPose | undefined, fallback: RobotPose): RobotPose {
  if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.heading)) return pose;
  return fallback;
}

function createRobotState(pose: RobotPose): RobotState {
  return {
    x: pose.x,
    y: pose.y,
    vx: 0,
    vy: 0,
    omega: 0,
    heading: pose.heading,
    actionState: 'IDLE',
    stateTimer: 0,
    isBraking: false,
    intakeContactTimer: 0,
    intakeTargetPieceId: null,
    controlledPieces: [],
  };
}

// HIVE 내부 기물의 표시 위치: 상향 셀 조준점(투입구 오각형 면적 중심)의 바닥 정사영
function hiveCellCenter(alliance: 'RED' | 'BLUE', cell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'): Vector2D {
  const aim = hiveCellAimPoint(alliance, cell);
  return { x: aim.x, y: aim.y };
}

// 타임라인 스냅샷용 깊은 복사: 기물은 1회만 복제하고, 로봇 적재함/FLOWER 슬롯은
// 동일 프레임 내 복제본을 참조하도록 재구성 (JSON 직렬화 없이 GC 부하 최소화)
interface SimSnapshot {
  r1: RobotState;
  r2: RobotState;
  field: FieldState;
  pieces: GamePiece[];
}

// 득점 내역 복제 (프레임 기록 / 스크러빙 복원 시 엔진 작업본과 분리)
function cloneScoreBreakdown(src: ScoreBreakdown | null): ScoreBreakdown | null {
  if (!src) return null;
  return {
    ...src,
    flowers: src.flowers.map((f) => ({ ...f })),
    gardenPieceIds: [...src.gardenPieceIds],
    parkedRobots: [...src.parkedRobots],
  };
}

function cloneSnapshot(src: SimSnapshot, pieceIndex: ReadonlyMap<string, number>): SimSnapshot {
  const pieces = src.pieces.map((p) => ({ ...p }));
  const relink = (p: GamePiece): GamePiece => {
    const idx = pieceIndex.get(p.id);
    return idx === undefined ? { ...p } : pieces[idx];
  };
  const cloneRobot = (r: RobotState): RobotState => ({
    ...r,
    controlledPieces: r.controlledPieces.map(relink),
  });

  const { field } = src;
  return {
    r1: cloneRobot(src.r1),
    r2: cloneRobot(src.r2),
    field: {
      ...field,
      hive: { ...field.hive, pendingDrops: field.hive.pendingDrops.map((d) => ({ ...d })) },
      pendingShots: field.pendingShots.map((shot) => ({ ...shot, segments: shot.segments.map((seg) => ({ ...seg })) })),
      flowers: field.flowers.map((f) => ({ ...f, pieces: f.pieces.map((p) => (p ? relink(p) : null)) })),
    },
    pieces,
  };
}

// ============================================================
// 4. 시뮬레이션 엔진
// ============================================================

export class SimulationEngine {
  // 타임라인 프레임 배열 (0번 프레임부터 6000번 프레임까지 순차 축적)
  // 외부에는 읽기 전용으로만 공개 (기록 오염 방지). reset() 시 새 배열로 교체되므로
  // UI는 참조를 보관하지 말고 매번 engine.timeline / getFrame()으로 새로 읽을 것
  private frames: TimelineFrame[] = [];

  public get timeline(): readonly DeepReadonly<TimelineFrame>[] {
    return this.frames;
  }

  // 현재 시뮬레이션 내부 런타임 상태 (가변 작업본, 프레임에는 복제본만 기록)
  public currentTick: number = 0;
  public r1!: RobotState;
  public r2!: RobotState;
  public field!: FieldState;
  public pieces: GamePiece[] = [];
  public r1Config: RobotConfig;
  public r2Config: RobotConfig;

  // 외부 주입 슈터 명중률 해결자 (필수: 실제 경기는 탄도 LUT 기반, 테스트는 고정 확률)
  public shotResolver: ShotProbabilityResolver;

  // 발사 비행 처리용 슈터 탄도 (미주입 시 기본 자동 슈터: 발사마다 조준점 닫힌 해 v0)
  public shooters: MatchShooterBallistics;

  // runFullMatch()가 사용하는 틱별 입력 스케줄 (없으면 정지 + IDLE)
  public inputProvider: DriveInputProvider | null = null;

  private defaultAlliance: 'RED' | 'BLUE';
  private scenario: ScenarioConfig | undefined;
  private rngState = 0;
  private rngStates: number[] = []; // 틱별 난수 상태 (스크러빙 후 재시뮬레이션 결정론 보장)
  private pieceIndex = new Map<string, number>();
  private totalScore = 0;
  private rpAchieved: RPState = { swarm: false, pollinator1: false, pollinator2: false };
  private scoreBreakdown: ScoreBreakdown | null = null; // 종료 틱에만 기록 (그 외 null)

  constructor(
    r1Config: RobotConfig,
    r2Config: RobotConfig,
    shotResolver: ShotProbabilityResolver,
    allianceColor: 'RED' | 'BLUE' = 'RED',
    scenario?: ScenarioConfig,
    shooters?: MatchShooterBallistics,
  ) {
    // 로봇 식별자는 슬롯으로 고정 (사용자 입력 id와 무관하게 r1 = 'robot1', r2 = 'robot2')
    this.r1Config = { ...r1Config, id: 'robot1' };
    this.r2Config = { ...r2Config, id: 'robot2' };
    this.defaultAlliance = allianceColor;
    this.scenario = scenario;
    this.shotResolver = shotResolver;
    // 생성 시점 복사 (경기 중 원본 변경이 판정에 새지 않도록)
    const copyShooter = (b: MatchShooterBallistics['robot1'] | undefined) => {
      const src = b ?? DEFAULT_SHOOTER_BALLISTICS;
      return { ...src, v0: src.v0 ? { ...src.v0 } : undefined };
    };
    this.shooters = { robot1: copyShooter(shooters?.robot1), robot2: copyShooter(shooters?.robot2) };
    this.reset();
  }

  // ------------------------------------------------------------
  // 공개 API
  // ------------------------------------------------------------

  /** 시뮬레이터를 0틱 상태로 초기화하고 0번 프레임을 기록 */
  public reset(scenario?: ScenarioConfig): void {
    if (scenario) this.scenario = scenario;
    const sc = this.scenario;
    const alliance = sc?.allianceColor ?? this.defaultAlliance;
    const opponent = alliance === 'RED' ? 'BLUE' : 'RED';

    // 시나리오 시드 우선, 미지정/비유한값이면 기본 시드. 32비트 부호 없는 정수로 정규화
    const seed = sc?.rngSeed;
    this.rngState = (typeof seed === 'number' && Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_RNG_SEED) >>> 0;
    this.currentTick = 0;
    this.totalScore = 0;
    this.rpAchieved = { swarm: false, pollinator1: false, pollinator2: false };
    this.scoreBreakdown = null;

    this.r1 = createRobotState(resolveSpawnPose(sc?.r1Spawn, DEFAULT_SPAWN_POSES[alliance].robot1));
    this.r2 = createRobotState(resolveSpawnPose(sc?.r2Spawn, DEFAULT_SPAWN_POSES[alliance].robot2));

    // (0) 시작 자세 사전 보정 (명세서 3.8): GUI 검증을 거치지 않은 겹친 시작 자세에 대비해, 기물을 놓기 전에
    //     로봇–환경 / 로봇–로봇 겹침을 틱마다 쓰는 로봇 충돌 해결로 해소 (시간 진행 없음). 겹침이 없으면 아무것도 바꾸지 않음.
    const robotsOverlap = () => placementIssues([
      { id: 'robot1', name: 'R1', pose: this.r1, config: this.r1Config },
      { id: 'robot2', name: 'R2', pose: this.r2, config: this.r2Config },
    ], []).length > 0;
    for (let i = 0; i < SPAWN_CORRECTION_ITERATIONS && robotsOverlap(); i++) this.resolveRobotCollisions();

    // --- 기물 생성 (POLLEN 32, 아군 NECTAR 8) ---
    // 배분 순서 (명세서 2.4): 로봇 적재물 → FLOWER → HIVE → GARDEN → 오토 팁 NECTAR(로딩 존) → 나머지 바닥 무작위 산포
    // 엔진은 validateScenario를 통과하지 못한 값도 아래 규칙으로 잘라서 수용 (GUI 검증의 안전장치)
    const pollen: GamePiece[] = [];
    for (let i = 0; i < TOTAL_POLLEN; i++) pollen.push(this.makePiece(`pollen-${i + 1}`, 'POLLEN', 'NONE'));
    const nectar: GamePiece[] = [];
    for (let i = 0; i < TOTAL_NECTAR; i++) nectar.push(this.makePiece(`nectar-${i + 1}`, 'NECTAR', alliance));
    this.pieces = [...pollen, ...nectar];
    this.pieceIndex = new Map(this.pieces.map((p, i) => [p.id, i]));

    let pollenCursor = 0;
    const takePollen = (count: number): GamePiece[] => {
      const taken = pollen.slice(pollenCursor, pollenCursor + Math.max(0, count));
      pollenCursor += taken.length;
      return taken;
    };
    // 필드에 풀린 NECTAR(배열 앞쪽 NECTAR_IN_PLAY개)만 배분 대상, 뒤쪽은 휴먼 플레이어 재고
    let nectarCursor = 0;
    const takeNectar = (count: number): GamePiece[] => {
      const taken = nectar.slice(nectarCursor, Math.min(NECTAR_IN_PLAY, nectarCursor + Math.max(0, count)));
      nectarCursor += taken.length;
      return taken;
    };

    // (1) 로봇 적재물 (CONTROLLED, FIFO 순서: 0번이 가장 먼저 나감)
    const load = (robot: RobotState, loadout: readonly GamePiece['type'][] | undefined, config: RobotConfig): void => {
      for (const type of resolveLoadout(loadout, config)) {
        const [piece] = type === 'POLLEN' ? takePollen(1) : takeNectar(1);
        if (!piece) continue; // 총량 소진 시 해당 항목 생략
        piece.state = 'CONTROLLED';
        piece.x = robot.x;
        piece.y = robot.y;
        robot.controlledPieces.push(piece);
      }
    };
    load(this.r1, sc?.r1Loadout, this.r1Config);
    load(this.r2, sc?.r2Loadout, this.r2Config);

    // (2) FLOWER 내부 (IN_FLOWER): pieces[0]은 지면 슬롯, [1..]은 내부 볼륨
    const flowerCounts = sc?.flowerPiecesCount ?? [4, 4, 4, 4];
    const flowers: FlowerState[] = FLOWER_CIRCLES.map((circle, i) => {
      const stack = takePollen(clampCount(flowerCounts[i], DEFAULT_FLOWER_PIECES, FLOWER_MAX_START_PIECES));
      for (const piece of stack) {
        piece.state = 'IN_FLOWER';
        piece.x = circle.center.x;
        piece.y = circle.center.y;
      }
      return { id: FLOWER_IDS[i], pieces: stack, owner: 'NONE', bottomBonus: 'NONE' };
    });

    // (3) HIVE 상향 셀 (IN_HIVE): {NECTAR, POLLEN}이 팁 임계 미만이 되도록 제한 (NECTAR 먼저 확정)
    const upwardCell = sc?.hiveUpwardCell ?? (alliance === 'RED' ? 'AUDIENCE_CELL' : 'OPPOSITE_CELL');
    const cellCenter = hiveCellCenter(alliance, upwardCell);
    const hiveNectar = takeNectar(clampCount(sc?.hiveInitialPieces?.nectarCount, DEFAULT_HIVE_NECTAR, NECTAR_IN_PLAY));
    const hivePollenMax = Math.max(0, hiveTipPollenThreshold(hiveNectar.length) - 1);
    const hivePollen = takePollen(clampCount(sc?.hiveInitialPieces?.pollenCount, 0, hivePollenMax));
    const hivePieces = [...hivePollen, ...hiveNectar];
    for (const piece of hivePieces) {
      piece.state = 'IN_HIVE';
      piece.x = cellCenter.x;
      piece.y = cellCenter.y;
    }

    // (4) GARDEN (IN_GARDEN): 지정 수를 구역 길이에 균등 배치, 벽 밀착
    const gardenCounts: Record<'RED' | 'BLUE', number> = {
      RED: 0,
      BLUE: 0,
      [alliance]: clampCount(sc?.gardenPiecesCount?.ally, DEFAULT_GARDEN_PIECES, GARDEN_MAX_PIECES),
      [opponent]: clampCount(sc?.gardenPiecesCount?.opponent, DEFAULT_GARDEN_PIECES, GARDEN_MAX_PIECES),
    };
    for (const side of [alliance, opponent] as const) {
      const stack = takePollen(gardenCounts[side]);
      const spots = gardenPiecePositions(side, stack.length);
      stack.forEach((piece, i) => {
        piece.state = 'IN_GARDEN';
        piece.x = spots[i].x;
        piece.y = spots[i].y;
      });
    }

    this.field = {
      allianceColor: alliance,
      matchPhase: 'TELEOP',
      hive: {
        upwardCell,
        nectarInUpwardCell: hiveNectar.length,
        pollenInUpwardCell: hivePollen.length,
        isTipping: false,
        tipCount: 0,
        autoTipCount: clampCount(sc?.autoTipCount, 0, INITIAL_HUMAN_NECTAR_STOCK),
        tipProgressTimer: 0,
        pendingDrops: [],
      },
      flowers,
      nectarStock: INITIAL_HUMAN_NECTAR_STOCK, // 휴먼 플레이어 재고 (OUT_OF_BOUNDS 대기)
      pendingHumanNectar: 0,
      pendingShots: [],
    };

    // (5) 오토 팁 보상: 텔레옵 직전 휴먼 플레이어가 로딩 존에 NECTAR 투입 (결정론적 슬롯 배치, 산포보다 먼저)
    this.releaseHumanNectar(this.field.hive.autoTipCount);

    // (6) 지정되지 않은 나머지 POLLEN / 필드 NECTAR는 바닥에 무작위 산포 (ON_FIELD 정지)
    for (const piece of takePollen(TOTAL_POLLEN)) this.scatterPiece(piece);
    for (const piece of takeNectar(NECTAR_IN_PLAY)) this.scatterPiece(piece);

    this.frames = [];
    this.rngStates = [];
    this.recordFrame();
  }

  /**
   * 외부 조작 입력을 주입받아 다음 1틱(0.02초)을 계산하고 새 프레임을 타임라인에 추가.
   * 경기 종료(Tick 6000) 이후에는 마지막 프레임을 그대로 반환.
   */
  public step(r1Input?: RobotDriveInput, r2Input?: RobotDriveInput): DeepReadonly<TimelineFrame> {
    if (this.currentTick >= MATCH_TICKS) return this.frames[this.frames.length - 1];

    // 스크러빙으로 과거 틱에서 재개한 경우 미래 프레임을 폐기하고 분기
    if (this.frames.length > this.currentTick + 1) {
      this.frames.length = this.currentTick + 1;
      this.rngStates.length = this.currentTick + 1;
    }

    const in1 = r1Input ?? DEFAULT_INPUT;
    const in2 = r2Input ?? DEFAULT_INPUT;
    this.currentTick++;

    // 가든에 안착한 공도 물리 연산(밀림/흡입) 대상이 되도록 ON_FIELD로 활성화
    for (const piece of this.pieces) {
      if (piece.state === 'IN_GARDEN') piece.state = 'ON_FIELD';
    }

    // Step 1: 행동 요청 반영 + 기구학 적분 + Stationary Lock 제동/타이머
    this.r1 = this.stepRobotMotion(this.applyActionRequest(this.r1, in1, this.r1Config), in1, this.r1Config);
    this.r2 = this.stepRobotMotion(this.applyActionRequest(this.r2, in2, this.r2Config), in2, this.r2Config);

    // Step 2: 로봇 충돌 (1차 환경 → 로봇 상호 → 2차 환경)
    this.resolveRobotCollisions();

    // Step 3: 바닥 기물 마찰 감속 및 위치 적분
    this.pieces = stepPieceDynamics(this.pieces, DT);

    // Step 4: 공 충돌 완화 (환경 반사 / Kinematic Pusher / 공-공 PBD)
    const bodies = this.robotBodies();
    for (let pass = 0; pass < PIECE_COLLISION_PASSES; pass++) {
      this.pieces = resolvePiecesCollisions(this.pieces, bodies, 1);
    }

    // Step 4-2: 끼인 공 역보정 (명세서 3.3): 밀려날 곳 없는 공에 막힌 로봇을 되밀어 정지
    const pinned = resolvePinnedPieces(this.robotBodies(), this.pieces);
    [this.r1, this.r2] = pinned.robots;
    this.pieces = pinned.pieces;

    // Step 5: HIVE 시차 낙하 스폰
    this.stepHiveDrops();

    // Step 5-2: 발사 비행 도착 (명중 반영 / HIVE 반사 방출 / 바닥 착지)
    this.stepShotArrivals();

    // --- 게임 룰 인터랙션 ---
    this.processIntake('r1');
    this.processIntake('r2');
    this.processActionCompletion('r1', in1);
    this.processActionCompletion('r2', in2);

    if (this.currentTick >= ENDGAME_START_TICK && this.field.matchPhase === 'TELEOP') {
      this.field.matchPhase = 'ENDGAME';
      this.releaseHumanNectar(this.field.nectarStock);
    }
    // 로딩 존이 막혀 대기 중인 휴먼 플레이어 NECTAR는 빈 자리가 생기는 즉시 투입
    this.placePendingHumanNectar();

    this.syncCarriedPieces();
    this.classifyGardenPieces();

    // 점수: 진행 중에는 HIVE Tip만 실시간 (득점 내역 없음), 종료 틱에 전 항목 확정 + 득점 내역
    if (this.currentTick >= MATCH_TICKS) {
      this.finalizeScore();
    } else {
      this.totalScore = this.field.hive.tipCount * HIVE_TIP_POINTS;
      this.scoreBreakdown = null;
    }

    return this.recordFrame();
  }

  /** 0틱부터 6000틱까지 기본/스케줄된 입력(inputProvider)으로 일괄 시뮬레이션 실행 */
  public runFullMatch(): void {
    this.reset();
    while (this.currentTick < MATCH_TICKS) {
      const inputs = this.inputProvider?.(this.currentTick, this);
      this.step(inputs?.r1, inputs?.r2);
    }
  }

  /** 특정 틱의 스냅샷 조회 (O(1)) */
  public getFrame(tick: number): DeepReadonly<TimelineFrame> | undefined {
    if (!Number.isInteger(tick) || tick < 0) return undefined;
    return this.frames[tick];
  }

  /**
   * 타임라인 스크러빙 및 상태 롤백: 내부 런타임 상태를 해당 틱의 상태로 복원.
   * 미래 프레임은 다음 step() 호출 전까지 보존되어 앞으로 다시 스크러빙 가능.
   */
  public scrubTo(tick: number): void {
    if (this.frames.length === 0) return;
    const target = clamp(Math.floor(Number.isFinite(tick) ? tick : 0), 0, this.frames.length - 1);
    const frame = this.frames[target];

    const restored = cloneSnapshot(frame, this.pieceIndex);
    this.r1 = restored.r1;
    this.r2 = restored.r2;
    this.field = restored.field;
    this.pieces = restored.pieces;
    this.currentTick = frame.tick;
    this.totalScore = frame.totalScore;
    this.rpAchieved = { ...frame.rpAchieved };
    this.scoreBreakdown = cloneScoreBreakdown(frame.scoreBreakdown);
    this.rngState = this.rngStates[target];
  }

  // ------------------------------------------------------------
  // 난수 / 기물 헬퍼
  // ------------------------------------------------------------

  // Mulberry32 시드 기반 PRNG: 동일 시드 + 동일 입력이면 틱 단위로 완전 재현
  private random = (): number => {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  private uniform(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  private makePiece(id: string, type: GamePiece['type'], alliance: GamePiece['alliance']): GamePiece {
    return { id, type, alliance, x: OFF_FIELD, y: OFF_FIELD, vx: 0, vy: 0, state: 'OUT_OF_BOUNDS' };
  }

  private getPiece(id: string): GamePiece | undefined {
    const idx = this.pieceIndex.get(id);
    return idx === undefined ? undefined : this.pieces[idx];
  }

  private robotBodies(): RobotBody[] {
    return [
      { state: this.r1, config: this.r1Config },
      { state: this.r2, config: this.r2Config },
    ];
  }

  private overlapsFieldPiece(x: number, y: number, radius: number): boolean {
    return this.pieces.some(
      (p) =>
        (p.state === 'ON_FIELD' || p.state === 'IN_GARDEN') &&
        Math.hypot(p.x - x, p.y - y) < radius + PIECE_PHYSICS[p.type].radius,
    );
  }

  private overlapsRobot(x: number, y: number, radius: number): boolean {
    const circle = { center: { x, y }, radius };
    return this.robotBodies().some(({ state, config }) =>
      testOBBvsCircle(getRobotOBB(state, config), circle).colliding,
    );
  }

  // HIVE AABB, FLOWER 원통, GARDEN, 로딩 존, 로봇 스폰 OBB, 기존 기물을 회피하는 안전 난수 좌표에 정지 스폰
  // (GARDEN: 시나리오 지정 수량 보존 / 로딩 존: 휴먼 NECTAR 슬롯·주차 구역 보호, 양 진영 모두 제외)
  private scatterPiece(piece: GamePiece): void {
    const r = PIECE_PHYSICS[piece.type].radius;
    const noScatterZones = [GARDEN_AABB.RED, GARDEN_AABB.BLUE, LOADING_ZONE_AABB.RED, LOADING_ZONE_AABB.BLUE];
    const isSafe = (x: number, y: number): boolean => {
      if (x < r || x > FIELD_SIZE - r || y < r || y > FIELD_SIZE - r) return false;
      if (
        x > HIVE_AABB.minX - r &&
        x < HIVE_AABB.maxX + r &&
        y > HIVE_AABB.minY - r &&
        y < HIVE_AABB.maxY + r
      ) {
        return false;
      }
      if (FLOWER_CIRCLES.some((f) => Math.hypot(f.center.x - x, f.center.y - y) < f.radius + r)) return false;
      const circle = { center: { x, y }, radius: r };
      if (noScatterZones.some((zone) => testCircleVsAABB(circle, zone).colliding)) return false;
      return !this.overlapsRobot(x, y, r) && !this.overlapsFieldPiece(x, y, r);
    };

    let x = 0;
    let y = 0;
    let found = false;
    for (let attempt = 0; attempt < MAX_SCATTER_ATTEMPTS && !found; attempt++) {
      x = this.uniform(r, FIELD_SIZE - r);
      y = this.uniform(r, FIELD_SIZE - r);
      found = isSafe(x, y);
    }
    // 시도 한도 초과: HIVE 아래 필드 중앙 하단 기준점에서 바깥으로 링을 넓혀가며 첫 안전 좌표 탐색 (결정론적)
    if (!found) {
      const cx = FIELD_SIZE / 2;
      const cy = HIVE_AABB.maxY + (FIELD_SIZE - HIVE_AABB.maxY) / 2;
      x = cx;
      y = cy;
      for (let ring = 0; ring <= SCATTER_FALLBACK_RINGS && !found; ring++) {
        const dist = ring * SCATTER_FALLBACK_STEP;
        const samples = ring === 0 ? 1 : ring * 8;
        for (let k = 0; k < samples && !found; k++) {
          const angle = (2 * Math.PI * k) / samples;
          const px = cx + dist * Math.cos(angle);
          const py = cy + dist * Math.sin(angle);
          if (isSafe(px, py)) {
            x = px;
            y = py;
            found = true;
          }
        }
      }
    }

    piece.state = 'ON_FIELD';
    piece.x = x;
    piece.y = y;
    piece.vx = 0;
    piece.vy = 0;
  }

  // 휴먼 플레이어 NECTAR 투입 결정: 재고 → 투입 대기 (실제 배치는 placePendingHumanNectar)
  private releaseHumanNectar(count: number): void {
    const released = Math.min(Math.max(0, count), this.field.nectarStock);
    this.field.nectarStock -= released;
    this.field.pendingHumanNectar += released;
    this.placePendingHumanNectar();
  }

  // 투입 대기 NECTAR를 아군 로딩 존의 빈 슬롯(기물/로봇과 겹치지 않는 자리)에 벽쪽부터 정지 상태로 배치.
  // 빈 슬롯이 없으면 남은 수량은 다음 틱까지 대기 (로봇이 로딩 존을 막고 있으면 비켜줄 때 투입)
  private placePendingHumanNectar(): void {
    if (this.field.pendingHumanNectar <= 0) return;

    // RED 로딩 존(좌측 벽)에서 벽쪽 열부터 슬롯을 만들고, BLUE는 필드 중심 (72, 72) 점대칭으로 변환
    // → 두 진영의 슬롯 배치와 투입 순서가 완전히 대칭 (BLUE 로딩 존 = RED 로딩 존의 점대칭)
    const box = LOADING_ZONE_AABB.RED;
    const r = PIECE_PHYSICS.NECTAR.radius;
    const redSlots: Vector2D[] = [];
    for (let x = box.minX + r; x <= box.maxX - r + EPSILON; x += 2 * r + 0.4) {
      for (let y = box.minY + r; y <= box.maxY - r + EPSILON; y += 2 * r + 0.4) redSlots.push({ x, y });
    }
    const slots = this.field.allianceColor === 'RED'
      ? redSlots
      : redSlots.map((p) => ({ x: FIELD_SIZE - p.x, y: FIELD_SIZE - p.y }));

    while (this.field.pendingHumanNectar > 0) {
      const spot = slots.find((s) => !this.overlapsFieldPiece(s.x, s.y, r) && !this.overlapsRobot(s.x, s.y, r));
      if (!spot) return;
      // 재고 NECTAR는 배열 뒤쪽에서 꺼냄 (앞쪽 NECTAR_IN_PLAY개는 시작 배분 대상)
      const piece = this.pieces.findLast((p) => p.type === 'NECTAR' && p.state === 'OUT_OF_BOUNDS');
      if (!piece) {
        this.field.pendingHumanNectar = 0;
        return;
      }
      piece.state = 'ON_FIELD';
      piece.x = spot.x;
      piece.y = spot.y;
      piece.vx = 0;
      piece.vy = 0;
      this.field.pendingHumanNectar--;
    }
  }

  // ------------------------------------------------------------
  // Step 1: FSM 행동 요청 + 기구학 / Stationary Lock
  // ------------------------------------------------------------

  // IDLE / INTAKING에서는 새 행동 요청을 수락하고, 리프트 올림 / 대기 중에는 투입 / 내림 요청만 반영.
  // 발사 / 투입 / 내림은 완료 시까지 커밋 (요청 무시).
  private applyActionRequest(robot: RobotState, input: RobotDriveInput, config: RobotConfig): RobotState {
    const request = input.actionState;

    switch (robot.actionState) {
      case 'SHOOTING':
      case 'FLOWER_DROPPING':
      case 'FLOWER_LOWERING':
        return robot;

      case 'FLOWER_SETUP': {
        if (isLiftHoldRequest(request)) return robot;
        // 올리는 중 내림: 지금까지 올린 시간만큼 내림 (올림 시간 = 내림 시간). 제동 중이라 아직 안 올렸으면 즉시 IDLE
        const raised = Math.max(0, config.flowerSetupDelay) / 1000 - robot.stateTimer;
        if (raised <= EPSILON) return this.toIdleState(robot);
        return this.enterLock(robot, 'FLOWER_LOWERING', raised * 1000);
      }

      case 'FLOWER_READY':
        // 투입은 리프트가 올라가 있고 지금 투입 가능할 때만 (불가능하면 요청 무시, 대기 유지)
        if (request === 'FLOWER_DROPPING') {
          return this.findDropTarget(robot, config) >= 0 ? this.enterLock(robot, 'FLOWER_DROPPING', config.flowerDropDelay) : robot;
        }
        if (request === 'FLOWER_SETUP') return robot;
        return this.enterLock(robot, 'FLOWER_LOWERING', config.flowerSetupDelay);

      default:
        break;
    }

    if (request === 'SHOOTING' && robot.controlledPieces.length > 0) {
      return this.enterLock(robot, 'SHOOTING', config.shooterDelay);
    }
    // 리프트 올림은 지금 당장 투입 가능한 경우에만 수락 (불가능하면 요청 거부 → IDLE / INTAKING).
    // FLOWER_DROPPING 요청은 리프트가 올라가 있지 않으므로 무효
    if (request === 'FLOWER_SETUP' && this.findDropTarget(robot, config) >= 0) {
      return this.enterLock(robot, 'FLOWER_SETUP', config.flowerSetupDelay);
    }

    const next: RobotState['actionState'] = request === 'INTAKING' ? 'INTAKING' : 'IDLE';
    if (next === robot.actionState) return robot;
    return { ...robot, actionState: next, stateTimer: 0, isBraking: false, intakeContactTimer: 0, intakeTargetPieceId: null };
  }

  private toIdleState(robot: RobotState): RobotState {
    return { ...robot, actionState: 'IDLE', stateTimer: 0, isBraking: false, intakeContactTimer: 0, intakeTargetPieceId: null };
  }

  private enterLock(robot: RobotState, state: RobotState['actionState'], delayMs: number): RobotState {
    return {
      ...robot,
      actionState: state,
      stateTimer: Math.max(0, delayMs) / 1000,
      isBraking: true,
      intakeContactTimer: 0,
      intakeTargetPieceId: null,
    };
  }

  private stepRobotMotion(robot: RobotState, input: RobotDriveInput, config: RobotConfig): RobotState {
    // stepRobotKinematics는 락 액션일 때 목표 속도를 (0, 0, 0)으로 강제 (Slew Rate 감속)
    const next = stepRobotKinematics(robot, input.targetVx, input.targetVy, input.targetOmega, config, DT);
    if (!isLockAction(next.actionState)) return next;

    // 완전 정지 전까지는 제동 대기, 정지 도달 틱부터 액션 타이머 차감
    if (!isRobotStationary(next)) return { ...next, isBraking: true };
    return { ...next, isBraking: false, stateTimer: Math.max(0, next.stateTimer - DT) };
  }

  // ------------------------------------------------------------
  // Step 2: 로봇 충돌
  // ------------------------------------------------------------

  private resolveRobotCollisions(): void {
    let r1 = resolveRobotEnvironmentCollisions(this.r1, this.r1Config);
    let r2 = resolveRobotEnvironmentCollisions(this.r2, this.r2Config);
    ({ r1, r2 } = resolveRobotRobotCollision(r1, this.r1Config, r2, this.r2Config));
    // 상호 밀림으로 인한 장애물 재침투 방지용 2차 환경 보정
    this.r1 = resolveRobotEnvironmentCollisions(r1, this.r1Config);
    this.r2 = resolveRobotEnvironmentCollisions(r2, this.r2Config);
  }

  // ------------------------------------------------------------
  // Step 5: HIVE 시차 낙하
  // ------------------------------------------------------------

  private stepHiveDrops(): void {
    const hive = this.field.hive;
    if (!hive.isTipping) return;

    hive.tipProgressTimer += DT;
    const remaining: PendingDrop[] = [];
    for (const drop of hive.pendingDrops) {
      if (drop.settleTime > hive.tipProgressTimer + EPSILON) {
        remaining.push(drop);
        continue;
      }
      const piece = this.getPiece(drop.pieceId);
      if (!piece) continue;
      piece.state = 'ON_FIELD';
      piece.x = drop.targetX;
      piece.y = drop.targetY;
      piece.vx = 0;
      piece.vy = 0;
    }
    hive.pendingDrops = remaining;
    if (remaining.length === 0) hive.isTipping = false;
  }

  // ------------------------------------------------------------
  // 룰 1/2: 바닥 Intake Zone 흡입 + FLOWER 하단 추출(deQ)
  // ------------------------------------------------------------

  private processIntake(slot: RobotSlot): void {
    const robot = this[slot];
    const config = slot === 'r1' ? this.r1Config : this.r2Config;

    if (robot.actionState !== 'INTAKING' || robot.controlledPieces.length >= getCarryCapacity(config)) {
      if (robot.intakeContactTimer !== 0 || robot.intakeTargetPieceId !== null) {
        this[slot] = { ...robot, intakeContactTimer: 0, intakeTargetPieceId: null };
      }
      return;
    }

    const body = getRobotOBB(robot, config);
    const zones = getIntakeZoneOBBs(body, config);

    // (a) 바닥 기물: 정사영 원이 인테이크 구역 중 하나와 겹치는 ON_FIELD 기물
    const floorCandidates: GamePiece[] = [];
    for (const piece of this.pieces) {
      if (piece.state !== 'ON_FIELD') continue;
      if (piece.type === 'NECTAR' && !config.canIntakeNectar) continue;
      if (!circleOverlapsAnyZone(zones, piece, PIECE_PHYSICS[piece.type].radius)) continue;
      this.trapPiece(piece, robot, body);
      floorCandidates.push(piece);
    }

    // (b) FLOWER: 원통 정사영 원이 인테이크 구역 중 하나와 겹침 + slot[0] POLLEN
    let flowerTarget: { flower: FlowerState; distance: number } | null = null;
    for (let i = 0; i < FLOWER_CIRCLES.length; i++) {
      const flower = this.field.flowers[i];
      const bottom = flower.pieces[0];
      if (!bottom || bottom.type !== 'POLLEN') continue; // slot[0] 비었으면 잼 (추출 차단)
      const circle = FLOWER_CIRCLES[i];
      if (!circleOverlapsAnyZone(zones, circle.center, circle.radius)) continue;
      // 여러 FLOWER가 동시에 걸리면 차체에 가장 가까운 것을 우선
      const distance = distancePointToOBB(body, circle.center) - FLOWER_RADIUS;
      if (!flowerTarget || distance < flowerTarget.distance) flowerTarget = { flower, distance };
    }

    // 타깃 선정: 기존 타깃 유지 우선 → 가장 가까운 바닥 기물 → FLOWER
    const currentId = robot.intakeTargetPieceId;
    let floorTarget = floorCandidates.find((p) => p.id === currentId) ?? null;
    let flowerPick: FlowerState | null =
      currentId !== null && flowerTarget?.flower.pieces[0]?.id === currentId ? flowerTarget.flower : null;
    if (!floorTarget && !flowerPick) {
      let best = Infinity;
      for (const piece of floorCandidates) {
        const d = Math.hypot(piece.x - robot.x, piece.y - robot.y);
        if (d < best) {
          best = d;
          floorTarget = piece;
        }
      }
      if (!floorTarget) flowerPick = flowerTarget?.flower ?? null;
    }

    const targetId = floorTarget?.id ?? flowerPick?.pieces[0]?.id ?? null;
    if (targetId === null) {
      this[slot] = { ...robot, intakeContactTimer: 0, intakeTargetPieceId: null };
      return;
    }

    const timer = (targetId === currentId ? robot.intakeContactTimer : 0) + DT;
    const intakeDelay = Math.max(0, config.intakeDelay) / 1000;
    const required = flowerPick ? Math.max(intakeDelay, FLOWER_DEQ_GRAVITY_COOLDOWN) : intakeDelay;

    if (timer + EPSILON < required) {
      this[slot] = { ...robot, intakeContactTimer: timer, intakeTargetPieceId: targetId };
      return;
    }

    const captured = floorTarget ?? (flowerPick ? this.extractFromFlower(flowerPick) : null);
    if (captured) {
      captured.state = 'CONTROLLED';
      captured.x = robot.x;
      captured.y = robot.y;
      captured.vx = 0;
      captured.vy = 0;
      robot.controlledPieces.push(captured);
    }
    this[slot] = { ...robot, intakeContactTimer: 0, intakeTargetPieceId: null };
  }

  // Kinematic Pusher 흡착 트랩: 로봇 기준 이탈 법선 상대속도를 제거 (반발 계수 e = 0 효과)
  private trapPiece(piece: GamePiece, robot: RobotState, body: OBB): void {
    const closest = closestPointOnOBB(body, piece);
    const dx = piece.x - closest.x;
    const dy = piece.y - closest.y;
    const dist = Math.hypot(dx, dy);
    if (dist < EPSILON) return;
    const nx = dx / dist;
    const ny = dy / dist;

    const ox = piece.x - robot.x;
    const oy = piece.y - robot.y;
    const vEffX = robot.vx - robot.omega * oy;
    const vEffY = robot.vy + robot.omega * ox;
    const vn = (piece.vx - vEffX) * nx + (piece.vy - vEffY) * ny;
    if (vn > 0) {
      piece.vx -= vn * nx;
      piece.vy -= vn * ny;
    }
  }

  // slot[0] 추출 후 중력 침하: 위가 POLLEN이면 한 칸씩 하강, NECTAR면 slot[1]에 걸려 slot[0] = null
  private extractFromFlower(flower: FlowerState): GamePiece | null {
    const bottom = flower.pieces[0];
    if (!bottom || bottom.type !== 'POLLEN') return null;
    const rest = flower.pieces.slice(1);
    flower.pieces = rest[0]?.type === 'NECTAR' ? [null, ...rest] : rest;
    return bottom;
  }

  // ------------------------------------------------------------
  // 룰 3/4: 락 액션 완료 처리 (FLOWER 투입 / HIVE 슈팅)
  // ------------------------------------------------------------

  private processActionCompletion(slot: RobotSlot, input: RobotDriveInput): void {
    const robot = this[slot];
    if (!isLockAction(robot.actionState) || robot.isBraking || robot.stateTimer > EPSILON) return;

    const config = slot === 'r1' ? this.r1Config : this.r2Config;
    const toIdle = (): void => {
      this[slot] = { ...robot, actionState: 'IDLE', stateTimer: 0, isBraking: false };
    };
    // 완료 시점에 동일 요청이 유지되고 적재 기물이 남아 있으면 다음 사이클 재장전
    const rearm = (state: RobotState['actionState'], delayMs: number): void => {
      this[slot] = { ...robot, actionState: state, stateTimer: Math.max(0, delayMs) / 1000 };
    };

    switch (robot.actionState) {
      case 'SHOOTING': {
        this.fireShot(robot, slot === 'r1' ? 'robot1' : 'robot2');
        if (input.actionState === 'SHOOTING' && robot.controlledPieces.length > 0) {
          rearm('SHOOTING', config.shooterDelay);
        } else {
          toIdle();
        }
        return;
      }
      case 'FLOWER_SETUP':
        // 올림 완료 → 올린 채 대기 (투입은 대기 상태에서 FLOWER_DROPPING 요청으로만)
        rearm('FLOWER_READY', 0);
        return;
      case 'FLOWER_DROPPING': {
        const dropped = this.dropIntoFlower(robot, config);
        // 연속 투입은 투입 요청이 유지되고 다음 기물이 투입 가능할 때만, 그 외에는 리프트를 올린 채 대기로 복귀
        if (dropped && input.actionState === 'FLOWER_DROPPING' && this.findDropTarget(robot, config) >= 0) {
          rearm('FLOWER_DROPPING', config.flowerDropDelay);
        } else {
          rearm('FLOWER_READY', 0);
        }
        return;
      }
      case 'FLOWER_LOWERING':
        toIdle();
        return;
      default:
        return;
    }
  }

  // FLOWER 상단 투입 대상 선정: 차체 외곽에서 FLOWER_DROP_REACH 이내의 가장 가까운 FLOWER 인덱스 (없으면 -1)
  // 투입 방향 구역(flowerDropZones)을 도입할 경우 이 함수만 BumperZone 겹침 판정으로 교체
  private findDropTargetFlower(robot: RobotState, config: RobotConfig): number {
    const body = getRobotOBB(robot, config);
    let targetIndex = -1;
    let best = Infinity;
    for (let i = 0; i < FLOWER_CIRCLES.length; i++) {
      const distance = distancePointToOBB(body, FLOWER_CIRCLES[i].center) - FLOWER_RADIUS;
      if (distance <= FLOWER_DROP_REACH && distance < best) {
        best = distance;
        targetIndex = i;
      }
    }
    return targetIndex;
  }

  // FLOWER 상단 투입 가능 판정: 적재함 맨 앞 기물(FIFO)을 지금 투입할 수 있는 FLOWER 인덱스 (불가능하면 -1)
  //   ① 도달 거리 내 FLOWER 존재  ② NECTAR는 ENDGAME에만  ③ FLOWER 용량 테이블 이내
  // 투입 요청 수락 시점과 투입 완료 시점(준비 중 상황 변화 대비 안전장치)에 모두 사용
  private findDropTarget(robot: RobotState, config: RobotConfig): number {
    const piece = robot.controlledPieces[0];
    if (!piece) return -1;
    if (piece.type === 'NECTAR' && this.field.matchPhase !== 'ENDGAME') return -1;
    const targetIndex = this.findDropTargetFlower(robot, config);
    if (targetIndex < 0) return -1;
    return canFlowerAccept(this.field.flowers[targetIndex], piece.type) ? targetIndex : -1;
  }

  // FLOWER 상단 투입: 대상 FLOWER 최상단에 적재. 투입 불가 시 아무 변화 없이 false
  private dropIntoFlower(robot: RobotState, config: RobotConfig): boolean {
    const targetIndex = this.findDropTarget(robot, config);
    if (targetIndex < 0) return false;

    const piece = robot.controlledPieces.shift(); // FIFO: 가장 먼저 적재된 기물부터 투입
    if (!piece) return false;

    const flower = this.field.flowers[targetIndex];
    piece.state = 'IN_FLOWER';
    piece.x = FLOWER_CIRCLES[targetIndex].center.x;
    piece.y = FLOWER_CIRCLES[targetIndex].center.y;
    piece.vx = 0;
    piece.vy = 0;
    // 빈 원통에 투입된 NECTAR는 하단 배출구(2.8in)를 통과하지 못해 slot[1]에 걸림
    if (flower.pieces.length === 0 && piece.type === 'NECTAR') flower.pieces.push(null);
    flower.pieces.push(piece);
    return true;
  }

  // 발사: 명중 여부와 비행 궤적을 발사 시점에 확정하고 비행 대기열에 등록 (도착은 stepShotArrivals)
  private fireShot(robot: RobotState, robotId: 'robot1' | 'robot2'): void {
    const piece = robot.controlledPieces.shift(); // FIFO: 가장 먼저 적재된 기물부터 발사
    if (!piece) return;

    const hive = this.field.hive;
    const alliance = this.field.allianceColor;
    // 슬롯 기반 식별자 전달 (config.id에 의존하지 않음)
    const rawP = this.shotResolver(robotId, piece.type, robot.x, robot.y, robot.heading, alliance, hive.upwardCell);
    const p = Number.isFinite(rawP) ? clamp(rawP, 0, 1) : 0;
    // 난수는 발사마다 항상 3회 소비 (명중 판정, 반사 세기 / 방향 산포): 결과와 무관하게 RNG 시퀀스를 일정하게 유지하고,
    // 도착 시점에는 난수를 쓰지 않음 (결과론 불변)
    const roll = this.random();
    const bounceRestitutionRoll = this.random();
    const bounceAngleRoll = this.random();
    // 전복 진행 중(낙하 대기열 방출 전)에는 새 득점을 수용하지 않음
    const hit = !hive.isTipping && roll < p;

    const config = robotId === 'robot1' ? this.r1Config : this.r2Config;
    const plan = planShotFlight({
      robotX: robot.x,
      robotY: robot.y,
      robotHeading: robot.heading,
      shooter: config,
      ballistics: this.shooters[robotId],
      pieceType: piece.type,
      alliance,
      upwardCell: hive.upwardCell,
      hit,
      bounceRolls: { restitution: bounceRestitutionRoll, angle: bounceAngleRoll },
    });
    const flightTicks = Number.isFinite(plan.flightTime) ? Math.max(1, Math.round(plan.flightTime / DT)) : 1;

    piece.state = 'IN_FLIGHT';
    piece.x = plan.from.x;
    piece.y = plan.from.y;
    piece.vx = 0;
    piece.vy = 0;
    this.field.pendingShots.push({
      pieceId: piece.id,
      pieceType: piece.type,
      robotId,
      result: plan.result,
      targetCell: hive.upwardCell,
      launchTick: this.currentTick,
      arriveTick: this.currentTick + flightTicks,
      contactTime: plan.contactTime,
      fromX: plan.from.x,
      fromY: plan.from.y,
      fromZ: plan.from.z,
      toX: plan.to.x,
      toY: plan.to.y,
      toZ: plan.to.z,
      heading: plan.heading,
      v0: plan.v0,
      pitch: plan.pitch,
      segments: plan.segments,
      landX: plan.landing.x,
      landY: plan.landing.y,
      landingVx: plan.landingVx,
      landingVy: plan.landingVy,
      bounceRestitutionRoll,
      bounceAngleRoll,
    });
  }

  // 비행 도착: 도착 틱이 된 발사를 발사 순서대로 반영
  // - 명중: 조준점 도착 틱에 HIVE가 전복 중이 아니고 상향 셀이 발사 시점과 같으면 적재 (같은 틱 앞 발의 팁이 뒤 발을 무효화).
  //   무효면 조준점에서 반사 낙하 구간을 붙이고 MISS_HIVE로 바꿔 착지 틱까지 비행 유지
  // - 그 외: 발사 시점에 확정된 최종 착지점 / 착지 속도로 ON_FIELD
  private stepShotArrivals(): void {
    const hive = this.field.hive;
    const remaining: PendingShot[] = [];
    for (const shot of this.field.pendingShots) {
      if (shot.arriveTick > this.currentTick) {
        remaining.push(shot);
        continue;
      }
      const piece = this.getPiece(shot.pieceId);
      if (!piece) continue;
      if (shot.result === 'HIT') {
        if (!hive.isTipping && hive.upwardCell === shot.targetCell) {
          this.scoreInHive(piece);
          continue;
        }
        this.voidHit(shot);
        if (shot.arriveTick > this.currentTick) {
          remaining.push(shot);
          continue;
        }
      }
      piece.state = 'ON_FIELD';
      piece.x = shot.landX;
      piece.y = shot.landY;
      piece.vx = shot.landingVx;
      piece.vy = shot.landingVy;
    }
    this.field.pendingShots = remaining;
  }

  // 무효 명중: 조준점에서 셀 쪽 HIVE 앞면으로 반사 낙하 (발사 시점에 뽑아 둔 산포 난수 사용), 착지 틱은 현재 틱 이후
  private voidHit(shot: PendingShot): void {
    const after = planVoidedHitBounce({
      from: { x: shot.fromX, y: shot.fromY },
      aim: { x: shot.toX, y: shot.toY, z: shot.toZ },
      v0: shot.v0,
      pitch: shot.pitch,
      contactTime: shot.contactTime,
      targetCell: shot.targetCell,
      pieceType: shot.pieceType,
      rolls: { restitution: shot.bounceRestitutionRoll, angle: shot.bounceAngleRoll },
    });
    shot.result = 'MISS_HIVE';
    shot.segments = after.segments;
    shot.landX = after.landing.x;
    shot.landY = after.landing.y;
    shot.landingVx = after.landingVx;
    shot.landingVy = after.landingVy;
    const landTick = Number.isFinite(after.landingTime) ? shot.launchTick + Math.round(after.landingTime / DT) : this.currentTick + 1;
    shot.arriveTick = Math.max(this.currentTick + 1, landTick);
  }

  // 명중 기물을 상향 셀에 적재하고, 임계 테이블 도달 시 같은 틱에 즉시 전복 시작 (전복 중 발사 / 도착은 모두 빗맞음)
  private scoreInHive(piece: GamePiece): void {
    const hive = this.field.hive;
    const cellCenter = hiveCellCenter(this.field.allianceColor, hive.upwardCell);
    piece.state = 'IN_HIVE';
    piece.x = cellCenter.x;
    piece.y = cellCenter.y;
    piece.vx = 0;
    piece.vy = 0;
    if (piece.type === 'NECTAR') hive.nectarInUpwardCell++;
    else hive.pollenInUpwardCell++;
    if (isHiveTipReached(hive.nectarInUpwardCell, hive.pollenInUpwardCell)) this.tipHive();
  }

  private tipHive(): void {
    const hive = this.field.hive;
    const spilledCell = hive.upwardCell;

    hive.tipCount++;
    hive.isTipping = true;
    hive.tipProgressTimer = 0;
    // 셀 내부 기물 전체를 현재 로봇 OBB 데드존 기준으로 낙하 계획 (시드 PRNG 주입)
    hive.pendingDrops = generateTippedPiecePlan(
      this.field.allianceColor,
      spilledCell,
      this.pieces.filter((p) => p.state === 'IN_HIVE'),
      this.robotBodies(),
      this.random,
    );
    hive.upwardCell = spilledCell === 'AUDIENCE_CELL' ? 'OPPOSITE_CELL' : 'AUDIENCE_CELL';
    hive.nectarInUpwardCell = 0;
    hive.pollenInUpwardCell = 0;
    if (hive.pendingDrops.length === 0) hive.isTipping = false;

    this.releaseHumanNectar(1);
  }

  // ------------------------------------------------------------
  // 틱 후처리 / 점수 / 프레임 기록
  // ------------------------------------------------------------

  // 적재 기물 좌표를 로봇 중심에 동기화 (렌더링 및 스크러빙 일관성)
  private syncCarriedPieces(): void {
    for (const robot of [this.r1, this.r2]) {
      for (const piece of robot.controlledPieces) {
        piece.x = robot.x;
        piece.y = robot.y;
      }
    }
  }

  // 정사영이 GARDEN AABB에 걸친 채 완전히 정지한 바닥 기물은 IN_GARDEN으로 안착 처리
  private classifyGardenPieces(): void {
    for (const piece of this.pieces) {
      if (piece.state !== 'ON_FIELD' || piece.vx !== 0 || piece.vy !== 0) continue;
      if (pieceOverlapsAABB(piece, GARDEN_AABB.RED) || pieceOverlapsAABB(piece, GARDEN_AABB.BLUE)) {
        piece.state = 'IN_GARDEN';
      }
    }
  }

  // Tick 6000: HIVE + FLOWER + GARDEN + PARK 일괄 합산 및 RP 판정, 항목별 득점 내역과 인정 근거 기록
  private finalizeScore(): void {
    const alliance = this.field.allianceColor;
    const hiveScore = this.field.hive.tipCount * HIVE_TIP_POINTS;

    const flowers = this.field.flowers.map((flower) => {
      const volume = flower.pieces.slice(1).filter((p): p is GamePiece => p !== null);
      const owned = volume.some((p) => p.type === 'NECTAR' && p.alliance === alliance);
      if (owned) {
        flower.owner = alliance;
        flower.bottomBonus = alliance;
      }
      const points = owned ? volume.length * FLOWER_POINTS_PER_PIECE + FLOWER_BOTTOM_BONUS : 0;
      return { id: flower.id, scoringPieces: volume.length, owned, points };
    });
    const flowerScore = flowers.reduce((sum, f) => sum + f.points, 0);

    const garden = GARDEN_AABB[alliance];
    const gardenPieceIds = this.pieces
      .filter((p) => p.state === 'IN_GARDEN' && p.vx === 0 && p.vy === 0 && pieceOverlapsAABB(p, garden))
      .map((p) => p.id);
    const gardenScore = gardenPieceIds.length;

    // PARK: 차체 일부라도 아군 LOADING ZONE과 겹친 채 정지한 로봇 (FTC 룰: 부분 진입 인정)
    const zone = LOADING_ZONE_AABB[alliance];
    const parkedRobots = this.robotBodies()
      .filter(({ state, config }) => isRobotStationary(state) && testOBBvsAABB(getRobotOBB(state, config), zone).colliding)
      .map(({ config }) => config.id);
    const parked = parkedRobots.length;
    const parkScore = parked * PARK_POINTS;

    this.totalScore = hiveScore + flowerScore + gardenScore + parkScore;
    this.scoreBreakdown = {
      hive: hiveScore,
      flower: flowerScore,
      garden: gardenScore,
      park: parkScore,
      flowers,
      gardenPieceIds,
      parkedRobots,
    };
    this.rpAchieved = {
      swarm: parked === 2,
      // POLLINATOR: 오토 + 텔레옵 팁 합산 (점수는 텔레옵 팁만)
      pollinator1: this.field.hive.autoTipCount + this.field.hive.tipCount >= 4,
      pollinator2: this.field.hive.autoTipCount + this.field.hive.tipCount >= 7,
    };
  }

  private recordFrame(): TimelineFrame {
    const snapshot = cloneSnapshot(
      { r1: this.r1, r2: this.r2, field: this.field, pieces: this.pieces },
      this.pieceIndex,
    );
    const frame: TimelineFrame = {
      tick: this.currentTick,
      timestamp: this.currentTick * DT,
      ...snapshot,
      totalScore: this.totalScore,
      rpAchieved: { ...this.rpAchieved },
      scoreBreakdown: cloneScoreBreakdown(this.scoreBreakdown),
    };
    this.frames[this.currentTick] = frame;
    this.rngStates[this.currentTick] = this.rngState;
    return frame;
  }
}
