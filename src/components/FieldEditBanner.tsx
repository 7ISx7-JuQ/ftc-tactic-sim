// 필드 편집 모드 안내 띠 (명세서 3.8 필드 편집 모드, 09-10b / 09-10c): 필드 위쪽 중앙. 모드 이름 + 조작 + 버튼.
// 기준 CELL 쪽 명중 띠를 가리지 않게 BLUE(기준 BLUE_OPPOSITE, 띠가 필드 위쪽)면 필드 아래쪽에 둔다.
// 히트맵 모드: 기물 종류 전환(POLLEN / NECTAR), 명중률 범례(진영 파스텔 척도), 기준 CELL, 생성 중 / 적용 대기 안내, DONE / Esc = 닫기.
// 스윗스팟 모드: 같은 범례 + 초안 스윗스팟 좌표 / 검증 사유(빨강) / 반투명 확률표가 적용한 스윗스팟 기준이라는 안내,
//   CANCEL(Esc) = 들어오기 전 값으로, DONE · APPLY = 그 로봇 탭 적용.
import { Check, Crosshair, Map as MapIcon, X } from 'lucide-react';
import { sweetSpotBasisCell } from '../core/ballistics';
import { heatmapGradientCss } from '../renderer/heatmapView';
import { t } from '../ui/i18n';
import type { Language, MessageKey } from '../ui/i18n';
import type { FieldEdit } from '../ui/fieldEdit';
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
  edit: FieldEdit;
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
