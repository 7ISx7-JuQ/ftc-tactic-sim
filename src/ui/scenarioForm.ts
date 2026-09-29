// 시나리오 탭 폼 규칙 (명세서 3.8 시나리오 탭, 2.4 텔레옵 시작 조건, 09-11a): React / DOM 비의존 순수 함수
// - 초안은 엔진 ScenarioConfig 그대로. 읽을 때는 지정하지 않은 항목을 엔진 기본값으로 풀어 보여 주고(readScenario),
//   고칠 때만 그 항목을 명시 값으로 쓴다 → 기본 시나리오 { allianceColor: 'RED' }와 저장값 호환이 그대로 유지된다.
// - 진영 전환 (09-11 확정): 직접 지정한 시작 자세는 좌우 대칭(x → 144 − x, 헤딩 → 180° − 헤딩, RED R1 기본 ↔ BLUE B1 기본),
//   직접 지정한 상향 셀은 반대 셀로 (RED 기본 AUDIENCE ↔ BLUE 기본 OPPOSITE). 지정하지 않은 항목은 새 진영 기본값을 따른다.
// - 시드 (09-11 확정): REROLL은 초안 / 적용을 거치지 않고 적용 값과 초안에 바로 반영 (RESET TAB도 시드는 유지).
// - 검증 = validateScenario + validateRobotPlacement (configDraft.tabIssues와 같은 결과). 화면용으로 로봇 / 빨간 칸을 붙인다.

import { FIELD_SIZE } from '../core/collision';
import {
  DEFAULT_FLOWER_PIECES,
  DEFAULT_GARDEN_PIECES,
  DEFAULT_HIVE_NECTAR,
  DEFAULT_RNG_SEED,
  DEFAULT_SPAWN_POSES,
  FLOWER_MAX_START_PIECES,
  GARDEN_MAX_PIECES,
  INITIAL_HUMAN_NECTAR_STOCK,
  NECTAR_IN_PLAY,
  TOTAL_POLLEN,
  getCarryCapacity,
  validateRobotPlacement,
  validateScenario,
} from '../core/simulationEngine';
import type { GamePiece, RobotConfig, RobotPose, ScenarioConfig } from '../core/types';
import type { RobotId } from '../input/inputConfig';
import type { ConfigDrafts, DraftValues } from './configDraft';
import type { NumberFieldSpec } from './robotForm';

export type PieceType = GamePiece['type'];
export type HiveCellChoice = 'AUDIENCE_CELL' | 'OPPOSITE_CELL';
const ROBOTS: readonly RobotId[] = ['robot1', 'robot2'];

/** 화면에 보이는 시나리오 (지정하지 않은 항목 = 엔진 기본값) */
export interface ScenarioView {
  alliance: 'RED' | 'BLUE';
  hiveUpwardCell: HiveCellChoice;
  hivePollen: number;
  hiveNectar: number;
  loadout: Record<RobotId, PieceType[]>;
  flowers: [number, number, number, number];
  garden: { ally: number; opponent: number };
  autoTipCount: number;
  spawn: Record<RobotId, RobotPose>;
  spawnIsDefault: Record<RobotId, boolean>;
  seed: number;
}

/** 진영 공식 시작 상향 셀 (2.4: RED AUDIENCE, BLUE OPPOSITE) */
export function defaultUpwardCell(alliance: 'RED' | 'BLUE'): HiveCellChoice {
  return alliance === 'RED' ? 'AUDIENCE_CELL' : 'OPPOSITE_CELL';
}

/** 적재물 기본값: 적재 한도만큼 POLLEN (엔진 resolveLoadout과 같음) */
export function defaultLoadout(config: RobotConfig): PieceType[] {
  return Array.from({ length: getCarryCapacity(config) }, () => 'POLLEN' as const);
}

export function readScenario(scenario: ScenarioConfig, r1: RobotConfig, r2: RobotConfig): ScenarioView {
  const a = scenario.allianceColor;
  const configs = { robot1: r1, robot2: r2 };
  const spawnOf = (id: RobotId) => (id === 'robot1' ? scenario.r1Spawn : scenario.r2Spawn);
  const loadoutOf = (id: RobotId) => (id === 'robot1' ? scenario.r1Loadout : scenario.r2Loadout);
  return {
    alliance: a,
    hiveUpwardCell: scenario.hiveUpwardCell ?? defaultUpwardCell(a),
    hivePollen: scenario.hiveInitialPieces?.pollenCount ?? 0,
    hiveNectar: scenario.hiveInitialPieces?.nectarCount ?? DEFAULT_HIVE_NECTAR,
    loadout: { robot1: [...(loadoutOf('robot1') ?? defaultLoadout(configs.robot1))], robot2: [...(loadoutOf('robot2') ?? defaultLoadout(configs.robot2))] },
    flowers: [...(scenario.flowerPiecesCount ?? [DEFAULT_FLOWER_PIECES, DEFAULT_FLOWER_PIECES, DEFAULT_FLOWER_PIECES, DEFAULT_FLOWER_PIECES])] as ScenarioView['flowers'],
    garden: { ...(scenario.gardenPiecesCount ?? { ally: DEFAULT_GARDEN_PIECES, opponent: DEFAULT_GARDEN_PIECES }) },
    autoTipCount: scenario.autoTipCount ?? 0,
    spawn: { robot1: { ...(spawnOf('robot1') ?? DEFAULT_SPAWN_POSES[a].robot1) }, robot2: { ...(spawnOf('robot2') ?? DEFAULT_SPAWN_POSES[a].robot2) } },
    spawnIsDefault: { robot1: spawnOf('robot1') === undefined, robot2: spawnOf('robot2') === undefined },
    seed: scenario.rngSeed ?? DEFAULT_RNG_SEED,
  };
}

// ------------------------------------------------------------
// 고치기 (새 시나리오 반환, 원본 불변)
// ------------------------------------------------------------

/** 헤딩 정규화 (−π, π] */
export function normalizeHeading(h: number): number {
  let v = h % (2 * Math.PI);
  if (v <= -Math.PI) v += 2 * Math.PI;
  if (v > Math.PI) v -= 2 * Math.PI;
  return v;
}

/** 좌우 대칭 자세: x → 144 − x, 헤딩 → π − 헤딩 (RED 기본 스폰 ↔ BLUE 기본 스폰) */
export function mirrorPose(p: RobotPose): RobotPose {
  return { x: FIELD_SIZE - p.x, y: p.y, heading: normalizeHeading(Math.PI - p.heading) };
}

/** 진영 전환 (09-11 확정): 지정한 시작 자세 좌우 대칭, 지정한 상향 셀 반대로, 나머지는 새 진영 기본값을 따름 */
export function setAlliance(scenario: ScenarioConfig, alliance: 'RED' | 'BLUE'): ScenarioConfig {
  if (scenario.allianceColor === alliance) return scenario;
  const next: ScenarioConfig = { ...scenario, allianceColor: alliance };
  if (scenario.r1Spawn) next.r1Spawn = mirrorPose(scenario.r1Spawn);
  if (scenario.r2Spawn) next.r2Spawn = mirrorPose(scenario.r2Spawn);
  if (scenario.hiveUpwardCell) next.hiveUpwardCell = scenario.hiveUpwardCell === 'AUDIENCE_CELL' ? 'OPPOSITE_CELL' : 'AUDIENCE_CELL';
  return next;
}

export function setUpwardCell(scenario: ScenarioConfig, cell: HiveCellChoice): ScenarioConfig {
  return { ...scenario, hiveUpwardCell: cell };
}

export function setHivePieces(scenario: ScenarioConfig, patch: Partial<{ pollenCount: number; nectarCount: number }>): ScenarioConfig {
  const current = { pollenCount: scenario.hiveInitialPieces?.pollenCount ?? 0, nectarCount: scenario.hiveInitialPieces?.nectarCount ?? DEFAULT_HIVE_NECTAR };
  return { ...scenario, hiveInitialPieces: { ...current, ...patch } };
}

export function setFlowerCount(scenario: ScenarioConfig, view: ScenarioView, index: number, count: number): ScenarioConfig {
  const flowers = [...view.flowers] as ScenarioView['flowers'];
  flowers[index] = count;
  return { ...scenario, flowerPiecesCount: flowers };
}

export function setGardenCount(scenario: ScenarioConfig, view: ScenarioView, side: 'ally' | 'opponent', count: number): ScenarioConfig {
  return { ...scenario, gardenPiecesCount: { ...view.garden, [side]: count } };
}

export function setAutoTipCount(scenario: ScenarioConfig, count: number): ScenarioConfig {
  return { ...scenario, autoTipCount: count };
}

/** 적재 칸 순환 (칸 클릭): POLLEN → NECTAR(흡입 가능 로봇만) → 빈 칸 → POLLEN */
export function nextSlotPiece(current: PieceType | null, canIntakeNectar: boolean): PieceType | null {
  if (current === 'POLLEN') return canIntakeNectar ? 'NECTAR' : null;
  if (current === 'NECTAR') return null;
  return 'POLLEN';
}

/**
 * 적재 칸 k를 piece로 (null = 빈 칸). 적재물은 순서 있는 목록(FIFO, 0번이 먼저 나감)이라 빈 칸은 목록에서 빠져 뒤로 모인다
 * (칸 k가 목록 길이 밖이면 끝에 붙임)
 */
export function setLoadoutSlot(scenario: ScenarioConfig, view: ScenarioView, robot: RobotId, slot: number, piece: PieceType | null): ScenarioConfig {
  const list: (PieceType | null)[] = [...view.loadout[robot]];
  if (slot < list.length) list[slot] = piece;
  else if (piece) list.push(piece);
  const loadout = list.filter((p): p is PieceType => p !== null);
  return robot === 'robot1' ? { ...scenario, r1Loadout: loadout } : { ...scenario, r2Loadout: loadout };
}

/** 시작 자세 한 축 (지정하지 않았으면 기본 스폰에서 시작) */
export function setSpawnAxis(scenario: ScenarioConfig, view: ScenarioView, robot: RobotId, axis: keyof RobotPose, value: number): ScenarioConfig {
  const pose = { ...view.spawn[robot], [axis]: value };
  return robot === 'robot1' ? { ...scenario, r1Spawn: pose } : { ...scenario, r2Spawn: pose };
}

/** 시작 자세 기본값으로 (지정 해제 → 진영 기본 스폰) */
export function resetSpawn(scenario: ScenarioConfig, robot: RobotId): ScenarioConfig {
  const next = { ...scenario };
  if (robot === 'robot1') delete next.r1Spawn;
  else delete next.r2Spawn;
  return next;
}

// ------------------------------------------------------------
// 시드 (09-11 확정: REROLL = 적용 값 / 초안에 바로 반영, 저장)
// ------------------------------------------------------------

/** 새 시드 (부호 없는 32비트, 지금 시드와 다르게) */
export function newSeed(current: number, random: () => number = Math.random): number {
  for (let i = 0; i < 16; i++) {
    const seed = Math.floor(random() * 2 ** 32) >>> 0;
    if (seed !== current) return seed;
  }
  return (current + 1) >>> 0;
}

/** REROLL: 적용 값과 초안의 시나리오 시드만 바꿈 (다른 초안 수정은 그대로) */
export function rerollSeed(drafts: ConfigDrafts, seed: number): ConfigDrafts {
  return {
    ...drafts,
    applied: { ...drafts.applied, scenario: { ...drafts.applied.scenario, rngSeed: seed } },
    draft: { ...drafts.draft, scenario: { ...drafts.draft.scenario, rngSeed: seed } },
  };
}

// ------------------------------------------------------------
// 입력 칸 / 검증 표시
// ------------------------------------------------------------

/** 개수 조절기 범위 (validateScenario 범위와 같음) */
export const COUNT_LIMITS = {
  hivePollen: TOTAL_POLLEN,
  hiveNectar: NECTAR_IN_PLAY,
  flower: FLOWER_MAX_START_PIECES,
  garden: GARDEN_MAX_PIECES,
  autoTip: INITIAL_HUMAN_NECTAR_STOCK,
} as const;

/** 시작 자세 숫자 칸 (좌표 0 ~ 144 in, 헤딩 −180 ~ 180°) */
export const SPAWN_FIELD_SPECS: Readonly<Record<keyof RobotPose, NumberFieldSpec>> = {
  x: { kind: 'coordinate', min: 0, max: FIELD_SIZE },
  y: { kind: 'coordinate', min: 0, max: FIELD_SIZE },
  heading: { kind: 'heading', min: -Math.PI, max: Math.PI },
};
export const SPAWN_AXES: readonly (keyof RobotPose)[] = ['x', 'y', 'heading'];
/** 틀린 입력 글자 키: spawn.robot1.x 등 */
export const spawnFieldKey = (robot: RobotId, axis: keyof RobotPose) => `spawn.${robot}.${axis}`;

/** 빨간 표시 묶음 키 */
export type ScenarioFieldGroup = 'hive' | `loadout.${RobotId}` | `flower.${number}` | 'garden.ally' | 'garden.opponent' | 'autoTip' | `spawn.${RobotId}`;

export interface ScenarioFormIssue {
  code: string;                   // 문구 사전 issue.* 키
  robot?: RobotId;                // 로봇별 문제 (문구의 {robot} / 앞머리)
  fields: ScenarioFieldGroup[];   // 빨간 표시할 칸 묶음
}

/**
 * 화면용 검증: tabIssues와 같은 문제를 로봇 / 칸 묶음과 함께. 적재물 문제는 로봇별로 다시 판정해 어느 로봇인지 붙인다
 * (엔진 문제에는 로봇 id가 없음). 배치 문제는 엔진이 준 로봇 목록 그대로 (로봇끼리 겹침은 두 로봇)
 */
export function scenarioFormIssues(values: DraftValues): ScenarioFormIssue[] {
  const { scenario } = values;
  const configs: Record<RobotId, RobotConfig> = { robot1: values.robot1.config, robot2: values.robot2.config };
  const view = readScenario(scenario, configs.robot1, configs.robot2);
  const out: ScenarioFormIssue[] = [];
  const counts: ScenarioFieldGroup[] = ['hive', 'flower.0', 'flower.1', 'flower.2', 'flower.3', 'garden.ally', 'garden.opponent', 'loadout.robot1', 'loadout.robot2'];
  const seen = new Set<string>();
  for (const issue of validateScenario(scenario, configs.robot1, configs.robot2)) {
    switch (issue.code) {
      case 'FLOWER_COUNT':
        if (seen.has(issue.code)) break;
        out.push({ code: issue.code, fields: view.flowers.map((_, i) => `flower.${i}` as const).filter((_, i) => !isCount(view.flowers[i], FLOWER_MAX_START_PIECES)) });
        break;
      case 'GARDEN_COUNT':
        if (seen.has(issue.code)) break;
        out.push({ code: issue.code, fields: (['ally', 'opponent'] as const).filter(s => !isCount(view.garden[s], GARDEN_MAX_PIECES)).map(s => `garden.${s}` as const) });
        break;
      case 'HIVE_COUNT':
      case 'HIVE_OVER_THRESHOLD':
        out.push({ code: issue.code, fields: ['hive'] });
        break;
      case 'LOADOUT_OVER_CAPACITY':
      case 'LOADOUT_NECTAR_NOT_ALLOWED':
        if (seen.has(issue.code)) break;
        for (const robot of ROBOTS) {
          const list = view.loadout[robot];
          const bad = issue.code === 'LOADOUT_OVER_CAPACITY' ? list.length > getCarryCapacity(configs[robot]) : !configs[robot].canIntakeNectar && list.includes('NECTAR');
          if (bad) out.push({ code: issue.code, robot, fields: [`loadout.${robot}`] });
        }
        break;
      case 'NECTAR_IN_PLAY_EXCEEDED':
        out.push({ code: issue.code, fields: ['hive', 'loadout.robot1', 'loadout.robot2'] });
        break;
      case 'POLLEN_TOTAL_EXCEEDED':
        out.push({ code: issue.code, fields: counts });
        break;
      case 'AUTO_TIP_COUNT':
        out.push({ code: issue.code, fields: ['autoTip'] });
        break;
    }
    seen.add(issue.code);
  }
  for (const issue of validateRobotPlacement(scenario, configs.robot1, configs.robot2)) {
    const robots = issue.robots.filter((r): r is RobotId => r === 'robot1' || r === 'robot2');
    out.push({ code: issue.code, ...(robots.length === 1 ? { robot: robots[0] } : {}), fields: robots.map(r => `spawn.${r}` as const) });
  }
  return out;
}

function isCount(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/** 빨간 표시할 칸 묶음 모음 */
export function issueFieldSet(issues: readonly ScenarioFormIssue[]): Set<ScenarioFieldGroup> {
  return new Set(issues.flatMap(i => i.fields));
}

/**
 * 바닥 무작위 산포 / 휴먼 플레이어 재고 요약 (2.4 자동 계산, 참고 표시):
 * 바닥 POLLEN = 32 − 지정 POLLEN, 바닥 NECTAR = 3 − (HIVE + 적재 NECTAR), 재고 = 5 − 오토 팁 (음수는 0)
 */
export function floorSummary(view: ScenarioView): { floorPollen: number; floorNectar: number; stock: number } {
  const loaded = [...view.loadout.robot1, ...view.loadout.robot2];
  const pollen = loaded.filter(p => p === 'POLLEN').length + view.flowers.reduce((a, b) => a + b, 0) + view.hivePollen + view.garden.ally + view.garden.opponent;
  const nectar = loaded.filter(p => p === 'NECTAR').length + view.hiveNectar;
  return {
    floorPollen: Math.max(0, TOTAL_POLLEN - pollen),
    floorNectar: Math.max(0, NECTAR_IN_PLAY - nectar),
    stock: Math.max(0, INITIAL_HUMAN_NECTAR_STOCK - view.autoTipCount),
  };
}
