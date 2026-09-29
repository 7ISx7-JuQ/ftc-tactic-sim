// 메인 화면 (명세서 3.8 화면 구성, 09-6d 화면 뼈대): 좌측 득점 패널 / 필드 / 접힌 config 아이콘 띠 / 스크러버 줄.
// 시뮬레이션 / 그리기는 AppController(React 밖)가 소유하고, React는 약 10 Hz 상태 알림으로 패널 / 버튼만 그린다.
// 경기 설정은 config 창(09-8 ~ 09-11) 전까지 고정 기본 설정(createDefaultSetup), 언어는 SETTINGS 탭(09-8) 전까지 주소 ?lang=ko.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AppController } from '../app/appController';
import type { AppStatus } from '../app/appController';
import { createDefaultSetup } from '../app/defaultSetup';
import { DT, MATCH_TICKS } from '../core/simulationEngine';
import { t, toLanguage } from '../ui/i18n';
import { branchConfirmParams, fieldCanvasSize, layoutCssVars } from '../ui/mainScreenModel';
import ConfigRail from './ConfigRail';
import LeftPanel from './LeftPanel';
import ResultPopup from './ResultPopup';
import ScrubberBar from './ScrubberBar';
import type { ScrubberActions } from './ScrubberBar';
import './MainScreen.css';

const LAYOUT_STYLE = layoutCssVars() as CSSProperties;
const initialLanguage = () => toLanguage(new URLSearchParams(window.location.search).get('lang'));

export default function MainScreen() {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AppController | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [lang] = useState(initialLanguage);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!area || !canvas || !ctx) return;

    // 필드 영역에 맞는 정사각형: CSS 크기 = 영역의 짧은 변, 버퍼 = CSS px × devicePixelRatio, 배율 = 버퍼 / 800.
    // 버퍼를 바꾸면 캔버스가 지워지므로 다시 그림. 배율은 버퍼가 그대로여도 매번 넘긴다
    // (개발 모드 StrictMode 재마운트처럼 이미 맞춰진 캔버스에 새 컨트롤러가 붙는 경우)
    const measure = () => {
      const size = fieldCanvasSize(area.clientWidth, area.clientHeight, window.devicePixelRatio || 1);
      canvas.style.width = canvas.style.height = `${size.cssPx}px`;
      const resized = canvas.width !== size.bufferPx || canvas.height !== size.bufferPx;
      if (resized) canvas.width = canvas.height = size.bufferPx;
      return { scale: size.scale, resized };
    };

    const controller = new AppController({ ctx, dpr: measure().scale, setup: createDefaultSetup('RED'), onStatus: setStatus });
    controllerRef.current = controller;
    setStatus(controller.status());

    const fit = () => {
      const { scale, resized } = measure();
      controller.setRenderScale(scale);
      if (resized) controller.redraw();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    window.addEventListener('resize', fit); // 브라우저 확대 / 모니터 이동으로 devicePixelRatio만 바뀐 경우
    // 웹폰트(Pretendard)가 늦게 도착하면 캔버스 글자(로봇 번호 / HIVE 알약)를 다시 그림
    let alive = true;
    void document.fonts?.ready.then(() => alive && controller.redraw());

    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener('resize', fit);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const c = () => controllerRef.current;

  // 확인창 (09-7a: 브라우저 기본 confirm 임시 사용 — 09-7b에서 필드 위 모달로 교체). 떠 있는 동안 단축키 끔
  const ask = (message: string): boolean => {
    const controller = c();
    controller?.setShortcutsEnabled(false);
    try {
      return window.confirm(message);
    } finally {
      controller?.setShortcutsEnabled(true);
    }
  };

  // 분기: 재생 중이면 멈춘 뒤 그 틱 기준으로 확인 (명세서 3.8 분기 확인창)
  const branch = () => {
    const controller = c();
    if (!controller) return;
    controller.stopPlayback();
    const s = controller.status();
    if (!s.canBranch) return;
    if (ask(t(lang, 'confirm.branch', branchConfirmParams(s.tick, s.headTick, MATCH_TICKS, DT)))) controller.branch();
  };

  // NEW: 진행 중이면 먼저 일시정지하고 확인, 취소하면 일시정지 상태로 남음 (09-7 확정)
  const newMatch = () => {
    const controller = c();
    if (!controller) return;
    controller.pause();
    controller.stopPlayback();
    if (ask(t(lang, 'confirm.newMatch'))) controller.reset();
  };

  const actions: ScrubberActions = {
    start: () => c()?.start(),
    pause: () => c()?.pause(),
    resume: () => c()?.resume(),
    branch,
    stepView: delta => c()?.stepView(delta),
    togglePlayback: () => c()?.togglePlayback(),
    setSpeed: speed => c()?.setPlaybackSpeed(speed),
    toggleView: () => c()?.setMatchView(status?.matchView === 'AUDIENCE' ? 'DRIVER' : 'AUDIENCE'),
    newMatch,
    openResult: () => c()?.openResult(),
  };

  return (
    <div className="main-screen" lang={lang} style={LAYOUT_STYLE}>
      {status && <LeftPanel status={status} lang={lang} />}
      {/* 종료 강조 5초 중 필드를 누르면 건너뛰기 */}
      <div className="field-area" ref={areaRef} onClick={() => c()?.skipHighlight()}>
        <canvas ref={canvasRef} className="field-canvas" />
      </div>
      {status && <ConfigRail status={status} lang={lang} />}
      {status && <ScrubberBar status={status} lang={lang} actions={actions} />}
      {status?.endStage === 'RESULT' && status.result && (
        <ResultPopup result={status.result} alliance={status.alliance} lang={lang} onReview={() => c()?.closeResult()} onRestart={newMatch} />
      )}
    </div>
  );
}
