// 결과 팝업 (명세서 3.8 경기 종료와 결과 팝업, 09-7a 기본형 → 09-12 확정). 종료 강조 5초 뒤 / RESULT 버튼으로 열림.
// 값은 종료 프레임(scoreBreakdown / RP / TIP)만 읽는다 (3.2항 실시간 / 확정 분리). 표시 규칙은 src/ui/resultModel.ts.
// 09-12 확정: 헤더 아래 두 로봇 칩(좌측 패널과 같은 팀 표시), 항목별 점수 + 한 줄 근거, RP 카드 = 조건 + 지금 값.
import { Check } from 'lucide-react';
import type { MatchResult } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { robotLabel } from '../ui/mainScreenModel';
import { resultRows, rpCards } from '../ui/resultModel';
import type { ResultRow } from '../ui/resultModel';

type RobotId = 'robot1' | 'robot2';
const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const SHORT: Readonly<Record<RobotId, string>> = { robot1: 'R1', robot2: 'R2' };

export interface ResultTeam {
  teamNumber: string;
  teamName: string;
}

/** 항목 근거 한 줄 (여러 조각은 · 로 이음) */
function basisText(row: ResultRow, lang: Language): string {
  switch (row.key) {
    case 'HIVE': {
      const parts = [t(lang, 'result.basis.hive', { count: row.teleopTips })];
      if (row.autoTips > 0) parts.push(t(lang, 'result.basis.hiveAuto', { count: row.autoTips }));
      return parts.join(' · ');
    }
    case 'FLOWER':
      if (row.flowers.length === 0) return t(lang, 'result.basis.flowerNone');
      return row.flowers
        .map(f => t(lang, 'result.basis.flower', { number: f.number, pieces: f.pieces }) + (f.bonus > 0 ? t(lang, 'result.basis.flowerBonus', { bonus: f.bonus }) : ''))
        .join(' · ');
    case 'GARDEN':
      return t(lang, 'result.basis.garden', { count: row.pieces });
    case 'PARK':
      return row.robots.length === 0 ? t(lang, 'result.basis.parkNone') : t(lang, 'result.basis.park', { robots: row.robots.map(r => SHORT[r]).join(' · ') });
  }
}

export default function ResultPopup({
  result,
  alliance,
  teams,
  lang,
  onReview,
  onRestart,
}: {
  result: MatchResult;
  alliance: 'RED' | 'BLUE';
  teams: Readonly<Record<RobotId, ResultTeam>>;
  lang: Language;
  onReview: () => void;
  onRestart: () => void;
}) {
  const colors = ALLIANCE_COLORS[alliance];

  return (
    <div className="result-backdrop" role="dialog" aria-modal="true" aria-label={t(lang, 'result.title')}>
      <div className="result-popup">
        <header className="result-header">
          <div className="result-app">{t(lang, 'app.name')}</div>
          <div className="result-title">{t(lang, 'result.title')}</div>
          <div className="result-alliance" style={{ background: colors.base }}>{alliance} ALLIANCE</div>
          <div className="result-robots">
            {ROBOTS.map(id => {
              const team = teams[id];
              const number = robotLabel(id, team.teamNumber);
              return (
                <span key={id} className="result-robot">
                  <span className="result-robot-slot" style={{ background: colors.base }}>
                    {SHORT[id]}
                  </span>
                  {number !== SHORT[id] && <b>{number}</b>}
                  {team.teamName && <span className="result-robot-name">{team.teamName}</span>}
                </span>
              );
            })}
          </div>
        </header>

        <div className="result-total">
          <span className="result-total-label">{t(lang, 'result.total')}</span>
          <span className="result-total-value">{result.total}</span>
        </div>

        <table className="result-table">
          <tbody>
            {resultRows(result).map(row => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="result-row-name">{row.key}</span>
                  <span className="result-row-basis">{basisText(row, lang)}</span>
                </th>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="result-rp">
          <div className="result-rp-head">
            <span>{t(lang, 'result.rp')}</span>
          </div>
          <div className="result-rp-cards">
            {rpCards(result).map(card => (
              <div key={card.key} className={`result-rp-card${card.achieved ? ' is-achieved' : ''}`}>
                <span className="result-rp-name">
                  {card.achieved && <Check />}
                  {card.key}
                </span>
                <span className="result-rp-progress">{t(lang, 'result.rp.progress', { unit: card.unit, current: card.current, target: card.target })}</span>
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
