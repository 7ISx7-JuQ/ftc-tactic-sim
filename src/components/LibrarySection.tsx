// 브라우저 안 목록 구역 (명세서 3.8 저장된 시나리오 / 로봇 / 전체 설정, 19-2a · 19-2b): 이름 + 저장(적용 값) / 목록(최근 저장 순) —
// 줄마다 불러오기(초안, 경기 전만) / 이름 바꾸기(그 자리에서, Enter = 확인 · Esc = 취소) / 삭제(확인창은 화면이 띄움).
// 시나리오 = 시나리오 탭 맨 위, 로봇 = 로봇 탭 맨 위(R1 / R2 공용), 전체 설정 = SETTINGS 탭. 종류별 문구 / 설명 줄만 다르다.
import { useState } from 'react';
import { FolderOpen, Pencil, Save, Trash2 } from 'lucide-react';
import type { LibraryItem } from '../app/libraryStore';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { LIBRARY_NAME_MAX, libraryName } from '../ui/library';
import type { LibrarySummary } from '../ui/library';
import type { PresetRow } from '../ui/presetFile';
import { Section } from './FormControls';

export type LibrarySectionKind = 'scenario' | 'robot' | 'setup';

export default function LibrarySection({ kind, row, items, lang, summary: summarize, canSave, canLoad, onSave, onLoad, onRename, onDelete }: {
  kind: LibrarySectionKind;       // 문구 종류
  row: PresetRow;                 // 저장 / 불러오기 대상 줄 (로봇 = 지금 로봇 탭) — 처리 함수에 그대로 넘김
  items: readonly LibraryItem[];  // 최근 저장 순
  lang: Language;
  summary: (item: LibraryItem) => LibrarySummary | null; // 설명 두 줄 (null = 읽을 수 없는 항목)
  canSave: boolean;               // 저장할 탭에 적용 안 된 수정 / 틀린 입력이 없음 (저장 = 적용 값)
  canLoad: boolean;               // 경기 전 (초안은 경기 전에만 편집)
  onSave: (row: PresetRow, name: string) => void;
  onLoad: (row: PresetRow, item: LibraryItem) => void;
  onRename: (item: LibraryItem, name: string) => void;
  onDelete: (item: LibraryItem) => void;
}) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const valid = libraryName(name);
  const save = () => {
    if (!valid || !canSave) return;
    onSave(row, valid);
    setName('');
  };
  const finishRename = (item: LibraryItem) => {
    const next = renaming && libraryName(renaming.text);
    setRenaming(null);
    if (next && next !== item.name) onRename(item, next);
  };

  return (
    <Section title={t(lang, `library.${kind}.title`)}>
      <div className="library-save">
        <input
          className="form-input library-name-input"
          aria-label={t(lang, 'library.name')}
          placeholder={t(lang, `library.${kind}.placeholder`)}
          maxLength={LIBRARY_NAME_MAX}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save();
          }}
        />
        <button type="button" className="config-button" disabled={!valid || !canSave} onClick={save}>
          <Save />
          {t(lang, 'library.saveAs')}
        </button>
      </div>
      <p className="settings-note">{canSave ? t(lang, `library.${kind}.saveHint`) : t(lang, `library.${kind}.applyFirst`)}</p>
      {items.length === 0 ? (
        <p className="settings-note">{t(lang, `library.${kind}.empty`)}</p>
      ) : (
        <ul className="library-list">
          {items.map(item => {
            const summary = summarize(item);
            const editing = renaming?.id === item.id;
            return (
              <li key={item.id} className="library-row">
                <div className="library-text">
                  {editing ? (
                    <input
                      className="form-input"
                      aria-label={t(lang, 'library.rename')}
                      maxLength={LIBRARY_NAME_MAX}
                      autoFocus
                      value={renaming.text}
                      onChange={e => setRenaming({ id: item.id, text: e.target.value })}
                      onBlur={() => finishRename(item)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') finishRename(item);
                        if (e.key === 'Escape') {
                          e.preventDefault(); // config 창 Esc 접기는 막힌 이벤트를 건너뜀 → 이름 바꾸기만 취소
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="library-name">{item.name}</span>
                  )}
                  <span className={`library-summary${summary ? '' : ' is-broken'}`}>{summary?.text ?? t(lang, 'library.broken')}</span>
                  {summary && <span className="library-summary">{summary.saved}</span>}
                </div>
                <button type="button" className="config-button" disabled={!canLoad || !summary} onClick={() => onLoad(row, item)} aria-label={`${t(lang, 'library.load')} ${item.name}`}>
                  <FolderOpen />
                  {t(lang, 'library.load')}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t(lang, 'library.rename')}
                  aria-label={`${t(lang, 'library.rename')} ${item.name}`}
                  onClick={() => setRenaming(editing ? null : { id: item.id, text: item.name })}
                >
                  <Pencil />
                </button>
                <button type="button" className="icon-button" title={t(lang, 'library.delete')} aria-label={`${t(lang, 'library.delete')} ${item.name}`} onClick={() => onDelete(item)}>
                  <Trash2 />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
