// 저장 레시피 (명세서 3.9 저장 레시피 / 상태 체크섬, 10-3). 15-1: 분기 트리 형식 (버전 2), 버전 1 파일 계속 읽기
import { describe, expect, it } from 'vitest';
import { BALLISTICS_MODEL_VERSION } from '../../core/ballistics';
import { CHECKPOINT_COUNT, compareCheckpoints, fnv1a32, frameChecksum, timelineCheckpoints } from '../../core/checksum';
import { DEFAULT_RNG_SEED, DEFAULT_SPAWN_POSES, ENGINE_VERSION, LEGACY_BLUE_SPAWN_POSES, MATCH_TICKS, SimulationEngine } from '../../core/simulationEngine';
import type { TickControls } from '../../input/controls';
import { LOG_RECORD_BYTES, MatchInputs, createInputRecordProvider } from '../../input/inputLog';
import type { RobotId } from '../../input/inputConfig';
import type { DraftValues } from '../../ui/configDraft';
import { DEFAULT_DRAFT_VALUES, setupFromDrafts } from '../defaultSetup';
import {
  CURRENT_LUT_SETTINGS,
  RECIPE_VERSION,
  appliedInputRecords,
  branchInputRecords,
  buildMatchRecipe,
  decodeInputRecord,
  encodeInputRecord,
  isoLocal,
  parseMatchRecipe,
  recipeWarnings,
  serializeMatchRecipe,
  timelineRecord,
  verifyRecipe,
} from '../matchRecipe';
import type { MatchRecipe, RecipeBranchSource } from '../matchRecipe';
import { MAX_BRANCHES } from '../branchTree';
import { MAX_IMPORT_BYTES } from '../../ui/presetFile';

const TEST_TIMEOUT_MS = 120_000;
const defaults = DEFAULT_DRAFT_VALUES;
// 시나리오를 바꿔 기본값이 아닌 항목(시드 / 시작 자세 / 오토 TIP)도 왕복시킨다. 팀 번호 / 팀명도 채움
const values: DraftValues = {
  robot1: { ...defaults.robot1, teamNumber: '12345', teamName: 'Bumblebots' },
  robot2: { ...defaults.robot2, teamName: 'Hive Mind', config: { ...defaults.robot2.config, maxSpeed: 50 } },
  scenario: { allianceColor: 'BLUE', autoTipCount: 2, rngSeed: 4242, r1Spawn: { x: 135, y: 80, heading: Math.PI } },
};
const engineFor = (v: DraftValues) => {
  const s = setupFromDrafts(v);
  return new SimulationEngine(s.r1Config, s.r2Config, s.shotJudge, v.scenario.allianceColor, v.scenario, s.shooters);
};
// 결정론적 조작 스크립트 (주행 / 회전 + 흡입 · 발사 + 리프트)
const script = (t: number, seed: number): TickControls => ({
  forward: Math.sin(t / 41 + seed),
  right: 0.6 * Math.cos(t / 59 + seed),
  turn: 0.4 * Math.sin(t / 31 + 2 * seed),
  intake: t % 400 < 150,
  shoot: t % 400 >= 200 && t % 400 < 230,
  drop: t % 500 > 300 && t % 500 < 320,
  liftPressed: t % 500 === 250 || t % 500 === 340,
});

// 녹화 덧입히기 + REPLAY → NONE 전환이 들어간 경기 (녹화 로그만으로는 재현 불가, 3.9항)
function playOverdubMatch(): { engine: SimulationEngine; inputs: MatchInputs } {
  const engine = engineFor(values);
  const inputs = new MatchInputs();
  inputs.sources.robot2 = 'NONE';
  while (engine.currentTick < MATCH_TICKS) inputs.step(engine, { robot1: script(engine.currentTick, 0) });
  engine.scrubTo(1000);
  inputs.sources.robot1 = 'REPLAY';
  inputs.sources.robot2 = 'LIVE';
  while (engine.currentTick < 3000) inputs.step(engine, { robot2: script(engine.currentTick, 3) });
  inputs.sources.robot1 = 'NONE';
  while (engine.currentTick < MATCH_TICKS) inputs.step(engine, { robot2: script(engine.currentTick, 3) });
  return { engine, inputs };
}

let cached: { recipe: MatchRecipe; text: string; engine: SimulationEngine } | null = null;
function sample() {
  if (!cached) {
    const { engine, inputs } = playOverdubMatch();
    const root: RecipeBranchSource = { number: 1, parent: null, forkTick: 0, name: 'Branch 3', inputs: appliedInputRecords(inputs), record: timelineRecord(engine.timeline) };
    const recipe = buildMatchRecipe({ setup: values, branches: [root], current: 1, nextNumber: 2, createdAt: new Date(2026, 8, 30, 14, 32, 5) });
    cached = { recipe, text: serializeMatchRecipe(recipe), engine };
  }
  return cached;
}
// 파일 JSON 고치기: [경로, 새 값 | DEL | (옛 값) => 새 값]. 경로는 점으로 (배열 번호 포함)
const DEL = Symbol('delete');
type Change = [path: string, value: unknown];
const applyChanges = (file: Record<string, unknown>, changes: Change[]): string => {
  for (const [path, value] of changes) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, file);
    if (value === DEL) delete parent[last];
    else parent[last] = typeof value === 'function' ? (value as (old: unknown) => unknown)(parent[last]) : value;
  }
  return JSON.stringify(file);
};
const edit = (...changes: Change[]): string => applyChanges(JSON.parse(sample().text) as Record<string, unknown>, changes);
// 같은 경기를 형식 버전 1 파일(v1.0.0, 끝난 가지 하나)로 바꾼 뒤 고치기 (sample()은 원본 가지 하나짜리 버전 2 트리)
const editV1 = (...changes: Change[]): string => {
  const file = JSON.parse(sample().text) as Record<string, unknown> & { branches: { name: string; inputs: Record<string, string>; checksums: string[]; result: unknown }[] };
  const [root] = file.branches;
  const v1: Record<string, unknown> = {
    format: file.format, recipeVersion: 1, engineVersion: file.engineVersion, ballisticsModelVersion: file.ballisticsModelVersion, createdAt: file.createdAt, setup: file.setup, lut: file.lut,
    inputs: { ticks: MATCH_TICKS, ...root.inputs }, checksums: { interval: 50, values: root.checksums }, branch: { name: root.name }, result: root.result,
  };
  return applyChanges(v1, changes);
};
const parse = (text: string) => parseMatchRecipe(text, defaults);

describe('저장 레시피 (10-3)', () => {
  it('A. 입력 RLE + Base64: 왕복 / 연속 중복 압축 / 틀린 입력 거부', () => {
    const data = new Int8Array(MATCH_TICKS * LOG_RECORD_BYTES);
    for (let t = 0; t < MATCH_TICKS; t++) data.set(t < 3000 ? [127, -127, 5, 2] : [t % 7, -(t % 5), 0, t % 5], t * 4);
    const text = encodeInputRecord(data);
    expect(Array.from(decodeInputRecord(text)!)).toEqual(Array.from(data));
    // 같은 입력 3000틱 = 1묶음 (6 B), 전부 중립 = 1묶음
    expect(atob(text).length).toBe(6 + 3000 * 6);
    const idle = encodeInputRecord(new Int8Array(MATCH_TICKS * 4));
    expect(Array.from(atob(idle), c => c.charCodeAt(0))).toEqual([0x70, 0x17, 0, 0, 0, 0]); // 6000 = 0x1770 LE
    expect(() => encodeInputRecord(new Int8Array(10))).toThrow(RangeError);

    const bytes = (runs: number[][]) => btoa(String.fromCharCode(...runs.flat().map(b => b & 0xff)));
    expect(decodeInputRecord(bytes([[0x70, 0x17, 1, 2, 3, 4]]))).not.toBeNull();
    expect(decodeInputRecord('@@not base64@@')).toBeNull();
    expect(decodeInputRecord(123)).toBeNull();
    expect(decodeInputRecord('')).toBeNull();
    expect(decodeInputRecord(btoa('12345'))).toBeNull();                                  // 묶음 길이 아님
    expect(decodeInputRecord(bytes([[0x6f, 0x17, 0, 0, 0, 0]]))).toBeNull();              // 합 5999
    expect(decodeInputRecord(bytes([[0x70, 0x17, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]]))).toBeNull(); // 합 6001
    expect(decodeInputRecord(bytes([[0, 0, 0, 0, 0, 0], [0x70, 0x17, 0, 0, 0, 0]]))).toBeNull(); // 반복 0
    expect(decodeInputRecord(bytes([[0x70, 0x17, -128, 0, 0, 0]]))).toBeNull();           // q = −128
    expect(decodeInputRecord(bytes([[0x70, 0x17, 0, 0, 0, 5]]))).toBeNull();              // 행동 코드 5
  });

  it('B. 체크섬: FNV-1a 32비트 / 체크포인트 121개 / 비교 결과', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('ab')).not.toBe(fnv1a32('ba'));
    expect(fnv1a32('가')).not.toBe(fnv1a32('\u0000')); // UTF-16 코드 단위 전체 (0xAC00의 상위 바이트까지)
    expect(fnv1a32('가')).toBe('0462591f');
    const e = engineFor(defaults);
    e.runFullMatch();
    const sums = timelineCheckpoints(e.timeline);
    expect(sums).toHaveLength(CHECKPOINT_COUNT);
    expect(sums[0]).toBe(frameChecksum(e.getFrame(0)!));
    expect(sums[120]).toBe(frameChecksum(e.getFrame(6000)!));
    expect(timelineCheckpoints(e.timeline.slice(0, 120))).toHaveLength(3); // 0, 50, 100
    expect(compareCheckpoints(sums, sums)).toEqual({ match: true });
    const changed = sums.map((s, i) => (i >= 5 ? '00000000' : s));
    expect(compareCheckpoints(sums, changed)).toEqual({ match: false, index: 5, lastMatchTick: 200, firstMismatchTick: 250 });
    expect(compareCheckpoints(sums, ['x', ...sums.slice(1)])).toEqual({ match: false, index: 0, lastMatchTick: null, firstMismatchTick: 0 });
    expect(compareCheckpoints(sums, sums.slice(0, 100))).toEqual({ match: false, index: 100, lastMatchTick: 4950, firstMismatchTick: 5000 });
  }, TEST_TIMEOUT_MS);

  it('C. 저장 → 파일 → 해석 → 재계산: 녹화 덧입히기 + REPLAY → NONE 전환 경기도 체크포인트 전부 일치', () => {
    const { recipe, text, engine } = sample();
    expect(recipe.engineVersion).toBe(ENGINE_VERSION);
    expect(recipe.ballisticsModelVersion).toBe(BALLISTICS_MODEL_VERSION);
    expect(recipe.lut).toEqual(CURRENT_LUT_SETTINGS);
    expect(recipe.branches[0].checksums).toHaveLength(CHECKPOINT_COUNT);
    expect(recipe.branches[0].result).toEqual({ totalScore: engine.getFrame(6000)!.totalScore, rp: engine.getFrame(6000)!.rpAchieved });

    const file = JSON.parse(text);
    expect(RECIPE_VERSION).toBe(2);
    expect(file).toMatchObject({ format: 'ftc-tactic-sim/match', recipeVersion: 2, checkpointInterval: 50, current: 1, nextNumber: 2, branches: [{ number: 1, parent: null, forkTick: 0, headTick: 6000, name: 'Branch 3' }] });
    expect(file.setup.robot1.config.id).toBeUndefined();
    expect(text.length).toBeLessThan(120_000);

    const parsed = parse(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(parsed.recipe.setup).toEqual(values);
    expect(parsed.recipe.branches[0].name).toBe('Branch 3');
    expect(parsed.recipe.createdAt).toBe(recipe.createdAt);
    expect(Array.from(parsed.recipe.branches[0].inputs.robot1)).toEqual(Array.from(recipe.branches[0].inputs.robot1));
    const records = branchInputRecords(parsed.recipe, 1)!;

    // 파일만으로 재계산 → 체크포인트 전부 일치 + 종료 프레임 동일
    const replay = engineFor(parsed.recipe.setup);
    replay.inputProvider = createInputRecordProvider(records);
    replay.runFullMatch();
    expect(verifyRecipe(parsed.recipe.branches[0], replay.timeline)).toEqual({ match: true });
    expect(JSON.stringify(replay.getFrame(6000))).toBe(JSON.stringify(engine.getFrame(6000)));
    // 시드가 다르면 결과가 달라지고 체크섬이 그 구간을 잡는다
    const other = engineFor({ ...parsed.recipe.setup, scenario: { ...parsed.recipe.setup.scenario, rngSeed: 1 } });
    other.inputProvider = createInputRecordProvider(records);
    other.runFullMatch();
    expect(verifyRecipe(parsed.recipe.branches[0], other.timeline)).toMatchObject({ match: false });
  }, TEST_TIMEOUT_MS);

  it('D. 만들기: 입력 부족 / 트리 구조가 틀리면 오류, 끝나지 않은 가지도 저장, 시드가 비어 있으면 엔진 기본 시드, 로컬 시각 + 시간대', () => {
    const e = engineFor(defaults);
    const inputs: Record<RobotId, Int8Array> = { robot1: new Int8Array(MATCH_TICKS * 4), robot2: new Int8Array(MATCH_TICKS * 4) };
    const root = (timeline: Parameters<typeof timelineRecord>[0], over: Partial<RecipeBranchSource> = {}): RecipeBranchSource => ({ number: 1, parent: null, forkTick: 0, name: null, inputs, record: timelineRecord(timeline), ...over });
    const build = (b: RecipeBranchSource[], current = 1, nextNumber = 2) => buildMatchRecipe({ setup: defaults, branches: b, current, nextNumber, createdAt: new Date(2026, 0, 2, 3, 4, 5) });
    for (let i = 0; i < 120; i++) e.step();
    const early = build([root(e.timeline)]); // 끝나지 않은 가지: 머리 120, 체크포인트 0 / 50 / 100, 결과 없음
    expect([early.branches[0].headTick, early.branches[0].checksums.length, early.branches[0].result, early.branches[0].inputs.robot1.length]).toEqual([120, 3, null, 480]);
    e.runFullMatch();
    expect(() => build([root(e.timeline, { inputs: { ...inputs, robot2: new Int8Array(40) } })])).toThrow(RangeError);
    expect(() => build([root(e.timeline, { number: 2 })], 2, 3)).toThrow(RangeError);                 // 원본 번호 ≠ 1
    expect(() => build([root(e.timeline)], 5)).toThrow(RangeError);                                    // 없는 지금 가지
    expect(() => build([root(e.timeline)], 1, 1)).toThrow(RangeError);                                 // 다음 번호 ≤ 가장 큰 번호
    expect(() => build([root(e.timeline), root(e.timeline, { number: 2, parent: 9, forkTick: 10 })], 1, 3)).toThrow(RangeError); // 없는 부모
    const r = build([root(e.timeline)]);
    expect(r.setup.scenario.rngSeed).toBe(DEFAULT_RNG_SEED);
    expect(defaults.scenario.rngSeed).toBeUndefined(); // 원본 불변
    expect(r.createdAt).toMatch(/^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
    expect(isoLocal(new Date(2026, 11, 31, 23, 59, 59))).toMatch(/^2026-12-31T23:59:59[+-]\d{2}:\d{2}$/);
    // 시드를 채운 파일도 재계산 결과가 같다 (미지정 = 기본 시드)
    const parsed = parse(serializeMatchRecipe(r));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const replay = engineFor(parsed.recipe.setup);
    replay.inputProvider = createInputRecordProvider(branchInputRecords(parsed.recipe, 1)!);
    replay.runFullMatch();
    expect(verifyRecipe(parsed.recipe.branches[0], replay.timeline)).toEqual({ match: true });
  }, TEST_TIMEOUT_MS);

  it('E. 거부: 파일 형식 / 형식 버전 / 항목 누락 · 형식 틀림(기본값으로 채우지 않음) / 입력 / 체크포인트 / 설정 검증', () => {
    const code = (text: string) => {
      const r = parse(text);
      return r.ok ? 'OK' : r.error;
    };
    expect(code('{oops')).toEqual({ code: 'NOT_JSON' });
    expect(code(JSON.stringify({ format: 'ftc-tactic-sim/preset', presetVersion: 1, kind: 'ROBOT', data: {} }))).toEqual({ code: 'PRESET_FILE' });
    expect(code('[]')).toEqual({ code: 'NOT_RECIPE' });
    expect(code(edit(['recipeVersion', 3]))).toEqual({ code: 'RECIPE_VERSION', version: 3 });
    expect(code(edit(['recipeVersion', DEL]))).toEqual({ code: 'RECIPE_VERSION', version: undefined });
    expect(code(edit(['engineVersion', 0]))).toEqual({ code: 'INVALID_FIELD', field: 'engineVersion' });
    expect(code(edit(['ballisticsModelVersion', '1']))).toEqual({ code: 'INVALID_FIELD', field: 'ballisticsModelVersion' });
    expect(code(edit(['setup.robot1.config.maxSpeed', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot2.teamName', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot2' });
    expect(code(edit(['setup.robot1.teamNumber', '12a']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot1.config.intakeZones.0.side', 'TOP']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot1.ballistics.sweetSpot', { x: 1 }]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.scenario.rngSeed', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup.scenario.allianceColor', 'GREEN']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup.scenario.r1Spawn', { x: 1, y: 2 }]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup.scenario.autoTipCount', 'two']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['lut.samples', 0]))).toEqual({ code: 'INVALID_FIELD', field: 'lut' });
    expect(code(edit(['branches.0.headTick', 5999]))).toEqual({ code: 'INVALID_INPUTS', field: 'branches[0].robot1' }); // 입력 길이 ≠ 머리 − 분기
    expect(code(edit(['branches.0.inputs.robot2', (old: unknown) => String(old).slice(0, -8)]))).toEqual({ code: 'INVALID_INPUTS', field: 'branches[0].robot2' });
    expect(code(edit(['branches.0.checksums', (old: unknown) => (old as string[]).slice(0, -1)]))).toEqual({ code: 'INVALID_CHECKSUMS', field: 'branches[0]' });
    expect(code(edit(['branches.0.checksums.3', 'ABCDEF12']))).toEqual({ code: 'INVALID_CHECKSUMS', field: 'branches[0]' });
    expect(code(edit(['checkpointInterval', 25]))).toEqual({ code: 'INVALID_CHECKSUMS', field: 'checkpointInterval' });
    // 버전 1 파일의 입력 / 체크포인트 규칙은 그대로
    expect(code(editV1(['inputs.ticks', 5999]))).toEqual({ code: 'INVALID_INPUTS', field: 'ticks' });
    expect(code(editV1(['inputs.robot2', (old: unknown) => String(old).slice(0, -8)]))).toEqual({ code: 'INVALID_INPUTS', field: 'robot2' });
    expect(code(editV1(['checksums.values', (old: unknown) => (old as string[]).slice(0, -1)]))).toEqual({ code: 'INVALID_CHECKSUMS' });
    expect(code(editV1(['checksums.interval', 25]))).toEqual({ code: 'INVALID_CHECKSUMS' });
    // 형식은 맞지만 검증 실패: 최고 속도 범위 밖 / 시작 자세 겹침
    const bad = parse(edit(['setup.robot1.config.maxSpeed', 999]));
    expect(!bad.ok && bad.error.code === 'INVALID_SETUP' && bad.error.issues).toContain('FIELD_maxSpeed');
    const overlap = parse(edit(['setup.scenario.r2Spawn', { x: 135, y: 80, heading: 0 }]));
    expect(!overlap.ok && overlap.error.code === 'INVALID_SETUP' && overlap.error.issues).toContain('PLACEMENT_ROBOT_OVERLAP');
  }, TEST_TIMEOUT_MS);

  it('F. 알아보기 정보(가지 이름 / 결과 / 시각)는 틀려도 거부하지 않음, 모르는 항목은 무시, 버전 · LUT 설정 차이는 경고', () => {
    const loose = parse(edit(['branches.0.name', 7], ['branches.0.result', { totalScore: 'many' }], ['createdAt', DEL], ['extra', true], ['setup.robot1.config.color', 'yellow']));
    expect(loose.ok && [loose.recipe.branches[0].name, loose.recipe.branches[0].result, loose.recipe.createdAt]).toEqual([null, null, '']);
    const looseV1 = parse(editV1(['branch', 7], ['result', { totalScore: 'many' }]));
    expect(looseV1.ok && [looseV1.recipe.branches[0].name, looseV1.recipe.branches[0].result]).toEqual([null, null]);
    const warned = parse(edit(['engineVersion', ENGINE_VERSION + 1], ['ballisticsModelVersion', BALLISTICS_MODEL_VERSION + 1], ['lut.samples', 100]));
    expect(warned.ok && warned.warnings).toEqual([
      { code: 'ENGINE_VERSION', file: ENGINE_VERSION + 1, current: ENGINE_VERSION },
      { code: 'BALLISTICS_VERSION', file: BALLISTICS_MODEL_VERSION + 1, current: BALLISTICS_MODEL_VERSION },
      { code: 'LUT_SETTINGS' },
    ]);
    expect(recipeWarnings({ engineVersion: ENGINE_VERSION, ballisticsModelVersion: BALLISTICS_MODEL_VERSION, lut: { ...CURRENT_LUT_SETTINGS, seed: 1 } })).toEqual([{ code: 'LUT_SETTINGS' }]);
  }, TEST_TIMEOUT_MS);

  it('G. (11-2) 버전 1 경기 파일: v2.0.0 로봇 항목이 없으면 변환으로 채움(NECTAR 슈터 = 주 슈터 복사), 있으면 엄격 검사, 버전 2 파일은 모두 있어야 함 (15-1)', () => {
    const v1 = (id: RobotId): Change[] => [
      [`setup.${id}.config.shooterSetup`, DEL], [`setup.${id}.config.nectarShooter`, DEL], [`setup.${id}.config.flowerDropZones`, DEL], [`setup.${id}.config.liftMaxSpeed`, DEL],
      [`setup.${id}.ballistics.shooterLateralOffset`, DEL], [`setup.${id}.ballistics.nectarShooter`, DEL],
    ];
    // R2 주 슈터를 바꾼 v1 파일 → NECTAR 슈터는 그 값의 복사
    const old = parse(editV1(...v1('robot1'), ...v1('robot2'), ['setup.robot2.config.shooterDelay', 250], ['setup.robot2.ballistics.dz', 41]));
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect([old.recipe.branches.length, old.recipe.branches[0].headTick, old.recipe.branches[0].name, old.recipe.current, old.recipe.nextNumber]).toEqual([1, 6000, 'Branch 3', 1, 2]);
    expect(old.recipe.setup.robot1).toEqual(sample().recipe.setup.robot1); // 기본 프로필은 주 슈터 = NECTAR 슈터라 변환 결과가 원래와 같음
    const r2 = old.recipe.setup.robot2;
    expect([r2.config.shooterSetup, r2.config.nectarShooter.shooterDelay, r2.config.flowerDropZones, r2.config.liftMaxSpeed]).toEqual(['SHARED', 250, [], 0]);
    expect([r2.ballistics.shooterLateralOffset, r2.ballistics.nectarShooter.dz, r2.ballistics.nectarShooter.shooterLateralOffset]).toEqual([0, 41, 0]);

    const code = (text: string) => {
      const r = parse(text);
      return r.ok ? 'OK' : r.error;
    };
    // 버전 1: 일부만 없어도 그 항목만 채움 / 버전 2: 하나라도 없으면 거부
    expect(code(editV1(['setup.robot1.config.liftMaxSpeed', DEL]))).toBe('OK');
    expect(code(edit(['setup.robot1.config.liftMaxSpeed', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot2.ballistics.shooterLateralOffset', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot2' });
    // 있는 새 항목은 형식이 맞아야 함 (기본값으로 채우지 않음)
    expect(code(edit(['setup.robot1.config.shooterSetup', 'TRIPLE']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot1.config.nectarShooter.turretType', 'LASER']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot2.ballistics.nectarShooter.dz', DEL]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot2' });
    expect(code(edit(['setup.robot1.config.flowerDropZones', [{ side: 'TOP', offset: 0, width: 5, depth: 1 }]]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    expect(code(edit(['setup.robot1.ballistics.shooterLateralOffset', '3']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.robot1' });
    // 시나리오 새 선택 항목: 형식이 맞으면 그대로, 틀리면 거부
    const floor = [{ type: 'POLLEN', x: 70.5, y: 120 }];
    // (PARK는 시작 자세가 LOADING ZONE 안이어야 해서 — 12-5 검증 — 이 경기의 R1 자세로는 NONE)
    // (지정 바닥 기물은 바닥 기물 수 안에서만 — 12-6 검증 — 이 경기는 바닥 POLLEN이 0개라 GARDEN을 1개 줄여 1개를 만든다)
    const withNew = parse(edit(['setup.scenario.gardenPiecesCount', { ally: 3, opponent: 4 }], ['setup.scenario.floorPieces', floor], ['setup.scenario.rpThresholds', { swarmPoints: 14, pollinator1Tips: 3, pollinator2Tips: 6 }], ['setup.scenario.r1AutoMovement', 'NONE']));
    expect(withNew.ok && [withNew.recipe.setup.scenario.floorPieces, withNew.recipe.setup.scenario.rpThresholds?.swarmPoints, withNew.recipe.setup.scenario.r1AutoMovement]).toEqual([floor, 14, 'NONE']);
    const tooMany = parse(edit(['setup.scenario.floorPieces', floor]));
    expect(!tooMany.ok && tooMany.error.code === 'INVALID_SETUP' && tooMany.error.issues).toContain('FLOOR_PIECE_COUNT');
    const parkOutside = parse(edit(['setup.scenario.r1AutoMovement', 'PARK']));
    expect(!parkOutside.ok && parkOutside.error.code === 'INVALID_SETUP' && parkOutside.error.issues).toContain('AUTO_PARK_NOT_IN_ZONE');
    expect(code(edit(['setup.scenario.floorPieces', [{ type: 'ROCK', x: 1, y: 2 }]]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup.scenario.rpThresholds', { swarmPoints: 16 }]))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    expect(code(edit(['setup.scenario.r2AutoMovement', 'FLY']))).toEqual({ code: 'INVALID_FIELD', field: 'setup.scenario' });
    // 내보낸 파일에는 새 로봇 항목이 들어 있음
    const robot1 = (JSON.parse(sample().text) as { setup: { robot1: { config: Record<string, unknown>; ballistics: Record<string, unknown> } } }).setup.robot1;
    expect([robot1.config.shooterSetup, robot1.config.liftMaxSpeed, robot1.ballistics.shooterLateralOffset]).toEqual(['SHARED', 0, 0]);
  }, TEST_TIMEOUT_MS);

  it('G-2. (11-3) 없어진 허용 조준 오차 aimTolerance: 파일에 있어도(v1 / v2 개발 중 파일) 버리고 통과, 내보낸 파일에는 없음', () => {
    const v1 = parse(editV1(
      ['setup.robot1.config.aimTolerance', 0.0524], ['setup.robot1.config.nectarShooter', DEL],
      ['setup.robot2.config.aimTolerance', 0.1], ['setup.robot2.config.nectarShooter.aimTolerance', 0.1],
    ));
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.recipe.setup).toEqual(sample().recipe.setup);
    const v2 = parse(edit(['setup.robot1.config.aimTolerance', 0.0524], ['setup.robot2.config.nectarShooter.aimTolerance', 0.1]));
    expect(v2.ok && v2.recipe.setup).toEqual(sample().recipe.setup);
    const robot1 = (JSON.parse(sample().text) as { setup: { robot1: { config: Record<string, unknown> & { nectarShooter: Record<string, unknown> } } } }).setup.robot1;
    expect('aimTolerance' in robot1.config || 'aimTolerance' in robot1.config.nectarShooter).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('H. (14-1a) 엔진 버전 1 파일의 BLUE 시나리오: 없는 시작 자세 = v1 BLUE 기본값(로봇 위치 유지), 지금 버전 파일은 그대로', () => {
    const v1 = parse(edit(['engineVersion', 1]));
    expect(v1.ok && v1.recipe.setup.scenario.r2Spawn).toEqual(LEGACY_BLUE_SPAWN_POSES.robot2);
    expect(v1.ok && v1.recipe.setup.scenario.r1Spawn).toEqual(values.scenario.r1Spawn); // 지정한 자세는 그대로
    const current = parse(sample().text);
    expect(current.ok && current.recipe.setup.scenario).not.toHaveProperty('r2Spawn');
    expect(LEGACY_BLUE_SPAWN_POSES.robot2).not.toEqual(DEFAULT_SPAWN_POSES.BLUE.robot2);
  }, TEST_TIMEOUT_MS);

  it('I. (15-1) 분기 트리: 끝나지 않은 가지 / 부모의 분기 틱보다 앞에서 갈라진 손자 / 빈 가지 왕복, 가지마다 재계산 체크포인트 일치, 거부 규칙, 크기', () => {
    // 로봇별 입력 기록(틱당 4 B)을 틱의 순수 함수로 만든다 (q ∈ [−127, 127], 행동 코드 0 ~ 4)
    const rec = (seed: number) => (t: number) => [((t * 7 + seed * 13) % 255) - 127, ((t * 3 + seed * 5) % 255) - 127, ((t + seed) % 61) - 30, Math.floor(t / 40 + seed) % 5];
    const compose = (head: number, parts: [from: number, gen: (t: number) => number[]][]): Record<RobotId, Int8Array> => {
      const make = (offset: number) => {
        const out = new Int8Array(head * 4);
        for (let t = 0; t < head; t++) {
          const gen = [...parts].reverse().find(([from]) => t >= from)![1];
          out.set(gen(t + offset), t * 4);
        }
        return out;
      };
      return { robot1: make(0), robot2: make(1000) };
    };
    const run = (records: Record<RobotId, Int8Array>, head: number) => {
      const e = engineFor(values);
      e.inputProvider = createInputRecordProvider(records);
      while (e.currentTick < head) e.step();
      return e.timeline;
    };
    // 원본 1: 끝까지 / 가지 2: 원본 2000틱에서, 3500틱까지(미종료) / 가지 5: 가지 2의 1000틱에서(2의 분기 틱보다 앞), 끝까지 / 가지 6: 원본 4000틱에서 바로 멈춤(빈 가지)
    const full = {
      1: compose(6000, [[0, rec(1)]]),
      2: compose(3500, [[0, rec(1)], [2000, rec(2)]]),
      5: compose(6000, [[0, rec(1)], [1000, rec(5)]]),
      6: compose(4000, [[0, rec(1)]]),
    };
    const src: RecipeBranchSource[] = [
      { number: 1, parent: null, forkTick: 0, name: null, inputs: full[1], record: timelineRecord(run(full[1], 6000)) },
      { number: 2, parent: 1, forkTick: 2000, name: '  Plan B  ', inputs: full[2], record: timelineRecord(run(full[2], 3500)) },
      { number: 5, parent: 2, forkTick: 1000, name: null, inputs: full[5], record: timelineRecord(run(full[5], 6000)) },
      { number: 6, parent: 1, forkTick: 4000, name: null, inputs: full[6], record: timelineRecord(run(full[6], 4000)) },
    ];
    const recipe = buildMatchRecipe({ setup: values, branches: src, current: 2, nextNumber: 7, createdAt: new Date(2026, 9, 21, 10, 0, 0) });
    expect(recipe.branches.map(b => [b.number, b.parent, b.forkTick, b.headTick, b.name, b.inputs.robot1.length / 4, b.checksums.length, b.result !== null]))
      .toEqual([[1, null, 0, 6000, null, 6000, 121, true], [2, 1, 2000, 3500, 'Plan B', 1500, 71, false], [5, 2, 1000, 6000, null, 5000, 121, true], [6, 1, 4000, 4000, null, 0, 81, false]]);
    const text = serializeMatchRecipe(recipe);
    expect(JSON.parse(text).branches[3].inputs).toEqual({ robot1: '', robot2: '' }); // 빈 가지 = 빈 글자
    const parsed = parse(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([parsed.recipe.current, parsed.recipe.nextNumber]).toEqual([2, 7]);
    expect(parsed.recipe.branches.map(b => [b.number, b.parent, b.forkTick, b.headTick, b.name])).toEqual(recipe.branches.map(b => [b.number, b.parent, b.forkTick, b.headTick, b.name]));
    // 가지마다: 조상 구간을 이어 붙인 입력 = 원래 전체 입력, 재계산 체크포인트 일치
    for (const [number, records] of Object.entries(full)) {
      const joined = branchInputRecords(parsed.recipe, Number(number))!;
      expect(Array.from(joined.robot1)).toEqual(Array.from(records.robot1));
      expect(Array.from(joined.robot2)).toEqual(Array.from(records.robot2));
      const branch = parsed.recipe.branches.find(b => b.number === Number(number))!;
      expect(verifyRecipe(branch, run(joined, branch.headTick))).toEqual({ match: true });
    }
    expect(branchInputRecords(parsed.recipe, 3)).toBeNull();

    // 거부: 가지 수 상한 / 구조 / 지금 가지 / 다음 번호
    const code = (changes: Change[]) => {
      const r = parse(applyChanges(JSON.parse(text) as Record<string, unknown>, changes));
      return r.ok ? 'OK' : r.error;
    };
    const many = Array.from({ length: MAX_BRANCHES + 1 }, (_, i) => ({ ...JSON.parse(text).branches[0], number: i + 1, parent: i === 0 ? null : 1, forkTick: i === 0 ? 0 : 10, headTick: i === 0 ? 6000 : 10, inputs: i === 0 ? JSON.parse(text).branches[0].inputs : { robot1: '', robot2: '' }, checksums: i === 0 ? JSON.parse(text).branches[0].checksums : ['00000000'] }));
    expect(code([['branches', many], ['nextNumber', 20]])).toEqual({ code: 'TOO_MANY_BRANCHES', count: MAX_BRANCHES + 1 });
    expect(code([['branches', many.slice(0, MAX_BRANCHES)], ['current', 1], ['nextNumber', 20]])).toBe('OK');
    expect(code([['branches.1.parent', 9]])).toEqual({ code: 'INVALID_FIELD', field: 'branches[1]' });       // 없는 부모
    expect(code([['branches.2.parent', 6]])).toEqual({ code: 'INVALID_FIELD', field: 'branches[2]' });       // 뒤에 있는 부모
    expect(code([['branches.2.forkTick', 3500], ['branches.2.inputs', JSON.parse(serializeMatchRecipe({ ...recipe, branches: [recipe.branches[0], recipe.branches[1], { ...recipe.branches[2], forkTick: 3500, inputs: { robot1: recipe.branches[2].inputs.robot1.slice(0, 2500 * 4), robot2: recipe.branches[2].inputs.robot2.slice(0, 2500 * 4) } }, recipe.branches[3]] })).branches[2].inputs]]))
      .toEqual({ code: 'INVALID_FIELD', field: 'branches[2]' });                                             // 부모(가지 2) 머리 3500에서 분기 = 불가
    expect(code([['branches.1.number', 1]])).toEqual({ code: 'INVALID_FIELD', field: 'branches[1]' });       // 번호 중복
    expect(code([['branches.0.parent', 2]])).toEqual({ code: 'INVALID_FIELD', field: 'branches[0]' });       // 원본에 부모
    expect(code([['current', 3]])).toEqual({ code: 'INVALID_FIELD', field: 'current' });
    expect(code([['nextNumber', 6]])).toEqual({ code: 'INVALID_FIELD', field: 'nextNumber' });
    expect(code([['branches', []]])).toEqual({ code: 'INVALID_FIELD', field: 'branches' });
    expect(code([['branches.3.inputs.robot1', 'AAAA']])).toEqual({ code: 'INVALID_INPUTS', field: 'branches[3].robot1' }); // 빈 가지에 입력
    expect(code([['branches.1.checksums', (old: unknown) => (old as string[]).concat('00000000')]])).toEqual({ code: 'INVALID_CHECKSUMS', field: 'branches[1]' });

    // 크기: 가지 MAX_BRANCHES(16)개가 모두 0틱에서 갈라져 끝까지, 매 틱 다른 입력(최악)이어도 불러오기 한도(2 MB, 16-2) 안
    const worst: MatchRecipe = {
      ...recipe,
      branches: Array.from({ length: MAX_BRANCHES }, (_, i) => ({
        number: i + 1, parent: i === 0 ? null : 1, forkTick: 0, name: null, headTick: 6000, result: null,
        inputs: compose(6000, [[0, (t: number) => [(t * 37 + i) % 255 - 127, (t * 11 + i) % 255 - 127, t % 255 - 127, (t + i) % 5]]]),
        checksums: Array.from({ length: CHECKPOINT_COUNT }, () => 'ffffffff'),
      })),
      current: 1,
      nextNumber: MAX_BRANCHES + 1,
    };
    const worstText = serializeMatchRecipe(worst);
    expect(worstText.length).toBeLessThan(MAX_IMPORT_BYTES);
    expect(parse(worstText).ok).toBe(true);
  }, TEST_TIMEOUT_MS);
});
