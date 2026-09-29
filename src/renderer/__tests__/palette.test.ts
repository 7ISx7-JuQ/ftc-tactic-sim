import { describe, expect, it } from 'vitest';
import canvasRendererSource from '../canvasRenderer.ts?raw';
import robotLayoutSource from '../robotLayout.ts?raw';
import sceneRendererSource from '../sceneRenderer.ts?raw';
import { ALLIANCE_COLORS, ALLIANCE_RGB, COLORS, allianceShades, pieceColors } from '../canvasRenderer';
import { fieldLabels } from '../sceneRenderer';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

describe('진영 공식 색 / 캔버스 글자 (09-6b)', () => {
  it('A. 공식 RGB에서 파생한 진영 색', () => {
    assert(ALLIANCE_RGB.RED.join() === '223,0,27' && ALLIANCE_RGB.BLUE.join() === '15,83,167', 'official RGB (RED 223, 0, 27 / BLUE 15, 83, 167)');
    assert(ALLIANCE_COLORS.RED.base === '#DF001B' && ALLIANCE_COLORS.BLUE.base === '#0F53A7', 'base = official color');
    // 어둡게 15% (테두리 / 라벨), 흰색과 7 : 3 (하향 셀), 25% 투명 (구역 바탕)
    assert(ALLIANCE_COLORS.RED.dark === '#BE0017' && ALLIANCE_COLORS.BLUE.dark === '#0D478E', `dark ${ALLIANCE_COLORS.RED.dark} / ${ALLIANCE_COLORS.BLUE.dark}`);
    assert(ALLIANCE_COLORS.RED.tint === '#F5B3BB' && ALLIANCE_COLORS.BLUE.tint === '#B7CBE5', `tint ${ALLIANCE_COLORS.RED.tint} / ${ALLIANCE_COLORS.BLUE.tint}`);
    assert(ALLIANCE_COLORS.RED.fill === 'rgba(223, 0, 27, 0.25)' && ALLIANCE_COLORS.BLUE.fill === 'rgba(15, 83, 167, 0.25)', 'fill 25% alpha');
    assert(allianceShades([255, 255, 255]).dark === '#D9D9D9' && allianceShades([0, 0, 0]).tint === '#B3B3B3', 'shade formulas');
    // 렌더러 팔레트가 공식 색을 사용
    assert(COLORS.redCellUp === '#DF001B' && COLORS.blueCellUp === '#0F53A7' && COLORS.redStroke === '#BE0017' && COLORS.blueFill === 'rgba(15, 83, 167, 0.25)', 'field palette uses the official colors');
    assert(pieceColors({ type: 'NECTAR', alliance: 'RED' }).fill === '#DF001B' && pieceColors({ type: 'NECTAR', alliance: 'BLUE' }).stroke === '#0D478E', 'alliance NECTAR = official color');
  });

  it('B. 캔버스 글자: 게임 용어 / 로딩 존 라벨 / 한국어 없음', () => {
    for (const ally of ['RED', 'BLUE'] as const) {
      const texts = fieldLabels(ally).map(l => l.text);
      assert(texts.filter(t => t === 'LOADING\nZONE').length === 2, `${ally}: two LOADING ZONE labels (two lines to fit the 11 in zone)`);
      assert(texts.includes('RED GARDEN') && texts.includes('BLUE HIVE') && texts.includes('FLOWER 4'), `${ally}: structure labels`);
    }
    // 캔버스에 그리는 문자열 리터럴에 한국어가 없어야 함 (한국어 화면 글자는 문구 사전 → HTML)
    const sources: [string, string][] = [['sceneRenderer.ts', sceneRendererSource], ['canvasRenderer.ts', canvasRendererSource], ['robotLayout.ts', robotLayoutSource]];
    for (const [file, source] of sources) {
      const code = source
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .map(line => line.replace(/\/\/.*$/, ''))
        .join('\n');
      const literals = code.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? [];
      const korean = literals.filter(l => /[가-힣]/.test(l));
      assert(korean.length === 0, `${file}: no Korean string literals drawn on the canvas (${korean.join(', ')})`);
    }
  });
});
