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

import { FIELD_SIZE } from '../core/collision';
import type { AppPhase } from '../app/appController';
import type { RobotId } from '../input/inputConfig';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import { gardenPiecePositions, validateRobotPlacement } from '../core/simulationEngine';
import type { RobotPose, ScenarioConfig } from '../core/types';
import type { HeatmapEditScene, ScenarioEditScene, SweetSpotEditScene } from '../renderer/editSceneRenderer';
import type { SpawnPart, SpawnRobotId } from '../renderer/spawnEditLayout';
import { canApply, deepEqual, editDraft, setFieldText, tabStatus } from './configDraft';
import type { ConfigDrafts, ConfigTab, DraftTab, DraftValues } from './configDraft';
import { SPAWN_AXES, SPAWN_FIELD_SPECS, normalizeHeading, readScenario, scenarioFormIssues, setAlliance, setSpawnPose, spawnFieldKey } from './scenarioForm';
import type { ScenarioFormIssue } from './scenarioForm';
import { PIECE_TYPES, isPieceFireable } from '../core/ballistics';
import { SWEET_SPOT_AXES, readSweetSpot, robotProfileIssues, slotBallistics, sweetSpotFieldKey, writeSweetSpot } from './robotForm';
import type { RobotProfile, ShooterSlot } from './robotForm';

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

/** 시나리오 필드 편집 장면: 초안 진영 / 두 로봇(자세 · 크기 · 흡입 구역 · 배치 검증) / GARDEN 기물(엔진과 같은 좌표) / 강조 부분 */
export function scenarioEditScene(values: DraftValues, active: { robot: SpawnRobotId; part: SpawnPart } | null): ScenarioEditScene {
  const view = readScenario(values.scenario, values.robot1.config, values.robot2.config);
  const bad = new Set(validateRobotPlacement(values.scenario, values.robot1.config, values.robot2.config).flatMap(i => i.robots));
  const opponent = view.alliance === 'RED' ? 'BLUE' : 'RED';
  const count = (n: number) => Math.min(8, Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0));
  const robot = (id: SpawnRobotId) => ({ pose: view.spawn[id], config: values[id].config, bad: bad.has(id) });
  return {
    mode: 'SCENARIO',
    alliance: view.alliance,
    robots: { robot1: robot('robot1'), robot2: robot('robot2') },
    gardenPieces: [...gardenPiecePositions(view.alliance, count(view.garden.ally)), ...gardenPiecePositions(opponent, count(view.garden.opponent))],
    active,
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
