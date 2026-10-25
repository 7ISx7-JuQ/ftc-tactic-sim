// 저장된 시나리오 (명세서 3.8 시나리오 탭 저장된 시나리오, 19-2a): 시나리오 탭 맨 위. 이름 + 저장(적용 값) / 목록(최근 저장 순) —
// 줄마다 불러오기(초안, 경기 전만) / 이름 바꾸기(그 자리에서, Enter = 확인 · Esc = 취소) / 삭제(확인창은 화면이 띄움).
import { useState } from 'react';
import { FolderOpen, Pencil, Save, Trash2 } from 'lucide-react';
import type { LibraryItem } from '../app/libraryStore';
import type { DraftValues } from '../ui/configDraft';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { LIBRARY_NAME_MAX, libraryName, scenarioItemSummary } from '../ui/library';
import { Section } from './FormControls';

export default function ScenarioLibrary({ items, lang, defaults, canSave, canLoad, onSave, onLoad, onRename, onDelete }: {
  items: readonly LibraryItem[];  // 최근 저장 순
  lang: Language;
  defaults: DraftValues;          // 한 줄 설명 해석용
  canSave: boolean;               // 시나리오 탭에 적용 안 된 수정 / 틀린 입력이 없음 (저장 = 적용 값)
  canLoad: boolean;               // 경기 전 (초안은 경기 전에만 편집)
  onSave: (name: string) => void;
  onLoad: (item: LibraryItem) => void;
  onRename: (item: LibraryItem, name: string) => void;
  onDelete: (item: LibraryItem) => void;
}) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const valid = libraryName(name);
  const save = () => {
    if (!valid || !canSave) return;
    onSave(valid);
    setName('');
  };
  const finishRename = (item: LibraryItem) => {
    const next = renaming && libraryName(renaming.text);
    setRenaming(null);
    if (next && next !== item.name) onRename(item, next);
  };

  return (
    <Section title={t(lang, 'library.scenario.title')}>
      <div className="library-save">
        <input
          className="form-input library-name-input"
          aria-label={t(lang, 'library.name')}
          placeholder={t(lang, 'library.namePlaceholder')}
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
      <p className="settings-note">{canSave ? t(lang, 'library.saveHint') : t(lang, 'library.applyFirst')}</p>
      {items.length === 0 ? (
        <p className="settings-note">{t(lang, 'library.empty')}</p>
      ) : (
        <ul className="library-list">
          {items.map(item => {
            const summary = scenarioItemSummary(lang, item, defaults);
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
                <button type="button" className="config-button" disabled={!canLoad || !summary} onClick={() => onLoad(item)} aria-label={`${t(lang, 'library.load')} ${item.name}`}>
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
