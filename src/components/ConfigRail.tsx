// 접힌 config 아이콘 띠 (명세서 3.8 우측 config 창, 09-8a): 로봇 / 시나리오 준비 신호(초록 체크 / 빨간 느낌표),
// 게임패드 연결 수, 펼치기. 아이콘을 누르면 그 탭으로 펼침 (펼칠 수 있을 때만). LUT 진행률 링은 09-10.
import { Bot, CircleAlert, CircleCheck, Flag, Gamepad2, PanelRightOpen, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppStatus } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import type { ConfigTab, DraftTab, TabStatus } from '../ui/configDraft';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { gamepadSummary, robotLabel } from '../ui/mainScreenModel';

function Mark({ status }: { status: TabStatus }) {
  return status === 'OK' ? <CircleCheck className="rail-mark is-ok" /> : <CircleAlert className="rail-mark is-error" />;
}

export default function ConfigRail({
  status,
  lang,
  statuses,
  canOpen,
  onOpen,
}: {
  status: AppStatus;
  lang: Language;
  statuses: Readonly<Record<DraftTab, TabStatus>>;
  canOpen: boolean;
  onOpen: (tab?: ConfigTab) => void;
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
      {(['robot1', 'robot2'] as const).map(id =>
        item(
          id,
          titleFor(id, robotLabel(id), t(lang, 'rail.robotReady', { robot: robotLabel(id) })),
          <>
            <Bot />
            <Mark status={statuses[id]} />
          </>,
          robotLabel(id),
        ),
      )}
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
      <button type="button" className="icon-button rail-expand" disabled={!canOpen} title={t(lang, 'config.open')} aria-label={t(lang, 'config.open')} onClick={() => onOpen()}>
        <PanelRightOpen />
      </button>
    </nav>
  );
}
