// 도움말 창 (명세서 3.10, v1.0.0): 빠른 시작 / 조작표 / 복기와 가지 / 저장과 공유 / 알아 두기 / 정보(버전 · 라이선스 · 링크) / 버그 리포트.
// 화면 전체를 덮는 모달, Esc · 닫기 버튼 · 바깥 클릭으로 닫힘 (열린 동안 단축키는 MainScreen이 끔).
import { useEffect, useRef } from 'react';
import { Bug, ExternalLink, Mail, X } from 'lucide-react';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { APP_VERSION, BUG_REPORT_EMAIL, LICENSE_URL, NOTICES_URL, REPO_URL, bugReportLinks, controlRows } from '../ui/helpInfo';

const SECTIONS: readonly { title: MessageKey; items: readonly MessageKey[] }[] = [
  { title: 'help.start.title', items: ['help.start.1', 'help.start.2', 'help.start.3', 'help.start.4'] },
  { title: 'help.review.title', items: ['help.review.1', 'help.review.2', 'help.review.3'] },
  { title: 'help.files.title', items: ['help.files.1', 'help.files.2', 'help.files.3'] },
  { title: 'help.notes.title', items: ['help.notes.1', 'help.notes.2'] },
];

export default function HelpDialog({ lang, onClose }: { lang: Language; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const links = bugReportLinks({
    lang,
    version: APP_VERSION,
    userAgent: navigator.userAgent,
    screen: { width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio || 1 },
  });
  const section = (s: (typeof SECTIONS)[number]) => (
    <section key={s.title} className="help-section">
      <h3>{t(lang, s.title)}</h3>
      <ul>
        {s.items.map(key => (
          <li key={key}>{t(lang, key)}</li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="help-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1}>
        <header className="help-header">
          <h2 id="help-title">{t(lang, 'help.title')}</h2>
          <button type="button" className="icon-button" title={t(lang, 'help.close')} aria-label={t(lang, 'help.close')} onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="help-body">
          <p className="help-intro">{t(lang, 'help.intro')}</p>
          {section(SECTIONS[0])}

          <section className="help-section">
            <h3>{t(lang, 'help.controls.title')}</h3>
            <table className="help-controls">
              <thead>
                <tr>
                  <th>{t(lang, 'help.controls.action')}</th>
                  <th>{t(lang, 'help.controls.gamepad')}</th>
                  <th>{t(lang, 'help.controls.keyboard')}</th>
                </tr>
              </thead>
              <tbody>
                {controlRows().map(row => (
                  <tr key={row.label}>
                    <td>{t(lang, row.label)}</td>
                    <td>
                      <kbd>{row.gamepad}</kbd>
                    </td>
                    <td>
                      <kbd>{row.keys}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="help-note">{t(lang, 'help.controls.note')}</p>
          </section>

          {SECTIONS.slice(1).map(section)}

          <section className="help-section help-bug">
            <h3>{t(lang, 'help.bug.title')}</h3>
            <p>{t(lang, 'help.bug.text')}</p>
            <div className="help-bug-actions">
              <a className="help-button is-primary" href={links.gmail} target="_blank" rel="noreferrer">
                <Bug />
                {t(lang, 'help.bug.gmail')}
              </a>
              <a className="help-button" href={links.mailto}>
                <Mail />
                {t(lang, 'help.bug.mailApp')}
              </a>
            </div>
            <p className="help-note">{t(lang, 'help.bug.address', { email: BUG_REPORT_EMAIL })}</p>
          </section>

          <section className="help-section help-about">
            <h3>{t(lang, 'help.about.title')}</h3>
            <p>
              <b>{t(lang, 'app.name')}</b> · {t(lang, 'help.about.version', { version: APP_VERSION })}
            </p>
            <p>{t(lang, 'help.about.license')}</p>
            <p className="help-links">
              {(
                [
                  [REPO_URL, 'help.about.source'],
                  [LICENSE_URL, 'help.about.licenseLink'],
                  [NOTICES_URL, 'help.about.notices'],
                ] as const
              ).map(([href, key]) => (
                <a key={key} href={href} target="_blank" rel="noreferrer">
                  {t(lang, key)}
                  <ExternalLink />
                </a>
              ))}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
