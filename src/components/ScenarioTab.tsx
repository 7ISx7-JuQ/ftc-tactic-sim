// 시나리오 탭 (명세서 3.8 시나리오 탭, 2.4 텔레옵 시작 조건, 09-11a): 유효 배지 + 진영 / HIVE / 로봇 적재물 / 잔여 기물 / 오토 TIP /
// 시작 자세 숫자 칸 / 난수 시드. 값은 초안에만 들어가고 APPLY로 확정한다 (시드 REROLL만 바로 적용 — 09-11 확정). 경기가 있는 동안 읽기 전용.
// 필드에서 끌어 시작 자세 정하기(EDIT ON FIELD)는 09-11b.
import { CircleAlert, CircleCheck, Dices, RotateCcw } from 'lucide-react';
import { hiveTipPollenThreshold } from '../core/types';
import type { RobotPose, ScenarioConfig } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import { robotLabel } from '../ui/mainScreenModel';
import type { RobotProfile } from '../ui/robotForm';
import {
  COUNT_LIMITS,
  SPAWN_AXES,
  SPAWN_FIELD_SPECS,
  floorSummary,
  issueFieldSet,
  nextSlotPiece,
  readScenario,
  resetSpawn,
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
import type { HiveCellChoice, PieceType, ScenarioFormIssue } from '../ui/scenarioForm';
import { getCarryCapacity } from '../core/simulationEngine';
import type { LengthUnit } from '../ui/units';
import { NumberField, Section, Segmented, Stepper } from './FormControls';

const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];
const AXIS_LABEL: Readonly<Record<keyof RobotPose, string>> = { x: 'X', y: 'Y', heading: '' };

export interface ScenarioTabProps {
  scenario: ScenarioConfig;                         // 초안
  robots: Record<RobotId, RobotProfile>;            // 로봇 초안 (적재 한도 / NECTAR 흡입 / 몸체 크기)
  seed: number;                                     // 지금 경기 시드 (적용 값)
  fieldText: Readonly<Record<string, string>>;      // 틀린 입력 글자
  issues: readonly ScenarioFormIssue[];
  unit: LengthUnit;
  lang: Language;
  locked: boolean;
  /** 초안 편집: 새 시나리오(없으면 값은 그대로) + 칸 키가 있으면 그 칸의 틀린 글자(null = 지움) + 함께 지울 칸 글자 */
  onEdit: (scenario: ScenarioConfig | null, key: string | null, invalidText: string | null, clearKeys?: readonly string[]) => void;
  onReroll: () => void;
}

const ALL_SPAWN_KEYS = ROBOTS.flatMap(r => SPAWN_AXES.map(a => spawnFieldKey(r, a)));

export default function ScenarioTab({ scenario, robots, seed, fieldText, issues, unit, lang, locked, onEdit, onReroll }: ScenarioTabProps) {
  const view = readScenario(scenario, robots.robot1.config, robots.robot2.config);
  const red = issueFieldSet(issues);
  const typoCount = Object.keys(fieldText).length;
  const problems = issues.length + typoCount;
  const edit = (next: ScenarioConfig) => onEdit(next, null, null);
  const floor = floorSummary(view);
  const issueText = (issue: ScenarioFormIssue) => {
    const label = issue.robot ? robotLabel(issue.robot) : '';
    const key = `issue.${issue.code}` as MessageKey;
    const text = t(lang, key, { robot: label });
    // 로봇별 문제인데 문구에 로봇 이름이 없으면(적재물) 앞에 붙임
    return issue.robot && !text.includes(label) ? `${label} · ${text}` : text;
  };
  const pieceLabel = (piece: PieceType | null) => piece ?? t(lang, 'scenario.slotEmpty');

  return (
    <div className="scenario-tab">
      <div className={`scenario-badge ${problems === 0 ? 'is-valid' : 'is-invalid'}`} role="status">
        {problems === 0 ? <CircleCheck /> : <CircleAlert />}
        <span>{problems === 0 ? t(lang, 'scenario.valid') : t(lang, 'scenario.invalid', { count: problems })}</span>
      </div>
      {issues.length > 0 && (
        <ul className="scenario-issues">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${issue.robot ?? ''}-${i}`} className="form-error">
              {issueText(issue)}
            </li>
          ))}
        </ul>
      )}

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
        {ROBOTS.map(robot => {
          const config = robots[robot].config;
          const capacity = getCarryCapacity(config);
          const list = view.loadout[robot];
          const slots = Math.max(capacity, list.length);
          return (
            <div key={robot} className={`loadout-row${red.has(`loadout.${robot}`) ? ' has-error' : ''}`}>
              <span className="loadout-robot">{robotLabel(robot)}</span>
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
                      disabled={locked}
                      onClick={() => edit(setLoadoutSlot(scenario, view, robot, i, nextSlotPiece(piece, config.canIntakeNectar)))}
                    >
                      <span className="loadout-index">{i + 1}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
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
        <p className="settings-note">{t(lang, 'scenario.floorSummary', { floorPollen: floor.floorPollen, floorNectar: floor.floorNectar, stock: floor.stock })}</p>
      </Section>

      <Section title={t(lang, 'scenario.section.autoTip')}>
        <Stepper label={t(lang, 'scenario.section.autoTip')} value={view.autoTipCount} min={0} max={COUNT_LIMITS.autoTip} disabled={locked} invalid={red.has('autoTip')} lang={lang} onChange={v => edit(setAutoTipCount(scenario, v))} />
        <p className="settings-note">{t(lang, 'scenario.autoTipHint')}</p>
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
        <p className="settings-note">{t(lang, 'scenario.spawnHint')}</p>
      </Section>

      <Section title={t(lang, 'scenario.section.seed')}>
        <div className="settings-row">
          <span className="seed-value">{seed}</span>
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
