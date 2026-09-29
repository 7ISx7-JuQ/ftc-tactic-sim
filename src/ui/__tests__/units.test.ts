import { describe, expect, it } from 'vitest';
import { HIVE_RIM_Z } from '../../core/collision';
import { DT, ENDGAME_START_TICK, MATCH_TICKS } from '../../core/simulationEngine';
import {
  CM_PER_INCH,
  DISPLAY_DECIMALS,
  formatMatchTime,
  formatNumber,
  formatQuantity,
  formatQuantityValue,
  fromDisplay,
  isEndgameTime,
  parseNumberInput,
  toDisplay,
  toLengthUnit,
  unitLabel,
} from '../units';
import type { QuantityKind } from '../units';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const near = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol;
const deg = (d: number) => (d * Math.PI) / 180;

describe('화면 단위 변환 / 표시 (09-6a)', () => {
  it('A. 종류별 변환 (엔진 ↔ 화면)', () => {
    assert(toDisplay('length', 18) === 18 && near(toDisplay('length', 18, 'cm'), 45.72) && CM_PER_INCH === 2.54, 'length in / cm');
    assert(near(toDisplay('speed', 60, 'cm'), 152.4) && near(toDisplay('accel', 120, 'cm'), 304.8) && toDisplay('coordinate', 60.5) === 60.5, 'speed / accel / coordinate scale with the length unit');
    assert(toDisplay('launchHeight', 14) === HIVE_RIM_Z - 14 && fromDisplay('launchHeight', 39.5) === 14, 'launch height h <-> dz = 53.5 - h');
    assert(near(fromDisplay('launchHeight', (HIVE_RIM_Z - 14) * 2.54, 'cm'), 14), 'launch height typed in cm');
    assert(near(toDisplay('angle', deg(3)), 3) && fromDisplay('angle', 3) === deg(3) && near(toDisplay('angle', Math.PI / 3), 60), 'angles in degrees');
    assert(toDisplay('angularRate', 4) === 4 && fromDisplay('angularAccel', 10) === 10, 'angular rate / accel stay rad/s (RoadRunner / Pedro Pathing)');
    assert(toDisplay('timeMs', 250) === 250 && fromDisplay('timeMs', 300) === 300, 'time stays ms');
    assert(toDisplay('percent', 0.02) === 2 && fromDisplay('percent', 2) === 0.02, 'noise percent <-> ratio');
    // 헤딩: (−180, 180], 0° = +x, 양수 = 시계 방향 (엔진 부호 그대로)
    assert(near(toDisplay('heading', Math.PI), 180) && near(toDisplay('heading', -Math.PI), 180) && near(toDisplay('heading', deg(190)), -170) && near(toDisplay('heading', deg(-90)), -90), 'heading display range');
    assert(near(fromDisplay('heading', 270), deg(-90)) && near(fromDisplay('heading', 90), Math.PI / 2), 'heading input normalized');
  });

  it('B. 입력 한 번 변환 / 길이 1e-6 in 반올림 / 왕복', () => {
    // 표시된 cm 값을 그대로 다시 입력해도 원래 inch 값과 정확히 같음 (LUT 재생성 방지)
    // (cm 값이 소수 2자리 안에 들어오는 경우. 18 → 45.72, 17.5 → 44.45, 14 → 35.56, 60.5 → 153.67, 6 → 15.24, 0.5 → 1.27)
    for (const inch of [18, 17.5, 14, 60.5, 6, 0.5]) {
      const cmText = formatQuantityValue('length', inch, 'cm');
      assert(fromDisplay('length', Number(cmText), 'cm') === inch, `${inch} in -> "${cmText}" cm -> exactly ${inch} in`);
    }
    for (const inch of [0.25, 133.75, 18.37, 3.14159]) {
      assert(fromDisplay('length', toDisplay('length', inch, 'cm'), 'cm') === inch, `${inch} in unrounded round trip`);
    }
    // 표시 반올림으로 정보가 줄어드는 경우 (0.25 in = 0.635 cm → "0.64"): 표시값을 다시 넣으면 값이 바뀐다
    // → 폼은 사용자가 고친 칸만 변환해 저장해야 한다 (units.ts 머리말 규칙)
    assert(formatQuantityValue('length', 0.25, 'cm') === '0.64' && fromDisplay('length', 0.64, 'cm') === 0.251969, 'lossy display: re-entering the rounded cm text changes the value');
    assert(fromDisplay('length', 45.72, 'cm') === 18, '45.72 cm -> 18 in (not 18.000000000000004)');
    assert(fromDisplay('length', 10, 'cm') === 3.937008, 'arbitrary cm snapped to 1e-6 in');
    assert(fromDisplay('coordinate', 0.0000001) === 0 && !Object.is(fromDisplay('length', -0.0000001), -0), 'tiny values snap to 0 (no -0)');
    // in / cm 토글은 표시만 바꿈: 같은 엔진 값에서 몇 번을 오가도 표시 문자열이 같다
    const shown = [0, 1, 2, 3].map(i => formatQuantity('length', 18.37, i % 2 === 0 ? 'in' : 'cm'));
    assert(shown[0] === shown[2] && shown[1] === shown[3] && shown[0] === '18.37 in' && shown[1] === '46.66 cm', `toggle display only (${shown.join(' / ')})`);
  });

  it('C. 표시 형식 / 단위 기호 / 소수 자리', () => {
    const expected: Record<QuantityKind, number> = { length: 2, coordinate: 1, launchHeight: 2, speed: 2, accel: 2, angle: 1, heading: 1, angularRate: 2, angularAccel: 2, timeMs: 0, percent: 1 };
    assert(JSON.stringify(DISPLAY_DECIMALS) === JSON.stringify(expected), 'decimals: length 2, coordinate 1, ° 1, rad 2, ms 0, % 1');
    const cases: [QuantityKind, number, 'in' | 'cm', string][] = [
      ['length', 18, 'in', '18.00 in'],
      ['length', 18, 'cm', '45.72 cm'],
      ['coordinate', 60.5, 'in', '60.5 in'],
      ['launchHeight', 14, 'in', '39.50 in'],
      ['speed', 60, 'cm', '152.40 cm/s'],
      ['accel', 120, 'in', '120.00 in/s²'],
      ['angle', deg(3), 'in', '3.0°'],
      ['heading', Math.PI, 'in', '180.0°'],
      ['angularRate', 4, 'in', '4.00 rad/s'],
      ['angularAccel', 10, 'cm', '10.00 rad/s²'],
      ['timeMs', 250, 'in', '250 ms'],
      ['percent', 0.02, 'in', '2.0%'],
    ];
    for (const [kind, value, unit, text] of cases) assert(formatQuantity(kind, value, unit) === text, `${kind} ${value} ${unit} -> "${formatQuantity(kind, value, unit)}"`);
    assert(unitLabel('speed', 'cm') === 'cm/s' && unitLabel('accel') === 'in/s²' && unitLabel('heading') === '°', 'unit labels');
    assert(formatNumber(-0, 2) === '0.00' && formatNumber(-0.004, 2) === '0.00' && formatNumber(-0.006, 2) === '-0.01', 'no negative zero');
    assert(formatNumber(NaN, 1) === '—' && formatNumber(Infinity, 0) === '—' && formatNumber(2.5, 0) === '3' && formatNumber(12.345, 1.9) === '12.3', 'non-finite / decimals');
  });

  it('D. 입력 문자열 해석', () => {
    const ok: [string, number][] = [['12', 12], [' 12.5 ', 12.5], ['12,5', 12.5], ['-3', -3], ['+4', 4], ['.5', 0.5], ['5.', 5], ['1e3', 1000], ['2.5E-1', 0.25]];
    for (const [text, value] of ok) assert(parseNumberInput(text) === value, `"${text}" -> ${value}`);
    for (const text of ['', '  ', 'abc', '12..5', '1,000.5', '1.2.3', 'Infinity', 'NaN', '1e', '--1', '12 in']) assert(parseNumberInput(text) === null, `"${text}" -> null`);
    assert(toLengthUnit('cm') === 'cm' && toLengthUnit('mm') === 'in' && toLengthUnit(null) === 'in', 'stored length unit validation');
  });

  it('E. 경기 타이머 표시 / ENDGAME', () => {
    const cases: [number, string][] = [
      [120, '2:00'], [119.98, '2:00'], [119, '1:59'], [60, '1:00'], [59.98, '1:00'], [10.02, '0:11'],
      [10, '0:10.0'], [9.98, '0:10.0'], [9.9, '0:09.9'], [0.02, '0:00.1'], [0, '0:00.0'], [-1, '0:00.0'], [NaN, '0:00.0'],
    ];
    for (const [sec, text] of cases) assert(formatMatchTime(sec) === text, `${sec} s -> "${formatMatchTime(sec)}" (expected ${text})`);
    // 실제 틱 시간(부동소수점 포함)으로 전체 경기: 표시가 거꾸로 가지 않고 모든 초 / 10초 이하 모든 0.1초가 나타남
    const toSec = (s: string) => {
      const [m, rest] = s.split(':');
      return Number(m) * 60 + Number(rest);
    };
    const shown = new Set<string>();
    let prev = Infinity;
    let monotonic = true;
    for (let tick = 0; tick <= MATCH_TICKS; tick++) {
      const text = formatMatchTime((MATCH_TICKS - tick) * DT);
      monotonic &&= toSec(text) <= prev;
      prev = toSec(text);
      shown.add(text);
    }
    const everySecond = Array.from({ length: 110 }, (_, i) => formatMatchTime(11 + i)).every(s => shown.has(s));
    const everyTenth = Array.from({ length: 101 }, (_, i) => `0:${String(Math.floor(i / 10)).padStart(2, '0')}.${i % 10}`).every(s => shown.has(s));
    assert(monotonic && everySecond && everyTenth && shown.has('2:00') && shown.has('0:11'), 'full match: never goes backwards, no skipped second / tenth');
    // 정확히 정수 초인 틱(50틱마다)은 부동소수점 오차(예: 57.00000000000001)가 있어도 그 초로 표시
    let exactSeconds = true;
    for (let tick = 0; tick <= MATCH_TICKS - 11 * 50; tick += 50) {
      const n = (MATCH_TICKS - tick) / 50;
      exactSeconds &&= formatMatchTime((MATCH_TICKS - tick) * DT) === `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    }
    assert(exactSeconds && formatMatchTime(57.00000000000001) === '0:57', 'integer-second ticks show that second despite float error');
    // ENDGAME: 엔진 전환 틱(남은 60초)부터
    assert(isEndgameTime((MATCH_TICKS - ENDGAME_START_TICK) * DT) && !isEndgameTime((MATCH_TICKS - ENDGAME_START_TICK + 1) * DT), 'ENDGAME color from the engine ENDGAME tick');
  });
});
