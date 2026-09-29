// 좌측 득점 패널 (명세서 3.8 화면 구성, 09-6d): 타이머 / 진영 점수 / TIP 횟수 / 로봇 + 명중 확률. AppStatus만 읽는다.
// 09-7c: 마지막 10초 타이머 빨강 + 1초 맥박, 경기 종료 강조 동안 점수 카운트업 + 종료 시 더해진 항목 칩.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { formatMatchTime } from '../ui/units';
import { END_CHIP_STAGGER_MS, END_TALLY_MS, endScoreTally, formatPercent, robotLabel, tallyValue, timerIsEndgame, timerIsFinalCountdown, tipDisplay } from '../ui/mainScreenModel';
import type { EndTally } from '../ui/mainScreenModel';
import HiveIcon from './HiveIcon';

const ROBOT_IDS = ['robot1', 'robot2'] as const;

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 종료 점수 카운트업 (텔레옵 점수 → 최종) + 더해진 항목 칩이 차례로 뜸. 종료마다 key로 새로 마운트 */
function ScoreTally({ tally }: { tally: EndTally }) {
  const [elapsed, setElapsed] = useState(() => (prefersReducedMotion() ? END_TALLY_MS : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const e = now - start;
      setElapsed(e);
      if (e < END_TALLY_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="score-value is-tallying">{tallyValue(tally.from, tally.to, elapsed)}</div>
      {tally.chips.length > 0 && (
        <div className="score-chips">
          {tally.chips.map((chip, i) => (
            <span key={chip.label} className="score-chip" style={{ animationDelay: `${i * END_CHIP_STAGGER_MS}ms` } as CSSProperties}>
              +{chip.points} {chip.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** 좌측 패널 로봇 표시 (09-9 확정): 팀 번호가 있으면 #번호, 없으면 R1 / R2 + 옆에 작게 팀명 */
export interface PanelTeam {
  teamNumber: string;
  teamName: string;
}

export default function LeftPanel({ status, lang, teams }: { status: AppStatus; lang: Language; teams?: Readonly<Record<'robot1' | 'robot2', PanelTeam>> }) {
  const tip = tipDisplay(status.autoTipCount, status.tipCount);
  const colors = ALLIANCE_COLORS[status.alliance];

  return (
    <aside className="left-panel">
      <section className="panel-box timer-box" aria-label={t(lang, 'panel.timeRemaining')}>
        <div className="panel-caption">{t(lang, 'panel.timeRemaining')}</div>
        <div className={`timer-value${timerIsFinalCountdown(status) ? ' is-final' : timerIsEndgame(status) ? ' is-endgame' : ''}`}>
          {/* 마지막 10초 진행 중: 초가 바뀔 때마다 새로 마운트되어 맥박 애니메이션이 다시 시작 */}
          <span key={timerIsFinalCountdown(status) && status.loopState === 'RUNNING' ? Math.ceil(status.remainingSec) : 'still'} className={timerIsFinalCountdown(status) && status.loopState === 'RUNNING' ? 'timer-pulse' : undefined}>
            {formatMatchTime(status.remainingSec)}
          </span>
        </div>
      </section>

      <section className="panel-box score-box" style={{ background: colors.base, borderColor: colors.dark }} aria-label={t(lang, 'panel.score')}>
        <div className="score-alliance">{status.alliance}</div>
        {status.endStage === 'HIGHLIGHT' && status.result ? (
          <ScoreTally key={status.endSeq} tally={endScoreTally(status.result)} />
        ) : (
          <div className="score-value">{status.score}</div>
        )}
      </section>

      <section className="panel-box tip-box" title={t(lang, tip.allDone ? 'panel.tipAllDone' : 'panel.tipTarget')}>
        <span className="tip-icon"><HiveIcon size="100%" /></span>
        <span className="tip-label">{t(lang, 'panel.tip')}</span>
        <span className="tip-count">
          {tip.count}
          <span className="tip-target"> / {tip.target}</span>
        </span>
        {tip.allDone && <Check className="tip-done" aria-label={t(lang, 'panel.tipAllDone')} />}
      </section>

      <section className="panel-box robots-box">
        {ROBOT_IDS.map(id => {
          const hit = status.hitProbability?.[id];
          return (
            <div className="robot-row" key={id}>
              <div className="robot-name">
                {robotLabel(id, teams?.[id].teamNumber)}
                {teams?.[id].teamName && <span className="robot-team-name">{teams[id].teamName}</span>}
              </div>
              {hit && (
                <div className="hit-rows" aria-label={t(lang, 'panel.hitProbability')}>
                  {(['POLLEN', 'NECTAR'] as const).map(type => (
                    <div className={`hit-row${hit.next === type ? ' is-next' : ''}`} key={type}>
                      <span className={`hit-dot ${type === 'POLLEN' ? 'is-pollen' : 'is-nectar'}`} style={type === 'NECTAR' ? { background: colors.base } : undefined} />
                      <span className="hit-type">{type}</span>
                      <span className="hit-value">{formatPercent(hit[type])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </aside>
  );
}
