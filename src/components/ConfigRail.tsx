// 접힌 config 아이콘 띠 (명세서 3.8 우측 config 창, 09-6d: 표시만). 준비 상태 / LUT 진행률 링 / 펼치기는 09-8 ~ 09-10.
// 09-6d의 고정 기본 설정은 간이 판정 함수라 LUT가 없고 항상 적용된 상태이므로 로봇 / 시나리오는 준비 완료로 표시한다.
import { Bot, CircleCheck, Flag, Gamepad2, PanelRightOpen, TriangleAlert } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { ALLIANCE_COLORS } from '../renderer/canvasRenderer';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { gamepadSummary, robotLabel } from '../ui/mainScreenModel';

export default function ConfigRail({ status, lang }: { status: AppStatus; lang: Language }) {
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

  return (
    <nav className="config-rail">
      {(['robot1', 'robot2'] as const).map(id => (
        <div className="rail-item" key={id} title={t(lang, 'rail.robotReady', { robot: robotLabel(id) })}>
          <span className="rail-icon">
            <Bot />
            <CircleCheck className="rail-mark is-ok" />
          </span>
          <span className="rail-label">{robotLabel(id)}</span>
        </div>
      ))}
      <div className="rail-item" title={t(lang, 'rail.scenarioReady', { color: status.alliance })}>
        <span className="rail-icon">
          <Flag style={{ color: ALLIANCE_COLORS[status.alliance].base }} fill="currentColor" />
          <CircleCheck className="rail-mark is-ok" />
        </span>
        <span className="rail-label">{t(lang, 'config.tab.scenario')}</span>
      </div>
      <div className="rail-item" title={padTitle}>
        <span className="rail-icon">
          <Gamepad2 />
          {pads.nonStandard && <TriangleAlert className="rail-mark is-warn" />}
        </span>
        <span className="rail-label">{pads.connected}</span>
      </div>
      <div className="rail-spacer" />
      <button type="button" className="icon-button rail-expand" disabled title={t(lang, 'config.open')} aria-label={t(lang, 'config.open')}>
        <PanelRightOpen />
      </button>
    </nav>
  );
}
