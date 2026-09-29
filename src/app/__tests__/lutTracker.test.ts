// LUT 생성 연결 (명세서 3.8 LUT 생성 흐름 연결, 09-10a): 가짜 Worker로 관리자를 돌려 요청 / 알림 모음 / 결과 / 다시 시도 확인
import { describe, expect, it } from 'vitest';
import { generateRobotLUTs } from '../../core/ballistics';
import { FakeWorker } from '../../workers/__tests__/fakeWorker';
import { profileBallisticsConfig } from '../../ui/robotForm';
import { DEFAULT_DRAFT_VALUES } from '../defaultSetup';
import { LUT_UPDATE_INTERVAL_MS, LUTTracker } from '../lutTracker';

const OPTS = { samples: 12, searchSamples: 150, seed: 5 };

function setup(poolSize = 2) {
  const workers: FakeWorker[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let clock = 0;
  let updates = 0;
  const tracker = new LUTTracker({
    ...OPTS,
    poolSize,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    now: () => clock,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onUpdate: () => {
      updates++;
    },
  });
  const live = () => timers.filter(t => !t.cancelled);
  const fire = () => {
    for (const t of live()) {
      t.cancelled = true;
      t.fn();
    }
  };
  const drain = () => {
    while (workers.some(w => w.step()));
  };
  return {
    tracker,
    workers,
    live,
    fire,
    drain,
    tick: (ms: number) => (clock += ms),
    updates: () => updates,
  };
}

describe('LUT 생성 연결 (09-10a)', () => {
  const direct = generateRobotLUTs(profileBallisticsConfig(DEFAULT_DRAFT_VALUES.robot1), { length: 18, width: 18 }, OPTS);

  it('A. 기본 프리셋(R1 = R2): 한 번만 생성, 둘 다 READY, 결과 공유 = generateRobotLUTs', () => {
    const { tracker, workers, drain } = setup();
    expect(tracker.results()).toBeNull();
    tracker.request(DEFAULT_DRAFT_VALUES);
    expect(tracker.view('robot1').phase).toBe('WORKING');
    expect(tracker.view('robot2').phase).toBe('WORKING');
    drain();
    const results = tracker.results();
    expect(results).not.toBeNull();
    expect(results!.robot1).toBe(results!.robot2);
    expect(results!.robot1.v0).toEqual(direct.v0);
    expect(results!.robot1.luts.POLLEN.RED_AUDIENCE).toEqual(direct.luts.POLLEN.RED_AUDIENCE);
    expect(tracker.view('robot2')).toMatchObject({ phase: 'READY', progress: 1, v0: direct.v0 });
    expect(workers.reduce((n, w) => n + w.received.length, 0)).toBe(2 + 72); // 한 로봇분 (탐색 2 + 행 작업 72)
    // 같은 값으로 다시 요청 → 그대로 READY
    tracker.request(DEFAULT_DRAFT_VALUES);
    expect(tracker.results()!.robot1).toBe(results!.robot1);
  });

  it('B. 알림: 단계 변화는 바로, 진행만 바뀌면 100 ms로 모아서 한 번', () => {
    const { tracker, workers, live, fire, updates } = setup(1);
    tracker.request(DEFAULT_DRAFT_VALUES);
    const afterRequest = updates();
    expect(afterRequest).toBeGreaterThanOrEqual(2); // 두 로봇 QUEUED
    workers[0].step(); // POLLEN 탐색 → SEARCHING (단계 변화: 바로)
    workers[0].step(); // NECTAR 탐색 → GENERATING
    const afterSearch = updates();
    expect(afterSearch).toBeGreaterThan(afterRequest);
    for (let i = 0; i < 5; i++) workers[0].step(); // 행 작업: 진행만
    expect(updates()).toBe(afterSearch);
    expect(live().length).toBe(1);
    expect(live()[0].ms).toBe(LUT_UPDATE_INTERVAL_MS);
    fire();
    expect(updates()).toBe(afterSearch + 1);
    expect(tracker.view('robot1').progress).toBeCloseTo(20 / 288, 6); // 5작업 × 4행 / (2 × 144행)
  });

  it('C. 남은 시간: 생성 시작 뒤 시계로 추정', () => {
    const { tracker, workers, tick } = setup(1);
    tracker.request(DEFAULT_DRAFT_VALUES);
    workers[0].step();
    tick(300);
    workers[0].step(); // GENERATING 시작 (시각 300)
    expect(tracker.view('robot1').remainingMs).toBeNull();
    for (let i = 0; i < 8; i++) workers[0].step(); // 32행 = 32 / 288
    tick(1000);
    const eta = tracker.view('robot1').remainingMs!;
    expect(eta).toBeCloseTo((1000 * (288 - 32)) / 32, 6);
    expect(tracker.view('robot2').remainingMs).toBeCloseTo(eta, 6); // 따라가는 로봇도 같은 추정
  });

  it('D. 오류 → 다시 시도, 오류가 아니면 다시 시도는 무시, 정리 후 알림 없음', () => {
    const { tracker, workers, drain, updates, fire } = setup(1);
    tracker.request(DEFAULT_DRAFT_VALUES);
    workers[0].failNext = 'error';
    workers[0].step();
    expect(tracker.view('robot1')).toMatchObject({ phase: 'ERROR', error: 'boom' });
    drain(); // R2는 따라가기를 끝내고 스스로 생성
    expect(tracker.view('robot2').phase).toBe('READY');
    expect(tracker.results()).toBeNull();
    tracker.retry('robot1'); // R2와 같은 입력 → 결과 공유로 바로 READY
    expect(tracker.view('robot1').phase).toBe('READY');
    expect(tracker.results()!.robot1.v0).toEqual(direct.v0);
    const posted = workers[0].received.length;
    tracker.retry('robot1');
    expect(workers[0].received.length).toBe(posted);
    // 정리: Worker 종료, 이후 알림 없음
    tracker.request({ robot1: { ...DEFAULT_DRAFT_VALUES.robot1, config: { ...DEFAULT_DRAFT_VALUES.robot1.config, length: 16 } }, robot2: DEFAULT_DRAFT_VALUES.robot2 });
    const before = updates();
    tracker.dispose();
    fire();
    drain();
    expect(updates()).toBe(before);
    expect(workers.every(w => w.terminated)).toBe(true);
  });
});
