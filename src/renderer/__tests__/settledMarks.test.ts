// 종료 정착 위치 표시 (명세서 3.7 경기 종료 강조, 12-14): scoreBreakdown.settle → 그릴 정착 자리 / 판정 강조를 옮길 대상
import { describe, expect, it } from 'vitest';
import type { ScoreBreakdown } from '../../core/types';
import { settledView } from '../settledMarks';

const breakdown = (settle: ScoreBreakdown['settle'], patch: Partial<ScoreBreakdown> = {}): ScoreBreakdown => ({
  hive: 0, cell: 0, flower: 0, garden: 0, park: 0, flowers: [], gardenPieceIds: [], parkedRobots: [],
  cellPieces: { nectar: 0, pollen: 0 }, teleopTips: 0, settle, ...patch,
});

describe('종료 정착 위치 표시 (12-14)', () => {
  it('A. 내역 없음(종료 전) / 0:00 뒤 움직인 것 없음 → 표시 없음', () => {
    expect(settledView(null)).toBeNull();
    expect(settledView(undefined)).toBeNull();
    expect(settledView(breakdown({ ticks: 40, robots: [], pieces: [] }))).toBeNull();
  });

  it('B. 정착 자리 + 판정 표시: 주차 인정 로봇 / GARDEN 인정 기물은 정착 자리에 강조, 움직인 것은 0:00 자리 강조에서 뺌', () => {
    const view = settledView(breakdown(
      {
        ticks: 60,
        robots: [{ id: 'robot2', x: 9, y: 40, heading: 0.5 }],
        pieces: [{ id: 'pollen-3', type: 'POLLEN', x: 10, y: 141 }, { id: 'nectar-1', type: 'NECTAR', x: 70, y: 50 }],
      },
      { parkedRobots: ['robot1', 'robot2'], gardenPieceIds: ['pollen-1', 'pollen-3'] },
    ))!;
    expect(view.robots).toEqual([{ id: 'robot2', x: 9, y: 40, heading: 0.5, parked: true }]);
    expect(view.pieces).toEqual([
      { id: 'pollen-3', type: 'POLLEN', x: 10, y: 141, scored: true },
      { id: 'nectar-1', type: 'NECTAR', x: 70, y: 50, scored: false },
    ]);
    expect([...view.movedRobots]).toEqual(['robot2']); // robot1은 0:00 자리에서 주차 강조
    expect([...view.movedPieces].sort()).toEqual(['nectar-1', 'pollen-3']); // pollen-1은 0:00 자리에서 인정 테두리
  });
});
