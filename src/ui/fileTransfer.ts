// 파일 다운로드 / 선택 (명세서 3.9, 10-2): 브라우저 전용 얇은 층. 규칙(파일 내용 / 이름 / 검증)은 presetFile.ts 등 순수 모듈에 둔다.
import { MAX_IMPORT_BYTES } from './presetFile';

/** 글자 파일 다운로드 (<a download> + Blob URL) */
export function downloadTextFile(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 시작된 뒤 해제
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type PickResult = { ok: true; name: string; text: string } | { ok: false; code: 'TOO_LARGE' | 'READ_FAILED' };

/** 파일 선택창 → 글자. 취소하면 null (취소 이벤트가 없는 브라우저에서는 끝나지 않을 수 있으나 기다리는 쪽이 없음) */
export function pickTextFile(accept = '.json,application/json'): Promise<PickResult | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const done = (result: PickResult | null) => {
      input.remove();
      resolve(result);
    };
    input.addEventListener('cancel', () => done(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      if (file.size > MAX_IMPORT_BYTES) return done({ ok: false, code: 'TOO_LARGE' });
      file.text().then(
        text => done({ ok: true, name: file.name, text }),
        () => done({ ok: false, code: 'READ_FAILED' }),
      );
    });
    document.body.appendChild(input);
    input.click();
  });
}
