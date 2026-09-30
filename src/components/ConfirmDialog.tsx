// 확인창 (명세서 3.8, 09-7b): 필드 위 중앙 어두운 모달 + 뒤 흐림. Enter = 확인, Esc = 취소 (열린 동안 컨트롤러 단축키는 꺼짐)
// 결과 팝업 위에서도 열릴 수 있도록(RESTART) 화면 전체를 덮고, 상자는 필드 영역 중앙(anchor)에 둔다.
// 10-6: 취소 문구가 없으면 확인 버튼 하나인 안내창 (가지 가득 참). Esc는 그대로 닫기.
import { useEffect, useRef } from 'react';

export interface ConfirmRequest {
  message: string;
  okLabel: string;
  cancelLabel: string | null; // null = 안내창 (확인 버튼만)
}

export default function ConfirmDialog({
  request,
  anchor,
  onClose,
}: {
  request: ConfirmRequest;
  anchor: { x: number; y: number } | null; // 필드 영역 중앙 (뷰포트 좌표), 없으면 화면 중앙
  onClose: (ok: boolean) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closeRef.current(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current(false);
      } else if (e.code === 'Space') {
        e.preventDefault(); // 초점 버튼을 Space로 누르지 않음 (Space는 게임 단축키)
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const style = anchor ? { left: anchor.x, top: anchor.y } : { left: '50%', top: '50%' };
  return (
    <div className="confirm-backdrop" onClick={e => e.stopPropagation()}>
      <div ref={boxRef} className="confirm-box" style={style} role="alertdialog" aria-modal="true" aria-describedby="confirm-message" tabIndex={-1}>
        <p id="confirm-message" className="confirm-message">{request.message}</p>
        <div className="confirm-actions">
          {request.cancelLabel !== null && (
            <button type="button" className="confirm-button" onClick={() => onClose(false)}>
              {request.cancelLabel}
              <kbd>Esc</kbd>
            </button>
          )}
          <button type="button" className="confirm-button is-primary" onClick={() => onClose(true)}>
            {request.okLabel}
            <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
