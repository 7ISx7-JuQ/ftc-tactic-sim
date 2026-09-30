// 결과 팝업 표시 규칙 (명세서 3.8 경기 종료와 결과 팝업, 09-12)
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../app/appController';
import { resultRows, rpCards } from '../resultModel';

const result = (patch: Partial<MatchResult> = {}, breakdown: Partial<MatchResult['breakdown']> = {}): MatchResult => ({
  total: 0,
  rp: { swarm: false, pollinator1: false, pollinator2: false },
  tips: 0,
  autoTips: 0,
  teleopTips: 0,
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
      { key: 'PARK', points: 10, robots: ['robot1', 'robot2'] },
    ]);
    expect(resultRows(result())[1]).toEqual({ key: 'FLOWER', points: 0, flowers: [] });
    expect(resultRows(result())[3]).toEqual({ key: 'PARK', points: 0, robots: [] });
  });

  it('B. RP 카드: SWARM = PARK 점수 / 10, POLLINATOR = 오토 + 텔레옵 TIP / 4 · 7, 달성은 엔진 판정 그대로', () => {
    const cards = rpCards(result({ tips: 5, rp: { swarm: false, pollinator1: true, pollinator2: false } }, { park: 5 }));
    expect(cards).toEqual([
      { key: 'SWARM', achieved: false, unit: 'PARK', current: 5, target: 10 },
      { key: 'POLLINATOR 1', achieved: true, unit: 'TIP', current: 5, target: 4 },
      { key: 'POLLINATOR 2', achieved: false, unit: 'TIP', current: 5, target: 7 },
    ]);
  });
});
