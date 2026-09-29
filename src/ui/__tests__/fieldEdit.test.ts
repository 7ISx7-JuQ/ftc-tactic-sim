// 필드 편집 모드 규칙 (명세서 3.8 필드 편집 모드, 09-10b)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { applyTab, initialDrafts, setFieldText, tabStatus } from '../configDraft';
import {
  cancelSweetSpotEdit,
  clickSweetSpot,
  fieldEditStays,
  fieldGridCell,
  heatmapEditScene,
  openSweetSpotEdit,
  placeSweetSpot,
  sweetSpotCandidateIssues,
  sweetSpotDoneAction,
  sweetSpotEditScene,
  sweetSpotIssueCodes,
  toggleHeatmapEdit,
} from '../fieldEdit';
import type { SweetSpotFieldEdit } from '../fieldEdit';
import { readSweetSpot } from '../robotForm';

describe('필드 편집 모드 (09-10b / 09-10c)', () => {
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

  // ---------------- 09-10c 스윗스팟 모드 ----------------
  const HIVE_CELL = { x: 60.5, y: 99.5 };  // RED 기준: 몸체가 HIVE와 겹치고 조준점에 너무 가까움 (해 없음)
  const GOOD_CELL = { x: 40.5, y: 120.5 };

  it('D. SET ON FIELD: 들어올 때의 초안 스윗스팟 / 틀린 글자를 기억, 같은 로봇이면 그대로, 기물 종류는 이어받음', () => {
    let drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    drafts = setFieldText(drafts, 'robot1', 'sweetSpot.x', '12a');
    const edit = openSweetSpotEdit(null, drafts, 'robot1') as SweetSpotFieldEdit;
    expect(edit).toEqual({ mode: 'SWEET_SPOT', robot: 'robot1', piece: 'POLLEN', entry: { sweetSpot: { x: 59.5, y: 131.5 }, fieldText: { x: '12a' } } });
    expect(openSweetSpotEdit(edit, clickSweetSpot(drafts, 'robot1', 'RED', GOOD_CELL), 'robot1')).toBe(edit); // 다시 눌러도 기억값 유지
    const fromHeatmap = openSweetSpotEdit({ mode: 'HEATMAP', robot: 'robot1', piece: 'NECTAR' }, drafts, 'robot1');
    expect(fromHeatmap.piece).toBe('NECTAR');
    expect(openSweetSpotEdit(edit, drafts, 'robot2').robot).toBe('robot2');
    // 히트맵 버튼은 스윗스팟 모드를 히트맵 모드로 바꿈 (한 번에 한 모드)
    expect(toggleHeatmapEdit(edit, 'robot1')).toEqual({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' });
  });

  it('E. 필드 좌표 → 1 in 격자 중심 (필드 밖 = null)', () => {
    expect(fieldGridCell({ x: 40.3, y: 120.7 })).toEqual({ x: 40.5, y: 120.5 });
    expect(fieldGridCell({ x: 0, y: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(fieldGridCell({ x: 143.999, y: 60 })).toEqual({ x: 143.5, y: 60.5 });
    for (const p of [{ x: 144, y: 10 }, { x: -0.01, y: 10 }, { x: 10, y: 150 }, { x: Number.NaN, y: 10 }]) expect(fieldGridCell(p)).toBeNull();
  });

  it('F. 찍기: 진영 기준 칸 → 보관은 기준 셀 좌표(BLUE 점대칭), 틀린 글자 지움, 틀린 칸도 찍히고 사유 표시', () => {
    const profile = DEFAULT_DRAFT_VALUES.robot1;
    expect(placeSweetSpot(profile, 'RED', GOOD_CELL).ballistics.sweetSpot).toEqual(GOOD_CELL);
    expect(placeSweetSpot(profile, 'BLUE', GOOD_CELL).ballistics.sweetSpot).toEqual({ x: 144 - 40.5, y: 144 - 120.5 });
    expect(readSweetSpot(placeSweetSpot(profile, 'BLUE', GOOD_CELL), 'BLUE')).toEqual(GOOD_CELL);

    let drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    drafts = setFieldText(drafts, 'robot1', 'sweetSpot.y', 'abc');
    const clicked = clickSweetSpot(drafts, 'robot1', 'RED', GOOD_CELL);
    expect(clicked.draft.robot1.ballistics.sweetSpot).toEqual(GOOD_CELL);
    expect(clicked.fieldText.robot1).toEqual({});
    expect(clicked.applied.robot1.ballistics.sweetSpot).toEqual({ x: 59.5, y: 131.5 });
    expect(tabStatus(clicked, 'robot1')).toBe('DIRTY');
    expect(clicked.draft.robot2).toEqual(drafts.draft.robot2);

    // 미리 보기 사유 = 찍은 뒤 사유 (로봇 탭과 같은 규칙)
    expect(sweetSpotCandidateIssues(profile, 'RED', GOOD_CELL)).toEqual([]);
    expect(sweetSpotCandidateIssues(profile, 'RED', HIVE_CELL)).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']);
    expect(sweetSpotCandidateIssues(profile, 'RED', { x: 0.5, y: 131.5 })).toContain('SWEET_SPOT_OUT_OF_FIELD');
    expect(sweetSpotCandidateIssues(profile, 'BLUE', { x: 144 - 60.5, y: 144 - 99.5 })).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']);
    const bad = clickSweetSpot(drafts, 'robot1', 'RED', HIVE_CELL);
    expect(sweetSpotIssueCodes(bad.draft.robot1)).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']);
    expect(tabStatus(bad, 'robot1')).toBe('INVALID');
    // 다른 칸이 틀리면 스윗스팟 탄도 검증은 하지 않음 (로봇 탭과 같음)
    const brokenLength = { ...profile, config: { ...profile.config, length: 0 } };
    expect(sweetSpotCandidateIssues(brokenLength, 'RED', HIVE_CELL)).toEqual([]);
  });

  it('G. CANCEL / Esc / START: 스윗스팟과 그 칸 글자만 들어오기 전으로, 모드 중 바꾼 다른 칸은 유지', () => {
    let drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    drafts = setFieldText(drafts, 'robot1', 'sweetSpot.x', '12a');
    const edit = openSweetSpotEdit(null, drafts, 'robot1') as SweetSpotFieldEdit;
    let during = clickSweetSpot(drafts, 'robot1', 'RED', GOOD_CELL);
    const p = during.draft.robot1;
    during = { ...during, draft: { ...during.draft, robot1: { ...p, config: { ...p.config, maxSpeed: 55 } } } };
    const back = cancelSweetSpotEdit(during, edit);
    expect(back.draft.robot1.ballistics.sweetSpot).toEqual({ x: 59.5, y: 131.5 });
    expect(back.fieldText.robot1).toEqual({ 'sweetSpot.x': '12a' });
    expect(back.draft.robot1.config.maxSpeed).toBe(55);
    // 아무것도 안 바꿨으면 원래와 같은 초안
    const untouched = cancelSweetSpotEdit(clickSweetSpot(initialDrafts(DEFAULT_DRAFT_VALUES), 'robot1', 'RED', GOOD_CELL), openSweetSpotEdit(null, initialDrafts(DEFAULT_DRAFT_VALUES), 'robot1') as SweetSpotFieldEdit);
    expect(tabStatus(untouched, 'robot1')).toBe('OK');
  });

  it('H. DONE: 적용 가능 = APPLY, 틀린 칸 = 초안에만(KEEP_DRAFT), 바뀐 것 없음 = 닫기', () => {
    const drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    expect(sweetSpotDoneAction(drafts, 'robot1')).toBe('CLOSE');
    const good = clickSweetSpot(drafts, 'robot1', 'RED', GOOD_CELL);
    expect(sweetSpotDoneAction(good, 'robot1')).toBe('APPLY');
    expect(applyTab(good, 'robot1').applied.robot1.ballistics.sweetSpot).toEqual(GOOD_CELL);
    expect(sweetSpotDoneAction(clickSweetSpot(drafts, 'robot1', 'RED', HIVE_CELL), 'robot1')).toBe('KEEP_DRAFT');
    expect(sweetSpotDoneAction(setFieldText(good, 'robot1', 'maxSpeed', 'x'), 'robot1')).toBe('KEEP_DRAFT');
  });

  it('I. 스윗스팟 장면: 초안 스윗스팟 / 검증 / 크기, 마우스 칸의 찍기 가능 여부, 확률표를 만든 적용 스윗스팟', () => {
    const applied = DEFAULT_DRAFT_VALUES.robot1;
    const draft = { ...placeSweetSpot(applied, 'RED', GOOD_CELL), config: { ...applied.config, length: 16, width: 14 } };
    const ref = new Float32Array(144 * 144);
    const rows = new Uint8Array(144);
    const scene = sweetSpotEditScene('RED', draft, applied, { reference: ref, rowsDone: rows }, HIVE_CELL);
    expect(scene).toEqual({
      mode: 'SWEET_SPOT',
      alliance: 'RED',
      reference: ref,
      rowsDone: rows,
      sweetSpot: GOOD_CELL,
      sweetSpotValid: true,
      appliedSweetSpot: { x: 59.5, y: 131.5 },
      robotSize: { length: 16, width: 14 },
      hover: { ...HIVE_CELL, valid: false },
    });
    expect(sweetSpotEditScene('RED', draft, applied, null, GOOD_CELL).hover).toEqual({ ...GOOD_CELL, valid: true });
    const badDraft = placeSweetSpot(applied, 'RED', HIVE_CELL);
    const blue = sweetSpotEditScene('BLUE', badDraft, applied, null, null);
    expect(blue.sweetSpotValid).toBe(false);
    expect(blue.sweetSpot).toEqual({ x: 144 - 60.5, y: 144 - 99.5 }); // BLUE 화면 = 점대칭
    expect(blue.appliedSweetSpot).toEqual({ x: 144 - 59.5, y: 144 - 131.5 });
    expect(blue.hover).toBeNull();
    expect(blue.reference).toBeNull();
  });
});
