import { describe, expect, it } from 'vitest';
import { HIVE_TUNNEL, PIECE_PHYSICS, getRobotOBB, hiveCellAimPoint } from '../../core/collision';
import { DEFAULT_SPAWN_POSES } from '../../core/simulationEngine';
import { ROOF_MIN_OPACITY, circleBoxOverlapArea, obbBoxOverlapArea, tunnelOccupancy, tunnelRoofOpacity } from '../tunnelRoof';
import type { RoofPiece, RoofRobot } from '../tunnelRoof';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;
const SIZE = { length: 18, width: 18 };
const MID_X = (HIVE_TUNNEL.minX + HIVE_TUNNEL.maxX) / 2;
const MID_Y = (HIVE_TUNNEL.minY + HIVE_TUNNEL.maxY) / 2;
const robot = (x: number, y: number, heading = 0): RoofRobot => ({ pose: { x, y, heading }, size: SIZE });
const piece = (x: number, y: number, state: RoofPiece['state'] = 'ON_FIELD', type: RoofPiece['type'] = 'POLLEN'): RoofPiece => ({ type, state, x, y });

describe('HIVE 터널 지붕 불투명도 (명세서 3.7, 13-1)', () => {
  it('A. 겹친 넓이: OBB ∩ AABB (정확), 원 ∩ AABB (수치 적분)', () => {
    const box = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const obb = (x: number, y: number, heading = 0) => getRobotOBB({ x, y, heading }, { length: 4, width: 2 });
    assert(near(obbBoxOverlapArea(obb(5, 5), box), 8), 'inside -> full area');
    assert(near(obbBoxOverlapArea(obb(10, 5), box), 4), 'centered on the edge -> half');
    assert(near(obbBoxOverlapArea(obb(20, 5), box), 0), 'outside -> 0');
    assert(near(obbBoxOverlapArea(obb(5, 5, Math.PI / 4), box), 8), 'rotated inside -> full area');
    // 45° 정사각형(대각선 반길이 √2·1)이 꼭짓점까지 변에 걸침: 변 x = 10을 중심이 지나면 정확히 절반
    assert(near(obbBoxOverlapArea(getRobotOBB({ x: 10, y: 5, heading: Math.PI / 4 }, { length: 2, width: 2 }), box), 2), 'rotated square on the edge -> half');
    assert(near(obbBoxOverlapArea(obb(10, 10), box), 2), 'on the corner -> quarter');

    const r = 1.5;
    assert(near(circleBoxOverlapArea(5, 5, r, box), Math.PI * r * r), 'circle inside');
    assert(circleBoxOverlapArea(12, 5, r, box) === 0, 'circle outside');
    assert(near(circleBoxOverlapArea(10, 5, r, box), (Math.PI * r * r) / 2, 1e-4), 'circle centered on an edge -> half');
    assert(near(circleBoxOverlapArea(5, 0, r, box), (Math.PI * r * r) / 2, 1e-4), 'circle on the top edge -> half');
    assert(near(circleBoxOverlapArea(10, 10, r, box), (Math.PI * r * r) / 4, 1e-4), 'circle on the corner -> quarter');
    // 현 하나: 중심이 변에서 d 안쪽이면 넓이 = r²·acos(−d / r) + d·√(r² − d²)
    const d = 0.6;
    const expected = r * r * Math.acos(-d / r) + d * Math.sqrt(r * r - d * d);
    assert(near(circleBoxOverlapArea(10 - d, 5, r, box), expected, 1e-3), 'circular segment matches the closed form (numeric integration, relative error ~1e-4)');
  });

  it('B. 점유율 t = 로봇 / 바닥 기물별 겹친 비율의 최댓값, 불투명도 = 1 − t × (1 − 최소)', () => {
    // 빈 터널 = 1 (v1과 같은 불투명). 기본 시작 자세도 터널 밖
    for (const ally of ['RED', 'BLUE'] as const) {
      const spawn = DEFAULT_SPAWN_POSES[ally];
      assert(tunnelRoofOpacity([robot(spawn.robot1.x, spawn.robot1.y, spawn.robot1.heading), robot(spawn.robot2.x, spawn.robot2.y, spawn.robot2.heading)], []) === 1, `${ally} default spawns -> opaque roof`);
    }
    assert(tunnelRoofOpacity([], []) === 1, 'nothing -> 1');
    // 로봇 전체가 터널 안 → 최소 불투명도
    assert(near(tunnelRoofOpacity([robot(MID_X, MID_Y)], []), ROOF_MIN_OPACITY), 'robot fully inside -> ROOF_MIN_OPACITY');
    // 터널 입구(y = 터널 maxY)에 반쯤 → t = 0.5
    const half = robot(MID_X, HIVE_TUNNEL.maxY);
    assert(near(tunnelOccupancy([half], []), 0.5) && near(tunnelRoofOpacity([half], []), 1 - 0.5 * (1 - ROOF_MIN_OPACITY)), 'half inside -> t = 0.5');
    // 최댓값: 반쯤 들어간 로봇 + 완전히 들어간 공 → 1
    assert(near(tunnelOccupancy([half], [piece(MID_X, MID_Y)]), 1), 'max over robots and pieces');
    // 바닥 기물: 입구에 반쯤 걸친 공 → t ≈ 0.5
    assert(near(tunnelOccupancy([], [piece(MID_X, HIVE_TUNNEL.maxY, 'ON_FIELD', 'NECTAR')]), 0.5, 1e-4), 'piece half inside the entrance');
    assert(near(tunnelOccupancy([], [piece(MID_X, MID_Y, 'IN_GARDEN')]), 1), 'IN_GARDEN counts like the floor drawing');
  });

  it('C. 바닥에 그리지 않는 기물(IN_HIVE / CONTROLLED / IN_FLIGHT 등)은 좌표가 터널 안이어도 제외', () => {
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    assert(aim.x > HIVE_TUNNEL.minX && aim.x < HIVE_TUNNEL.maxX, 'IN_HIVE coordinates (aim point projection) lie inside the tunnel');
    for (const state of ['IN_HIVE', 'CONTROLLED', 'IN_FLIGHT', 'IN_FLOWER', 'OUT_OF_BOUNDS'] as const) {
      assert(tunnelOccupancy([], [piece(aim.x, aim.y, state)]) === 0, `${state} excluded`);
    }
  });

  it('D. 연속성: 로봇이 터널로 들어가는 동안 불투명도가 1에서 최소값까지 단조롭게 줄어 깜빡이지 않음', () => {
    const r = PIECE_PHYSICS.POLLEN.radius;
    let prev = 1;
    let maxJump = 0;
    // 관중석 쪽 바깥(몸체가 터널에 닿기 전)에서 터널 한가운데까지 0.1 in씩
    for (let y = HIVE_TUNNEL.maxY + 10; y >= MID_Y; y -= 0.1) {
      const o = tunnelRoofOpacity([robot(MID_X, y)], []);
      assert(o <= prev + 1e-12, `monotonic at y = ${y.toFixed(1)}`);
      maxJump = Math.max(maxJump, prev - o);
      prev = o;
    }
    assert(near(prev, ROOF_MIN_OPACITY) && maxJump < 0.01, `reaches the minimum without jumps (max step ${maxJump.toFixed(4)})`);
    // 공도 같은 방식 (반지름 1.4 in를 0.1 in씩 → 한 번에 크게 변하지 않음)
    let p = 1;
    for (let y = HIVE_TUNNEL.maxY + r; y >= HIVE_TUNNEL.maxY - r; y -= 0.1) {
      const o = tunnelRoofOpacity([], [piece(MID_X, y)]);
      assert(o <= p + 1e-9 && p - o < 0.1, `piece entering: smooth at y = ${y.toFixed(1)}`);
      p = o;
    }
  });
});
