// 경기 종료 연출 (09-7c, 필드 위 HTML 층 — 캔버스 / 렌더러는 그대로): 6000틱 순간 흰빛 0.35초 + `MATCH COMPLETE` 배너.
// 13-7: 0:00 뒤 정착 재생(SETTLE) 동안은 진행바 없이 "정착 중 — 클릭 / Space로 건너뛰기", 종료 강조(HIGHLIGHT) 5초 동안은
// 줄어드는 진행바("클릭 / Space로 결과 바로 보기" — 진행바는 그때 새로 마운트되어 5초를 셈). 실제 종료마다 key(endSeq)로 새로 마운트된다.
import type { CSSProperties } from 'react';
import { END_HIGHLIGHT_MS } from '../app/appController';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';

export default function EndOverlay({ lang, settling }: { lang: Language; settling: boolean }) {
  return (
    <div className="end-overlay" style={{ '--end-ms': `${END_HIGHLIGHT_MS}ms` } as CSSProperties}>
      <div className="end-flash" />
      <div className="end-banner" role="status">
        <div className="end-banner-title">{t(lang, 'end.banner')}</div>
        {!settling && (
          <div className="end-banner-bar">
            <span />
          </div>
        )}
        <div className="end-banner-hint">{t(lang, settling ? 'end.settleHint' : 'end.skipHint')}</div>
      </div>
    </div>
  );
}
