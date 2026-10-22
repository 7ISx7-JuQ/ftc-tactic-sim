// 시나리오 필드 편집 팝오버 (명세서 3.8 필드 편집 모드, 14-1c): 필드에서 누른 대상 옆의 작은 창.
// HIVE = 상향 셀 + 상향 셀 POLLEN / NECTAR 개수 + TIP 임계 안내, FLOWER k = POLLEN 개수, GARDEN 우리 / 상대 = POLLEN 개수,
// 로봇(14-1d, 끌지 않고 클릭) = 적재물 칸(탭과 같은 순환) + 오토 이동 NONE / LEAVE / PARK / LEAVE_PARK + 그 로봇의 문제(빨강).
// 시나리오 탭과 같은 고치기 함수 / 범위 / 빨간 표시를 쓰고, 값은 탭과 같이 초안으로 (되돌리기 기록 포함 — MainScreen이 처리).
// 위치: 캔버스와 같은 크기의 글자 층에서 대상 가운데 기준, 필드 위쪽 절반이면 아래로 / 아래쪽 절반이면 위로 펼치고, 필드 밖으로 나가지 않게 가로로 밀어 넣는다.
import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { hiveTipPollenThreshold } from '../core/types';
import type { ScenarioConfig } from '../core/types';
import type { ScenarioTarget } from '../ui/fieldEdit';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { AUTO_MOVEMENTS, COUNT_LIMITS, setAutoMovement, setFlowerCount, setGardenCount, setHivePieces, setUpwardCell } from '../ui/scenarioForm';
import type { RobotId } from '../input/inputConfig';
import { robotLabel } from '../ui/mainScreenModel';
import type { RobotProfile } from '../ui/robotForm';
import { LoadoutSlots } from './ScenarioTab';
import type { HiveCellChoice, ScenarioFieldGroup, ScenarioView } from '../ui/scenarioForm';
import { Segmented, Stepper } from './FormControls';

const POPOVER_EDGE_PX = 6; // 필드 가장자리와 띄우는 간격
const POPOVER_GAP_PX = 14; // 대상과 띄우는 간격 (1366 × 650 필드 약 558 px 기준, 필드 크기에 비례)

export default function ScenarioFieldPopover({
  target,
  scenario,
  view,
  red,
  robots,
  issues,
  at,
  lang,
  onEdit,
  onClose,
}: {
  target: ScenarioTarget;
  scenario: ScenarioConfig;
  view: ScenarioView;
  red: ReadonlySet<ScenarioFieldGroup>; // 검증에 걸린 칸 묶음 (탭과 같음)
  robots: Readonly<Record<RobotId, RobotProfile>>; // 로봇 초안 (팀 번호 / 적재 한도 / NECTAR 흡입, 14-1d)
  issues: readonly string[];          // 로봇 팝오버에 보일 그 로봇의 문제 문구 (적재물 / 오토 이동)
  at: { leftPct: number; topPct: number; below: boolean }; // 대상 가운데의 장면 비율(%, 캔버스 크기 글자 층 기준), 아래로 펼침 여부
  lang: Language;
  onEdit: (scenario: ScenarioConfig) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 필드(글자 층) 밖으로 나가지 않게 가로 / 세로 위치를 밀어 넣음 (렌더 뒤 크기를 재서 DOM에 바로 — 상태 없음)
  useLayoutEffect(() => {
    const el = ref.current;
    const layer = el?.offsetParent as HTMLElement | null;
    if (!el || !layer) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    const { clientWidth: layerW, clientHeight: layerH } = layer;
    const x = (at.leftPct / 100) * layerW;
    const y = (at.topPct / 100) * layerH;
    const gap = POPOVER_GAP_PX * (layerW / 558);
    const clamp = (v: number, max: number) => Math.min(Math.max(v, POPOVER_EDGE_PX), Math.max(POPOVER_EDGE_PX, max - POPOVER_EDGE_PX));
    el.style.left = `${clamp(x - width / 2, layerW - width)}px`;
    el.style.top = `${clamp(at.below ? y + gap : y - gap - height, layerH - height)}px`;
  });
  const title =
    target.kind === 'HIVE'
      ? 'HIVE'
      : target.kind === 'FLOWER'
        ? t(lang, 'scenario.flower', { n: target.index + 1 })
        : target.kind === 'GARDEN'
          ? t(lang, target.side === 'ally' ? 'scenario.gardenAlly' : 'scenario.gardenOpponent')
          : robotLabel(target.robot, robots[target.robot].teamNumber);
  return (
    <div
      ref={ref}
      className="field-popover"
      style={{ left: `${at.leftPct}%`, top: `${at.topPct}%` }}
      role="dialog"
      aria-label={title}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="field-popover-head">
        <span className="field-popover-title">{title}</span>
        <button type="button" className="icon-button field-popover-close" title={t(lang, 'edit.popoverClose')} aria-label={t(lang, 'edit.popoverClose')} onClick={onClose}>
          <X />
        </button>
      </div>
      {target.kind === 'HIVE' && (
        <div className={`scenario-group${red.has('hive') ? ' has-error' : ''}`}>
          <Segmented
            value={view.hiveUpwardCell}
            options={['AUDIENCE_CELL', 'OPPOSITE_CELL'] as readonly HiveCellChoice[]}
            label={c => t(lang, `scenario.cell.${c}`)}
            onChange={c => onEdit(setUpwardCell(scenario, c))}
            ariaLabel={t(lang, 'scenario.upwardCell')}
          />
          <div className="field-popover-row">
            <Stepper label={t(lang, 'scenario.hivePollen')} value={view.hivePollen} min={0} max={COUNT_LIMITS.hivePollen} invalid={red.has('hive')} lang={lang} onChange={v => onEdit(setHivePieces(scenario, { pollenCount: v }))} />
            <Stepper label={t(lang, 'scenario.hiveNectar')} value={view.hiveNectar} min={0} max={COUNT_LIMITS.hiveNectar} invalid={red.has('hive')} lang={lang} onChange={v => onEdit(setHivePieces(scenario, { nectarCount: v }))} />
          </div>
          <p className="settings-note">{t(lang, 'scenario.tipThreshold', { nectarCount: view.hiveNectar, threshold: hiveTipPollenThreshold(view.hiveNectar) })}</p>
        </div>
      )}
      {target.kind === 'FLOWER' && (
        <Stepper
          label={t(lang, 'edit.popoverPollen')}
          value={view.flowers[target.index]}
          min={0}
          max={COUNT_LIMITS.flower}
          invalid={red.has(`flower.${target.index}`)}
          lang={lang}
          onChange={v => onEdit(setFlowerCount(scenario, view, target.index, v))}
        />
      )}
      {target.kind === 'ROBOT' && (
        <>
          <div className={`field-popover-section${red.has(`loadout.${target.robot}`) ? ' has-error' : ''}`}>
            <span className="form-label">{t(lang, 'scenario.section.loadout')}</span>
            <LoadoutSlots robot={target.robot} scenario={scenario} view={view} config={robots[target.robot].config} lang={lang} onEdit={onEdit} />
          </div>
          <div className={`field-popover-section${red.has(`autoMove.${target.robot}`) ? ' has-error' : ''}`}>
            <span className="form-label">{t(lang, 'scenario.autoMovement')}</span>
            <Segmented
              value={view.autoMovement[target.robot]}
              options={AUTO_MOVEMENTS}
              label={m => t(lang, `scenario.autoMovement.${m}`)}
              onChange={m => onEdit(setAutoMovement(scenario, target.robot, m))}
              ariaLabel={t(lang, 'scenario.autoMovement')}
            />
            <span className="settings-note">{t(lang, 'scenario.autoMovementHint')}</span>
          </div>
          {issues.map((text, i) => (
            <span key={i} className="form-error">
              {text}
            </span>
          ))}
        </>
      )}
      {target.kind === 'GARDEN' && (
        <Stepper
          label={t(lang, 'edit.popoverPollen')}
          value={view.garden[target.side]}
          min={0}
          max={COUNT_LIMITS.garden}
          invalid={red.has(`garden.${target.side}`)}
          lang={lang}
          onChange={v => onEdit(setGardenCount(scenario, view, target.side, v))}
        />
      )}
    </div>
  );
}
