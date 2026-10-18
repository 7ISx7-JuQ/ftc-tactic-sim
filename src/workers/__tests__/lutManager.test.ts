import { describe, expect, it } from 'vitest';
import {
  BALLISTICS_MODEL_VERSION,
  generateReferenceLUTRows,
  generateRobotLUTs,
  LUT_GRID_SIZE,
  searchLaunchSpeed,
} from '../../core/ballistics';
import type { RobotBallisticsResult } from '../../core/ballistics';
import type { BallisticsConfig, HiveCellKey } from '../../core/types';
import { handleLUTJob } from '../lutProtocol';
import type { LUTWorkerMessage } from '../lutProtocol';
import type { LUTCache, LUTCacheEntry } from '../lutCache';
import { defaultLUTPoolSize, lutRequestKey } from '../lutManager';
import type { LUTRequest } from '../lutManager';
import { setupLUTManager } from './fakeWorker';

// 각 검증은 메시지와 함께 expect로 확인 (실패 시 어떤 조건이 깨졌는지 메시지로 표시)
const assert = (c: boolean, m: string) => {
  expect(c, m).toBe(true);
};
const deg = (d: number) => (d * Math.PI) / 180;
const bitEqual = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const CFG1: BallisticsConfig = { dz: 39.5, shooterPitch: deg(70), sweetSpot: { x: 60.5, y: 134.5 }, shooterOffset: 6 };
const CFG2: BallisticsConfig = { dz: 41.5, shooterPitch: deg(55), sweetSpot: { x: 59.2, y: 129.9 }, shooterOffset: 6 };
const REQ1: LUTRequest = { config: CFG1, robotSize: { length: 18, width: 18 } };
const REQ2: LUTRequest = { config: CFG2, robotSize: { length: 14, width: 12 } };
const OPTS = { samples: 12, searchSamples: 150, seed: 5 };
const setup = (options: Parameters<typeof setupLUTManager>[0] = {}) => setupLUTManager({ ...OPTS, poolSize: 2, ...options });
const TOTAL = 2 * LUT_GRID_SIZE * LUT_GRID_SIZE;

const sameResult = (a: RobotBallisticsResult, b: RobotBallisticsResult) =>
  (['POLLEN', 'NECTAR'] as const).every(t => a.v0[t] === b.v0[t] && a.sweetSpotHitRate[t] === b.sweetSpotHitRate[t]
    && (Object.keys(a.luts[t]) as HiveCellKey[]).every(k => bitEqual(a.luts[t][k], b.luts[t][k])));

describe('LUT 생성 관리자 (09-3)', () => {
  const direct1 = generateRobotLUTs(CFG1, REQ1.robotSize, OPTS);
  const direct2 = generateRobotLUTs(CFG2, REQ2.robotSize, OPTS);

  it('A. Worker 작업 처리기 (handleLUTJob)', () => {
    const msgs: { m: LUTWorkerMessage; t?: Transferable[] }[] = [];
    const post = (m: LUTWorkerMessage, t?: Transferable[]) => msgs.push({ m, t });
    const snapped = { ...CFG1, sweetSpot: { x: 60.5, y: 134.5 } };
    handleLUTJob({ kind: 'search', jobId: 1, generation: 3, robotId: 'robot1', pieceType: 'NECTAR', config: snapped, robotSize: REQ1.robotSize, samples: 150, seed: 9 }, post);
    const found = searchLaunchSpeed(snapped, 'NECTAR', 150, 9)!;
    const r = msgs[0].m;
    assert(msgs.length === 1 && r.kind === 'result' && r.jobId === 1 && r.generation === 3 && r.v0 === found.v0 && r.hitRate === found.hitRate, 'search -> single result = searchLaunchSpeed');

    msgs.length = 0;
    handleLUTJob({ kind: 'rows', jobId: 2, generation: 3, robotId: 'robot1', pieceType: 'POLLEN', config: snapped, robotSize: REQ1.robotSize, samples: 12, seed: 7, gyStart: 132, gyEnd: 135, v0: found.v0 }, post);
    const progress = msgs.filter(x => x.m.kind === 'progress').map(x => (x.m as { cellsDone: number }).cellsDone);
    assert(progress.join() === '144,288,432', `progress per row (${progress.join()})`);
    const last = msgs[msgs.length - 1];
    const rows = last.m.kind === 'result' ? last.m.rows : undefined;
    assert(!!rows && bitEqual(rows, generateReferenceLUTRows(snapped, REQ1.robotSize, 'POLLEN', found.v0, 12, 7, 132, 135)) && rows.some(v => v > 0), 'rows result = generateReferenceLUTRows');
    assert(!!last.t && last.t[0] === rows!.buffer, 'rows buffer passed as transferable');

    msgs.length = 0;
    handleLUTJob({ kind: 'rows', jobId: 4, generation: 0, robotId: 'robot1', pieceType: 'POLLEN', config: snapped, robotSize: REQ1.robotSize, samples: 12, seed: 7, gyStart: 0, gyEnd: 1 }, post);
    assert(msgs.length === 1 && msgs[0].m.kind === 'error' && msgs[0].m.jobId === 4, 'rows without v0 -> error message');
    msgs.length = 0;
    handleLUTJob({ kind: 'search', jobId: 5, generation: 0, robotId: 'robot1', pieceType: 'POLLEN', config: { ...snapped, sweetSpot: { x: 59.5, y: 100.5 }, shooterPitch: deg(10) }, robotSize: REQ1.robotSize, samples: 50, seed: 1 }, post);
    assert(msgs.length === 1 && msgs[0].m.kind === 'result' && msgs[0].m.v0 === undefined, 'no closed-form solution -> result without v0');
  });

  it('B. 결정론: 풀 크기 / 행 묶음 / 완료 순서와 무관하게 generateRobotLUTs와 비트 단위로 같음', () => {
    for (const [poolSize, rowsPerJob, reverse] of [[1, 4, false], [3, 4, true], [8, 7, false], [2, 144, true]] as const) {
      const { manager, drain } = setup({ poolSize, rowsPerJob });
      manager.request('robot1', REQ1);
      manager.request('robot2', REQ2);
      assert(manager.matchLUTs() === null, 'not ready before work');
      drain(reverse);
      const s1 = manager.getStatus('robot1');
      const s2 = manager.getStatus('robot2');
      const tag = `pool ${poolSize}, ${rowsPerJob} rows/job${reverse ? ', reversed' : ''}`;
      assert(s1.state === 'READY' && s2.state === 'READY', `${tag}: both READY`);
      assert(sameResult(s1.result!, direct1) && sameResult(s2.result!, direct2), `${tag}: results === generateRobotLUTs`);
      assert(s1.cellsDone === TOTAL && s2.cellsDone === TOTAL && s1.cellsTotal === TOTAL, `${tag}: progress complete`);
      const match = manager.matchLUTs();
      assert(!!match && match.robot1 === s1.result!.luts && match.robot2 === s2.result!.luts, `${tag}: matchLUTs`);
    }
  }, 120_000);

  it('C. 상태 전이 / 진행 / v0 선표시 / 점진 조립 / v0 탐색 우선', () => {
    const { manager, workers, changes, drain } = setup({ poolSize: 1 });
    manager.request('robot1', REQ1);
    const w = workers[0];
    w.step(); // POLLEN 탐색
    const mid = manager.getStatus('robot1');
    assert(mid.state === 'SEARCHING' && mid.searched.POLLEN && mid.v0.POLLEN === direct1.v0.POLLEN && !mid.searched.NECTAR, 'v0 shown right after its search, still SEARCHING');
    w.step(); // NECTAR 탐색
    assert(manager.getStatus('robot1').state === 'GENERATING', 'both searched -> GENERATING');
    for (let i = 0; i < 5; i++) w.step(); // 행 작업 일부
    const partial = manager.getStatus('robot1');
    const done = Array.from(partial.rowsDone.POLLEN).reduce((a, b) => a + b, 0);
    let rowsMatch = true;
    for (let gy = 0; gy < LUT_GRID_SIZE; gy++) {
      if (!partial.rowsDone.POLLEN[gy]) continue;
      rowsMatch &&= bitEqual(partial.reference.POLLEN.subarray(gy * 144, gy * 144 + 144), direct1.luts.POLLEN.RED_AUDIENCE.subarray(gy * 144, gy * 144 + 144));
    }
    assert(done === 20 && rowsMatch && partial.result === null, `partial reference rows usable for the progressive heatmap (${done} rows)`);
    // 로봇 2 요청 → 다음 작업은 로봇 1의 남은 행이 아니라 로봇 2의 v0 탐색
    manager.request('robot2', REQ2);
    w.step();
    const next = w.received[w.received.length - 1];
    assert(next.robotId === 'robot2' && next.kind === 'search', 'search jobs jump ahead of queued row jobs');
    drain();
    const states = changes.filter(c => c.robotId === 'robot1').map(c => c.state).filter((s, i, a) => i === 0 || a[i - 1] !== s);
    assert(states.join('>') === 'QUEUED>SEARCHING>GENERATING>READY', `robot1 states ${states.join('>')}`);
    const cells = changes.filter(c => c.robotId === 'robot1').map(c => c.cellsDone);
    assert(cells.every((c, i) => i === 0 || c >= cells[i - 1]) && cells[cells.length - 1] === TOTAL, 'progress monotonic and complete');
    assert(cells.some(c => c % 576 !== 0), 'row-level progress inside a 4-row job is counted');
    assert(sameResult(manager.getStatus('robot2').result!, direct2), 'robot2 still correct');
  }, 120_000);

  it('D. 재요청 무시 / 설정 변경 취소 / cancel / 검증 실패', () => {
    // 같은 LUT 입력 재요청 (스냅 결과 같음, 편차 기본값 명시) → 아무 일도 없음
    {
      const { manager, workers, changes, drain } = setup();
      manager.request('robot1', REQ1);
      drain();
      const posted = workers.reduce((n, w) => n + w.received.length, 0);
      const before = changes.length;
      manager.request('robot1', { config: { ...CFG1, sweetSpot: { x: 60.2, y: 134.9 }, v0NoisePercent: 0.02, headingNoiseRad: 0.02, pitchNoiseRad: 0.006 }, robotSize: { length: 18, width: 18 } });
      assert(changes.length === before && workers.reduce((n, w) => n + w.received.length, 0) === posted && manager.getStatus('robot1').state === 'READY', 'equivalent request while READY -> no-op');
      manager.request('robot1', { ...REQ1, robotSize: { length: 16, width: 18 } });
      assert(manager.getStatus('robot1').state === 'SEARCHING' && manager.getStatus('robot1').result === null, 'robot length change -> regenerate (idle worker takes the search at once)');
      drain();
      assert(sameResult(manager.getStatus('robot1').result!, generateRobotLUTs(CFG1, { length: 16, width: 18 }, OPTS)), 'regenerated for the new size');
    }
    // 생성 도중 설정 변경 → CANCELLED → QUEUED, 이전 세대 작업 제거 / 실행 중 결과 무시
    {
      const { manager, workers, changes, drain, pendingJobs } = setup({ poolSize: 2 });
      manager.request('robot1', REQ1);
      for (let i = 0; i < 4; i++) workers.forEach(w => w.step());
      const oldGen = manager.getStatus('robot1').generation;
      assert(manager.getStatus('robot1').state === 'GENERATING' && pendingJobs().length === 2, 'mid-generation with two jobs in flight');
      const changed: BallisticsConfig = { ...CFG1, dz: 38 };
      manager.request('robot1', { ...REQ1, config: changed });
      const tail = changes.slice(-2).map(c => c.state).join('>');
      const s = manager.getStatus('robot1');
      assert(tail === 'CANCELLED>QUEUED' && s.generation === oldGen + 2 && s.cellsDone === 0 && !s.searched.POLLEN, `config change -> ${tail}, fresh generation`);
      drain();
      const cells = changes.filter(c => c.robotId === 'robot1').map(c => c.cellsDone);
      assert(Math.max(...cells) === TOTAL, 'stale in-flight results never counted past the total');
      assert(sameResult(manager.getStatus('robot1').result!, generateRobotLUTs(changed, REQ1.robotSize, OPTS)), 'result = new config only');
    }
    // cancel(): 진행 중 → CANCELLED 유지, 다른 로봇은 계속
    {
      const { manager, workers, drain } = setup();
      manager.request('robot1', REQ1);
      manager.request('robot2', REQ2);
      workers.forEach(w => w.step());
      manager.cancel('robot1');
      drain();
      assert(manager.getStatus('robot1').state === 'CANCELLED' && manager.getStatus('robot1').result === null, 'cancelled robot stays CANCELLED');
      assert(manager.getStatus('robot2').state === 'READY' && manager.matchLUTs() === null, 'other robot finishes, match not ready');
      const posted = workers.reduce((n, w) => n + w.received.length, 0);
      manager.cancel('robot2');
      assert(manager.getStatus('robot2').state === 'READY' && workers.reduce((n, w) => n + w.received.length, 0) === posted, 'cancel on READY -> no-op');
    }
    // 검증 실패 → IDLE + 사유, 진행 중이던 작업 제거
    {
      const { manager, drain, pendingJobs } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      manager.request('robot1', { ...REQ1, config: { ...CFG1, sweetSpot: { x: 59.25, y: 96 } } });
      const s = manager.getStatus('robot1');
      assert(s.state === 'IDLE' && s.issues.some(i => i.code === 'SWEET_SPOT_IN_HIVE'), 'invalid config -> IDLE with issues');
      drain();
      assert(manager.getStatus('robot1').state === 'IDLE' && pendingJobs().length === 0, 'in-flight job of the old generation ignored, nothing queued');
    }
  }, 120_000);

  it('E. 오류 / 풀 크기 / 정리 / 요청 키', () => {
    // Worker 오류 메시지 → ERROR, 다른 로봇은 계속, 같은 설정 재요청으로 복구
    {
      const { manager, workers, drain, pendingJobs } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      manager.request('robot2', REQ2);
      workers[0].failNext = 'error';
      workers[0].step();
      const s = manager.getStatus('robot1');
      assert(s.state === 'ERROR' && s.error === 'boom', 'worker error -> ERROR with message');
      assert(pendingJobs().every(j => j.robotId === 'robot2'), 'failed robot jobs removed from the queue');
      drain();
      assert(manager.getStatus('robot2').state === 'READY' && manager.matchLUTs() === null, 'other robot unaffected, match not ready');
      manager.request('robot1', REQ1);
      drain();
      assert(manager.getStatus('robot1').state === 'READY' && sameResult(manager.getStatus('robot1').result!, direct1) && !!manager.matchLUTs(), 'same request after ERROR regenerates');
    }
    // Worker onerror (스크립트 오류) / 잘못된 행 결과 → ERROR
    {
      const { manager, workers, drain } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      workers[0].onerror?.({ message: 'script failed' });
      assert(manager.getStatus('robot1').state === 'ERROR' && manager.getStatus('robot1').error === 'script failed', 'worker onerror -> ERROR');
      // 재요청 후 처리: 오류로 잃은 이전 작업의 늦은 응답(작업 번호 불일치)은 무시되고 새 요청은 정상 완료
      manager.request('robot1', REQ1);
      drain();
      assert(manager.getStatus('robot1').state === 'READY' && sameResult(manager.getStatus('robot1').result!, direct1), 'late reply of the lost job ignored, re-request completes');
    }
    {
      const { manager, workers, drain } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      workers[0].step();
      workers[0].step();
      workers[0].failNext = 'badRows';
      workers[0].step();
      const s = manager.getStatus('robot1');
      assert(s.state === 'ERROR' && /expected 576 cells, got 3/.test(s.error ?? ''), `wrong-sized rows -> ERROR (${s.error})`);
      drain();
      assert(manager.getStatus('robot1').state === 'ERROR', 'stays ERROR');
    }
    // 풀 크기 / 정리
    assert(defaultLUTPoolSize(16) === 8 && defaultLUTPoolSize(8) === 7 && defaultLUTPoolSize(4) === 3 && defaultLUTPoolSize(2) === 1 && defaultLUTPoolSize(1) === 1 && defaultLUTPoolSize(NaN) === 3,
      'pool = max(1, min(cores - 1, 8)), unknown -> 4 cores');
    {
      const { manager, workers } = setup({ poolSize: 3 });
      assert(manager.poolSize === 3 && workers.length === 3, 'pool created once with the given size');
      manager.dispose();
      manager.request('robot1', REQ1);
      assert(workers.every(w => w.terminated && w.received.length === 0), 'dispose terminates workers, later requests ignored');
    }
    // 요청 키: 스냅 / 편차 기본값 정규화, LUT를 바꾸는 입력만 반영
    {
      const k = (r: LUTRequest, samples = 12, search = 150, seed = 5) => lutRequestKey(r, samples, search, seed);
      const base = k(REQ1);
      assert(base === k({ config: { ...CFG1, sweetSpot: { x: 60.01, y: 134.99 }, pitchNoiseRad: 0.006 }, robotSize: { length: 18, width: 18 } }), 'snap / default noise normalized');
      assert(base === k({ config: { shooterOffset: 6, sweetSpot: { y: 134.5, x: 60.5 }, shooterPitch: CFG1.shooterPitch, dz: 39.5 }, robotSize: { width: 18, length: 18 } }), 'property order irrelevant');
      assert([k({ ...REQ1, config: { ...CFG1, dz: 39 } }), k({ ...REQ1, robotSize: { length: 18, width: 17 } }), k(REQ1, 13), k(REQ1, 12, 151), k(REQ1, 12, 150, 6),
        k({ ...REQ1, config: { ...CFG1, headingNoiseRad: 0.03 } })].every(x => x !== base), 'config / size / samples / seed change the key');
      assert(JSON.parse(base).modelVersion >= 1, 'model version included');
    }
  }, 120_000);

  it('F. (09-10a) 같은 요청 키의 두 로봇: 한 번만 생성하고 결과 공유, 앞선 로봇이 멈추거나 바뀌면 따라가던 로봇이 스스로 생성', () => {
    const posted = (workers: { received: unknown[] }[]) => workers.reduce((n, w) => n + w.received.length, 0);
    const jobsPerRobot = 2 + 2 * Math.ceil(LUT_GRID_SIZE / 4); // 탐색 2 + 행 작업 72
    // 동시에 같은 설정 → R2는 R1을 따라감 (진행 공유), 작업은 한 로봇분만
    {
      const { manager, workers, changes, drain } = setup();
      manager.request('robot1', REQ1);
      manager.request('robot2', { ...REQ1, config: { ...CFG1, sweetSpot: { x: 60.3, y: 134.2 } } }); // 스냅 후 같은 키
      workers.forEach(w => w.step());
      workers.forEach(w => w.step());
      const mid1 = manager.getStatus('robot1');
      const mid2 = manager.getStatus('robot2');
      assert(mid2.state === mid1.state && mid2.cellsDone === mid1.cellsDone && mid2.v0.POLLEN === mid1.v0.POLLEN && mid2.reference === mid1.reference, 'follower shows the leader progress');
      drain();
      const s1 = manager.getStatus('robot1');
      const s2 = manager.getStatus('robot2');
      assert(s1.state === 'READY' && s2.state === 'READY' && s2.result === s1.result && sameResult(s2.result!, direct1), 'both READY with the same result');
      assert(posted(workers) === jobsPerRobot, `jobs for one robot only (${posted(workers)})`);
      const r2States = changes.filter(c => c.robotId === 'robot2').map(c => c.state).filter((x, i, a) => i === 0 || a[i - 1] !== x);
      assert(r2States.join('>') === 'SEARCHING>GENERATING>READY', `follower states ${r2States.join('>')}`);
      // 결과를 받은 뒤에는 독립: 앞선 로봇이 설정을 바꿔도 READY 유지, 작업 없음
      const before = posted(workers);
      manager.request('robot1', REQ2);
      assert(manager.getStatus('robot2').state === 'READY' && manager.getStatus('robot2').result === s1.result, 'follower stays READY after the leader changes');
      drain();
      assert(posted(workers) - before === jobsPerRobot && sameResult(manager.getStatus('robot1').result!, direct2), 'only the leader regenerates');
      manager.request('robot1', REQ1);
      assert(manager.getStatus('robot1').state === 'READY' && manager.getStatus('robot1').result === s1.result, 'leader back to the old config -> shares the READY result of robot2');
      // 이미 READY인 로봇과 같은 설정으로 다시 요청 → 즉시 READY
      manager.request('robot2', REQ2);
      drain();
      manager.request('robot2', REQ1);
      assert(manager.getStatus('robot2').state === 'READY' && manager.getStatus('robot2').result === s1.result, 'same key as a READY robot -> READY at once');
    }
    // 앞선 로봇의 설정 변경 / 취소 / 오류 → 따라가던 로봇이 스스로 생성해 같은 결과
    for (const stop of ['change', 'cancel', 'error'] as const) {
      const { manager, workers, drain } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      manager.request('robot2', REQ1);
      workers[0].step();
      if (stop === 'change') manager.request('robot1', REQ2);
      else if (stop === 'cancel') manager.cancel('robot1');
      else {
        workers[0].failNext = 'error';
        workers[0].step();
      }
      assert(manager.getStatus('robot2').state === 'QUEUED' || manager.getStatus('robot2').state === 'SEARCHING', `${stop}: follower starts its own run`);
      drain();
      const s2 = manager.getStatus('robot2');
      assert(s2.state === 'READY' && sameResult(s2.result!, direct1), `${stop}: follower finishes on its own`);
      if (stop === 'change') assert(sameResult(manager.getStatus('robot1').result!, direct2), 'change: leader regenerated for its new config');
    }
    // 따라가던 로봇의 설정 변경 → 따라가기 끝, 앞선 로봇은 영향 없음
    {
      const { manager, workers, drain } = setup({ poolSize: 1 });
      manager.request('robot1', REQ1);
      manager.request('robot2', REQ1);
      workers[0].step();
      manager.request('robot2', REQ2);
      drain();
      assert(sameResult(manager.getStatus('robot1').result!, direct1) && sameResult(manager.getStatus('robot2').result!, direct2), 'follower re-request is independent');
    }
  }, 120_000);

  it('G. (12-4) 슈터 구성: 발사 가능 기물만 작업, 기물별 슈터 설정, NONE은 바로 준비, v1 캐시 키 호환', () => {
    const size = REQ1.robotSize;
    const k = (config: LUTRequest['config'], robotSize = size) => lutRequestKey({ config, robotSize }, 12, 150, 5);
    // v1 키 (v1.0.0이 만든 문자열 그대로): 두 기물 공용 + 좌우 0은 이 키와 같아야 v1 캐시가 쓰인다
    const v1Key = JSON.stringify({
      modelVersion: BALLISTICS_MODEL_VERSION,
      config: { dz: 39.5, shooterPitch: CFG1.shooterPitch, shooterOffset: 6, sweetSpot: { x: 60.5, y: 134.5 }, v0NoisePercent: 0.02, headingNoiseRad: 0.02, pitchNoiseRad: 0.006 },
      length: 18, width: 18, seed: 5, samples: 12, searchSamples: 150,
    });
    assert(k(CFG1) === v1Key && k({ POLLEN: CFG1, NECTAR: CFG1 }) === v1Key && k({ POLLEN: { ...CFG1, shooterLateralOffset: 0 }, NECTAR: { ...CFG1 } }) === v1Key, 'shared + lateral 0 = v1 key');
    // 기본값과 다른 새 항목만 키에 들어감
    const lateral = JSON.parse(k({ ...CFG1, shooterLateralOffset: 3 }));
    assert(lateral.config.shooterLateralOffset === 3 && lateral.pieces === undefined && lateral.nectar === undefined, 'lateral offset ≠ 0 -> in the shooter key');
    assert(JSON.stringify(JSON.parse(k({ POLLEN: CFG1 })).pieces) === '["POLLEN"]', 'POLLEN only -> pieces');
    assert(JSON.parse(k({ POLLEN: CFG1, NECTAR: CFG2 })).nectar.dz === CFG2.dz, 'different NECTAR shooter -> nectar');
    const none = JSON.parse(k({}));
    assert(none.config === null && JSON.stringify(none.pieces) === '[]', 'no shooter -> empty pieces');
    assert(new Set([v1Key, k({ ...CFG1, shooterLateralOffset: 3 }), k({ POLLEN: CFG1 }), k({ POLLEN: CFG1, NECTAR: CFG2 }), k({})]).size === 5, 'all distinct');

    // POLLEN_ONLY: POLLEN 작업만, 전체 격자 = 1기물, 결과 = 단일 스레드 generateRobotLUTs와 같음 (NECTAR 0 / v0 null)
    {
      const { manager, workers, drain } = setup({ poolSize: 2 });
      manager.request('robot1', { config: { POLLEN: CFG1 }, robotSize: size });
      assert(manager.getStatus('robot1').cellsTotal === LUT_GRID_SIZE * LUT_GRID_SIZE, 'POLLEN only -> one piece of cells');
      drain();
      const s = manager.getStatus('robot1');
      const direct = generateRobotLUTs({ POLLEN: CFG1 }, size, OPTS);
      assert(s.state === 'READY' && sameResult(s.result!, direct) && s.result!.v0.NECTAR === null && s.result!.luts.NECTAR.RED_AUDIENCE.every(v => v === 0), 'POLLEN only result = generateRobotLUTs');
      assert(workers.every(w => w.received.every(j => j.pieceType === 'POLLEN')), 'no NECTAR jobs');
      assert(s.cellsDone === s.cellsTotal && s.searched.NECTAR && s.rowsDone.NECTAR.every(v => v === 1), 'non-fireable piece counts as done');
    }
    // PER_PIECE: 기물마다 그 슈터 설정으로 작업, 결과 = generateRobotLUTs(기물별)
    {
      const { manager, workers, drain } = setup({ poolSize: 3 });
      manager.request('robot1', { config: { POLLEN: CFG1, NECTAR: CFG2 }, robotSize: size });
      drain();
      const s = manager.getStatus('robot1');
      assert(s.state === 'READY' && sameResult(s.result!, generateRobotLUTs({ POLLEN: CFG1, NECTAR: CFG2 }, size, OPTS)), 'per-piece result = generateRobotLUTs');
      const jobs = workers.flatMap(w => w.received);
      assert(jobs.filter(j => j.pieceType === 'NECTAR').every(j => j.config.dz === CFG2.dz) && jobs.filter(j => j.pieceType === 'POLLEN').every(j => j.config.dz === CFG1.dz), 'jobs carry the piece shooter config');
      assert(jobs.filter(j => j.pieceType === 'NECTAR').every(j => j.config.sweetSpot.x === 59.5 && j.config.sweetSpot.y === 129.5), 'NECTAR sweet spot snapped');
    }
    // NONE: 작업 / 캐시 없이 바로 READY, 다른 로봇과 경기 LUT
    {
      const puts: string[] = [];
      const cache: LUTCache = { get: async () => null, put: async key => void puts.push(key) };
      const { manager, workers, drain } = setup({ poolSize: 1, cache });
      manager.request('robot2', { config: {}, robotSize: size });
      const s = manager.getStatus('robot2');
      assert(s.state === 'READY' && s.cellsTotal === 0 && s.result!.v0.POLLEN === null && s.result!.luts.POLLEN.RED_AUDIENCE.every(v => v === 0), 'NONE -> READY at once with zero LUTs');
      assert(workers[0].received.length === 0 && puts.length === 0, 'no jobs, nothing cached');
      manager.request('robot2', { config: {}, robotSize: size });
      assert(manager.getStatus('robot2').generation === s.generation, 'same NONE request ignored');
      drain();
    }
    {
      const { manager, drain } = setup({ poolSize: 1 });
      manager.request('robot2', { config: {}, robotSize: size });
      manager.request('robot1', REQ1);
      drain();
      assert(!!manager.matchLUTs(), 'match LUTs with a NONE robot');
    }
    // 캐시: v1 키로 저장된 결과를 기물별 공용 요청이 그대로 씀 / POLLEN_ONLY 결과 저장 · 복원
    {
      const store = new Map<string, LUTCacheEntry>();
      const cache: LUTCache = { get: async key => store.get(key) ?? null, put: async (key, entry) => void store.set(key, entry) };
      const first = setup({ poolSize: 2, cache });
      first.manager.request('robot1', REQ1); // v1 방식 요청 (단일 설정)
      return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
        first.drain();
        assert(store.has(v1Key), 'stored under the v1 key');
        const second = setup({ poolSize: 2, cache });
        second.manager.request('robot1', { config: { POLLEN: { ...CFG1, shooterLateralOffset: 0 }, NECTAR: { ...CFG1, shooterLateralOffset: 0 } }, robotSize: size });
        second.manager.request('robot2', { config: { POLLEN: CFG1 }, robotSize: size });
        return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
          const s1 = second.manager.getStatus('robot1');
          assert(s1.state === 'READY' && s1.fromCache && sameResult(s1.result!, direct1), 'per-piece shared request hits the v1 cache entry');
          second.drain();
          assert(store.has(k({ POLLEN: CFG1 })), 'POLLEN only result stored under its own key');
          const third = setup({ poolSize: 1, cache });
          third.manager.request('robot2', { config: { POLLEN: CFG1 }, robotSize: size });
          return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
            const s2 = third.manager.getStatus('robot2');
            assert(s2.state === 'READY' && s2.fromCache && sameResult(s2.result!, generateRobotLUTs({ POLLEN: CFG1 }, size, OPTS)) && third.workers[0].received.length === 0, 'POLLEN only result restored from cache');
          });
        });
      });
    }
  }, 120_000);

  it('H. (12-4) 기물별 검증 / 로봇 간 공유', () => {
    // 발사 가능 기물의 슈터만 검증, 다르면 문제 기물 표시
    {
      const { manager, workers } = setup({ poolSize: 1 });
      manager.request('robot1', { config: { POLLEN: CFG1, NECTAR: { ...CFG2, shooterPitch: 0 } }, robotSize: REQ1.robotSize });
      const s = manager.getStatus('robot1');
      assert(s.state === 'IDLE' && s.issues.length > 0 && s.issues.every(i => i.pieceType === 'NECTAR') && workers[0].received.length === 0, 'invalid NECTAR shooter -> IDLE with NECTAR issues');
      manager.request('robot1', { config: { POLLEN: CFG1 }, robotSize: REQ1.robotSize });
      assert(manager.getStatus('robot1').state !== 'IDLE', 'POLLEN only does not validate the NECTAR card');
    }
    // 같은 확률표 입력(단일 설정 vs 같은 값의 기물별 설정)이면 한 번만 생성
    {
      const { manager, workers, drain } = setup({ poolSize: 2 });
      manager.request('robot1', REQ1);
      manager.request('robot2', { config: { POLLEN: { ...CFG1 }, NECTAR: { ...CFG1 } }, robotSize: REQ1.robotSize });
      drain();
      const jobs = workers.flatMap(w => w.received);
      assert(jobs.every(j => j.robotId === 'robot1') && manager.getStatus('robot2').state === 'READY' && sameResult(manager.getStatus('robot2').result!, direct1), 'equal inputs shared (one generation)');
    }
  }, 120_000);
});
