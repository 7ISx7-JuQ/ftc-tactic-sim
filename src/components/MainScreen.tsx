// 메인 화면 (명세서 3.8 화면 구성, 09-6d 화면 뼈대): 좌측 득점 패널 / 필드 / 접힌 config 아이콘 띠 / 스크러버 줄.
// 시뮬레이션 / 그리기는 AppController(React 밖)가 소유하고, React는 약 10 Hz 상태 알림으로 패널 / 버튼만 그린다.
// 09-7b: 확인창 모달 / 경고 토스트 / 자동 일시정지 배너 / 타임라인 끌기. 09-7c: 경기 종료 연출(흰빛 / 배너 · 진행바). 09-8a: config 창 틀(펼치기 / 탭 / 초안 · 적용 / START 막기).
// 09-8b: SETTINGS 탭(즉시 적용) + localStorage 자동 보관, 언어는 SETTINGS 값.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AppController } from '../app/appController';
import type { AppStatus, LiftToast } from '../app/appController';
import { DEFAULT_DRAFT_VALUES, buildMatchSetup } from '../app/defaultSetup';
import { DT, MATCH_TICKS } from '../core/simulationEngine';
import { t } from '../ui/i18n';
import { DEFAULT_SETTINGS, browserSettingsStorage, loadStoredConfig, saveStoredConfig } from '../ui/settings';
import type { UiSettings } from '../ui/settings';
import { branchConfirmParams, fieldCanvasSize, layoutCssVars, robotLabel } from '../ui/mainScreenModel';
import {
  DRAFT_TABS,
  TAB_LABEL_KEYS,
  applyTab,
  canCopyRobotTab,
  copyRobotTab,
  editDraft,
  setFieldText,
  canApply,
  canResetTab,
  configCanOpen,
  draftTabsLocked,
  firstBlockingTab,
  initialDrafts,
  resetTabDraft,
  tabStatus,
} from '../ui/configDraft';
import type { ConfigDrafts, ConfigTab, DraftTab, DraftValues, TabStatus } from '../ui/configDraft';
import ConfigPanel from './ConfigPanel';
import ConfigRail from './ConfigRail';
import ConfirmDialog from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import EndOverlay from './EndOverlay';
import FieldNotices from './FieldNotices';
import type { ToastItem } from './FieldNotices';
import LeftPanel from './LeftPanel';
import ResultPopup from './ResultPopup';
import ScrubberBar from './ScrubberBar';
import SettingsTab from './SettingsTab';
import RobotTab from './RobotTab';
import type { RobotFieldKey, RobotProfile } from '../ui/robotForm';
import type { ScrubberActions } from './ScrubberBar';
import './MainScreen.css';

const LAYOUT_STYLE = layoutCssVars(false) as CSSProperties;
const LAYOUT_STYLE_OPEN = layoutCssVars(true) as CSSProperties;
const setupOf = (v: DraftValues) => buildMatchSetup(v.robot1.config, v.robot2.config, v.scenario);
const TOAST_VISIBLE_MS = 1500; // 경고 토스트 표시 시간 (그 뒤 흐려지며 사라짐)
const TOAST_FADE_MS = 300;
// 설정 자동 보관 (09-8b): 앱 시작 시 한 번 읽음 (SETTINGS + 마지막으로 적용한 로봇 / 시나리오)
const settingsStorage = browserSettingsStorage();

export default function MainScreen() {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AppController | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [stored] = useState(() => loadStoredConfig(settingsStorage, DEFAULT_DRAFT_VALUES));
  const [settings, setSettings] = useState<UiSettings>(stored.settings);
  const lang = settings.language;
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<{ request: ConfirmRequest; anchor: { x: number; y: number } | null; resolve: (ok: boolean) => void } | null>(null);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Set<number>());
  // config 창: 초안 / 적용 값 (적용 값이 경기 설정이 됨), 펼침 / 탭 / 안내
  const [drafts, setDrafts] = useState<ConfigDrafts>(() => initialDrafts(stored.applied ?? DEFAULT_DRAFT_VALUES));
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>('robot1');
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const initialApplied = useRef(drafts.applied);
  const initialSettings = useRef(settings);

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

    // 경고 토스트: 약 1.5초 보인 뒤 흐려지며 사라짐 (같은 로봇 2초 간격은 컨트롤러가 보장)
    const timers = toastTimers.current;
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const onToast = ({ robot }: LiftToast) => {
      const id = ++toastSeq.current;
      setToasts(list => [...list.filter(x => x.robot !== robot), { id, robot, leaving: false }]);
      later(TOAST_VISIBLE_MS, () => setToasts(list => list.map(x => (x.id === id ? { ...x, leaving: true } : x))));
      later(TOAST_VISIBLE_MS + TOAST_FADE_MS, () => setToasts(list => list.filter(x => x.id !== id)));
    };

    // 상태 알림: 펼칠 수 없는 상태(진행 / 재생 / 회전 / 종료 강조 · 결과)가 되면 config 창을 자동으로 접음
    const onStatus = (s: AppStatus) => {
      setStatus(s);
      if (!configCanOpen(s)) setConfigOpen(false);
    };
    const s0 = initialSettings.current;
    const controller = new AppController({
      ctx,
      dpr: measure().scale,
      setup: setupOf(initialApplied.current),
      onStatus,
      onToast,
      input: { keyboardEnabled: s0.keyboardEnabled, driveModes: s0.driveModes },
      defaultView: s0.defaultView,
      options: s0.renderOptions,
    });
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
      timers.forEach(id => window.clearTimeout(id));
      timers.clear();
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const c = () => controllerRef.current;

  // ---------------- config 창 ----------------
  const statuses = Object.fromEntries(DRAFT_TABS.map(tab => [tab, tabStatus(drafts, tab)])) as Record<DraftTab, TabStatus>;
  const canOpen = status ? configCanOpen(status) : false;
  const locked = status ? draftTabsLocked(status.phase) : false;
  const openConfig = (tab?: ConfigTab) => {
    if (!canOpen) return;
    if (tab) setConfigTab(tab);
    setConfigNotice(null);
    setConfigOpen(true);
  };
  const closeConfig = () => {
    setConfigOpen(false);
    setConfigNotice(null);
  };
  // APPLY: 경기 전에만 (경기가 있는 동안 잠금). 적용 값이 바뀌면 새 0틱 경기 설정
  const applyCurrentTab = () => {
    if (configTab === 'settings' || locked) return;
    const next = applyTab(drafts, configTab);
    if (next === drafts) return;
    setDrafts(next);
    c()?.setSetup(setupOf(next.applied));
    saveStoredConfig(settingsStorage, { settings, applied: next.applied });
  };
  const resetCurrentTab = () => {
    if (configTab === 'settings' || locked) return;
    setDrafts(resetTabDraft(drafts, configTab, DEFAULT_DRAFT_VALUES));
  };
  // ---------------- 로봇 탭 (09-9a): 초안 편집 / 틀린 입력 글자 / COPY TO ----------------
  const editRobot = (tab: 'robot1' | 'robot2') => (profile: RobotProfile | null, key: RobotFieldKey | null, invalidText: string | null) => {
    if (locked) return;
    setConfigNotice(null); // 고치기 시작하면 START 막힘 / 복사 안내는 지움
    setDrafts(d => {
      let next = profile ? editDraft(d, tab, profile) : d;
      if (key) next = setFieldText(next, tab, key, invalidText);
      return next;
    });
  };
  const copyRobot = (from: 'robot1' | 'robot2') => {
    const to = from === 'robot1' ? 'robot2' : 'robot1';
    if (locked || !canCopyRobotTab(drafts, from)) return;
    const doCopy = () => {
      setDrafts(d => copyRobotTab(d, from));
      setConfigNotice(t(lang, 'robot.copied', { robot: robotLabel(to) }));
    };
    // 상대 탭에 적용 안 된 수정 / 틀린 글자가 있으면 덮어쓰기 전에 확인
    if (tabStatus(drafts, to) === 'OK') doCopy();
    else
      void ask(t(lang, 'confirm.copyOverwrite', { target: robotLabel(to), source: robotLabel(from) }), t(lang, 'robot.copyTo', { robot: robotLabel(to) })).then(ok => {
        if (ok) doCopy();
      });
  };

  // ---------------- SETTINGS (즉시 적용 + 자동 보관) ----------------
  const pushSettings = (next: UiSettings, prev: UiSettings | null) => {
    const controller = c();
    if (!controller) return;
    if (!prev || next.renderOptions !== prev.renderOptions) controller.setOptions(next.renderOptions);
    if (!prev || next.defaultView !== prev.defaultView) controller.setDefaultView(next.defaultView);
    if (!prev || next.keyboardEnabled !== prev.keyboardEnabled) controller.setKeyboardEnabled(next.keyboardEnabled);
    if (!prev || next.driveModes !== prev.driveModes) {
      controller.setDriveMode('robot1', next.driveModes.robot1);
      controller.setDriveMode('robot2', next.driveModes.robot2);
    }
  };
  const updateSettings = (patch: Partial<UiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    pushSettings(next, settings);
    saveStoredConfig(settingsStorage, { settings: next, applied: drafts.applied });
  };
  // RESET ALL (경기 전만, 확인창): SETTINGS 즉시 기본값, R1 / R2 / SCENARIO는 초안만 기본값 (각 탭 APPLY 필요)
  const resetAll = () => {
    if (status?.phase !== 'SETUP') return;
    void ask(t(lang, 'confirm.resetAll'), t(lang, 'config.resetAll')).then(ok => {
      if (!ok) return;
      const next = { ...DEFAULT_SETTINGS, renderOptions: { ...DEFAULT_SETTINGS.renderOptions }, driveModes: { ...DEFAULT_SETTINGS.driveModes } };
      setSettings(next);
      pushSettings(next, null);
      let d = drafts;
      for (const tab of DRAFT_TABS) d = resetTabDraft(d, tab, DEFAULT_DRAFT_VALUES);
      setDrafts(d);
      saveStoredConfig(settingsStorage, { settings: next, applied: d.applied });
    });
  };
  // 화면 언어 (문서 lang 속성도 맞춤)
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // 펼친 동안 Esc = 닫기 (확인창이 떠 있으면 확인창이 먼저 받음)
  useEffect(() => {
    if (!configOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setConfigOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [configOpen]);

  // START: 적용 안 된 수정 / 검증 실패가 있으면 시작하지 않고 첫 문제 탭(R1 → R2 → SCENARIO)으로 펼침
  const start = () => {
    const blocking = firstBlockingTab(drafts);
    if (blocking) {
      setConfigTab(blocking);
      setConfigOpen(true);
      setConfigNotice(t(lang, 'config.startBlocked', { reason: `${t(lang, TAB_LABEL_KEYS[blocking])} — ${t(lang, `config.status.${tabStatus(drafts, blocking) as Exclude<TabStatus, 'OK'>}`)}` }));
      return;
    }
    closeConfig();
    c()?.start();
  };

  // 확인창 (09-7b): 필드 영역 중앙의 모달. 떠 있는 동안 컨트롤러 단축키를 끔
  const ask = (message: string, okLabel: string): Promise<boolean> =>
    new Promise(resolve => {
      const rect = areaRef.current?.getBoundingClientRect();
      c()?.setShortcutsEnabled(false);
      setConfirm({
        request: { message, okLabel, cancelLabel: t(lang, 'confirm.cancel') },
        anchor: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
        resolve,
      });
    });
  const closeConfirm = (ok: boolean) => {
    const current = confirm;
    setConfirm(null);
    c()?.setShortcutsEnabled(true);
    current?.resolve(ok);
  };

  // 분기: 재생 중이면 멈춘 뒤 그 틱 기준으로 확인 (명세서 3.8 분기 확인창)
  const branch = () => {
    const controller = c();
    if (!controller) return;
    controller.stopPlayback();
    const s = controller.status();
    if (!s.canBranch) return;
    void ask(t(lang, 'confirm.branch', branchConfirmParams(s.tick, s.headTick, MATCH_TICKS, DT)), t(lang, 'control.branch')).then(ok => {
      if (ok) controller.branch();
    });
  };

  // NEW: 진행 중이면 먼저 일시정지하고 확인, 취소하면 일시정지 상태로 남음 (09-7 확정)
  const newMatch = () => {
    const controller = c();
    if (!controller) return;
    controller.pause();
    controller.stopPlayback();
    void ask(t(lang, 'confirm.newMatch'), t(lang, 'control.newMatch')).then(ok => {
      if (ok) controller.reset();
    });
  };

  const actions: ScrubberActions = {
    start,
    pause: () => c()?.pause(),
    resume: () => c()?.resume(),
    branch,
    stepView: delta => c()?.stepView(delta),
    setViewTick: tick => c()?.setViewTick(tick),
    togglePlayback: () => c()?.togglePlayback(),
    setSpeed: speed => c()?.setPlaybackSpeed(speed),
    toggleView: () => c()?.setMatchView(status?.matchView === 'AUDIENCE' ? 'DRIVER' : 'AUDIENCE'),
    newMatch,
    openResult: () => c()?.openResult(),
  };

  return (
    <div className={`main-screen${configOpen ? ' is-config-open' : ''}`} lang={lang} style={configOpen ? LAYOUT_STYLE_OPEN : LAYOUT_STYLE}>
      {status && <LeftPanel status={status} lang={lang} teams={{ robot1: drafts.applied.robot1, robot2: drafts.applied.robot2 }} />}
      {/* 종료 강조 5초 중 필드를 누르면 건너뛰기 */}
      <div className="field-area" ref={areaRef} onClick={() => c()?.skipHighlight()}>
        <canvas ref={canvasRef} className="field-canvas" />
        <FieldNotices autoPauseReason={status?.autoPauseReason ?? null} toasts={toasts} lang={lang} />
        {status?.endStage === 'HIGHLIGHT' && <EndOverlay key={status.endSeq} lang={lang} />}
      </div>
      {status &&
        (configOpen ? (
          <ConfigPanel
            lang={lang}
            tab={configTab}
            statuses={statuses}
            locked={locked}
            notice={configNotice}
            canApply={configTab !== 'settings' && canApply(drafts, configTab)}
            canReset={configTab !== 'settings' && canResetTab(drafts, configTab, DEFAULT_DRAFT_VALUES)}
            onTab={tab => {
              setConfigTab(tab);
              setConfigNotice(null);
            }}
            onClose={closeConfig}
            onApply={applyCurrentTab}
            onResetTab={resetCurrentTab}
            content={
              configTab === 'settings' ? (
                <SettingsTab
                  status={status}
                  lang={lang}
                  settings={settings}
                  onSettings={updateSettings}
                  onSourceChoice={(robot, choice) => c()?.setSourceChoice(robot, choice)}
                  onResetAll={resetAll}
                />
              ) : configTab === 'robot1' || configTab === 'robot2' ? (
                <RobotTab
                  key={configTab}
                  robotId={configTab}
                  profile={drafts.draft[configTab]}
                  fieldText={drafts.fieldText[configTab]}
                  unit={settings.lengthUnit}
                  lang={lang}
                  locked={locked}
                  canCopy={canCopyRobotTab(drafts, configTab)}
                  onEdit={editRobot(configTab)}
                  onCopy={() => copyRobot(configTab)}
                />
              ) : null
            }
          />
        ) : (
          <ConfigRail status={status} lang={lang} statuses={statuses} canOpen={canOpen} onOpen={openConfig} />
        ))}
      {status && <ScrubberBar status={status} lang={lang} actions={actions} />}
      {status?.endStage === 'RESULT' && status.result && (
        <ResultPopup result={status.result} alliance={status.alliance} lang={lang} onReview={() => c()?.closeResult()} onRestart={newMatch} />
      )}
      {confirm && <ConfirmDialog request={confirm.request} anchor={confirm.anchor} onClose={closeConfirm} />}
    </div>
  );
}
