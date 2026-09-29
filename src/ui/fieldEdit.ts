// 필드 편집 모드 규칙 (명세서 3.8 필드 편집 모드, 09-10b / 09-10c): React / DOM 비의존
// - config 창의 버튼으로 메인 필드를 편집 모드로 바꾼다. 경기 전(SETUP)에만, 한 번에 한 모드만.
// - 09-10b 히트맵(HEATMAP): 로봇 탭 SHOW HIT MAP. 적용한 설정의 명중 확률표를 시나리오 초안 진영 기준으로 보여 주고 기물 종류를 바꿔 본다.
//   편집하는 값이 없으므로 DONE / Esc = 닫기.
// - 09-10c 스윗스팟(SWEET_SPOT): 로봇 탭 SET ON FIELD. 필드 클릭 = 그 격자 중심으로 스윗스팟 초안 (검증 실패 칸도 찍히고 빨간 오류),
//   모드는 계속 유지. DONE = 그 로봇 탭 APPLY까지 (적용할 수 없으면 초안에만), CANCEL / Esc / START = 모드에 들어오기 전 값으로 되돌림.
// - 편집 모드를 연 탭을 떠나거나(다른 탭 / 창 닫기 / 다른 모드) 경기 전이 아니게 되면 편집 모드를 끝낸다 (찍은 초안은 그대로).

import { FIELD_SIZE } from '../core/collision';
import type { AppPhase } from '../app/appController';
import type { RobotId } from '../input/inputConfig';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import type { HeatmapEditScene, SweetSpotEditScene } from '../renderer/editSceneRenderer';
import { canApply, editDraft, setFieldText, tabStatus } from './configDraft';
import type { ConfigDrafts, ConfigTab } from './configDraft';
import { SWEET_SPOT_AXES, readSweetSpot, robotProfileIssues, sweetSpotFieldKey, writeSweetSpot } from './robotForm';
import type { RobotProfile } from './robotForm';

export type FieldEditMode = 'HEATMAP' | 'SWEET_SPOT';

export interface HeatmapFieldEdit {
  mode: 'HEATMAP';
  robot: RobotId;
  piece: PieceType; // 보고 있는 기물 종류
}

export interface SweetSpotFieldEdit {
  mode: 'SWEET_SPOT';
  robot: RobotId;
  piece: PieceType; // 반투명 히트맵의 기물 종류
  /** 모드에 들어올 때의 초안 스윗스팟(기준 셀 좌표) + 스윗스팟 칸의 틀린 입력 글자 (CANCEL 복원용) */
  entry: { sweetSpot: { x: number; y: number }; fieldText: Partial<Record<'x' | 'y', string>> };
}

export type FieldEdit = HeatmapFieldEdit | SweetSpotFieldEdit;

type Point = { x: number; y: number };

/** 로봇 탭 SHOW HIT MAP: 그 로봇 히트맵이 이미 열려 있으면 닫고(null), 아니면 연다 (다른 모드는 닫고 전환, 기본 POLLEN) */
export function toggleHeatmapEdit(current: FieldEdit | null, robot: RobotId): FieldEdit | null {
  if (current?.mode === 'HEATMAP' && current.robot === robot) return null;
  return { mode: 'HEATMAP', robot, piece: 'POLLEN' };
}

/** 로봇 탭 SET ON FIELD: 지금 초안 스윗스팟 / 틀린 글자를 기억하고 스윗스팟 모드로 (이미 그 로봇 스윗스팟 모드면 그대로) */
export function openSweetSpotEdit(current: FieldEdit | null, drafts: ConfigDrafts, robot: RobotId): FieldEdit {
  if (current?.mode === 'SWEET_SPOT' && current.robot === robot) return current;
  const texts = drafts.fieldText[robot];
  const fieldText: Partial<Record<'x' | 'y', string>> = {};
  for (const axis of SWEET_SPOT_AXES) {
    const text = texts[sweetSpotFieldKey(axis)];
    if (text !== undefined) fieldText[axis] = text;
  }
  const spot = drafts.draft[robot].ballistics.sweetSpot;
  return { mode: 'SWEET_SPOT', robot, piece: current?.piece ?? 'POLLEN', entry: { sweetSpot: { x: spot.x, y: spot.y }, fieldText } };
}

/** 편집 모드를 유지할 수 있는지: 경기 전 SETUP + config 창이 펼쳐져 있고 편집을 연 로봇 탭이 보이는 동안 */
export function fieldEditStays(edit: FieldEdit, ctx: { phase: AppPhase; configOpen: boolean; tab: ConfigTab }): boolean {
  return ctx.phase === 'SETUP' && ctx.configOpen && ctx.tab === edit.robot;
}

/** 필드 좌표(관중석 시점) → 그 점을 담는 1 in 격자의 중심. 필드 밖(여백)이면 null (클릭 무시) */
export function fieldGridCell(p: Point): Point | null {
  if (!(p.x >= 0 && p.x < FIELD_SIZE && p.y >= 0 && p.y < FIELD_SIZE)) return null;
  return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
}

/** 진영 기준 격자 중심을 초안 스윗스팟으로 (두 축 모두, 보관은 기준 셀 좌표) */
export function placeSweetSpot(profile: RobotProfile, alliance: 'RED' | 'BLUE', cell: Point): RobotProfile {
  return writeSweetSpot(writeSweetSpot(profile, alliance, 'x', cell.x), alliance, 'y', cell.y);
}

/** 스윗스팟 검증 사유 (로봇 탭과 같은 규칙: 다른 칸이 모두 올바를 때만 필드 밖 / HIVE / 해 없음) */
export function sweetSpotIssueCodes(profile: RobotProfile): string[] {
  return robotProfileIssues(profile)
    .map(issue => issue.code)
    .filter(code => code.startsWith('SWEET_SPOT_'));
}

/** 마우스를 올린 칸에 찍으면 생기는 사유 (찍기 전 미리 보기) */
export function sweetSpotCandidateIssues(profile: RobotProfile, alliance: 'RED' | 'BLUE', cell: Point): string[] {
  return sweetSpotIssueCodes(placeSweetSpot(profile, alliance, cell));
}

/** 필드 클릭: 초안 스윗스팟을 그 칸으로 + 스윗스팟 칸의 틀린 글자 지움 (검증 실패 칸도 찍힘 — 빨간 오류로 표시, 09-10c 확정) */
export function clickSweetSpot(drafts: ConfigDrafts, robot: RobotId, alliance: 'RED' | 'BLUE', cell: Point): ConfigDrafts {
  let next = editDraft(drafts, robot, placeSweetSpot(drafts.draft[robot], alliance, cell));
  for (const axis of SWEET_SPOT_AXES) next = setFieldText(next, robot, sweetSpotFieldKey(axis), null);
  return next;
}

/** CANCEL / Esc / START: 초안 스윗스팟과 스윗스팟 칸의 틀린 글자를 모드에 들어오기 전으로 (다른 칸은 그대로) */
export function cancelSweetSpotEdit(drafts: ConfigDrafts, edit: SweetSpotFieldEdit): ConfigDrafts {
  const profile = drafts.draft[edit.robot];
  let next = editDraft(drafts, edit.robot, { ...profile, ballistics: { ...profile.ballistics, sweetSpot: { ...edit.entry.sweetSpot } } });
  for (const axis of SWEET_SPOT_AXES) next = setFieldText(next, edit.robot, sweetSpotFieldKey(axis), edit.entry.fieldText[axis] ?? null);
  return next;
}

/**
 * 스윗스팟 모드 DONE (09-10c 확정: 그 로봇 탭 APPLY까지): 적용할 수 있으면 APPLY, 틀린 칸이 있으면 초안에만 남기고 안내(KEEP_DRAFT),
 * 바뀐 것이 없으면 닫기만(CLOSE)
 */
export function sweetSpotDoneAction(drafts: ConfigDrafts, robot: RobotId): 'APPLY' | 'KEEP_DRAFT' | 'CLOSE' {
  if (canApply(drafts, robot)) return 'APPLY';
  return tabStatus(drafts, robot) === 'INVALID' ? 'KEEP_DRAFT' : 'CLOSE';
}

/**
 * 히트맵 모드 장면: 적용한 설정의 기준 셀 LUT(보고 있는 기물, 생성 중이면 조립 중 버퍼)를 진영 기준으로.
 * 스윗스팟 표시도 적용한 값 (LUT와 같은 설정) — 초안이 다르면 화면이 "적용하면 새로 만듦"을 안내한다.
 */
export function heatmapEditScene(
  alliance: 'RED' | 'BLUE',
  applied: RobotProfile,
  heatmap: { reference: ArrayLike<number>; rowsDone: ArrayLike<number> } | null,
): HeatmapEditScene {
  return {
    mode: 'HEATMAP',
    alliance,
    reference: heatmap?.reference ?? null,
    rowsDone: heatmap?.rowsDone ?? null,
    sweetSpot: readSweetSpot(applied, alliance),
  };
}

/**
 * 스윗스팟 모드 장면: 초안 스윗스팟 / 로봇 크기 / 검증, 마우스를 올린 칸(+ 찍으면 올바른지), 적용한 확률표(반투명)와 그 스윗스팟
 */
export function sweetSpotEditScene(
  alliance: 'RED' | 'BLUE',
  draft: RobotProfile,
  applied: RobotProfile,
  heatmap: { reference: ArrayLike<number>; rowsDone: ArrayLike<number> } | null,
  hover: Point | null,
): SweetSpotEditScene {
  return {
    mode: 'SWEET_SPOT',
    alliance,
    reference: heatmap?.reference ?? null,
    rowsDone: heatmap?.rowsDone ?? null,
    sweetSpot: readSweetSpot(draft, alliance),
    sweetSpotValid: sweetSpotIssueCodes(draft).length === 0,
    appliedSweetSpot: readSweetSpot(applied, alliance),
    robotSize: { length: draft.config.length, width: draft.config.width },
    hover: hover ? { x: hover.x, y: hover.y, valid: sweetSpotCandidateIssues(draft, alliance, hover).length === 0 } : null,
  };
}
