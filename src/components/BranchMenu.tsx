// 가지 버튼 + 가지 목록 (명세서 3.9 분기 트리 "가지 선택", 10-6): 스크러버 줄에서 위로 펼치는 목록.
// 줄 = 깊이 들여쓰기 + 이름(누르면 전환) / 분기 시각 / 상태(종료 = 점수, 미종료 = 머리 시각) / 지금 가지 표시 / 이름 바꾸기 / 삭제(원본 제외).
// 일시정지 / 복기 중에만 열리고, 열 수 없는 상태가 되면 닫힌다. 바깥 클릭 / Esc로 닫기. 삭제 확인창은 MainScreen.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, GitFork, Pencil, Trash2 } from 'lucide-react';
import type { AppStatus } from '../app/appController';
import { BRANCH_NAME_MAX_LENGTH } from '../app/branchTree';
import { branchLabel, branchRows, currentBranchInfo } from '../ui/branchView';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';

export interface BranchActions {
  switchBranch: (id: number) => void;
  renameBranch: (id: number, name: string) => void;
  deleteBranch: (id: number) => void; // 확인창은 호출하는 쪽
}

export default function BranchMenu({ status, lang, enabled, actions }: { status: AppStatus; lang: Language; enabled: boolean; actions: BranchActions }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = open && enabled;

  // 바깥 클릭 / Esc로 닫기
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, editing]);

  const current = currentBranchInfo(status);
  const commit = () => {
    if (editing) actions.renameBranch(editing.id, editing.text);
    setEditing(null);
  };

  return (
    <div className="branch-menu" ref={rootRef}>
      <button
        type="button"
        className={`text-button branch-button${shown ? ' is-open' : ''}`}
        title={enabled ? t(lang, 'branch.menu') : t(lang, 'branch.locked')}
        aria-haspopup="menu"
        aria-expanded={shown}
        disabled={!enabled}
        onClick={e => {
          e.currentTarget.blur();
          setEditing(null);
          setOpen(o => !o);
        }}
      >
        <GitFork />
        <span className="branch-button-name">{current ? branchLabel(lang, current) : t(lang, 'branch.main')}</span>
        <ChevronUp className="branch-button-caret" />
      </button>
      {shown && (
        <div className="branch-popover" role="menu" aria-label={t(lang, 'branch.menu')}>
          <div className="branch-popover-title">{t(lang, 'branch.menu')}</div>
          <ul className="branch-list">
            {branchRows(lang, status).map(row => (
              <li key={row.id} className={`branch-row${row.current ? ' is-current' : ''}`} style={{ paddingLeft: `calc(var(--u) * ${10 + row.depth * 10})` }}>
                {editing?.id === row.id ? (
                  <input
                    className="branch-name-input"
                    autoFocus
                    value={editing.text}
                    maxLength={BRANCH_NAME_MAX_LENGTH}
                    placeholder={branchLabel(lang, { ...status.branches.find(b => b.id === row.id)!, name: null })}
                    onChange={e => setEditing({ id: row.id, text: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commit();
                      else if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={commit}
                  />
                ) : (
                  <button
                    type="button"
                    className="branch-row-main"
                    role="menuitemradio"
                    aria-checked={row.current}
                    title={row.current ? t(lang, 'branch.current') : undefined}
                    onClick={() => {
                      if (!row.current) actions.switchBranch(row.id);
                      setOpen(false);
                    }}
                  >
                    <span className="branch-row-check">{row.current && <Check />}</span>
                    <span className="branch-row-name">{row.label}</span>
                    <span className="branch-row-fork">{row.forkText}</span>
                    <span className={`branch-row-state${row.ended ? ' is-ended' : ''}`}>{row.stateText}</span>
                  </button>
                )}
                <button type="button" className="icon-button branch-row-icon" title={t(lang, 'branch.rename')} aria-label={t(lang, 'branch.rename')} onClick={() => setEditing({ id: row.id, text: status.branches.find(b => b.id === row.id)?.name ?? '' })}>
                  <Pencil />
                </button>
                <button
                  type="button"
                  className="icon-button branch-row-icon"
                  title={t(lang, 'branch.delete')}
                  aria-label={t(lang, 'branch.delete')}
                  disabled={!row.deletable}
                  onClick={() => actions.deleteBranch(row.id)}
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
