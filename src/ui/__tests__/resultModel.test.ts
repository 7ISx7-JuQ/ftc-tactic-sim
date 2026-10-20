// 결과 팝업 표시 규칙 (명세서 3.8 경기 종료와 결과 팝업, 09-12)
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../app/appController';
import { resultBasisText, resultRows, rpCardProgressText, rpCards } from '../resultModel';

const result = (patch: Partial<MatchResult> = {}, breakdown: Partial<MatchResult['breakdown']> = {}): MatchResult => ({
  total: 0,
  rp: { swarm: false, pollinator1: false, pollinator2: false },
  tips: 0,
  autoTips: 0,
  teleopTips: 0,
  thresholds: { swarmPoints: 16, pollinator1Tips: 4, pollinator2Tips: 7 },
  autoMovementPoints: 6,
  ...patch,
  breakdown: { hive: 0, flower: 0, garden: 0, park: 0, flowers: [], gardenPieceIds: [], parkedRobots: [], ...breakdown },
});

describe('결과 팝업 표시 (09-12)', () => {
  it('A. 항목 근거: HIVE 텔레옵 TIP / 오토 TIP, 소유 FLOWER만 (기물 × 2 + 하단 보너스), GARDEN 인정 수, PARK 로봇 (R1 → R2)', () => {
    const rows = resultRows(
      result(
        { autoTips: 2, teleopTips: 3 },
        {
          hive: 60,
          flower: 14,
          garden: 3,
          park: 10,
          flowers: [
            { id: 'flower1', scoringPieces: 3, owned: true, points: 11 },
            { id: 'flower2', scoringPieces: 4, owned: false, points: 0 },
            { id: 'flower3', scoringPieces: 0, owned: false, points: 0 },
            { id: 'flower4', scoringPieces: 1, owned: true, points: 2 },
          ],
          gardenPieceIds: ['p1', 'p2', 'p3'],
          parkedRobots: ['robot2', 'robot1'],
        },
      ),
    );
    expect(rows).toEqual([
      { key: 'HIVE', points: 60, teleopTips: 3, autoTips: 2 },
      { key: 'FLOWER', points: 14, flowers: [{ number: 1, pieces: 3, bonus: 5 }, { number: 4, pieces: 1, bonus: 0 }] },
      { key: 'GARDEN', points: 3, pieces: 3 },
      { key: 'PARK', points: 10, robots: ['robot1', 'robot2'], autoPoints: 6 },
    ]);
    expect(resultRows(result())[1]).toEqual({ key: 'FLOWER', points: 0, flowers: [] });
    expect(resultRows(result({ autoMovementPoints: 0 }))[3]).toEqual({ key: 'PARK', points: 0, robots: [], autoPoints: 0 });
    // PARK 근거: 오토 이동 점수는 RP에만 (14-3, 0점이면 안내 없음)
    expect(resultBasisText(rows[3], 'en')).toBe('R1 · R2 parked × 5 · auto LEAVE / PARK 6 counts for RP only');
    expect(resultBasisText(rows[3], 'ko')).toBe('R1 · R2 주차 × 5 · 오토 LEAVE · PARK 6점은 RP에만');
    expect(resultBasisText(resultRows(result({ autoMovementPoints: 0 }))[3], 'en')).toBe('No robot parked');
  });

  it('B. RP 카드 (14-3): SWARM = 오토 이동 + TELEOP PARK / 시나리오 기준, POLLINATOR = 오토 + 텔레옵 TIP / 시나리오 기준, 달성은 엔진 판정 그대로', () => {
    const cards = rpCards(result({ tips: 5, rp: { swarm: false, pollinator1: true, pollinator2: false } }, { park: 5 }));
    expect(cards).toEqual([
      { key: 'SWARM', achieved: false, auto: 6, park: 5, current: 11, target: 16 },
      { key: 'POLLINATOR 1', achieved: true, current: 5, target: 4 },
      { key: 'POLLINATOR 2', achieved: false, current: 5, target: 7 },
    ]);
    expect(cards.map(c => rpCardProgressText(c, 'en'))).toEqual(['AUTO 6 + PARK 5 = 11 / 16', 'TIP 5 / 4', 'TIP 5 / 7']);
    // 시나리오 기준값 / 오토 이동 점수를 그대로 읽음
    const custom = rpCards(result({ tips: 3, thresholds: { swarmPoints: 13, pollinator1Tips: 3, pollinator2Tips: 5 }, autoMovementPoints: 8, rp: { swarm: true, pollinator1: true, pollinator2: false } }, { park: 5 }));
    expect(custom.map(c => rpCardProgressText(c, 'en'))).toEqual(['AUTO 8 + PARK 5 = 13 / 13', 'TIP 3 / 3', 'TIP 3 / 5']);
  });
});
