// 메인 화면 표시 규칙 (명세서 3.8 화면 구성, 09-6d)
import { describe, expect, it } from 'vitest';
import { DT, ENDGAME_START_TICK, MATCH_TICKS } from '../../core/simulationEngine';
import { FONT_FAMILY, canvasFont } from '../../renderer/fonts';
import {
  DESIGN_HEIGHT_PX,
  DESIGN_WIDTH_PX,
  LAYOUT_U,
  fieldCanvasSize,
  formatPercent,
  layoutCssVars,
  gamepadSummary,
  mainButton,
  robotLabel,
  timelineFraction,
  timelineMarks,
  timelineTickAt,
  timerIsEndgame,
  timerIsFinalCountdown,
  endScoreTally,
  tallyValue,
  END_TALLY_MS,
  tipDisplay,
} from '../mainScreenModel';

describe('A. 화면 비례 단위 / 필드 캔버스 크기', () => {
  it('CSS 변수: 기준 화면 1366 × 650, 좌측 패널 260u / config 띠 72u / 스크러버 줄 56u / 간격 12u', () => {
    expect(layoutCssVars()).toEqual({
      '--design-w': '1366',
      '--design-h': '650',
      '--left-panel': '260',
      '--rail': '72',
      '--scrubber': '56',
      '--gap-u': '12',
    });
    // (09-8a) config 창을 펼치면 오른쪽 열 480u, 1366 기준에서도 필드(높이 제한)는 줄지 않음
    expect(layoutCssVars(true)['--rail']).toBe('480');
    const { leftPanel, configPanel, scrubber, gap } = LAYOUT_U;
    const openWidth = DESIGN_WIDTH_PX - leftPanel - configPanel - gap * 4;
    const height = DESIGN_HEIGHT_PX - scrubber - gap * 3;
    expect(openWidth).toBeGreaterThanOrEqual(height);
    expect([DESIGN_WIDTH_PX, DESIGN_HEIGHT_PX]).toEqual([1366, 650]);
  });

  it('기준 화면에서 필드가 가용 높이 − 스크러버 줄에 가깝다 (≈ 590u)', () => {
    const { leftPanel, rail, scrubber, gap } = LAYOUT_U;
    const w = DESIGN_WIDTH_PX - leftPanel - rail - gap * 4;
    const h = DESIGN_HEIGHT_PX - scrubber - gap * 3;
    const size = fieldCanvasSize(w, h, 1);
    expect(size.cssPx).toBe(Math.floor(h));
    expect(size.cssPx).toBeGreaterThan(550);
  });

  it('정사각형 = 짧은 변 내림, 버퍼 = CSS × dpr 반올림, 배율 = 버퍼 / 800', () => {
    expect(fieldCanvasSize(1000, 580.7, 1)).toEqual({ cssPx: 580, bufferPx: 580, scale: 580 / 800 });
    expect(fieldCanvasSize(580.7, 1000, 2)).toEqual({ cssPx: 580, bufferPx: 1160, scale: 1160 / 800 });
    expect(fieldCanvasSize(1000, 600, 1.25)).toEqual({ cssPx: 600, bufferPx: 750, scale: 750 / 800 });
    expect(fieldCanvasSize(3000, 1700, 1).scale).toBeCloseTo(1700 / 800, 12);
    // 비정상 dpr → 1, 0 크기 → 1 px
    expect(fieldCanvasSize(600, 600, 0).bufferPx).toBe(600);
    expect(fieldCanvasSize(600, 600, Number.NaN).bufferPx).toBe(600);
    expect(fieldCanvasSize(0, 0, 1)).toEqual({ cssPx: 1, bufferPx: 1, scale: 1 / 800 });
  });
});

describe('B. 좌측 패널', () => {
  it('TIP 표시 = 오토 + 텔레옵 / 다음 RP 목표 (4 → 7 → 7 달성)', () => {
    expect(tipDisplay(0, 0)).toEqual({ count: 0, target: 4, allDone: false });
    expect(tipDisplay(2, 1)).toEqual({ count: 3, target: 4, allDone: false });
    expect(tipDisplay(2, 2)).toEqual({ count: 4, target: 7, allDone: false });
    expect(tipDisplay(0, 6)).toEqual({ count: 6, target: 7, allDone: false });
    expect(tipDisplay(3, 4)).toEqual({ count: 7, target: 7, allDone: true });
    expect(tipDisplay(5, 9)).toEqual({ count: 14, target: 7, allDone: true });
    expect(tipDisplay(-1, 2).count).toBe(2);
  });

  it('로봇 이름: 팀 번호가 있으면 #번호, 없으면 R1 / R2', () => {
    expect(robotLabel('robot1')).toBe('R1');
    expect(robotLabel('robot2', null)).toBe('R2');
    expect(robotLabel('robot2', '  ')).toBe('R2');
    expect(robotLabel('robot1', ' 19049 ')).toBe('#19049');
  });

  it('명중 확률 % (정수, [0, 1] 제한)', () => {
    expect(formatPercent(0.6)).toBe('60%');
    expect(formatPercent(0.125)).toBe('13%');
    expect(formatPercent(1.4)).toBe('100%');
    expect(formatPercent(-0.2)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('타이머 ENDGAME 색: 경기가 시작된 뒤 남은 60초 이하 (엔진 ENDGAME 전환 틱과 같음)', () => {
    const at = (tick: number) => (MATCH_TICKS - tick) * DT;
    expect(timerIsEndgame({ phase: 'MATCH', remainingSec: at(ENDGAME_START_TICK - 1) })).toBe(false);
    expect(timerIsEndgame({ phase: 'MATCH', remainingSec: at(ENDGAME_START_TICK) })).toBe(true);
    expect(timerIsEndgame({ phase: 'ROTATING_OUT', remainingSec: 0 })).toBe(true);
    expect(timerIsEndgame({ phase: 'SETUP', remainingSec: 30 })).toBe(false); // 경기 전은 항상 기본색
  });
});

describe('C. 스크러버 줄 / config 띠', () => {
  it('주 버튼 (09-7a): START / 회전 중 비활성 / PAUSE / BRANCH(보는 틱 < 머리) / RESUME(보는 틱 = 머리, 미종료) / 비활성', () => {
    const base = { tick: 0, headTick: 0, matchEnded: false, canResume: false, canBranch: false };
    expect(mainButton({ ...base, phase: 'SETUP', loopState: 'READY' })).toEqual({ kind: 'START', enabled: true });
    expect(mainButton({ ...base, phase: 'ROTATING_IN', loopState: 'READY' })).toEqual({ kind: 'START', enabled: false });
    expect(mainButton({ ...base, phase: 'ROTATING_OUT', loopState: 'READY' })).toEqual({ kind: 'START', enabled: false });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'RUNNING', tick: 900, headTick: 900 })).toEqual({ kind: 'PAUSE', enabled: true });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'PAUSED', tick: 900, headTick: 900, canResume: true })).toEqual({ kind: 'RESUME', enabled: true });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'PAUSED', tick: 400, headTick: 900, canBranch: true })).toEqual({ kind: 'BRANCH', enabled: true });
    // 종료 후 복기: 되감으면 BRANCH, 마지막 틱에서는 BRANCH 비활성 (RESUME 없음), 종료 강조 / 결과 팝업 중(가능 플래그 꺼짐) 비활성
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'ENDED', tick: 3000, headTick: MATCH_TICKS, matchEnded: true, canBranch: true })).toEqual({ kind: 'BRANCH', enabled: true });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'ENDED', tick: MATCH_TICKS, headTick: MATCH_TICKS, matchEnded: true })).toEqual({ kind: 'BRANCH', enabled: false });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'ENDED', tick: 3000, headTick: MATCH_TICKS, matchEnded: true })).toEqual({ kind: 'BRANCH', enabled: false });
    expect(mainButton({ ...base, phase: 'MATCH', loopState: 'PAUSED', tick: 900, headTick: 900 })).toEqual({ kind: 'RESUME', enabled: false });
  });

  it('타임라인: 위치 비율 제한, 10초 눈금 13개, ENDGAME 시작 눈금만 major', () => {
    expect(timelineFraction(0, MATCH_TICKS)).toBe(0);
    expect(timelineFraction(1500, MATCH_TICKS)).toBe(0.25);
    expect(timelineFraction(7000, MATCH_TICKS)).toBe(1);
    expect(timelineFraction(-5, MATCH_TICKS)).toBe(0);
    expect(timelineFraction(Number.NaN, MATCH_TICKS)).toBe(0);
    const marks = timelineMarks(MATCH_TICKS, Math.round(1 / DT));
    expect(marks).toHaveLength(13);
    expect(marks[0].fraction).toBe(0);
    expect(marks[12].fraction).toBe(1);
    expect(marks.filter(m => m.major).map(m => m.fraction)).toEqual([ENDGAME_START_TICK / MATCH_TICKS]);
  });

  it('타임라인 클릭 / 끌기 위치 → 틱 (09-7b): 막대 비율 × 6000 반올림, 막대 밖은 양 끝', () => {
    expect(timelineTickAt(100, 100, 600, MATCH_TICKS)).toBe(0);
    expect(timelineTickAt(250, 100, 600, MATCH_TICKS)).toBe(1500);
    expect(timelineTickAt(700, 100, 600, MATCH_TICKS)).toBe(MATCH_TICKS);
    expect(timelineTickAt(100.06, 100, 600, MATCH_TICKS)).toBe(1); // 0.06 / 600 × 6000 = 0.6 → 1
    expect(timelineTickAt(50, 100, 600, MATCH_TICKS)).toBe(0);
    expect(timelineTickAt(900, 100, 600, MATCH_TICKS)).toBe(MATCH_TICKS);
    expect(timelineTickAt(300, 100, 0, MATCH_TICKS)).toBe(0);
    expect(timelineTickAt(Number.NaN, 100, 600, MATCH_TICKS)).toBe(0);
  });

  it('게임패드 요약: 연결된 패드 수, 연결된 패드 중 비표준 매핑이 있으면 경고', () => {
    expect(gamepadSummary([])).toEqual({ connected: 0, nonStandard: false });
    expect(gamepadSummary([{ connected: true, standard: true }, { connected: false, standard: false }])).toEqual({ connected: 1, nonStandard: false });
    expect(gamepadSummary([{ connected: true, standard: true }, { connected: true, standard: false }])).toEqual({ connected: 2, nonStandard: true });
  });
});

describe('D. 글꼴 (09-6d 확정: Apple SD Gothic Neo → Pretendard)', () => {
  it('HTML(main.tsx가 루트에 지정)과 캔버스가 같은 글꼴 순서, 캔버스는 굵기 600 / 700 / 800', () => {
    expect(FONT_FAMILY).toBe("'Apple SD Gothic Neo', 'Pretendard Variable', Pretendard, system-ui, sans-serif");
    expect(canvasFont(12)).toBe(`700 12px ${FONT_FAMILY}`);
    expect(canvasFont(9.5, 800)).toBe(`800 9.5px ${FONT_FAMILY}`);
  });
});

describe('E. 경기 종료 연출 (09-7c)', () => {
  it('마지막 10초 예고: 경기가 시작된 뒤 남은 10초 이하 (엔진 틱 경계)', () => {
    const at = (tick: number) => (MATCH_TICKS - tick) * DT;
    expect(timerIsFinalCountdown({ phase: 'MATCH', remainingSec: at(MATCH_TICKS - 501) })).toBe(false);
    expect(timerIsFinalCountdown({ phase: 'MATCH', remainingSec: at(MATCH_TICKS - 500) })).toBe(true);
    expect(timerIsFinalCountdown({ phase: 'MATCH', remainingSec: 0 })).toBe(true);
    expect(timerIsFinalCountdown({ phase: 'SETUP', remainingSec: 5 })).toBe(false);
  });

  it('점수 집계: 종료 직전 점수 = 최종 − 종료 시 더해진 항목, 칩은 0점 제외 FLOWER → GARDEN → PARK', () => {
    const tally = endScoreTally({ total: 69, breakdown: { flower: 0, garden: 4, park: 5 } });
    expect(tally).toEqual({ from: 60, to: 69, chips: [{ label: 'GARDEN', points: 4 }, { label: 'PARK', points: 5 }] });
    const all = endScoreTally({ total: 30, breakdown: { flower: 11, garden: 9, park: 10 } });
    expect(all.from === 0 && all.chips.map(c => c.label).join() === 'FLOWER,GARDEN,PARK').toBe(true);
    expect(endScoreTally({ total: 40, breakdown: { flower: 0, garden: 0, park: 0 } })).toEqual({ from: 40, to: 40, chips: [] });
  });

  it('카운트업 값: 시작 = 이전 점수, 끝 = 최종, 단조 증가 정수, 비정상 입력은 최종 값', () => {
    expect(tallyValue(60, 69, 0)).toBe(60);
    expect(tallyValue(60, 69, END_TALLY_MS)).toBe(69);
    expect(tallyValue(60, 69, END_TALLY_MS * 5)).toBe(69);
    let prev = 60;
    for (let ms = 0; ms <= END_TALLY_MS; ms += 50) {
      const v = tallyValue(60, 69, ms);
      expect(Number.isInteger(v) && v >= prev && v <= 69).toBe(true);
      prev = v;
    }
    expect(tallyValue(0, 100, END_TALLY_MS / 2)).toBeGreaterThan(50); // 처음 빠르게 (easeOut)
    expect(tallyValue(0, 9, Number.NaN)).toBe(9);
    expect(tallyValue(0, 9, 100, 0)).toBe(9);
  });
});
