// 경기 파일 화면 규칙 (명세서 3.9 경기 불러오기 / 경기 내보내기, 10-4)
import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../../app/appController';
import type { RecipeWarning } from '../../app/matchRecipe';
import { BALLISTICS_MODEL_VERSION } from '../../core/ballistics';
import { ENGINE_VERSION } from '../../core/simulationEngine';
import { PENDING_LUT_VIEW } from '../lutView';
import type { RobotLutView } from '../lutView';
import {
  matchFileName,
  matchImportConfirmMessage,
  matchImportErrorMessage,
  matchImportProgress,
  matchSummaryText,
  mismatchBanner,
  summaryFileName,
} from '../matchFile';
import type { MatchImportError } from '../matchFile';

const result: MatchResult = {
  total: 38,
  breakdown: {
    hive: 20,
    flower: 9,
    garden: 4,
    park: 5,
    flowers: [
      { id: 'flower1', scoringPieces: 3, owned: false, points: 0 },
      { id: 'flower2', scoringPieces: 2, owned: true, points: 9 },
      { id: 'flower3', scoringPieces: 0, owned: false, points: 0 },
      { id: 'flower4', scoringPieces: 1, owned: false, points: 0 },
    ],
    gardenPieceIds: ['pollen-1', 'pollen-2', 'pollen-3', 'pollen-4'],
    parkedRobots: ['robot1'],
  },
  rp: { swarm: false, pollinator1: true, pollinator2: false },
  tips: 6,
  autoTips: 5,
  teleopTips: 1,
};
const teams = { robot1: { teamNumber: '12345', teamName: 'Bumblebots' }, robot2: { teamNumber: '', teamName: 'Hive Mind' } };
const date = new Date(2026, 8, 30, 14, 32, 5);
const view = (over: Partial<RobotLutView>): RobotLutView => ({ ...PENDING_LUT_VIEW, ...over });

describe('경기 파일 화면 규칙 (10-4)', () => {
  it('A. 거부 사유 문구: 코드별 영어 / 한국어, 항목 / 버전 / 문제 코드 채움', () => {
    const errors: MatchImportError[] = [
      { code: 'NOT_JSON' },
      { code: 'PRESET_FILE' },
      { code: 'NOT_RECIPE' },
      { code: 'RECIPE_VERSION', version: 2 },
      { code: 'INVALID_FIELD', field: 'setup.robot1' },
      { code: 'INVALID_INPUTS', field: 'robot2' },
      { code: 'INVALID_CHECKSUMS' },
      { code: 'INVALID_SETUP', issues: ['FIELD_maxSpeed', 'PLACEMENT_ROBOT_OVERLAP'] },
      { code: 'TOO_LARGE' },
      { code: 'READ_FAILED' },
    ];
    for (const e of errors) {
      for (const lang of ['en', 'ko'] as const) {
        const text = matchImportErrorMessage(lang, e);
        expect(text).not.toMatch(/matchImport\.|preset\.error|\{/);
      }
      expect(matchImportErrorMessage('ko', e)).not.toBe(matchImportErrorMessage('en', e));
    }
    expect(matchImportErrorMessage('en', { code: 'RECIPE_VERSION', version: 2 })).toBe('Unsupported match file format (v2)');
    expect(matchImportErrorMessage('en', { code: 'INVALID_FIELD', field: 'setup.robot1' })).toBe('Damaged match file (setup.robot1)');
    expect(matchImportErrorMessage('ko', { code: 'INVALID_INPUTS', field: 'robot2' })).toBe('손상된 경기 파일 (입력: robot2)');
    expect(matchImportErrorMessage('en', { code: 'INVALID_SETUP', issues: ['FIELD_maxSpeed', 'PLACEMENT_ROBOT_OVERLAP'] })).toBe('The settings in the file are invalid (FIELD_maxSpeed, PLACEMENT_ROBOT_OVERLAP)');
    expect(matchImportErrorMessage('en', { code: 'NOT_JSON' })).toBe('Not a JSON file');
  });

  it('B. 확인창: 설정 교체 안내 + 해당될 때만 경고 줄', () => {
    expect(matchImportConfirmMessage('en', [])).toBe('Replace the R1, R2 and SCENARIO settings with the file and load the match?');
    const warnings: RecipeWarning[] = [
      { code: 'ENGINE_VERSION', file: ENGINE_VERSION + 1, current: ENGINE_VERSION },
      { code: 'BALLISTICS_VERSION', file: BALLISTICS_MODEL_VERSION + 1, current: BALLISTICS_MODEL_VERSION },
      { code: 'LUT_SETTINGS' },
    ];
    const lines = matchImportConfirmMessage('en', warnings).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`⚠ Made with engine v${ENGINE_VERSION + 1} (this app: v${ENGINE_VERSION}) — results may differ`);
    expect(lines[2]).toContain(`ballistics model v${BALLISTICS_MODEL_VERSION + 1}`);
    expect(lines[3]).toContain('Hit map settings differ');
    expect(matchImportConfirmMessage('ko', [warnings[0]]).split('\n')[1]).toContain(`엔진 v${ENGINE_VERSION + 1}`);
  });

  it('C. 준비 진행: 두 로봇 평균(준비 완료 = 100%), 오류가 있으면 오류', () => {
    expect(matchImportProgress({ robot1: view({ phase: 'READY', progress: 1 }), robot2: view({ phase: 'READY', progress: 1 }) })).toEqual({ percent: 100, error: false });
    expect(matchImportProgress({ robot1: view({ phase: 'READY', progress: 0 }), robot2: view({ phase: 'WORKING', progress: 0.5 }) })).toEqual({ percent: 75, error: false });
    expect(matchImportProgress({ robot1: view({ phase: 'WORKING', progress: 0.333 }), robot2: view({ phase: 'WORKING', progress: 0.333 }) })).toEqual({ percent: 33, error: false });
    // 내림: 끝나기 전에는 100%로 보이지 않음
    expect(matchImportProgress({ robot1: view({ phase: 'WORKING', progress: 0.999 }), robot2: view({ phase: 'READY', progress: 1 }) }).percent).toBe(99);
    expect(matchImportProgress({ robot1: view({ phase: 'ERROR', progress: 0.2 }), robot2: view({ phase: 'READY', progress: 1 }) }).error).toBe(true);
  });

  it('D. 체크섬 불일치 배너: 일치 = 없음, 처음부터 / 구간(경기 타이머), 버전이 달랐으면 사유 추가', () => {
    expect(mismatchBanner('en', { match: true }, [])).toBeNull();
    expect(mismatchBanner('en', { match: false, index: 0, lastMatchTick: null, firstMismatchTick: 0 }, [])).toEqual({ title: 'Results differ from the file', hint: 'From the start' });
    expect(mismatchBanner('en', { match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 }, [])!.hint).toBe('From between 1:56 and 1:55');
    expect(mismatchBanner('ko', { match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 }, [])).toEqual({ title: '파일 기록과 결과가 다릅니다', hint: '1:56 ~ 1:55 사이부터' });
    const versioned = mismatchBanner('en', { match: false, index: 1, lastMatchTick: 0, firstMismatchTick: 50 }, [{ code: 'ENGINE_VERSION', file: 9, current: 1 }]);
    expect(versioned!.hint).toBe('From between 2:00 and 1:59 · the file was made with a different engine or ballistics version');
    expect(mismatchBanner('en', { match: false, index: 1, lastMatchTick: 0, firstMismatchTick: 50 }, [{ code: 'LUT_SETTINGS' }])!.hint).toBe('From between 2:00 and 1:59');
  });

  it('E. 파일 이름: 로컬 시각 / 진영 / 총점, 요약은 같은 이름의 .txt', () => {
    expect(matchFileName(date, 'RED', 87)).toBe('tacticsim-match_20260930-1432_RED_87pts.json');
    expect(summaryFileName(date, 'BLUE', 0)).toBe('tacticsim-summary_20260930-1432_BLUE_0pts.txt');
  });

  it('F. 요약 텍스트: 결과 팝업과 같은 근거 / RP 규칙, 가지 이름은 있을 때만, 현재 화면 언어', () => {
    const en = matchSummaryText({ lang: 'en', result, alliance: 'RED', teams, branchName: 'Branch 3', date, seed: 12194135 });
    expect(en).toBe(
      [
        'FTC TacticSim · TELEOP MATCH COMPLETED',
        '2026-09-30 14:32 · RED · Branch 3',
        'R1 #12345 Bumblebots · R2 Hive Mind',
        'TOTAL SCORE 38',
        'HIVE    20  TELEOP TIP 1 × 20 · auto TIP 5 counts for RP only',
        'FLOWER   9  FLOWER 2: 2 × 2 + bottom bonus 5',
        'GARDEN   4  POLLEN 4 × 1',
        'PARK     5  R1 parked × 5',
        'RP  SWARM PARK 5 / 10 · POLLINATOR 1 ✓ TIP 6 / 4 · POLLINATOR 2 TIP 6 / 7',
        `SEED 12194135 · ENGINE v${ENGINE_VERSION} · BALLISTICS v${BALLISTICS_MODEL_VERSION}`,
        '',
      ].join('\n'),
    );
    const ko = matchSummaryText({ lang: 'ko', result, alliance: 'BLUE', teams: { robot1: { teamNumber: '', teamName: '' }, robot2: teams.robot2 }, branchName: null, date, seed: 7 });
    const lines = ko.split('\n');
    expect(lines[0]).toBe('FTC TacticSim · TELEOP 경기 종료');
    expect(lines[1]).toBe('2026-09-30 14:32 · BLUE');
    expect(lines[2]).toBe('R1 · R2 Hive Mind');
    expect(lines[3]).toBe('총점 38');
    expect(lines[4]).toContain('TELEOP TIP 1회 × 20');
    expect(lines[9]).toBe(`시드 7 · 엔진 v${ENGINE_VERSION} · 탄도 모델 v${BALLISTICS_MODEL_VERSION}`);
  });
});
