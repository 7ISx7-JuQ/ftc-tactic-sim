// 필드 편집 모드 규칙 (명세서 3.8 필드 편집 모드, 09-10b / 09-10c): React / DOM 비의존
// - config 창의 버튼으로 메인 필드를 편집 모드로 바꾼다. 경기 전(SETUP)에만, 한 번에 한 모드만.
// - 09-10b 히트맵(HEATMAP): 로봇 탭 SHOW HIT MAP. 적용한 설정의 명중 확률표를 시나리오 초안 진영 기준으로 보여 주고 기물 종류를 바꿔 본다.
//   편집하는 값이 없으므로 DONE / Esc = 닫기.
// - 09-10c 스윗스팟(SWEET_SPOT): 로봇 탭 SET ON FIELD. 필드 클릭 = 그 격자 중심으로 스윗스팟 초안 (검증 실패 칸도 찍히고 빨간 오류),
//   모드는 계속 유지. DONE = 그 로봇 탭 APPLY까지 (적용할 수 없으면 초안에만), CANCEL / Esc / START = 모드에 들어오기 전 값으로 되돌림.
// - 14-1a 시나리오 필드 편집(SCENARIO, 09-11b 시작 자세 모드를 흡수): 시나리오 탭 EDIT ON FIELD. 로봇 몸체 끌기 = 위치, 회전 핸들 끌기 = 헤딩
//   (스냅 없음, 표시 자리수 0.1 in / 0.1°로 반올림해 칸에 보이는 값 = 보관 값). 놓은 자리에서 그 로봇이 겹치면(배치 검증) 끌기 전 자세로 되돌림.
//   모드 중 시나리오 초안 변경(필드 조작 + 탭 입력)은 되돌리기 기록에 쌓인다 (같은 숫자 칸 연속 입력은 한 단계, 상한 100).
//   DONE = SCENARIO 탭 APPLY까지, CANCEL / Esc / START = 진영 / RP 기준값 / 시드를 뺀 시나리오와 칸 글자를 들어오기 전으로
//   (그사이 진영을 바꿨으면 들어오기 전 값을 새 진영으로 점대칭).
// - 편집 모드를 연 탭을 떠나거나(다른 탭 / 창 닫기 / 다른 모드) 경기 전이 아니게 되면 편집 모드를 끝낸다 (찍은 초안은 그대로).
// - 13-4 (기물별): 히트맵 기물 버튼은 그 로봇이 쏠 수 있는 기물만, 표시 스윗스팟 = 그 기물을 쏘는 슈터의 스윗스팟.
//   스윗스팟 모드는 슈터 자리(slot: 주 슈터 / PER_PIECE의 NECTAR 슈터) 하나의 스윗스팟을 찍고, 기물 버튼은 그 슈터가 쏘는 기물만.
//   몸체 윤곽 / 검증은 그 슈터의 좌우 오프셋으로 (aimingRobotOBB, 사유는 RobotIssue.slot).

import type { AppPhase } from '../app/appController';
import type { RobotId } from '../input/inputConfig';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import { FIELD_SIZE, FLOWER_CIRCLES, GARDEN_AABB, PIECE_PHYSICS, getRobotOBB, testOBBvsCircle } from '../core/collision';
import { FIELD_LAYOUT } from '../renderer/canvasRenderer';
import { flowerGaugeLayout } from '../renderer/gaugeLayout';
import { carriedHighlightIndex } from '../renderer/robotLayout';
import { FLOWER_MAX_START_PIECES, INITIAL_HUMAN_NECTAR_STOCK, getCarryCapacity, NECTAR_IN_PLAY, PLACEMENT_TOLERANCE, TOTAL_POLLEN, gardenPiecePositions, humanNectarSlots, isFloorPiecePositionValid, validateRobotPlacement } from '../core/simulationEngine';
import type { FloorPiecePlacement, RobotPose, ScenarioConfig } from '../core/types';
import type { HeatmapEditScene, ScenarioEditScene, SweetSpotEditScene } from '../renderer/editSceneRenderer';
import type { SpawnPart, SpawnRobotId } from '../renderer/spawnEditLayout';
import { canApply, deepEqual, editDraft, setFieldText, tabStatus } from './configDraft';
import type { ConfigDrafts, ConfigTab, DraftTab, DraftValues } from './configDraft';
import { SPAWN_AXES, SPAWN_FIELD_SPECS, floorSummary, normalizeHeading, readScenario, scenarioFormIssues, setAlliance, setSpawnPose, spawnFieldKey } from './scenarioForm';
import type { ScenarioFormIssue } from './scenarioForm';
import { PIECE_TYPES, isPieceFireable } from '../core/ballistics';
import { SWEET_SPOT_AXES, readSweetSpot, robotProfileIssues, slotBallistics, sweetSpotFieldKey, writeSweetSpot } from './robotForm';
import type { RobotProfile, ShooterSlot } from './robotForm';
import { t } from './i18n';
import type { Language } from './i18n';

export type FieldEditMode = 'HEATMAP' | 'SWEET_SPOT' | 'SCENARIO';

export interface HeatmapFieldEdit {
  mode: 'HEATMAP';
  robot: RobotId;
  piece: PieceType; // 보고 있는 기물 종류
}

export interface SweetSpotFieldEdit {
  mode: 'SWEET_SPOT';
  robot: RobotId;
  slot: ShooterSlot; // 찍는 스윗스팟의 슈터 자리 (13-4: 주 슈터 / PER_PIECE의 NECTAR 슈터)
  piece: PieceType; // 반투명 히트맵의 기물 종류 (그 슈터가 쏘는 기물)
  /** 모드에 들어올 때의 초안 스윗스팟(기준 셀 좌표) + 스윗스팟 칸의 틀린 입력 글자 (CANCEL 복원용) */
  entry: { sweetSpot: { x: number; y: number }; fieldText: Partial<Record<'x' | 'y', string>> };
}

/** 시나리오 탭 스냅샷: 시나리오 초안 + 시나리오 칸의 틀린 입력 글자 (되돌리기 기록 / CANCEL 복원, 14-1a) */
export interface ScenarioSnapshot {
  scenario: ScenarioConfig;
  fieldText: Readonly<Record<string, string>>;
}

/** 되돌리기 기록 (14-1a): past = 되돌릴 스냅샷(오래된 것부터), future = 다시 할 스냅샷, lastKey = 마지막 단계를 만든 숫자 칸 (연속 입력 묶기) */
export interface EditHistory {
  past: readonly ScenarioSnapshot[];
  future: readonly ScenarioSnapshot[];
  lastKey: string | null;
}

export interface ScenarioFieldEdit {
  mode: 'SCENARIO';
  entry: ScenarioSnapshot; // 모드에 들어올 때 (CANCEL 복원용)
  history: EditHistory;
}

export type FieldEdit = HeatmapFieldEdit | SweetSpotFieldEdit | ScenarioFieldEdit;

/** 편집 모드를 연 탭 (그 탭이 보이는 동안만 유지) */
export function editTab(edit: FieldEdit): ConfigTab {
  return edit.mode === 'SCENARIO' ? 'scenario' : edit.robot;
}

type Point = { x: number; y: number };

// ------------------------------------------------------------
// 기물 / 슈터 자리 (13-4)
// ------------------------------------------------------------

/** 그 기물을 쏘는 슈터 자리: PER_PIECE + NECTAR → NECTAR 슈터, 그 외 → 주 슈터 (엔진 shooterFor와 같은 규칙) */
export function pieceShooterSlot(profile: RobotProfile, piece: PieceType): ShooterSlot {
  return profile.config.shooterSetup === 'PER_PIECE' && piece === 'NECTAR' ? 'NECTAR' : 'MAIN';
}

/** 히트맵에서 볼 수 있는 기물 = 그 로봇이 쏠 수 있는 기물 (POLLEN_ONLY는 POLLEN만, NONE은 없음) */
export function heatmapPieces(profile: RobotProfile): PieceType[] {
  return PIECE_TYPES.filter(piece => isPieceFireable(profile.config, piece));
}

/** 스윗스팟 모드에서 볼 수 있는 기물 = 그 슈터가 쏘는 기물 (SHARED는 두 기물이 같은 스윗스팟) */
export function slotPieces(profile: RobotProfile, slot: ShooterSlot): PieceType[] {
  return heatmapPieces(profile).filter(piece => pieceShooterSlot(profile, piece) === slot);
}

/** 그 편집 모드의 기물 버튼에서 고를 수 있는 기물 */
export function editPieces(edit: HeatmapFieldEdit | SweetSpotFieldEdit, profile: RobotProfile): PieceType[] {
  return edit.mode === 'HEATMAP' ? heatmapPieces(profile) : slotPieces(profile, edit.slot);
}

/** 로봇 탭 SHOW HIT MAP: 그 로봇 히트맵이 이미 열려 있으면 닫고(null), 아니면 연다 (다른 모드는 닫고 전환, 기본 = 쏠 수 있는 첫 기물, 모르면 POLLEN) */
export function toggleHeatmapEdit(current: FieldEdit | null, robot: RobotId, profile?: RobotProfile): HeatmapFieldEdit | null {
  if (current?.mode === 'HEATMAP' && current.robot === robot) return null;
  return { mode: 'HEATMAP', robot, piece: (profile && heatmapPieces(profile)[0]) ?? 'POLLEN' };
}

/**
 * 로봇 탭 SET ON FIELD: 그 슈터 자리의 지금 초안 스윗스팟 / 틀린 글자를 기억하고 스윗스팟 모드로 (이미 그 로봇 · 그 자리 스윗스팟 모드면 그대로).
 * 기물 = 보고 있던 기물이 그 슈터가 쏘는 기물이면 유지, 아니면 그 슈터의 첫 기물
 */
export function openSweetSpotEdit(current: FieldEdit | null, drafts: ConfigDrafts, robot: RobotId, slot: ShooterSlot = 'MAIN'): SweetSpotFieldEdit {
  if (current?.mode === 'SWEET_SPOT' && current.robot === robot && current.slot === slot) return current;
  const texts = drafts.fieldText[robot];
  const fieldText: Partial<Record<'x' | 'y', string>> = {};
  for (const axis of SWEET_SPOT_AXES) {
    const text = texts[sweetSpotFieldKey(axis, slot)];
    if (text !== undefined) fieldText[axis] = text;
  }
  const profile = drafts.draft[robot];
  const spot = slotBallistics(profile, slot).sweetSpot;
  const pieces = slotPieces(profile, slot);
  const seen = current && current.mode !== 'SCENARIO' ? current.piece : null;
  const piece = seen && pieces.includes(seen) ? seen : (pieces[0] ?? 'POLLEN');
  return { mode: 'SWEET_SPOT', robot, slot, piece, entry: { sweetSpot: { x: spot.x, y: spot.y }, fieldText } };
}

/**
 * 편집 모드가 그 로봇 설정에서 쓸 수 있는지 (13-4): 히트맵 = 적용한 설정에 쏠 수 있는 기물이 있음, 스윗스팟 = 초안에서 그 슈터 자리를 씀.
 * 슈터 구성을 바꿔 쓸 수 없게 되면(NONE / PER_PIECE를 떠난 NECTAR 슈터) 모드를 보이지 않게 한다
 */
export function fieldEditUsable(edit: FieldEdit, values: { draft: DraftValues; applied: DraftValues }): boolean {
  if (edit.mode === 'SCENARIO') return true;
  if (edit.mode === 'HEATMAP') return heatmapPieces(values.applied[edit.robot]).length > 0;
  return slotPieces(values.draft[edit.robot], edit.slot).length > 0;
}

/** 지금 보여 줄 기물: 고른 기물을 고를 수 있으면 그대로, 아니면(구성 변경) 고를 수 있는 첫 기물 */
export function effectivePiece(piece: PieceType, pieces: readonly PieceType[]): PieceType {
  return pieces.includes(piece) ? piece : (pieces[0] ?? piece);
}

/** 편집 모드를 유지할 수 있는지: 경기 전 SETUP + config 창이 펼쳐져 있고 편집을 연 로봇 탭이 보이는 동안 */
export function fieldEditStays(edit: FieldEdit, ctx: { phase: AppPhase; configOpen: boolean; tab: ConfigTab }): boolean {
  return ctx.phase === 'SETUP' && ctx.configOpen && ctx.tab === editTab(edit);
}

/** 필드 좌표(관중석 시점) → 그 점을 담는 1 in 격자의 중심. 필드 밖(여백)이면 null (클릭 무시) */
export function fieldGridCell(p: Point): Point | null {
  if (!(p.x >= 0 && p.x < FIELD_SIZE && p.y >= 0 && p.y < FIELD_SIZE)) return null;
  return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
}

/** 진영 기준 격자 중심을 그 슈터 자리의 초안 스윗스팟으로 (두 축 모두, 보관은 기준 셀 좌표) */
export function placeSweetSpot(profile: RobotProfile, alliance: 'RED' | 'BLUE', cell: Point, slot: ShooterSlot = 'MAIN'): RobotProfile {
  return writeSweetSpot(writeSweetSpot(profile, alliance, 'x', cell.x, slot), alliance, 'y', cell.y, slot);
}

/** 그 슈터 자리의 스윗스팟 검증 사유 (로봇 탭과 같은 규칙: 다른 칸이 모두 올바를 때만 필드 밖 / HIVE / 해 없음 — 좌우 오프셋 포함) */
export function sweetSpotIssueCodes(profile: RobotProfile, slot: ShooterSlot = 'MAIN'): string[] {
  return robotProfileIssues(profile)
    .filter(issue => (issue.slot ?? 'MAIN') === slot && issue.code.startsWith('SWEET_SPOT_'))
    .map(issue => issue.code);
}

/** 마우스를 올린 칸에 찍으면 생기는 사유 (찍기 전 미리 보기) */
export function sweetSpotCandidateIssues(profile: RobotProfile, alliance: 'RED' | 'BLUE', cell: Point, slot: ShooterSlot = 'MAIN'): string[] {
  return sweetSpotIssueCodes(placeSweetSpot(profile, alliance, cell, slot), slot);
}

/** 필드 클릭: 그 슈터 자리의 초안 스윗스팟을 그 칸으로 + 그 스윗스팟 칸의 틀린 글자 지움 (검증 실패 칸도 찍힘 — 빨간 오류로 표시, 09-10c 확정) */
export function clickSweetSpot(drafts: ConfigDrafts, robot: RobotId, alliance: 'RED' | 'BLUE', cell: Point, slot: ShooterSlot = 'MAIN'): ConfigDrafts {
  let next = editDraft(drafts, robot, placeSweetSpot(drafts.draft[robot], alliance, cell, slot));
  for (const axis of SWEET_SPOT_AXES) next = setFieldText(next, robot, sweetSpotFieldKey(axis, slot), null);
  return next;
}

/** CANCEL / Esc / START: 그 슈터 자리의 초안 스윗스팟과 스윗스팟 칸의 틀린 글자를 모드에 들어오기 전으로 (다른 칸은 그대로) */
export function cancelSweetSpotEdit(drafts: ConfigDrafts, edit: SweetSpotFieldEdit): ConfigDrafts {
  const profile = drafts.draft[edit.robot];
  const sweetSpot = { ...edit.entry.sweetSpot };
  const ballistics =
    edit.slot === 'MAIN'
      ? { ...profile.ballistics, sweetSpot }
      : { ...profile.ballistics, nectarShooter: { ...profile.ballistics.nectarShooter, sweetSpot } };
  let next = editDraft(drafts, edit.robot, { ...profile, ballistics });
  for (const axis of SWEET_SPOT_AXES) next = setFieldText(next, edit.robot, sweetSpotFieldKey(axis, edit.slot), edit.entry.fieldText[axis] ?? null);
  return next;
}

/** CANCEL / Esc / START 공통: 모드에 따라 들어오기 전 값으로 (히트맵 모드는 바꾼 값이 없음) */
export function cancelFieldEdit(drafts: ConfigDrafts, edit: FieldEdit): ConfigDrafts {
  if (edit.mode === 'SWEET_SPOT') return cancelSweetSpotEdit(drafts, edit);
  if (edit.mode === 'SCENARIO') return cancelScenarioEdit(drafts, edit);
  return drafts;
}

/**
 * 스윗스팟 / 시작 자세 모드 DONE (09-10c · 09-11 확정: 그 탭 APPLY까지): 적용할 수 있으면 APPLY,
 * 틀린 칸이 있으면 초안에만 남기고 안내(KEEP_DRAFT), 바뀐 것이 없으면 닫기만(CLOSE)
 */
export function editDoneAction(drafts: ConfigDrafts, tab: DraftTab): 'APPLY' | 'KEEP_DRAFT' | 'CLOSE' {
  if (canApply(drafts, tab)) return 'APPLY';
  return tabStatus(drafts, tab) === 'INVALID' ? 'KEEP_DRAFT' : 'CLOSE';
}

// ------------------------------------------------------------
// 시나리오 필드 편집 모드 (14-1a, 09-11b 시작 자세 모드 흡수)
// ------------------------------------------------------------

/** 되돌리기 기록 상한 (넘으면 오래된 것부터 버림) */
export const EDIT_HISTORY_LIMIT = 100;
const EMPTY_HISTORY: EditHistory = { past: [], future: [], lastKey: null };

/** 지금 시나리오 탭 스냅샷 (참조만 — 초안 / 글자는 불변 객체) */
export function scenarioSnapshot(drafts: ConfigDrafts): ScenarioSnapshot {
  return { scenario: drafts.draft.scenario, fieldText: drafts.fieldText.scenario };
}

/** 시드는 되돌리기 / 취소 대상이 아니다 (REROLL은 적용 값까지 바로 바꾸므로 초안만 되돌리면 적용 안 된 수정이 생김) */
function withSeedOf(scenario: ScenarioConfig, from: ScenarioConfig): ScenarioConfig {
  const next = { ...scenario };
  if (from.rngSeed === undefined) delete next.rngSeed;
  else next.rngSeed = from.rngSeed;
  return next;
}

/** 스냅샷을 시나리오 탭으로 (시드는 지금 값 유지) */
export function restoreScenarioSnapshot(drafts: ConfigDrafts, snapshot: ScenarioSnapshot): ConfigDrafts {
  const next = editDraft(drafts, 'scenario', withSeedOf(snapshot.scenario, drafts.draft.scenario));
  return { ...next, fieldText: { ...next.fieldText, scenario: { ...snapshot.fieldText } } };
}

/** 시나리오 탭 EDIT ON FIELD: 지금 시나리오 / 칸 글자를 기억하고 시나리오 필드 편집 모드로 (이미 그 모드면 그대로) */
export function openScenarioEdit(current: FieldEdit | null, drafts: ConfigDrafts): ScenarioFieldEdit {
  if (current?.mode === 'SCENARIO') return current;
  return { mode: 'SCENARIO', entry: scenarioSnapshot(drafts), history: EMPTY_HISTORY };
}

/**
 * 모드 중 시나리오 탭 변경을 되돌리기 기록에 남김: before → after가 같으면 그대로. key(숫자 칸 키)가 직전 단계와 같으면
 * 한 단계로 묶음(처음 입력 전 값이 이미 기록됨). 새 단계는 다시 하기 기록을 지운다
 */
export function recordScenarioChange(edit: ScenarioFieldEdit, before: ScenarioSnapshot, after: ScenarioSnapshot, key: string | null = null): ScenarioFieldEdit {
  if (deepEqual(before, after)) return edit;
  const { history } = edit;
  if (key !== null && key === history.lastKey) return history.future.length === 0 ? edit : { ...edit, history: { ...history, future: [] } };
  const past = [...history.past, before].slice(-EDIT_HISTORY_LIMIT);
  return { ...edit, history: { past, future: [], lastKey: key } };
}

/** 되돌리기 (Ctrl / ⌘ + Z): 기록이 없으면 null */
export function undoScenarioEdit(edit: ScenarioFieldEdit, drafts: ConfigDrafts): { edit: ScenarioFieldEdit; drafts: ConfigDrafts } | null {
  const { past, future } = edit.history;
  if (past.length === 0) return null;
  const target = past[past.length - 1];
  return {
    edit: { ...edit, history: { past: past.slice(0, -1), future: [...future, scenarioSnapshot(drafts)], lastKey: null } },
    drafts: restoreScenarioSnapshot(drafts, target),
  };
}

/** 다시 하기 (Ctrl / ⌘ + Shift + Z, Ctrl + Y): 기록이 없으면 null */
export function redoScenarioEdit(edit: ScenarioFieldEdit, drafts: ConfigDrafts): { edit: ScenarioFieldEdit; drafts: ConfigDrafts } | null {
  const { past, future } = edit.history;
  if (future.length === 0) return null;
  const target = future[future.length - 1];
  return {
    edit: { ...edit, history: { past: [...past, scenarioSnapshot(drafts)].slice(-EDIT_HISTORY_LIMIT), future: future.slice(0, -1), lastKey: null } },
    drafts: restoreScenarioSnapshot(drafts, target),
  };
}

/**
 * CANCEL / Esc / START: 진영 / RP 기준값 / 시드를 뺀 시나리오와 시나리오 칸 글자를 들어오기 전으로.
 * 모드 중 진영을 바꿨으면 들어오기 전 값을 새 진영으로 점대칭 (지정 시작 자세 / 바닥 기물 / 상향 셀, setAlliance)
 */
export function cancelScenarioEdit(drafts: ConfigDrafts, edit: ScenarioFieldEdit): ConfigDrafts {
  const current = drafts.draft.scenario;
  const scenario = setAlliance(edit.entry.scenario, current.allianceColor);
  const next: ScenarioConfig = { ...scenario };
  if (current.rpThresholds === undefined) delete next.rpThresholds;
  else next.rpThresholds = current.rpThresholds;
  return restoreScenarioSnapshot(drafts, { scenario: next, fieldText: edit.entry.fieldText });
}

/** 그 로봇이 걸린 배치 문제 (놓기 거부 / 사유 토스트, 14-1a): 필드 밖 / HIVE 기둥 / FLOWER / 다른 로봇 / 고정 기물과 겹침 */
export function robotPlacementIssues(values: DraftValues, robot: RobotId): ScenarioFormIssue[] {
  return scenarioFormIssues(values).filter(issue => issue.code.startsWith('PLACEMENT_') && issue.fields.includes(`spawn.${robot}`));
}

/**
 * 로봇 끌기를 놓음: 끌어서 정한 자세(lastPose, 움직이지 않았으면 null)가 그 로봇을 겹치게 하면 끌기 전(before)으로 되돌리고 사유를 돌려준다.
 * 끄는 동안의 초안은 화면 표시용이므로 놓을 때 이 결과로 확정한다
 */
export function finishRobotDrag(
  drafts: ConfigDrafts,
  robot: RobotId,
  before: ScenarioSnapshot,
  lastPose: RobotPose | null,
): { drafts: ConfigDrafts; refused: ScenarioFormIssue[] } {
  if (!lastPose) return { drafts: restoreScenarioSnapshot(drafts, before), refused: [] };
  const placed = placeSpawn(restoreScenarioSnapshot(drafts, before), robot, lastPose);
  const refused = robotPlacementIssues(placed.draft, robot);
  return refused.length > 0 ? { drafts: restoreScenarioSnapshot(drafts, before), refused } : { drafts: placed, refused: [] };
}

// ------------------------------------------------------------
// 바닥 기물 (14-1b): 추가 / 끌어 옮기기 / 필드 밖으로 끌어 빼기, 겹친 자리에는 놓지 않음
// ------------------------------------------------------------

/** 바닥 기물 잡기 여유 (inch): 기물이 작아(POLLEN 반지름 1.4 in ≈ 화면 5 px) 반지름에 더한다 */
export const FLOOR_PIECE_HIT_SLOP = 1;

/** 놓지 않는 사유: 놓을 기물 없음 / 위치 규칙(필드 밖 · HIVE 기둥 · FLOWER · GARDEN) / 다른 지정 기물 / 로봇 몸체와 겹침 */
export type FloorRefusal = { code: 'NONE_LEFT'; piece: PieceType } | { code: 'POSITION' } | { code: 'OVERLAP' } | { code: 'ROBOT'; robot: RobotId };

/** 종류별로 바닥에 더 놓을 수 있는 수 = 바닥 기물 수 − 지정 수 (음수는 0) */
export function floorRemaining(values: DraftValues): Record<PieceType, number> {
  const f = floorSummary(readScenario(values.scenario, values.robot1.config, values.robot2.config));
  return { POLLEN: f.scatterPollen, NECTAR: f.scatterNectar };
}

/** 지정 바닥 기물 k번이 놓일 수 없는 사유 (엔진 검증과 같은 기준: 위치 규칙, 다른 지정 기물과 겹침, 로봇 몸체 파고듦) */
export function floorPieceRefusal(values: DraftValues, index: number): FloorRefusal | null {
  const pieces = values.scenario.floorPieces ?? [];
  const piece = pieces[index];
  if (!piece || !isFloorPiecePositionValid(piece)) return { code: 'POSITION' };
  const r = PIECE_PHYSICS[piece.type].radius;
  if (pieces.some((q, k) => k !== index && Math.hypot(q.x - piece.x, q.y - piece.y) < r + PIECE_PHYSICS[q.type].radius)) return { code: 'OVERLAP' };
  const robots = spawnRobots(values);
  const circle = { center: { x: piece.x, y: piece.y }, radius: r };
  for (const robot of ['robot1', 'robot2'] as const) {
    const hit = testOBBvsCircle(getRobotOBB(robots[robot].pose, robots[robot].size), circle);
    if (hit.colliding && hit.depth > PLACEMENT_TOLERANCE) return { code: 'ROBOT', robot };
  }
  return null;
}

/** 문제가 있는 지정 바닥 기물 번호 (빨간 표시): 위치 / 겹침 / 로봇 + 바닥 기물 수 초과(FLOOR_PIECE_COUNT, 뒤에서부터) */
export function badFloorPieces(values: DraftValues): Set<number> {
  const bad = new Set<number>();
  (values.scenario.floorPieces ?? []).forEach((_, k) => {
    if (floorPieceRefusal(values, k)) bad.add(k);
  });
  // 바닥 기물 수 초과(FLOOR_PIECE_COUNT): 그 종류의 넘는 기물만 뒤에서부터 (엔진 acceptedFloorPieces가 빼는 쪽)
  const f = floorSummary(readScenario(values.scenario, values.robot1.config, values.robot2.config));
  const capacity: Record<PieceType, number> = { POLLEN: f.floorPollen, NECTAR: f.floorNectar };
  for (const type of ['POLLEN', 'NECTAR'] as const) {
    const indices = (values.scenario.floorPieces ?? []).flatMap((p, k) => (p.type === type ? [k] : []));
    for (const k of indices.slice(capacity[type])) bad.add(k);
  }
  return bad;
}

const roundPoint = (p: Point) => ({ x: round1(p.x), y: round1(p.y) });
const clampInt = (n: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));

function withFloorPieces(drafts: ConfigDrafts, pieces: FloorPiecePlacement[]): ConfigDrafts {
  const scenario = { ...drafts.draft.scenario, floorPieces: pieces };
  return editDraft(drafts, 'scenario', scenario);
}

/** 추가 (추가 상태에서 바닥 클릭): 놓을 기물이 없거나 겹치는 자리면 그대로 + 사유, 아니면 지정 목록 끝에 (0.1 in 반올림) */
export function addFloorPiece(drafts: ConfigDrafts, type: PieceType, at: Point): { drafts: ConfigDrafts; refusal: FloorRefusal | null } {
  if (floorRemaining(drafts.draft)[type] <= 0) return { drafts, refusal: { code: 'NONE_LEFT', piece: type } };
  const pieces = [...(drafts.draft.scenario.floorPieces ?? []), { type, ...roundPoint(at) }];
  const next = withFloorPieces(drafts, pieces);
  const refusal = floorPieceRefusal(next.draft, pieces.length - 1);
  return refusal ? { drafts, refusal } : { drafts: next, refusal: null };
}

/** 놓지 않은 사유 문구 (토스트): 놓을 기물 없음은 그대로, 나머지는 "놓지 않음 — 사유" */
export function floorRefusalText(refusal: FloorRefusal, lang: Language): string {
  if (refusal.code === 'NONE_LEFT') return t(lang, 'edit.floor.noneLeft', { piece: refusal.piece });
  const reason = t(lang, `edit.floor.reason.${refusal.code}`, { robot: refusal.code === 'ROBOT' ? (refusal.robot === 'robot1' ? 'R1' : 'R2') : '' });
  return t(lang, 'edit.scenario.refused', { reason });
}

/** 누른 점이 잡는 지정 바닥 기물 번호 (나중에 놓은 것 우선, 여유 FLOOR_PIECE_HIT_SLOP). 없으면 null */
export function floorPieceHitTest(pieces: readonly FloorPiecePlacement[], p: Point): number | null {
  for (let k = pieces.length - 1; k >= 0; k--) {
    const q = pieces[k];
    if (Math.hypot(q.x - p.x, q.y - p.y) <= PIECE_PHYSICS[q.type].radius + FLOOR_PIECE_HIT_SLOP) return k;
  }
  return null;
}

/** 필드 밖(여백)에 놓으면 그 기물을 뺀다 */
export function isOffField(p: Point): boolean {
  return p.x < 0 || p.x > FIELD_SIZE || p.y < 0 || p.y > FIELD_SIZE;
}

/** 끄는 중: 누른 점 대비 이동량만큼 옮긴 자리 (0.1 in 반올림, 필드 밖도 그대로 — 놓으면 빼기) */
export function dragFloorPoint(start: Point, pointerStart: Point, pointer: Point): Point {
  return roundPoint({ x: start.x + pointer.x - pointerStart.x, y: start.y + pointer.y - pointerStart.y });
}

/** 끄는 중 초안 (화면 표시용): k번 기물을 그 자리로 */
export function moveFloorPiece(drafts: ConfigDrafts, index: number, at: Point): ConfigDrafts {
  const pieces = [...(drafts.draft.scenario.floorPieces ?? [])];
  if (!pieces[index]) return drafts;
  pieces[index] = { type: pieces[index].type, x: at.x, y: at.y };
  return withFloorPieces(drafts, pieces);
}

/**
 * 바닥 기물 끌기를 놓음: 움직이지 않았으면 그대로, 필드 밖이면 뺌, 겹치는 자리면 끌기 전(before)으로 + 사유.
 * pointer = 놓은 포인터의 필드 좌표 (빼기 판정), lastPoint = 끌어서 정한 기물 자리
 */
export function finishFloorDrag(
  drafts: ConfigDrafts,
  index: number,
  before: ScenarioSnapshot,
  lastPoint: Point | null,
  pointer: Point | null,
): { drafts: ConfigDrafts; refusal: FloorRefusal | null; removed: boolean } {
  const base = restoreScenarioSnapshot(drafts, before);
  if (!lastPoint) return { drafts: base, refusal: null, removed: false };
  const pieces = [...(base.draft.scenario.floorPieces ?? [])];
  if ((pointer && isOffField(pointer)) || isOffField(lastPoint)) {
    pieces.splice(index, 1);
    return { drafts: withFloorPieces(base, pieces), refusal: null, removed: true };
  }
  const moved = moveFloorPiece(base, index, lastPoint);
  const refusal = floorPieceRefusal(moved.draft, index);
  return refusal ? { drafts: base, refusal, removed: false } : { drafts: moved, refusal: null, removed: false };
}

/**
 * 오토 TIP NECTAR 자리 (14-1b, 표시용): 엔진 reset과 같은 슬롯 순서(humanNectarSlots)로, GARDEN 기물 / 위치가 올바른 지정 바닥 기물 /
 * 앞서 놓인 NECTAR / 로봇 몸체(초안 자세)와 겹치지 않는 첫 슬롯부터. 빈 슬롯이 모자라면 놓인 것만 (엔진은 남은 수를 대기)
 */
export function autoTipNectarSpots(values: DraftValues): Point[] {
  const view = readScenario(values.scenario, values.robot1.config, values.robot2.config);
  const count = Math.min(INITIAL_HUMAN_NECTAR_STOCK, Math.max(0, Number.isFinite(view.autoTipCount) ? Math.floor(view.autoTipCount) : 0));
  if (count === 0) return [];
  const opponent = view.alliance === 'RED' ? 'BLUE' : 'RED';
  const gardenCount = (n: number) => Math.min(8, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  const occupied = [
    ...gardenPiecePositions(view.alliance, gardenCount(view.garden.ally)),
    ...gardenPiecePositions(opponent, gardenCount(view.garden.opponent)),
  ].map(c => ({ ...c, r: PIECE_PHYSICS.POLLEN.radius }));
  for (const p of view.floorPieces.filter(isFloorPiecePositionValid)) occupied.push({ x: p.x, y: p.y, r: PIECE_PHYSICS[p.type].radius });
  const robots = spawnRobots(values);
  const bodies = (['robot1', 'robot2'] as const).map(id => getRobotOBB(robots[id].pose, robots[id].size));
  const r = PIECE_PHYSICS.NECTAR.radius;
  const out: Point[] = [];
  for (const slot of humanNectarSlots(view.alliance)) {
    if (out.length >= count) break;
    if (occupied.some(o => Math.hypot(o.x - slot.x, o.y - slot.y) < o.r + r)) continue;
    if (bodies.some(body => testOBBvsCircle(body, { center: slot, radius: r }).colliding)) continue;
    out.push({ x: slot.x, y: slot.y });
    occupied.push({ x: slot.x, y: slot.y, r });
  }
  return out;
}

// ------------------------------------------------------------
// HIVE / FLOWER / GARDEN 팝오버 (14-1c): 클릭한 대상 옆 개수 조절기 (탭과 같은 범위 / 검증)
// ------------------------------------------------------------

/** 팝오버 대상: 우리 HIVE(상향 셀 / 개수), FLOWER k(FLOWER_CIRCLES 순서), GARDEN 우리 / 상대, 로봇(적재물 / 오토 이동, 14-1d — 끌지 않고 클릭) */
export type ScenarioTarget = { kind: 'HIVE' } | { kind: 'FLOWER'; index: number } | { kind: 'GARDEN'; side: 'ally' | 'opponent' } | { kind: 'ROBOT'; robot: RobotId };

/** 대상 잡기 여유 (inch): FLOWER 원(반지름 2 in) / GARDEN(폭 2 in)은 작아서 넓혀 잡는다 */
export const TARGET_HIT_SLOP = 3;

const inBox = (p: Point, box: { minX: number; maxX: number; minY: number; maxY: number }, slop = 0) =>
  p.x >= box.minX - slop && p.x <= box.maxX + slop && p.y >= box.minY - slop && p.y <= box.maxY + slop;

/** 우리 HIVE 두 셀을 합친 영역 (셀 박스 = 렌더러 hiveCellBox와 같은 칸) */
export function allyHiveBox(alliance: 'RED' | 'BLUE'): { minX: number; maxX: number; minY: number; maxY: number } {
  const a = FIELD_LAYOUT.hiveCells[alliance].OPPOSITE_CELL;
  const b = FIELD_LAYOUT.hiveCells[alliance].AUDIENCE_CELL;
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x + a.width, b.x + b.width), minY: Math.min(a.y, b.y), maxY: Math.max(a.y + a.height, b.y + b.height) };
}

/** 누른 점의 팝오버 대상 (FLOWER 원 / 게이지 → GARDEN → 우리 HIVE). 없으면 null */
export function scenarioTargetHitTest(alliance: 'RED' | 'BLUE', p: Point): ScenarioTarget | null {
  for (let k = 0; k < FLOWER_CIRCLES.length; k++) {
    const c = FLOWER_CIRCLES[k];
    if (Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius + TARGET_HIT_SLOP || inBox(p, flowerGaugeLayout(k).rect, 1)) return { kind: 'FLOWER', index: k };
  }
  for (const side of ['RED', 'BLUE'] as const) {
    if (inBox(p, GARDEN_AABB[side], TARGET_HIT_SLOP)) return { kind: 'GARDEN', side: side === alliance ? 'ally' : 'opponent' };
  }
  if (inBox(p, allyHiveBox(alliance))) return { kind: 'HIVE' };
  return null;
}

/**
 * 팝오버를 붙일 필드 좌표 + 펼칠 방향: FLOWER / GARDEN = 대상 가운데에서 필드 위쪽 절반이면 아래로 / 아래쪽 절반이면 위로,
 * HIVE = 우리 셀 아래 가장자리에서 아래로 (위로 펼치면 필드 위쪽의 안내 띠와 겹침), 로봇 = 몸체 외접원 끝에서 같은 규칙 (14-1d)
 */
export function scenarioTargetAnchor(values: DraftValues, target: ScenarioTarget): Point & { below: boolean } {
  const alliance = values.scenario.allianceColor;
  const half = FIELD_SIZE / 2;
  if (target.kind === 'FLOWER') {
    const c = FLOWER_CIRCLES[target.index].center;
    return { x: c.x, y: c.y, below: c.y < half };
  }
  if (target.kind === 'GARDEN') {
    const box = GARDEN_AABB[target.side === 'ally' ? alliance : alliance === 'RED' ? 'BLUE' : 'RED'];
    const y = (box.minY + box.maxY) / 2;
    return { x: (box.minX + box.maxX) / 2, y, below: y < half };
  }
  if (target.kind === 'ROBOT') {
    const { pose, size } = spawnRobots(values)[target.robot];
    const r = Math.hypot(size.length, size.width) / 2;
    const below = pose.y < half;
    return { x: pose.x, y: below ? pose.y + r : pose.y - r, below };
  }
  const box = allyHiveBox(alliance);
  return { x: (box.minX + box.maxX) / 2, y: box.maxY, below: true };
}

export const sameTarget = (a: ScenarioTarget | null, b: ScenarioTarget | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind !== 'FLOWER' || a.index === (b as { index: number }).index) &&
    (a.kind !== 'GARDEN' || a.side === (b as { side: string }).side) &&
    (a.kind !== 'ROBOT' || a.robot === (b as { robot: RobotId }).robot));

/** 그 로봇 팝오버에 보일 문제 (적재물 / 오토 이동, 14-1d) */
export function robotPopoverIssues(values: DraftValues, robot: RobotId): ScenarioFormIssue[] {
  return scenarioFormIssues(values).filter(issue => issue.robot === robot && issue.fields.some(f => f === `loadout.${robot}` || f === `autoMove.${robot}`));
}

/** 두 로봇의 초안 시작 자세 / 크기 (끌기 판정 / 장면) */
export function spawnRobots(values: DraftValues): Record<SpawnRobotId, { pose: RobotPose; size: { length: number; width: number } }> {
  const view = readScenario(values.scenario, values.robot1.config, values.robot2.config);
  const size = (robot: RobotId) => ({ length: values[robot].config.length, width: values[robot].config.width });
  return { robot1: { pose: view.spawn.robot1, size: size('robot1') }, robot2: { pose: view.spawn.robot2, size: size('robot2') } };
}

const round1 = (v: number) => Math.round(v * 10) / 10; // 소수 1자리 (v / 0.1 * 0.1은 40.300000000000004 같은 잔여가 남음)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;

/**
 * 끌기 중 자세 (스냅 없음 — 표시 자리수 0.1 in / 0.1°로만 반올림):
 * 몸체 = 누른 점 대비 이동량만큼 옮김 (좌표 칸 범위 0 ~ 144로 제한), 핸들 = 로봇 중심 → 포인터 방향 (0° = +x, 관중석 시점 시계 방향 +)
 */
export function dragSpawnPose(start: RobotPose, part: SpawnPart, pointerStart: Point, pointer: Point): RobotPose {
  if (part === 'body') {
    const { min, max } = SPAWN_FIELD_SPECS.x;
    return {
      x: round1(clamp(start.x + pointer.x - pointerStart.x, min, max)),
      y: round1(clamp(start.y + pointer.y - pointerStart.y, min, max)),
      heading: start.heading,
    };
  }
  const dx = pointer.x - start.x;
  const dy = pointer.y - start.y;
  if (Math.hypot(dx, dy) < 1e-6) return start;
  return { x: start.x, y: start.y, heading: normalizeHeading(round1(Math.atan2(dy, dx) / DEG) * DEG) };
}

/** 끌어서 정한 자세를 초안으로 + 그 로봇 시작 자세 칸의 틀린 글자 지움 (겹쳐도 놓임 — 빨간 표시) */
export function placeSpawn(drafts: ConfigDrafts, robot: RobotId, pose: RobotPose): ConfigDrafts {
  let next = editDraft(drafts, 'scenario', setSpawnPose(drafts.draft.scenario, robot, pose));
  for (const axis of SPAWN_AXES) next = setFieldText(next, 'scenario', spawnFieldKey(robot, axis), null);
  return next;
}

/** 시나리오 필드 편집 장면의 화면 상태 (14-1b): 바닥 기물 강조 / 추가 미리보기 */
export interface ScenarioSceneUi {
  floorActive?: { index: number; state: 'HOVER' | 'DRAG' | 'REMOVE' } | null;
  addPreview?: { type: PieceType; x: number; y: number; valid: boolean } | null;
  target?: ScenarioTarget | null; // 팝오버가 열린 / 마우스를 올린 대상 (14-1c, 주황 점선)
}

/**
 * 시나리오 필드 편집 장면: 초안 진영 / 두 로봇(자세 · 크기 · 흡입 구역 · 배치 검증) / GARDEN 기물(엔진과 같은 좌표) / 강조 부분,
 * 지정 바닥 기물(문제 표시) / 오토 TIP NECTAR 자리 / 바닥 기물 강조 · 추가 미리보기 (14-1b)
 */
export function scenarioEditScene(values: DraftValues, active: { robot: SpawnRobotId; part: SpawnPart } | null, ui: ScenarioSceneUi = {}): ScenarioEditScene {
  const view = readScenario(values.scenario, values.robot1.config, values.robot2.config);
  // 배치 문제 + 오토 PARK인데 LOADING ZONE 밖(14-1d) = 빨간 표시
  const parkOutside = scenarioFormIssues(values).filter(i => i.code === 'AUTO_PARK_NOT_IN_ZONE').flatMap(i => (i.robot ? [i.robot] : []));
  const bad = new Set([...validateRobotPlacement(values.scenario, values.robot1.config, values.robot2.config).flatMap(i => i.robots), ...parkOutside]);
  const opponent = view.alliance === 'RED' ? 'BLUE' : 'RED';
  const count = (n: number) => Math.min(8, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  // 적재물 (14-1d): 앞에서부터 받침 칸 (한도만큼 빈 칸), 다음에 발사할 기물 강조 = 경기 장면과 같은 규칙
  const robot = (id: SpawnRobotId) => {
    const config = values[id].config;
    const loadout = view.loadout[id];
    return {
      pose: view.spawn[id],
      config,
      bad: bad.has(id),
      loadout,
      capacity: getCarryCapacity(config),
      next: carriedHighlightIndex(config, loadout.map(type => ({ type }))),
    };
  };
  const badFloor = badFloorPieces(values);
  return {
    mode: 'SCENARIO',
    alliance: view.alliance,
    robots: { robot1: robot('robot1'), robot2: robot('robot2') },
    gardenPieces: [...gardenPiecePositions(view.alliance, count(view.garden.ally)), ...gardenPiecePositions(opponent, count(view.garden.opponent))],
    active,
    floorPieces: view.floorPieces.map((p, k) => ({ ...p, bad: badFloor.has(k) })),
    floorActive: ui.floorActive ?? null,
    autoTipNectar: autoTipNectarSpots(values),
    addPreview: ui.addPreview ?? null,
    // 14-1c: FLOWER 게이지 / HIVE 상향 셀 내용 / NECTAR 재고 게이지 (엔진과 같이 범위로 자름), 강조 대상
    flowers: view.flowers.map(n => clampInt(n, FLOWER_MAX_START_PIECES)),
    hive: { upwardCell: view.hiveUpwardCell, nectar: clampInt(view.hiveNectar, NECTAR_IN_PLAY), pollen: clampInt(view.hivePollen, TOTAL_POLLEN) },
    stock: INITIAL_HUMAN_NECTAR_STOCK - clampInt(view.autoTipCount, INITIAL_HUMAN_NECTAR_STOCK),
    target: ui.target ?? null,
    parkZone: view.autoMovement.robot1 === 'PARK' || view.autoMovement.robot2 === 'PARK',
  };
}

/**
 * 히트맵 모드 장면: 적용한 설정의 기준 셀 LUT(보고 있는 기물, 생성 중이면 조립 중 버퍼)를 진영 기준으로.
 * 스윗스팟 표시도 적용한 값 (LUT와 같은 설정, 13-4: 그 기물을 쏘는 슈터의 스윗스팟) — 초안이 다르면 화면이 "적용하면 새로 만듦"을 안내한다.
 */
export function heatmapEditScene(
  alliance: 'RED' | 'BLUE',
  applied: RobotProfile,
  heatmap: { reference: ArrayLike<number>; rowsDone: ArrayLike<number> } | null,
  piece: PieceType = 'POLLEN',
): HeatmapEditScene {
  return {
    mode: 'HEATMAP',
    alliance,
    reference: heatmap?.reference ?? null,
    rowsDone: heatmap?.rowsDone ?? null,
    sweetSpot: readSweetSpot(applied, alliance, pieceShooterSlot(applied, piece)),
  };
}

/**
 * 스윗스팟 모드 장면: 그 슈터 자리의 초안 스윗스팟 / 로봇 크기 / 좌우 오프셋(몸체 방향) / 검증, 마우스를 올린 칸(+ 찍으면 올바른지),
 * 적용한 확률표(반투명)와 그 스윗스팟
 */
export function sweetSpotEditScene(
  alliance: 'RED' | 'BLUE',
  draft: RobotProfile,
  applied: RobotProfile,
  heatmap: { reference: ArrayLike<number>; rowsDone: ArrayLike<number> } | null,
  hover: Point | null,
  slot: ShooterSlot = 'MAIN',
): SweetSpotEditScene {
  const lateral = slotBallistics(draft, slot).shooterLateralOffset;
  return {
    mode: 'SWEET_SPOT',
    alliance,
    reference: heatmap?.reference ?? null,
    rowsDone: heatmap?.rowsDone ?? null,
    sweetSpot: readSweetSpot(draft, alliance, slot),
    sweetSpotValid: sweetSpotIssueCodes(draft, slot).length === 0,
    appliedSweetSpot: readSweetSpot(applied, alliance, slot),
    robotSize: { length: draft.config.length, width: draft.config.width },
    lateralOffset: Number.isFinite(lateral) ? lateral : 0,
    hover: hover ? { x: hover.x, y: hover.y, valid: sweetSpotCandidateIssues(draft, alliance, hover, slot).length === 0 } : null,
  };
}
