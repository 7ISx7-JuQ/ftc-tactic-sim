// 필드 편집 모드 안내 띠 (명세서 3.8 필드 편집 모드, 09-10b / 09-10c): 필드 위쪽 중앙. 모드 이름 + 조작 + 버튼.
// 기준 CELL 쪽 명중 띠를 가리지 않게 BLUE(기준 BLUE_OPPOSITE, 띠가 필드 위쪽)면 필드 아래쪽에 둔다.
// 히트맵 모드: 기물 종류 전환(POLLEN / NECTAR), 명중률 범례(진영 파스텔 척도), 기준 CELL, 생성 중 / 적용 대기 안내, DONE / Esc = 닫기.
// 스윗스팟 모드: 같은 범례 + 초안 스윗스팟 좌표 / 검증 사유(빨강) / 반투명 확률표가 적용한 스윗스팟 기준이라는 안내,
//   CANCEL(Esc) = 들어오기 전 값으로, DONE · APPLY = 그 로봇 탭 적용.
import { Check, Crosshair, Map as MapIcon, Move, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { sweetSpotBasisCell } from '../core/ballistics';
import { heatmapGradientCss } from '../renderer/heatmapView';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import type { HeatmapFieldEdit, SweetSpotFieldEdit } from '../ui/fieldEdit';
import { lutStateText } from '../ui/lutView';
import type { RobotLutView } from '../ui/lutView';
import { robotLabel } from '../ui/mainScreenModel';
import { formatQuantity } from '../ui/units';
import type { LengthUnit } from '../ui/units';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import { Segmented } from './FormControls';

const PIECES: readonly PieceType[] = ['POLLEN', 'NECTAR'];

export interface SweetSpotBannerInfo {
  spot: { x: number; y: number };   // 초안 스윗스팟 (진영 기준)
  issues: readonly string[];        // 초안 스윗스팟 검증 사유 코드
  heatmapStale: boolean;            // 반투명 확률표가 초안과 다른(적용한) 설정 기준
}

export default function FieldEditBanner({
  edit,
  alliance,
  lut,
  pendingApply,
  sweetSpot,
  unit,
  lang,
  onPiece,
  onDone,
  onCancel,
}: {
  edit: HeatmapFieldEdit | SweetSpotFieldEdit;
  alliance: 'RED' | 'BLUE';
  lut: RobotLutView;
  pendingApply: boolean;
  sweetSpot: SweetSpotBannerInfo | null;
  unit: LengthUnit;
  lang: Language;
  onPiece: (piece: PieceType) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const key = sweetSpotBasisCell(alliance);
  const isSpot = edit.mode === 'SWEET_SPOT';
  const title = t(lang, isSpot ? 'edit.sweetSpot.title' : 'edit.heatmap.title', { robot: robotLabel(edit.robot) });
  return (
    <div className={`field-edit-banner${alliance === 'BLUE' ? ' is-bottom' : ''}`} role="region" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="field-edit-head">
        {isSpot ? <Crosshair /> : <MapIcon />}
        <span className="field-edit-title">{title}</span>
        {isSpot && (
          <button type="button" className="config-button" onClick={onCancel}>
            <X />
            {t(lang, 'edit.cancel')}
          </button>
        )}
        <button type="button" className="config-button is-primary" onClick={onDone}>
          <Check />
          {t(lang, isSpot ? 'edit.doneApply' : 'edit.done')}
        </button>
      </div>
      <div className="field-edit-legend">
        <Segmented value={edit.piece} options={PIECES} label={p => p} onChange={onPiece} ariaLabel={t(lang, 'edit.legend')} />
        <span>{t(lang, 'edit.legend')}</span>
        <span className="legend-end">0%</span>
        <span className="legend-bar" style={{ background: heatmapGradientCss(alliance) }} aria-hidden />
        <span className="legend-end">100%</span>
        <span className="field-edit-basis">{t(lang, 'robot.sweetSpotBasis', { key })}</span>
      </div>
      {sweetSpot && (
        <div className="field-edit-spot">
          <span className="field-edit-coord">
            {t(lang, 'edit.sweetSpot.current', { x: formatQuantity('coordinate', sweetSpot.spot.x, unit), y: formatQuantity('coordinate', sweetSpot.spot.y, unit) })}
          </span>
          {sweetSpot.issues.map(code => (
            <span key={code} className="form-error">
              {t(lang, `issue.${code}` as MessageKey)}
            </span>
          ))}
        </div>
      )}
      <div className="field-edit-hint">
        {lut.phase !== 'READY' && <span className="field-edit-state">{lutStateText(lut, lang)}</span>}
        {isSpot ? sweetSpot?.heatmapStale && <span className="field-edit-state">{t(lang, 'edit.sweetSpot.heatmapNote')}</span> : pendingApply && <span className="field-edit-state">{t(lang, 'lut.pendingApply')}</span>}
        <span>{t(lang, isSpot ? 'edit.sweetSpot.hint' : 'edit.heatmap.hint', { key })}</span>
        <span className="field-edit-esc">{t(lang, isSpot ? 'edit.escCancel' : 'edit.escClose')}</span>
      </div>
    </div>
  );
}

/** 스윗스팟 모드: 마우스를 올린 칸 위 말풍선 — 좌표(진영 기준) + 찍으면 생기는 검증 사유(빨강) */
export function SweetSpotHoverTip({
  at,
  issues,
  unit,
  lang,
}: {
  at: { cell: { x: number; y: number }; left: number; top: number };
  issues: readonly string[];
  unit: LengthUnit;
  lang: Language;
}) {
  return (
    <div className={`sweet-hover${issues.length > 0 ? ' is-invalid' : ''}`} style={{ left: at.left, top: at.top }} aria-hidden>
      <span className="sweet-hover-coord">
        X {formatQuantity('coordinate', at.cell.x, unit)} · Y {formatQuantity('coordinate', at.cell.y, unit)}
      </span>
      {issues.map(code => (
        <span key={code} className="sweet-hover-issue">
          {t(lang, `issue.${code}` as MessageKey)}
        </span>
      ))}
    </div>
  );
}

/**
 * 시작 자세 모드 안내 띠 (09-11b): 모드 이름 + CANCEL / DONE · APPLY, 배치 검증 사유(빨강), 조작 안내 + Esc.
 * 로봇이 필드 양쪽 벽에 붙어 있어 가운데 위쪽은 비므로 늘 필드 위쪽
 */
export function SpawnEditBanner({ issues, lang, onDone, onCancel }: { issues: readonly string[]; lang: Language; onDone: () => void; onCancel: () => void }) {
  const title = t(lang, 'edit.spawn.title');
  return (
    <div className="field-edit-banner" role="region" aria-label={title} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <div className="field-edit-head">
        <Move />
        <span className="field-edit-title">{title}</span>
        <button type="button" className="config-button" onClick={onCancel}>
          <X />
          {t(lang, 'edit.cancel')}
        </button>
        <button type="button" className="config-button is-primary" onClick={onDone}>
          <Check />
          {t(lang, 'edit.doneApply')}
        </button>
      </div>
      {issues.length > 0 && (
        <div className="field-edit-spot">
          {issues.map(text => (
            <span key={text} className="form-error">
              {text}
            </span>
          ))}
        </div>
      )}
      <div className="field-edit-hint">
        <span>{t(lang, 'edit.spawn.hint')}</span>
        <span className="field-edit-esc">{t(lang, 'edit.escCancel')}</span>
      </div>
    </div>
  );
}

/** 시작 자세 모드: 로봇 위 좌표 / 헤딩 글자 (문제면 빨간 테두리) */
export function SpawnPoseTag({ at, label, pose, bad, unit }: { at: { left: string; top: string }; label: string; pose: { x: number; y: number; heading: number }; bad: boolean; unit: LengthUnit }) {
  return (
    // 가로 기준점을 위치 비율만큼 옮겨(왼쪽 벽 = 글자 왼쪽 끝, 가운데 = 가운데) 필드 가장자리에서 잘리지 않게
    <div className={`spawn-pose-tag${bad ? ' is-invalid' : ''}`} style={{ left: at.left, top: at.top, '--tx': `-${at.left}` } as CSSProperties} aria-hidden>
      <b>{label}</b> {formatQuantity('coordinate', pose.x, unit)} · {formatQuantity('coordinate', pose.y, unit)} · {formatQuantity('heading', pose.heading, unit)}
    </div>
  );
}
