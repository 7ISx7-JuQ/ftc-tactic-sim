// 시작 자세 편집 모드 기하 (명세서 3.8 필드 편집 모드 SPAWN, 09-11b)
import { describe, expect, it } from 'vitest';
import { HANDLE_GAP, HANDLE_RADIUS, bodyContains, spawnHandlePoint, spawnHitTest } from '../spawnEditLayout';

const SIZE = { length: 18, width: 14 };

describe('시작 자세 편집 기하 (09-11b)', () => {
  it('A. 회전 핸들: 앞 변 가운데에서 앞쪽으로 HANDLE_GAP', () => {
    const h0 = spawnHandlePoint({ x: 20, y: 30, heading: 0 }, SIZE);
    expect(h0).toEqual({ x: 20 + 9 + HANDLE_GAP, y: 30 });
    const h90 = spawnHandlePoint({ x: 20, y: 30, heading: Math.PI / 2 }, SIZE);
    expect(h90.x).toBeCloseTo(20, 12);
    expect(h90.y).toBeCloseTo(30 + 9 + HANDLE_GAP, 12);
  });

  it('B. 몸체 안: 헤딩으로 돌린 직사각형 (앞뒤 = 길이, 좌우 = 폭), 경계 포함', () => {
    const pose = { x: 50, y: 50, heading: Math.PI / 2 }; // 앞 = +y
    expect(bodyContains(pose, SIZE, { x: 50, y: 58.9 })).toBe(true);  // 앞으로 8.9 (길이 반 9 안)
    expect(bodyContains(pose, SIZE, { x: 56.9, y: 50 })).toBe(true);  // 옆으로 6.9 (폭 반 7 안)
    expect(bodyContains(pose, SIZE, { x: 57.5, y: 50 })).toBe(false); // 폭 밖
    expect(bodyContains(pose, SIZE, { x: 50, y: 59 })).toBe(true);    // 경계
    expect(bodyContains({ x: 50, y: 50, heading: 0 }, SIZE, { x: 57.5, y: 50 })).toBe(true); // 돌리지 않으면 길이 방향
    // 비스듬한 헤딩: 앞 8 · 오른쪽 6.5 (안) / 오른쪽 7.5 (밖)
    const tilted = { x: 50, y: 50, heading: 0.3 };
    const at = (f: number, r: number) => ({ x: 50 + f * Math.cos(0.3) - r * Math.sin(0.3), y: 50 + f * Math.sin(0.3) + r * Math.cos(0.3) });
    expect(bodyContains(tilted, SIZE, at(8, 6.5))).toBe(true);
    expect(bodyContains(tilted, SIZE, at(8, -6.5))).toBe(true);
    expect(bodyContains(tilted, SIZE, at(8, 7.5))).toBe(false);
    expect(bodyContains(tilted, SIZE, at(9.5, 0))).toBe(false);
  });

  it('C. 잡기 판정: 핸들 우선(다른 로봇 몸체 위여도), R2 우선, 빈 곳 null', () => {
    const r1 = { pose: { x: 30, y: 30, heading: 0 }, size: SIZE };
    // R2 몸체가 R1 핸들(46, 30) 위에 겹침
    const r2 = { pose: { x: 46, y: 30, heading: Math.PI / 2 }, size: SIZE };
    expect(spawnHitTest({ robot1: r1, robot2: r2 }, { x: 46, y: 30 })).toEqual({ robot: 'robot1', part: 'handle' });
    expect(spawnHitTest({ robot1: r1, robot2: r2 }, { x: 46 + HANDLE_RADIUS + 1.3, y: 30 })).toEqual({ robot: 'robot2', part: 'body' });
    // 두 몸체가 겹친 점 → R2 (위에 그림)
    const r2b = { pose: { x: 35, y: 30, heading: 0 }, size: SIZE };
    expect(spawnHitTest({ robot1: r1, robot2: r2b }, { x: 33, y: 30 })).toEqual({ robot: 'robot2', part: 'body' });
    expect(spawnHitTest({ robot1: r1, robot2: r2b }, { x: 22, y: 30 })).toEqual({ robot: 'robot1', part: 'body' });
    expect(spawnHitTest({ robot1: r1, robot2: r2b }, { x: 100, y: 100 })).toBeNull();
  });
});
