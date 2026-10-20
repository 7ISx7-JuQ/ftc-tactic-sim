// 로봇 제원 탭 R1 / R2 (명세서 3.8 로봇 제원 탭, 09-9a): 팀 / 하드웨어 / 인테이크 / 슈터 / FLOWER 리프트 + COPY TO.
// 값은 초안(config 창 초안 / 적용 규칙)에만 들어가고 APPLY로 확정한다. 경기가 있는 동안 모든 칸 읽기 전용.
// 09-9b: 맨 위 로봇 미리보기, 흡입 구역 편집기(구역별 면 / 위치 / 폭 / 깊이, 추가 · 삭제, 프리셋 FRONT / ANY),
// 슈터 탄도(발사구 지상고 / 발사각 / 오프셋 + 고급 설정의 편차 3종).
// 09-10a: 스윗스팟 X / Y(시나리오 진영 기준, 기준 CELL 표시) + 검증 사유 + 명중 확률표 상태(적용한 설정 기준).
// 09-10b: SHOW HIT MAP(필드 히트맵 편집 모드 열기 / 닫기). 09-10c: SET ON FIELD(필드에서 스윗스팟 찍기 모드 열기).
// 13-3: 슈터 구성 선택(NONE / POLLEN_ONLY / SHARED / PER_PIECE, NECTAR 흡입 불가면 NONE / SHARED만) + 한 줄 설명, 슈터 카드
// (주 슈터 / PER_PIECE의 NECTAR 슈터 — 같은 칸, NECTAR 카드는 스윗스팟 X / Y 포함), 좌우 오프셋, 리프트 주행 속도,
// 투입 방향 구역 편집기(흡입 구역 편집기와 같은 ZoneEditor). NONE이면 슈터 칸 / 스윗스팟 구역을 숨긴다.
import { Copy, Crosshair, Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { sweetSpotBasisCell } from '../core/ballistics';
import { createIntakeZonePreset } from '../core/collision';
import type { BumperSide, ShooterSetup } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import {
  BUMPER_SIDES,
  MAX_INTAKE_ZONES,
  NUMBER_FIELDS,
  SHOOTER_FIELD_KEYS,
  SHOOTER_SETUPS,
  SWEET_SPOT_AXES,
  SWEET_SPOT_SPEC,
  TURRET_PRESETS,
  ZONE_FIELDS,
  isZoneFieldKey,
  newIntakeZone,
  readNumber,
  readSweetSpot,
  robotProfileIssues,
  shooterFieldKey,
  shooterSetupAllowed,
  slotAim,
  sweetSpotFieldKey,
  writeNumber,
  writeSlotAim,
  writeSweetSpot,
  writeZone,
  zoneFieldKey,
  zoneFieldSpec,
} from '../ui/robotForm';
import type { NumberFieldKey, RobotIssue, RobotProfile, ShooterFieldKey, ShooterSlot, ZoneList } from '../ui/robotForm';
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
  appliedSetup: ShooterSetup;                       // 적용한 설정의 슈터 구성 (확률표 상태 상자의 기물별 줄, 13-4)
  lutPending: boolean;                              // 초안의 LUT 입력이 적용 값과 다름
  onRetry: () => void;
  heatmapOn: boolean;                               // 이 로봇의 히트맵 편집 모드가 열려 있음 (09-10b)
  onHeatmap: () => void;                            // SHOW / HIDE HIT MAP
  spotEditSlot: ShooterSlot | null;                 // 이 로봇의 스윗스팟 편집 모드가 열려 있으면 찍는 슈터 자리 (09-10c, 13-4)
  onSetOnField: (slot: ShooterSlot) => void;        // SET ON FIELD — 주 슈터 / NECTAR 슈터 카드 (닫기는 필드 안내 띠의 DONE · APPLY / CANCEL)
  /** 초안 편집: 새 프로필(없으면 값은 그대로) + 칸 키가 있으면 그 칸의 틀린 글자(null = 지움) + 함께 지울 칸 글자 */
  onEdit: (profile: RobotProfile | null, key: string | null, invalidText: string | null, clearKeys?: readonly string[]) => void;
  onCopy: () => void;
}

type MainFieldKey = Exclude<NumberFieldKey, `nectar.${string}`>;
const LABELS: Readonly<Record<MainFieldKey, MessageKey>> = {
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
  liftMaxSpeed: 'robot.liftMaxSpeed',
  launchHeight: 'robot.launchHeight',
  shooterPitch: 'robot.shooterPitch',
  shooterOffset: 'robot.shooterOffset',
  shooterLateralOffset: 'robot.shooterLateralOffset',
  v0NoisePercent: 'robot.v0NoisePercent',
  headingNoiseRad: 'robot.headingNoiseRad',
  pitchNoiseRad: 'robot.pitchNoiseRad',
};
const labelKey = (key: NumberFieldKey): MessageKey => LABELS[(key.startsWith('nectar.') ? key.slice('nectar.'.length) : key) as MainFieldKey];

// 숨는 슈터 칸의 틀린 글자 키 (구성 / 형식을 바꿔 칸이 사라질 때 지움 — 보이지 않는 칸이 탭을 막지 않도록)
const slotTextKeys = (slot: ShooterSlot): string[] => [...SHOOTER_FIELD_KEYS.map(k => shooterFieldKey(slot, k)), ...SWEET_SPOT_AXES.map(a => sweetSpotFieldKey(a, slot))];

export default function RobotTab({ robotId, profile, fieldText, unit, lang, locked, canCopy, alliance, lut, appliedSetup, lutPending, onRetry, heatmapOn, onHeatmap, spotEditSlot, onSetOnField, onEdit, onCopy }: RobotTabProps) {
  const other: RobotId = robotId === 'robot1' ? 'robot2' : 'robot1';
  const { config } = profile;
  const setup = config.shooterSetup;
  const issues = robotProfileIssues(profile);
  const num = (key: NumberFieldKey) => (
    <NumberField
      key={key}
      id={`${robotId}-${key.replace('.', '-')}`}
      label={t(lang, labelKey(key))}
      spec={NUMBER_FIELDS[key]}
      value={readNumber(profile, key)}
      invalidText={fieldText[key]}
      unit={unit}
      lang={lang}
      disabled={locked}
      checkValue
      onValue={v => onEdit(writeNumber(profile, key, v), key, null)}
      onInvalid={text => onEdit(null, key, text)}
    />
  );
  // 칸 글자와 무관한 편집 (토글 / 형식 전환)
  const setConfig = (patch: Partial<RobotProfile['config']>) => onEdit({ ...profile, config: { ...config, ...patch } }, null, null);

  // 슈터 구성: 숨는 슈터(NONE의 주 슈터, PER_PIECE를 떠나면 NECTAR 슈터)의 틀린 글자는 지움
  const changeSetup = (next: ShooterSetup) => {
    const hidden = [...(next === 'NONE' ? slotTextKeys('MAIN') : []), ...(next !== 'PER_PIECE' ? slotTextKeys('NECTAR') : [])];
    onEdit({ ...profile, config: { ...config, shooterSetup: next } }, null, null, hidden.filter(k => fieldText[k] !== undefined));
  };
  const slotIssues = (slot: ShooterSlot) => issues.filter(i => (i.slot ?? 'MAIN') === slot && (i.code.startsWith('SWEET_SPOT_') || i.code === 'PARAM_INVALID'));

  // 슈터 카드 1개 (주 슈터 / NECTAR 슈터): 형식, 허용 오차 또는 터렛 한계, 발사구 지상고 / 발사각 / 앞뒤 · 좌우 오프셋 / 발사 딜레이, 고급 편차.
  // NECTAR 카드는 스윗스팟 X / Y와 검증 사유도 (필드 찍기 / 히트맵은 주 슈터 스윗스팟 구역)
  const shooterCard = (slot: ShooterSlot) => {
    const aim = slotAim(profile, slot);
    const key = (k: ShooterFieldKey) => shooterFieldKey(slot, k);
    const turretSame = aim.turretType === 'TURRET' && aim.turretRange[0] === aim.turretRange[1] && !fieldText[key('turretLeft')] && !fieldText[key('turretRight')];
    const spot = readSweetSpot(profile, alliance, slot);
    const title = setup === 'PER_PIECE' ? t(lang, slot === 'MAIN' ? 'robot.shooterCard.POLLEN' : 'robot.shooterCard.NECTAR') : null;
    return (
      <div className={`shooter-card${title ? ' is-titled' : ''}`} key={slot}>
        {title && <h4 className="shooter-card-title">{title}</h4>}
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'robot.turretType')}</span>
          <Segmented
            ariaLabel={title ? `${title} ${t(lang, 'robot.turretType')}` : t(lang, 'robot.turretType')}
            value={aim.turretType}
            options={['FIXED', 'TURRET'] as const}
            label={v => t(lang, `robot.turret.${v}`)}
            disabled={() => locked}
            onChange={v => {
              // 터렛으로 바꿀 때 범위가 비어 있으면(폭 0) ±90°로 시작. 다른 형식의 값은 버리지 않음. 숨는 칸의 틀린 글자는 지움
              const range = v === 'TURRET' && aim.turretRange[0] === aim.turretRange[1] ? TURRET_PRESETS.half : aim.turretRange;
              const hidden = v === 'TURRET' ? [key('aimTolerance')] : [key('turretLeft'), key('turretRight')];
              onEdit(writeSlotAim(profile, slot, { turretType: v, turretRange: [...range] as [number, number] }), null, null, hidden.filter(k => fieldText[k] !== undefined));
            }}
          />
        </div>
        {aim.turretType === 'FIXED' ? (
          <div className="form-grid">{num(key('aimTolerance'))}</div>
        ) : (
          <>
            <div className="form-grid">
              {num(key('turretLeft'))}
              {num(key('turretRight'))}
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
                    onClick={() => onEdit(writeSlotAim(profile, slot, { turretRange: [...TURRET_PRESETS[p]] as [number, number] }), null, null, [key('turretLeft'), key('turretRight')])}
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
          {num(key('launchHeight'))}
          {num(key('shooterPitch'))}
          {num(key('shooterOffset'))}
          {num(key('shooterLateralOffset'))}
          {num(key('shooterDelay'))}
        </div>
        <details className="advanced">
          <summary>{t(lang, 'robot.advanced')}</summary>
          <p className="settings-note">{t(lang, 'robot.advancedHint')}</p>
          <div className="form-grid">
            {num(key('v0NoisePercent'))}
            {num(key('headingNoiseRad'))}
            {num(key('pitchNoiseRad'))}
          </div>
        </details>
        {slot === 'NECTAR' && (
          <>
            <span className="settings-note">{t(lang, 'robot.sweetSpotBasis', { key: sweetSpotBasisCell(alliance) })}</span>
            <div className="form-grid">{SWEET_SPOT_AXES.map(axis => sweetSpotField(axis, slot, spot[axis]))}</div>
            {setOnFieldRow(slot)}
            <IssueList issues={slotIssues(slot)} lang={lang} />
            <p className="settings-note">{t(lang, 'robot.nectarSweetSpotHint')}</p>
          </>
        )}
      </div>
    );
  };

  const sweetSpotField = (axis: 'x' | 'y', slot: ShooterSlot, value: number) => (
    <NumberField
      key={axis}
      id={`${robotId}-${slot === 'MAIN' ? '' : 'nectar-'}sweetSpot-${axis}`}
      label={t(lang, axis === 'x' ? 'robot.sweetSpotX' : 'robot.sweetSpotY')}
      spec={SWEET_SPOT_SPEC}
      value={value}
      invalidText={fieldText[sweetSpotFieldKey(axis, slot)]}
      unit={unit}
      lang={lang}
      disabled={locked}
      checkValue
      onValue={v => onEdit(writeSweetSpot(profile, alliance, axis, v, slot), sweetSpotFieldKey(axis, slot), null)}
      onInvalid={text => onEdit(null, sweetSpotFieldKey(axis, slot), text)}
    />
  );

  // SET ON FIELD (09-10c): 그 슈터 자리의 스윗스팟을 필드에서 찍기 (13-4: NECTAR 슈터 카드에도)
  const setOnFieldRow = (slot: ShooterSlot) => {
    const on = spotEditSlot === slot;
    return (
      <div className="settings-row">
        <span className="settings-note">{t(lang, 'edit.sweetSpot.hint', { key: sweetSpotBasisCell(alliance) })}</span>
        <button
          type="button"
          className={`config-button${on ? ' is-active' : ''}`}
          aria-pressed={on}
          aria-label={slot === 'NECTAR' ? `${t(lang, 'robot.shooterCard.NECTAR')} ${t(lang, on ? 'robot.settingOnField' : 'robot.setOnField')}` : undefined}
          disabled={locked || on}
          onClick={() => onSetOnField(slot)}
        >
          <Crosshair />
          {t(lang, on ? 'robot.settingOnField' : 'robot.setOnField')}
        </button>
      </div>
    );
  };

  const zoneEditor = (list: ZoneList) => (
    <ZoneEditor robotId={robotId} profile={profile} list={list} fieldText={fieldText} unit={unit} lang={lang} locked={locked} onEdit={onEdit} />
  );
  const spot = readSweetSpot(profile, alliance);

  return (
    <div className="settings-tab robot-tab">
      <RobotPreview profile={profile} lang={lang} />
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
        {zoneEditor('intakeZones')}
      </Section>

      <Section title={t(lang, 'robot.section.shooter')}>
        <div className="settings-row">
          <span className="settings-label">{t(lang, 'robot.shooterSetup')}</span>
          <Segmented<ShooterSetup>
            ariaLabel={t(lang, 'robot.shooterSetup')}
            value={setup}
            options={SHOOTER_SETUPS}
            label={v => t(lang, `robot.setup.${v}`)}
            disabled={v => locked || (v !== setup && !shooterSetupAllowed(v, config.canIntakeNectar))}
            onChange={changeSetup}
          />
        </div>
        <p className="settings-note">{t(lang, `robot.setupHint.${setup}`)}</p>
        {!config.canIntakeNectar && <p className="settings-note">{t(lang, 'robot.setupNeedsNectar')}</p>}
        <IssueList issues={issues.filter(i => i.code === 'SHOOTER_SETUP_NECTAR')} lang={lang} />
        {setup !== 'NONE' && shooterCard('MAIN')}
        {setup === 'PER_PIECE' && shooterCard('NECTAR')}
      </Section>

      {setup !== 'NONE' && (
        <Section title={t(lang, setup === 'PER_PIECE' ? 'robot.section.sweetSpotPollen' : 'robot.section.sweetSpot')}>
          <span className="settings-note">{t(lang, 'robot.sweetSpotBasis', { key: sweetSpotBasisCell(alliance) })}</span>
          <div className="form-grid">{SWEET_SPOT_AXES.map(axis => sweetSpotField(axis, 'MAIN', spot[axis]))}</div>
          {setOnFieldRow('MAIN')}
          <IssueList issues={slotIssues('MAIN')} lang={lang} />
          <p className="settings-note">{t(lang, 'robot.sweetSpotHint')}</p>
          <LutStatus lut={lut} setup={appliedSetup} unit={unit} lang={lang} pendingApply={lutPending} locked={locked} onRetry={onRetry} />
          <div className="settings-row">
            <span className="settings-note">{t(lang, 'robot.heatmapHint')}</span>
            <button type="button" className={`config-button${heatmapOn ? ' is-active' : ''}`} aria-pressed={heatmapOn} disabled={locked} onClick={onHeatmap}>
              <MapIcon />
              {t(lang, heatmapOn ? 'robot.hideHeatmap' : 'robot.showHeatmap')}
            </button>
          </div>
        </Section>
      )}

      <Section title={t(lang, 'robot.section.lift')}>
        <div className="form-grid">
          {num('flowerSetupDelay')}
          {num('flowerDropDelay')}
          {num('liftMaxSpeed')}
        </div>
        <p className="settings-note">{t(lang, 'robot.liftMaxSpeedHint')}</p>
        {zoneEditor('flowerDropZones')}
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

function IssueList({ issues, lang }: { issues: readonly RobotIssue[]; lang: Language }) {
  return (
    <>
      {issues.map(issue => (
        <span key={`${issue.slot ?? ''}${issue.code}`} className="form-error">
          {t(lang, `issue.${issue.code}` as MessageKey)}
        </span>
      ))}
    </>
  );
}

const ZONE_TEXT: Readonly<Record<ZoneList, { title: MessageKey; empty: MessageKey; emptyClass: string }>> = {
  intakeZones: { title: 'robot.intakeZones', empty: 'robot.noIntakeZones', emptyClass: 'form-warn' },
  flowerDropZones: { title: 'robot.dropZones', empty: 'robot.noDropZones', emptyClass: 'settings-note' },
};

/**
 * 구역 편집기 (흡입 구역 09-9b / 투입 방향 구역 13-3 공용): 구역마다 면 버튼 묶음 + 위치 / 폭 / 깊이 + 삭제, 구역 추가, 프리셋 FRONT / ANY.
 * 구역 목록 구조가 바뀌면(추가 / 삭제 / 프리셋) 번호가 밀리므로 그 목록 구역 칸의 틀린 글자는 모두 지움
 */
function ZoneEditor({ robotId, profile, list, fieldText, unit, lang, locked, onEdit }: {
  robotId: RobotId;
  profile: RobotProfile;
  list: ZoneList;
  fieldText: Readonly<Record<string, string>>;
  unit: LengthUnit;
  lang: Language;
  locked: boolean;
  onEdit: RobotTabProps['onEdit'];
}) {
  const { config } = profile;
  const zones = config[list];
  const text = ZONE_TEXT[list];
  const idPrefix = list === 'intakeZones' ? 'zone' : 'dropZone';
  const zoneTextKeys = Object.keys(fieldText).filter(k => isZoneFieldKey(k, list));
  const setZones = (next: RobotProfile['config']['intakeZones']) => onEdit({ ...profile, config: { ...config, [list]: next } }, null, null, zoneTextKeys);
  const titleKey = list === 'intakeZones' ? 'robot.zone.title' : 'robot.dropZone.title';
  const removeKey = list === 'intakeZones' ? 'robot.zone.remove' : 'robot.dropZone.remove';
  return (
    <div className="zone-list">
      <span className="form-label">{t(lang, text.title)}</span>
      {zones.length === 0 && <span className={text.emptyClass}>{t(lang, text.empty)}</span>}
      {zones.map((zone, i) => (
        <div className={`zone-row${list === 'flowerDropZones' ? ' is-drop' : ''}`} key={i}>
          <div className="zone-head">
            <span className="zone-title">{t(lang, titleKey, { n: i + 1 })}</span>
            <Segmented<BumperSide>
              ariaLabel={t(lang, titleKey, { n: i + 1 })}
              value={zone.side}
              options={BUMPER_SIDES}
              label={v => t(lang, `robot.side.${v}`)}
              disabled={() => locked}
              onChange={v => onEdit(writeZone(profile, i, { side: v }, list), zoneFieldKey(i, 'offset', list), null)}
            />
            <button type="button" className="icon-button zone-remove" disabled={locked} title={t(lang, removeKey, { n: i + 1 })} aria-label={t(lang, removeKey, { n: i + 1 })} onClick={() => setZones(zones.filter((_, j) => j !== i))}>
              <Trash2 />
            </button>
          </div>
          <div className="form-grid zone-fields">
            {ZONE_FIELDS.map(field => (
              <NumberField
                key={field}
                id={`${robotId}-${idPrefix}-${i}-${field}`}
                label={t(lang, `robot.zone.${field}`)}
                spec={zoneFieldSpec(field, zone.side, config)}
                value={zone[field]}
                invalidText={fieldText[zoneFieldKey(i, field, list)]}
                unit={unit}
                lang={lang}
                disabled={locked}
                checkValue
                onValue={v => onEdit(writeZone(profile, i, { [field]: v }, list), zoneFieldKey(i, field, list), null)}
                onInvalid={t2 => onEdit(null, zoneFieldKey(i, field, list), t2)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="settings-row">
        <button type="button" className="config-button" disabled={locked || zones.length >= MAX_INTAKE_ZONES} onClick={() => setZones([...zones, newIntakeZone(config)])}>
          <Plus />
          {t(lang, list === 'intakeZones' ? 'robot.zone.add' : 'robot.dropZone.add')}
        </button>
        <div className="preset-buttons">
          <span className="settings-note">{t(lang, 'robot.zone.presets')}</span>
          {(['FRONT', 'ANY'] as const).map(p => (
            <button key={p} type="button" className="config-button" disabled={locked} aria-label={`${t(lang, text.title)} ${p}`} onClick={() => setZones(createIntakeZonePreset(p, config))}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-note">{t(lang, list === 'intakeZones' ? 'robot.zone.hint' : 'robot.dropZone.hint')}</p>
    </div>
  );
}
