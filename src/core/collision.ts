import type { GamePiece, PendingDrop, RobotConfig, RobotState } from './types';

// 부동소수점 오차 허용 범위
const EPSILON = 1e-9;

// 비유한값(NaN, ±Infinity)을 0으로 치환
function finiteOr0(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ============================================================
// 1. 필드 / 구조물 / 기물 물리 상수 (명세서 2.2, 2.5)
// ============================================================

export const FIELD_SIZE = 144;

// HIVE 프레임 AABB
export const HIVE_AABB: AABB = {
  minX: 47.27,
  maxX: 96.73,
  minY: 52.525,
  maxY: 91.475,
};

// 진영별 HIVE 중심선 X (Lip_X)
export const HIVE_CENTER_X = {
  RED: 59.25,
  BLUE: 84.75,
} as const;

// FLOWER 솔리드 원형 장애물 (반지름 2.0)
export const FLOWER_RADIUS = 2.0;
export const FLOWER_CIRCLES: readonly Circle[] = [
  { center: { x: 2.0, y: 96.0 }, radius: FLOWER_RADIUS },   // Red
  { center: { x: 48.0, y: 2.0 }, radius: FLOWER_RADIUS },   // Red
  { center: { x: 142.0, y: 48.0 }, radius: FLOWER_RADIUS }, // Blue
  { center: { x: 96.0, y: 142.0 }, radius: FLOWER_RADIUS }, // Blue
];

// FLOWER_CIRCLES와 동일 인덱스 순서의 식별자 / 소속 진영 (엔진 FlowerState.id, 렌더러 라벨과 공유)
export const FLOWER_IDS = ['flower1', 'flower2', 'flower3', 'flower4'] as const;
export const FLOWER_ALLIANCES = ['RED', 'RED', 'BLUE', 'BLUE'] as const;

// 통과 가능 구역: GARDEN 23 × 2, LOADING ZONE 11 × 23 (충돌 없음, 득점/스폰 판정용)
export const GARDEN_AABB: Readonly<Record<'RED' | 'BLUE', AABB>> = {
  RED: { minX: 0, maxX: 23, minY: 142, maxY: 144 },
  BLUE: { minX: 121, maxX: 144, minY: 0, maxY: 2 },
};

export const LOADING_ZONE_AABB: Readonly<Record<'RED' | 'BLUE', AABB>> = {
  RED: { minX: 0, maxX: 11, minY: 24, maxY: 47 },
  BLUE: { minX: 133, maxX: 144, minY: 97, maxY: 120 },
};

export interface PiecePhysics {
  radius: number;         // inch
  mass: number;           // g
  frictionDecel: number;  // 쿨롱 마찰 감속도 (inch/s^2)
  restitution: number;    // 반발 계수 e
}

export const PIECE_PHYSICS: Record<GamePiece['type'], PiecePhysics> = {
  POLLEN: { radius: 1.4, mass: 24.95, frictionDecel: 65.0, restitution: 0.35 },
  NECTAR: { radius: 1.8, mass: 41.28, frictionDecel: 85.0, restitution: 0.25 },
};

// 정지 임계 속도 (inch/s): 미만 시 속도 0 스냅
export const STOP_SPEED_THRESHOLD = 0.5;

// 로봇-환경 충돌 반복 해결 횟수 (코너/FLOWER-벽 인접부 재침투 방지)
const ROBOT_ENV_ITERATIONS = 2;

// ============================================================
// 2. 기하 타입 및 SAT 판정 도구
// ============================================================

export interface Vector2D {
  x: number;
  y: number;
}

// 회전된 박스: axes[0]은 헤딩 방향 단위 벡터, axes[1]은 그 수직 단위 벡터
export interface OBB {
  center: Vector2D;
  axes: [Vector2D, Vector2D];
  halfExtents: [number, number]; // axes[0], axes[1] 방향 반길이
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Circle {
  center: Vector2D;
  radius: number;
}

// 충돌 결과 부호 규약:
//   normal = A를 B 밖으로 밀어내는 단위 벡터 (B → A 방향)
//   mtv    = normal * depth (A에 더하면 분리되는 최소 이동 벡터)
export interface CollisionResult {
  colliding: boolean;
  normal: Vector2D;
  depth: number;
  mtv: Vector2D;
}

function noCollision(): CollisionResult {
  return { colliding: false, normal: { x: 0, y: 0 }, depth: 0, mtv: { x: 0, y: 0 } };
}

function makeCollision(normal: Vector2D, depth: number): CollisionResult {
  return {
    colliding: true,
    normal,
    depth,
    mtv: { x: normal.x * depth, y: normal.y * depth },
  };
}

function dot(a: Vector2D, b: Vector2D): number {
  return a.x * b.x + a.y * b.y;
}

// 축 위로 투영한 OBB의 반경
function projectOBBRadius(obb: OBB, axis: Vector2D): number {
  return (
    obb.halfExtents[0] * Math.abs(dot(obb.axes[0], axis)) +
    obb.halfExtents[1] * Math.abs(dot(obb.axes[1], axis))
  );
}

function getOBBVertices(obb: OBB): Vector2D[] {
  const [u, v] = obb.axes;
  const [hx, hy] = obb.halfExtents;
  const { x: cx, y: cy } = obb.center;
  const vertices: Vector2D[] = [];
  for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    vertices.push({
      x: cx + su * hx * u.x + sv * hy * v.x,
      y: cy + su * hx * u.y + sv * hy * v.y,
    });
  }
  return vertices;
}

function aabbToOBB(box: AABB): OBB {
  return {
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    axes: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    halfExtents: [Math.max(0, (box.maxX - box.minX) / 2), Math.max(0, (box.maxY - box.minY) / 2)],
  };
}

// 공통 SAT 루프: 모든 후보 축에서 겹침이 있어야 충돌이며, 최소 겹침 축이 MTV
function satMinimumOverlap(
  centerA: Vector2D,
  radiusA: (axis: Vector2D) => number,
  centerB: Vector2D,
  radiusB: (axis: Vector2D) => number,
  axes: Vector2D[],
): CollisionResult {
  let minOverlap = Infinity;
  let bestNormal: Vector2D = { x: 0, y: 0 };

  for (const axis of axes) {
    const dist = (centerA.x - centerB.x) * axis.x + (centerA.y - centerB.y) * axis.y;
    const overlap = radiusA(axis) + radiusB(axis) - Math.abs(dist);
    if (overlap <= 0) return noCollision(); // 분리축 발견

    if (overlap < minOverlap) {
      minOverlap = overlap;
      // A가 축의 음(-)쪽에 있으면 법선 반전하여 항상 B → A 방향 유지
      bestNormal = dist < 0 ? { x: -axis.x, y: -axis.y } : { x: axis.x, y: axis.y };
    }
  }

  if (!Number.isFinite(minOverlap)) return noCollision();
  return makeCollision(bestNormal, minOverlap);
}

export function testOBBvsOBB(a: OBB, b: OBB): CollisionResult {
  return satMinimumOverlap(
    a.center,
    (axis) => projectOBBRadius(a, axis),
    b.center,
    (axis) => projectOBBRadius(b, axis),
    [a.axes[0], a.axes[1], b.axes[0], b.axes[1]],
  );
}

export function testOBBvsAABB(obb: OBB, box: AABB): CollisionResult {
  return testOBBvsOBB(obb, aabbToOBB(box));
}

// OBB 로컬 2축 + 원 중심에서 가장 가까운 꼭짓점을 잇는 축, 총 3축 SAT
export function testOBBvsCircle(obb: OBB, circle: Circle): CollisionResult {
  const radius = Math.max(0, circle.radius);
  const axes: Vector2D[] = [obb.axes[0], obb.axes[1]];

  let closest: Vector2D | null = null;
  let closestDistSq = Infinity;
  for (const vertex of getOBBVertices(obb)) {
    const dx = circle.center.x - vertex.x;
    const dy = circle.center.y - vertex.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closest = vertex;
    }
  }

  if (closest) {
    const dx = circle.center.x - closest.x;
    const dy = circle.center.y - closest.y;
    const len = Math.hypot(dx, dy);
    // 원 중심이 꼭짓점과 일치하면 축이 정의되지 않으므로 로컬 2축만 사용
    if (len > EPSILON) axes.push({ x: dx / len, y: dy / len });
  }

  return satMinimumOverlap(
    obb.center,
    (axis) => projectOBBRadius(obb, axis),
    circle.center,
    () => radius,
    axes,
  );
}

// 144×144 필드 경계 침투 검사: mtv는 OBB를 필드 안으로 되돌리는 축별 보정량
export function testOBBvsFieldBounds(obb: OBB): CollisionResult {
  const [u, v] = obb.axes;
  const [hx, hy] = obb.halfExtents;
  const extentX = hx * Math.abs(u.x) + hy * Math.abs(v.x);
  const extentY = hx * Math.abs(u.y) + hy * Math.abs(v.y);
  const { x: cx, y: cy } = obb.center;

  let dx = 0;
  if (cx - extentX < 0) dx = extentX - cx;
  else if (cx + extentX > FIELD_SIZE) dx = FIELD_SIZE - (cx + extentX);

  let dy = 0;
  if (cy - extentY < 0) dy = extentY - cy;
  else if (cy + extentY > FIELD_SIZE) dy = FIELD_SIZE - (cy + extentY);

  const depth = Math.hypot(dx, dy);
  if (depth < EPSILON) return noCollision();
  return {
    colliding: true,
    normal: { x: dx / depth, y: dy / depth },
    depth,
    mtv: { x: dx, y: dy },
  };
}

// 로봇 OBB: axes[0] = 헤딩 방향(length), axes[1] = 좌우 방향(width)
export function getRobotOBB(state: RobotState, config: RobotConfig): OBB {
  const heading = finiteOr0(state.heading);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    center: { x: finiteOr0(state.x), y: finiteOr0(state.y) },
    axes: [{ x: cos, y: sin }, { x: -sin, y: cos }],
    halfExtents: [
      Math.max(0, finiteOr0(config.length)) / 2,
      Math.max(0, finiteOr0(config.width)) / 2,
    ],
  };
}

// 원 vs 원: normal은 B → A (A를 밀어내는 방향)
function testCircleVsCircle(a: Circle, b: Circle): CollisionResult {
  const dx = a.center.x - b.center.x;
  const dy = a.center.y - b.center.y;
  const dist = Math.hypot(dx, dy);
  const depth = a.radius + b.radius - dist;
  if (depth <= 0) return noCollision();
  // 중심 일치 시 결정론적 기본 법선 사용
  const normal = dist > EPSILON ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
  return makeCollision(normal, depth);
}

// 원 vs AABB: normal은 AABB → 원 (원을 밀어내는 방향)
function testCircleVsAABB(circle: Circle, box: AABB): CollisionResult {
  const { x: cx, y: cy } = circle.center;
  const px = clamp(cx, box.minX, box.maxX);
  const py = clamp(cy, box.minY, box.maxY);
  const dx = cx - px;
  const dy = cy - py;
  const dist = Math.hypot(dx, dy);

  if (dist > EPSILON) {
    const depth = circle.radius - dist;
    if (depth <= 0) return noCollision();
    return makeCollision({ x: dx / dist, y: dy / dist }, depth);
  }

  // 원 중심이 AABB 내부: 가장 가까운 면 방향으로 밀어냄
  const candidates: { normal: Vector2D; dist: number }[] = [
    { normal: { x: -1, y: 0 }, dist: cx - box.minX },
    { normal: { x: 1, y: 0 }, dist: box.maxX - cx },
    { normal: { x: 0, y: -1 }, dist: cy - box.minY },
    { normal: { x: 0, y: 1 }, dist: box.maxY - cy },
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (c.dist < best.dist) best = c;
  }
  return makeCollision(best.normal, best.dist + circle.radius);
}

// ============================================================
// 3. 로봇 충돌 해결 (위치 MTV + 법선 속도 차단)
// ============================================================

// 법선 방향으로 파고드는 속도 성분(vn < 0)만 제거하여 접선 슬라이딩 보존
function blockNormalVelocity(vx: number, vy: number, normal: Vector2D): { vx: number; vy: number } {
  const vn = vx * normal.x + vy * normal.y;
  if (vn >= 0) return { vx, vy };
  return { vx: vx - vn * normal.x, vy: vy - vn * normal.y };
}

export function resolveRobotEnvironmentCollisions(
  robot: RobotState,
  config: RobotConfig,
): RobotState {
  let x = finiteOr0(robot.x);
  let y = finiteOr0(robot.y);
  let vx = finiteOr0(robot.vx);
  let vy = finiteOr0(robot.vy);

  const applyStatic = (hit: CollisionResult): void => {
    if (!hit.colliding) return;
    x += hit.mtv.x;
    y += hit.mtv.y;
    ({ vx, vy } = blockNormalVelocity(vx, vy, hit.normal));
  };

  for (let iter = 0; iter < ROBOT_ENV_ITERATIONS; iter++) {
    applyStatic(testOBBvsAABB(getRobotOBB({ ...robot, x, y }, config), HIVE_AABB));

    for (const flower of FLOWER_CIRCLES) {
      applyStatic(testOBBvsCircle(getRobotOBB({ ...robot, x, y }, config), flower));
    }

    // 외곽 벽은 최우선 제약이므로 마지막에 적용. 코너 동시 침투를 위해 축별로 속도 차단
    const wall = testOBBvsFieldBounds(getRobotOBB({ ...robot, x, y }, config));
    if (wall.colliding) {
      x += wall.mtv.x;
      y += wall.mtv.y;
      if (wall.mtv.x > 0 && vx < 0) vx = 0;
      else if (wall.mtv.x < 0 && vx > 0) vx = 0;
      if (wall.mtv.y > 0 && vy < 0) vy = 0;
      else if (wall.mtv.y < 0 && vy > 0) vy = 0;
    }
  }

  return { ...robot, x, y, vx, vy };
}

// 비탄성 슬라이딩: normal(r2 → r1) 기준 r1 += 0.5·depth·n, r2 -= 0.5·depth·n
// (명세서의 MTV를 r1 → r2 방향으로 정의하면 r1 -0.5·MTV, r2 +0.5·MTV와 동일)
export function resolveRobotRobotCollision(
  r1: RobotState,
  cfg1: RobotConfig,
  r2: RobotState,
  cfg2: RobotConfig,
): { r1: RobotState; r2: RobotState } {
  const hit = testOBBvsOBB(getRobotOBB(r1, cfg1), getRobotOBB(r2, cfg2));
  if (!hit.colliding) return { r1, r2 };

  const n = hit.normal;
  const half = 0.5 * hit.depth;

  let v1x = finiteOr0(r1.vx);
  let v1y = finiteOr0(r1.vy);
  let v2x = finiteOr0(r2.vx);
  let v2y = finiteOr0(r2.vy);

  // 상대 법선 속도 상쇄 (접근 중일 때만, 접선 성분은 100% 보존)
  const vn = (v1x - v2x) * n.x + (v1y - v2y) * n.y;
  if (vn < 0) {
    v1x -= 0.5 * vn * n.x;
    v1y -= 0.5 * vn * n.y;
    v2x += 0.5 * vn * n.x;
    v2y += 0.5 * vn * n.y;
  }

  return {
    r1: { ...r1, x: finiteOr0(r1.x) + half * n.x, y: finiteOr0(r1.y) + half * n.y, vx: v1x, vy: v1y },
    r2: { ...r2, x: finiteOr0(r2.x) - half * n.x, y: finiteOr0(r2.y) - half * n.y, vx: v2x, vy: v2y },
  };
}

// ============================================================
// 4. 기물 동역학 및 충돌 완화 (PBD)
// ============================================================

// 충돌 판정에 필요한 로봇 상태 + 제원 묶음
export interface RobotBody {
  state: RobotState;
  config: RobotConfig;
}

// ON_FIELD 공의 쿨롱 마찰 감속 및 위치 적분 (불변 배열 반환)
export function stepPieceDynamics(pieces: readonly GamePiece[], dt: number): GamePiece[] {
  const step = Math.max(0, finiteOr0(dt));

  return pieces.map((piece) => {
    if (piece.state !== 'ON_FIELD') return piece;

    const vx = finiteOr0(piece.vx);
    const vy = finiteOr0(piece.vy);
    const speed = Math.hypot(vx, vy);
    const nextSpeed = Math.max(0, speed - PIECE_PHYSICS[piece.type].frictionDecel * step);

    let nextVx = 0;
    let nextVy = 0;
    if (nextSpeed >= STOP_SPEED_THRESHOLD && speed > EPSILON) {
      const scale = nextSpeed / speed;
      nextVx = vx * scale;
      nextVy = vy * scale;
    }

    return {
      ...piece,
      x: finiteOr0(piece.x) + nextVx * step,
      y: finiteOr0(piece.y) + nextVy * step,
      vx: nextVx,
      vy: nextVy,
    };
  });
}

// 정적 장애물 충돌: 공 위치에 100% MTV, 파고드는 법선 속도는 반발 계수로 반사
function reflectPiece(piece: GamePiece, hit: CollisionResult, e: number): void {
  piece.x += hit.mtv.x;
  piece.y += hit.mtv.y;
  const vn = piece.vx * hit.normal.x + piece.vy * hit.normal.y;
  if (vn < 0) {
    piece.vx -= (1 + e) * vn * hit.normal.x;
    piece.vy -= (1 + e) * vn * hit.normal.y;
  }
}

// 공 vs 벽: 반지름 마진으로 Clamp 후 벽을 향하는 속도 성분 반사
function resolvePieceWalls(piece: GamePiece, r: number, e: number): void {
  if (piece.x < r) {
    piece.x = r;
    if (piece.vx < 0) piece.vx = -e * piece.vx;
  } else if (piece.x > FIELD_SIZE - r) {
    piece.x = FIELD_SIZE - r;
    if (piece.vx > 0) piece.vx = -e * piece.vx;
  }
  if (piece.y < r) {
    piece.y = r;
    if (piece.vy < 0) piece.vy = -e * piece.vy;
  } else if (piece.y > FIELD_SIZE - r) {
    piece.y = FIELD_SIZE - r;
    if (piece.vy > 0) piece.vy = -e * piece.vy;
  }
}

export function resolvePiecesCollisions(
  pieces: readonly GamePiece[],
  robots: readonly RobotBody[],
  iterations = 2,
): GamePiece[] {
  // ON_FIELD 공만 복제하여 가변 작업본으로 사용 (입력 배열/객체는 불변 유지)
  const result = pieces.map((p) =>
    p.state === 'ON_FIELD'
      ? { ...p, x: finiteOr0(p.x), y: finiteOr0(p.y), vx: finiteOr0(p.vx), vy: finiteOr0(p.vy) }
      : p,
  );
  const active = result.filter((p) => p.state === 'ON_FIELD');

  // 로봇은 완화 루프 동안 움직이지 않으므로 OBB/속도를 1회만 계산
  const robotBodies = robots.map(({ state, config }) => ({
    obb: getRobotOBB(state, config),
    vx: finiteOr0(state.vx),
    vy: finiteOr0(state.vy),
    omega: finiteOr0(state.omega),
  }));

  const loops = Math.max(0, Math.floor(finiteOr0(iterations)));
  for (let iter = 0; iter < loops; iter++) {
    // (1) 공 vs 공: 질량비 기반 위치 분할 밀어내기
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      const pa = PIECE_PHYSICS[a.type];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const pb = PIECE_PHYSICS[b.type];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const depth = pa.radius + pb.radius - dist;
        if (depth <= 0) continue;

        // normal: A → B, 중심 일치 시 결정론적 기본 법선
        const nx = dist > EPSILON ? dx / dist : 1;
        const ny = dist > EPSILON ? dy / dist : 0;
        const totalMass = pa.mass + pb.mass;
        const shareA = depth * (pb.mass / totalMass);
        const shareB = depth * (pa.mass / totalMass);
        a.x -= shareA * nx;
        a.y -= shareA * ny;
        b.x += shareB * nx;
        b.y += shareB * ny;
      }
    }

    for (const piece of active) {
      const { radius, restitution: e } = PIECE_PHYSICS[piece.type];

      // (2) 공 vs 로봇: Kinematic Pusher (로봇 무한 질량, 공만 보정)
      for (const robot of robotBodies) {
        const hit = testOBBvsCircle(robot.obb, { center: { x: piece.x, y: piece.y }, radius });
        if (!hit.colliding) continue;
        // testOBBvsCircle의 normal은 공 → 로봇이므로 반전하여 로봇 → 공 방향 사용
        const nx = -hit.normal.x;
        const ny = -hit.normal.y;
        piece.x += nx * hit.depth;
        piece.y += ny * hit.depth;
        // 접촉점 유효 선속도: 병진 속도 + 회전 성분 (omega × r)
        const dx = piece.x - robot.obb.center.x;
        const dy = piece.y - robot.obb.center.y;
        const vEffX = robot.vx - robot.omega * dy;
        const vEffY = robot.vy + robot.omega * dx;
        const vn = (piece.vx - vEffX) * nx + (piece.vy - vEffY) * ny;
        if (vn < 0) {
          piece.vx -= (1 + e) * vn * nx;
          piece.vy -= (1 + e) * vn * ny;
        }
      }

      // (3) 공 vs HIVE / FLOWER: 정적 장애물
      const hiveHit = testCircleVsAABB({ center: { x: piece.x, y: piece.y }, radius }, HIVE_AABB);
      if (hiveHit.colliding) reflectPiece(piece, hiveHit, e);

      for (const flower of FLOWER_CIRCLES) {
        const hit = testCircleVsCircle({ center: { x: piece.x, y: piece.y }, radius }, flower);
        if (hit.colliding) reflectPiece(piece, hit, e);
      }

      // (4) 공 vs 외곽 벽: 최우선 경계 제약이므로 마지막에 적용
      resolvePieceWalls(piece, radius, e);
    }
  }

  // 완화 후 잔여 미소 속도 스냅
  for (const piece of active) {
    if (Math.hypot(piece.vx, piece.vy) < STOP_SPEED_THRESHOLD) {
      piece.vx = 0;
      piece.vy = 0;
    }
  }

  return result;
}

// ============================================================
// 5. HIVE 시차 낙하 대기열 생성기 (명세서 2.6)
// ============================================================

const MAX_DROP_REROLLS = 50;

interface DropDistribution {
  meanDistance: number;  // Lip_Y로부터 사출 방향 평균 거리 (inch)
  sigmaDistance: number;
  sigmaLateral: number;  // Lip_X 기준 좌우 표준편차 (inch)
  settleMin: number;     // 초
  settleMax: number;     // 초
}

const DROP_DISTRIBUTION: Record<GamePiece['type'], DropDistribution> = {
  POLLEN: { meanDistance: 24.3, sigmaDistance: 8.3, sigmaLateral: 5.9, settleMin: 1.46, settleMax: 2.1 },
  NECTAR: { meanDistance: 20.2, sigmaDistance: 7.0, sigmaLateral: 5.9, settleMin: 1.36, settleMax: 2.08 },
};

// Box-Muller 변환 기반 정규분포 난수
function sampleNormal(mean: number, sigma: number, rng: () => number): number {
  const u1 = 1 - rng(); // (0, 1] 범위로 변환하여 log(0) 방지
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sigma * finiteOr0(z);
}

function sampleUniform(min: number, max: number, rng: () => number): number {
  return min + (max - min) * rng();
}

// 데드존: 필드 밖, HIVE 내부, 로봇 OBB 내부 (모두 공 반지름 마진 포함)
function isInDeadZone(x: number, y: number, radius: number, robotOBBs: readonly OBB[]): boolean {
  if (x < radius || x > FIELD_SIZE - radius || y < radius || y > FIELD_SIZE - radius) return true;

  if (
    x > HIVE_AABB.minX - radius &&
    x < HIVE_AABB.maxX + radius &&
    y > HIVE_AABB.minY - radius &&
    y < HIVE_AABB.maxY + radius
  ) {
    return true;
  }

  const circle: Circle = { center: { x, y }, radius };
  return robotOBBs.some((obb) => testOBBvsCircle(obb, circle).colliding);
}

// rng는 결정론적 재현을 위해 시드 기반 난수 생성기를 주입할 수 있음 (기본값 Math.random)
export function generateTippedPiecePlan(
  alliance: 'RED' | 'BLUE',
  upwardCell: 'AUDIENCE_CELL' | 'OPPOSITE_CELL',
  piecesInCell: readonly GamePiece[],
  robots: readonly RobotBody[],
  rng: () => number = Math.random,
): PendingDrop[] {
  const lipX = HIVE_CENTER_X[alliance];
  const isAudience = upwardCell === 'AUDIENCE_CELL';
  const lipY = isAudience ? HIVE_AABB.maxY : HIVE_AABB.minY;
  const spillDir = isAudience ? 1.0 : -1.0;

  const robotOBBs = robots.map(({ state, config }) => getRobotOBB(state, config));

  const plan = piecesInCell.map((piece): PendingDrop => {
    const dist = DROP_DISTRIBUTION[piece.type];
    const { radius } = PIECE_PHYSICS[piece.type];

    let targetX = 0;
    let targetY = 0;
    let found = false;
    for (let attempt = 0; attempt < MAX_DROP_REROLLS; attempt++) {
      targetX = lipX + sampleNormal(0, dist.sigmaLateral, rng);
      targetY = lipY + spillDir * sampleNormal(dist.meanDistance, dist.sigmaDistance, rng);
      if (!isInDeadZone(targetX, targetY, radius, robotOBBs)) {
        found = true;
        break;
      }
    }

    // Re-roll 한도 초과: 분포 평균 지점을 필드 안쪽으로 Clamp한 안전 바닥 좌표 지정
    if (!found) {
      targetX = clamp(lipX, radius, FIELD_SIZE - radius);
      targetY = clamp(lipY + spillDir * dist.meanDistance, radius, FIELD_SIZE - radius);
    }

    return {
      pieceId: piece.id,
      type: piece.type,
      targetX,
      targetY,
      settleTime: sampleUniform(dist.settleMin, dist.settleMax, rng),
    };
  });

  // 방출 순서대로 정렬 (settleTime 오름차순)
  return plan.sort((a, b) => a.settleTime - b.settleTime);
}
