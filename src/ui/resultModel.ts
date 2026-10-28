// 결과 팝업 표시 규칙 (명세서 3.8 경기 종료와 결과 팝업, 09-12 확정): React / DOM 비의존 순수 함수
// 값은 종료 프레임 결과(MatchResult: scoreBreakdown / RP / TIP)만 읽는다 (3.2항 실시간 / 확정 분리).
// - 항목별 득점 + 한 줄 근거: HIVE = 텔레옵 TIP × 20 (오토 TIP은 RP에만), CELL = 종료 시 상향 셀에 남은 NECTAR · POLLEN × 2 (12-13), FLOWER = 소유한 FLOWER별 기물 × 2 (+ 하단 보너스 5),
//   GARDEN = 인정 POLLEN × 1, PARK = 주차 인정 로봇 × 5.
// - RP 카드: 조건 + 지금 값 (14-3: 이 경기 시나리오의 기준값) — SWARM = "AUTO 오토 이동 + PARK TELEOP 주차 = 합 / 기준",
//   POLLINATOR 1 · 2 = "TIP 오토 + 텔레옵 / 기준". PARK 근거에 오토 이동 점수는 RP에만이라는 안내.

import type { MatchResult } from '../app/appController';
import { FLOWER_IDS } from '../core/collision';
import { t } from './i18n';
import type { Language } from './i18n';

const SHORT: Readonly<Record<'robot1' | 'robot2', string>> = { robot1: 'R1', robot2: 'R2' };

export const FLOWER_PIECE_POINTS = 2;   // FLOWER 소유권: slot[1..N] 기물당 (2.6.3)

export type ResultRow =
  | { key: 'HIVE'; points: number; teleopTips: number; autoTips: number }
  | { key: 'CELL'; points: number; nectar: number; pollen: number }
  | { key: 'FLOWER'; points: number; flowers: { number: number; pieces: number; bonus: number }[] }
  | { key: 'GARDEN'; points: number; pieces: number }
  | { key: 'PARK'; points: number; robots: ('robot1' | 'robot2')[]; autoPoints: number };

/** RP 카드: SWARM = 오토 이동 점수(auto) + TELEOP PARK 점수(park) = current / target, POLLINATOR = TIP current / target */
export type RpCardView =
  | { key: 'SWARM'; achieved: boolean; auto: number; park: number; current: number; target: number }
  | { key: 'POLLINATOR 1' | 'POLLINATOR 2'; achieved: boolean; current: number; target: number };

export function resultRows(result: MatchResult): ResultRow[] {
  const b = result.breakdown;
  // 소유한 FLOWER만 (점수 = 기물 × 2 + 보너스), FLOWER 번호 = FLOWER_IDS 순서 + 1
  const flowers = b.flowers
    .filter(f => f.owned && f.points > 0)
    .map(f => ({ number: FLOWER_IDS.indexOf(f.id as (typeof FLOWER_IDS)[number]) + 1, pieces: f.scoringPieces, bonus: f.points - f.scoringPieces * FLOWER_PIECE_POINTS }));
  return [
    { key: 'HIVE', points: b.hive, teleopTips: result.teleopTips, autoTips: result.autoTips },
    { key: 'CELL', points: b.cell, nectar: b.cellPieces.nectar, pollen: b.cellPieces.pollen },
    { key: 'FLOWER', points: b.flower, flowers },
    { key: 'GARDEN', points: b.garden, pieces: b.gardenPieceIds.length },
    { key: 'PARK', points: b.park, robots: [...b.parkedRobots].sort(), autoPoints: result.autoMovementPoints },
  ];
}

export function rpCards(result: MatchResult): RpCardView[] {
  const auto = result.autoMovementPoints;
  const park = result.breakdown.park;
  const th = result.thresholds;
  return [
    { key: 'SWARM', achieved: result.rp.swarm, auto, park, current: auto + park, target: th.swarmPoints },
    { key: 'POLLINATOR 1', achieved: result.rp.pollinator1, current: result.tips, target: th.pollinator1Tips },
    { key: 'POLLINATOR 2', achieved: result.rp.pollinator2, current: result.tips, target: th.pollinator2Tips },
  ];
}

/** RP 카드 진행 글자 (결과 팝업 / 요약 텍스트 공용): "AUTO 6 + PARK 10 = 16 / 16", "TIP 5 / 4" */
export function rpCardProgressText(card: RpCardView, lang: Language): string {
  return card.key === 'SWARM'
    ? t(lang, 'result.rp.swarm', { autoPoints: card.auto, parkPoints: card.park, current: card.current, target: card.target })
    : t(lang, 'result.rp.tips', { current: card.current, target: card.target });
}

/** 항목 근거 한 줄 (여러 조각은 · 로 이음) */
export function resultBasisText(row: ResultRow, lang: Language): string {
  switch (row.key) {
    case 'HIVE': {
      const parts = [t(lang, 'result.basis.hive', { count: row.teleopTips })];
      if (row.autoTips > 0) parts.push(t(lang, 'result.basis.hiveAuto', { count: row.autoTips }));
      return parts.join(' · ');
    }
    case 'CELL': {
      const count = row.nectar + row.pollen;
      return count === 0 ? t(lang, 'result.basis.cellNone') : t(lang, 'result.basis.cell', { count, nectarCount: row.nectar, pollenCount: row.pollen });
    }
    case 'FLOWER':
      if (row.flowers.length === 0) return t(lang, 'result.basis.flowerNone');
      return row.flowers
        .map(f => t(lang, 'result.basis.flower', { number: f.number, pieces: f.pieces }) + (f.bonus > 0 ? t(lang, 'result.basis.flowerBonus', { bonus: f.bonus }) : ''))
        .join(' · ');
    case 'GARDEN':
      return t(lang, 'result.basis.garden', { count: row.pieces });
    case 'PARK': {
      const parts = [row.robots.length === 0 ? t(lang, 'result.basis.parkNone') : t(lang, 'result.basis.park', { robots: row.robots.map(r => SHORT[r]).join(' · ') })];
      if (row.autoPoints > 0) parts.push(t(lang, 'result.basis.parkAuto', { points: row.autoPoints }));
      return parts.join(' · ');
    }
  }
}
