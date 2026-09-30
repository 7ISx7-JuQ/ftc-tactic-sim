// 결과 팝업 표시 규칙 (명세서 3.8 경기 종료와 결과 팝업, 09-12 확정): React / DOM 비의존 순수 함수
// 값은 종료 프레임 결과(MatchResult: scoreBreakdown / RP / TIP)만 읽는다 (3.2항 실시간 / 확정 분리).
// - 항목별 득점 + 한 줄 근거: HIVE = 텔레옵 TIP × 20 (오토 TIP은 RP에만), FLOWER = 소유한 FLOWER별 기물 × 2 (+ 하단 보너스 5),
//   GARDEN = 인정 POLLEN × 1, PARK = 주차 인정 로봇 × 5.
// - RP 카드: 조건 + 지금 값 (SWARM = PARK 점수 / 10, POLLINATOR 1 · 2 = 오토 + 텔레옵 TIP / 4 · 7).

import type { MatchResult } from '../app/appController';
import { FLOWER_IDS } from '../core/collision';
import { t } from './i18n';
import type { Language } from './i18n';
import { POLLINATOR_1_TIPS, POLLINATOR_2_TIPS } from './mainScreenModel';

const SHORT: Readonly<Record<'robot1' | 'robot2', string>> = { robot1: 'R1', robot2: 'R2' };

export const FLOWER_PIECE_POINTS = 2;   // FLOWER 소유권: slot[1..N] 기물당 (2.6.3)
export const SWARM_PARK_POINTS = 10;    // SWARM RP: 두 로봇 주차 = PARK 10점 (2.6.5)

export type ResultRow =
  | { key: 'HIVE'; points: number; teleopTips: number; autoTips: number }
  | { key: 'FLOWER'; points: number; flowers: { number: number; pieces: number; bonus: number }[] }
  | { key: 'GARDEN'; points: number; pieces: number }
  | { key: 'PARK'; points: number; robots: ('robot1' | 'robot2')[] };

export interface RpCardView {
  key: 'SWARM' | 'POLLINATOR 1' | 'POLLINATOR 2';
  achieved: boolean;
  unit: 'PARK' | 'TIP';
  current: number;
  target: number;
}

export function resultRows(result: MatchResult): ResultRow[] {
  const b = result.breakdown;
  // 소유한 FLOWER만 (점수 = 기물 × 2 + 보너스), FLOWER 번호 = FLOWER_IDS 순서 + 1
  const flowers = b.flowers
    .filter(f => f.owned && f.points > 0)
    .map(f => ({ number: FLOWER_IDS.indexOf(f.id as (typeof FLOWER_IDS)[number]) + 1, pieces: f.scoringPieces, bonus: f.points - f.scoringPieces * FLOWER_PIECE_POINTS }));
  return [
    { key: 'HIVE', points: b.hive, teleopTips: result.teleopTips, autoTips: result.autoTips },
    { key: 'FLOWER', points: b.flower, flowers },
    { key: 'GARDEN', points: b.garden, pieces: b.gardenPieceIds.length },
    { key: 'PARK', points: b.park, robots: [...b.parkedRobots].sort() },
  ];
}

export function rpCards(result: MatchResult): RpCardView[] {
  return [
    { key: 'SWARM', achieved: result.rp.swarm, unit: 'PARK', current: result.breakdown.park, target: SWARM_PARK_POINTS },
    { key: 'POLLINATOR 1', achieved: result.rp.pollinator1, unit: 'TIP', current: result.tips, target: POLLINATOR_1_TIPS },
    { key: 'POLLINATOR 2', achieved: result.rp.pollinator2, unit: 'TIP', current: result.tips, target: POLLINATOR_2_TIPS },
  ];
}

/** 항목 근거 한 줄 (여러 조각은 · 로 이음) */
export function resultBasisText(row: ResultRow, lang: Language): string {
  switch (row.key) {
    case 'HIVE': {
      const parts = [t(lang, 'result.basis.hive', { count: row.teleopTips })];
      if (row.autoTips > 0) parts.push(t(lang, 'result.basis.hiveAuto', { count: row.autoTips }));
      return parts.join(' · ');
    }
    case 'FLOWER':
      if (row.flowers.length === 0) return t(lang, 'result.basis.flowerNone');
      return row.flowers
        .map(f => t(lang, 'result.basis.flower', { number: f.number, pieces: f.pieces }) + (f.bonus > 0 ? t(lang, 'result.basis.flowerBonus', { bonus: f.bonus }) : ''))
        .join(' · ');
    case 'GARDEN':
      return t(lang, 'result.basis.garden', { count: row.pieces });
    case 'PARK':
      return row.robots.length === 0 ? t(lang, 'result.basis.parkNone') : t(lang, 'result.basis.park', { robots: row.robots.map(r => SHORT[r]).join(' · ') });
  }
}
