// 필드 위쪽 중앙 알림 (명세서 3.8 필드 영역, 09-7b): 자동 일시정지 배너(일시정지 동안 유지) + 경고 토스트(약 1.5초 후 흐려지며 사라짐)
// 10-4: 불러온 경기의 체크섬 불일치 배너 (닫기 가능, NEW에서 사라짐)
import { CircleAlert, TriangleAlert, X } from 'lucide-react';
import type { PauseReason } from '../input/realtimeLoop';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { robotLabel } from '../ui/mainScreenModel';

export interface ToastItem {
  id: number;
  robot: 'robot1' | 'robot2';
  leaving: boolean;
}

export default function FieldNotices({
  autoPauseReason,
  toasts,
  lang,
  matchNotice,
  onDismissMatchNotice,
}: {
  autoPauseReason: Exclude<PauseReason, 'USER'> | null;
  matchNotice: { title: string; hint: string } | null;
  onDismissMatchNotice: () => void;
  toasts: readonly ToastItem[];
  lang: Language;
}) {
  return (
    <div className="field-notices" aria-live="polite">
      {matchNotice && (
        <div className="pause-banner match-notice" role="status">
          <TriangleAlert />
          <div>
            <div className="pause-banner-title">{matchNotice.title}</div>
            <div className="pause-banner-hint">{matchNotice.hint}</div>
          </div>
          <button type="button" className="icon-button match-notice-close" title={t(lang, 'matchImport.dismiss')} aria-label={t(lang, 'matchImport.dismiss')} onClick={onDismissMatchNotice}>
            <X />
          </button>
        </div>
      )}
      {autoPauseReason && (
        <div className="pause-banner" role="status">
          <CircleAlert />
          <div>
            <div className="pause-banner-title">{t(lang, `pause.${autoPauseReason}`)}</div>
            <div className="pause-banner-hint">{t(lang, 'pause.resumeHint')}</div>
          </div>
        </div>
      )}
      {toasts.map(toast => (
        <div key={toast.id} className={`lift-toast${toast.leaving ? ' is-leaving' : ''}`} role="alert">
          <TriangleAlert />
          <span>
            {robotLabel(toast.robot)} · {t(lang, 'toast.lowerLift')}
          </span>
        </div>
      ))}
    </div>
  );
}
