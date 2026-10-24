// 경기 자동 저장 / 복구 (명세서 3.9 경기 자동 저장 / 복구, 19-1)
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_IDLE_DELAY_MS, AUTOSAVE_RUNNING_INTERVAL_MS, AutosaveScheduler, autosaveSignature, createMemoryAutosave } from '../matchAutosave';
import type { AppStatus } from '../appController';

// 가짜 타이머 + 시계
const fakeTimers = () => {
  let time = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      time = due[1].at;
      due[1].fn();
    }
    time = end;
  };
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (id: number) => void pending.delete(id),
    advance,
    get waiting() {
      return pending.size;
    },
  };
};
type Branch = AppStatus['branches'][number];
const branch = (id: number, headTick: number, extra: Partial<Branch> = {}): Branch => ({
  id, number: id, name: null, parentId: id === 1 ? null : 1, forkTick: 0, depth: id === 1 ? 0 : 1, headTick, ended: headTick >= 6000, totalScore: null, ...extra,
});
const status = (phase: AppStatus['phase'], branches: Branch[], currentBranchId = 1) => ({ phase, branches, currentBranchId });

describe('경기 자동 저장 (19-1)', () => {
  it('A. 저장 표식: 경기 중이고 기록이 있을 때만, 기록을 바꾸는 값(지금 가지 / 이름 / 머리 …)이 바뀌면 달라짐', () => {
    expect(autosaveSignature(status('SETUP', [branch(1, 0)]))).toBeNull();
    expect(autosaveSignature(status('ROTATING_IN', [branch(1, 0)]))).toBeNull();
    expect(autosaveSignature(status('MATCH', [branch(1, 0)]))).toBeNull(); // 0틱 원본 하나 = 저장할 것 없음
    const a = autosaveSignature(status('MATCH', [branch(1, 100)]));
    expect(a).not.toBeNull();
    expect(autosaveSignature(status('MATCH', [branch(1, 100)]))).toBe(a);
    expect(autosaveSignature(status('MATCH', [branch(1, 150)]))).not.toBe(a);
    expect(autosaveSignature(status('MATCH', [branch(1, 100, { name: 'Plan A' })]))).not.toBe(a);
    const two = [branch(1, 100), branch(2, 40, { forkTick: 40 })];
    expect(autosaveSignature(status('MATCH', two, 1))).not.toBe(autosaveSignature(status('MATCH', two, 2))); // 가지 전환
    expect(autosaveSignature(status('MATCH', [branch(1, 0), branch(2, 0)]))).not.toBeNull(); // 0틱이어도 가지가 2개면 저장
  });

  it('B. 예약: 진행 중이 아니면 잠시 뒤 한 번(연속 변경은 마지막 뒤), 같은 표식은 다시 저장하지 않음', () => {
    const timers = fakeTimers();
    let saves = 0;
    const s = new AutosaveScheduler({ ...timers, save: () => saves++ });
    s.update('a', false);
    s.update('b', false);
    timers.advance(AUTOSAVE_IDLE_DELAY_MS - 1);
    expect(saves).toBe(0);
    s.update('c', false); // 다시 미룸
    timers.advance(AUTOSAVE_IDLE_DELAY_MS);
    expect(saves).toBe(1);
    s.update('c', false);
    timers.advance(10_000);
    expect(saves).toBe(1); // 바뀐 것 없음
    s.update(null, false); // 경기 전 / 회전 = 예약 취소, 저장 없음
    expect(timers.waiting).toBe(0);
  });

  it('C. 진행 중: 처음은 바로, 그 뒤로 최대 간격마다 한 번 (표식이 매번 바뀌어도), 멈추면 간격을 기다리지 않고 잠시 뒤', () => {
    const timers = fakeTimers();
    const savedAt: number[] = [];
    const s = new AutosaveScheduler({ ...timers, save: () => savedAt.push(timers.now()) });
    for (let t = 0; t < 12_000; t += 100) {
      s.update(`tick${t}`, true);
      timers.advance(100);
    }
    expect(savedAt).toEqual([0, AUTOSAVE_RUNNING_INTERVAL_MS, 2 * AUTOSAVE_RUNNING_INTERVAL_MS]);
    s.update('paused', false); // 12 000 ms에 일시정지
    timers.advance(AUTOSAVE_IDLE_DELAY_MS);
    expect(savedAt.at(-1)).toBe(12_000 + AUTOSAVE_IDLE_DELAY_MS);
    expect(savedAt).toHaveLength(4);
  });

  it('D. 바로 저장(탭 숨김 / 페이지 닫힘) / 지운 뒤 처음 상태(같은 표식도 다시 저장) / 메모리 저장소', async () => {
    const timers = fakeTimers();
    let saves = 0;
    const s = new AutosaveScheduler({ ...timers, save: () => saves++ });
    s.flush();
    expect(saves).toBe(0); // 예약 없음
    s.update('a', false);
    s.flush();
    expect(saves).toBe(1);
    expect(timers.waiting).toBe(0);
    s.reset();
    s.update('a', false);
    timers.advance(AUTOSAVE_IDLE_DELAY_MS);
    expect(saves).toBe(2);
    s.dispose();
    s.update('b', false);
    expect(timers.waiting).toBe(0); // 정리한 뒤의 상태 알림은 무시
    const store = createMemoryAutosave();
    expect(await store.load()).toBeNull();
    await store.save('{"x":1}');
    expect(await store.load()).toBe('{"x":1}');
    await store.clear();
    expect(store.text).toBeNull();
  });
});
