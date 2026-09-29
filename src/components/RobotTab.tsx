// 로봇 제원 탭 R1 / R2 (명세서 3.8 로봇 제원 탭, 09-9a): 팀 / 하드웨어 / 인테이크 / 슈터 / FLOWER 리프트 + COPY TO.
// 값은 초안(config 창 초안 / 적용 규칙)에만 들어가고 APPLY로 확정한다. 경기가 있는 동안 모든 칸 읽기 전용.
// 09-9b: 맨 위 로봇 미리보기, 흡입 구역 편집기(구역별 면 / 위치 / 폭 / 깊이, 추가 · 삭제, 프리셋 FRONT / ANY),
// 슈터 탄도(발사구 지상고 / 발사각 / 오프셋 + 고급 설정의 편차 3종).
// 09-10a: 스윗스팟 X / Y(시나리오 진영 기준, 기준 CELL 표시) + 검증 사유 + 명중 확률표 상태(적용한 설정 기준). 필드에서 찍기 / 히트맵은 09-10b.
import { Copy, Plus, Trash2 } from 'lucide-react';
import { sweetSpotBasisCell } from '../core/ballistics';
import { createIntakeZonePreset } from '../core/collision';
import type { BumperSide } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import {
  BUMPER_SIDES,
  MAX_INTAKE_ZONES,
  NUMBER_FIELDS,
  SWEET_SPOT_AXES,
  SWEET_SPOT_SPEC,
  TURRET_PRESETS,
  ZONE_FIELDS,
  newIntakeZone,
  readNumber,
  readSweetSpot,
  robotProfileIssues,
  sweetSpotFieldKey,
  writeNumber,
  writeSweetSpot,
  writeZone,
  zoneFieldKey,
  zoneFieldSpec,
} from '../ui/robotForm';
import type { NumberFieldKey, RobotProfile } from '../ui/robotForm';
import type { LengthUnit } from '../ui/units';
import { robotLabel } from '../ui/mainScreenModel';
import type { RobotLutView } from '../ui/lutView';
import { NumberField, Section, Segmented, TextField, Toggle } from './FormControls';
import LutStatus from './LutStatus';
import RobotPreview from './RobotPreview';

export interface RobotTabProps {
  robotId: RobotId;
  profile: RobotProfile;                            // 초안
  fieldText: Readonly<Record<string, string>>;      // 틀린 입력 글자
  unit: LengthUnit;
  lang: Language;
  locked: boolean;
  canCopy: boolean;
  alliance: 'RED' | 'BLUE';                         // 스윗스팟 입력 / 표시 기준 (시나리오 초안 진영)
  lut: RobotLutView;                                // 적용한 설정의 명중 확률표 상태
  lutPending: boolean;                              // 초안의 LUT 입력이 적용 값과 다름
  onRetry: () => void;
  /** 초안 편집: 새 프로필(없으면 값은 그대로) + 칸 키가 있으면 그 칸의 틀린 글자(null = 지움) + 함께 지울 칸 글자 */
  onEdit: (profile: RobotProfile | null, key: string | null, invalidText: string | null, clearKeys?: readonly string[]) => void;
  onCopy: () => void;
}

const LABELS: Readonly<Record<NumberFieldKey, MessageKey>> = {
  width: 'robot.width',
  length: 'robot.length',
  maxSpeed: 'robot.maxSpeed',
  maxLinearAccel: 'robot.maxLinearAccel',
  maxTurnRate: 'robot.maxTurnRate',
  maxAngularAccel: 'robot.maxAngularAccel',
  maxControlledPieces: 'robot.maxControlledPieces',
  intakeDelay: 'robot.intakeDelay',
  shooterDelay: 'robot.shooterDelay',
  aimTolerance: 'robot.aimTolerance',
  turretLeft: 'robot.turretLeft',
  turretRight: 'robot.turretRight',
  flowerSetupDelay: 'robot.flowerSetupDelay',
  flowerDropDelay: 'robot.flowerDropDelay',
  launchHeight: 'robot.launchHeight',
  shooterPitch: 'robot.shooterPitch',
  shooterOffset: 'robot.shooterOffset',
  v0NoisePercent: 'robot.v0NoisePercent',
  headingNoiseRad: 'robot.headingNoiseRad',
  pitchNoiseRad: 'robot.pitchNoiseRad',
};

export default function RobotTab({ robotId, profile, fieldText, unit, lang, locked, canCopy, alliance, lut, lutPending, onRetry, onEdit, onCopy }: RobotTabProps) {
  const other: RobotId = robotId === 'robot1' ? 'robot2' : 'robot1';
  const { config } = profile;
  const num = (key: NumberFieldKey) => (
    <NumberField
      key={key}
      id={`${robotId}-${key}`}
      label={t(lang, LABELS[key])}
      spec={NUMBER_FIELDS[key]}
      value={readNumber(profile, key)}
      invalidText={fieldText[key]}
      unit={unit}
      lang={lang}
      disabled={locked}
      onValue={v => onEdit(writeNumber(profile, key, v), key, null)}
      onInvalid={text => onEdit(null, key, text)}
    />
  );
  // 칸 글자와 무관한 편집 (토글 / 형식 전환)
  const setConfig = (patch: Partial<RobotProfile['config']>) => onEdit({ ...profile, config: { ...config, ...patch } }, null, null);
  const turretSame = config.turretType === 'TURRET' && config.turretRange[0] === config.turretRange[1] && !fieldText.turretLeft && !fieldText.turretRight;
  // 구역 목록 구조가 바뀌면(추가 / 삭제 / 프리셋) 번호가 밀리므로 구역 칸의 틀린 글자는 모두 지움
  const zoneTextKeys = Object.keys(fieldText).filter(k => k.startsWith('zone.'));
  const setZones = (intakeZones: RobotProfile['config']['intakeZones']) => onEdit({ ...profile, config: { ...config, intakeZones } }, null, null, zoneTextKeys);
  // 스윗스팟: 진영 기준 표시 / 입력, 탄도 검증 사유 (필드 밖 / HIVE / 해 없음)
  const spot = readSweetSpot(profile, alliance);
  const spotIssues = robotProfileIssues(profile).filter(issue => issue.code.startsWith('SWEET_SPOT_'));

  return (
    <div className="settings-tab robot-tab">
      <RobotPreview config={config} shooterOffset={profile.ballistics.shooterOffset} lang={lang} />
      <Section title={t(lang, 'robot.section.team')}>
        <div className="form-grid">
          <TextField
            id={`${robotId}-teamNumber`}
            label={t(lang, 'robot.teamNumber')}
            field="teamNumber"
            value={profile.teamNumber}
            invalidText={fieldText.teamNumber}
            lang={lang}
            disabled={locked}
            placeholder={robotLabel(robotId)}
            onValue={v => onEdit({ ...profile, teamNumber: v }, 'teamNumber', null)}
            onInvalid={text => onEdit(null, 'teamNumber', text)}
          />
          <TextField
            id={`${robotId}-teamName`}
            label={t(lang, 'robot.teamName')}
            field="teamName"
            value={profile.teamName}
            invalidText={fieldText.teamName}
            lang={lang}
            disabled={locked}
            onValue={v => onEdit({ ...profile, teamName: v }, 'teamName', null)}
            onInvalid={text => onEdit(null, 'teamName', text)}
          />
        </div>
        <p className="settings-note">{t(lang, 'robot.teamHint')}</p>
      </Section>

      <Section title={t(lang, 'robot.section.hardware')}>
        <div className="form-grid">{(['width', 'length', 'maxSpeed', 'maxLinearAccel', 'maxTurnRate', 'maxAngularAccel', 'maxControlledPieces'] as const).map(num)}</div>
      </Section>

      <Section title={t(lang, 'robot.section.intake')}>
        <div className="form-grid">{num('intakeDelay')}</div>
        <Toggle checked={config.canIntakeNectar} disabled={locked} label={t(lang, 'robot.canIntakeNectar')} onChange={v => setConfig({ canIntakeNectar: v })} />
        <div className="zone-list">
          <span className="form-label">{t(lang, 'robot.intakeZones')}</span>
          {config.intakeZones.length === 0 && <span className="form-warn">{t(lang, 'robot.noIntakeZones')}</span>}
          {config.intakeZones.map((zone, i) => (
            <div className="zone-row" key={i}>
              <div className="zone-head">
                <span className="zone-title">{t(lang, 'robot.zone.title', { n: i + 1 })}</span>
                <Segmented<BumperSide>
                  ariaLabel={t(lang, 'robot.zone.title', { n: i + 1 })}
                  value={zone.side}
                  options={BUMPER_SIDES}
                  label={v => t(lang, `robot.side.${v}`)}
                  disabled={() => locked}
                  onChange={v => onEdit(writeZone(profile, i, { side: v }), zoneFieldKey(i, 'offset'), null)}
                />
                <button type="button" className="icon-button zone-remove" disabled={locked} title={t(lang, 'robot.zone.remove', { n: i + 1 })} aria-label={t(lang, 'robot.zone.remove', { n: i + 1 })} onClick={() => setZones(config.intakeZones.filter((_, j) => j !== i))}>
                  <Trash2 />
                </button>
              </div>
              <div className="form-grid zone-fields">
                {ZONE_FIELDS.map(field => (
                  <NumberField
                    key={field}
                    id={`${robotId}-zone-${i}-${field}`}
                    label={t(lang, `robot.zone.${field}`)}
                    spec={zoneFieldSpec(field, zone.side, config)}
                    value={zone[field]}
                    invalidText={fieldText[zoneFieldKey(i, field)]}
                    unit={unit}
                    lang={lang}
                    disabled={locked}
                    checkValue
                    onValue={v => onEdit(writeZone(profile, i, { [field]: v }), zoneFieldKey(i, field), null)}
                    onInvalid={text => onEdit(null, zoneFieldKey(i, field), text)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="settings-row">
            <button type="button" className="config-button" disabled={locked || config.intakeZones.length >= MAX_INTAKE_ZONES} onClick={() => setZones([...config.intakeZones, newIntakeZone(config)])}>
              <Plus />
              {t(lang, 'robot.zone.add')}
            </button>
            <div className="preset-buttons">
              <span className="settings-note">{t(lang, 'robot.zone.presets')}</span>
              {(['FRONT', 'ANY'] as const).map(p => (
                <button key={p} type="button" className="config-button" disabled={locked} onClick={() => setZones(createIntakeZonePreset(p, config))}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <p className="settings-note">{t(lang, 'robot.zone.hint')}</p>
        </div>
      </Section>

      <Section title={t(lang, 'robot.section.shooter')}>
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'robot.turretType')}</span>
          <Segmented
            ariaLabel={t(lang, 'robot.turretType')}
            value={config.turretType}
            options={['FIXED', 'TURRET'] as const}
            label={v => t(lang, `robot.turret.${v}`)}
            disabled={() => locked}
            onChange={v => {
              // 터렛으로 바꿀 때 범위가 비어 있으면(폭 0) ±90°로 시작. 다른 형식의 값은 버리지 않음
              const range = v === 'TURRET' && config.turretRange[0] === config.turretRange[1] ? TURRET_PRESETS.half : config.turretRange;
              setConfig({ turretType: v, turretRange: [...range] as [number, number] });
              // 숨는 칸의 틀린 글자는 지움 (보이지 않는 칸이 탭을 막지 않도록)
              for (const hidden of v === 'TURRET' ? (['aimTolerance'] as const) : (['turretLeft', 'turretRight'] as const)) onEdit(null, hidden, null);
            }}
          />
        </div>
        {config.turretType === 'FIXED' ? (
          <div className="form-grid">{num('aimTolerance')}</div>
        ) : (
          <>
            <div className="form-grid">
              {num('turretLeft')}
              {num('turretRight')}
            </div>
            <div className="settings-row">
              <span className="settings-note">{t(lang, 'robot.turretHint')}</span>
              <div className="preset-buttons">
                {(['half', 'full'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    className="config-button"
                    disabled={locked}
                    onClick={() => {
                      onEdit({ ...profile, config: { ...config, turretRange: [...TURRET_PRESETS[p]] as [number, number] } }, 'turretLeft', null);
                      onEdit(null, 'turretRight', null);
                    }}
                  >
                    {t(lang, p === 'half' ? 'robot.turretPresetHalf' : 'robot.turretPresetFull')}
                  </button>
                ))}
              </div>
            </div>
            {turretSame && <span className="form-error">{t(lang, 'form.turretWidth')}</span>}
          </>
        )}
        <div className="form-grid">
          {num('launchHeight')}
          {num('shooterPitch')}
          {num('shooterOffset')}
          {num('shooterDelay')}
        </div>
        <details className="advanced">
          <summary>{t(lang, 'robot.advanced')}</summary>
          <p className="settings-note">{t(lang, 'robot.advancedHint')}</p>
          <div className="form-grid">
            {num('v0NoisePercent')}
            {num('headingNoiseRad')}
            {num('pitchNoiseRad')}
          </div>
        </details>
      </Section>

      <Section title={t(lang, 'robot.section.sweetSpot')}>
        <span className="settings-note">{t(lang, 'robot.sweetSpotBasis', { key: sweetSpotBasisCell(alliance) })}</span>
        <div className="form-grid">
          {SWEET_SPOT_AXES.map(axis => (
            <NumberField
              key={axis}
              id={`${robotId}-sweetSpot-${axis}`}
              label={t(lang, axis === 'x' ? 'robot.sweetSpotX' : 'robot.sweetSpotY')}
              spec={SWEET_SPOT_SPEC}
              value={spot[axis]}
              invalidText={fieldText[sweetSpotFieldKey(axis)]}
              unit={unit}
              lang={lang}
              disabled={locked}
              onValue={v => onEdit(writeSweetSpot(profile, alliance, axis, v), sweetSpotFieldKey(axis), null)}
              onInvalid={text => onEdit(null, sweetSpotFieldKey(axis), text)}
            />
          ))}
        </div>
        {spotIssues.map(issue => (
          <span key={issue.code} className="form-error">
            {t(lang, `issue.${issue.code}` as MessageKey)}
          </span>
        ))}
        <p className="settings-note">{t(lang, 'robot.sweetSpotHint')}</p>
        <LutStatus lut={lut} unit={unit} lang={lang} pendingApply={lutPending} locked={locked} onRetry={onRetry} />
      </Section>

      <Section title={t(lang, 'robot.section.lift')}>
        <div className="form-grid">
          {num('flowerSetupDelay')}
          {num('flowerDropDelay')}
        </div>
      </Section>

      <div className="settings-row copy-row">
        <span className="settings-note">{t(lang, 'robot.copyHint', { robot: robotLabel(other) })}</span>
        <button type="button" className="config-button" disabled={locked || !canCopy} onClick={onCopy}>
          <Copy />
          {t(lang, 'robot.copyTo', { robot: robotLabel(other) })}
        </button>
      </div>
    </div>
  );
}
