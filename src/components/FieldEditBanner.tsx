// 필드 편집 모드 안내 띠 (명세서 3.8 필드 편집 모드, 09-10b): 필드 위쪽 중앙. 모드 이름 + 조작 + DONE, Esc = 닫기.
// 기준 CELL 쪽 명중 띠를 가리지 않게 BLUE(기준 BLUE_OPPOSITE, 띠가 필드 위쪽)면 필드 아래쪽에 둔다.
// 히트맵 모드: 기물 종류 전환(POLLEN / NECTAR), 명중률 범례(진영 파스텔 척도), 기준 CELL, 생성 중 / 적용 대기 안내.
import { Check, Map as MapIcon } from 'lucide-react';
import { sweetSpotBasisCell } from '../core/ballistics';
import { heatmapGradientCss } from '../renderer/heatmapView';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import type { FieldEdit } from '../ui/fieldEdit';
import { lutStateText } from '../ui/lutView';
import type { RobotLutView } from '../ui/lutView';
import { robotLabel } from '../ui/mainScreenModel';
import type { LUTPieceType as PieceType } from '../workers/lutProtocol';
import { Segmented } from './FormControls';

const PIECES: readonly PieceType[] = ['POLLEN', 'NECTAR'];

export default function FieldEditBanner({
  edit,
  alliance,
  lut,
  pendingApply,
  lang,
  onPiece,
  onDone,
}: {
  edit: FieldEdit;
  alliance: 'RED' | 'BLUE';
  lut: RobotLutView;
  pendingApply: boolean;
  lang: Language;
  onPiece: (piece: PieceType) => void;
  onDone: () => void;
}) {
  const key = sweetSpotBasisCell(alliance);
  return (
    <div className={`field-edit-banner${alliance === 'BLUE' ? ' is-bottom' : ''}`} role="region" aria-label={t(lang, 'edit.heatmap.title', { robot: robotLabel(edit.robot) })} onClick={e => e.stopPropagation()}>
      <div className="field-edit-head">
        <MapIcon />
        <span className="field-edit-title">{t(lang, 'edit.heatmap.title', { robot: robotLabel(edit.robot) })}</span>
        <Segmented value={edit.piece} options={PIECES} label={p => p} onChange={onPiece} ariaLabel={t(lang, 'edit.legend')} />
        <button type="button" className="config-button is-primary" onClick={onDone}>
          <Check />
          {t(lang, 'edit.done')}
        </button>
      </div>
      <div className="field-edit-legend">
        <span>{t(lang, 'edit.legend')}</span>
        <span className="legend-end">0%</span>
        <span className="legend-bar" style={{ background: heatmapGradientCss(alliance) }} aria-hidden />
        <span className="legend-end">100%</span>
        <span className="field-edit-basis">{t(lang, 'robot.sweetSpotBasis', { key })}</span>
      </div>
      <div className="field-edit-hint">
        {lut.phase !== 'READY' && <span className="field-edit-state">{lutStateText(lut, lang)}</span>}
        {pendingApply && <span className="field-edit-state">{t(lang, 'lut.pendingApply')}</span>}
        <span>{t(lang, 'edit.heatmap.hint', { key })}</span>
        <span className="field-edit-esc">{t(lang, 'edit.escClose')}</span>
      </div>
    </div>
  );
}
