// 결과 팝업 (명세서 3.8 경기 종료와 결과 팝업, 09-7a 기본형 — 점수 집계표). 종료 강조 5초 뒤 / RESULT 버튼으로 열림.
// 값은 종료 프레임(scoreBreakdown)만 읽는다 (3.2항 실시간 / 확정 분리). 세부 디자인은 09-12에서 확정.
import { Check } from 'lucide-react';
import type { MatchResult } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';

export default function ResultPopup({
  result,
  alliance,
  lang,
  onReview,
  onRestart,
}: {
  result: MatchResult;
  alliance: 'RED' | 'BLUE';
  lang: Language;
  onReview: () => void;
  onRestart: () => void;
}) {
  const { breakdown, rp } = result;
  const rows: [string, number][] = [
    ['HIVE', breakdown.hive],
    ['FLOWER', breakdown.flower],
    ['GARDEN', breakdown.garden],
    ['PARK', breakdown.park],
  ];
  const rpCards: [string, boolean][] = [
    ['SWARM', rp.swarm],
    ['POLLINATOR 1', rp.pollinator1],
    ['POLLINATOR 2', rp.pollinator2],
  ];
  const colors = ALLIANCE_COLORS[alliance];

  return (
    <div className="result-backdrop" role="dialog" aria-modal="true" aria-label={t(lang, 'result.title')}>
      <div className="result-popup">
        <header className="result-header">
          <div className="result-app">{t(lang, 'app.name')}</div>
          <div className="result-title">{t(lang, 'result.title')}</div>
          <div className="result-alliance" style={{ background: colors.base }}>{alliance} ALLIANCE</div>
        </header>

        <div className="result-total">
          <span className="result-total-label">{t(lang, 'result.total')}</span>
          <span className="result-total-value">{result.total}</span>
        </div>

        <table className="result-table">
          <tbody>
            {rows.map(([name, points]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{points}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="result-rp">
          <div className="result-rp-head">
            <span>{t(lang, 'result.rp')}</span>
            <span className="result-rp-tips">{t(lang, 'result.tips', { count: result.tips })}</span>
          </div>
          <div className="result-rp-cards">
            {rpCards.map(([name, achieved]) => (
              <div key={name} className={`result-rp-card${achieved ? ' is-achieved' : ''}`}>
                {achieved && <Check />}
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="result-actions">
          <button type="button" className="result-button" onClick={onRestart}>
            {t(lang, 'result.restart')}
          </button>
          <button type="button" className="result-button is-primary" onClick={onReview} autoFocus>
            {t(lang, 'result.review')}
          </button>
        </div>
      </div>
    </div>
  );
}
