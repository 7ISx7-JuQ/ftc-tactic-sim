import type { RobotConfig, RobotState } from './types';

// 부동소수점 오차 허용 범위
const EPSILON = 1e-9;

const TWO_PI = Math.PI * 2;

// 비유한값(NaN, ±Infinity)을 0으로 치환
function finiteOr0(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 임의의 라디안 각도를 [-PI, PI] 범위로 정규화
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % TWO_PI; // (-2PI, 2PI)
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

// target - current의 최단 회전 경로 각도 차이 ([-PI, PI])
export function angleDifference(target: number, current: number): number {
  return normalizeAngle(target - current);
}

// 속도 벡터 크기가 maxSpeed를 초과하면 방향을 유지한 채 크기만 축소
export function limitLinearVelocity(
  vx: number,
  vy: number,
  maxSpeed: number,
): { vx: number; vy: number } {
  const x = finiteOr0(vx);
  const y = finiteOr0(vy);
  const limit = Math.max(0, finiteOr0(maxSpeed));

  const speed = Math.hypot(x, y);
  if (speed < EPSILON || limit < EPSILON) return { vx: 0, vy: 0 };
  if (speed <= limit) return { vx: x, vy: y };

  const scale = limit / speed;
  return { vx: x * scale, vy: y * scale };
}

// 선형 가속도 제한: 틱당 속도 변화량을 maxAccel * dt 이내로 제한
export function applyLinearSlewRate(
  currentVx: number,
  currentVy: number,
  targetVx: number,
  targetVy: number,
  maxAccel: number,
  maxSpeed: number,
  dt: number,
): { vx: number; vy: number } {
  const cvx = finiteOr0(currentVx);
  const cvy = finiteOr0(currentVy);
  const dvx = finiteOr0(targetVx) - cvx;
  const dvy = finiteOr0(targetVy) - cvy;

  const maxDeltaV = Math.max(0, finiteOr0(maxAccel) * finiteOr0(dt));
  const dvMag = Math.hypot(dvx, dvy);

  let nextVx: number;
  let nextVy: number;
  if (dvMag <= maxDeltaV) {
    nextVx = cvx + dvx;
    nextVy = cvy + dvy;
  } else {
    // dvMag > maxDeltaV >= 0 이므로 dvMag > 0 보장
    const scale = maxDeltaV / dvMag;
    nextVx = cvx + dvx * scale;
    nextVy = cvy + dvy * scale;
  }

  return limitLinearVelocity(nextVx, nextVy, maxSpeed);
}

// 각가속도 제한: 틱당 각속도 변화량을 maxAngularAccel * dt 이내로 제한
export function applyAngularSlewRate(
  currentOmega: number,
  targetOmega: number,
  maxAngularAccel: number,
  maxTurnRate: number,
  dt: number,
): number {
  const current = finiteOr0(currentOmega);
  const maxDeltaOmega = Math.max(0, finiteOr0(maxAngularAccel) * finiteOr0(dt));
  const delta = clamp(finiteOr0(targetOmega) - current, -maxDeltaOmega, maxDeltaOmega);

  const limit = Math.max(0, finiteOr0(maxTurnRate));
  const next = clamp(current + delta, -limit, limit);
  return Math.abs(next) < EPSILON ? 0 : next;
}

// 한 틱 동안의 로봇 기구학 갱신 (오일러 적분, 불변 객체 반환)
export function stepRobotKinematics(
  current: RobotState,
  targetVx: number,
  targetVy: number,
  targetOmega: number,
  config: RobotConfig,
  dt: number,
): RobotState {
  // 행동 수행 중에는 구동 목표를 0으로 강제하여 감속 정지 유도
  const isIdle = current.actionState === 'IDLE';
  const tVx = isIdle ? targetVx : 0;
  const tVy = isIdle ? targetVy : 0;
  const tOmega = isIdle ? targetOmega : 0;

  const step = Math.max(0, finiteOr0(dt));

  const { vx: nextVx, vy: nextVy } = applyLinearSlewRate(
    current.vx,
    current.vy,
    tVx,
    tVy,
    config.maxLinearAccel,
    config.maxSpeed,
    step,
  );
  const nextOmega = applyAngularSlewRate(
    current.omega,
    tOmega,
    config.maxAngularAccel,
    config.maxTurnRate,
    step,
  );

  return {
    ...current,
    x: finiteOr0(current.x) + nextVx * step,
    y: finiteOr0(current.y) + nextVy * step,
    vx: nextVx,
    vy: nextVy,
    omega: nextOmega,
    heading: normalizeAngle(current.heading + nextOmega * step),
  };
}
