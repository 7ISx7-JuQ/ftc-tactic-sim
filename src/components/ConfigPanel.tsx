// 펼친 config 창 (명세서 3.8 우측 config 창, 09-8a 틀): 탭 R1 / R2 / SCENARIO / SETTINGS + 닫기, 탭 하단 RESET TAB / APPLY.
// 탭 내용(폼)은 09-8b(SETTINGS) / 09-9(로봇) / 09-11(시나리오)에서 채운다. 경기가 있는 동안 R1 / R2 / SCENARIO는 읽기 전용.
import { CircleAlert, PanelRightClose, Lock } from 'lucide-react';
import type { DraftTab, ConfigTab, TabStatus } from '../ui/configDraft';
import { CONFIG_TABS, TAB_LABEL_KEYS } from '../ui/configDraft';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';

export interface ConfigPanelProps {
  lang: Language;
  tab: ConfigTab;
  statuses: Readonly<Record<DraftTab, TabStatus>>;
  locked: boolean;               // 경기가 있는 동안 R1 / R2 / SCENARIO 읽기 전용
  notice: string | null;         // START 막힘 안내 등
  canApply: boolean;
  canReset: boolean;
  onTab: (tab: ConfigTab) => void;
  onClose: () => void;
  onApply: () => void;
  onResetTab: () => void;
}

export default function ConfigPanel(props: ConfigPanelProps) {
  const { lang, tab, statuses, locked, notice } = props;
  const draftTab = tab !== 'settings';
  return (
    <aside className="config-panel" aria-label={t(lang, 'config.open')}>
      <header className="config-header">
        <div className="config-tabs" role="tablist">
          {CONFIG_TABS.map(id => {
            const status = id === 'settings' ? 'OK' : statuses[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === tab}
                className={`config-tab${id === tab ? ' is-selected' : ''}`}
                onClick={() => props.onTab(id)}
                title={status === 'OK' ? undefined : t(lang, `config.status.${status}`)}
              >
                {t(lang, TAB_LABEL_KEYS[id])}
                {status !== 'OK' && <span className="config-tab-dot" aria-label={t(lang, `config.status.${status}`)} />}
              </button>
            );
          })}
        </div>
        <button type="button" className="icon-button" title={t(lang, 'config.close')} aria-label={t(lang, 'config.close')} onClick={props.onClose}>
          <PanelRightClose />
        </button>
      </header>

      {notice && (
        <div className="config-notice" role="alert">
          <CircleAlert />
          <span>{notice}</span>
        </div>
      )}
      {draftTab && locked && (
        <div className="config-lock">
          <Lock />
          <span>{t(lang, 'config.lockedDuringMatch')}</span>
        </div>
      )}

      <div className="config-body" role="tabpanel">
        <p className="config-empty">{t(lang, 'config.emptyTab')}</p>
      </div>

      {draftTab && (
        <footer className="config-footer">
          {statuses[tab] === 'DIRTY' && <span className="config-dirty">{t(lang, 'config.unappliedChanges')}</span>}
          <button type="button" className="config-button" disabled={locked || !props.canReset} onClick={props.onResetTab}>
            {t(lang, 'config.resetTab')}
          </button>
          <button type="button" className="config-button is-primary" disabled={locked || !props.canApply} onClick={props.onApply}>
            {t(lang, 'config.apply')}
          </button>
        </footer>
      )}
    </aside>
  );
}
