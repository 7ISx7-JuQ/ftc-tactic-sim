// 스크러버 줄 (명세서 3.8 화면 구성, 09-6d: 기존 동작만). 주 버튼(START / PAUSE / RESUME) / VIEW / NEW만 동작하고,
// 틱 · 1초 이동 / 타임라인 끌기 / 재생 / 배속 / RESULT / BRANCH는 자리만 두고 비활성 (09-7).
import type { MouseEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CirclePlay, FastForward, Gamepad2, Pause, Play, Rewind, RotateCcw, SwitchCamera, Trophy } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { DT, MATCH_TICKS } from '../core/simulationEngine';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { mainButton, timelineFraction, timelineMarks } from '../ui/mainScreenModel';

export interface ScrubberActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  toggleView: () => void;
  newMatch: () => void;
}

const SPEEDS = [0.25, 0.5, 1, 2] as const;
const MARKS = timelineMarks(MATCH_TICKS, Math.round(1 / DT));

// 버튼을 누른 뒤 포커스를 남기지 않음 (Space / Enter가 마지막으로 누른 버튼을 다시 누르지 않도록, 단축키는 09-7)
const blurAfter = (action: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.blur();
  action();
};

function IconButton({ label, icon, onClick, disabled, className = '' }: { label: string; icon: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} disabled={disabled || !onClick} onClick={onClick && blurAfter(onClick)}>
      {icon}
    </button>
  );
}

export default function ScrubberBar({ status, lang, actions }: { status: AppStatus; lang: Language; actions: ScrubberActions }) {
  const main = mainButton(status);
  const mainSpec: Record<typeof main.kind, { key: MessageKey; icon: ReactNode; action: () => void }> = {
    START: { key: 'control.start', icon: <Play />, action: actions.start },
    PAUSE: { key: 'control.pause', icon: <Pause />, action: actions.pause },
    RESUME: { key: 'control.resume', icon: <Gamepad2 />, action: actions.resume },
  };
  const spec = mainSpec[main.kind];
  const fraction = timelineFraction(status.tick, MATCH_TICKS);
  const viewKey: MessageKey = status.matchView === 'DRIVER' ? 'view.driver' : 'view.audience';

  return (
    <footer className="scrubber-bar">
      <button type="button" className={`main-button is-${main.kind.toLowerCase()}`} disabled={!main.enabled} onClick={blurAfter(spec.action)}>
        {spec.icon}
        <span>{t(lang, spec.key)}</span>
      </button>

      <div className="scrub-group">
        <IconButton label={t(lang, 'control.stepBackSecond')} icon={<Rewind />} />
        <IconButton label={t(lang, 'control.stepBackTick')} icon={<ChevronLeft />} />
      </div>

      <div className="timeline" role="slider" aria-label={t(lang, 'control.timeline')} aria-valuemin={0} aria-valuemax={MATCH_TICKS} aria-valuenow={status.tick} aria-disabled="true">
        <div className="timeline-track">
          <div className="timeline-recorded" style={{ width: `${fraction * 100}%` }} />
          {MARKS.map(m => (
            <span key={m.fraction} className={`timeline-mark${m.major ? ' is-major' : ''}`} style={{ left: `${m.fraction * 100}%` }} />
          ))}
          <span className="timeline-thumb" style={{ left: `${fraction * 100}%` }} />
        </div>
      </div>

      <div className="scrub-group">
        <IconButton label={t(lang, 'control.stepForwardTick')} icon={<ChevronRight />} />
        <IconButton label={t(lang, 'control.stepForwardSecond')} icon={<FastForward />} />
      </div>

      <IconButton label={t(lang, 'control.play')} icon={<CirclePlay />} />
      <div className="speed-group" role="group" aria-label={t(lang, 'control.speed')} title={t(lang, 'control.speed')}>
        {SPEEDS.map(s => (
          <button type="button" key={s} className={`speed-button${s === 1 ? ' is-selected' : ''}`} disabled>
            {s}×
          </button>
        ))}
      </div>

      <button type="button" className="text-button" title={t(lang, viewKey)} onClick={blurAfter(actions.toggleView)}>
        <SwitchCamera />
        <span>{t(lang, 'control.view')}</span>
      </button>
      <button type="button" className="text-button" disabled={status.phase === 'SETUP'} onClick={blurAfter(actions.newMatch)}>
        <RotateCcw />
        <span>{t(lang, 'control.newMatch')}</span>
      </button>
      <button type="button" className="text-button" disabled>
        <Trophy />
        <span>{t(lang, 'control.result')}</span>
      </button>
    </footer>
  );
}
