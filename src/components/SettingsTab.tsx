// SETTINGS 탭 (명세서 3.8 SETTINGS 탭, 09-8b): 게임패드(읽기 전용) / 입력(출처 · 조작 모드 · 키보드 + 키보드 조작표) /
// 표시 옵션 / 화면(언어 · 단위 · 기본 보기) / 초기화(RESET ALL, 경기 전만). 바꾸는 즉시 적용 (APPLY 없음).
// 입력 출처 / 조작 모드 / 키보드는 다음 START / RESUME / BRANCH부터 경기에 적용된다 (컨트롤러가 보관).
import { TriangleAlert } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { MATCH_SOURCE_CHOICES, SETUP_SOURCE_CHOICES } from '../app/inputPlan';
import type { SourceChoice } from '../app/inputPlan';
import { KEYBOARD_BINDINGS } from '../input/inputConfig';
import type { DriveMode, RobotId } from '../input/inputConfig';
import type { RenderOptions } from '../renderer/renderOptions';
import type { ViewMode } from '../renderer/viewTransform';
import { LANGUAGES, t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { LENGTH_UNITS } from '../ui/units';
import type { LengthUnit } from '../ui/units';
import { robotLabel } from '../ui/mainScreenModel';
import { keyCodeLabel } from '../ui/settings';
import { Section, Segmented, Toggle } from './FormControls';
import type { UiSettings } from '../ui/settings';

const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const OPTION_KEYS: readonly (keyof RenderOptions)[] = ['aimGuide', 'intakeProgress', 'hitProbability', 'flightTrail', 'flightResult'];
const DRIVE_MODES: readonly DriveMode[] = ['FIELD', 'ROBOT'];
const VIEWS: readonly ViewMode[] = ['DRIVER', 'AUDIENCE'];

export default function SettingsTab({
  status,
  lang,
  settings,
  onSettings,
  onSourceChoice,
  onResetAll,
}: {
  status: AppStatus;
  lang: Language;
  settings: UiSettings;
  onSettings: (patch: Partial<UiSettings>) => void;
  onSourceChoice: (robot: RobotId, choice: SourceChoice) => void;
  onResetAll: () => void;
}) {
  const { input } = status;
  const inMatch = status.phase !== 'SETUP';
  const sourceOptions: readonly SourceChoice[] = inMatch ? MATCH_SOURCE_CHOICES : SETUP_SOURCE_CHOICES;
  const pendingInput =
    inMatch &&
    (ROBOTS.some(r => input.choices[r] !== input.sources[r] || input.modes[r] !== input.activeModes[r]) || input.keyboardEnabled !== input.activeKeyboard);
  const keyRows: [string, MessageKey][] = [
    [[KEYBOARD_BINDINGS.forward, KEYBOARD_BINDINGS.left, KEYBOARD_BINDINGS.backward, KEYBOARD_BINDINGS.right].map(keyCodeLabel).join(' '), 'settings.keys.move'],
    [[KEYBOARD_BINDINGS.turnLeft, KEYBOARD_BINDINGS.turnRight].map(keyCodeLabel).join(' '), 'settings.keys.turn'],
    [keyCodeLabel(KEYBOARD_BINDINGS.intake), 'settings.keys.intake'],
    [keyCodeLabel(KEYBOARD_BINDINGS.shoot), 'settings.keys.shoot'],
    [keyCodeLabel(KEYBOARD_BINDINGS.lift), 'settings.keys.lift'],
    [keyCodeLabel(KEYBOARD_BINDINGS.drop), 'settings.keys.drop'],
    ['Space', 'settings.keys.pause'],
    ['← →', 'settings.keys.stepTick'],
    ['Shift + ← →', 'settings.keys.stepSecond'],
    ['Enter / Esc', 'settings.keys.dialog'],
  ];

  return (
    <div className="settings-tab">
      <Section title={t(lang, 'settings.section.gamepads')}>
        <ul className="gamepad-list">
          {status.gamepads.map(g => (
            <li key={g.slot} className={`gamepad-row${g.connected ? ' is-connected' : ''}`}>
              <span className="gamepad-slot">{t(lang, 'settings.gamepad.slot', { slot: g.slot, robot: robotLabel(g.robot) })}</span>
              <span className="gamepad-name">{g.connected ? g.id : t(lang, 'settings.gamepad.empty')}</span>
              {g.connected && !g.standard && (
                <span className="gamepad-warn">
                  <TriangleAlert />
                  {t(lang, 'settings.gamepad.nonStandard')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t(lang, 'settings.section.input')}>
        <div className="input-grid">
          <span />
          <span className="input-head">{t(lang, 'settings.input.source')}</span>
          <span className="input-head">{t(lang, 'settings.input.mode')}</span>
          {ROBOTS.map(robot => (
            <div className="input-row" key={robot}>
              <span className="input-robot">{robotLabel(robot)}</span>
              <div className="input-cell">
                <Segmented
                  ariaLabel={`${robotLabel(robot)} ${t(lang, 'settings.input.source')}`}
                  value={input.choices[robot]}
                  options={sourceOptions}
                  label={v => t(lang, `settings.source.${v}`)}
                  disabled={v => v === 'REPLAY' && !input.hasLog[robot]}
                  onChange={v => onSourceChoice(robot, v)}
                />
                {!inMatch && input.choices[robot] === 'AUTO' && (
                  <span className="input-preview">{t(lang, 'settings.source.autoPreview', { source: t(lang, `settings.source.${input.autoPreview[robot]}`) })}</span>
                )}
              </div>
              <Segmented
                ariaLabel={`${robotLabel(robot)} ${t(lang, 'settings.input.mode')}`}
                value={settings.driveModes[robot]}
                options={DRIVE_MODES}
                label={v => t(lang, `settings.mode.${v}`)}
                onChange={v => onSettings({ driveModes: { ...settings.driveModes, [robot]: v } })}
              />
            </div>
          ))}
        </div>
        <Toggle
          checked={settings.keyboardEnabled}
          onChange={v => onSettings({ keyboardEnabled: v })}
          label={t(lang, 'settings.input.keyboard')}
          hint={t(lang, 'settings.input.keyboardHint')}
        />
        <p className="settings-note">
          {t(lang, 'settings.input.applyNote')}
          {pendingInput && <span className="settings-pending">{t(lang, 'settings.input.pending')}</span>}
        </p>
        {inMatch && <p className="settings-note">{t(lang, 'settings.input.replayHint')}</p>}
        <details className="key-table">
          <summary>{t(lang, 'settings.keys.title')}</summary>
          <table>
            <tbody>
              {keyRows.map(([keys, label]) => (
                <tr key={label}>
                  <td>
                    <kbd>{keys}</kbd>
                  </td>
                  <td>{t(lang, label)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Section>

      <Section title={t(lang, 'settings.section.display')}>
        {OPTION_KEYS.map(key => (
          <Toggle
            key={key}
            checked={settings.renderOptions[key]}
            onChange={v => onSettings({ renderOptions: { ...settings.renderOptions, [key]: v } })}
            label={t(lang, `option.${key}`)}
            hint={t(lang, `option.${key}.desc`)}
          />
        ))}
      </Section>

      <Section title={t(lang, 'settings.section.screen')}>
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'settings.language')}</span>
          <Segmented<Language> ariaLabel={t(lang, 'settings.language')} value={settings.language} options={LANGUAGES} label={v => t(lang, `language.${v}`)} onChange={v => onSettings({ language: v })} />
        </div>
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'settings.unit')}</span>
          <Segmented<LengthUnit> ariaLabel={t(lang, 'settings.unit')} value={settings.lengthUnit} options={LENGTH_UNITS} label={v => v} onChange={v => onSettings({ lengthUnit: v })} />
        </div>
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'settings.defaultView')}</span>
          <Segmented<ViewMode>
            ariaLabel={t(lang, 'settings.defaultView')}
            value={settings.defaultView}
            options={VIEWS}
            label={v => t(lang, v === 'DRIVER' ? 'view.driver' : 'view.audience')}
            onChange={v => onSettings({ defaultView: v })}
          />
        </div>
        <p className="settings-note">{t(lang, 'settings.defaultViewHint')}</p>
      </Section>

      <Section title={t(lang, 'settings.section.reset')}>
        <div className="settings-row">
          <span className="settings-note">{t(lang, 'settings.resetAllHint')}</span>
          <button type="button" className="config-button" disabled={inMatch} onClick={onResetAll}>
            {t(lang, 'config.resetAll')}
          </button>
        </div>
      </Section>
    </div>
  );
}
