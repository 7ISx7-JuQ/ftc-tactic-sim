// config 창 공통 입력 컨트롤 (09-8b SETTINGS / 09-9a 로봇 탭): 구역 제목, 버튼 묶음, 토글, 숫자 칸, 글자 칸.
// 숫자 칸 (명세서 3.8 입력 규칙): 단위 표시, 칠 때마다 검사 — 올바르면 그 칸 값만 엔진 단위로 바꿔 onValue, 틀리면 글자를 onInvalid로 보관
// (빨간 테두리 + 빨간 설명, 구글 폼 방식). 초점이 있는 동안은 친 글자를 그대로 보여 주고, 초점을 잃으면 표시 형식으로.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { checkNumber, checkText, displayRange, fieldUnit, formatField, parseNumberField } from '../ui/robotForm';
import type { FieldError, NumberFieldSpec, TextFieldKey } from '../ui/robotForm';
import type { LengthUnit } from '../ui/units';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-title">{title}</h3>
      {children}
    </section>
  );
}

/** 여러 개 중 하나 고르기 (버튼 묶음) */
export function Segmented<T extends string>({ value, options, label, disabled, onChange, ariaLabel }: {
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  disabled?: (v: T) => boolean;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map(v => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={`segmented-button${v === value ? ' is-selected' : ''}`} disabled={disabled?.(v)} onClick={() => onChange(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}

/** 켜기 / 끄기 */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" className="toggle-input" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-switch" aria-hidden="true" />
    </label>
  );
}

/** 입력 오류 설명 문구 */
function fieldErrorText(lang: Language, error: FieldError, spec?: NumberFieldSpec, unit: LengthUnit = 'in'): string {
  switch (error.code) {
    case 'REQUIRED':
      return t(lang, 'form.required');
    case 'INTEGER':
      return t(lang, 'form.integer');
    case 'TEAM_NUMBER':
      return t(lang, 'form.teamNumber');
    case 'TEAM_NAME':
      return t(lang, 'form.teamName');
    case 'RANGE': {
      const u = spec ? fieldUnit(spec, unit) : '';
      const suffix = !u ? '' : u === '°' || u === '%' ? u : ` ${u}`;
      const [min, max] = spec ? displayRange(spec, unit) : [String(error.min), String(error.max)];
      return t(lang, 'form.range', { min, max, unit: suffix });
    }
  }
}

function FieldShell({ label, error, children, id }: { label: string; error: string | null; children: ReactNode; id: string }) {
  return (
    <div className={`form-field${error ? ' has-error' : ''}`}>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <span className="form-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** 숫자 칸 */
export function NumberField({ id, label, spec, value, invalidText, unit, lang, disabled, checkValue, onValue, onInvalid }: {
  id: string;
  label: string;
  spec: NumberFieldSpec;
  value: number;                 // 엔진 단위
  invalidText?: string;          // 보관된 틀린 글자 (있으면 이 글자를 보여 주고 오류 표시)
  unit: LengthUnit;
  lang: Language;
  disabled?: boolean;
  checkValue?: boolean;          // 저장된 값 자체도 범위 검사 (범위가 다른 칸에 따라 바뀌는 흡입 구역 offset 등)
  onValue: (value: number) => void;
  onInvalid: (text: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = editing ?? invalidText ?? formatField(spec, value, unit);
  const parsed = invalidText !== undefined ? parseNumberField(spec, invalidText, unit) : null;
  const valueError = invalidText === undefined && checkValue ? checkNumber(spec, value) : null;
  const error = parsed && !parsed.ok ? fieldErrorText(lang, parsed.error, spec, unit) : valueError ? fieldErrorText(lang, valueError, spec, unit) : null;
  const u = fieldUnit(spec, unit);
  return (
    <FieldShell label={label} error={error} id={id}>
      <span className="form-input-wrap">
        <input
          id={id}
          className="form-input"
          inputMode="decimal"
          value={shown}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setEditing(shown)}
          onBlur={() => setEditing(null)}
          onChange={e => {
            const text = e.target.value;
            setEditing(text);
            const r = parseNumberField(spec, text, unit);
            if (r.ok) onValue(r.value);
            else onInvalid(text);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {u && <span className="form-unit">{u}</span>}
      </span>
    </FieldShell>
  );
}

/** 글자 칸 (팀 번호 / 팀명): 올바르면 앞뒤 공백을 뺀 값을 onValue, 틀리면 onInvalid */
export function TextField({ id, label, field, value, invalidText, lang, disabled, placeholder, onValue, onInvalid }: {
  id: string;
  label: string;
  field: TextFieldKey;
  value: string;
  invalidText?: string;
  lang: Language;
  disabled?: boolean;
  placeholder?: string;
  onValue: (value: string) => void;
  onInvalid: (text: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = editing ?? invalidText ?? value;
  const err = invalidText !== undefined ? checkText(field, invalidText) : null;
  const error = err ? fieldErrorText(lang, err) : null;
  return (
    <FieldShell label={label} error={error} id={id}>
      <span className="form-input-wrap">
        <input
          id={id}
          className="form-input"
          inputMode={field === 'teamNumber' ? 'numeric' : 'text'}
          value={shown}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error}
          onFocus={() => setEditing(shown)}
          onBlur={() => setEditing(null)}
          onChange={e => {
            const text = e.target.value;
            setEditing(text);
            if (checkText(field, text)) onInvalid(text);
            else onValue(text.trim());
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </span>
    </FieldShell>
  );
}
