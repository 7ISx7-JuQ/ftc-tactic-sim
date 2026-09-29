// 경기 종료 연출 (09-7c, 필드 위 HTML 층 — 캔버스 / 렌더러는 그대로): 6000틱 순간 흰빛 0.35초 + 종료 강조 5초 동안
// `MATCH COMPLETE` 배너와 줄어드는 진행바("클릭 / Space로 결과 바로 보기"). 실제 종료마다 key(endSeq)로 새로 마운트되어 다시 재생된다.
import type { CSSProperties } from 'react';
import { END_HIGHLIGHT_MS } from '../app/appController';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';

export default function EndOverlay({ lang }: { lang: Language }) {
  return (
    <div className="end-overlay" style={{ '--end-ms': `${END_HIGHLIGHT_MS}ms` } as CSSProperties}>
      <div className="end-flash" />
      <div className="end-banner" role="status">
        <div className="end-banner-title">{t(lang, 'end.banner')}</div>
        <div className="end-banner-bar">
          <span />
        </div>
        <div className="end-banner-hint">{t(lang, 'end.skipHint')}</div>
      </div>
    </div>
  );
}
