import { describe, expect, it } from 'vitest';
import { bearingTo } from '../../core/ballistics';
import { createIntakeZonePreset, hiveCellAimPoint } from '../../core/collision';
import { SimulationEngine } from '../../core/simulationEngine';
import type { RobotDriveInput } from '../../core/simulationEngine';
import { hiveTipPollenThreshold } from '../../core/types';
import type { DeepReadonly, GamePiece, RobotConfig, ScenarioConfig, TimelineFrame } from '../../core/types';
import canvasRendererSource from '../canvasRenderer.ts?raw';
import robotLayoutSource from '../robotLayout.ts?raw';
import sceneRendererSource from '../sceneRenderer.ts?raw';
import { ALLIANCE_COLORS, ALLIANCE_RGB, COLORS, allianceShades, pieceColors } from '../canvasRenderer';
import { GAUGE_SLOT_PITCH, STOCK_GAUGE_END_PAD, bottomBonusSlot, stockGaugeLayout } from '../gaugeLayout';
import { renderScene } from '../sceneRenderer';
import { restingView } from '../viewTransform';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

const cfg = (id: 'robot1' | 'robot2'): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4,
});
const C1 = cfg('robot1');
const C2 = cfg('robot2');
const engine = (sc: ScenarioConfig) => new SimulationEngine(C1, C2, () => 1, sc.allianceColor, sc);

// 그리기 호출을 기록하는 가짜 캔버스: fillText 글자, 원(arc) 테두리 색 / 굵기
function recordingCtx() {
  const texts: string[] = [];
  const strokes: { style: string; width: number }[] = [];
  const state: Record<string, unknown> = { lineWidth: 1, strokeStyle: '#000' };
  const ctx = new Proxy(state, {
    get: (t, prop) => {
      if (prop === 'fillText') return (text: string) => texts.push(text);
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (prop === 'stroke') return () => strokes.push({ style: String(t.strokeStyle), width: Number(t.lineWidth) });
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, strokes };
}

function draw(frame: DeepReadonly<TimelineFrame>) {
  const rec = recordingCtx();
  renderScene(rec.ctx, { frame, r1Config: C1, r2Config: C2, view: restingView('DRIVER', frame.field.allianceColor) }, 1);
  return rec;
}

describe('진영 공식 색 / 캔버스 글자 / 경기 종료 강조 (09-6b)', () => {
  it('A. 공식 RGB에서 파생한 진영 색 / 비활성 색', () => {
    assert(ALLIANCE_RGB.RED.join() === '223,0,27' && ALLIANCE_RGB.BLUE.join() === '15,83,167', 'official RGB (RED 223, 0, 27 / BLUE 15, 83, 167)');
    assert(ALLIANCE_COLORS.RED.base === '#DF001B' && ALLIANCE_COLORS.BLUE.base === '#0F53A7', 'base = official color');
    // 어둡게 15% (테두리), 흰색과 7 : 3 (하향 셀), 25% 투명 (구역 바탕)
    assert(ALLIANCE_COLORS.RED.dark === '#BE0017' && ALLIANCE_COLORS.BLUE.dark === '#0D478E', `dark ${ALLIANCE_COLORS.RED.dark} / ${ALLIANCE_COLORS.BLUE.dark}`);
    assert(ALLIANCE_COLORS.RED.tint === '#F5B3BB' && ALLIANCE_COLORS.BLUE.tint === '#B7CBE5', `tint ${ALLIANCE_COLORS.RED.tint} / ${ALLIANCE_COLORS.BLUE.tint}`);
    assert(ALLIANCE_COLORS.RED.fill === 'rgba(223, 0, 27, 0.25)' && ALLIANCE_COLORS.BLUE.fill === 'rgba(15, 83, 167, 0.25)', 'fill 25% alpha');
    // 비활성: 진영마다 다른 희미한 색 (회색 하나로 합치지 않음)
    const { RED, BLUE } = ALLIANCE_COLORS;
    assert(RED.inactiveStroke === '#BD6F78' && BLUE.inactiveStroke === '#748CA9', `inactive stroke ${RED.inactiveStroke} / ${BLUE.inactiveStroke}`);
    assert(RED.inactiveCell === '#DEC3C7' && BLUE.inactiveCell === '#C5CDD7', `inactive cell ${RED.inactiveCell} / ${BLUE.inactiveCell}`);
    assert(RED.inactiveFill === 'rgba(223, 0, 27, 0.08)' && BLUE.inactiveFill === 'rgba(15, 83, 167, 0.08)', 'inactive fill 8% alpha');
    assert(allianceShades([255, 255, 255]).dark === '#D9D9D9' && allianceShades([0, 0, 0]).tint === '#B3B3B3', 'shade formulas');
    assert(COLORS.redCellUp === '#DF001B' && COLORS.blueCellUp === '#0F53A7' && COLORS.redStroke === '#BE0017' && COLORS.blueFill === 'rgba(15, 83, 167, 0.25)', 'field palette uses the official colors');
    assert(pieceColors({ type: 'NECTAR', alliance: 'RED' }).fill === '#DF001B' && pieceColors({ type: 'NECTAR', alliance: 'BLUE' }).stroke === '#0D478E', 'alliance NECTAR = official color');
    assert(!/unused(Fill|Cell|Stroke)/.test(sceneRendererSource + canvasRendererSource), 'no shared gray "unused" colors left');
  });

  it('B. 캔버스 글자: 이름표 없음 (HIVE 셀 알약 / 로봇 번호 / 배지만), 한국어 없음', () => {
    const startRec = draw(engine({ allianceColor: 'RED' }).getFrame(0)!);
    const start = startRec.texts;
    assert(start.join('|') === '▲ N3 P0/3|1|2', `start frame texts: ${start.join(' | ')}`);
    // 상향 셀 안 NECTAR 3개: 흰 윤곽선 2.25 px (셀 바탕과 같은 진영색이라 굵게)
    const cellNectar = startRec.strokes.filter(st => st.style === '#ffffff' && st.width === 2.25);
    assert(cellNectar.length === 3, `cell NECTAR outlines 2.25 px (${cellNectar.length})`);
    // 전복 중: TIPPING 글자 없음 (주황 점선 테두리만), 발사 배지는 그대로
    const aim = hiveCellAimPoint('RED', 'AUDIENCE_CELL');
    const pos = { x: 59.25, y: 124 };
    const e = engine({ allianceColor: 'RED', hiveInitialPieces: { nectarCount: 3, pollenCount: hiveTipPollenThreshold(3) - 1 }, r1Spawn: { ...pos, heading: bearingTo(pos.x, pos.y, aim.x, aim.y) } });
    const shoot: RobotDriveInput = { targetVx: 0, targetVy: 0, targetOmega: 0, actionState: 'SHOOTING' };
    let tipping: DeepReadonly<TimelineFrame> | undefined;
    for (let t = 0; t < 300 && !tipping; t++) {
      const f = e.step(shoot);
      if (f.field.hive.isTipping) tipping = f;
    }
    const tipTexts = draw(tipping!).texts;
    assert(!!tipping && !tipTexts.includes('TIPPING') && tipTexts.includes('SHOOT'), `tipping frame texts: ${tipTexts.join(' | ')}`);
    // 경기 종료: 점수 알약(+N) / 구조물 이름표 없음
    const end = engine({ allianceColor: 'BLUE' });
    end.runFullMatch();
    const endTexts = draw(end.getFrame(6000)!).texts;
    assert(endTexts.every(t => !t.startsWith('+') && !/GARDEN|HIVE$|FLOWER|LOADING/.test(t)), `end frame texts: ${endTexts.join(' | ')}`);
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

  it('C. 경기 종료 강조: FLOWER 진영색 / 하단 보너스 NECTAR / GARDEN 주황 (초록과 겹치지 않음) / 재고 게이지 여유', () => {
    const P = { type: 'POLLEN', alliance: 'NONE' } as const;
    const N = { type: 'NECTAR', alliance: 'RED' } as const;
    assert(bottomBonusSlot([P, N, P, N]) === 1 && bottomBonusSlot([null, N, P]) === 1 && bottomBonusSlot([P, P, N, N]) === 2 && bottomBonusSlot([P, P, P]) === -1 && bottomBonusSlot([]) === -1,
      'lowest NECTAR in slot[1..N] (slot 0 excluded, jam counts)');
    // 기본 경기를 그대로 끝내면 GARDEN 4개 득점: 득점 기물은 주황 3 px 한 번만, 초록 테두리 없음
    const e = engine({ allianceColor: 'RED' });
    e.runFullMatch();
    const end = e.getFrame(6000)!;
    const scoredCount = end.scoreBreakdown!.gardenPieceIds.length;
    const rec = draw(end);
    const orange = rec.strokes.filter(s => s.style === '#f59e0b');
    const green = rec.strokes.filter(s => s.style === '#16a34a');
    const opponentGarden = end.pieces.filter(p => p.state === 'IN_GARDEN').length - scoredCount;
    assert(scoredCount === 4 && green.length === opponentGarden, `scored GARDEN pieces lose the green ring (green ${green.length} = opponent ${opponentGarden})`);
    // 소유 FLOWER: FLOWER 1에 NECTAR를 넣은 종료 프레임을 만들어 강조 확인
    const f1 = e.field.flowers[0];
    const nectar = e.pieces.find(p => p.type === 'NECTAR' && p.state !== 'IN_FLOWER') as GamePiece;
    f1.pieces.splice(2, 0, nectar);
    nectar.state = 'IN_FLOWER';
    const owned: DeepReadonly<TimelineFrame> = {
      ...end,
      field: { ...end.field, flowers: e.field.flowers.map(f => ({ ...f, pieces: [...f.pieces] })) },
      scoreBreakdown: { ...end.scoreBreakdown!, flowers: end.scoreBreakdown!.flowers.map((f, i) => (i === 0 ? { ...f, owned: true } : f)) },
    };
    const rec2 = draw(owned);
    const orange2 = rec2.strokes.filter(s => s.style === '#f59e0b');
    assert(orange2.length === orange.length + 2, `owned FLOWER: orange border on the FLOWER circle + orange ring on the bottom-bonus NECTAR (${orange.length} -> ${orange2.length})`);
    assert(!/drawScoredLabels|TIPPING|fieldLabels/.test(sceneRendererSource), 'label / score-pill / TIPPING drawing removed');
    // 재고 게이지: 칸 5개는 그대로, 양 끝에 칸 하나 길이 여유
    for (const side of ['RED', 'BLUE'] as const) {
      const g = stockGaugeLayout(side);
      const ys = g.slots.map(p => p.y);
      const ends = [Math.min(...ys) - g.rect.minY, g.rect.maxY - Math.max(...ys)];
      assert(STOCK_GAUGE_END_PAD === GAUGE_SLOT_PITCH && ends.every(d => Math.abs(d - (GAUGE_SLOT_PITCH / 2 + STOCK_GAUGE_END_PAD)) < 1e-9), `${side}: stock gauge padded at both ends`);
    }
  });
});
