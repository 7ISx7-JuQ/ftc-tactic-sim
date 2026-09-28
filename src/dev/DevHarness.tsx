// 개발 하네스 화면 (명세서 3.7, 08-7): 개발 서버 전용, 사용자 비공개. Step 9 GUI가 들어오면 대체된다.
// 시뮬레이션 / 그리기는 HarnessController(React 바깥)가 맡고, React는 버튼 / 체크박스 / 상태 글자만 담당한다.

import { useEffect, useRef, useState } from 'react';
import { SCENE_HEIGHT_PX, SCENE_WIDTH_PX } from '../renderer/viewTransform';
import type { ViewMode } from '../renderer/viewTransform';
import { DEFAULT_RENDER_OPTIONS } from '../renderer/renderOptions';
import type { RenderOptions } from '../renderer/renderOptions';
import { HarnessController } from './harnessController';
import type { HarnessStatus } from './harnessController';

const OPTION_LABELS: Record<keyof RenderOptions, string> = {
  aimGuide: '조준선',
  intakeProgress: '흡입 진행',
  hitProbability: '명중 확률',
  flightTrail: '비행 잔상',
  flightResult: '비행 결과 색',
};

const PAUSE_TEXT: Record<string, string> = {
  USER: '사용자',
  HIDDEN: '탭 숨김',
  BLUR: '창 포커스 소실',
  GAMEPAD_DISCONNECTED: '게임패드 분리',
};

export default function DevHarness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<HarnessController | null>(null);
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [options, setOptions] = useState<RenderOptions>({ ...DEFAULT_RENDER_OPTIONS });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(SCENE_WIDTH_PX * dpr);
    canvas.height = Math.round(SCENE_HEIGHT_PX * dpr);
    const controller = new HarnessController({ ctx, dpr, onStatus: setStatus });
    controllerRef.current = controller;
    setStatus(controller.status());
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const c = () => controllerRef.current;
  const toggleOption = (key: keyof RenderOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    c()?.setOptions(next);
  };

  const phase = status?.phase ?? 'SETUP';
  const loopState = status?.loopState ?? 'READY';
  const inSetup = phase === 'SETUP';

  return (
    <div className="dev-harness">
      <div className="dev-toolbar">
        <strong>개발 하네스</strong>
        <label>
          진영{' '}
          <select value={status?.alliance ?? 'RED'} disabled={!inSetup} onChange={e => c()?.setAlliance(e.target.value as 'RED' | 'BLUE')}>
            <option value="RED">RED</option>
            <option value="BLUE">BLUE</option>
          </select>
        </label>
        <button disabled={!inSetup} onClick={() => c()?.start()}>시작</button>
        <button disabled={loopState !== 'RUNNING'} onClick={() => c()?.pause()}>일시정지</button>
        <button disabled={loopState !== 'PAUSED'} onClick={() => c()?.resume()}>재개</button>
        <button disabled={inSetup} onClick={() => c()?.reset()}>리셋</button>
        <span className="dev-sep" />
        {(['DRIVER', 'AUDIENCE'] as ViewMode[]).map(mode => (
          <label key={mode}>
            <input type="radio" name="view" checked={(status?.matchView ?? 'DRIVER') === mode} onChange={() => c()?.setMatchView(mode)} />
            {mode === 'DRIVER' ? '드라이버 시점' : '관중석 시점'}
          </label>
        ))}
      </div>
      <div className="dev-toolbar">
        {(Object.keys(OPTION_LABELS) as (keyof RenderOptions)[]).map(key => (
          <label key={key}>
            <input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} />
            {OPTION_LABELS[key]}
          </label>
        ))}
      </div>
      <canvas ref={canvasRef} className="dev-canvas" />
      <div className="dev-status">
        <span>단계 {phase}</span>
        <span>
          루프 {loopState}
          {status?.pauseReason ? ` (${PAUSE_TEXT[status.pauseReason] ?? status.pauseReason})` : ''}
        </span>
        <span>틱 {status?.tick ?? 0} / 6000</span>
        <span>남은 시간 {(status?.remainingSec ?? 120).toFixed(1)} s</span>
        <span>점수 {status?.score ?? 0}</span>
        <span>
          게임패드{' '}
          {(status?.gamepads ?? []).map(g => `슬롯 ${g.slot}→${g.robot === 'robot1' ? 'R1' : 'R2'} ${g.connected ? `연결${g.standard ? '' : '(비표준)'}` : '없음'}`).join(' · ')}
        </span>
      </div>
      <div className="dev-hint">
        키보드(R2, 개발용): W/S 전후 · A/D 좌우 · ←/→ 회전 · M 흡입 · , 발사 · . 리프트 올림/내림 · / 투입. 게임패드는 버튼을 한 번 눌러 연결.
      </div>
    </div>
  );
}
