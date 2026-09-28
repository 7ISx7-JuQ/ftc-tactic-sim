// 행동 상태 배지 이미지 자산 (명세서 3.7, 사용자 제공): src/assets/badges/{key}.svg | .png
// 자산이 없거나 아직 로드되지 않았으면 null → 렌더러가 글자 배지로 대신 그림 (렌더러 구현은 자산 제공 시점과 무관)

import type { BadgeKey } from './robotLayout';

const BADGE_URLS = import.meta.glob('../assets/badges/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 자산 경로에서 배지 키 추출 (…/badges/lift-up.svg → 'lift-up') */
export function badgeKeyFromPath(path: string): string | null {
  return /\/([^/]+)\.(svg|png)$/.exec(path)?.[1] ?? null;
}

const images = new Map<BadgeKey, HTMLImageElement | null>();

export function badgeImage(key: BadgeKey): HTMLImageElement | null {
  let img = images.get(key);
  if (img === undefined) {
    const url = Object.entries(BADGE_URLS).find(([path]) => badgeKeyFromPath(path) === key)?.[1];
    img = url && typeof Image !== 'undefined' ? Object.assign(new Image(), { src: url }) : null;
    images.set(key, img);
  }
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
