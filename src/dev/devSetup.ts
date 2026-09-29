// 개발 하네스 설정 (명세서 3.7 개발 하네스, 08-7, 사용자 비공개)
// 09-6d: 고정 설정 본체는 정식 코드 src/app/defaultSetup.ts로 옮기고, 하네스는 같은 설정을 다시 내보내 쓴다 (09-12에서 하네스 삭제).

import { SimulationEngine } from '../core/simulationEngine';
import type { MatchSetup } from '../app/appController';
import { DEFAULT_ROBOT_CONFIGS, SIMPLE_HIT_PROBABILITY, createDefaultSetup, createSimpleResolver } from '../app/defaultSetup';

export const DEV_ROBOT_CONFIGS = DEFAULT_ROBOT_CONFIGS;
export const DEV_HIT_PROBABILITY = SIMPLE_HIT_PROBABILITY;
export const createDevResolver = createSimpleResolver;

/** 하네스 경기 설정 (AppController 주입용) */
export function createDevSetup(alliance: 'RED' | 'BLUE'): MatchSetup {
  return createDefaultSetup(alliance);
}

/** 하네스 설정의 엔진 */
export function createDevEngine(alliance: 'RED' | 'BLUE'): SimulationEngine {
  const { r1Config, r2Config, shotResolver, scenario } = createDevSetup(alliance);
  return new SimulationEngine(r1Config, r2Config, shotResolver, alliance, scenario);
}
