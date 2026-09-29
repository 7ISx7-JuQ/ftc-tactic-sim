// 스크러버 줄 (명세서 3.8 화면 구성, 09-7a): 주 버튼(START / PAUSE / RESUME / BRANCH), 1초 · 1틱 이동(길게 누르면 반복),
// 재생 / 배속, VIEW, NEW, RESULT. 타임라인 막대: 보는 틱 + 기록 구간, 클릭 / 끌기로 보는 틱 이동 (09-7b, 끄는 동안 시간 표시).
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CirclePause, CirclePlay, FastForward, Gamepad2, GitBranch, Pause, Play, Rewind, RotateCcw, SwitchCamera, Trophy } from 'lucide-react';
import { PLAYBACK_SPEEDS, TICKS_PER_SECOND } from '../app/appController';
import type { AppStatus, PlaybackSpeed } from '../app/appController';
import { DT, MATCH_TICKS } from '../core/simulationEngine';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { formatMatchTime } from '../ui/units';
import { mainButton, timelineFraction, timelineMarks, timelineTickAt } from '../ui/mainScreenModel';

export interface ScrubberActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  branch: () => void;          // 확인창은 호출하는 쪽(MainScreen)
  stepView: (deltaTicks: number) => void;
  setViewTick: (tick: number) => void;   // 타임라인 클릭 / 끌기 (기록 밖이면 컨트롤러가 마지막 기록 틱에 붙임)
  togglePlayback: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  toggleView: () => void;
  newMatch: () => void;        // 확인창은 호출하는 쪽
  openResult: () => void;
}

const MARKS = timelineMarks(MATCH_TICKS, TICKS_PER_SECOND);
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 66;

// 버튼을 누른 뒤 포커스를 남기지 않음 (Space / Enter가 마지막으로 누른 버튼을 다시 누르지 않도록, Space는 단축키)
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

/** 누르는 즉시 1회, 0.4초 이상 누르고 있으면 반복 (틱 / 1초 이동) */
function RepeatButton({ label, icon, onStep, disabled }: { label: string; icon: ReactNode; onStep: () => void; disabled: boolean }) {
  const timers = useRef<{ delay: number | null; interval: number | null }>({ delay: null, interval: null });
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  });
  const stop = () => {
    if (timers.current.delay !== null) window.clearTimeout(timers.current.delay);
    if (timers.current.interval !== null) window.clearInterval(timers.current.interval);
    timers.current = { delay: null, interval: null };
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); // 포커스를 가져가지 않음
        stop();
        stepRef.current();
        timers.current.delay = window.setTimeout(() => {
          timers.current.interval = window.setInterval(() => stepRef.current(), REPEAT_INTERVAL_MS);
        }, REPEAT_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={e => {
        if (e.key === 'Enter') stepRef.current(); // 키보드 접근 (Space는 전역 단축키)
      }}
    >
      {icon}
    </button>
  );
}

export default function ScrubberBar({ status, lang, actions }: { status: AppStatus; lang: Language; actions: ScrubberActions }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const seek = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) actions.setViewTick(timelineTickAt(clientX, rect.left, rect.width, MATCH_TICKS));
  };
  const isDragging = dragging && status.canScrub; // 끄는 도중 조작 불가 상태가 되면 끌기 무효
  const main = mainButton(status);
  const mainSpec: Record<typeof main.kind, { key: MessageKey; icon: ReactNode; action: () => void }> = {
    START: { key: 'control.start', icon: <Play />, action: actions.start },
    PAUSE: { key: 'control.pause', icon: <Pause />, action: actions.pause },
    RESUME: { key: 'control.resume', icon: <Gamepad2 />, action: actions.resume },
    BRANCH: { key: 'control.branch', icon: <GitBranch />, action: actions.branch },
  };
  const spec = mainSpec[main.kind];
  const viewFraction = timelineFraction(status.tick, MATCH_TICKS);
  const headFraction = status.phase === 'MATCH' ? timelineFraction(status.headTick, MATCH_TICKS) : 0;
  const viewKey: MessageKey = status.matchView === 'DRIVER' ? 'view.driver' : 'view.audience';
  const scrubDisabled = !status.canScrub;

  return (
    <footer className="scrubber-bar">
      <button type="button" className={`main-button is-${main.kind.toLowerCase()}`} disabled={!main.enabled} onClick={blurAfter(spec.action)}>
        {spec.icon}
        <span>{t(lang, spec.key)}</span>
      </button>

      <div className="scrub-group">
        <RepeatButton label={t(lang, 'control.stepBackSecond')} icon={<Rewind />} disabled={scrubDisabled} onStep={() => actions.stepView(-TICKS_PER_SECOND)} />
        <RepeatButton label={t(lang, 'control.stepBackTick')} icon={<ChevronLeft />} disabled={scrubDisabled} onStep={() => actions.stepView(-1)} />
      </div>

      <div
        className={`timeline${status.canScrub ? ' is-active' : ''}${isDragging ? ' is-dragging' : ''}`}
        role="slider"
        aria-label={t(lang, 'control.timeline')}
        aria-valuemin={0}
        aria-valuemax={MATCH_TICKS}
        aria-valuenow={status.tick}
        aria-valuetext={formatMatchTime((MATCH_TICKS - status.tick) * DT)}
        aria-disabled={!status.canScrub}
        onPointerDown={e => {
          if (!status.canScrub || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          seek(e.clientX);
        }}
        onPointerMove={e => {
          if (isDragging) seek(e.clientX);
        }}
        onPointerUp={e => {
          if (!dragging) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="timeline-track" ref={trackRef}>
          <div className="timeline-recorded" style={{ width: `${headFraction * 100}%` }} />
          {MARKS.map(m => (
            <span key={m.fraction} className={`timeline-mark${m.major ? ' is-major' : ''}`} style={{ left: `${m.fraction * 100}%` }} />
          ))}
          <span className="timeline-thumb" style={{ left: `${viewFraction * 100}%` }}>
            {isDragging && <span className="timeline-time">{formatMatchTime((MATCH_TICKS - status.tick) * DT)}</span>}
          </span>
        </div>
      </div>

      <div className="scrub-group">
        <RepeatButton label={t(lang, 'control.stepForwardTick')} icon={<ChevronRight />} disabled={scrubDisabled} onStep={() => actions.stepView(1)} />
        <RepeatButton label={t(lang, 'control.stepForwardSecond')} icon={<FastForward />} disabled={scrubDisabled} onStep={() => actions.stepView(TICKS_PER_SECOND)} />
      </div>

      <IconButton
        label={t(lang, status.playing ? 'control.stopPlayback' : 'control.play')}
        icon={status.playing ? <CirclePause /> : <CirclePlay />}
        disabled={scrubDisabled}
        onClick={actions.togglePlayback}
      />
      <div className="speed-group" role="group" aria-label={t(lang, 'control.speed')} title={t(lang, 'control.speed')}>
        {PLAYBACK_SPEEDS.map(s => (
          <button
            type="button"
            key={s}
            className={`speed-button${s === status.playbackSpeed ? ' is-selected' : ''}`}
            aria-pressed={s === status.playbackSpeed}
            onClick={blurAfter(() => actions.setSpeed(s))}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* 경기 전에는 비활성 (시작 시점은 SETTINGS 기본 보기 방향, 09-8 확정) */}
      <button type="button" className="text-button" title={t(lang, viewKey)} disabled={status.phase === 'SETUP'} onClick={blurAfter(actions.toggleView)}>
        <SwitchCamera />
        <span>{t(lang, 'control.view')}</span>
      </button>
      <button type="button" className="text-button" disabled={status.phase === 'SETUP' || status.phase === 'ROTATING_OUT'} onClick={blurAfter(actions.newMatch)}>
        <RotateCcw />
        <span>{t(lang, 'control.newMatch')}</span>
      </button>
      <button type="button" className="text-button" disabled={status.endStage !== 'REVIEW'} onClick={blurAfter(actions.openResult)}>
        <Trophy />
        <span>{t(lang, 'control.result')}</span>
      </button>
    </footer>
  );
}
