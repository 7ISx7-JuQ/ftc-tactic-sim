// 도움말 / 버그 리포트 (명세서 3.10, v1.0.0)
import { describe, expect, it } from 'vitest';
import { KEYBOARD_BINDINGS } from '../../input/inputConfig';
import { APP_VERSION, BUG_REPORT_EMAIL, bugReportBody, bugReportLinks, bugReportSubject, controlRows, gmailComposeUrl, mailtoUrl } from '../helpInfo';
import { keyCodeLabel } from '../settings';
import packageJson from '../../../package.json?raw';

const ctx = { lang: 'en' as const, version: '1.0.0', userAgent: 'Mozilla/5.0 (Test) Chrome/140', screen: { width: 2560, height: 1440, dpr: 1.25 } };

describe('도움말 / 버그 리포트 (v1.0.0)', () => {
  it('A. 앱 버전 = package.json version, 받는 사람 주소', () => {
    const pkg = JSON.parse(packageJson) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toBe('1.0.0');
    expect(BUG_REPORT_EMAIL).toBe('7isx7juq@gmail.com');
  });

  it('B. Gmail 쓰기 창 링크: 받는 사람 / 제목 / 본문이 그대로 풀림 (줄바꿈 · & · # · 한글 포함)', () => {
    const body = 'line 1\nA & B #3 = 한글?';
    const url = new URL(gmailComposeUrl('a@b.com', '[FTC] Bug & more', body));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe('a@b.com');
    expect(url.searchParams.get('su')).toBe('[FTC] Bug & more');
    expect(url.searchParams.get('body')).toBe(body);
    const mail = mailtoUrl('a@b.com', 'S p', body);
    expect(mail.startsWith('mailto:a@b.com?subject=S%20p&body=')).toBe(true);
    expect(decodeURIComponent(mail.split('&body=')[1])).toBe(body);
  });

  it('C. 제목 / 본문: 버전 · 브라우저 · 화면 · 언어를 채움, 현재 화면 언어의 틀', () => {
    expect(bugReportSubject('1.0.0')).toBe('[FTC TacticSim 1.0.0] Bug report');
    const en = bugReportBody(ctx);
    expect(en).toContain('Steps to reproduce:');
    expect(en).toContain('FTC TacticSim 1.0.0\nBrowser: Mozilla/5.0 (Test) Chrome/140\nScreen: 2560 × 1440 @1.25x\nLanguage: en');
    const ko = bugReportBody({ ...ctx, lang: 'ko', userAgent: '' });
    expect(ko).toContain('재현 순서:');
    expect(ko).toContain('브라우저: ?');
    expect(ko).not.toMatch(/\{\w+\}/);
    const links = bugReportLinks(ctx);
    expect(new URL(links.gmail).searchParams.get('to')).toBe(BUG_REPORT_EMAIL);
    expect(new URL(links.gmail).searchParams.get('body')).toBe(en);
    expect(links.mailto.startsWith(`mailto:${BUG_REPORT_EMAIL}?`)).toBe(true);
  });

  it('D. 조작표: 키보드 칸은 키 설정(inputConfig)을 그대로 읽음', () => {
    const rows = controlRows();
    const b = KEYBOARD_BINDINGS;
    expect(rows.find(r => r.label === 'settings.keys.move')!.keys).toBe([b.forward, b.left, b.backward, b.right].map(keyCodeLabel).join(' '));
    expect(rows.find(r => r.label === 'settings.keys.shoot')).toMatchObject({ gamepad: 'RT', keys: keyCodeLabel(b.shoot) });
    expect(rows.find(r => r.label === 'settings.keys.lift')).toMatchObject({ gamepad: 'A', keys: keyCodeLabel(b.lift) });
    expect(rows).toHaveLength(9);
  });
});
