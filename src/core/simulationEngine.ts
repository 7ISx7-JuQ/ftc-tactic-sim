// 50Hz 결정론적 메인 루프 엔진 (React/DOM 비의존 순수 TS)
// 좌표계 (명세서 2.1): 좌상단 (0,0) ~ 우하단 (144,144), +x 오른쪽, +y 아래쪽, Y=144 방향이 AUDIENCE

import {
  FIELD_SIZE,
  FLOWER_CIRCLES,
  FLOWER_IDS,
  FLOWER_RADIUS,
  GARDEN_AABB,
  HIVE_AABB,
  HIVE_CENTER_X,
  LOADING_ZONE_AABB,
  PIECE_PHYSICS,
  STOP_SPEED_THRESHOLD,
  generateTippedPiecePlan,
  getRobotOBB,
  resolvePiecesCollisions,
  resolveRobotEnvironmentCollisions,
  resolveRobotRobotCollision,
  stepPieceDynamics,
  testCircleVsAABB,
  testOBBvsAABB,
  testOBBvsCircle,
} from './collision';
import type { AABB, OBB, RobotBody, Vector2D } from './collision';
import { stepRobotKinematics } from './kinematics';
import {
  FLOWER_DEQ_GRAVITY_COOLDOWN,
  FLOWER_MAX_NECTAR_CAPACITY,
  FLOWER_MAX_POLLEN_BY_NECTAR,
  HIVE_TIP_THRESHOLD,
} from './types';
import type {
  FieldState,
  FlowerState,
  GamePiece,
  PendingDrop,
  RobotConfig,
  RobotPose,
  RobotState,
  RPState,
  ScenarioConfig,
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

const MAX_CONTROLLED_PIECES = 4;
const TOTAL_POLLEN = 32;
const TOTAL_NECTAR = 8;

// 로봇 OBB 외곽 ↔ FLOWER 원통 최단 거리 접촉 판정 (inch)
const FLOWER_CONTACT_DISTANCE = 1.0;

// 공 충돌 완화 루프 호출 횟수 (Step 4)
const PIECE_COLLISION_PASSES = 2;

const HIVE_TIP_POINTS = 20;
const PARK_POINTS = 5;
const FLOWER_POINTS_PER_PIECE = 2;
const FLOWER_BOTTOM_BONUS = 5;

// 빗맞음 공 방출 파라미터
const MISS_SPEED_MIN = 20;               // inch/s
const MISS_SPEED_MAX = 60;               // inch/s
const MISS_SPREAD_RAD = Math.PI / 3;     // 바깥 법선 기준 ±60°
const MISS_SPAWN_GAP = 0.1;              // HIVE 외곽과의 여유 (inch)

// 자율주행 잔여 공 산포 최대 시도 횟수
const MAX_SCATTER_ATTEMPTS = 200;

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
  // 요청 행동. SHOOTING / FLOWER_* 는 진입 후 완료까지 커밋되며(Stationary Lock),
  // 완료 시점에 같은 요청이 유지되고 있으면 다음 발사/투입을 연속 수행
  actionState: RobotState['actionState'];
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

function isLockAction(state: RobotState['actionState']): boolean {
  return state === 'SHOOTING' || state === 'FLOWER_SETUP' || state === 'FLOWER_DROPPING';
}

function isFlowerAction(state: RobotState['actionState']): boolean {
  return state === 'FLOWER_SETUP' || state === 'FLOWER_DROPPING';
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

// 가상 Intake Zone (명세서 3.3)
//   FRONT: 전면 범퍼 앞 너비 intakeWidth × 깊이 intakeDepth 센서 박스
//   ANY  : 차체 OBB를 사방으로 intakeDepth만큼 확장한 박스
function getIntakeZone(robot: RobotState, config: RobotConfig): OBB | null {
  const body = getRobotOBB(robot, config);
  const depth = Math.max(0, config.intakeDepth);

  if (config.intakeDirection === 'ANY') {
    return {
      center: body.center,
      axes: body.axes,
      halfExtents: [body.halfExtents[0] + depth, body.halfExtents[1] + depth],
    };
  }

  const width = Math.max(0, config.intakeWidth);
  if (depth <= 0 || width <= 0) return null;
  const forward = body.axes[0];
  const offset = body.halfExtents[0] + depth / 2;
  return {
    center: { x: body.center.x + forward.x * offset, y: body.center.y + forward.y * offset },
    axes: body.axes,
    halfExtents: [depth / 2, width / 2],
  };
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

function hiveCellCenter(alliance: 'RED' | 'BLUE', cell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL'): Vector2D {
  const quarter = (HIVE_AABB.maxY - HIVE_AABB.minY) / 4;
  const midY = (HIVE_AABB.minY + HIVE_AABB.maxY) / 2;
  return { x: HIVE_CENTER_X[alliance], y: cell === 'AUDIENCE_CELL' ? midY + quarter : midY - quarter };
}

// 타임라인 스냅샷용 깊은 복사: 기물은 1회만 복제하고, 로봇 적재함/FLOWER 슬롯은
// 동일 프레임 내 복제본을 참조하도록 재구성 (JSON 직렬화 없이 GC 부하 최소화)
interface SimSnapshot {
  r1: RobotState;
  r2: RobotState;
  field: FieldState;
  pieces: GamePiece[];
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
  public timeline: TimelineFrame[] = [];

  // 현재 시뮬레이션 내부 런타임 상태 (가변 작업본, 프레임에는 복제본만 기록)
  public currentTick: number = 0;
  public r1!: RobotState;
  public r2!: RobotState;
  public field!: FieldState;
  public pieces: GamePiece[] = [];
  public r1Config: RobotConfig;
  public r2Config: RobotConfig;

  // 외부 주입 슈터 명중률 해결자 (기본값: 로봇 shooterAccuracy 고정 확률)
  public shotResolver: ShotProbabilityResolver;

  // runFullMatch()가 사용하는 틱별 입력 스케줄 (없으면 정지 + IDLE)
  public inputProvider: DriveInputProvider | null = null;

  private defaultAlliance: 'RED' | 'BLUE';
  private scenario: ScenarioConfig | undefined;
  private rngState = 0;
  private rngStates: number[] = []; // 틱별 난수 상태 (스크러빙 후 재시뮬레이션 결정론 보장)
  private pieceIndex = new Map<string, number>();
  private totalScore = 0;
  private rpAchieved: RPState = { swarm: false, pollinator1: false, pollinator2: false };

  constructor(
    r1Config: RobotConfig,
    r2Config: RobotConfig,
    allianceColor: 'RED' | 'BLUE' = 'RED',
    scenario?: ScenarioConfig,
    shotResolver?: ShotProbabilityResolver,
  ) {
    this.r1Config = r1Config;
    this.r2Config = r2Config;
    this.defaultAlliance = allianceColor;
    this.scenario = scenario;
    this.shotResolver =
      shotResolver ??
      ((robotId) => (robotId === this.r2Config.id ? this.r2Config : this.r1Config).shooterAccuracy);
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

    this.r1 = createRobotState(resolveSpawnPose(sc?.r1Spawn, DEFAULT_SPAWN_POSES[alliance].robot1));
    this.r2 = createRobotState(resolveSpawnPose(sc?.r2Spawn, DEFAULT_SPAWN_POSES[alliance].robot2));

    // --- 기물 생성 (POLLEN 32, 아군 NECTAR 8) ---
    const pollen: GamePiece[] = [];
    for (let i = 0; i < TOTAL_POLLEN; i++) pollen.push(this.makePiece(`pollen-${i + 1}`, 'POLLEN', 'NONE'));
    const nectar: GamePiece[] = [];
    for (let i = 0; i < TOTAL_NECTAR; i++) nectar.push(this.makePiece(`nectar-${i + 1}`, 'NECTAR', alliance));
    this.pieces = [...pollen, ...nectar];
    this.pieceIndex = new Map(this.pieces.map((p, i) => [p.id, i]));

    let pollenCursor = 0;
    const takePollen = (count: number): GamePiece[] => {
      const taken = pollen.slice(pollenCursor, pollenCursor + count);
      pollenCursor += taken.length;
      return taken;
    };
    let nectarCursor = 0;
    const takeNectar = (count: number): GamePiece[] => {
      const taken = nectar.slice(nectarCursor, nectarCursor + count);
      nectarCursor += taken.length;
      return taken;
    };

    // (1) 로봇 프리로드 (CONTROLLED)
    const preload = (robot: RobotState, count: number | undefined): void => {
      for (const piece of takePollen(clampCount(count, MAX_CONTROLLED_PIECES, MAX_CONTROLLED_PIECES))) {
        piece.state = 'CONTROLLED';
        piece.x = robot.x;
        piece.y = robot.y;
        robot.controlledPieces.push(piece);
      }
    };
    preload(this.r1, sc?.r1PreloadCount);
    preload(this.r2, sc?.r2PreloadCount);

    // (2) FLOWER 내부 (IN_FLOWER): pieces[0]은 지면 슬롯, [1..]은 내부 볼륨
    const flowerCounts = sc?.flowerPiecesCount ?? [4, 4, 4, 4];
    const flowerMax = FLOWER_MAX_POLLEN_BY_NECTAR[0] ?? 0;
    const flowers: FlowerState[] = FLOWER_CIRCLES.map((circle, i) => {
      const stack = takePollen(clampCount(flowerCounts[i], 4, flowerMax));
      for (const piece of stack) {
        piece.state = 'IN_FLOWER';
        piece.x = circle.center.x;
        piece.y = circle.center.y;
      }
      return { id: FLOWER_IDS[i], pieces: stack, owner: 'NONE', bottomBonus: 'NONE' };
    });

    // (3) HIVE 상향 셀 (IN_HIVE)
    const upwardCell = sc?.hiveUpwardCell ?? (alliance === 'RED' ? 'AUDIENCE_CELL' : 'OPPOSITE_CELL');
    const cellCenter = hiveCellCenter(alliance, upwardCell);
    const hivePieces = [
      ...takePollen(clampCount(sc?.hiveInitialPieces?.pollenCount, 0, TOTAL_POLLEN)),
      ...takeNectar(clampCount(sc?.hiveInitialPieces?.nectarCount, 3, TOTAL_NECTAR)),
    ];
    for (const piece of hivePieces) {
      piece.state = 'IN_HIVE';
      piece.x = cellCenter.x;
      piece.y = cellCenter.y;
    }

    // (4) 자율주행 잔여 공: 데드존 회피 난수 산포 (ON_FIELD 정지)
    const scattered: GamePiece[] = [];
    if (sc?.groundPiecesCount) {
      scattered.push(
        ...takePollen(clampCount(sc.groundPiecesCount.pollen, 0, TOTAL_POLLEN)),
        ...takeNectar(clampCount(sc.groundPiecesCount.nectar, 0, TOTAL_NECTAR)),
      );
    }

    // (5) GARDEN: 아군 → 상대 순으로 최대 4개씩 (잔여 POLLEN 한도 내)
    for (const side of [alliance, opponent] as const) {
      const box = GARDEN_AABB[side];
      const stack = takePollen(4);
      const r = PIECE_PHYSICS.POLLEN.radius;
      const spacing = (box.maxX - box.minX) / 4;
      stack.forEach((piece, i) => {
        piece.state = 'IN_GARDEN';
        piece.x = box.minX + spacing * (i + 0.5);
        piece.y = box.minY < FIELD_SIZE / 2 ? r : FIELD_SIZE - r; // 벽 밀착
      });
    }

    this.field = {
      allianceColor: alliance,
      matchPhase: 'TELEOP',
      hive: {
        upwardCell,
        ballsInUpwardCell: hivePieces.length,
        isTipping: false,
        tipCount: 0,
        tipProgressTimer: 0,
        pendingDrops: [],
      },
      flowers,
      nectarStock: TOTAL_NECTAR - nectarCursor, // 휴먼 플레이어 스톡 (OUT_OF_BOUNDS 대기)
    };

    for (const piece of scattered) this.scatterPiece(piece);

    this.timeline = [];
    this.rngStates = [];
    this.recordFrame();
  }

  /**
   * 외부 조작 입력을 주입받아 다음 1틱(0.02초)을 계산하고 새 프레임을 타임라인에 추가.
   * 경기 종료(Tick 6000) 이후에는 마지막 프레임을 그대로 반환.
   */
  public step(r1Input?: RobotDriveInput, r2Input?: RobotDriveInput): TimelineFrame {
    if (this.currentTick >= MATCH_TICKS) return this.timeline[this.timeline.length - 1];

    // 스크러빙으로 과거 틱에서 재개한 경우 미래 프레임을 폐기하고 분기
    if (this.timeline.length > this.currentTick + 1) {
      this.timeline.length = this.currentTick + 1;
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

    // Step 5: HIVE 시차 낙하 스폰
    this.stepHiveDrops();

    // --- 게임 룰 인터랙션 ---
    this.processIntake('r1');
    this.processIntake('r2');
    this.processActionCompletion('r1', in1);
    this.processActionCompletion('r2', in2);

    if (this.currentTick >= ENDGAME_START_TICK && this.field.matchPhase === 'TELEOP') {
      this.field.matchPhase = 'ENDGAME';
      this.spawnHumanNectar(this.field.nectarStock);
    }

    this.syncCarriedPieces();
    this.classifyGardenPieces();

    // 점수: 진행 중에는 HIVE Tip만 실시간, 종료 틱에 전 항목 확정
    if (this.currentTick >= MATCH_TICKS) this.finalizeScore();
    else this.totalScore = this.field.hive.tipCount * HIVE_TIP_POINTS;

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
  public getFrame(tick: number): TimelineFrame | undefined {
    if (!Number.isInteger(tick) || tick < 0) return undefined;
    return this.timeline[tick];
  }

  /**
   * 타임라인 스크러빙 및 상태 롤백: 내부 런타임 상태를 해당 틱의 상태로 복원.
   * 미래 프레임은 다음 step() 호출 전까지 보존되어 앞으로 다시 스크러빙 가능.
   */
  public scrubTo(tick: number): void {
    if (this.timeline.length === 0) return;
    const target = clamp(Math.floor(Number.isFinite(tick) ? tick : 0), 0, this.timeline.length - 1);
    const frame = this.timeline[target];

    const restored = cloneSnapshot(frame, this.pieceIndex);
    this.r1 = restored.r1;
    this.r2 = restored.r2;
    this.field = restored.field;
    this.pieces = restored.pieces;
    this.currentTick = frame.tick;
    this.totalScore = frame.totalScore;
    this.rpAchieved = { ...frame.rpAchieved };
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

  // HIVE AABB, FLOWER 원통, 로봇 스폰 OBB, 기존 기물을 회피하는 안전 난수 좌표에 정지 스폰
  private scatterPiece(piece: GamePiece): void {
    const r = PIECE_PHYSICS[piece.type].radius;
    const isSafe = (x: number, y: number): boolean => {
      if (
        x > HIVE_AABB.minX - r &&
        x < HIVE_AABB.maxX + r &&
        y > HIVE_AABB.minY - r &&
        y < HIVE_AABB.maxY + r
      ) {
        return false;
      }
      if (FLOWER_CIRCLES.some((f) => Math.hypot(f.center.x - x, f.center.y - y) < f.radius + r)) return false;
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
    // 시도 한도 초과: HIVE와 로봇 스폰 라인 사이 필드 중앙 하단 안전 좌표
    if (!found) {
      x = FIELD_SIZE / 2;
      y = HIVE_AABB.maxY + (FIELD_SIZE - HIVE_AABB.maxY) / 2;
    }

    piece.state = 'ON_FIELD';
    piece.x = x;
    piece.y = y;
    piece.vx = 0;
    piece.vy = 0;
  }

  // 휴먼 플레이어 NECTAR를 아군 로딩 존 내부 바닥에 정지 상태로 스폰 (벽쪽 슬롯 우선)
  private spawnHumanNectar(count: number): void {
    const box = LOADING_ZONE_AABB[this.field.allianceColor];
    const r = PIECE_PHYSICS.NECTAR.radius;
    const slots: Vector2D[] = [];
    for (let x = box.minX + r; x <= box.maxX - r + EPSILON; x += 2 * r + 0.4) {
      for (let y = box.minY + r; y <= box.maxY - r + EPSILON; y += 2 * r + 0.4) slots.push({ x, y });
    }
    const wallDist = (p: Vector2D): number => Math.min(p.x, FIELD_SIZE - p.x);
    slots.sort((a, b) => wallDist(a) - wallDist(b) || a.y - b.y);

    const spawnCount = Math.min(Math.max(0, count), this.field.nectarStock);
    for (let n = 0; n < spawnCount; n++) {
      const piece = this.pieces.find((p) => p.type === 'NECTAR' && p.state === 'OUT_OF_BOUNDS');
      if (!piece) break;

      const spot =
        slots.find((s) => !this.overlapsFieldPiece(s.x, s.y, r) && !this.overlapsRobot(s.x, s.y, r)) ??
        slots.find((s) => !this.overlapsFieldPiece(s.x, s.y, r)) ?? {
          x: (box.minX + box.maxX) / 2,
          y: (box.minY + box.maxY) / 2,
        };

      piece.state = 'ON_FIELD';
      piece.x = spot.x;
      piece.y = spot.y;
      piece.vx = 0;
      piece.vy = 0;
      this.field.nectarStock--;
    }
  }

  // ------------------------------------------------------------
  // Step 1: FSM 행동 요청 + 기구학 / Stationary Lock
  // ------------------------------------------------------------

  // IDLE / INTAKING 중에만 새 행동 요청을 수락. 락 액션은 완료 시까지 커밋.
  private applyActionRequest(robot: RobotState, input: RobotDriveInput, config: RobotConfig): RobotState {
    if (isLockAction(robot.actionState)) return robot;

    const request = input.actionState;
    const hasPieces = robot.controlledPieces.length > 0;

    if (request === 'SHOOTING' && hasPieces) {
      return this.enterLock(robot, 'SHOOTING', config.shooterDelay);
    }
    if (isFlowerAction(request) && hasPieces) {
      return this.enterLock(robot, 'FLOWER_SETUP', config.flowerSetupDelay);
    }

    const next: RobotState['actionState'] = request === 'INTAKING' ? 'INTAKING' : 'IDLE';
    if (next === robot.actionState) return robot;
    return { ...robot, actionState: next, stateTimer: 0, isBraking: false, intakeContactTimer: 0, intakeTargetPieceId: null };
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

    if (robot.actionState !== 'INTAKING' || robot.controlledPieces.length >= MAX_CONTROLLED_PIECES) {
      if (robot.intakeContactTimer !== 0 || robot.intakeTargetPieceId !== null) {
        this[slot] = { ...robot, intakeContactTimer: 0, intakeTargetPieceId: null };
      }
      return;
    }

    const body = getRobotOBB(robot, config);

    // (a) 바닥 기물: 유효 Intake Zone과 겹치는 ON_FIELD 기물
    const zone = getIntakeZone(robot, config);
    const floorCandidates: GamePiece[] = [];
    if (zone) {
      for (const piece of this.pieces) {
        if (piece.state !== 'ON_FIELD') continue;
        if (piece.type === 'NECTAR' && !config.canIntakeNectar) continue;
        const circle = { center: { x: piece.x, y: piece.y }, radius: PIECE_PHYSICS[piece.type].radius };
        if (!testOBBvsCircle(zone, circle).colliding) continue;
        this.trapPiece(piece, robot, body);
        floorCandidates.push(piece);
      }
    }

    // (b) FLOWER: 로봇 OBB 외곽 ↔ 원통 최단 거리 1.0in 이내 + slot[0] POLLEN
    let flowerTarget: { flower: FlowerState; distance: number } | null = null;
    for (let i = 0; i < FLOWER_CIRCLES.length; i++) {
      const flower = this.field.flowers[i];
      const bottom = flower.pieces[0];
      if (!bottom || bottom.type !== 'POLLEN') continue; // slot[0] 비었으면 잼 (추출 차단)
      const distance = distancePointToOBB(body, FLOWER_CIRCLES[i].center) - FLOWER_RADIUS;
      if (distance > FLOWER_CONTACT_DISTANCE) continue;
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
        this.fireShot(robot, config);
        if (input.actionState === 'SHOOTING' && robot.controlledPieces.length > 0) {
          rearm('SHOOTING', config.shooterDelay);
        } else {
          toIdle();
        }
        return;
      }
      case 'FLOWER_SETUP':
        rearm('FLOWER_DROPPING', config.flowerDropDelay);
        return;
      case 'FLOWER_DROPPING': {
        const dropped = this.dropIntoFlower(robot, config);
        if (dropped && isFlowerAction(input.actionState) && robot.controlledPieces.length > 0) {
          rearm('FLOWER_DROPPING', config.flowerDropDelay);
        } else {
          toIdle();
        }
        return;
      }
      default:
        return;
    }
  }

  // FLOWER 상단 투입: 접촉 중인 가장 가까운 FLOWER에 최상단 적재 (용량/페이즈 검사)
  private dropIntoFlower(robot: RobotState, config: RobotConfig): boolean {
    const body = getRobotOBB(robot, config);
    let targetIndex = -1;
    let best = Infinity;
    for (let i = 0; i < FLOWER_CIRCLES.length; i++) {
      const distance = distancePointToOBB(body, FLOWER_CIRCLES[i].center) - FLOWER_RADIUS;
      if (distance <= FLOWER_CONTACT_DISTANCE && distance < best) {
        best = distance;
        targetIndex = i;
      }
    }
    if (targetIndex < 0) return false;

    const piece = robot.controlledPieces.pop();
    if (!piece) return false;

    const flower = this.field.flowers[targetIndex];
    let nectar = piece.type === 'NECTAR' ? 1 : 0;
    let pollen = piece.type === 'POLLEN' ? 1 : 0;
    for (const p of flower.pieces) {
      if (p?.type === 'NECTAR') nectar++;
      else if (p?.type === 'POLLEN') pollen++;
    }
    const pollenLimit = FLOWER_MAX_POLLEN_BY_NECTAR[nectar] ?? 0;
    const allowed =
      (piece.type === 'POLLEN' || this.field.matchPhase === 'ENDGAME') &&
      nectar <= FLOWER_MAX_NECTAR_CAPACITY &&
      pollen <= pollenLimit;
    if (!allowed) {
      robot.controlledPieces.push(piece); // 투입 불가: 적재함 원복
      return false;
    }

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

  private fireShot(robot: RobotState, config: RobotConfig): void {
    const piece = robot.controlledPieces.pop();
    if (!piece) return;

    const hive = this.field.hive;
    const alliance = this.field.allianceColor;
    const rawP = this.shotResolver(config.id, robot.x, robot.y, robot.heading, alliance, hive.upwardCell);
    const p = Number.isFinite(rawP) ? clamp(rawP, 0, 1) : 0;
    // 난수는 항상 1회 소비하여 전복 여부와 무관하게 RNG 시퀀스를 일정하게 유지
    const roll = this.random();
    // 전복 진행 중(낙하 대기열 방출 전)에는 새 득점을 수용하지 않음
    const hit = !hive.isTipping && roll < p;

    if (!hit) {
      this.ejectMissedShot(piece, robot);
      return;
    }

    const cellCenter = hiveCellCenter(alliance, hive.upwardCell);
    piece.state = 'IN_HIVE';
    piece.x = cellCenter.x;
    piece.y = cellCenter.y;
    piece.vx = 0;
    piece.vy = 0;
    hive.ballsInUpwardCell++;

    if (hive.ballsInUpwardCell >= HIVE_TIP_THRESHOLD) this.tipHive();
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
    hive.ballsInUpwardCell = 0;
    if (hive.pendingDrops.length === 0) hive.isTipping = false;

    this.spawnHumanNectar(1);
  }

  // 빗맞음: 로봇에 가장 가까운 HIVE 외곽 지점에서 바깥 방향 무작위 속도로 튕겨 나옴
  private ejectMissedShot(piece: GamePiece, robot: RobotState): void {
    const r = PIECE_PHYSICS[piece.type].radius;
    const edgeX = clamp(robot.x, HIVE_AABB.minX, HIVE_AABB.maxX);
    const edgeY = clamp(robot.y, HIVE_AABB.minY, HIVE_AABB.maxY);
    let nx = robot.x - edgeX;
    let ny = robot.y - edgeY;
    let len = Math.hypot(nx, ny);
    if (len < EPSILON) {
      nx = robot.x - (HIVE_AABB.minX + HIVE_AABB.maxX) / 2;
      ny = robot.y - (HIVE_AABB.minY + HIVE_AABB.maxY) / 2;
      len = Math.hypot(nx, ny);
      if (len < EPSILON) {
        nx = 0;
        ny = 1;
        len = 1;
      }
    }
    nx /= len;
    ny /= len;

    const angle = Math.atan2(ny, nx) + this.uniform(-MISS_SPREAD_RAD, MISS_SPREAD_RAD);
    const speed = this.uniform(MISS_SPEED_MIN, MISS_SPEED_MAX);
    piece.state = 'ON_FIELD';
    piece.x = clamp(edgeX + nx * (r + MISS_SPAWN_GAP), r, FIELD_SIZE - r);
    piece.y = clamp(edgeY + ny * (r + MISS_SPAWN_GAP), r, FIELD_SIZE - r);
    piece.vx = speed * Math.cos(angle);
    piece.vy = speed * Math.sin(angle);
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

  // Tick 6000: HIVE + FLOWER + GARDEN + PARK 일괄 합산 및 RP 판정
  private finalizeScore(): void {
    const alliance = this.field.allianceColor;
    const hiveScore = this.field.hive.tipCount * HIVE_TIP_POINTS;

    let flowerScore = 0;
    for (const flower of this.field.flowers) {
      const volume = flower.pieces.slice(1).filter((p): p is GamePiece => p !== null);
      const hasAllyNectar = volume.some((p) => p.type === 'NECTAR' && p.alliance === alliance);
      if (!hasAllyNectar) continue;
      flowerScore += volume.length * FLOWER_POINTS_PER_PIECE + FLOWER_BOTTOM_BONUS;
      flower.owner = alliance;
      flower.bottomBonus = alliance;
    }

    const garden = GARDEN_AABB[alliance];
    const gardenScore = this.pieces.filter(
      (p) =>
        p.state === 'IN_GARDEN' && p.vx === 0 && p.vy === 0 && pieceOverlapsAABB(p, garden),
    ).length;

    // PARK: 차체 일부라도 아군 LOADING ZONE과 겹친 채 정지한 로봇 (FTC 룰: 부분 진입 인정)
    const zone = LOADING_ZONE_AABB[alliance];
    const parked = this.robotBodies().filter(
      ({ state, config }) =>
        isRobotStationary(state) && testOBBvsAABB(getRobotOBB(state, config), zone).colliding,
    ).length;
    const parkScore = parked * PARK_POINTS;

    this.totalScore = hiveScore + flowerScore + gardenScore + parkScore;
    this.rpAchieved = {
      swarm: parked === 2,
      pollinator1: this.field.hive.tipCount >= 4,
      pollinator2: this.field.hive.tipCount >= 7,
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
    };
    this.timeline[this.currentTick] = frame;
    this.rngStates[this.currentTick] = this.rngState;
    return frame;
  }
}
