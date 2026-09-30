// 접힌 config 아이콘 띠 (명세서 3.8 우측 config 창, 09-8a): 로봇 / 시나리오 준비 신호(초록 체크 / 빨간 느낌표),
// 게임패드 연결 수, 펼치기. 아이콘을 누르면 그 탭으로 펼침 (펼칠 수 있을 때만).
// 09-10a: 로봇 아이콘 = 탭이 올바르고 명중 확률표 READY면 초록 체크, 생성 중이면 진행률 링(마우스 올리면 "63% · 약 7초 남음"), 실패면 빨간 느낌표.
import { Bot, CircleAlert, CircleCheck, CircleHelp, Flag, Gamepad2, PanelRightOpen, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppStatus } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import type { ConfigTab, DraftTab, TabStatus } from '../ui/configDraft';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { gamepadSummary, robotLabel } from '../ui/mainScreenModel';
import { lutStateText } from '../ui/lutView';
import type { RobotLutView } from '../ui/lutView';
import type { RobotId } from '../input/inputConfig';

function Mark({ status }: { status: TabStatus }) {
  return status === 'OK' ? <CircleCheck className="rail-mark is-ok" /> : <CircleAlert className="rail-mark is-error" />;
}

// 진행률 링 (lucide 아이콘과 같은 24 단위 뷰박스)
const RING_R = 9;
const RING_LEN = 2 * Math.PI * RING_R;
function ProgressRing({ progress }: { progress: number }) {
  return (
    <svg className="rail-mark is-progress" viewBox="0 0 24 24" aria-hidden>
      <circle className="ring-track" cx="12" cy="12" r={RING_R} />
      <circle className="ring-fill" cx="12" cy="12" r={RING_R} strokeDasharray={`${RING_LEN * Math.max(0.04, progress)} ${RING_LEN}`} transform="rotate(-90 12 12)" />
    </svg>
  );
}

export default function ConfigRail({
  status,
  lang,
  statuses,
  luts,
  canOpen,
  onOpen,
  onHelp,
}: {
  status: AppStatus;
  lang: Language;
  statuses: Readonly<Record<DraftTab, TabStatus>>;
  luts: Readonly<Record<RobotId, RobotLutView>>;
  canOpen: boolean;
  onOpen: (tab?: ConfigTab) => void;
  onHelp: () => void; // 도움말 창 (v1.0.0, 언제나)
}) {
  const pads = gamepadSummary(status.gamepads);
  const padTitle = [
    t(lang, 'rail.gamepads', { count: pads.connected }),
    ...status.gamepads.map(g =>
      t(lang, 'rail.gamepadSlot', {
        slot: g.slot,
        robot: robotLabel(g.robot),
        name: !g.connected ? t(lang, 'rail.gamepadEmpty') : g.standard ? (g.id ?? '') : t(lang, 'rail.gamepadNonStandard', { name: g.id ?? '' }),
      }),
    ),
  ].join('\n');

  const titleFor = (tab: DraftTab, name: string, ready: string) => (statuses[tab] === 'OK' ? ready : `${name}: ${t(lang, `config.status.${statuses[tab]}`)}`);

  // 아이콘 = 그 탭으로 펼치는 버튼 (펼칠 수 없으면 표시만)
  const item = (tab: ConfigTab, title: string, icon: ReactNode, label: ReactNode) => (
    <button type="button" className="rail-item" key={tab} title={title} disabled={!canOpen} onClick={() => onOpen(tab)}>
      <span className="rail-icon">{icon}</span>
      <span className="rail-label">{label}</span>
    </button>
  );

  return (
    <nav className="config-rail">
      {(['robot1', 'robot2'] as const).map(id => {
        const lut = luts[id];
        // 탭 문제가 먼저, 탭이 올바르면 명중 확률표 상태
        const tabOk = statuses[id] === 'OK';
        const title = !tabOk
          ? titleFor(id, robotLabel(id), '')
          : lut.phase === 'READY'
            ? t(lang, 'rail.robotReady', { robot: robotLabel(id) })
            : `${robotLabel(id)}: ${lutStateText(lut, lang)}`;
        const mark = !tabOk ? <Mark status={statuses[id]} /> : lut.phase === 'READY' ? <Mark status="OK" /> : lut.phase === 'WORKING' ? <ProgressRing progress={lut.progress} /> : <Mark status="INVALID" />;
        return item(
          id,
          title,
          <>
            <Bot />
            {mark}
          </>,
          robotLabel(id),
        );
      })}
      {item(
        'scenario',
        titleFor('scenario', t(lang, 'config.tab.scenario'), t(lang, 'rail.scenarioReady', { color: status.alliance })),
        <>
          <Flag style={{ color: ALLIANCE_COLORS[status.alliance].base }} fill="currentColor" />
          <Mark status={statuses.scenario} />
        </>,
        t(lang, 'config.tab.scenario'),
      )}
      {item(
        'settings',
        padTitle,
        <>
          <Gamepad2 />
          {pads.nonStandard && <TriangleAlert className="rail-mark is-warn" />}
        </>,
        pads.connected,
      )}
      <div className="rail-spacer" />
      <button type="button" className="icon-button rail-help" title={t(lang, 'help.open')} aria-label={t(lang, 'help.open')} onClick={onHelp}>
        <CircleHelp />
      </button>
      <button type="button" className="icon-button rail-expand" disabled={!canOpen} title={t(lang, 'config.open')} aria-label={t(lang, 'config.open')} onClick={() => onOpen()}>
        <PanelRightOpen />
      </button>
    </nav>
  );
}
