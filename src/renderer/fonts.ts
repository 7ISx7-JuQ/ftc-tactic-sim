// 글꼴 (명세서 3.8, 09-6d 확정): Mac / iPhone은 설치된 Apple SD 산돌고딕 Neo(시스템 글꼴, 파일 배포 없이 이름만 지정),
// 그 외 기기는 번들한 Pretendard(OFL, 동적 서브셋 웹폰트). 굵기 600 / 700 / 800만 사용.
// HTML(index.css)과 캔버스 글자가 같은 글꼴 목록을 쓴다 (index.css의 --font-family와 같아야 함 — 테스트로 확인).
export const FONT_FAMILY = "'Apple SD Gothic Neo', 'Pretendard Variable', Pretendard, system-ui, sans-serif";

/** 캔버스 글꼴 문자열 (기본 굵기 700) */
export function canvasFont(sizePx: number, weight: 600 | 700 | 800 = 700): string {
  return `${weight} ${sizePx}px ${FONT_FAMILY}`;
}
