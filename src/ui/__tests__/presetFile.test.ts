// 프리셋 파일 내보내기 / 불러오기 (명세서 3.9 프리셋, 10-2)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { editDraft, initialDrafts, isDirty, setFieldText, tabStatus } from '../configDraft';
import type { DraftValues } from '../configDraft';
import {
  MAX_IMPORT_BYTES,
  PRESET_FORMAT,
  PRESET_VERSION,
  buildPresetFile,
  fileTimestamp,
  importOverwriteTabs,
  importPresetToDrafts,
  parsePresetFile,
  presetErrorMessage,
  presetFileName,
  presetLoadedNotice,
  sanitizeRobotPreset,
  sanitizeScenarioPreset,
} from '../presetFile';
import type { PresetRow } from '../presetFile';

const defaults = DEFAULT_DRAFT_VALUES;
const custom: DraftValues = {
  robot1: {
    teamNumber: '12345',
    teamName: 'Bumblebots',
    config: { ...defaults.robot1.config, maxSpeed: 55, turretType: 'TURRET', turretRange: [-1, 1], intakeZones: [{ side: 'BACK', offset: 1, width: 8, depth: 3 }] },
    ballistics: { ...defaults.robot1.ballistics, dz: 40, sweetSpot: { x: 50.5, y: 120.5 } },
  },
  robot2: { ...defaults.robot2, teamName: 'Hive Mind', config: { ...defaults.robot2.config, width: 16, canIntakeNectar: false } },
  scenario: { allianceColor: 'BLUE', r1Spawn: { x: 130, y: 40, heading: Math.PI }, autoTipCount: 3, rngSeed: 777, r2Loadout: ['NECTAR', 'POLLEN'] },
};
const parse = (text: string, row: PresetRow) => parsePresetFile(text, row, defaults);
const file = (kind: string, data: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: PRESET_FORMAT, presetVersion: PRESET_VERSION, kind, data, ...extra });

describe('프리셋 파일 (10-2)', () => {
  it('A. 내보내기 → 불러오기 왕복: 줄별로 적용 값 그대로 (슬롯 id는 불러온 줄이 정함)', () => {
    for (const row of ['robot1', 'robot2', 'scenario', 'all'] as const) {
      const r = parse(buildPresetFile(row, custom), row);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      if (row === 'robot1' || row === 'robot2') expect(r.preset.values).toEqual({ [row]: custom[row] });
      else if (row === 'scenario') expect(r.preset.values).toEqual({ scenario: custom.scenario });
      else expect(r.preset.values).toEqual(custom);
      expect(r.preset.invalidTexts).toEqual({});
    }
    // 파일 머리 / 종류 / 로봇 데이터에 슬롯 id 없음
    const robot = JSON.parse(buildPresetFile('robot1', custom));
    expect(robot).toMatchObject({ format: 'ftc-tactic-sim/preset', presetVersion: 1, kind: 'ROBOT' });
    expect(robot.data.config.id).toBeUndefined();
    expect(JSON.parse(buildPresetFile('all', custom)).kind).toBe('SETUP');
    expect(JSON.parse(buildPresetFile('scenario', custom)).kind).toBe('SCENARIO');
    // R1에서 내보낸 로봇을 R2 줄로: id = robot2, 나머지 그대로
    const moved = parse(buildPresetFile('robot1', custom), 'robot2');
    expect(moved.ok && moved.preset.values.robot2).toEqual({ ...custom.robot1, config: { ...custom.robot1.config, id: 'robot2' } });
  });

  it('B. 파일 자체가 틀리면 거부: JSON 아님 / 형식 다름 / 경기 파일 / 더 새 버전 / 종류가 줄과 다름', () => {
    expect(parse('{oops', 'robot1')).toEqual({ ok: false, error: { code: 'NOT_JSON' } });
    expect(parse('[]', 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(JSON.stringify({ format: 'other', presetVersion: 1, kind: 'ROBOT', data: {} }), 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(file('ROBOT', {}, { presetVersion: 0 }), 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(file('ROBOT', {}, { presetVersion: '1' }), 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(file('ROBOT', null), 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(file('LUT', {}), 'robot1')).toEqual({ ok: false, error: { code: 'NOT_PRESET' } });
    expect(parse(JSON.stringify({ format: 'ftc-tactic-sim/match', recipeVersion: 1 }), 'all')).toEqual({ ok: false, error: { code: 'MATCH_FILE' } });
    expect(parse(file('ROBOT', {}, { presetVersion: PRESET_VERSION + 1 }), 'robot1')).toEqual({ ok: false, error: { code: 'NEWER_VERSION', version: PRESET_VERSION + 1 } });
    expect(parse(buildPresetFile('scenario', custom), 'robot1')).toEqual({ ok: false, error: { code: 'WRONG_KIND', kind: 'SCENARIO' } });
    expect(parse(buildPresetFile('robot2', custom), 'all')).toEqual({ ok: false, error: { code: 'WRONG_KIND', kind: 'ROBOT' } });
    expect(parse(buildPresetFile('all', custom), 'scenario')).toEqual({ ok: false, error: { code: 'WRONG_KIND', kind: 'SETUP' } });
    expect(MAX_IMPORT_BYTES).toBe(1024 * 1024);
  });

  it('C. 로봇: 없거나 형식이 틀린 항목만 기본값, 범위 밖 숫자는 그대로(폼이 빨간 오류), 구역은 틀린 것만 빼고 최대 8개', () => {
    const def = defaults.robot1;
    const { profile, invalidTexts } = sanitizeRobotPreset(
      {
        teamName: 42, // 형식 틀림 → 기본값
        config: {
          maxSpeed: 999, // 범위 밖 → 그대로
          width: 'wide', // 형식 틀림 → 기본값
          intakeDelay: Number.NaN,
          turretType: 'LASER',
          turretRange: [0.5, 'x'],
          canIntakeNectar: 'yes',
          intakeZones: [{ side: 'TOP', offset: 0, width: 5, depth: 2 }, { side: 'LEFT', offset: 0, width: 5, depth: 2 }, ...Array.from({ length: 10 }, () => ({ side: 'FRONT', offset: 0, width: 4, depth: 1 }))],
          extra: true, // 모르는 항목은 버림
        },
        ballistics: { dz: 30, sweetSpot: { x: 10 } },
      },
      def,
      'robot1',
    );
    expect(invalidTexts).toEqual({});
    expect(profile.teamNumber).toBe(def.teamNumber);
    expect(profile.teamName).toBe(def.teamName);
    expect(profile.config.maxSpeed).toBe(999);
    expect(profile.config.width).toBe(def.config.width);
    expect(profile.config.intakeDelay).toBe(def.config.intakeDelay);
    expect(profile.config.turretType).toBe(def.config.turretType);
    expect(profile.config.turretRange).toEqual(def.config.turretRange);
    expect(profile.config.canIntakeNectar).toBe(def.config.canIntakeNectar);
    expect(profile.config.intakeZones).toHaveLength(8);
    expect(profile.config.intakeZones[0]).toEqual({ side: 'LEFT', offset: 0, width: 5, depth: 2 });
    expect('extra' in profile.config).toBe(false);
    expect(profile.config.id).toBe('robot1');
    expect(profile.ballistics).toEqual({ ...def.ballistics, dz: 30, sweetSpot: { x: 10, y: def.ballistics.sweetSpot.y } });
    // 구역 목록이 배열이 아니면 기본 구역, 빈 배열은 그대로(흡입 불가 로봇)
    expect(sanitizeRobotPreset({ config: { intakeZones: 'FRONT' } }, def, 'robot1').profile.config.intakeZones).toEqual(def.config.intakeZones);
    expect(sanitizeRobotPreset({ config: { intakeZones: [] } }, def, 'robot1').profile.config.intakeZones).toEqual([]);
    // 원본 기본값을 바꾸지 않음
    profile.config.intakeZones.push({ side: 'BACK', offset: 0, width: 4, depth: 1 });
    expect(defaults.robot1.config.intakeZones).toHaveLength(1);
  });

  it('D. 팀 번호 / 팀명이 입력칸 규칙에 어긋나면 값은 비우고 글자를 따로 돌려줌 → 초안의 틀린 입력 글자 (탭 INVALID)', () => {
    const { profile, invalidTexts } = sanitizeRobotPreset({ teamNumber: '12a45', teamName: 'x'.repeat(30) }, defaults.robot2, 'robot2');
    expect(profile.teamNumber).toBe('');
    expect(profile.teamName).toBe('');
    expect(invalidTexts).toEqual({ teamNumber: '12a45', teamName: 'x'.repeat(30) });

    const r = parse(file('ROBOT', { teamNumber: '12a45' }), 'robot2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = importPresetToDrafts(initialDrafts(defaults), r.preset);
    expect(next.fieldText.robot2).toEqual({ teamNumber: '12a45' });
    expect(tabStatus(next, 'robot2')).toBe('INVALID');
    expect(tabStatus(next, 'robot1')).toBe('OK');
  });

  it('E. 시나리오: 없는 선택 항목은 기본 시나리오 그대로, 형식이 틀린 항목만 기본값, 범위 밖 값은 그대로(탭 문제 목록)', () => {
    const def = { ...defaults.scenario, autoTipCount: 2 };
    const s = sanitizeScenarioPreset(
      {
        allianceColor: 'GREEN',
        r1Spawn: { x: 10, y: 20 }, // heading 없음 → 기본값(없음)
        r2Spawn: { x: 9, y: 100, heading: 0.5, junk: 1 },
        hiveUpwardCell: 'OPPOSITE_CELL',
        hiveInitialPieces: { pollenCount: 1, nectarCount: 'many' },
        r1Loadout: ['POLLEN', 'HONEY'],
        r2Loadout: [],
        flowerPiecesCount: [4, 4, 9, 4], // 범위 밖 9 → 그대로
        gardenPiecesCount: { ally: 3, opponent: 5 },
        autoTipCount: 'three',
        rngSeed: 99,
        unknown: 1,
      },
      def,
    );
    expect(s).toEqual({
      allianceColor: 'RED',
      r2Spawn: { x: 9, y: 100, heading: 0.5 },
      hiveUpwardCell: 'OPPOSITE_CELL',
      r2Loadout: [],
      flowerPiecesCount: [4, 4, 9, 4],
      gardenPiecesCount: { ally: 3, opponent: 5 },
      autoTipCount: 2,
      rngSeed: 99,
    });
    expect(sanitizeScenarioPreset(undefined, def)).toEqual(def);
    const next = importPresetToDrafts(initialDrafts(defaults), { values: { scenario: s }, invalidTexts: {} });
    expect(tabStatus(next, 'scenario')).toBe('INVALID'); // FLOWER 9개
  });

  it('F. ALL: 세 탭 초안을 모두 바꾸고 적용 값은 그대로, 없는 로봇 / 시나리오는 기본값, 그 탭의 틀린 입력 글자는 지움', () => {
    const start = { ...initialDrafts(custom), fieldText: { robot1: { maxSpeed: 'abc' }, robot2: {}, scenario: { 'spawn.robot1.x': '??' } } };
    const r = parse(file('SETUP', { robot1: custom.robot2 }), 'all');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = importPresetToDrafts(start, r.preset);
    expect(next.applied).toBe(start.applied);
    expect(next.draft.robot1).toEqual({ ...custom.robot2, config: { ...custom.robot2.config, id: 'robot1' } });
    expect(next.draft.robot2).toEqual(defaults.robot2);
    expect(next.draft.scenario).toEqual(defaults.scenario);
    expect(next.fieldText).toEqual({ robot1: {}, robot2: {}, scenario: {} });
    expect(['robot1', 'robot2', 'scenario'].every(tab => isDirty(next, tab as 'robot1'))).toBe(true);
    // 한 로봇 줄은 그 탭만
    const one = parse(buildPresetFile('robot2', defaults), 'robot2');
    const only = one.ok ? importPresetToDrafts(start, one.preset) : start;
    expect(only.draft.robot1).toBe(start.draft.robot1);
    expect(only.fieldText.robot1).toEqual({ maxSpeed: 'abc' });
    expect(only.draft.robot2).toEqual(defaults.robot2);
  });

  it('G. 파일 이름: 로봇 = 팀 번호(없으면 R1 / R2), 시나리오 = 진영, 전체 = 로컬 시각', () => {
    const now = new Date(2026, 8, 30, 14, 5);
    expect(fileTimestamp(now)).toBe('20260930-1405');
    expect(presetFileName('robot1', custom, now)).toBe('tacticsim-robot_12345.json');
    expect(presetFileName('robot2', custom, now)).toBe('tacticsim-robot_R2.json');
    expect(presetFileName('scenario', custom, now)).toBe('tacticsim-scenario_BLUE.json');
    expect(presetFileName('all', custom, now)).toBe('tacticsim-setup_20260930-1405.json');
  });

  it('H. 덮어쓰기 확인 대상 = 줄이 바꾸는 탭 중 적용 안 된 수정 / 틀린 입력이 있는 탭', () => {
    const clean = initialDrafts(defaults);
    expect(importOverwriteTabs(clean, 'all')).toEqual([]);
    const dirty = setFieldText(editDraft(clean, 'robot2', custom.robot2), 'scenario', 'spawn.robot1.x', '??');
    expect(importOverwriteTabs(dirty, 'robot1')).toEqual([]);
    expect(importOverwriteTabs(dirty, 'robot2')).toEqual(['robot2']);
    expect(importOverwriteTabs(dirty, 'scenario')).toEqual(['scenario']);
    expect(importOverwriteTabs(dirty, 'all')).toEqual(['robot2', 'scenario']);
  });

  it('I. 문구: 거부 사유(종류가 다르면 넣을 줄, 새 버전이면 버전) / 불러온 뒤 안내, 영어 · 한국어', () => {
    expect(presetErrorMessage('en', { code: 'WRONG_KIND', kind: 'ROBOT' })).toBe('This file goes on the R1 / R2 row');
    expect(presetErrorMessage('en', { code: 'WRONG_KIND', kind: 'SETUP' })).toBe('This file goes on the ALL row');
    expect(presetErrorMessage('ko', { code: 'WRONG_KIND', kind: 'SCENARIO' })).toBe('시나리오 줄에서 불러올 파일');
    expect(presetErrorMessage('en', { code: 'NEWER_VERSION', version: 3 })).toContain('preset v3');
    for (const code of ['NOT_JSON', 'NOT_PRESET', 'MATCH_FILE', 'TOO_LARGE', 'READ_FAILED'] as const) {
      expect(presetErrorMessage('en', { code })).not.toContain('preset.error');
      expect(presetErrorMessage('ko', { code })).not.toBe(presetErrorMessage('en', { code }));
    }
    expect(presetLoadedNotice('en', 'robot2')).toBe('Loaded into the R2 draft — APPLY it on the R2 tab');
    expect(presetLoadedNotice('ko', 'scenario')).toBe('시나리오 초안에 불러옴 — 시나리오 탭에서 적용');
    expect(presetLoadedNotice('en', 'all')).toContain('R1, R2 and SCENARIO');
  });
});
