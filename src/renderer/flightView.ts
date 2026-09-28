// 비행 공 위치 / 높이 연출 (명세서 3.7 비행 공, 08-6). DOM 비의존 순수 함수
// 명목 구간(발사구 → to): 수평 선형 보간 + 명목 포물선 높이에 끝점을 맞추는 선형 보정
// 충돌 후 구간(segments): 엔진이 기록한 포물선 / 굴러감을 그대로 계산 (08-2)

import { flightSegmentPoint, heightAtDistance } from '../core/ballistics';
import type { Vector3D } from '../core/ballistics';
import { DT } from '../core/simulationEngine';
import type { DeepReadonly, PendingShot } from '../core/types';

type Shot = DeepReadonly<PendingShot>;

/** 프레임 틱에서 발사 후 경과 시간 (초) */
export function shotElapsed(shot: Pick<Shot, 'launchTick'>, tick: number): number {
  return (tick - shot.launchTick) * DT;
}

/**
 * 발사 후 t초의 공 중심 (필드 inch, 높이 z)
 * - t < contactTime (또는 충돌 후 구간 없음): s = t / contactTime, 수평 from → to 선형,
 *   z(s) = z_nom(s·D) + s·(toZ − z_nom(D)) — s = 0에서 발사구, s = 1에서 to와 정확히 일치
 * - 그 뒤: t를 담는 충돌 후 구간 (마지막 구간 끝을 넘으면 착지점)
 */
export function shotPositionAt(shot: Shot, t: number): Vector3D {
  const segs = shot.segments;
  if (t >= shot.contactTime && segs.length > 0) {
    const seg = segs.find((sg) => t <= sg.t1) ?? segs[segs.length - 1];
    return flightSegmentPoint(seg, t);
  }
  const s = shot.contactTime > 0 ? Math.min(1, Math.max(0, t / shot.contactTime)) : 1;
  const D = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
  const traj = { x: shot.fromX, y: shot.fromY, z: shot.fromZ, heading: shot.heading, v0: shot.v0, pitch: shot.pitch };
  const zNom = heightAtDistance(traj, s * D);
  const zEnd = heightAtDistance(traj, D);
  // 비정상 궤적(수평 속도 0 등)으로 포물선이 정의되지 않으면 발사구 → to 높이 선형
  const z = Number.isFinite(zNom) && Number.isFinite(zEnd) ? zNom + s * (shot.toZ - zEnd) : shot.fromZ + s * (shot.toZ - shot.fromZ);
  return { x: shot.fromX + s * (shot.toX - shot.fromX), y: shot.fromY + s * (shot.toY - shot.fromY), z };
}

/** 비행 잔상: 발사 순간부터 t까지 dt 간격 표본 + 현재 위치 (표시 옵션 flightTrail) */
export function shotTrail(shot: Shot, t: number, step = DT): Vector3D[] {
  const points: Vector3D[] = [];
  for (let u = 0; u < t; u += step) points.push(shotPositionAt(shot, u));
  points.push(shotPositionAt(shot, Math.max(0, t)));
  return points;
}

// 높이 연출: 공을 화면 위쪽으로 0.3·z in 띄우고 반지름 × (1 + z / 100), 그림자는 바닥 위치
export const AIRBORNE_OFFSET_PER_INCH = 0.3;
export const AIRBORNE_SCALE_PER_INCH = 1 / 100;

export function airborneDisplay(z: number): { offset: number; scale: number } {
  const h = Math.max(0, z);
  return { offset: AIRBORNE_OFFSET_PER_INCH * h, scale: 1 + AIRBORNE_SCALE_PER_INCH * h };
}
