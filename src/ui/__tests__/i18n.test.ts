import { describe, expect, it } from 'vitest';
import type { BallisticsIssue } from '../../core/ballistics';
import type { PlacementIssue, ScenarioIssue } from '../../core/simulationEngine';
import type { PauseReason } from '../../input/realtimeLoop';
import type { LUTGenState } from '../../workers/lutManager';
import { DEFAULT_LANGUAGE, GAME_TERMS, LANGUAGES, MESSAGES, t, toLanguage } from '../i18n';
import type { Language, MessageKey } from '../i18n';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

// 타입이 모든 코드 / 상태를 나열하도록 강제 (새 코드가 생기면 여기서 컴파일 오류 → 문구 추가)
const ISSUE_CODES: Record<ScenarioIssue['code'] | PlacementIssue['code'] | BallisticsIssue['code'], true> = {
  FLOWER_COUNT: true, GARDEN_COUNT: true, HIVE_COUNT: true, HIVE_OVER_THRESHOLD: true, LOADOUT_OVER_CAPACITY: true,
  LOADOUT_NECTAR_NOT_ALLOWED: true, NECTAR_IN_PLAY_EXCEEDED: true, POLLEN_TOTAL_EXCEEDED: true, AUTO_TIP_COUNT: true,
  PLACEMENT_OUT_OF_FIELD: true, PLACEMENT_IN_HIVE: true, PLACEMENT_IN_FLOWER: true, PLACEMENT_ROBOT_OVERLAP: true, PLACEMENT_PIECE_OVERLAP: true,
  PARAM_INVALID: true, SWEET_SPOT_OUT_OF_FIELD: true, SWEET_SPOT_IN_HIVE: true, SWEET_SPOT_NO_SOLUTION: true,
};
const LUT_STATES: Record<LUTGenState, true> = { IDLE: true, QUEUED: true, SEARCHING: true, GENERATING: true, READY: true, ERROR: true, CANCELLED: true };
const PAUSE_REASONS: Record<PauseReason, true> = { USER: true, HIDDEN: true, BLUR: true, GAMEPAD_DISCONNECTED: true };

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('화면 문구 사전 (09-6a)', () => {
  it('A. 사전 완전성 / 자리표시자 / 게임 용어 대문자', () => {
    const enKeys = Object.keys(MESSAGES.en).sort();
    assert(LANGUAGES.join() === 'en,ko' && DEFAULT_LANGUAGE === 'en', 'English default, Korean toggle');
    assert(JSON.stringify(Object.keys(MESSAGES.ko).sort()) === JSON.stringify(enKeys), 'ko has exactly the en keys');
    for (const lang of LANGUAGES) {
      for (const key of enKeys as MessageKey[]) {
        const text = MESSAGES[lang][key];
        assert(typeof text === 'string' && text.trim().length > 0, `${lang} ${key} not empty`);
        assert(placeholders(text) === placeholders(MESSAGES.en[key]), `${lang} ${key} placeholders match en (${placeholders(text)})`);
        // 게임 용어는 원어 대문자로만 (단어 경계, 대소문자 무시로 찾은 모든 출현이 대문자 원형이어야 함)
        for (const term of GAME_TERMS) {
          for (const m of text.matchAll(new RegExp(`\\b${escape(term)}\\b`, 'gi'))) {
            assert(m[0] === term, `${lang} ${key}: game term "${m[0]}" must be written "${term}"`);
          }
        }
      }
    }
    // 영어 문구에 쓰인 게임 용어는 한국어 문구에도 원어 그대로
    for (const key of enKeys as MessageKey[]) {
      for (const term of GAME_TERMS) {
        if (new RegExp(`\\b${escape(term)}\\b`).test(MESSAGES.en[key])) {
          assert(new RegExp(`\\b${escape(term)}\\b`).test(MESSAGES.ko[key]), `ko ${key} keeps the game term ${term}`);
        }
      }
    }
  });

  it('B. 엔진 코드 / 상태별 문구 존재', () => {
    for (const code of Object.keys(ISSUE_CODES)) assert(`issue.${code}` in MESSAGES.en, `issue.${code} message exists`);
    for (const state of Object.keys(LUT_STATES)) assert(`lut.${state}` in MESSAGES.en, `lut.${state} message exists`);
    for (const reason of Object.keys(PAUSE_REASONS)) assert(`pause.${reason}` in MESSAGES.en, `pause.${reason} message exists`);
  });

  it('C. 조회 / 자리표시자 치환 / 대체', () => {
    assert(t('en', 'control.start') === 'START' && t('ko', 'control.start') === '시작', 'lookup by language');
    assert(t('ko', 'lut.GENERATING', { percent: 63 }) === '확률표 생성 중 63%', 'number parameter');
    assert(t('en', 'confirm.branch', { time: '1:12', seconds: '47.9' }) === 'Recorded match after 1:12 (47.9 s) will be deleted. Drive again from here?', 'several parameters');
    assert(t('en', 'issue.PLACEMENT_IN_HIVE') === '{robot} body overlaps the HIVE', 'missing parameter left as is');
    assert(t('en', 'issue.PLACEMENT_IN_HIVE', { other: 1 }) === '{robot} body overlaps the HIVE', 'unrelated parameter ignored');
    assert(t('fr' as Language, 'control.pause') === 'PAUSE', 'unknown language -> English');
    assert(t('ko', 'no.such.key' as MessageKey) === 'no.such.key', 'unknown key -> key text');
    assert(toLanguage('ko') === 'ko' && toLanguage('en') === 'en' && toLanguage('de') === 'en' && toLanguage(undefined) === 'en', 'stored language validation');
  });
});
