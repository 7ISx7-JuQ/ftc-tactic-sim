// 도움말 / 버그 리포트 / 앱 정보 (명세서 3.10, v1.0.0): React / DOM 비의존 순수 함수
// - 버그 리포트: 지정 메일을 받는 사람으로 한 Gmail 쓰기 창 링크 + 기본 메일 앱(mailto) 링크. 제목 / 본문에 버전 · 브라우저 · 화면을 미리 채운다.
// - 조작표: 도움말과 SETTINGS 키보드 조작표가 같은 키 설정(inputConfig)을 읽는다.

import { KEYBOARD_BINDINGS } from '../input/inputConfig';
import { t } from './i18n';
import type { Language, MessageKey } from './i18n';
import { keyCodeLabel } from './settings';

export const APP_VERSION: string = __APP_VERSION__;
export const REPO_URL = 'https://github.com/7ISx7-JuQ/ftc-tactic-sim';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;
export const BUG_REPORT_EMAIL = '7isx7juq@gmail.com';

// ------------------------------------------------------------
// 버그 리포트
// ------------------------------------------------------------

export interface BugReportContext {
  lang: Language;
  version: string;
  userAgent: string;
  screen: { width: number; height: number; dpr: number };
}

export const bugReportSubject = (version: string): string => `[FTC TacticSim ${version}] Bug report`;

/** 본문: 현재 화면 언어의 작성 틀 + 환경 정보 (줄바꿈 \n) */
export function bugReportBody(ctx: BugReportContext): string {
  const { width, height, dpr } = ctx.screen;
  return t(ctx.lang, 'help.bug.body', {
    version: ctx.version,
    browser: ctx.userAgent || '?',
    screen: `${Math.round(width)} × ${Math.round(height)} @${Math.round(dpr * 100) / 100}x`,
    language: ctx.lang,
  });
}

/** Gmail 쓰기 창 (로그인한 Gmail에서 받는 사람 / 제목 / 본문이 채워진 새 메일) */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = [`view=cm`, `fs=1`, `to=${encodeURIComponent(to)}`, `su=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`];
  return `https://mail.google.com/mail/?${q.join('&')}`;
}

/** 기본 메일 앱 (Gmail을 쓰지 않는 사용자) */
export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function bugReportLinks(ctx: BugReportContext): { gmail: string; mailto: string } {
  const subject = bugReportSubject(ctx.version);
  const body = bugReportBody(ctx);
  return { gmail: gmailComposeUrl(BUG_REPORT_EMAIL, subject, body), mailto: mailtoUrl(BUG_REPORT_EMAIL, subject, body) };
}

// ------------------------------------------------------------
// 조작표 (게임패드 / 키보드)
// ------------------------------------------------------------

export interface ControlRow {
  label: MessageKey;
  gamepad: string; // 표준 매핑 버튼 이름 (없으면 —)
  keys: string;    // 키보드 (inputConfig 키 이름)
}

export function controlRows(): ControlRow[] {
  const k = (codes: string[]) => codes.map(keyCodeLabel).join(' ');
  const b = KEYBOARD_BINDINGS;
  return [
    { label: 'settings.keys.move', gamepad: 'L-stick', keys: k([b.forward, b.left, b.backward, b.right]) },
    { label: 'settings.keys.turn', gamepad: 'R-stick ←→', keys: k([b.turnLeft, b.turnRight]) },
    { label: 'settings.keys.intake', gamepad: 'LT', keys: k([b.intake]) },
    { label: 'settings.keys.shoot', gamepad: 'RT', keys: k([b.shoot]) },
    { label: 'settings.keys.lift', gamepad: 'A', keys: k([b.lift]) },
    { label: 'settings.keys.drop', gamepad: 'B', keys: k([b.drop]) },
    { label: 'settings.keys.pause', gamepad: '—', keys: 'Space' },
    { label: 'settings.keys.stepTick', gamepad: '—', keys: '← →' },
    { label: 'settings.keys.stepSecond', gamepad: '—', keys: 'Shift + ← →' },
  ];
}
