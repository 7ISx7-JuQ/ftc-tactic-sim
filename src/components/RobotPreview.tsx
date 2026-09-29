// 로봇 미리보기 (명세서 3.8 로봇 제원 탭 인테이크 "로봇 기준 앞이 위인 미리보기", 09-9b): 위에서 본 로봇 몸체 + 앞 변,
// 흡입 구역(초록), 슈터 조준 범위(고정형 ± 허용 오차 / 터렛 왼쪽 → 오른쪽 부채꼴), 발사구(앞 방향 오프셋). 초안이 바뀌면 바로 다시 그림.
// 배치는 엔진 getBumperZoneOBB와 같은 규칙(previewZoneRect)을 쓴다. SVG 좌표: x = 오른쪽, y = −앞 (inch).
import type { RobotConfig } from '../core/types';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { previewAimSector, previewZoneRect } from '../ui/robotForm';

const point = (angle: number, r: number) => ({ x: r * Math.sin(angle), y: -r * Math.cos(angle) });

export default function RobotPreview({ config, shooterOffset, lang }: { config: RobotConfig; shooterOffset: number; lang: Language }) {
  const halfW = config.width / 2;
  const halfL = config.length / 2;
  const zones = config.intakeZones.map(z => previewZoneRect(z, config)).filter(r => r !== null);
  const zoneExtent = Math.max(0, ...zones.map(r => Math.max(Math.abs(r.fwd) + r.fwdSize / 2, Math.abs(r.right) + r.rightSize / 2)));
  const radius = Math.max(halfW, halfL) * 1.35 + 2;
  const extent = Math.max(zoneExtent, radius, Math.abs(shooterOffset) + 1) + 1.5;

  const sector = previewAimSector(config);
  const span = sector.end - sector.start;
  let aimPath: string;
  if (span >= 2 * Math.PI - 1e-9) {
    aimPath = `M ${-radius} 0 A ${radius} ${radius} 0 1 1 ${radius} 0 A ${radius} ${radius} 0 1 1 ${-radius} 0 Z`;
  } else {
    const a = point(sector.start, radius);
    const b = point(sector.end, radius);
    aimPath = `M 0 0 L ${a.x} ${a.y} A ${radius} ${radius} 0 ${span > Math.PI ? 1 : 0} 1 ${b.x} ${b.y} Z`;
  }
  const arrow = Math.min(halfL, halfW) * 0.6;

  return (
    <figure className="robot-preview">
      <svg viewBox={`${-extent} ${-extent} ${2 * extent} ${2 * extent}`} role="img" aria-label={t(lang, 'robot.preview')}>
        <path d={aimPath} className="preview-aim" />
        {zones.map((r, i) => (
          <rect key={i} className="preview-zone" x={r.right - r.rightSize / 2} y={-r.fwd - r.fwdSize / 2} width={r.rightSize} height={r.fwdSize} />
        ))}
        <rect className="preview-body" x={-halfW} y={-halfL} width={config.width} height={config.length} />
        <line className="preview-front" x1={-halfW} y1={-halfL} x2={halfW} y2={-halfL} />
        <path className="preview-arrow" d={`M 0 ${arrow} L 0 ${-arrow} M ${-arrow * 0.5} ${-arrow * 0.45} L 0 ${-arrow} L ${arrow * 0.5} ${-arrow * 0.45}`} />
        <circle className="preview-launcher" cx={0} cy={-shooterOffset} r={Math.max(0.8, extent * 0.035)} />
      </svg>
      <figcaption className="preview-legend">
        <span className="legend-item is-intake">{t(lang, 'robot.preview.intake')}</span>
        <span className="legend-item is-aim">{t(lang, 'robot.preview.aim')}</span>
        <span className="legend-item is-launcher">{t(lang, 'robot.preview.launcher')}</span>
        <span className="legend-caption">{t(lang, 'robot.preview')}</span>
      </figcaption>
    </figure>
  );
}
