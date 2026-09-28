import { describe, it, expect } from 'vitest';
import { MATCH_TICKS, SimulationEngine } from '../../core/simulationEngine';
import { createIntakeZonePreset } from '../../core/collision';
import type { RobotConfig, RobotPose, ScenarioConfig } from '../../core/types';
import { NEUTRAL_TICK, buildDriveCommand, decodeDriveInput, encodeDriveCommand } from '../controls';
import type { TickControls } from '../controls';
import { InputLogChannel, LOG_RECORD_BYTES, MatchInputs } from '../inputLog';
import type { RobotId } from '../inputConfig';

// 풀매치를 도는 테스트의 제한 시간 (기본 5초는 병렬 실행 부하에서 부족, 엔진 테스트와 같은 값)
const TEST_TIMEOUT_MS = 120_000;

const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};

const cfg = (id: 'robot1' | 'robot2', over: Partial<RobotConfig> = {}): RobotConfig => ({
  id, name: id, width: 18, length: 18, maxSpeed: 60, maxTurnRate: 4, maxLinearAccel: 120, maxAngularAccel: 10,
  intakeDelay: 100, canIntakeNectar: true, intakeZones: createIntakeZonePreset('FRONT', { length: 18, width: 18 }, 3),
  shooterDelay: 300, turretType: 'FIXED', turretRange: [0, 0], aimTolerance: 0.05,
  flowerSetupDelay: 500, flowerDropDelay: 200, maxControlledPieces: 4, ...over,
});
const C1 = cfg('robot1'), C2 = cfg('robot2', { maxSpeed: 45, maxTurnRate: 3 });   // R2 제원을 달리해 복호화 스케일 확인
const pose = (x: number, y: number, heading = 0): RobotPose => ({ x, y, heading });
// 명중 확률 0.6 고정: 발사가 섞여 결과가 시드 PRNG에 의존 (재생 시 난수 소비까지 같아야 동일)
const eng = (sc: Partial<ScenarioConfig> = {}) =>
  new SimulationEngine(C1, C2, () => 0.6, sc.allianceColor ?? 'RED', { allianceColor: 'RED', ...sc });

const tick = (over: Partial<TickControls> = {}): TickControls => ({ ...NEUTRAL_TICK, ...over });
// 결정론적 조작 스크립트: 주행 / 회전 + 흡입·발사 유지 + 리프트 탭 / 투입 유지
const script = (t: number, seed: number): TickControls => ({
  forward: Math.sin(t / 37 + seed),
  right: 0.7 * Math.cos(t / 53 + seed),
  turn: 0.5 * Math.sin(t / 29 + 2 * seed),
  intake: t % 400 < 150,
  shoot: t % 400 >= 200 && t % 400 < 230,
  drop: t % 500 > 300 && t % 500 < 320,
  liftPressed: t % 500 === 250 || t % 500 === 340,
});
const both = (t: number, s1: number, s2: number): Record<RobotId, TickControls> => ({ robot1: script(t, s1), robot2: script(t, s2) });
const frameJSON = (e: SimulationEngine, t: number) => JSON.stringify(e.getFrame(t));
const logBytes = (m: MatchInputs, r: RobotId) => Array.from(m.logs[r].data.subarray(0, m.logs[r].length * LOG_RECORD_BYTES));

describe('입력 로그 / 입력 출처 / 녹화 덧입히기 (명세서 3.6)', () => {
  it('A. 로그 채널 (기록 / 절단 / 빈 틱 채움 / 범위)', () => {
    const ch = new InputLogChannel();
    assert(ch.data.length === MATCH_TICKS * 4 && ch.data.byteLength === 24000 && ch.length === 0, 'pre-allocated 6000 ticks × 4 B = 24 KB, empty');
    for (let t = 0; t < 10; t++) ch.write(t, [t + 1, -(t + 1), 5, 2]);
    assert(ch.length === 10 && ch.has(9) && !ch.has(10) && ch.data[9 * 4] === 10 && ch.data[9 * 4 + 1] === -10, 'sequential writes');
    ch.write(3, [7, 7, 7, 1]);
    assert(ch.length === 4 && !ch.has(4) && ch.data[3 * 4] === 7 && ch.data[0] === 1, 'write at earlier tick overwrites it and discards everything after');
    ch.write(7, [9, 9, 9, 3]);
    const gap = Array.from(ch.data.subarray(4 * 4, 7 * 4));
    assert(ch.length === 8 && gap.every(v => v === 0), 'writing past the end fills skipped ticks with neutral (0, 0, 0, IDLE) — stale data cleared');
    ch.truncate(2);
    assert(ch.length === 2 && ch.has(1) && !ch.has(2), 'truncate');
    ch.truncate(50);
    assert(ch.length === 2, 'truncate never extends');
    let threw = 0;
    for (const bad of [-1, MATCH_TICKS, 1.5]) {
      try { ch.write(bad, [0, 0, 0, 0]); } catch (err) { if (err instanceof RangeError) threw++; }
    }
    assert(threw === 3 && ch.length === 2, 'out-of-range tick rejected (RangeError), log untouched');
    ch.clear();
    assert(ch.length === 0 && !ch.has(0), 'clear');
  });

  it('B. 입력 출처 (LIVE 기록 / REPLAY 재생 / NONE 중립)', () => {
    const e = eng();
    const m = new MatchInputs();
    assert(m.sources.robot1 === 'LIVE' && m.sources.robot2 === 'LIVE' && m.modes.robot1 === 'FIELD' && m.modes.robot2 === 'FIELD', 'defaults: both LIVE, FIELD mode');
    const c = tick({ forward: 0.5, right: -0.25, turn: 1, intake: true });
    const { r1, r2 } = m.resolve(e, { robot1: c });
    const enc = encodeDriveCommand(buildDriveCommand(c, e.r1, { alliance: 'RED', mode: 'FIELD' }));
    assert(m.logs.robot1.length === 1 && logBytes(m, 'robot1').join() === enc.join(), 'LIVE: tick 0 recorded as encoded command');
    assert(JSON.stringify(r1) === JSON.stringify(decodeDriveInput(enc, 0, C1)) && r1.actionState === 'INTAKING', 'LIVE: engine gets decoded (quantized) input');
    assert(m.logs.robot2.length === 1 && logBytes(m, 'robot2').join() === '0,0,0,0' && r2.targetVx === 0, 'LIVE without controls -> neutral recorded');
    // R2 제원(maxSpeed 45)으로 복호화
    const { r2: fast } = m.resolve(e, { robot2: tick({ forward: 1 }) });
    assert(fast.targetVx === 45, 'decode uses each robot config (R2 maxSpeed 45)');
    // NONE: 기록 없음 + 중립, REPLAY: 로그 재생 / 기록 범위 밖은 중립
    m.logs.robot1.clear();
    m.logs.robot2.clear();
    m.sources.robot1 = 'NONE';
    const none = m.resolve(e, { robot1: tick({ forward: 1 }) });
    assert(m.logs.robot1.length === 0 && none.r1.targetVx === 0 && none.r1.actionState === 'IDLE', 'NONE: neutral, nothing recorded');
    for (let t = 0; t < 4; t++) m.logs.robot1.write(t, [127, 0, 0, 2]);
    m.logs.robot1.truncate(1);                                  // 1 ~ 3틱에는 절단된 옛 데이터가 남아 있음
    m.sources.robot1 = 'REPLAY';
    const rep = m.resolve(e, { robot1: tick({ forward: -1 }) });
    assert(rep.r1.targetVx === 60 && rep.r1.actionState === 'SHOOTING' && m.logs.robot1.length === 1, 'REPLAY: plays log (live controls ignored, no write)');
    e.step();
    const past = m.resolve(e);
    assert(past.r1.targetVx === 0 && past.r1.actionState === 'IDLE', 'REPLAY past recorded length -> neutral (stale truncated data not replayed)');

    // 로봇별 상태 / 진영 사용: R2 로봇 기준(헤딩 π/2) 전진 → +y, BLUE 필드 기준 전진 → −x
    const h = eng({ r1Spawn: pose(9, 36, Math.PI / 2), r2Spawn: pose(40, 115, Math.PI / 2) });   // 헤딩이 0이 아니어야 FIELD / ROBOT이 구분됨
    const hm = new MatchInputs();
    hm.modes.robot2 = 'ROBOT';                                  // R1은 FIELD 유지 (로봇별 모드)
    const hr = hm.resolve(h, { robot1: tick({ right: 1 }), robot2: tick({ forward: 1 }) });
    assert(hr.r1.targetVy === 60 && Math.abs(hr.r1.targetVx) < 1e-9, 'R1 FIELD mode: driver right -> +y (heading ignored)');
    assert(Math.abs(hr.r2.targetVx) < 1e-9 && hr.r2.targetVy === 45, 'R2 ROBOT mode uses its own mode and heading (π/2 forward -> +y)');
    const b = eng({ allianceColor: 'BLUE' });
    const bm = new MatchInputs();
    const br = bm.resolve(b, { robot1: tick({ forward: 1 }) });
    assert(br.r1.targetVx === -60, 'FIELD mode uses the engine alliance (BLUE forward -> -x)');
    // 리프트 의도도 해당 로봇 상태에서 유도: R2만 FLOWER 옆에서 올림 → 다음 틱 R2만 FLOWER_SETUP 요청 유지
    const l = eng({ r2Spawn: pose(9, 107.9) });
    const lm = new MatchInputs();
    lm.step(l, { robot2: tick({ liftPressed: true }) });
    const lr = lm.resolve(l);
    assert(l.r2.actionState === 'FLOWER_SETUP' && lr.r2.actionState === 'FLOWER_SETUP' && lr.r1.actionState === 'IDLE', 'lift intent derived per robot');
  });

  it('C. 실시간 결과 = 로그 재생 결과 (풀매치, 비트 단위 동일)', () => {
    const live = eng({ r2Spawn: pose(40, 115, 1) });
    const m = new MatchInputs();
    m.modes.robot2 = 'ROBOT';                                   // 헤딩 의존 변환도 재생에 영향 없음
    while (live.currentTick < MATCH_TICKS) m.step(live, both(live.currentTick, 0, 1.7));
    const shots = live.timeline.some(fr => fr.field.pendingShots.length > 0);
    const lifted = live.timeline.some(fr => fr.r1.actionState === 'FLOWER_SETUP' || fr.r2.actionState === 'FLOWER_SETUP');
    assert(m.logs.robot1.length === MATCH_TICKS && m.logs.robot2.length === MATCH_TICKS && shots, `full match recorded (6000 ticks each, shots fired; lift attempted: ${lifted})`);
    const before = [logBytes(m, 'robot1').join(), logBytes(m, 'robot2').join()];

    const replay = eng({ r2Spawn: pose(40, 115, 1) });
    replay.inputProvider = m.createReplayProvider();
    replay.runFullMatch();
    let firstDiff = -1;
    for (let t = 0; t <= MATCH_TICKS && firstDiff < 0; t++) if (frameJSON(live, t) !== frameJSON(replay, t)) firstDiff = t;
    assert(firstDiff < 0 && replay.timeline.length === live.timeline.length, `replayed timeline identical to live (first diff at ${firstDiff})`);
    assert(logBytes(m, 'robot1').join() === before[0] && logBytes(m, 'robot2').join() === before[1], 'replay provider never writes the logs');
    // 경기 종료 후 step: 기록 없이 마지막 프레임
    const last = m.step(live, both(MATCH_TICKS, 0, 0));
    assert(last.tick === MATCH_TICKS && m.logs.robot1.length === MATCH_TICKS, 'step after the final tick: no write, last frame');
  }, TEST_TIMEOUT_MS);

  it('D. 녹화 덧입히기 (1회차 R1 기록 → 되감기 → 2회차 R1 재생 + R2 실시간)', () => {
    const TICKS = 150;
    const r1Drive = (t: number) => (t < 100 ? tick({ forward: 1 }) : NEUTRAL_TICK);   // R1: y = 36 줄을 따라 +x 전진
    const e = eng({ r2Spawn: pose(70, 12) });                                           // R2: R1 경로 옆 (겹치지 않음)
    const m = new MatchInputs();
    m.sources.robot2 = 'NONE';
    while (e.currentTick < TICKS) m.step(e, { robot1: r1Drive(e.currentTick) });
    const pass1 = Array.from({ length: TICKS + 1 }, (_, t) => JSON.stringify(e.getFrame(t)!.r1));
    const r1Log = logBytes(m, 'robot1').join();
    assert(m.logs.robot1.length === TICKS && m.logs.robot2.length === 0 && e.r1.x > 60, 'pass 1: R1 recorded, R2 NONE (not recorded)');

    // 2회차 (간섭 없음): R2 실시간이지만 가만히 → R1 궤적이 1회차와 동일
    e.scrubTo(0);
    m.sources.robot1 = 'REPLAY';
    m.sources.robot2 = 'LIVE';
    while (e.currentTick < TICKS) m.step(e, { robot2: NEUTRAL_TICK });
    assert(pass1.every((r1, t) => JSON.stringify(e.getFrame(t)!.r1) === r1), 'pass 2 without contact: R1 replays exactly');
    assert(m.logs.robot2.length === TICKS && logBytes(m, 'robot1').join() === r1Log, 'R2 now recorded, R1 log untouched');

    // 2회차 (간섭): R2가 +y로 R1 경로에 들어와 부딪힘 → R1은 같은 명령을 재생하지만 궤적이 달라짐
    e.scrubTo(0);
    while (e.currentTick < TICKS) m.step(e, { robot2: tick({ right: 1 }) });           // RED 드라이버 오른쪽 = +y
    const diverged = pass1.findIndex((r1, t) => JSON.stringify(e.getFrame(t)!.r1) !== r1);
    assert(diverged > 0 && JSON.stringify(e.r1) !== pass1[TICKS],
      `pass 2 with contact: R1 commands replayed but trajectory changes (from tick ${diverged}, end (${e.r1.x.toFixed(1)}, ${e.r1.y.toFixed(1)}))`);
    assert(logBytes(m, 'robot1').join() === r1Log, 'R1 log still untouched (commands, not positions)');

    // 덧입힌 결과도 로그 재생으로 그대로 재현
    const replay = eng({ r2Spawn: pose(70, 12) });
    replay.inputProvider = m.createReplayProvider();
    replay.runFullMatch();
    assert(Array.from({ length: TICKS + 1 }, (_, t) => t).every(t => frameJSON(replay, t) === frameJSON(e, t)), 'overdubbed match reproduces from logs');
  }, TEST_TIMEOUT_MS);

  it('E. 되감기 분기 (LIVE 로그 절단 / REPLAY 로그 유지)', () => {
    const e = eng();
    const m = new MatchInputs();
    while (e.currentTick < 1000) m.step(e, both(e.currentTick, 0, 1));
    const r1Full = logBytes(m, 'robot1');
    const r2Full = logBytes(m, 'robot2');

    // R1 LIVE로 400틱에서 다른 조작으로 이어감 → R1 로그 400 이후 교체, R2는 REPLAY로 원래 로그 재생 / 유지
    e.scrubTo(400);
    m.sources.robot2 = 'REPLAY';
    while (e.currentTick < 600) m.step(e, { robot1: script(e.currentTick, 5) });
    const r1Now = logBytes(m, 'robot1');
    assert(m.logs.robot1.length === 600 && m.logs.robot2.length === 1000, 'LIVE log truncated at branch (now 600), REPLAY log kept (1000)');
    assert(r1Now.slice(0, 400 * 4).join() === r1Full.slice(0, 400 * 4).join(), 'ticks before the branch unchanged');
    assert(r1Now.slice(400 * 4).join() !== r1Full.slice(400 * 4, 600 * 4).join(), 'ticks after the branch re-recorded');
    assert(logBytes(m, 'robot2').join() === r2Full.join(), 'REPLAY robot log identical');
    assert(e.timeline.length === 601, 'engine discarded future frames (existing branch rule)');

    // 분기 결과 재현: 600틱까지 동일, 이후 R1은 기록 없음 → 중립
    const replay = eng();
    replay.inputProvider = m.createReplayProvider();
    replay.runFullMatch();
    let same = true;
    for (let t = 0; t <= 600 && same; t++) same = frameJSON(replay, t) === frameJSON(e, t);
    assert(same, 'branched match reproduces from logs (ticks 0..600)');
  }, TEST_TIMEOUT_MS);

  it('F. 재생 공급 함수 (출처 고정 / NONE은 로그가 있어도 중립)', () => {
    const e = eng({ r1Spawn: pose(40, 20), r2Spawn: pose(40, 115) });
    const m = new MatchInputs();
    while (e.currentTick < 100) m.step(e, { robot1: tick({ forward: 1 }), robot2: tick({ forward: 1 }) });
    assert(e.r1.x > 60 && e.r2.x > 60, 'both robots recorded driving forward');

    m.sources.robot1 = 'NONE';
    m.sources.robot2 = 'NONE';
    const provider = m.createReplayProvider();
    m.sources.robot1 = 'REPLAY';                               // 생성 후 출처 변경은 영향 없음
    m.sources.robot2 = 'REPLAY';
    const r = eng({ r1Spawn: pose(40, 20), r2Spawn: pose(40, 115) });
    r.inputProvider = provider;
    r.runFullMatch();
    assert(r.getFrame(100)!.r1.x === 40 && r.getFrame(100)!.r2.x === 40, 'NONE at provider creation -> both stay (log ignored, sources copied)');
    const live = m.createReplayProvider();
    const r2 = eng({ r1Spawn: pose(40, 20), r2Spawn: pose(40, 115) });
    r2.inputProvider = live;
    r2.runFullMatch();
    assert(r2.getFrame(100)!.r1.x === e.getFrame(100)!.r1.x && r2.getFrame(100)!.r2.x === e.getFrame(100)!.r2.x, 'REPLAY provider reproduces the recorded drive');
  }, TEST_TIMEOUT_MS);
});
