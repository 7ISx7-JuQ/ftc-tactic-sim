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

// 리프트 상태 (FLOWER 리프트 FSM, 명세서 2.6.3)
const LIFT_STATES: ReadonlySet<RobotState['actionState']> = new Set(['FLOWER_SETUP', 'FLOWER_READY', 'FLOWER_DROPPING', 'FLOWER_LOWERING']);
export function isLiftState(state: RobotState['actionState']): boolean {
  return LIFT_STATES.has(state);
}

/**
 * 리프트 상태 주행 비율 r = min(liftMaxSpeed, maxSpeed) / maxSpeed (12-8, 명세서 3.4): 리프트 상태의 최고 속도 = maxSpeed × r,
 * 최고 각속도 = maxTurnRate × r. 0 = Stationary Lock (v1). 값이 비유한 / 0 이하면 0
 */
export function liftDriveRatio(config: Pick<RobotConfig, 'liftMaxSpeed' | 'maxSpeed'>): number {
  const lift = finiteOr0(config.liftMaxSpeed ?? 0);
  const max = finiteOr0(config.maxSpeed);
  if (!(lift > 0) || !(max > 0)) return 0;
  return Math.min(1, lift / max);
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
  // IDLE / INTAKING(Mobile Intake)은 주행 입력 유지,
  // Stationary Lock 액션(SHOOTING / FLOWER_*)은 구동 목표를 0으로 강제하여 감속 정지 유도.
  // 12-8: 리프트 상태 주행 비율 r > 0이면 리프트 상태(FLOWER_*)는 목표 속도 × r (최고 속도 / 각속도도 × r 이내).
  //       목표만 줄이고 가속도는 그대로라, 빠르게 달리다 리프트를 올리면 가속도 한도로 줄어든다 (순간 감속 없음)
  const canDrive = current.actionState === 'IDLE' || current.actionState === 'INTAKING';
  const liftRatio = !canDrive && isLiftState(current.actionState) ? liftDriveRatio(config) : 0;
  let tVx = 0;
  let tVy = 0;
  let tOmega = 0;
  if (canDrive) {
    tVx = targetVx;
    tVy = targetVy;
    tOmega = targetOmega;
  } else if (liftRatio > 0) {
    const limited = limitLinearVelocity(finiteOr0(targetVx) * liftRatio, finiteOr0(targetVy) * liftRatio, finiteOr0(config.maxSpeed) * liftRatio);
    const turnLimit = Math.max(0, finiteOr0(config.maxTurnRate)) * liftRatio;
    tVx = limited.vx;
    tVy = limited.vy;
    tOmega = clamp(finiteOr0(targetOmega) * liftRatio, -turnLimit, turnLimit);
  }

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
