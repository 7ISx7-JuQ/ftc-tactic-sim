// 저장 레시피 (명세서 3.9 저장 레시피 / 상태 체크섬, 10-3)
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
  buildMatchRecipe,
  decodeInputRecord,
  encodeInputRecord,
  isoLocal,
  parseMatchRecipe,
  recipeWarnings,
  serializeMatchRecipe,
  verifyRecipe,
} from '../matchRecipe';
import type { MatchRecipe } from '../matchRecipe';

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
  return new SimulationEngine(s.r1Config, s.r2Config, s.shotResolver, v.scenario.allianceColor, v.scenario, s.shooters);
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
    const recipe = buildMatchRecipe({ setup: values, inputs: appliedInputRecords(inputs), timeline: engine.timeline, branchName: 'Branch 3', createdAt: new Date(2026, 8, 30, 14, 32, 5) });
    cached = { recipe, text: serializeMatchRecipe(recipe), engine };
  }
  return cached;
}
// 파일 JSON 고치기: [경로, 새 값 | DEL | (옛 값) => 새 값]. 경로는 점으로 (배열 번호 포함)
const DEL = Symbol('delete');
type Change = [path: string, value: unknown];
const edit = (...changes: Change[]): string => {
  const file = JSON.parse(sample().text) as Record<string, unknown>;
  for (const [path, value] of changes) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, file);
    if (value === DEL) delete parent[last];
    else parent[last] = typeof value === 'function' ? (value as (old: unknown) => unknown)(parent[last]) : value;
  }
  return JSON.stringify(file);
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
    expect(recipe.checksums).toHaveLength(CHECKPOINT_COUNT);
    expect(recipe.result).toEqual({ totalScore: engine.getFrame(6000)!.totalScore, rp: engine.getFrame(6000)!.rpAchieved });

    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: 'ftc-tactic-sim/match', recipeVersion: RECIPE_VERSION, inputs: { ticks: 6000 }, checksums: { interval: 50 }, branch: { name: 'Branch 3' } });
    expect(file.setup.robot1.config.id).toBeUndefined();
    expect(text.length).toBeLessThan(120_000);

    const parsed = parse(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(parsed.recipe.setup).toEqual(values);
    expect(parsed.recipe.branchName).toBe('Branch 3');
    expect(parsed.recipe.createdAt).toBe(recipe.createdAt);
    expect(Array.from(parsed.recipe.inputs.robot1)).toEqual(Array.from(recipe.inputs.robot1));

    // 파일만으로 재계산 → 체크포인트 전부 일치 + 종료 프레임 동일
    const replay = engineFor(parsed.recipe.setup);
    replay.inputProvider = createInputRecordProvider(parsed.recipe.inputs);
    replay.runFullMatch();
    expect(verifyRecipe(parsed.recipe, replay.timeline)).toEqual({ match: true });
    expect(JSON.stringify(replay.getFrame(6000))).toBe(JSON.stringify(engine.getFrame(6000)));
    // 시드가 다르면 결과가 달라지고 체크섬이 그 구간을 잡는다
    const other = engineFor({ ...parsed.recipe.setup, scenario: { ...parsed.recipe.setup.scenario, rngSeed: 1 } });
    other.inputProvider = createInputRecordProvider(parsed.recipe.inputs);
    other.runFullMatch();
    expect(verifyRecipe(parsed.recipe, other.timeline)).toMatchObject({ match: false });
  }, TEST_TIMEOUT_MS);

  it('D. 만들기: 종료 전 / 입력 부족은 오류, 시드가 비어 있으면 엔진 기본 시드, 로컬 시각 + 시간대', () => {
    const e = engineFor(defaults);
    const inputs: Record<RobotId, Int8Array> = { robot1: new Int8Array(MATCH_TICKS * 4), robot2: new Int8Array(MATCH_TICKS * 4) };
    const base = { setup: defaults, inputs, branchName: 'Main', createdAt: new Date(2026, 0, 2, 3, 4, 5) };
    expect(() => buildMatchRecipe({ ...base, timeline: e.timeline })).toThrow(RangeError);
    e.runFullMatch();
    expect(() => buildMatchRecipe({ ...base, timeline: e.timeline, inputs: { ...inputs, robot2: new Int8Array(40) } })).toThrow(RangeError);
    const r = buildMatchRecipe({ ...base, timeline: e.timeline });
    expect(r.setup.scenario.rngSeed).toBe(DEFAULT_RNG_SEED);
    expect(defaults.scenario.rngSeed).toBeUndefined(); // 원본 불변
    expect(r.createdAt).toMatch(/^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
    expect(isoLocal(new Date(2026, 11, 31, 23, 59, 59))).toMatch(/^2026-12-31T23:59:59[+-]\d{2}:\d{2}$/);
    // 시드를 채운 파일도 재계산 결과가 같다 (미지정 = 기본 시드)
    const parsed = parse(serializeMatchRecipe(r));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const replay = engineFor(parsed.recipe.setup);
    replay.inputProvider = createInputRecordProvider(parsed.recipe.inputs);
    replay.runFullMatch();
    expect(verifyRecipe(parsed.recipe, replay.timeline)).toEqual({ match: true });
  }, TEST_TIMEOUT_MS);

  it('E. 거부: 파일 형식 / 형식 버전 / 항목 누락 · 형식 틀림(기본값으로 채우지 않음) / 입력 / 체크포인트 / 설정 검증', () => {
    const code = (text: string) => {
      const r = parse(text);
      return r.ok ? 'OK' : r.error;
    };
    expect(code('{oops')).toEqual({ code: 'NOT_JSON' });
    expect(code(JSON.stringify({ format: 'ftc-tactic-sim/preset', presetVersion: 1, kind: 'ROBOT', data: {} }))).toEqual({ code: 'PRESET_FILE' });
    expect(code('[]')).toEqual({ code: 'NOT_RECIPE' });
    expect(code(edit(['recipeVersion', 2]))).toEqual({ code: 'RECIPE_VERSION', version: 2 });
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
    expect(code(edit(['inputs.ticks', 5999]))).toEqual({ code: 'INVALID_INPUTS', field: 'ticks' });
    expect(code(edit(['inputs.robot2', (old: unknown) => String(old).slice(0, -8)]))).toEqual({ code: 'INVALID_INPUTS', field: 'robot2' });
    expect(code(edit(['checksums.values', (old: unknown) => (old as string[]).slice(0, -1)]))).toEqual({ code: 'INVALID_CHECKSUMS' });
    expect(code(edit(['checksums.values.3', 'ABCDEF12']))).toEqual({ code: 'INVALID_CHECKSUMS' });
    expect(code(edit(['checksums.interval', 25]))).toEqual({ code: 'INVALID_CHECKSUMS' });
    // 형식은 맞지만 검증 실패: 최고 속도 범위 밖 / 시작 자세 겹침
    const bad = parse(edit(['setup.robot1.config.maxSpeed', 999]));
    expect(!bad.ok && bad.error.code === 'INVALID_SETUP' && bad.error.issues).toContain('FIELD_maxSpeed');
    const overlap = parse(edit(['setup.scenario.r2Spawn', { x: 135, y: 80, heading: 0 }]));
    expect(!overlap.ok && overlap.error.code === 'INVALID_SETUP' && overlap.error.issues).toContain('PLACEMENT_ROBOT_OVERLAP');
  }, TEST_TIMEOUT_MS);

  it('F. 알아보기 정보(가지 이름 / 결과 / 시각)는 틀려도 거부하지 않음, 모르는 항목은 무시, 버전 · LUT 설정 차이는 경고', () => {
    const loose = parse(edit(['branch', 7], ['result', { totalScore: 'many' }], ['createdAt', DEL], ['extra', true], ['setup.robot1.config.color', 'yellow']));
    expect(loose.ok && [loose.recipe.branchName, loose.recipe.result, loose.recipe.createdAt]).toEqual(['', null, '']);
    const warned = parse(edit(['engineVersion', ENGINE_VERSION + 1], ['ballisticsModelVersion', BALLISTICS_MODEL_VERSION + 1], ['lut.samples', 100]));
    expect(warned.ok && warned.warnings).toEqual([
      { code: 'ENGINE_VERSION', file: ENGINE_VERSION + 1, current: ENGINE_VERSION },
      { code: 'BALLISTICS_VERSION', file: BALLISTICS_MODEL_VERSION + 1, current: BALLISTICS_MODEL_VERSION },
      { code: 'LUT_SETTINGS' },
    ]);
    expect(recipeWarnings({ engineVersion: ENGINE_VERSION, ballisticsModelVersion: BALLISTICS_MODEL_VERSION, lut: { ...CURRENT_LUT_SETTINGS, seed: 1 } })).toEqual([{ code: 'LUT_SETTINGS' }]);
  }, TEST_TIMEOUT_MS);

  it('G. (11-2) v1 경기 파일: v2.0.0 로봇 항목이 없으면 변환으로 채움(NECTAR 슈터 = 주 슈터 복사), 있으면 엄격 검사, 시나리오 새 항목도 엄격', () => {
    const v1 = (id: RobotId): Change[] => [
      [`setup.${id}.config.shooterSetup`, DEL], [`setup.${id}.config.nectarShooter`, DEL], [`setup.${id}.config.flowerDropZones`, DEL], [`setup.${id}.config.liftMaxSpeed`, DEL],
      [`setup.${id}.ballistics.shooterLateralOffset`, DEL], [`setup.${id}.ballistics.nectarShooter`, DEL],
    ];
    // R2 주 슈터를 바꾼 v1 파일 → NECTAR 슈터는 그 값의 복사
    const old = parse(edit(...v1('robot1'), ...v1('robot2'), ['setup.robot2.config.shooterDelay', 250], ['setup.robot2.ballistics.dz', 41]));
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.recipe.setup.robot1).toEqual(sample().recipe.setup.robot1); // 기본 프로필은 주 슈터 = NECTAR 슈터라 변환 결과가 원래와 같음
    const r2 = old.recipe.setup.robot2;
    expect([r2.config.shooterSetup, r2.config.nectarShooter.shooterDelay, r2.config.flowerDropZones, r2.config.liftMaxSpeed]).toEqual(['SHARED', 250, [], 0]);
    expect([r2.ballistics.shooterLateralOffset, r2.ballistics.nectarShooter.dz, r2.ballistics.nectarShooter.shooterLateralOffset]).toEqual([0, 41, 0]);

    const code = (text: string) => {
      const r = parse(text);
      return r.ok ? 'OK' : r.error;
    };
    // 일부만 없어도 그 항목만 채움
    expect(code(edit(['setup.robot1.config.liftMaxSpeed', DEL]))).toBe('OK');
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
    const v1 = parse(edit(
      ['setup.robot1.config.aimTolerance', 0.0524], ['setup.robot1.config.nectarShooter', DEL],
      ['setup.robot2.config.aimTolerance', 0.1], ['setup.robot2.config.nectarShooter.aimTolerance', 0.1],
    ));
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.recipe.setup).toEqual(sample().recipe.setup);
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
});
