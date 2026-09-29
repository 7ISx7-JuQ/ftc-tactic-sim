// HIVE 아이콘 (좌측 패널 TIP 옆, 09-6d): lucide 아이콘과 같은 규격 (24 × 24 viewBox, currentColor 선)
// 필드의 HIVE(진영별 2칸 × 상하 CELL)를 단순화한 모양. 사용자가 SVG를 제공하면 교체한다.
export default function HiveIcon({ size = 24 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z" />
      <path d="M12 2.5v19" />
      <path d="M3.5 12h17" />
    </svg>
  );
}
