// SETTINGS 탭 (명세서 3.8 SETTINGS 탭, 09-8b): 장치(게임패드 슬롯 / 키보드 → R1 / R2 / 없음, R1 ↔ R2 바꾸기 — 18-2,
// 슬롯별 버튼 매핑 / 스틱 좌우 바꾸기 — 18-3) /
// 입력(출처 · 조작 모드 + 키보드 조작표) /
// 표시 옵션 / 화면(언어 · 단위 · 기본 보기 · 부드러운 움직임 17-1a) / 초기화(RESET ALL, 경기 전만). 바꾸는 즉시 적용 (APPLY 없음).
// 입력 출처 / 조작 모드 / 장치 배정은 다음 START / RESUME / BRANCH부터 경기에 적용된다 (컨트롤러가 보관, 배정은 경기 전이면 바로).
// 10-2: 프리셋(PRESETS) — 줄별 EXPORT(적용 값 → 파일, 언제나) / IMPORT(파일 → 초안, 경기 전만), 거부 사유는 그 줄 아래 빨간 글자.
// 10-4: MATCH 줄 — IMPORT(경기 파일, 경기 전만), 준비 중에는 진행 글자 + CANCEL. 내보내기는 결과 팝업에서.
// 19-2b: PRESETS 위에 저장된 전체 설정 목록 (library — 화면이 만들어 넘김).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Download, Gamepad2, TriangleAlert, Upload, X } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { MATCH_SOURCE_CHOICES, SETUP_SOURCE_CHOICES } from '../app/inputPlan';
import type { SourceChoice } from '../app/inputPlan';
import { GAMEPAD_SLOTS, KEYBOARD_BINDINGS, sameAssignment, sameMappings, swapAssignment } from '../input/inputConfig';
import type { DeviceAssignment, DriveMode, GamepadSlot, RobotId } from '../input/inputConfig';
import GamepadMappingEditor from './GamepadMappingEditor';
import { assignedDevices } from '../input/controls';
import type { RenderOptions } from '../renderer/renderOptions';
import type { ViewMode } from '../renderer/viewTransform';
import { LANGUAGES, t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { LENGTH_UNITS } from '../ui/units';
import type { LengthUnit } from '../ui/units';
import { robotLabel } from '../ui/mainScreenModel';
import { PRESET_ROWS } from '../ui/presetFile';
import type { PresetRow } from '../ui/presetFile';
import { TAB_LABEL_KEYS } from '../ui/configDraft';
import { keyCodeLabel } from '../ui/settings';
import { Section, Segmented, Toggle } from './FormControls';
import type { UiSettings } from '../ui/settings';

const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const OPTION_KEYS: readonly (keyof RenderOptions)[] = ['aimGuide', 'intakeProgress', 'hitProbability', 'flightTrail', 'flightResult', 'robotPath'];
const DRIVE_MODES: readonly DriveMode[] = ['FIELD', 'ROBOT'];
const VIEWS: readonly ViewMode[] = ['DRIVER', 'AUDIENCE'];
// 장치 배정 선택지 (18-2): R1 / R2 / 없음
type DeviceTarget = RobotId | 'NONE';
const DEVICE_TARGETS: readonly DeviceTarget[] = ['robot1', 'robot2', 'NONE'];
const toTarget = (r: RobotId | null): DeviceTarget => r ?? 'NONE';
const fromTarget = (v: DeviceTarget): RobotId | null => (v === 'NONE' ? null : v);
// 로봇 프리셋 줄 설명: 적용된 팀 번호 + 팀명 (없으면 빈칸)
const teamText = ({ teamNumber, teamName }: { teamNumber: string; teamName: string }) =>
  [teamNumber.trim() && `#${teamNumber.trim()}`, teamName.trim()].filter(Boolean).join(' ');

export default function SettingsTab({
  status,
  lang,
  settings,
  onSettings,
  onSourceChoice,
  onResetAll,
  teams,
  presetError,
  onPresetExport,
  onPresetImport,
  matchImport,
  onMatchImport,
  onMatchCancel,
  readGamepadButtons,
  library,
}: {
  status: AppStatus;
  lang: Language;
  settings: UiSettings;
  onSettings: (patch: Partial<UiSettings>) => void;
  onSourceChoice: (robot: RobotId, choice: SourceChoice) => void;
  onResetAll: () => void;
  teams: Record<RobotId, { teamNumber: string; teamName: string }>; // 적용 값 (로봇 줄 설명)
  presetError: { row: PresetRow; message: string } | null;
  onPresetExport: (row: PresetRow) => void;
  onPresetImport: (row: PresetRow) => void;
  // 경기 불러오기 줄 상태: 준비 중이면 진행 글자(오류면 빨강), 거부 사유는 error
  matchImport: { loading: { text: string; error: boolean } | null; error: string | null };
  onMatchImport: () => void;
  onMatchCancel: () => void;
  readGamepadButtons: (slot: number) => boolean[] | null; // 18-3 버튼 지정 (원시 버튼 눌림, 연결 안 됨 = null)
  library?: ReactNode;                                   // 저장된 전체 설정 목록 (19-2b, PRESETS 위)
}) {
  const { input } = status;
  const inMatch = status.phase !== 'SETUP';
  const sourceOptions: readonly SourceChoice[] = inMatch ? MATCH_SOURCE_CHOICES : SETUP_SOURCE_CHOICES;
  const pendingInput = inMatch && ROBOTS.some(r => input.choices[r] !== input.sources[r] || input.modes[r] !== input.activeModes[r]);
  const pendingDevices = inMatch && (!sameAssignment(input.assignment, input.activeAssignment) || !sameMappings(input.mappings, input.activeMappings));
  const [mappingSlot, setMappingSlot] = useState<GamepadSlot | null>(null); // 버튼 매핑을 펼친 슬롯 (18-3, 한 번에 하나)
  const devices = settings.devices;
  const setDevices = (next: DeviceAssignment) => onSettings({ devices: next });
  const targetLabel = (v: DeviceTarget) => (v === 'NONE' ? t(lang, 'settings.device.none') : robotLabel(v));
  const unassigned = ROBOTS.filter(r => {
    const d = assignedDevices(r, devices);
    return d.gamepadSlots.length === 0 && !d.keyboard;
  });
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
      <Section title={t(lang, 'settings.section.devices')}>
        <ul className="gamepad-list">
          {GAMEPAD_SLOTS.map(slot => {
            const g = status.gamepads.find(p => p.slot === slot);
            const name = t(lang, 'settings.device.gamepad', { slot });
            return (
              <li key={slot} className={`gamepad-row${g?.connected ? ' is-connected' : ''}`}>
                <span className="gamepad-slot">{name}</span>
                <span className="gamepad-name">{g?.connected ? g.id : t(lang, 'settings.gamepad.empty')}</span>
                <Segmented<DeviceTarget>
                  ariaLabel={name}
                  value={toTarget(devices.gamepads[slot])}
                  options={DEVICE_TARGETS}
                  label={targetLabel}
                  onChange={v => setDevices({ ...devices, gamepads: { ...devices.gamepads, [slot]: fromTarget(v) } })}
                />
                <button
                  type="button"
                  className={`config-button gamepad-mapping-toggle${mappingSlot === slot ? ' is-primary' : ''}`}
                  aria-expanded={mappingSlot === slot}
                  title={t(lang, 'settings.mapping.title', { slot })}
                  aria-label={t(lang, 'settings.mapping.title', { slot })}
                  onClick={() => setMappingSlot(mappingSlot === slot ? null : slot)}
                >
                  <Gamepad2 />
                </button>
                {g?.connected && !g.standard && (
                  <span className="gamepad-warn">
                    <TriangleAlert />
                    {t(lang, 'settings.gamepad.nonStandard')}
                  </span>
                )}
                {mappingSlot === slot && (
                  <GamepadMappingEditor
                    slot={slot}
                    mapping={settings.gamepadMappings[slot]}
                    connected={!!g?.connected}
                    standard={!!g?.standard}
                    lang={lang}
                    readButtons={readGamepadButtons}
                    onChange={next => onSettings({ gamepadMappings: { ...settings.gamepadMappings, [slot]: next } })}
                  />
                )}
              </li>
            );
          })}
          <li className="gamepad-row is-connected">
            <span className="gamepad-slot">{t(lang, 'settings.device.keyboard')}</span>
            <Segmented<DeviceTarget>
              ariaLabel={t(lang, 'settings.device.keyboard')}
              value={toTarget(devices.keyboard)}
              options={DEVICE_TARGETS}
              label={targetLabel}
              onChange={v => setDevices({ ...devices, keyboard: fromTarget(v) })}
            />
          </li>
        </ul>
        <div className="settings-row">
          <button type="button" className="config-button" onClick={() => setDevices(swapAssignment(devices))}>
            <ArrowLeftRight />
            {t(lang, 'settings.device.swap')}
          </button>
        </div>
        {unassigned.map(r => (
          <p key={r} className="form-warning" role="status">
            {t(lang, 'settings.device.unassigned', { robot: robotLabel(r) })}
          </p>
        ))}
        <p className="settings-note">{t(lang, 'settings.device.hint')}</p>
        <p className="settings-note">
          {t(lang, 'settings.input.applyNote')}
          {pendingDevices && <span className="settings-pending">{t(lang, 'settings.input.pending')}</span>}
        </p>
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
        <Toggle
          checked={settings.smoothMotion}
          onChange={v => onSettings({ smoothMotion: v })}
          label={t(lang, 'settings.smoothMotion')}
          hint={t(lang, 'settings.smoothMotion.desc')}
        />
      </Section>

      {library}
      <Section title={t(lang, 'settings.section.presets')}>
        <p className="settings-note">{t(lang, 'preset.hint')}</p>
        <ul className="preset-file-list">
          {PRESET_ROWS.map(row => (
            <li key={row} className="preset-file-row">
              <span className="preset-file-name">{t(lang, row === 'all' ? 'preset.row.all' : TAB_LABEL_KEYS[row])}</span>
              <span className="preset-file-desc">{row === 'all' ? t(lang, 'preset.row.allDesc') : row === 'scenario' ? '' : teamText(teams[row])}</span>
              <button type="button" className="config-button" onClick={() => onPresetExport(row)}>
                <Download />
                {t(lang, 'preset.export')}
              </button>
              <button type="button" className="config-button" disabled={inMatch} title={inMatch ? t(lang, 'preset.importLocked') : undefined} onClick={() => onPresetImport(row)}>
                <Upload />
                {t(lang, 'preset.import')}
              </button>
              {presetError?.row === row && (
                <span className="form-error preset-file-error" role="alert">
                  {presetError.message}
                </span>
              )}
            </li>
          ))}
          <li className="preset-file-row">
            <span className="preset-file-name">{t(lang, 'preset.row.match')}</span>
            {matchImport.loading ? (
              <>
                <span className={`preset-file-desc preset-file-loading${matchImport.loading.error ? ' is-error' : ''}`} role="status">
                  {matchImport.loading.text}
                </span>
                <button type="button" className="config-button" onClick={onMatchCancel}>
                  <X />
                  {t(lang, 'matchImport.cancel')}
                </button>
              </>
            ) : (
              <>
                <span className="preset-file-desc">{t(lang, 'preset.row.matchDesc')}</span>
                <button type="button" className="config-button" disabled={inMatch} title={inMatch ? t(lang, 'preset.importLocked') : undefined} onClick={onMatchImport}>
                  <Upload />
                  {t(lang, 'preset.import')}
                </button>
              </>
            )}
            {matchImport.error && (
              <span className="form-error preset-file-error" role="alert">
                {matchImport.error}
              </span>
            )}
          </li>
        </ul>
        {inMatch && <p className="settings-note">{t(lang, 'preset.importLocked')}</p>}
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
