// 시나리오 탭 폼 규칙 (명세서 3.8 시나리오 탭, 2.4 텔레옵 시작 조건, 09-11a)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_VALUES } from '../../app/defaultSetup';
import { DEFAULT_RNG_SEED, DEFAULT_SPAWN_POSES } from '../../core/simulationEngine';
import type { ScenarioConfig } from '../../core/types';
import { canResetTab, initialDrafts, isDirty, resetTabDraft, tabIssues } from '../configDraft';
import type { DraftValues } from '../configDraft';
import {
  floorSummary,
  issueFieldSet,
  mirrorPose,
  newSeed,
  nextSlotPiece,
  normalizeHeading,
  readScenario,
  rerollSeed,
  resetSpawn,
  scenarioFormIssues,
  setAlliance,
  setFlowerCount,
  setHivePieces,
  setLoadoutSlot,
  setSpawnAxis,
} from '../scenarioForm';

const V = DEFAULT_DRAFT_VALUES;
const R1 = V.robot1.config;
const R2 = V.robot2.config;
const withScenario = (scenario: ScenarioConfig, patch: Partial<DraftValues> = {}): DraftValues => ({ ...V, ...patch, scenario });
const codes = (values: DraftValues) => scenarioFormIssues(values).map(i => `${i.code}${i.robot ? `@${i.robot}` : ''}`);

describe('시나리오 탭 폼 (09-11a)', () => {
  it('A. 읽기: 지정하지 않은 항목 = 엔진 기본값 (진영별 상향 셀 / 기본 스폰, 적재 한도만큼 POLLEN, 기본 시드)', () => {
    const red = readScenario({ allianceColor: 'RED' }, R1, { ...R2, maxControlledPieces: 2 });
    expect(red).toEqual({
      alliance: 'RED',
      hiveUpwardCell: 'AUDIENCE_CELL',
      hivePollen: 0,
      hiveNectar: 3,
      loadout: { robot1: ['POLLEN', 'POLLEN', 'POLLEN', 'POLLEN'], robot2: ['POLLEN', 'POLLEN'] },
      flowers: [4, 4, 4, 4],
      garden: { ally: 4, opponent: 4 },
      autoTipCount: 0,
      spawn: DEFAULT_SPAWN_POSES.RED,
      spawnIsDefault: { robot1: true, robot2: true },
      seed: DEFAULT_RNG_SEED,
    });
    const blue = readScenario({ allianceColor: 'BLUE', r2Spawn: { x: 100, y: 90, heading: 1 }, rngSeed: 7 }, R1, R2);
    expect(blue.hiveUpwardCell).toBe('OPPOSITE_CELL');
    expect(blue.spawn).toEqual({ robot1: DEFAULT_SPAWN_POSES.BLUE.robot1, robot2: { x: 100, y: 90, heading: 1 } });
    expect(blue.spawnIsDefault).toEqual({ robot1: true, robot2: false });
    expect(blue.seed).toBe(7);
    // 기본 시나리오는 기본값 그대로 유효 (tabIssues와 같음)
    expect(scenarioFormIssues(V)).toEqual([]);
  });

  it('B. 진영 전환: 지정한 시작 자세 좌우 대칭(기본 스폰끼리 맞음), 지정한 상향 셀 반대로, 나머지는 새 진영 기본값', () => {
    expect(mirrorPose(DEFAULT_SPAWN_POSES.RED.robot1)).toEqual(DEFAULT_SPAWN_POSES.BLUE.robot1);
    expect(mirrorPose(DEFAULT_SPAWN_POSES.RED.robot2)).toEqual(DEFAULT_SPAWN_POSES.BLUE.robot2);
    const m = mirrorPose({ x: 60, y: 30, heading: Math.PI / 6 });
    expect(m.x).toBe(84);
    expect(m.y).toBe(30);
    expect(m.heading).toBeCloseTo((5 * Math.PI) / 6, 12);
    expect(normalizeHeading(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeHeading(3 * Math.PI)).toBeCloseTo(Math.PI, 12);

    const base: ScenarioConfig = { allianceColor: 'RED', r1Spawn: { x: 60, y: 30, heading: 0 }, hiveUpwardCell: 'OPPOSITE_CELL', autoTipCount: 2 };
    const blue = setAlliance(base, 'BLUE');
    expect(blue).toEqual({ allianceColor: 'BLUE', r1Spawn: { x: 84, y: 30, heading: Math.PI }, hiveUpwardCell: 'AUDIENCE_CELL', autoTipCount: 2 });
    expect(setAlliance(base, 'RED')).toBe(base);
    const plain = setAlliance({ allianceColor: 'RED' }, 'BLUE');
    expect(plain).toEqual({ allianceColor: 'BLUE' }); // 지정 안 한 항목은 새 진영 기본값 (저장 형식 그대로)
    expect(readScenario(plain, R1, R2).hiveUpwardCell).toBe('OPPOSITE_CELL');
    // 두 번 바꾸면 원래대로
    const back = setAlliance(blue, 'RED');
    expect(back.r1Spawn!.x).toBe(60);
    expect(back.r1Spawn!.heading).toBeCloseTo(0, 12);
    expect(back.hiveUpwardCell).toBe('OPPOSITE_CELL');
  });

  it('C. 적재물: 칸 순환 POLLEN → NECTAR(흡입 가능만) → 빈 칸, 빈 칸은 목록에서 빠져 뒤로 모임 (FIFO 순서 유지)', () => {
    expect(nextSlotPiece('POLLEN', true)).toBe('NECTAR');
    expect(nextSlotPiece('POLLEN', false)).toBeNull();
    expect(nextSlotPiece('NECTAR', true)).toBeNull();
    expect(nextSlotPiece(null, true)).toBe('POLLEN');
    const sc: ScenarioConfig = { allianceColor: 'RED' };
    const view = readScenario(sc, R1, R2);
    const nectarFirst = setLoadoutSlot(sc, view, 'robot1', 0, 'NECTAR');
    expect(nectarFirst.r1Loadout).toEqual(['NECTAR', 'POLLEN', 'POLLEN', 'POLLEN']);
    expect(nectarFirst.r2Loadout).toBeUndefined();
    const emptied = setLoadoutSlot(nectarFirst, readScenario(nectarFirst, R1, R2), 'robot1', 1, null);
    expect(emptied.r1Loadout).toEqual(['NECTAR', 'POLLEN', 'POLLEN']);
    const refill = setLoadoutSlot(emptied, readScenario(emptied, R1, R2), 'robot1', 3, 'POLLEN');
    expect(refill.r1Loadout).toEqual(['NECTAR', 'POLLEN', 'POLLEN', 'POLLEN']);
    expect(setLoadoutSlot(sc, view, 'robot2', 2, null).r2Loadout).toEqual(['POLLEN', 'POLLEN', 'POLLEN']);
  });

  it('D. 시작 자세 / 개수: 한 축만 고치면 기본 스폰에서 시작, 기본값 = 지정 해제, 개수는 나머지 칸 유지', () => {
    const sc: ScenarioConfig = { allianceColor: 'BLUE' };
    const moved = setSpawnAxis(sc, readScenario(sc, R1, R2), 'robot2', 'y', 90);
    expect(moved.r2Spawn).toEqual({ ...DEFAULT_SPAWN_POSES.BLUE.robot2, y: 90 });
    expect(resetSpawn(moved, 'robot2')).toEqual(sc);
    expect(resetSpawn(moved, 'robot2')).not.toHaveProperty('r2Spawn');
    const both = setSpawnAxis(moved, readScenario(moved, R1, R2), 'robot1', 'heading', 0.5);
    expect(resetSpawn(both, 'robot1')).toEqual(moved);
    expect(resetSpawn(both, 'robot1').r2Spawn).toEqual(moved.r2Spawn);
    const f = setFlowerCount(sc, readScenario(sc, R1, R2), 2, 1);
    expect(f.flowerPiecesCount).toEqual([4, 4, 1, 4]);
    expect(setHivePieces(sc, { pollenCount: 2 }).hiveInitialPieces).toEqual({ pollenCount: 2, nectarCount: 3 });
    expect(setHivePieces({ ...sc, hiveInitialPieces: { pollenCount: 2, nectarCount: 1 } }, { nectarCount: 0 }).hiveInitialPieces).toEqual({ pollenCount: 2, nectarCount: 0 });
  });

  it('E. 화면용 검증: tabIssues와 같은 문제, 적재물 문제는 로봇별, 배치 문제는 엔진 로봇 목록, 빨간 칸 묶음', () => {
    const over = withScenario({ allianceColor: 'RED', hiveInitialPieces: { pollenCount: 12, nectarCount: 3 } });
    expect(codes(over)).toEqual(['HIVE_OVER_THRESHOLD', 'POLLEN_TOTAL_EXCEEDED']);
    expect([...issueFieldSet(scenarioFormIssues(over))]).toEqual(expect.arrayContaining(['hive', 'flower.0', 'garden.ally', 'loadout.robot2']));

    const small = { ...V.robot2, config: { ...R2, maxControlledPieces: 2, canIntakeNectar: false } };
    const loads = withScenario({ allianceColor: 'RED', r2Loadout: ['NECTAR', 'POLLEN', 'POLLEN'], hiveInitialPieces: { pollenCount: 0, nectarCount: 3 } }, { robot2: small });
    expect(codes(loads)).toEqual(['LOADOUT_OVER_CAPACITY@robot2', 'LOADOUT_NECTAR_NOT_ALLOWED@robot2', 'NECTAR_IN_PLAY_EXCEEDED']);
    expect(scenarioFormIssues(loads).find(i => i.code === 'NECTAR_IN_PLAY_EXCEEDED')!.fields).toEqual(['hive', 'loadout.robot1', 'loadout.robot2']);

    const hive = withScenario({ allianceColor: 'RED', r1Spawn: { x: 60, y: 80, heading: 0 } });
    expect(scenarioFormIssues(hive)).toEqual([{ code: 'PLACEMENT_IN_HIVE', robot: 'robot1', fields: ['spawn.robot1'] }]);
    const overlap = withScenario({ allianceColor: 'RED', r2Spawn: { x: 9, y: 40, heading: 0 } });
    expect(scenarioFormIssues(overlap)).toEqual([{ code: 'PLACEMENT_ROBOT_OVERLAP', fields: ['spawn.robot1', 'spawn.robot2'] }]);

    const tips = withScenario({ allianceColor: 'RED', autoTipCount: 6, flowerPiecesCount: [5, 0, 7, 0] }); // POLLEN 합계 28 (총량 안)
    expect(codes(tips)).toEqual(['FLOWER_COUNT', 'AUTO_TIP_COUNT']);
    expect(scenarioFormIssues(tips)[0].fields).toEqual(['flower.0', 'flower.2']);
    // 같은 문제 종류 = tabIssues (FLOWER_COUNT는 FLOWER별로 여러 개 → 화면은 하나로)
    for (const values of [over, loads, hive, overlap, tips]) {
      expect(new Set(scenarioFormIssues(values).map(i => i.code))).toEqual(new Set(tabIssues(values, 'scenario').map(i => i.code)));
    }
  });

  it('F. 바닥 산포 / 재고 요약: 32 − 지정 POLLEN, 3 − (HIVE + 적재 NECTAR), 5 − 오토 TIP', () => {
    expect(floorSummary(readScenario({ allianceColor: 'RED' }, R1, R2))).toEqual({ floorPollen: 0, floorNectar: 0, stock: 5 });
    const sc: ScenarioConfig = { allianceColor: 'RED', r1Loadout: ['NECTAR'], hiveInitialPieces: { pollenCount: 1, nectarCount: 1 }, flowerPiecesCount: [2, 4, 4, 4], autoTipCount: 2 };
    // 지정 POLLEN = 적재 0 + 4(R2) + FLOWER 14 + HIVE 1 + GARDEN 8 = 27
    expect(floorSummary(readScenario(sc, R1, R2))).toEqual({ floorPollen: 5, floorNectar: 1, stock: 3 });
  });

  it('G. 시드: REROLL = 적용 값과 초안에 바로 (다른 초안 수정은 그대로, 수정 없음이면 여전히 DIRTY 아님), 새 시드는 지금과 다름, RESET TAB은 시드 유지', () => {
    const drafts = initialDrafts(V);
    const rolled = rerollSeed(drafts, 12345);
    expect(rolled.applied.scenario.rngSeed).toBe(12345);
    expect(rolled.draft.scenario.rngSeed).toBe(12345);
    expect(isDirty(rolled, 'scenario')).toBe(false);
    const edited = { ...rolled, draft: { ...rolled.draft, scenario: { ...rolled.draft.scenario, autoTipCount: 3 } } };
    const again = rerollSeed(edited, 999);
    expect(again.draft.scenario).toEqual({ allianceColor: 'RED', autoTipCount: 3, rngSeed: 999 });
    expect(again.applied.scenario).toEqual({ allianceColor: 'RED', rngSeed: 999 });
    // RESET TAB: 기본값으로 가도 시드는 유지 → 적용 값과 같으면 수정 아님
    const reset = resetTabDraft(again, 'scenario', V);
    expect(reset.draft.scenario).toEqual({ allianceColor: 'RED', rngSeed: 999 });
    expect(isDirty(reset, 'scenario')).toBe(false);
    expect(canResetTab(reset, 'scenario', V)).toBe(false);
    expect(canResetTab(again, 'scenario', V)).toBe(true);
    // 새 시드
    const seq = [0.5, 0.5, 0.25];
    const fixed = Math.floor(0.5 * 2 ** 32);
    expect(newSeed(fixed, () => seq.shift()!)).toBe(Math.floor(0.25 * 2 ** 32));
    expect(newSeed(7, () => 0.999999999)).toBeLessThan(2 ** 32);
    expect(newSeed(0, () => 0)).toBe(1);
  });
});
