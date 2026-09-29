// LUT 생성 상태 표시 / START 막기 규칙 (명세서 3.8, 09-10a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import type { RobotLUTStatus } from '../../workers/lutManager';
import { editDraft, initialDrafts, setFieldText } from '../configDraft';
import { PENDING_LUT_VIEW, estimateRemainingMs, lutInputsChanged, lutPhase, lutStateText, lutView, nextTiming, startBlocker } from '../lutView';

const TOTAL = 2 * 144 * 144;
const status = (patch: Partial<RobotLUTStatus>): RobotLUTStatus => ({
  state: 'IDLE',
  generation: 1,
  issues: [],
  error: null,
  searched: { POLLEN: false, NECTAR: false },
  v0: { POLLEN: null, NECTAR: null },
  sweetSpotHitRate: { POLLEN: 0, NECTAR: 0 },
  cellsDone: 0,
  cellsTotal: TOTAL,
  reference: { POLLEN: new Float32Array(1), NECTAR: new Float32Array(1) },
  rowsDone: { POLLEN: new Uint8Array(1), NECTAR: new Uint8Array(1) },
  result: null,
  fromCache: false,
  ...patch,
});

describe('LUT 상태 표시 (09-10a)', () => {
  it('A. 단계: READY / 진행(대기 · 탐색 · 생성) / 오류 / 없음(검증 실패 · 취소)', () => {
    expect(lutPhase('READY')).toBe('READY');
    expect(['QUEUED', 'SEARCHING', 'GENERATING'].map(s => lutPhase(s as never))).toEqual(['WORKING', 'WORKING', 'WORKING']);
    expect(lutPhase('ERROR')).toBe('ERROR');
    expect(lutPhase('IDLE')).toBe('IDLE');
    expect(lutPhase('CANCELLED')).toBe('IDLE');
  });

  it('B. 남은 시간: 생성 시작부터의 속도로 추정, 진행 2% · 0.5초 전에는 없음, 세대가 바뀌면 다시 기록', () => {
    const t0 = nextTiming(null, { state: 'GENERATING', generation: 3, cellsDone: 100 }, 1000)!;
    expect(t0).toEqual({ generation: 3, startedAt: 1000, startedCells: 100 });
    expect(nextTiming(t0, { state: 'GENERATING', generation: 3, cellsDone: 5000 }, 2000)).toBe(t0);
    expect(nextTiming(t0, { state: 'GENERATING', generation: 4, cellsDone: 0 }, 3000)).toEqual({ generation: 4, startedAt: 3000, startedCells: 0 });
    expect(nextTiming(t0, { state: 'SEARCHING', generation: 3, cellsDone: 0 }, 3000)).toBe(t0);
    expect(nextTiming(t0, { state: 'QUEUED', generation: 5, cellsDone: 0 }, 3000)).toBeNull();
    expect(nextTiming(null, { state: 'SEARCHING', generation: 1, cellsDone: 0 }, 0)).toBeNull();
    // 4초 동안 (TOTAL / 4 − 100)격자 → 나머지 3/4는 약 12초
    const done = TOTAL / 4;
    expect(estimateRemainingMs(t0, 5000, done, TOTAL)).toBeCloseTo(((TOTAL - done) * 4000) / (done - 100), 6);
    expect(estimateRemainingMs(t0, 1400, done, TOTAL)).toBeNull(); // 0.5초 전
    expect(estimateRemainingMs(t0, 5000, 100 + 0.019 * TOTAL, TOTAL)).toBeNull(); // 2% 전
    expect(estimateRemainingMs(t0, 5000, TOTAL, TOTAL)).toBe(0);
    expect(estimateRemainingMs(null, 5000, done, TOTAL)).toBeNull();
  });

  it('C. 화면 요약: 진행률 / 남은 시간(생성 중만) / 기물별 v0 · 명중률 / 캐시 / 오류', () => {
    const timing = { generation: 1, startedAt: 0, startedCells: 0 };
    const gen = lutView(status({ state: 'GENERATING', cellsDone: TOTAL / 2, searched: { POLLEN: true, NECTAR: true }, v0: { POLLEN: 220.8, NECTAR: 221.4 }, sweetSpotHitRate: { POLLEN: 0.99, NECTAR: 0 } }), timing, 10_000);
    expect(gen).toMatchObject({ phase: 'WORKING', progress: 0.5, remainingMs: 10_000, v0: { POLLEN: 220.8, NECTAR: 221.4 }, hitRate: { POLLEN: 0.99, NECTAR: 0 } });
    expect(lutView(status({ state: 'SEARCHING', cellsDone: 0 }), timing, 10_000).remainingMs).toBeNull();
    expect(lutView(status({ state: 'READY', cellsDone: TOTAL, fromCache: true }), timing, 0)).toMatchObject({ phase: 'READY', progress: 1, fromCache: true, remainingMs: null });
    expect(lutView(status({ state: 'ERROR', error: 'boom' }), null, 0)).toMatchObject({ phase: 'ERROR', error: 'boom' });
  });

  it('D. 초안의 LUT 입력 변경 여부: 탄도 / 스윗스팟 / 로봇 크기만', () => {
    const r1 = DEFAULT_DRAFT_VALUES.robot1;
    expect(lutInputsChanged(r1, structuredClone(r1))).toBe(false);
    expect(lutInputsChanged({ ...r1, teamName: 'Bees', config: { ...r1.config, maxSpeed: 90, intakeDelay: 0 } }, r1)).toBe(false);
    expect(lutInputsChanged({ ...r1, ballistics: { ...r1.ballistics, sweetSpot: { x: 60.5, y: 131.5 } } }, r1)).toBe(true);
    expect(lutInputsChanged({ ...r1, ballistics: { ...r1.ballistics, headingNoiseRad: 0.03 } }, r1)).toBe(true);
    expect(lutInputsChanged({ ...r1, config: { ...r1.config, length: 16 } }, r1)).toBe(true);
  });

  it('E. START 막기: R1 탭 → R1 LUT → R2 탭 → R2 LUT → SCENARIO', () => {
    const ready = { robot1: 'READY', robot2: 'READY' } as const;
    const s0 = initialDrafts(DEFAULT_DRAFT_VALUES);
    expect(startBlocker(s0, ready)).toBeNull();
    expect(startBlocker(s0, { robot1: 'WORKING', robot2: 'ERROR' })).toEqual({ tab: 'robot1', reason: 'LUT_WORKING' });
    expect(startBlocker(s0, { robot1: 'READY', robot2: 'ERROR' })).toEqual({ tab: 'robot2', reason: 'LUT_ERROR' });
    expect(startBlocker(s0, { robot1: 'READY', robot2: 'IDLE' })).toEqual({ tab: 'robot2', reason: 'LUT_IDLE' });
    // 탭 문제가 그 탭의 LUT보다 먼저, R1 LUT가 R2 탭보다 먼저
    const dirty2 = editDraft(s0, 'robot2', { ...DEFAULT_DRAFT_VALUES.robot2, teamName: 'x' });
    expect(startBlocker(dirty2, { robot1: 'WORKING', robot2: 'READY' })).toEqual({ tab: 'robot1', reason: 'LUT_WORKING' });
    expect(startBlocker(dirty2, ready)).toEqual({ tab: 'robot2', reason: 'DIRTY' });
    expect(startBlocker(setFieldText(s0, 'robot1', 'width', 'x'), { robot1: 'WORKING', robot2: 'READY' })).toEqual({ tab: 'robot1', reason: 'INVALID' });
    const badScenario = editDraft(s0, 'scenario', { ...DEFAULT_DRAFT_VALUES.scenario, flowerPiecesCount: [9, 0, 0, 0] });
    expect(startBlocker(badScenario, ready)).toEqual({ tab: 'scenario', reason: 'INVALID' });
  });

  it('F. 상태 한 줄: 생성 중 % (내림) + 남은 초 (올림, 최소 1), 저장된 결과, 오류 사유, 첫 렌더 자리 채움 = 대기', () => {
    const base = { ...PENDING_LUT_VIEW };
    expect(lutStateText({ ...base, state: 'GENERATING', progress: 0.639, remainingMs: 6100 }, 'en')).toBe('Generating hit map 63% · about 7 s left');
    expect(lutStateText({ ...base, state: 'GENERATING', progress: 0.999, remainingMs: 10 }, 'ko')).toBe('확률표 생성 중 99% · 약 1초 남음');
    expect(lutStateText({ ...base, state: 'GENERATING', progress: 0.01, remainingMs: null }, 'en')).toBe('Generating hit map 1%');
    expect(lutStateText({ ...base, phase: 'READY', state: 'READY', fromCache: true }, 'ko')).toBe('준비 완료 (저장된 결과)');
    expect(lutStateText({ ...base, phase: 'READY', state: 'READY' }, 'en')).toBe('Ready');
    expect(lutStateText({ ...base, phase: 'ERROR', state: 'ERROR', error: 'boom' }, 'en')).toBe('Error: boom');
    expect(lutStateText(PENDING_LUT_VIEW, 'ko')).toBe('대기 중');
    expect(PENDING_LUT_VIEW.phase).toBe('WORKING');
  });
});
