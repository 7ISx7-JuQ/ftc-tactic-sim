// LUT 생성 상태 표시 / START 막기 규칙 (명세서 3.8 로봇 제원 탭 "스윗스팟 → LUT", 접힌 config 띠, 09-10a): React / DOM 비의존
// - 관리자 상태(RobotLUTStatus)를 화면용 요약으로: 단계(준비 / 진행 / 오류 / 없음), 진행률, 남은 시간, 기물별 v0 · 스윗스팟 명중률.
// - 남은 시간 = 생성(GENERATING) 시작 후 처리 속도로 추정. 진행 2% · 0.5초 이상부터 표시.
// - START: 첫 문제(R1 탭 → R1 LUT → R2 탭 → R2 LUT → SCENARIO)가 있으면 막는다 (09-10 확정: LUT가 준비될 때까지 기다림).

import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import type { LUTGenState, RobotLUTStatus } from '../workers/lutManager';
import type { RobotId } from '../input/inputConfig';
import { DRAFT_TABS, deepEqual, tabStatus } from './configDraft';
import { t } from './i18n';
import type { Language } from './i18n';
import type { ConfigDrafts, DraftTab } from './configDraft';
import { profileBallisticsConfig } from './robotForm';
import type { RobotProfile } from './robotForm';

export type LutPhase = 'READY' | 'WORKING' | 'ERROR' | 'IDLE';

export interface RobotLutView {
  phase: LutPhase;
  state: LUTGenState;
  progress: number;                          // 0 ~ 1 (완료 격자 / 전체)
  remainingMs: number | null;                // 추정 남은 시간 (생성 중이고 추정 가능할 때만)
  searched: Record<PieceType, boolean>;
  v0: Record<PieceType, number | null>;
  hitRate: Record<PieceType, number>;
  fromCache: boolean;
  error: string | null;
}

/** 생성 시작 기록 (남은 시간 추정용): 그 세대에서 GENERATING을 처음 본 시각과 그때의 완료 격자 */
export interface LutTiming {
  generation: number;
  startedAt: number;
  startedCells: number;
}

/** 관리자가 아직 없을 때(첫 렌더)의 자리 채움: 대기 중 */
export const PENDING_LUT_VIEW: Readonly<RobotLutView> = {
  phase: 'WORKING',
  state: 'QUEUED',
  progress: 0,
  remainingMs: null,
  searched: { POLLEN: false, NECTAR: false },
  v0: { POLLEN: null, NECTAR: null },
  hitRate: { POLLEN: 0, NECTAR: 0 },
  fromCache: false,
  error: null,
};

export const ETA_MIN_PROGRESS = 0.02;
export const ETA_MIN_ELAPSED_MS = 500;

export function lutPhase(state: LUTGenState): LutPhase {
  switch (state) {
    case 'READY':
      return 'READY';
    case 'QUEUED':
    case 'SEARCHING':
    case 'GENERATING':
      return 'WORKING';
    case 'ERROR':
      return 'ERROR';
    default:
      return 'IDLE'; // IDLE(설정 없음 / 검증 실패), CANCELLED
  }
}

/** 타이밍 갱신: 생성 중인데 기록이 없거나 다른 세대면 지금부터 기록, 아니면 그대로 */
export function nextTiming(prev: LutTiming | null, status: Pick<RobotLUTStatus, 'state' | 'generation' | 'cellsDone'>, now: number): LutTiming | null {
  if (status.state !== 'GENERATING') return prev && prev.generation === status.generation ? prev : null;
  if (prev && prev.generation === status.generation) return prev;
  return { generation: status.generation, startedAt: now, startedCells: status.cellsDone };
}

/** 남은 시간 추정 (ms): 생성 시작 후 처리한 격자 속도로 나머지를 나눔. 진행 2% · 0.5초 미만이면 null */
export function estimateRemainingMs(timing: LutTiming | null, now: number, cellsDone: number, cellsTotal: number): number | null {
  if (!timing || cellsTotal <= 0) return null;
  const elapsed = now - timing.startedAt;
  const done = cellsDone - timing.startedCells;
  if (elapsed < ETA_MIN_ELAPSED_MS || done < ETA_MIN_PROGRESS * cellsTotal) return null;
  return Math.max(0, ((cellsTotal - cellsDone) * elapsed) / done);
}

export function lutView(status: RobotLUTStatus, timing: LutTiming | null, now: number): RobotLutView {
  const phase = lutPhase(status.state);
  return {
    phase,
    state: status.state,
    progress: status.cellsTotal > 0 ? Math.min(1, status.cellsDone / status.cellsTotal) : 0,
    remainingMs: status.state === 'GENERATING' ? estimateRemainingMs(timing, now, status.cellsDone, status.cellsTotal) : null,
    searched: { ...status.searched },
    v0: { ...status.v0 },
    hitRate: { ...status.sweetSpotHitRate },
    fromCache: status.fromCache,
    error: status.error,
  };
}

/** 초안과 적용 값의 LUT 입력(탄도 설정 + 로봇 크기)이 다른지: 다르면 "적용하면 새로 생성" 안내 */
export function lutInputsChanged(draft: RobotProfile, applied: RobotProfile): boolean {
  const input = (p: RobotProfile) => ({ ballistics: profileBallisticsConfig(p), length: p.config.length, width: p.config.width });
  return !deepEqual(input(draft), input(applied));
}

export type StartBlockReason = 'DIRTY' | 'INVALID' | 'LUT_WORKING' | 'LUT_ERROR' | 'LUT_IDLE';

/** START를 막는 첫 문제: R1 탭 → R1 LUT → R2 탭 → R2 LUT → SCENARIO. 없으면 null */
export function startBlocker(drafts: ConfigDrafts, luts: Readonly<Record<RobotId, LutPhase>>): { tab: DraftTab; reason: StartBlockReason } | null {
  for (const tab of DRAFT_TABS) {
    const status = tabStatus(drafts, tab);
    if (status !== 'OK') return { tab, reason: status };
    if (tab !== 'scenario' && luts[tab] !== 'READY') return { tab, reason: `LUT_${luts[tab] as Exclude<LutPhase, 'READY'>}` };
  }
  return null;
}

/** 상태 한 줄 (로봇 탭 / 접힌 띠 마우스 올림): "생성 중 63% · 약 7초 남음", "준비 완료 (저장된 결과)", "오류: …" */
export function lutStateText(lut: RobotLutView, lang: Language): string {
  switch (lut.state) {
    case 'READY':
      return t(lang, lut.fromCache ? 'lut.readyCached' : 'lut.READY');
    case 'GENERATING': {
      const head = t(lang, 'lut.GENERATING', { percent: Math.floor(lut.progress * 100) });
      if (lut.remainingMs === null) return head;
      return `${head} · ${t(lang, 'lut.remaining', { seconds: Math.max(1, Math.ceil(lut.remainingMs / 1000)) })}`;
    }
    case 'ERROR':
      return t(lang, 'lut.ERROR', { message: lut.error ?? '' });
    default:
      return t(lang, `lut.${lut.state}`);
  }
}
