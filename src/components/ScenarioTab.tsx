// 시나리오 탭 (명세서 3.8 시나리오 탭, 2.4 텔레옵 시작 조건, 09-11a): 유효 배지 + 진영 / HIVE / 로봇 적재물 / 잔여 기물 / 오토 TIP /
// 시작 자세 숫자 칸 / 난수 시드. 값은 초안에만 들어가고 APPLY로 확정한다 (시드 REROLL만 바로 적용 — 09-11 확정). 경기가 있는 동안 읽기 전용.
// 09-11b: EDIT ON FIELD(필드에서 끌어 시작 자세 정하기 — 모드는 필드 안내 띠의 DONE · APPLY / CANCEL로 끝냄).
// 14-1a: EDIT ON FIELD = 시나리오 필드 편집 모드 — 탭 맨 위 버튼, 시작 자세 구역의 버튼도 같은 모드를 연다.
// 14-2: 오토 이동(로봇별 NONE / LEAVE / PARK / LEAVE_PARK, 12-12) + RP 기준값(SWARM 점수 / POLLINATOR 1 · 2 TIP 수, 정수 1 ~ 99, DEFAULT = 지정 해제),
//   로봇 2대로 도달할 수 없는 SWARM 기준은 경고(주황, 적용 허용).
// 18-1: 난수 시드 숫자 칸 — 직접 입력은 초안 + APPLY, REROLL은 지금처럼 바로 적용.
// 19-2a: 맨 위에 저장된 시나리오 목록 (library — 화면이 만들어 넘김).
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Dices, Move, RotateCcw } from 'lucide-react';
import { hiveTipPollenThreshold } from '../core/types';
import type { RobotConfig, RobotPose, ScenarioConfig } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { robotLabel } from '../ui/mainScreenModel';
import type { RobotProfile } from '../ui/robotForm';
import {
  AUTO_MOVEMENTS,
  COUNT_LIMITS,
  RP_FIELD_SPEC,
  RP_KEYS,
  SEED_FIELD_KEY,
  SEED_FIELD_SPEC,
  setSeed,
  resetRpThresholds,
  rpFieldKey,
  setAutoMovement,
  setRpThreshold,
  SPAWN_AXES,
  SPAWN_FIELD_SPECS,
  floorSummary,
  issueFieldSet,
  nextSlotPiece,
  readScenario,
  resetSpawn,
  scenarioIssueText,
  setAlliance,
  setAutoTipCount,
  setFlowerCount,
  setGardenCount,
  setHivePieces,
  setLoadoutSlot,
  setSpawnAxis,
  setUpwardCell,
  spawnFieldKey,
} from '../ui/scenarioForm';
import type { HiveCellChoice, PieceType, ScenarioFormIssue, ScenarioView } from '../ui/scenarioForm';
import { SWARM_MAX_POINTS, getCarryCapacity } from '../core/simulationEngine';
import type { ScenarioWarning } from '../core/simulationEngine';
import type { LengthUnit } from '../ui/units';
import { NumberField, Section, Segmented, Stepper } from './FormControls';

const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const AXIS_LABEL: Readonly<Record<keyof RobotPose, string>> = { x: 'X', y: 'Y', heading: '' };

export interface ScenarioTabProps {
  scenario: ScenarioConfig;                         // 초안
  robots: Record<RobotId, RobotProfile>;            // 로봇 초안 (적재 한도 / NECTAR 흡입 / 몸체 크기)
  fieldText: Readonly<Record<string, string>>;      // 틀린 입력 글자
  issues: readonly ScenarioFormIssue[];
  warnings: readonly ScenarioWarning[];             // 적용은 허용하는 경고 (14-2: SWARM_UNREACHABLE)
  unit: LengthUnit;
  lang: Language;
  locked: boolean;
  /** 초안 편집: 새 시나리오(없으면 값은 그대로) + 칸 키가 있으면 그 칸의 틀린 글자(null = 지움) + 함께 지울 칸 글자 */
  onEdit: (scenario: ScenarioConfig | null, key: string | null, invalidText: string | null, clearKeys?: readonly string[]) => void;
  onReroll: () => void;
  fieldEditOn: boolean;                             // 시나리오 필드 편집 모드가 열려 있음 (14-1a)
  onEditOnField: () => void;
  library?: ReactNode;                              // 저장된 시나리오 목록 (19-2a, 탭 맨 위)
}

const ALL_SPAWN_KEYS = ROBOTS.flatMap(r => SPAWN_AXES.map(a => spawnFieldKey(r, a)));

export default function ScenarioTab({ scenario, robots, fieldText, issues, warnings, unit, lang, locked, onEdit, onReroll, fieldEditOn, onEditOnField, library }: ScenarioTabProps) {
  const view = readScenario(scenario, robots.robot1.config, robots.robot2.config);
  const red = issueFieldSet(issues);
  const typoCount = Object.keys(fieldText).length;
  const problems = issues.length + typoCount;
  const edit = (next: ScenarioConfig) => onEdit(next, null, null);
  const floor = floorSummary(view);
  const editOnFieldButton = (
    <button type="button" className={`config-button${fieldEditOn ? ' is-active' : ''}`} aria-pressed={fieldEditOn} disabled={locked || fieldEditOn} onClick={onEditOnField}>
      <Move />
      {t(lang, fieldEditOn ? 'scenario.editingOnField' : 'scenario.editOnField')}
    </button>
  );

  return (
    <div className="scenario-tab">
      {library}
      <div className={`scenario-badge ${problems === 0 ? 'is-valid' : 'is-invalid'}`} role="status">
        {problems === 0 ? <CircleCheck /> : <CircleAlert />}
        <span>{problems === 0 ? t(lang, 'scenario.valid') : t(lang, 'scenario.invalid', { count: problems })}</span>
      </div>
      {issues.length > 0 && (
        <ul className="scenario-issues">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${issue.robot ?? ''}-${i}`} className="form-error">
              {scenarioIssueText(issue, lang)}
            </li>
          ))}
        </ul>
      )}

      <div className="settings-row scenario-field-edit">
        <span className="settings-note">{t(lang, 'scenario.editOnFieldHint')}</span>
        {editOnFieldButton}
      </div>

      <Section title={t(lang, 'scenario.section.alliance')}>
        <Segmented
          value={view.alliance}
          options={['RED', 'BLUE'] as const}
          label={a => a}
          disabled={() => locked}
          onChange={a => onEdit(setAlliance(scenario, a), null, null, ALL_SPAWN_KEYS)}
          ariaLabel={t(lang, 'scenario.section.alliance')}
        />
      </Section>

      <Section title={t(lang, 'scenario.section.hive')}>
        <div className={`scenario-group${red.has('hive') ? ' has-error' : ''}`}>
          <div className="settings-row">
            <span className="form-label">{t(lang, 'scenario.upwardCell')}</span>
            <Segmented
              value={view.hiveUpwardCell}
              options={['AUDIENCE_CELL', 'OPPOSITE_CELL'] as readonly HiveCellChoice[]}
              label={c => t(lang, `scenario.cell.${c}`)}
              disabled={() => locked}
              onChange={c => edit(setUpwardCell(scenario, c))}
              ariaLabel={t(lang, 'scenario.upwardCell')}
            />
          </div>
          <div className="form-grid">
            <Stepper label={t(lang, 'scenario.hivePollen')} value={view.hivePollen} min={0} max={COUNT_LIMITS.hivePollen} disabled={locked} invalid={red.has('hive')} lang={lang} onChange={v => edit(setHivePieces(scenario, { pollenCount: v }))} />
            <Stepper label={t(lang, 'scenario.hiveNectar')} value={view.hiveNectar} min={0} max={COUNT_LIMITS.hiveNectar} disabled={locked} invalid={red.has('hive')} lang={lang} onChange={v => edit(setHivePieces(scenario, { nectarCount: v }))} />
          </div>
          <p className="settings-note">{t(lang, 'scenario.tipThreshold', { nectarCount: view.hiveNectar, threshold: hiveTipPollenThreshold(view.hiveNectar) })}</p>
        </div>
      </Section>

      <Section title={t(lang, 'scenario.section.loadout')}>
        {ROBOTS.map(robot => (
          <div key={robot} className={`loadout-row${red.has(`loadout.${robot}`) ? ' has-error' : ''}`}>
            <span className="loadout-robot">{robotLabel(robot)}</span>
            <LoadoutSlots robot={robot} scenario={scenario} view={view} config={robots[robot].config} lang={lang} disabled={locked} onEdit={edit} />
          </div>
        ))}
        <p className="settings-note">{t(lang, 'scenario.loadoutHint')}</p>
      </Section>

      <Section title={t(lang, 'scenario.section.remaining')}>
        <div className="form-grid">
          {view.flowers.map((n, i) => (
            <Stepper key={i} label={t(lang, 'scenario.flower', { n: i + 1 })} value={n} min={0} max={COUNT_LIMITS.flower} disabled={locked} invalid={red.has(`flower.${i}`)} lang={lang} onChange={v => edit(setFlowerCount(scenario, view, i, v))} />
          ))}
          <Stepper label={t(lang, 'scenario.gardenAlly')} value={view.garden.ally} min={0} max={COUNT_LIMITS.garden} disabled={locked} invalid={red.has('garden.ally')} lang={lang} onChange={v => edit(setGardenCount(scenario, view, 'ally', v))} />
          <Stepper label={t(lang, 'scenario.gardenOpponent')} value={view.garden.opponent} min={0} max={COUNT_LIMITS.garden} disabled={locked} invalid={red.has('garden.opponent')} lang={lang} onChange={v => edit(setGardenCount(scenario, view, 'opponent', v))} />
        </div>
        <p className="settings-note">{t(lang, 'scenario.floorSummary', { ...floor })}</p>
      </Section>

      <Section title={t(lang, 'scenario.section.autoTip')}>
        <Stepper label={t(lang, 'scenario.section.autoTip')} value={view.autoTipCount} min={0} max={COUNT_LIMITS.autoTip} disabled={locked} invalid={red.has('autoTip')} lang={lang} onChange={v => edit(setAutoTipCount(scenario, v))} />
        <p className="settings-note">{t(lang, 'scenario.autoTipHint')}</p>
      </Section>

      <Section title={t(lang, 'scenario.autoMovement')}>
        {ROBOTS.map(robot => (
          <div key={robot} className={`settings-row auto-move-row${red.has(`autoMove.${robot}`) ? ' has-error' : ''}`}>
            <span className="loadout-robot">{robotLabel(robot)}</span>
            <Segmented
              value={view.autoMovement[robot]}
              options={AUTO_MOVEMENTS}
              label={m => t(lang, `scenario.autoMovement.${m}`)}
              disabled={() => locked}
              onChange={m => edit(setAutoMovement(scenario, robot, m))}
              ariaLabel={`${robotLabel(robot)} ${t(lang, 'scenario.autoMovement')}`}
            />
          </div>
        ))}
        <p className="settings-note">{t(lang, 'scenario.autoMovementHint')}</p>
      </Section>

      <Section title={t(lang, 'scenario.section.spawn')}>
        {ROBOTS.map(robot => (
          <div key={robot} className={`spawn-card${red.has(`spawn.${robot}`) ? ' has-error' : ''}`}>
            <div className="spawn-head">
              <span className="loadout-robot">{robotLabel(robot)}</span>
              {view.spawnIsDefault[robot] && <span className="spawn-tag">{t(lang, 'scenario.spawnIsDefault')}</span>}
              <button
                type="button"
                className="config-button"
                disabled={locked || view.spawnIsDefault[robot]}
                onClick={() => onEdit(resetSpawn(scenario, robot), null, null, SPAWN_AXES.map(a => spawnFieldKey(robot, a)))}
              >
                <RotateCcw />
                {t(lang, 'scenario.spawnDefault')}
              </button>
            </div>
            <div className="form-grid spawn-fields">
              {SPAWN_AXES.map(axis => (
                <NumberField
                  key={axis}
                  id={`scenario-${robot}-spawn-${axis}`}
                  label={axis === 'heading' ? t(lang, 'scenario.heading') : AXIS_LABEL[axis]}
                  spec={SPAWN_FIELD_SPECS[axis]}
                  value={view.spawn[robot][axis]}
                  invalidText={fieldText[spawnFieldKey(robot, axis)]}
                  unit={unit}
                  lang={lang}
                  disabled={locked}
                  onValue={v => onEdit(setSpawnAxis(scenario, view, robot, axis, v), spawnFieldKey(robot, axis), null)}
                  onInvalid={text => onEdit(null, spawnFieldKey(robot, axis), text)}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="settings-row">
          <span className="settings-note">{t(lang, 'scenario.spawnHint')}</span>
          {editOnFieldButton}
        </div>
      </Section>

      <Section title={t(lang, 'scenario.section.rp')}>
        <div className={`scenario-group rp-group${red.has('rp') ? ' has-error' : ''}`}>
          <div className="spawn-head">
            {view.rpIsDefault && <span className="spawn-tag">{t(lang, 'scenario.rpIsDefault')}</span>}
            <button
              type="button"
              className="config-button"
              disabled={locked || (view.rpIsDefault && RP_KEYS.every(k => fieldText[rpFieldKey(k)] === undefined))}
              onClick={() => onEdit(resetRpThresholds(scenario), null, null, RP_KEYS.map(rpFieldKey))}
            >
              <RotateCcw />
              {t(lang, 'scenario.spawnDefault')}
            </button>
          </div>
          <div className="form-grid rp-fields">
            {RP_KEYS.map(key => (
              <NumberField
                key={key}
                id={`scenario-rp-${key}`}
                label={t(lang, `scenario.rp.${key}`)}
                spec={RP_FIELD_SPEC}
                value={view.rpThresholds[key]}
                invalidText={fieldText[rpFieldKey(key)]}
                unit={unit}
                lang={lang}
                disabled={locked}
                onValue={v => onEdit(setRpThreshold(scenario, view, key, v), rpFieldKey(key), null)}
                onInvalid={text => onEdit(null, rpFieldKey(key), text)}
              />
            ))}
          </div>
          {warnings.map(code => (
            <p key={code} className="form-warning" role="status">
              {t(lang, `warning.${code}`, { points: view.rpThresholds.swarmPoints, max: SWARM_MAX_POINTS })}
            </p>
          ))}
          <p className="settings-note">{t(lang, 'scenario.rpHint')}</p>
        </div>
      </Section>

      <Section title={t(lang, 'scenario.section.seed')}>
        <div className="seed-row">
          <NumberField
            id="scenario-seed"
            label={t(lang, 'scenario.seed')}
            spec={SEED_FIELD_SPEC}
            value={view.seed}
            invalidText={fieldText[SEED_FIELD_KEY]}
            unit={unit}
            lang={lang}
            disabled={locked}
            onValue={v => onEdit(setSeed(scenario, v), SEED_FIELD_KEY, null)}
            onInvalid={text => onEdit(null, SEED_FIELD_KEY, text)}
          />
          <button type="button" className="config-button" disabled={locked} onClick={onReroll}>
            <Dices />
            {t(lang, 'scenario.reroll')}
          </button>
        </div>
        <p className="settings-note">{t(lang, 'scenario.seedHint')}</p>
      </Section>
    </div>
  );
}

/**
 * 로봇 적재물 칸 (FIFO, 0번이 먼저 나감): 칸을 누르면 POLLEN → NECTAR(흡입 가능 로봇만) → 빈 칸 순환, 적재 한도를 넘는 칸은 빨간 테두리.
 * 시나리오 탭과 시나리오 필드 편집 모드의 로봇 팝오버(14-1d)가 함께 쓴다
 */
export function LoadoutSlots({
  robot,
  scenario,
  view,
  config,
  lang,
  disabled,
  onEdit,
}: {
  robot: RobotId;
  scenario: ScenarioConfig;
  view: ScenarioView;
  config: RobotConfig;
  lang: Language;
  disabled?: boolean;
  onEdit: (scenario: ScenarioConfig) => void;
}) {
  const capacity = getCarryCapacity(config);
  const list = view.loadout[robot];
  const slots = Math.max(capacity, list.length);
  const pieceLabel = (piece: PieceType | null) => piece ?? t(lang, 'scenario.slotEmpty');
  return (
    <div className="loadout-slots">
      {Array.from({ length: slots }, (_, i) => {
        const piece = list[i] ?? null;
        const over = i >= capacity;
        const label = `${t(lang, 'scenario.slot', { n: i + 1, piece: pieceLabel(piece) })}${over ? ` (${t(lang, 'scenario.slotOver')})` : ''}`;
        return (
          <button
            key={i}
            type="button"
            className={`loadout-slot is-${piece ? piece.toLowerCase() : 'empty'}${piece === 'NECTAR' ? ` is-${view.alliance.toLowerCase()}` : ''}${over ? ' is-over' : ''}`}
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={() => onEdit(setLoadoutSlot(scenario, view, robot, i, nextSlotPiece(piece, config.canIntakeNectar)))}
          >
            <span className="loadout-index">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
