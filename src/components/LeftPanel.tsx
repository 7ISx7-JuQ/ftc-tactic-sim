// 좌측 득점 패널 (명세서 3.8 화면 구성, 09-6d): 타이머 / 진영 점수 / TIP 횟수 / 로봇 + 명중 확률. AppStatus만 읽는다.
import { Check } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { formatMatchTime } from '../ui/units';
import { formatPercent, robotLabel, timerIsEndgame, tipDisplay } from '../ui/mainScreenModel';
import HiveIcon from './HiveIcon';

const ROBOT_IDS = ['robot1', 'robot2'] as const;

export default function LeftPanel({ status, lang }: { status: AppStatus; lang: Language }) {
  const tip = tipDisplay(status.autoTipCount, status.tipCount);
  const colors = ALLIANCE_COLORS[status.alliance];

  return (
    <aside className="left-panel">
      <section className="panel-box timer-box" aria-label={t(lang, 'panel.timeRemaining')}>
        <div className="panel-caption">{t(lang, 'panel.timeRemaining')}</div>
        <div className={`timer-value${timerIsEndgame(status) ? ' is-endgame' : ''}`}>{formatMatchTime(status.remainingSec)}</div>
      </section>

      <section className="panel-box score-box" style={{ background: colors.base, borderColor: colors.dark }} aria-label={t(lang, 'panel.score')}>
        <div className="score-alliance">{status.alliance}</div>
        <div className="score-value">{status.score}</div>
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
              <div className="robot-name">{robotLabel(id)}</div>
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
