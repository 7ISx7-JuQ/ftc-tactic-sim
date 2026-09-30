// 결과 팝업 (명세서 3.8 경기 종료와 결과 팝업, 09-7a 기본형 → 09-12 확정). 종료 강조 5초 뒤 / RESULT 버튼으로 열림.
// 값은 종료 프레임(scoreBreakdown / RP / TIP)만 읽는다 (3.2항 실시간 / 확정 분리). 표시 규칙은 src/ui/resultModel.ts.
// 09-12 확정: 헤더 아래 두 로봇 칩(좌측 패널과 같은 팀 표시), 항목별 점수 + 한 줄 근거, RP 카드 = 조건 + 지금 값.
// 10-4: 동작 줄 위에 EXPORT MATCH(경기 레시피 .json) / EXPORT SUMMARY(요약 .txt) 줄.
// 10-6: 가지가 2개 이상이면 진영 옆에 지금 가지 이름, 종료한 가지가 2개 이상이면 가지 비교 줄(점수, 지금 가지 강조, 최고 점수 표시).
import { Check, Download, FileText, GitFork, Trophy } from 'lucide-react';
import type { MatchResult } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { robotLabel } from '../ui/mainScreenModel';
import { resultBasisText, resultRows, rpCards } from '../ui/resultModel';

type RobotId = 'robot1' | 'robot2';
const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const SHORT: Readonly<Record<RobotId, string>> = { robot1: 'R1', robot2: 'R2' };

export interface ResultTeam {
  teamNumber: string;
  teamName: string;
}

export default function ResultPopup({
  result,
  alliance,
  teams,
  lang,
  onReview,
  onRestart,
  onExportMatch,
  onExportSummary,
  branchName,
  comparison,
}: {
  result: MatchResult;
  alliance: 'RED' | 'BLUE';
  teams: Readonly<Record<RobotId, ResultTeam>>;
  lang: Language;
  onReview: () => void;
  onRestart: () => void;
  onExportMatch: () => void;   // 경기 파일 (.json, 10-4)
  onExportSummary: () => void; // 요약 (.txt, 10-4)
  branchName: string | null;    // 지금 가지 이름 (가지 2개 이상일 때만, 10-6)
  comparison: { id: number; label: string; score: number; current: boolean; best: boolean }[] | null; // 종료한 가지 비교 (2개 이상일 때만)
}) {
  const colors = ALLIANCE_COLORS[alliance];

  return (
    <div className="result-backdrop" role="dialog" aria-modal="true" aria-label={t(lang, 'result.title')}>
      <div className="result-popup">
        <header className="result-header">
          <div className="result-app">{t(lang, 'app.name')}</div>
          <div className="result-title">{t(lang, 'result.title')}</div>
          <div className="result-alliance-row">
            <div className="result-alliance" style={{ background: colors.base }}>{alliance} ALLIANCE</div>
            {branchName && (
              <span className="result-branch">
                <GitFork />
                {branchName}
              </span>
            )}
          </div>
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
                  <span className="result-row-basis">{resultBasisText(row, lang)}</span>
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

        {comparison && (
          <div className="result-compare">
            <span className="result-compare-head">{t(lang, 'result.branches')}</span>
            {comparison.map(c => (
              <span key={c.id} className={`result-compare-chip${c.current ? ' is-current' : ''}`}>
                {c.best && <Trophy aria-label={t(lang, 'branch.best')} />}
                <span className="result-compare-name">{c.label}</span>
                <b>{c.score}</b>
              </span>
            ))}
          </div>
        )}

        <div className="result-exports">
          <button type="button" className="config-button" onClick={onExportMatch}>
            <Download />
            {t(lang, 'result.exportMatch')}
          </button>
          <button type="button" className="config-button" onClick={onExportSummary}>
            <FileText />
            {t(lang, 'result.exportSummary')}
          </button>
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
