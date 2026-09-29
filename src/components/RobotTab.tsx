// 로봇 제원 탭 R1 / R2 (명세서 3.8 로봇 제원 탭, 09-9a): 팀 / 하드웨어 / 인테이크 / 슈터 / FLOWER 리프트 + COPY TO.
// 값은 초안(config 창 초안 / 적용 규칙)에만 들어가고 APPLY로 확정한다. 경기가 있는 동안 모든 칸 읽기 전용.
// 인테이크 구역 편집기와 슈터 탄도(발사구 지상고 / 발사각 / 오프셋 / 편차)는 09-9b, 스윗스팟 / LUT는 09-10.
import { Copy } from 'lucide-react';
import type { RobotId } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { NUMBER_FIELDS, TURRET_PRESETS, readNumber, writeNumber } from '../ui/robotForm';
import type { NumberFieldKey, RobotFieldKey, RobotProfile } from '../ui/robotForm';
import { formatQuantity } from '../ui/units';
import type { LengthUnit } from '../ui/units';
import { robotLabel } from '../ui/mainScreenModel';
import { NumberField, Section, Segmented, TextField, Toggle } from './FormControls';

export interface RobotTabProps {
  robotId: RobotId;
  profile: RobotProfile;                            // 초안
  fieldText: Readonly<Record<string, string>>;      // 틀린 입력 글자
  unit: LengthUnit;
  lang: Language;
  locked: boolean;
  canCopy: boolean;
  /** 초안 편집: 새 프로필(없으면 값은 그대로) + 칸 키가 있으면 그 칸의 틀린 글자(null = 지움) */
  onEdit: (profile: RobotProfile | null, key: RobotFieldKey | null, invalidText: string | null) => void;
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
};

export default function RobotTab({ robotId, profile, fieldText, unit, lang, locked, canCopy, onEdit, onCopy }: RobotTabProps) {
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

  return (
    <div className="settings-tab robot-tab">
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
        <div className="form-readonly">
          <span className="form-label">{t(lang, 'robot.intakeZones')}</span>
          {config.intakeZones.length === 0 ? (
            <span className="form-warn">{t(lang, 'robot.noIntakeZones')}</span>
          ) : (
            <span>{config.intakeZones.map(z => `${z.side} ${formatQuantity('length', z.width, unit)} × ${formatQuantity('length', z.depth, unit)}`).join(' · ')}</span>
          )}
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
        <div className="form-grid">{num('shooterDelay')}</div>
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
