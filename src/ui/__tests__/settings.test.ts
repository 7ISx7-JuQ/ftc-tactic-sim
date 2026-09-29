// SETTINGS 값 / 설정 자동 보관 (명세서 3.8 SETTINGS 탭, 09-8b)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  keyCodeLabel,
  loadStoredConfig,
  parseStoredConfig,
  mergeWithDefaults,
  sanitizeSettings,
  saveStoredConfig,
  serializeStoredConfig,
} from '../settings';
import type { SettingsStorage, UiSettings } from '../settings';

const memory = () => {
  const data = new Map<string, string>();
  const storage: SettingsStorage = {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: k => void data.delete(k),
  };
  return { storage, data };
};
const custom: UiSettings = {
  language: 'ko',
  lengthUnit: 'cm',
  defaultView: 'AUDIENCE',
  renderOptions: { aimGuide: true, intakeProgress: false, hitProbability: true, flightTrail: false, flightResult: true },
  keyboardEnabled: false,
  driveModes: { robot1: 'ROBOT', robot2: 'FIELD' },
};
const defaults = DEFAULT_DRAFT_VALUES;

describe('SETTINGS / 자동 보관 (09-8b)', () => {
  it('A. 기본값: 영어, in, 드라이버 시점, 표시 옵션 모두 꺼짐, 키보드 켬, 필드 기준', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      language: 'en',
      lengthUnit: 'in',
      defaultView: 'DRIVER',
      renderOptions: { aimGuide: false, intakeProgress: false, hitProbability: false, flightTrail: false, flightResult: false },
      keyboardEnabled: true,
      driveModes: { robot1: 'FIELD', robot2: 'FIELD' },
    });
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('B. 저장 → 복원 왕복 (설정 + 적용한 로봇 / 시나리오), 입력 출처는 보관하지 않음', () => {
    const applied = {
      ...defaults,
      robot1: { teamNumber: '19049', teamName: 'Bumblebees', config: { ...defaults.robot1.config, maxSpeed: 72 }, ballistics: { ...defaults.robot1.ballistics, shooterPitch: 1 } },
      scenario: { allianceColor: 'BLUE' as const, flowerPiecesCount: [4, 3, 2, 1] as [number, number, number, number] },
    };
    const text = serializeStoredConfig({ settings: custom, applied });
    const back = parseStoredConfig(text, defaults);
    expect(back.settings).toEqual(custom);
    expect(back.applied).toEqual(applied);
    expect(JSON.parse(text).version).toBe(SETTINGS_VERSION);
    expect(text.includes('AUTO') || text.includes('LIVE')).toBe(false);
  });

  it('C. 없음 / JSON 손상 / 버전 다름 → 전부 기본값, 항목별 형식 오류 → 그 항목만 기본값', () => {
    for (const text of [null, '', '{not json', JSON.stringify({ version: 999, settings: custom }), JSON.stringify([1, 2])]) {
      const r = parseStoredConfig(text, defaults);
      expect(r.settings).toEqual(DEFAULT_SETTINGS);
      expect(r.applied).toBeNull();
    }
    const partial = parseStoredConfig(
      JSON.stringify({ version: SETTINGS_VERSION, settings: { ...custom, language: 'fr', defaultView: 'SIDE', renderOptions: { aimGuide: 'yes', flightTrail: true }, driveModes: { robot1: 'X' } } }),
      defaults,
    );
    expect(partial.settings.language).toBe('en');
    expect(partial.settings.defaultView).toBe('DRIVER');
    expect(partial.settings.lengthUnit).toBe('cm');
    expect(partial.settings.renderOptions).toEqual({ ...DEFAULT_SETTINGS.renderOptions, flightTrail: true });
    expect(partial.settings.driveModes).toEqual({ robot1: 'FIELD', robot2: 'FIELD' });
    expect(partial.settings.keyboardEnabled).toBe(false);
  });

  it('D. 적용 값 검사: 없는 항목은 기본값으로 채우고, 종류가 다르거나 범위 / 시나리오 검증 실패면 버림 (기본값 사용)', () => {
    const wrap = (applied: unknown) => JSON.stringify({ version: SETTINGS_VERSION, settings: custom, applied });
    const cfg = (patch: Record<string, unknown>) => ({ ...defaults.robot1, config: { ...defaults.robot1.config, ...patch } });
    expect(parseStoredConfig(wrap({ ...defaults, robot1: cfg({ maxSpeed: 'fast' }) }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, robot2: { ...defaults.robot2, config: { ...defaults.robot2.config, intakeZones: null } } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, robot1: cfg({ width: Number.NaN }) }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, robot1: cfg({ width: 30 }) }), defaults).applied).toBeNull(); // 범위 밖 (6 ~ 18 in)
    expect(parseStoredConfig(wrap({ ...defaults, robot1: { ...defaults.robot1, teamNumber: '12345678' } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, scenario: { allianceColor: 'GREEN' } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, scenario: { allianceColor: 'RED', flowerPiecesCount: [9, 4, 4, 4] } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, scenario: { allianceColor: 'RED', r1Spawn: { x: 72, y: 72, heading: 0 } } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap({ ...defaults, scenario: { allianceColor: 'RED', gardenPiecesCount: 'many' } }), defaults).applied).toBeNull();
    expect(parseStoredConfig(wrap(defaults), defaults).applied).toEqual(defaults);
    // 없는 항목 채우기: 팀명이 없던 저장값 → 기본값(빈 팀명)으로 채우고 나머지 유지, 슬롯 id 강제
    const noName = { robot1: { teamNumber: '19049', config: { ...defaults.robot1.config, maxSpeed: 80, id: 'robot2' } }, robot2: defaults.robot2, scenario: defaults.scenario };
    const filled = parseStoredConfig(wrap(noName), defaults).applied;
    expect(filled?.robot1).toEqual({ teamNumber: '19049', teamName: '', config: { ...defaults.robot1.config, maxSpeed: 80 }, ballistics: defaults.robot1.ballistics }); // 09-9a 저장값(탄도 없음)도 유지
    // 09-8b 형식 (RobotConfig를 프로필 없이 저장) → 기본 프로필
    expect(parseStoredConfig(wrap({ robot1: defaults.robot1.config, robot2: defaults.robot2.config, scenario: defaults.scenario }), defaults).applied).toEqual(defaults);
    // 모양 맞추기
    expect(mergeWithDefaults({ a: 1, b: [1], c: { d: 'x' }, extra: 5 }, { a: 2, b: [] as number[], c: { d: 'y', e: 3 } })).toEqual({ a: 1, b: [1], c: { d: 'x', e: 3 } });
    expect(mergeWithDefaults({ a: 1, b: {} }, { a: 2, b: [] as number[] })).toBeNull();
    expect(mergeWithDefaults({ a: Infinity }, { a: 1 })).toBeNull();
    expect(mergeWithDefaults('x', { a: 1 })).toBeNull();
  });

  it('E. 저장소: 메모리 저장 / 불러오기, 저장소 없음 / 오류는 기본값 · 저장 실패(false)', () => {
    const { storage, data } = memory();
    expect(saveStoredConfig(storage, { settings: custom, applied: null })).toBe(true);
    expect(data.has(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(loadStoredConfig(storage, defaults).settings).toEqual(custom);
    expect(loadStoredConfig(null, defaults).settings).toEqual(DEFAULT_SETTINGS);
    expect(saveStoredConfig(null, { settings: custom, applied: null })).toBe(false);
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadStoredConfig(broken, defaults).settings).toEqual(DEFAULT_SETTINGS);
    expect(saveStoredConfig(broken, { settings: custom, applied: null })).toBe(false);
  });

  it('F. 키보드 조작표 키 이름', () => {
    expect(['KeyW', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period', 'Slash', 'KeyM', 'Space', 'Digit1', 'Enter'].map(keyCodeLabel)).toEqual(['W', '←', '→', ',', '.', '/', 'M', 'Space', '1', 'Enter']);
  });
});
