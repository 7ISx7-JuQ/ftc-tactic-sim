// 명중 확률표(LUT) 상태 (명세서 3.8 로봇 제원 탭 "스윗스팟 → LUT", 09-10a): 적용한 설정의 생성 상태 / 진행 막대 / 남은 시간,
// 기물별 발사 속도 · 스윗스팟 명중률(0이면 경고, 적용은 막지 않음 — 09-10 확정), 오류면 다시 시도, 초안이 다르면 "적용하면 새로 만듦".
import { RotateCcw } from 'lucide-react';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { lutStateText } from '../ui/lutView';
import type { RobotLutView } from '../ui/lutView';
import { formatNumber, formatQuantity } from '../ui/units';
import type { LengthUnit } from '../ui/units';

const PIECES = ['POLLEN', 'NECTAR'] as const;

export default function LutStatus({
  lut,
  unit,
  lang,
  pendingApply,
  locked,
  onRetry,
}: {
  lut: RobotLutView;
  unit: LengthUnit;
  lang: Language;
  pendingApply: boolean;
  locked: boolean;
  onRetry: () => void;
}) {
  const working = lut.phase === 'WORKING';
  return (
    <div className={`lut-status is-${lut.phase.toLowerCase()}`} role="status">
      <div className="lut-head">
        <span className="lut-title">{t(lang, 'lut.title')}</span>
        <span className="lut-state">{lutStateText(lut, lang)}</span>
        {lut.phase === 'ERROR' && (
          <button type="button" className="config-button" disabled={locked} onClick={onRetry}>
            <RotateCcw />
            {t(lang, 'lut.retry')}
          </button>
        )}
      </div>
      {working && (
        <div className="lut-bar" aria-hidden>
          <div className="lut-bar-fill" style={{ width: `${lut.progress * 100}%` }} />
        </div>
      )}
      {PIECES.map(piece => {
        const v0 = lut.v0[piece];
        if (lut.searched[piece] && v0 !== null) {
          const rate = lut.hitRate[piece];
          return (
            <div key={piece} className="lut-piece">
              <span>{t(lang, 'lut.piece', { piece, v0: formatQuantity('speed', v0, unit), rate: `${formatNumber(rate * 100, 1)}%` })}</span>
              {rate === 0 && <span className="form-warn">{t(lang, 'lut.zeroHitRate')}</span>}
            </div>
          );
        }
        return working ? (
          <div key={piece} className="lut-piece is-pending">
            {t(lang, 'lut.pieceSearching', { piece })}
          </div>
        ) : null;
      })}
      {pendingApply && <p className="settings-note lut-pending">{t(lang, 'lut.pendingApply')}</p>}
    </div>
  );
}
