import { describe, expect, it } from 'vitest';
import { FIELD_SIZE } from '../../core/collision';
import {
  PX_PER_INCH,
  SCENE_HEIGHT_PX,
  SCENE_WIDTH_PX,
  SIDE_PANEL_PX,
  VIEWPORT_CENTER_PX,
  VIEWPORT_INCH,
  VIEWPORT_PX,
  VIEW_ANIMATION_MS,
  ViewAnimator,
  canvasToField,
  cssToCanvas,
  easeInOutCubic,
  fieldPxMatrix,
  fieldToCanvas,
  fitScale,
  labelCenter,
  restingView,
  screenUpInField,
  viewAngle,
} from '../viewTransform';
import type { ViewTransform } from '../viewTransform';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe('보기 변환 (명세서 3.7, 08-4)', () => {
  it('A. 캔버스 레이아웃', () => {
    assert(PX_PER_INCH === 5 && VIEWPORT_INCH === FIELD_SIZE + 16 && VIEWPORT_PX === 800, 'viewport = field 144 in + 8 in margins = 160 in = 800 px');
    assert(SIDE_PANEL_PX === 200 && SCENE_WIDTH_PX === 1200 && SCENE_HEIGHT_PX === 800, 'scene 1200 × 800 (R1 / R2 side panels 200 px each)');
    assert(VIEWPORT_CENTER_PX.x === 600 && VIEWPORT_CENTER_PX.y === 400, 'viewport centered between the panels');
    const aud = restingView('AUDIENCE', 'RED');
    const tl = fieldToCanvas(aud, 0, 0);
    const br = fieldToCanvas(aud, FIELD_SIZE, FIELD_SIZE);
    assert(near(tl.x, 240) && near(tl.y, 40) && near(br.x, 960) && near(br.y, 760), 'AUDIENCE: field (0,0)-(144,144) at 240..960 × 40..760 (identity, 5 px/in)');
  });

  it('B. 보기 방향 (DRIVER: 아군 벽이 화면 아래, 회전만)', () => {
    assert(viewAngle('AUDIENCE', 'RED') === 0 && viewAngle('AUDIENCE', 'BLUE') === 0, 'AUDIENCE = 0 for both alliances');
    assert(viewAngle('DRIVER', 'RED') === -Math.PI / 2 && viewAngle('DRIVER', 'BLUE') === Math.PI / 2, 'DRIVER: RED −90°, BLUE +90°');
    const dir = (v: ViewTransform, dx: number, dy: number) => {
      const a = fieldToCanvas(v, 72, 72);
      const b = fieldToCanvas(v, 72 + dx, 72 + dy);
      return { x: Math.round((b.x - a.x) / PX_PER_INCH), y: Math.round((b.y - a.y) / PX_PER_INCH) };
    };
    const red = restingView('DRIVER', 'RED');
    // RED 드라이버: x = 0 벽에서 +x를 봄 → +x 화면 위, 드라이버 오른쪽 +y 화면 오른쪽 (FIELD 조작: 스틱 위 = 화면 위)
    assert(dir(red, 1, 0).x === 0 && dir(red, 1, 0).y === -1 && dir(red, 0, 1).x === 1 && dir(red, 0, 1).y === 0, 'RED driver: +x up, +y right');
    assert(near(fieldToCanvas(red, 0, 72).y, 760) && near(red.scale, 1), 'RED driver: RED wall (x = 0) at the bottom, full scale');
    const blue = restingView('DRIVER', 'BLUE');
    assert(dir(blue, -1, 0).y === -1 && dir(blue, -1, 0).x === 0 && dir(blue, 0, -1).x === 1 && dir(blue, 0, -1).y === 0, 'BLUE driver: −x up, −y right');
    assert(near(fieldToCanvas(blue, 144, 72).y, 760), 'BLUE driver: BLUE wall (x = 144) at the bottom');
    // 회전만 (뒤집기 없음): +x → +y가 화면에서도 시계 방향 90° 관계 유지
    for (const v of [red, blue]) {
      const ex = dir(v, 1, 0);
      const ey = dir(v, 0, 1);
      assert(ex.x * ey.y - ex.y * ey.x === 1, 'orientation preserved (rotation, no mirror)');
    }
    // 화면 위쪽에 해당하는 필드 방향
    assert(near(screenUpInField(red).x, 1) && near(screenUpInField(red).y, 0, 1e-12) && near(screenUpInField(restingView('AUDIENCE', 'RED')).y, -1), 'screen-up vector in field coordinates');
  });

  it('C. 역변환 / CSS 변환 / 행렬', () => {
    const views: ViewTransform[] = [restingView('AUDIENCE', 'RED'), restingView('DRIVER', 'RED'), restingView('DRIVER', 'BLUE'), { angle: 0.7, scale: fitScale(0.7) }];
    for (const v of views) {
      for (const [x, y] of [[0, 0], [144, 0], [37.3, 101.9], [72, 72]]) {
        const c = fieldToCanvas(v, x, y);
        const f = canvasToField(v, c.x, c.y);
        assert(near(f.x, x, 1e-9) && near(f.y, y, 1e-9), `round trip (${x}, ${y}) at angle ${v.angle.toFixed(2)}`);
        // 캔버스 행렬(필드 px 공간)이 같은 변환인지: p' = [a c e; b d f]·(x·5, y·5, 1)
        const [a, b, cc, d, e, ff] = fieldPxMatrix(v, 2);
        const px = x * PX_PER_INCH;
        const py = y * PX_PER_INCH;
        assert(near(a * px + cc * py + e, 2 * c.x, 1e-9) && near(b * px + d * py + ff, 2 * c.y, 1e-9), 'fieldPxMatrix × dpr matches fieldToCanvas');
      }
    }
    // 라벨: 구조물 가장자리에서 화면상 바깥 방향으로 글자 상자 반폭 / 반높이 + 틈만큼
    const aud = restingView('AUDIENCE', 'RED');
    const red = restingView('DRIVER', 'RED');
    const edge = { x: 11.5, y: 142 }; // RED GARDEN 안쪽 가장자리, 바깥 = −y
    const la = labelCenter(aud, edge, { x: 0, y: -1 }, 70, 10, 3);
    const ea = fieldToCanvas(aud, edge.x, edge.y);
    assert(near(la.x, ea.x) && near(la.y, ea.y - 8), 'AUDIENCE: pushed up by half height + gap (text runs along the strip)');
    const lr = labelCenter(red, edge, { x: 0, y: -1 }, 70, 10, 3);
    const er = fieldToCanvas(red, edge.x, edge.y);
    assert(near(lr.x, er.x - 38) && near(lr.y, er.y), 'RED DRIVER: strip is vertical on screen -> pushed left by half width + gap (no overlap)');
    const half = cssToCanvas(300, 200, 600, 400);
    assert(near(half.x, 600) && near(half.y, 400), 'CSS px scaled back to logical px (half-size canvas)');
  });

  it('D. 전환 애니메이션 (700 ms easeInOutCubic, 회전 중 배율)', () => {
    assert(easeInOutCubic(0) === 0 && easeInOutCubic(1) === 1 && near(easeInOutCubic(0.5), 0.5) && easeInOutCubic(0.25) < 0.25 && easeInOutCubic(-1) === 0 && easeInOutCubic(2) === 1, 'easing endpoints / symmetric / clamped');
    assert(near(fitScale(0), 1) && near(fitScale(Math.PI / 2), 1) && near(fitScale(-Math.PI / 2), 1) && near(fitScale(Math.PI / 4), Math.SQRT1_2), 'fit scale 1 at 0 / ±90°, 0.71 at 45°');
    // 회전 중 뷰포트 정사각형(필드 + 여백)의 네 꼭짓점이 항상 뷰포트 안
    const inset = -8; // 여백 포함 정사각형 꼭짓점 (필드 좌표 −8 ~ 152)
    for (let deg = -180; deg <= 180; deg += 5) {
      const angle = (deg * Math.PI) / 180;
      const v = { angle, scale: fitScale(angle) };
      for (const [x, y] of [[inset, inset], [FIELD_SIZE - inset, inset], [inset, FIELD_SIZE - inset], [FIELD_SIZE - inset, FIELD_SIZE - inset]]) {
        const c = fieldToCanvas(v, x, y);
        assert(c.x >= SIDE_PANEL_PX - 1e-9 && c.x <= SIDE_PANEL_PX + VIEWPORT_PX + 1e-9 && c.y >= -1e-9 && c.y <= VIEWPORT_PX + 1e-9, `corner (${x}, ${y}) inside the viewport at ${deg}°`);
      }
    }
    const anim = new ViewAnimator(0);
    assert(anim.sample(0).done && anim.sample(0).angle === 0, 'idle animator rests at the initial angle');
    const target = viewAngle('DRIVER', 'RED');
    anim.start(target, 1000);
    const mid = anim.sample(1000 + VIEW_ANIMATION_MS / 2);
    assert(!anim.sample(1000).done && near(anim.sample(1000).angle, 0), 'starts from the current angle');
    assert(!mid.done && near(mid.angle, target / 2) && near(mid.scale, Math.SQRT1_2), 'halfway: −45°, scale 0.71');
    const end = anim.sample(1000 + VIEW_ANIMATION_MS);
    assert(end.done && end.angle === target && near(end.scale, 1), 'ends exactly at the DRIVER angle, full scale');
    // 도중에 되돌리면 현재 표시 각도에서 다시 시작 (튀지 않음)
    anim.start(0, 2000);
    const back = anim.sample(2000 + VIEW_ANIMATION_MS / 4);
    anim.start(target, 2000 + VIEW_ANIMATION_MS / 4);
    assert(near(anim.sample(2000 + VIEW_ANIMATION_MS / 4).angle, back.angle), 'reversing mid-animation continues from the shown angle');
    anim.jump(0);
    assert(anim.sample(0).done && anim.sample(0).angle === 0, 'jump: no animation');
  });
});
