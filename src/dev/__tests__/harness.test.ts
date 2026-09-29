import { describe, expect, it } from 'vitest';
import { bearingTo } from '../../core/ballistics';
import { hiveCellAimPoint } from '../../core/collision';
import { DEV_HIT_PROBABILITY, DEV_ROBOT_CONFIGS, createDevEngine, createDevResolver, createDevSetup } from '../devSetup';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

describe('개발 하네스 설정 (명세서 3.7, 08-7 / 09-6c: 흐름 테스트는 src/app/__tests__/appController.test.ts)', () => {
  it('A. 하네스 설정 (고정 제원, 간이 판정 함수)', () => {
    const { robot1, robot2 } = DEV_ROBOT_CONFIGS;
    const resolver = createDevResolver(robot1, robot2);
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const onAim = bearingTo(60, 130, aim.x, aim.y);
    assert(resolver('robot1', 'POLLEN', 60, 130, onAim, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, 'aimed (fixed shooter) -> 0.6');
    assert(resolver('robot1', 'NECTAR', 60, 130, onAim + (2.5 * Math.PI) / 180, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, 'within ±3° -> 0.6');
    assert(resolver('robot2', 'POLLEN', 60, 130, onAim + (5 * Math.PI) / 180, 'RED', 'AUDIENCE_CELL') === 0, 'off aim (5°) -> 0');
    const turret = createDevResolver({ ...robot1, turretType: 'TURRET', turretRange: [-Math.PI, Math.PI] }, robot2);
    assert(turret('robot1', 'POLLEN', 60, 130, onAim + 2, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, '360° turret aims anywhere -> 0.6');
    const e = createDevEngine('BLUE');
    assert(e.field.allianceColor === 'BLUE' && e.r1Config.name === 'R1' && e.currentTick === 0, 'engine: default scenario of the chosen alliance');
    const s = createDevSetup('RED');
    assert(s.scenario.allianceColor === 'RED' && s.r1Config === robot1 && s.r2Config === robot2 && s.shotResolver('robot1', 'POLLEN', 60, 130, onAim, 'RED', 'AUDIENCE_CELL') === DEV_HIT_PROBABILITY, 'AppController setup: fixed configs + simple resolver + default scenario');
  });
});
