// 게임패드 버튼 매핑 편집 (명세서 3.8 SETTINGS 탭 장치 — 버튼 매핑, 18-3): 슬롯 하나의 동작 4개 + 스틱 좌우 바꾸기 + DEFAULT.
// SET을 누르면 그 슬롯 패드를 requestAnimationFrame으로 폴링해 새로 눌린 첫 버튼을 지정한다 (이미 쓰는 버튼이면 서로 자리 바꾸기).
// 다시 누르기 / Esc / 다른 동작 SET으로 취소. config 창은 진행 중에 열 수 없으므로 지정 중 누른 버튼이 로봇을 움직이지 않는다.
import { useEffect, useRef, useState } from 'react';
import { CONTROL_BUTTONS, DEFAULT_GAMEPAD_MAPPING, assignGamepadButton, sameMapping } from '../input/inputConfig';
import type { ControlButton, GamepadMapping } from '../input/inputConfig';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { firstNewPress, standardButtonName } from '../ui/gamepadMapping';
import { Toggle } from './FormControls';

export default function GamepadMappingEditor({ slot, mapping, connected, standard, lang, readButtons, onChange }: {
  slot: number;
  mapping: GamepadMapping;
  connected: boolean;
  standard: boolean;                                  // 연결된 패드가 표준 배열 (연결 전이면 표준 이름으로 보여 줌)
  lang: Language;
  readButtons: (slot: number) => boolean[] | null;    // 원시 버튼 눌림 (연결 안 됨 = null)
  onChange: (next: GamepadMapping) => void;
}) {
  const [listening, setListening] = useState<ControlButton | null>(null);
  const mappingRef = useRef(mapping);
  const changeRef = useRef(onChange);
  const readRef = useRef(readButtons);
  useEffect(() => {
    mappingRef.current = mapping;
    changeRef.current = onChange;
    readRef.current = readButtons;
  });

  // 지정 중: 매 프레임 폴링, 시작할 때 쥐고 있던 버튼은 뗀 뒤에만 잡힘
  useEffect(() => {
    if (!listening) return;
    let prev = readRef.current(slot) ?? [];
    let handle = requestAnimationFrame(function poll() {
      const now = readRef.current(slot);
      if (now) {
        const index = firstNewPress(prev, now);
        if (index !== null) {
          changeRef.current(assignGamepadButton(mappingRef.current, listening, index));
          setListening(null);
          return;
        }
        prev = now;
      } else prev = [];
      handle = requestAnimationFrame(poll);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); // config 창 Esc 접기는 막힌 이벤트를 건너뜀 → 지정만 취소
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [listening, slot]);

  const name = (index: number) => standardButtonName(index, standard || !connected) ?? t(lang, 'settings.mapping.buttonN', { n: index });
  return (
    <div className="gamepad-mapping" role="group" aria-label={t(lang, 'settings.mapping.title', { slot })}>
      <ul className="gamepad-mapping-list">
        {CONTROL_BUTTONS.map(action => {
          const on = listening === action;
          return (
            <li key={action} className="gamepad-mapping-row">
              <span className="gamepad-mapping-action">{t(lang, `settings.keys.${action}`)}</span>
              <span className="gamepad-mapping-button">{on ? t(lang, 'settings.mapping.press') : name(mapping.buttons[action])}</span>
              <button
                type="button"
                className={`config-button${on ? ' is-primary' : ''}`}
                aria-pressed={on}
                aria-label={`${t(lang, `settings.keys.${action}`)} ${t(lang, 'settings.mapping.set')}`}
                disabled={!connected}
                onClick={() => setListening(on ? null : action)}
              >
                {on ? t(lang, 'settings.mapping.cancel') : t(lang, 'settings.mapping.set')}
              </button>
            </li>
          );
        })}
      </ul>
      {!connected && <p className="settings-note">{t(lang, 'settings.mapping.connect')}</p>}
      <Toggle
        checked={mapping.swapSticks}
        onChange={v => onChange({ ...mapping, swapSticks: v })}
        label={t(lang, 'settings.mapping.swapSticks')}
        hint={t(lang, 'settings.mapping.swapSticksHint')}
      />
      <div className="settings-row">
        <button type="button" className="config-button" disabled={sameMapping(mapping, DEFAULT_GAMEPAD_MAPPING)} onClick={() => onChange(DEFAULT_GAMEPAD_MAPPING)}>
          {t(lang, 'settings.mapping.default')}
        </button>
      </div>
      <p className="settings-note">{t(lang, 'settings.mapping.hint')}</p>
    </div>
  );
}
