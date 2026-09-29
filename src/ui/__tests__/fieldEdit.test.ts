// 필드 편집 모드 규칙 (명세서 3.8 필드 편집 모드, 09-10b)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { fieldEditStays, heatmapEditScene, toggleHeatmapEdit } from '../fieldEdit';
import { readSweetSpot } from '../robotForm';

describe('필드 편집 모드 (09-10b)', () => {
  it('A. SHOW / HIDE HIT MAP: 같은 로봇이면 닫고, 아니면 그 로봇으로 열기 (기본 POLLEN)', () => {
    const r1 = toggleHeatmapEdit(null, 'robot1');
    expect(r1).toEqual({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' });
    expect(toggleHeatmapEdit({ ...r1!, piece: 'NECTAR' }, 'robot1')).toBeNull();
    expect(toggleHeatmapEdit(r1, 'robot2')).toEqual({ mode: 'HEATMAP', robot: 'robot2', piece: 'POLLEN' });
  });

  it('B. 유지 조건: 경기 전 SETUP + config 창 펼침 + 연 로봇 탭', () => {
    const edit = toggleHeatmapEdit(null, 'robot2')!;
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: true, tab: 'robot2' })).toBe(true);
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: true, tab: 'robot1' })).toBe(false);
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: true, tab: 'settings' })).toBe(false);
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: false, tab: 'robot2' })).toBe(false);
    for (const phase of ['ROTATING_IN', 'MATCH', 'ROTATING_OUT'] as const) {
      expect(fieldEditStays(edit, { phase, configOpen: true, tab: 'robot2' })).toBe(false);
    }
  });

  it('C. 히트맵 장면: 적용한 스윗스팟을 진영 기준으로, 버퍼는 그대로 전달, 없으면 전부 미계산', () => {
    const applied = DEFAULT_DRAFT_VALUES.robot1;
    const reference = new Float32Array(144 * 144);
    const rowsDone = new Uint8Array(144);
    const red = heatmapEditScene('RED', applied, { reference, rowsDone });
    expect(red).toEqual({ mode: 'HEATMAP', alliance: 'RED', reference, rowsDone, sweetSpot: { x: 59.5, y: 131.5 } });
    expect(red.reference).toBe(reference);
    const blue = heatmapEditScene('BLUE', applied, null);
    expect(blue.sweetSpot).toEqual(readSweetSpot(applied, 'BLUE'));
    expect(blue.sweetSpot).toEqual({ x: 144 - 59.5, y: 144 - 131.5 });
    expect(blue.reference).toBeNull();
    expect(blue.rowsDone).toBeNull();
  });
});
