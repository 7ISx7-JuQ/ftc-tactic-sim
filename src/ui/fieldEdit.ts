// 필드 편집 모드 규칙 (명세서 3.8 필드 편집 모드, 09-10b): React / DOM 비의존
// - config 창의 버튼으로 메인 필드를 편집 모드로 바꾼다. 경기 전(SETUP)에만, 한 번에 한 모드만.
// - 09-10b = 히트맵(HEATMAP): 로봇 탭 SHOW HIT MAP. 적용한 설정의 명중 확률표를 시나리오 초안 진영 기준으로 보여 주고 기물 종류를 바꿔 본다.
//   편집하는 값이 없으므로 DONE / Esc = 닫기. (09-10c 스윗스팟 모드부터 DONE / CANCEL 구분)
// - 편집 모드를 연 탭을 떠나거나(다른 탭 / 창 닫기) 경기 전이 아니게 되면(START) 편집 모드를 끝낸다.

import type { AppPhase } from '../app/appController';
import type { RobotId } from '../input/inputConfig';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import type { HeatmapEditScene } from '../renderer/editSceneRenderer';
import type { ConfigTab } from './configDraft';
import { readSweetSpot } from './robotForm';
import type { RobotProfile } from './robotForm';

export type FieldEditMode = 'HEATMAP';

export interface HeatmapFieldEdit {
  mode: 'HEATMAP';
  robot: RobotId;
  piece: PieceType; // 보고 있는 기물 종류
}

export type FieldEdit = HeatmapFieldEdit;

/** 로봇 탭 SHOW HIT MAP: 그 로봇 히트맵이 이미 열려 있으면 닫고(null), 아니면 연다 (다른 모드는 닫고 전환, 기본 POLLEN) */
export function toggleHeatmapEdit(current: FieldEdit | null, robot: RobotId): FieldEdit | null {
  if (current?.mode === 'HEATMAP' && current.robot === robot) return null;
  return { mode: 'HEATMAP', robot, piece: 'POLLEN' };
}

/** 편집 모드를 유지할 수 있는지: 경기 전 SETUP + config 창이 펼쳐져 있고 편집을 연 로봇 탭이 보이는 동안 */
export function fieldEditStays(edit: FieldEdit, ctx: { phase: AppPhase; configOpen: boolean; tab: ConfigTab }): boolean {
  return ctx.phase === 'SETUP' && ctx.configOpen && ctx.tab === edit.robot;
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
