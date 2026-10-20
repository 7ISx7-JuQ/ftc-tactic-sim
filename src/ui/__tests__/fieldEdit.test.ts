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
  editDoneAction,
  editPieces,
  effectivePiece,
  fieldEditUsable,
  heatmapPieces,
  pieceShooterSlot,
  slotPieces,
  sweetSpotEditScene,
  sweetSpotIssueCodes,
  toggleHeatmapEdit,
} from '../fieldEdit';
import type { ScenarioFieldEdit, SweetSpotFieldEdit } from '../fieldEdit';
import {
  EDIT_HISTORY_LIMIT,
  cancelFieldEdit,
  cancelScenarioEdit,
  dragSpawnPose,
  editTab,
  finishRobotDrag,
  openScenarioEdit,
  placeSpawn,
  recordScenarioChange,
  redoScenarioEdit,
  robotPlacementIssues,
  scenarioEditScene,
  scenarioSnapshot,
  spawnRobots,
  undoScenarioEdit,
} from '../fieldEdit';
import { DEFAULT_SPAWN_POSES, gardenPiecePositions, validateRobotPlacement } from '../../core/simulationEngine';
import { editDraft } from '../configDraft';
import { readSweetSpot, writeNumber } from '../robotForm';
import type { RobotProfile } from '../robotForm';

describe('필드 편집 모드 (09-10b / 09-10c / 09-11b)', () => {
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
    expect(edit).toEqual({ mode: 'SWEET_SPOT', robot: 'robot1', slot: 'MAIN', piece: 'POLLEN', entry: { sweetSpot: { x: 59.5, y: 131.5 }, fieldText: { x: '12a' } } });
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
    expect(editDoneAction(drafts, 'robot1')).toBe('CLOSE');
    const good = clickSweetSpot(drafts, 'robot1', 'RED', GOOD_CELL);
    expect(editDoneAction(good, 'robot1')).toBe('APPLY');
    expect(applyTab(good, 'robot1').applied.robot1.ballistics.sweetSpot).toEqual(GOOD_CELL);
    expect(editDoneAction(clickSweetSpot(drafts, 'robot1', 'RED', HIVE_CELL), 'robot1')).toBe('KEEP_DRAFT');
    expect(editDoneAction(setFieldText(good, 'robot1', 'maxSpeed', 'x'), 'robot1')).toBe('KEEP_DRAFT');
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
      lateralOffset: 0,
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

  // ---------------- 시나리오 필드 편집 모드 (14-1a, 09-11b 시작 자세 모드 흡수) ----------------
  const withScenario = (drafts: ReturnType<typeof initialDrafts>, patch: object) => editDraft(drafts, 'scenario', { ...drafts.draft.scenario, ...patch });

  it('J. EDIT ON FIELD: 연 탭 = SCENARIO, 들어올 때 시나리오 / 칸 글자 기억 + 빈 되돌리기 기록, 다시 눌러도 그대로', () => {
    let drafts = withScenario(initialDrafts(DEFAULT_DRAFT_VALUES), { r2Spawn: { x: 20, y: 100, heading: 0.5 } });
    drafts = setFieldText(drafts, 'scenario', 'spawn.robot1.x', 'abc');
    const edit = openScenarioEdit(null, drafts);
    expect(edit).toEqual({
      mode: 'SCENARIO',
      entry: { scenario: { allianceColor: 'RED', r2Spawn: { x: 20, y: 100, heading: 0.5 } }, fieldText: { 'spawn.robot1.x': 'abc' } },
      history: { past: [], future: [], lastKey: null },
    });
    expect(openScenarioEdit(edit, drafts)).toBe(edit);
    expect(editTab(edit)).toBe('scenario');
    expect(editTab({ mode: 'HEATMAP', robot: 'robot2', piece: 'POLLEN' })).toBe('robot2');
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: true, tab: 'scenario' })).toBe(true);
    expect(fieldEditStays(edit, { phase: 'SETUP', configOpen: true, tab: 'robot1' })).toBe(false);
    // 다른 모드에서 넘어옴 (한 번에 한 모드)
    expect(openScenarioEdit({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' }, drafts).mode).toBe('SCENARIO');
  });

  it('K. 끌기: 몸체 = 이동량만큼(0 ~ 144 제한), 핸들 = 중심 → 포인터 방향, 표시 자리수(0.1 in / 0.1°)로만 반올림', () => {
    const start = { x: 9, y: 36, heading: 0 };
    expect(dragSpawnPose(start, 'body', { x: 10, y: 40 }, { x: 41.26, y: 54.04 })).toEqual({ x: 40.3, y: 50, heading: 0 });
    const clamped = dragSpawnPose(start, 'body', { x: 10, y: 40 }, { x: -50, y: 300 });
    expect([clamped.x, clamped.y]).toEqual([0, 144]);
    expect(dragSpawnPose(start, 'handle', { x: 25, y: 36 }, { x: 9, y: 80 }).heading).toBeCloseTo(Math.PI / 2, 12);
    expect(dragSpawnPose(start, 'handle', { x: 25, y: 36 }, { x: 9, y: 0 }).heading).toBeCloseTo(-Math.PI / 2, 12);
    expect(dragSpawnPose(start, 'handle', { x: 25, y: 36 }, { x: 0, y: 36 }).heading).toBeCloseTo(Math.PI, 12);
    const turned = dragSpawnPose(start, 'handle', { x: 25, y: 36 }, { x: 19, y: 36 + 10 * Math.tan((33.33 * Math.PI) / 180) });
    expect((turned.heading * 180) / Math.PI).toBeCloseTo(33.3, 9);
    expect([turned.x, turned.y]).toEqual([9, 36]);
    expect(dragSpawnPose(start, 'handle', { x: 25, y: 36 }, { x: 9, y: 36 })).toBe(start); // 중심 위 = 그대로
  });

  it('L. 끄는 동안 = 그 로봇 자세만 초안으로 + 그 로봇 칸 글자 지움 (겹쳐도 화면에 보임), 놓기 = 겹치면 끌기 전으로 + 사유', () => {
    let drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    drafts = setFieldText(setFieldText(drafts, 'scenario', 'spawn.robot1.y', 'x'), 'scenario', 'spawn.robot2.x', 'y');
    const placed = placeSpawn(drafts, 'robot1', { x: 20, y: 100, heading: 0 });
    expect(placed.draft.scenario).toEqual({ allianceColor: 'RED', r1Spawn: { x: 20, y: 100, heading: 0 } });
    expect(placed.fieldText.scenario).toEqual({ 'spawn.robot2.x': 'y' });
    expect(validateRobotPlacement(placed.draft.scenario, placed.draft.robot1.config, placed.draft.robot2.config).map(i => i.code)).toContain('PLACEMENT_ROBOT_OVERLAP');
    expect(spawnRobots(placed.draft).robot1.pose).toEqual({ x: 20, y: 100, heading: 0 });
    expect(spawnRobots(placed.draft).robot2.pose).toEqual(DEFAULT_SPAWN_POSES.RED.robot2);
    expect(robotPlacementIssues(placed.draft, 'robot1').map(i => i.code)).toEqual(['PLACEMENT_ROBOT_OVERLAP']);

    // 놓기: 겹치는 자리 → 끌기 전(초안 / 칸 글자)으로 + 사유, 올바른 자리 → 확정, 움직이지 않음 → 그대로
    const before = scenarioSnapshot(drafts);
    const refused = finishRobotDrag(placed, 'robot1', before, { x: 20, y: 100, heading: 0 });
    expect(refused.refused.map(i => i.code)).toEqual(['PLACEMENT_ROBOT_OVERLAP']);
    expect(scenarioSnapshot(refused.drafts)).toEqual(before);
    const inHive = finishRobotDrag(drafts, 'robot2', before, { x: 50, y: 72, heading: 0 });
    expect(inHive.refused.map(i => i.code)).toEqual(['PLACEMENT_IN_HIVE']);
    const ok = finishRobotDrag(placed, 'robot1', before, { x: 40, y: 40, heading: 0.5 });
    expect(ok.refused).toEqual([]);
    expect(ok.drafts.draft.scenario.r1Spawn).toEqual({ x: 40, y: 40, heading: 0.5 });
    expect(ok.drafts.fieldText.scenario).toEqual({ 'spawn.robot2.x': 'y' });
    const tunnel = finishRobotDrag(drafts, 'robot1', before, { x: 72, y: 72, heading: Math.PI / 2 }); // 터널 안 시작 자세 허용
    expect(tunnel.refused).toEqual([]);
    const still = finishRobotDrag(placed, 'robot1', before, null);
    expect(scenarioSnapshot(still.drafts)).toEqual(before);
  });

  it('M. CANCEL / Esc / START: 진영 / RP 기준값 / 시드를 뺀 시나리오와 칸 글자를 들어오기 전으로, 진영을 바꿨으면 들어오기 전 값을 점대칭', () => {
    let drafts = withScenario(initialDrafts(DEFAULT_DRAFT_VALUES), { r2Spawn: { x: 20, y: 100, heading: 0 }, floorPieces: [{ type: 'POLLEN', x: 30, y: 120 }] });
    drafts = setFieldText(drafts, 'scenario', 'spawn.robot2.y', 'bad');
    const edit = openScenarioEdit(null, drafts);
    let during = placeSpawn(drafts, 'robot1', { x: 60, y: 60, heading: 1 });
    during = placeSpawn(during, 'robot2', { x: 70, y: 20, heading: 0 });
    during = withScenario(during, { autoTipCount: 2, rngSeed: 99, rpThresholds: { swarmPoints: 14, pollinator1Tips: 3, pollinator2Tips: 6 } });
    const back = cancelScenarioEdit(during, edit);
    expect(back.draft.scenario).toEqual({
      allianceColor: 'RED',
      r2Spawn: { x: 20, y: 100, heading: 0 },
      floorPieces: [{ type: 'POLLEN', x: 30, y: 120 }],
      rngSeed: 99,
      rpThresholds: { swarmPoints: 14, pollinator1Tips: 3, pollinator2Tips: 6 },
    });
    expect(back.draft.scenario).not.toHaveProperty('r1Spawn');
    expect(back.fieldText.scenario).toEqual({ 'spawn.robot2.y': 'bad' });
    expect(cancelFieldEdit(during, edit)).toEqual(back);
    // 모드 중 진영 전환 → 들어오기 전 값을 새 진영으로 (점대칭)
    const blue = withScenario(during, { allianceColor: 'BLUE' });
    const backBlue = cancelScenarioEdit(blue, edit);
    expect(backBlue.draft.scenario.allianceColor).toBe('BLUE');
    expect(backBlue.draft.scenario.r2Spawn!.x).toBe(124);
    expect(backBlue.draft.scenario.r2Spawn!.y).toBe(44);
    expect(backBlue.draft.scenario.r2Spawn!.heading).toBeCloseTo(Math.PI, 12);
    expect(backBlue.draft.scenario.floorPieces).toEqual([{ type: 'POLLEN', x: 114, y: 24 }]);
    expect(backBlue.draft.scenario).not.toHaveProperty('r1Spawn');
    // 히트맵 모드는 바꾼 값 없음
    expect(cancelFieldEdit(during, { mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' })).toBe(during);
  });

  it('N. DONE: SCENARIO 탭 적용 규칙 (APPLY / 틀린 칸 = 초안에만 / 바뀐 것 없음 = 닫기)', () => {
    const drafts = initialDrafts(DEFAULT_DRAFT_VALUES);
    expect(editDoneAction(drafts, 'scenario')).toBe('CLOSE');
    expect(editDoneAction(placeSpawn(drafts, 'robot1', { x: 30, y: 40, heading: 0 }), 'scenario')).toBe('APPLY');
    expect(editDoneAction(placeSpawn(drafts, 'robot1', { x: 9, y: 105, heading: 0 }), 'scenario')).toBe('KEEP_DRAFT');
  });

  it('O. 시나리오 필드 편집 장면: 초안 진영 / 자세 / 제원, 배치 문제 로봇, GARDEN 기물 = 엔진 좌표, 강조 부분 전달', () => {
    const drafts = placeSpawn(initialDrafts(DEFAULT_DRAFT_VALUES), 'robot2', { x: 9, y: 40, heading: 0 });
    const scene = scenarioEditScene(drafts.draft, { robot: 'robot2', part: 'handle' });
    expect(scene.mode).toBe('SCENARIO');
    expect(scene.alliance).toBe('RED');
    expect(scene.robots.robot1).toEqual({ pose: DEFAULT_SPAWN_POSES.RED.robot1, config: drafts.draft.robot1.config, bad: true });
    expect(scene.robots.robot2.bad).toBe(true);
    expect(scene.active).toEqual({ robot: 'robot2', part: 'handle' });
    expect(scene.gardenPieces).toEqual([...gardenPiecePositions('RED', 4), ...gardenPiecePositions('BLUE', 4)]);
    const blue = scenarioEditScene(withScenario(initialDrafts(DEFAULT_DRAFT_VALUES), { allianceColor: 'BLUE', gardenPiecesCount: { ally: 2, opponent: 0 } }).draft, null);
    expect(blue.robots.robot1.pose).toEqual(DEFAULT_SPAWN_POSES.BLUE.robot1);
    expect(blue.robots.robot1.bad || blue.robots.robot2.bad).toBe(false);
    expect(blue.gardenPieces).toEqual(gardenPiecePositions('BLUE', 2));
  });

  it('P. 되돌리기 기록: 바뀐 것만 한 단계, 같은 숫자 칸 연속 입력은 한 단계, 되돌리기 / 다시 하기, 새 단계는 다시 하기를 지움, 시드는 그대로, 상한', () => {
    const d0 = initialDrafts(DEFAULT_DRAFT_VALUES);
    let edit: ScenarioFieldEdit = openScenarioEdit(null, d0);
    const step = (from: ReturnType<typeof initialDrafts>, to: ReturnType<typeof initialDrafts>, key: string | null = null) => {
      edit = recordScenarioChange(edit, scenarioSnapshot(from), scenarioSnapshot(to), key);
      return to;
    };
    expect(recordScenarioChange(edit, scenarioSnapshot(d0), scenarioSnapshot(d0))).toBe(edit); // 바뀐 것 없음
    const d1 = step(d0, placeSpawn(d0, 'robot1', { x: 30, y: 40, heading: 0 }));
    // 같은 칸(spawn.robot2.x) 연속 입력: 3 → 30 → 30.5 = 한 단계
    const d2 = step(d1, withScenario(d1, { r2Spawn: { x: 3, y: 108, heading: 0 } }), 'spawn.robot2.x');
    const d3 = step(d2, withScenario(d2, { r2Spawn: { x: 30, y: 108, heading: 0 } }), 'spawn.robot2.x');
    const d4 = step(d3, withScenario(d3, { r2Spawn: { x: 30.5, y: 108, heading: 0 } }), 'spawn.robot2.x');
    expect(edit.history.past.map(p => p.scenario)).toEqual([d0.draft.scenario, d1.draft.scenario]);
    // REROLL로 시드가 바뀐 뒤 되돌려도 시드는 그대로
    const rerolled = withScenario(d4, { rngSeed: 1234 });
    const u1 = undoScenarioEdit(edit, rerolled)!;
    expect(u1.drafts.draft.scenario).toEqual({ ...d1.draft.scenario, rngSeed: 1234 });
    const u2 = undoScenarioEdit(u1.edit, u1.drafts)!;
    expect(u2.drafts.draft.scenario).toEqual({ ...d0.draft.scenario, rngSeed: 1234 });
    expect(undoScenarioEdit(u2.edit, u2.drafts)).toBeNull();
    const r1 = redoScenarioEdit(u2.edit, u2.drafts)!;
    expect(r1.drafts.draft.scenario).toEqual({ ...d1.draft.scenario, rngSeed: 1234 });
    expect(r1.edit.history.future).toHaveLength(1);
    // 새 단계 → 다시 하기 기록 지움, 되돌린 뒤 같은 칸을 다시 쳐도 새 단계 (lastKey 초기화)
    edit = r1.edit;
    step(r1.drafts, withScenario(r1.drafts, { autoTipCount: 1 }));
    expect(edit.history.future).toEqual([]);
    expect(edit.history.past).toHaveLength(2);
    expect(redoScenarioEdit(edit, d0)).toBeNull();
    // 칸 글자도 함께 되돌림
    const typo = setFieldText(d0, 'scenario', 'spawn.robot1.x', 'abc');
    edit = openScenarioEdit(null, d0);
    step(d0, typo, 'spawn.robot1.x');
    expect(undoScenarioEdit(edit, typo)!.drafts.fieldText.scenario).toEqual({});
    // 상한: 오래된 것부터 버림
    edit = openScenarioEdit(null, d0);
    let d = d0;
    for (let i = 0; i < EDIT_HISTORY_LIMIT + 5; i++) d = step(d, withScenario(d, { autoTipCount: i % 2 === 0 ? 1 : 0 }));
    expect(edit.history.past).toHaveLength(EDIT_HISTORY_LIMIT);
  });
});

describe('기물별 확률표 화면 (13-4)', () => {
  const base = DEFAULT_DRAFT_VALUES.robot1;
  const setup = (p: RobotProfile, shooterSetup: RobotProfile['config']['shooterSetup']): RobotProfile => ({ ...p, config: { ...p.config, shooterSetup } });
  const NECTAR_CELL = { x: 70.5, y: 127.5 };

  it('J. 기물 → 슈터 자리, 히트맵 / 스윗스팟 모드에서 고를 수 있는 기물, 기본 기물', () => {
    expect(['NONE', 'POLLEN_ONLY', 'SHARED', 'PER_PIECE'].map(v => heatmapPieces(setup(base, v as never)))).toEqual([[], ['POLLEN'], ['POLLEN', 'NECTAR'], ['POLLEN', 'NECTAR']]);
    const per = setup(base, 'PER_PIECE');
    expect([pieceShooterSlot(per, 'POLLEN'), pieceShooterSlot(per, 'NECTAR'), pieceShooterSlot(base, 'NECTAR')]).toEqual(['MAIN', 'NECTAR', 'MAIN']);
    expect([slotPieces(per, 'MAIN'), slotPieces(per, 'NECTAR'), slotPieces(base, 'MAIN'), slotPieces(base, 'NECTAR')]).toEqual([['POLLEN'], ['NECTAR'], ['POLLEN', 'NECTAR'], []]);
    // 히트맵 기본 기물 = 쏠 수 있는 첫 기물, 프로필이 없으면 POLLEN (v1)
    expect(toggleHeatmapEdit(null, 'robot1', setup(base, 'POLLEN_ONLY'))).toEqual({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' });
    expect(toggleHeatmapEdit(null, 'robot1')!.piece).toBe('POLLEN');
    expect(editPieces({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' }, setup(base, 'POLLEN_ONLY'))).toEqual(['POLLEN']);
    // 구성이 바뀌어 고를 수 없게 된 기물은 첫 기물로
    expect(effectivePiece('NECTAR', ['POLLEN'])).toBe('POLLEN');
    expect(effectivePiece('NECTAR', ['POLLEN', 'NECTAR'])).toBe('NECTAR');
  });

  it('K. NECTAR 슈터 스윗스팟 모드: 그 자리 스윗스팟 / 글자만 기억 · 찍기 · 취소, 기물 = NECTAR, 사유 / 몸체 윤곽은 그 슈터 기준', () => {
    const per = setup(base, 'PER_PIECE');
    let drafts = editDraft(initialDrafts(DEFAULT_DRAFT_VALUES), 'robot1', per);
    drafts = setFieldText(drafts, 'robot1', 'nectar.sweetSpot.y', '9z');
    const edit = openSweetSpotEdit({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' }, drafts, 'robot1', 'NECTAR');
    expect(edit).toEqual({ mode: 'SWEET_SPOT', robot: 'robot1', slot: 'NECTAR', piece: 'NECTAR', entry: { sweetSpot: { x: 59.5, y: 131.5 }, fieldText: { y: '9z' } } });
    expect(openSweetSpotEdit(edit, drafts, 'robot1', 'NECTAR')).toBe(edit);
    expect(openSweetSpotEdit(edit, drafts, 'robot1', 'MAIN').slot).toBe('MAIN'); // 다른 자리면 새로 기억
    // 찍기: NECTAR 슈터 스윗스팟만 바뀌고 그 칸 글자만 지움 (주 슈터 그대로)
    const clicked = clickSweetSpot(drafts, 'robot1', 'RED', NECTAR_CELL, 'NECTAR');
    expect(clicked.draft.robot1.ballistics.nectarShooter.sweetSpot).toEqual(NECTAR_CELL);
    expect(clicked.draft.robot1.ballistics.sweetSpot).toEqual(per.ballistics.sweetSpot);
    expect(clicked.fieldText.robot1['nectar.sweetSpot.y']).toBeUndefined();
    // 취소: 들어오기 전 NECTAR 스윗스팟 / 글자로
    const back = cancelSweetSpotEdit(clicked, edit);
    expect(back.draft.robot1.ballistics.nectarShooter.sweetSpot).toEqual({ x: 59.5, y: 131.5 });
    expect(back.fieldText.robot1['nectar.sweetSpot.y']).toBe('9z');
    // 사유는 그 자리만: NECTAR를 HIVE에 찍으면 NECTAR 사유, 주 슈터 사유는 없음
    const bad = clickSweetSpot(drafts, 'robot1', 'RED', { x: 60.5, y: 99.5 }, 'NECTAR').draft.robot1;
    expect(sweetSpotIssueCodes(bad, 'NECTAR')).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']);
    expect(sweetSpotIssueCodes(bad, 'MAIN')).toEqual([]);
    expect(sweetSpotCandidateIssues(per, 'RED', { x: 60.5, y: 99.5 }, 'NECTAR')).toEqual(['SWEET_SPOT_IN_HIVE', 'SWEET_SPOT_NO_SOLUTION']);
    // 장면: 그 자리 스윗스팟 + 그 슈터 좌우 오프셋 (몸체 윤곽 방향)
    const withLateral = writeNumber(clicked.draft.robot1, 'nectar.shooterLateralOffset', -4);
    const scene = sweetSpotEditScene('RED', withLateral, per, null, null, 'NECTAR');
    expect(scene.sweetSpot).toEqual(NECTAR_CELL);
    expect(scene.lateralOffset).toBe(-4);
    expect(scene.appliedSweetSpot).toEqual(readSweetSpot(per, 'RED', 'NECTAR'));
    expect(sweetSpotEditScene('RED', withLateral, per, null, null).lateralOffset).toBe(0); // 주 슈터
  });

  it('L. 히트맵 장면의 스윗스팟 = 그 기물을 쏘는 슈터, 모드를 쓸 수 없게 되면 숨김', () => {
    const per = { ...setup(base, 'PER_PIECE'), ballistics: { ...base.ballistics, nectarShooter: { ...base.ballistics.nectarShooter, sweetSpot: NECTAR_CELL } } };
    expect(heatmapEditScene('RED', per, null, 'NECTAR').sweetSpot).toEqual(NECTAR_CELL);
    expect(heatmapEditScene('RED', per, null, 'POLLEN').sweetSpot).toEqual({ x: 59.5, y: 131.5 });
    expect(heatmapEditScene('RED', setup(per, 'SHARED'), null, 'NECTAR').sweetSpot).toEqual({ x: 59.5, y: 131.5 }); // 공용 슈터
    const values = (draft: RobotProfile, applied: RobotProfile) => ({ draft: { ...DEFAULT_DRAFT_VALUES, robot1: draft }, applied: { ...DEFAULT_DRAFT_VALUES, robot1: applied } });
    const nectarEdit: SweetSpotFieldEdit = { mode: 'SWEET_SPOT', robot: 'robot1', slot: 'NECTAR', piece: 'NECTAR', entry: { sweetSpot: NECTAR_CELL, fieldText: {} } };
    expect(fieldEditUsable(nectarEdit, values(per, base))).toBe(true);
    expect(fieldEditUsable(nectarEdit, values(setup(per, 'SHARED'), base))).toBe(false); // PER_PIECE를 떠나면 NECTAR 슈터 모드 숨김
    expect(fieldEditUsable({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' }, values(base, setup(base, 'NONE')))).toBe(false); // 적용한 설정에 쏠 기물 없음
    expect(fieldEditUsable({ mode: 'HEATMAP', robot: 'robot1', piece: 'POLLEN' }, values(setup(base, 'NONE'), base))).toBe(true); // 히트맵은 적용한 설정 기준
  });
});
