// LUT 생성 관리자 (명세서 2.6.2 LUT 생성 실행 1 · 3, 09-3): React 비의존
// Worker 풀 + 작업 대기열 + 조립 + 로봇별 상태 머신 / 취소.
//   - 작업 단위: (로봇, 기물 종류, 단계). 단계 ① v0 탐색 = 작업 1개, 단계 ② 기준 셀 LUT = 행 묶음 작업 (기본 4행).
//   - 동적 분배: 유휴 Worker가 대기열의 다음 작업을 가져간다. v0 탐색 작업이 행 작업보다 우선 (v0 결과 선표시),
//     행 작업은 들어온 순서대로. 같은 (로봇, 기물)의 행 작업은 그 v0 탐색이 끝나야 대기열에 들어간다.
//   - 결정론: 행 분할 / 순서 / Worker 수와 무관하게 결과 = generateRobotLUTs (09-2 격자별 독립 난수 구간).
//   - 취소: 로봇별 세대 번호를 올리고 대기열의 이전 세대 작업을 제거. 실행 중인 작업은 끝까지 돌게 두고 결과를 무시한다.
//   - 캐시 (09-4): 요청 시 캐시를 먼저 조회 → 적중하면 Worker 없이 즉시 READY, 미스 / 실패면 생성 후 저장.
//   - 공유 (09-10a): 다른 로봇이 같은 요청 키로 생성 중 / 완료면 따라가기(follower)만 한다 — 진행은 앞선 로봇 것을 보여주고,
//     앞선 로봇이 READY면 결과를 함께 쓰고, 멈추거나(취소 / 오류 / 설정 변경) 키가 바뀌면 그때부터 스스로 생성한다.
// Worker 생성 함수 / 캐시를 주입받아 Node에서 가짜로 테스트한다 (브라우저는 createLUTWorker.ts, lutCache.ts).

import {
  BALLISTICS_MODEL_VERSION,
  DEFAULT_BALLISTICS_SEED,
  DEFAULT_HEADING_NOISE_RAD,
  DEFAULT_LUT_SAMPLES,
  DEFAULT_PITCH_NOISE_RAD,
  DEFAULT_V0_NOISE_PERCENT,
  DEFAULT_V0_SEARCH_SAMPLES,
  LUT_GRID_SIZE,
  PIECE_TYPES,
  mirrorLUTSet,
  robotLUTSeeds,
  snapSweetSpot,
  validateBallisticsConfig,
} from '../core/ballistics';
import type { BallisticsIssue, RobotBallisticsResult } from '../core/ballistics';
import type { BallisticsConfig, MatchHeatmapLUTs } from '../core/types';
import type { LUTCache, LUTCacheEntry } from './lutCache';
import type { LUTJobMessage, LUTPieceType, LUTRobotId, LUTRobotSize, LUTWorkerMessage } from './lutProtocol';

export const DEFAULT_LUT_ROWS_PER_JOB = 4;
const CELLS_PER_PIECE = LUT_GRID_SIZE * LUT_GRID_SIZE;          // 20,736

// 브라우저 Worker에서 관리자가 쓰는 부분만 (가짜 Worker도 같은 모양)
export interface LUTWorkerLike {
  postMessage(message: LUTJobMessage): void;
  onmessage: ((event: { data: LUTWorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

// 로봇별 상태: IDLE(설정 없음 / 검증 실패) → QUEUED → SEARCHING(단계 ①) → GENERATING(단계 ②) → READY | ERROR.
// 진행 중 설정이 바뀌면 CANCELLED를 알린 뒤 다시 QUEUED. cancel()로 멈추면 CANCELLED에 머문다.
export type LUTGenState = 'IDLE' | 'QUEUED' | 'SEARCHING' | 'GENERATING' | 'READY' | 'ERROR' | 'CANCELLED';

export interface LUTRequest {
  config: BallisticsConfig;
  robotSize: LUTRobotSize;
}

// 로봇별 상태 스냅샷. reference / rowsDone은 조립 중인 버퍼를 그대로 노출한다 (읽기 전용으로 사용, 점진 히트맵용)
export interface RobotLUTStatus {
  state: LUTGenState;
  generation: number;
  issues: BallisticsIssue[];                        // 검증 실패 목록 (IDLE일 때)
  error: string | null;                             // ERROR 사유
  searched: Record<LUTPieceType, boolean>;          // 기물별 v0 탐색 완료 여부 (v0 선표시)
  v0: Record<LUTPieceType, number | null>;
  sweetSpotHitRate: Record<LUTPieceType, number>;   // 0이면 GUI 경고
  cellsDone: number;                                // 완료 격자 (기물 2종 합산, 진행 중 작업의 행 단위 진행 포함)
  cellsTotal: number;                               // 2 × 20,736
  reference: Record<LUTPieceType, Float32Array>;    // 조립 중인 기준 셀(RED_AUDIENCE) LUT
  rowsDone: Record<LUTPieceType, Uint8Array>;       // 행별 완료 여부 (1 = 계산 끝남)
  result: RobotBallisticsResult | null;             // READY일 때만
  fromCache: boolean;                               // 캐시에서 불러온 결과인지
}

export interface LUTManagerOptions {
  createWorker: () => LUTWorkerLike;
  poolSize?: number;       // 기본 defaultLUTPoolSize()
  samples?: number;        // 격자당 샘플 수 (기본 2000)
  searchSamples?: number;  // v0 후보당 샘플 수 (기본 20000)
  seed?: number;           // 기준 시드 (기본 DEFAULT_BALLISTICS_SEED)
  rowsPerJob?: number;     // 행 묶음 크기 (기본 4행 = 576격자)
  cache?: LUTCache | null; // LUT 캐시 (없으면 매번 생성)
  onChange?: (robotId: LUTRobotId) => void; // 상태 / 진행 변화마다 (GUI가 rAF로 모아서 갱신)
}

/** 풀 크기 = max(1, min(코어 수 − 1, 8)). 코어 수를 알 수 없으면 4코어로 가정 */
export function defaultLUTPoolSize(hardwareConcurrency?: number): number {
  const hw = hardwareConcurrency ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
  const cores = typeof hw === 'number' && Number.isFinite(hw) && hw > 0 ? Math.floor(hw) : 4;
  return Math.max(1, Math.min(cores - 1, 8));
}

/**
 * LUT 결과를 결정하는 입력의 정규화 키 (재요청 무시 판정, 09-4 캐시 키의 원문):
 * 모델 버전 + 탄도 설정(스윗스팟은 스냅한 좌표, 편차 미지정 값은 기본값으로 채움) + 로봇 길이 / 폭 + 시드 + 샘플 수.
 * skipUnreachable은 결과가 같으므로 제외. 속성 순서를 고정한 JSON 문자열.
 */
export function lutRequestKey(req: LUTRequest, samples: number, searchSamples: number, seed: number): string {
  const c = req.config;
  const sweetSpot = snapSweetSpot(c.sweetSpot);
  return JSON.stringify({
    modelVersion: BALLISTICS_MODEL_VERSION,
    config: {
      dz: c.dz,
      shooterPitch: c.shooterPitch,
      shooterOffset: c.shooterOffset,
      sweetSpot: { x: sweetSpot.x, y: sweetSpot.y },
      v0NoisePercent: c.v0NoisePercent ?? DEFAULT_V0_NOISE_PERCENT,
      headingNoiseRad: c.headingNoiseRad ?? DEFAULT_HEADING_NOISE_RAD,
      pitchNoiseRad: c.pitchNoiseRad ?? DEFAULT_PITCH_NOISE_RAD,
    },
    length: req.robotSize.length,
    width: req.robotSize.width,
    seed,
    samples,
    searchSamples,
  });
}

type Job = LUTJobMessage;

interface WorkerSlot {
  worker: LUTWorkerLike;
  job: Job | null;
}

interface RobotRun {
  state: LUTGenState;
  generation: number;
  key: string | null;
  issues: BallisticsIssue[];
  error: string | null;
  config: BallisticsConfig | null;    // 스윗스팟을 스냅한 설정
  robotSize: LUTRobotSize | null;
  searched: Record<LUTPieceType, boolean>;
  v0: Record<LUTPieceType, number | null>;
  hitRate: Record<LUTPieceType, number>;
  reference: Record<LUTPieceType, Float32Array>;
  rowsDone: Record<LUTPieceType, Uint8Array>;
  rowsRemaining: Record<LUTPieceType, number>;
  cellsCompleted: number;
  jobProgress: Map<number, number>;   // 실행 중인 행 작업별 진행 격자 수
  result: RobotBallisticsResult | null;
  fromCache: boolean;
  leader: LUTRobotId | null;          // 같은 키로 따라가는 다른 로봇 (09-10a 공유)
}

const perPiece = <T>(make: () => T): Record<LUTPieceType, T> => ({ POLLEN: make(), NECTAR: make() });

function emptyRun(generation: number): RobotRun {
  return {
    state: 'IDLE',
    generation,
    key: null,
    issues: [],
    error: null,
    config: null,
    robotSize: null,
    searched: perPiece(() => false),
    v0: perPiece<number | null>(() => null),
    hitRate: perPiece(() => 0),
    reference: perPiece(() => new Float32Array(CELLS_PER_PIECE)),
    rowsDone: perPiece(() => new Uint8Array(LUT_GRID_SIZE)),
    rowsRemaining: perPiece(() => LUT_GRID_SIZE),
    cellsCompleted: 0,
    jobProgress: new Map(),
    result: null,
    fromCache: false,
    leader: null,
  };
}

const IN_PROGRESS: ReadonlySet<LUTGenState> = new Set(['QUEUED', 'SEARCHING', 'GENERATING']);
const OTHER: Readonly<Record<LUTRobotId, LUTRobotId>> = { robot1: 'robot2', robot2: 'robot1' };

export class LUTManager {
  private readonly slots: WorkerSlot[];
  private readonly samples: number;
  private readonly searchSamples: number;
  private readonly seed: number;
  private readonly rowsPerJob: number;
  private readonly onChange: (robotId: LUTRobotId) => void;
  private readonly cache: LUTCache | null;
  private readonly runs: Record<LUTRobotId, RobotRun> = { robot1: emptyRun(0), robot2: emptyRun(0) };
  private searchQueue: Job[] = [];
  private rowQueue: Job[] = [];
  private nextJobId = 1;
  private disposed = false;

  constructor(options: LUTManagerOptions) {
    this.samples = Math.max(1, Math.floor(options.samples ?? DEFAULT_LUT_SAMPLES));
    this.searchSamples = Math.max(1, Math.floor(options.searchSamples ?? DEFAULT_V0_SEARCH_SAMPLES));
    this.seed = options.seed ?? DEFAULT_BALLISTICS_SEED;
    this.rowsPerJob = Math.max(1, Math.floor(options.rowsPerJob ?? DEFAULT_LUT_ROWS_PER_JOB));
    this.onChange = options.onChange ?? (() => {});
    this.cache = options.cache ?? null;
    const poolSize = Math.max(1, Math.floor(options.poolSize ?? defaultLUTPoolSize()));
    // 풀은 관리자 수명 동안 재사용 (Worker 강제 종료 / 재생성 없음)
    this.slots = Array.from({ length: poolSize }, () => {
      const slot: WorkerSlot = { worker: options.createWorker(), job: null };
      slot.worker.onmessage = event => this.handleMessage(slot, event.data);
      slot.worker.onerror = event => this.handleWorkerError(slot, event.message ?? 'worker error');
      return slot;
    });
  }

  get poolSize(): number {
    return this.slots.length;
  }

  /**
   * 탄도 설정 확정 (GUI APPLY): 검증 실패면 IDLE(+ 사유). LUT를 결정하는 입력(lutRequestKey)이 진행 중 / 완료된 요청과 같으면
   * 아무것도 하지 않는다 (속도 / 인테이크 등 무관한 제원 변경으로 다시 APPLY해도 재생성하지 않음). 그 외에는 새로 생성.
   */
  request(robotId: LUTRobotId, req: LUTRequest): void {
    if (this.disposed) return;
    const run = this.runs[robotId];
    const issues = validateBallisticsConfig(req.config, req.robotSize);
    if (issues.length > 0) {
      this.reset(robotId, 'IDLE');
      this.runs[robotId].issues = issues;
      this.emit(robotId);
      return;
    }
    const key = lutRequestKey(req, this.samples, this.searchSamples, this.seed);
    if (key === run.key && (IN_PROGRESS.has(run.state) || run.state === 'READY')) return;

    if (IN_PROGRESS.has(run.state)) {
      this.reset(robotId, 'CANCELLED');
      this.emit(robotId);
    }
    const next = this.reset(robotId, 'QUEUED');
    next.key = key;
    next.config = { ...req.config, sweetSpot: snapSweetSpot(req.config.sweetSpot) };
    next.robotSize = { length: req.robotSize.length, width: req.robotSize.width };
    // 다른 로봇이 같은 LUT를 생성 중 / 완료했으면 따라가기 (기본 프리셋처럼 R1 = R2면 한 번만 생성)
    const otherId = OTHER[robotId];
    const other = this.runs[otherId];
    if (other.key === key && other.leader === null && (IN_PROGRESS.has(other.state) || other.state === 'READY')) {
      next.leader = otherId;
      this.syncFollower(otherId);
      return;
    }
    this.emit(robotId);
    this.startOwn(robotId, next);
  }

  /** 진행 중인 생성을 멈춘다 (CANCELLED). 진행 중이 아니면 아무것도 하지 않음 */
  cancel(robotId: LUTRobotId): void {
    if (!IN_PROGRESS.has(this.runs[robotId].state)) return;
    this.reset(robotId, 'CANCELLED');
    this.emit(robotId);
  }

  getStatus(robotId: LUTRobotId): RobotLUTStatus {
    const run = this.runs[robotId];
    const src = run.leader ? this.runs[run.leader] : run; // 따라가는 중이면 진행은 앞선 로봇 것
    let inFlight = 0;
    for (const cells of src.jobProgress.values()) inFlight += cells;
    return {
      state: run.state,
      generation: run.generation,
      issues: [...run.issues],
      error: run.error,
      searched: { ...src.searched },
      v0: { ...src.v0 },
      sweetSpotHitRate: { ...src.hitRate },
      cellsDone: src.cellsCompleted + inFlight,
      cellsTotal: PIECE_TYPES.length * CELLS_PER_PIECE,
      reference: src.reference,
      rowsDone: src.rowsDone,
      result: run.result,
      fromCache: run.fromCache,
    };
  }

  /** 두 로봇이 모두 READY면 경기용 LUT (createLUTShotResolver 입력), 아니면 null */
  matchLUTs(): MatchHeatmapLUTs | null {
    const r1 = this.runs.robot1.result;
    const r2 = this.runs.robot2.result;
    if (this.runs.robot1.state !== 'READY' || this.runs.robot2.state !== 'READY' || !r1 || !r2) return null;
    return { robot1: r1.luts, robot2: r2.luts };
  }

  /** Worker 전부 종료 (앱 종료 / 테스트 정리). 이후 요청은 무시 */
  dispose(): void {
    this.disposed = true;
    this.searchQueue = [];
    this.rowQueue = [];
    for (const slot of this.slots) {
      slot.job = null;
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    }
  }

  // 새 세대로 초기화하고 대기열의 이전 세대 작업을 제거 (실행 중인 작업 결과는 세대 불일치로 무시됨)
  private reset(robotId: LUTRobotId, state: LUTGenState): RobotRun {
    const run = emptyRun(this.runs[robotId].generation + 1);
    run.state = state;
    this.runs[robotId] = run;
    this.searchQueue = this.searchQueue.filter(job => job.robotId !== robotId);
    this.rowQueue = this.rowQueue.filter(job => job.robotId !== robotId);
    return run;
  }

  // 상태 / 진행 알림 + 이 로봇을 따라가는 다른 로봇 갱신
  private emit(robotId: LUTRobotId): void {
    this.onChange(robotId);
    this.syncFollower(robotId);
  }

  // 따라가는 로봇 갱신: 앞선 로봇이 같은 키로 진행 중이면 상태만 맞추고, READY면 결과를 함께 쓰고,
  // 그 외(취소 / 오류 / 검증 실패 / 키 변경)면 따라가기를 끝내고 스스로 생성 (캐시 조회부터)
  private syncFollower(leaderId: LUTRobotId): void {
    const followerId = OTHER[leaderId];
    const f = this.runs[followerId];
    if (f.leader !== leaderId) return;
    const lead = this.runs[leaderId];
    if (lead.key === f.key && IN_PROGRESS.has(lead.state)) {
      f.state = lead.state;
    } else if (lead.key === f.key && lead.state === 'READY' && lead.result) {
      for (const type of PIECE_TYPES) {
        f.searched[type] = lead.searched[type];
        f.v0[type] = lead.v0[type];
        f.hitRate[type] = lead.hitRate[type];
        f.rowsRemaining[type] = 0;
      }
      f.reference = lead.reference;
      f.rowsDone = lead.rowsDone;
      f.cellsCompleted = lead.cellsCompleted;
      f.result = lead.result;
      f.fromCache = lead.fromCache;
      f.leader = null;
      f.state = 'READY';
    } else {
      f.leader = null;
      f.state = 'QUEUED';
      this.onChange(followerId);
      this.startOwn(followerId, f);
      return;
    }
    this.onChange(followerId);
  }

  private startOwn(robotId: LUTRobotId, run: RobotRun): void {
    if (this.cache) this.lookupCache(robotId, run, this.cache);
    else this.enqueueSearches(robotId, run);
  }

  private enqueueSearches(robotId: LUTRobotId, run: RobotRun): void {
    const seeds = robotLUTSeeds(this.seed);
    for (const pieceType of PIECE_TYPES) {
      this.searchQueue.push(this.makeJob('search', robotId, run, pieceType, this.searchSamples, seeds[pieceType].search));
    }
    this.dispatch();
  }

  // 캐시 조회 (비동기, 상태는 QUEUED 유지). 조회가 끝났을 때 그 사이 재요청 / 취소 / 정리로 실행이 바뀌었으면 결과를 버린다.
  private lookupCache(robotId: LUTRobotId, run: RobotRun, cache: LUTCache): void {
    const settle = (entry: LUTCacheEntry | null) => {
      if (this.disposed || this.runs[robotId] !== run || run.state !== 'QUEUED') return;
      if (entry) this.applyCached(robotId, run, entry);
      else this.enqueueSearches(robotId, run);
    };
    let pending: Promise<LUTCacheEntry | null>;
    try {
      pending = cache.get(run.key!);
    } catch {
      pending = Promise.resolve(null);
    }
    pending.then(settle, () => settle(null));
  }

  private applyCached(robotId: LUTRobotId, run: RobotRun, entry: LUTCacheEntry): void {
    for (const type of PIECE_TYPES) {
      run.searched[type] = true;
      run.v0[type] = entry.v0[type];
      run.hitRate[type] = entry.sweetSpotHitRate[type];
      run.reference[type] = entry.reference[type];
      run.rowsDone[type].fill(1);
      run.rowsRemaining[type] = 0;
    }
    run.cellsCompleted = PIECE_TYPES.length * CELLS_PER_PIECE;
    run.fromCache = true;
    this.completeIfDone(robotId);
  }

  private makeJob(kind: Job['kind'], robotId: LUTRobotId, run: RobotRun, pieceType: LUTPieceType, samples: number, seed: number): Job {
    return {
      kind,
      jobId: this.nextJobId++,
      generation: run.generation,
      robotId,
      pieceType,
      config: run.config!,
      robotSize: run.robotSize!,
      samples,
      seed,
    };
  }

  private isCurrent(job: Job): boolean {
    const run = this.runs[job.robotId];
    return job.generation === run.generation && IN_PROGRESS.has(run.state);
  }

  // 유휴 Worker마다 다음 작업 배정 (v0 탐색 우선)
  private dispatch(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.job) continue;
      const job = this.searchQueue.shift() ?? this.rowQueue.shift();
      if (!job) return;
      slot.job = job;
      const run = this.runs[job.robotId];
      if (job.kind === 'search' && run.state === 'QUEUED') {
        run.state = 'SEARCHING';
        this.emit(job.robotId);
      }
      slot.worker.postMessage(job);
    }
  }

  private handleMessage(slot: WorkerSlot, message: LUTWorkerMessage): void {
    const job = slot.job;
    if (!job || message.jobId !== job.jobId) return;
    if (message.kind === 'progress') {
      if (this.isCurrent(job) && job.kind === 'rows') {
        this.runs[job.robotId].jobProgress.set(job.jobId, message.cellsDone);
        this.emit(job.robotId);
      }
      return;
    }
    slot.job = null;
    if (this.isCurrent(job)) {
      if (message.kind === 'error') this.fail(job.robotId, message.message);
      else if (job.kind === 'search') this.onSearchResult(job, message.v0, message.hitRate);
      else this.onRowsResult(job, message.rows);
    }
    this.dispatch();
  }

  private handleWorkerError(slot: WorkerSlot, message: string): void {
    const job = slot.job;
    slot.job = null;
    if (job && this.isCurrent(job)) this.fail(job.robotId, message);
    this.dispatch();
  }

  private fail(robotId: LUTRobotId, message: string): void {
    const run = this.reset(robotId, 'ERROR');
    run.error = message;
    this.emit(robotId);
  }

  private onSearchResult(job: Job, v0: number | undefined, hitRate: number | undefined): void {
    const run = this.runs[job.robotId];
    const type = job.pieceType;
    run.searched[type] = true;
    if (typeof v0 === 'number' && Number.isFinite(v0)) {
      run.v0[type] = v0;
      run.hitRate[type] = typeof hitRate === 'number' && Number.isFinite(hitRate) ? hitRate : 0;
      const seed = robotLUTSeeds(this.seed)[type].lut;
      for (let gy = 0; gy < LUT_GRID_SIZE; gy += this.rowsPerJob) {
        const rows = this.makeJob('rows', job.robotId, run, type, this.samples, seed);
        rows.gyStart = gy;
        rows.gyEnd = Math.min(LUT_GRID_SIZE, gy + this.rowsPerJob);
        rows.v0 = v0;
        this.rowQueue.push(rows);
      }
    } else {
      // 닫힌 해 없음 (검증을 통과했다면 발생하지 않음): generateRobotLUTs와 같이 그 기물 LUT는 전부 0
      run.rowsRemaining[type] = 0;
      run.rowsDone[type].fill(1);
      run.cellsCompleted += CELLS_PER_PIECE;
    }
    if (PIECE_TYPES.every(t => run.searched[t])) run.state = 'GENERATING';
    this.emit(job.robotId);
    this.completeIfDone(job.robotId);
  }

  private onRowsResult(job: Job, rows: Float32Array | undefined): void {
    const run = this.runs[job.robotId];
    const type = job.pieceType;
    const start = job.gyStart ?? 0;
    const end = job.gyEnd ?? LUT_GRID_SIZE;
    const expected = (end - start) * LUT_GRID_SIZE;
    if (!rows || rows.length !== expected) {
      this.fail(job.robotId, `rows ${start}-${end}: expected ${expected} cells, got ${rows?.length ?? 0}`);
      return;
    }
    run.reference[type].set(rows, start * LUT_GRID_SIZE);
    run.rowsDone[type].fill(1, start, end);
    run.rowsRemaining[type] -= end - start;
    run.cellsCompleted += expected;
    run.jobProgress.delete(job.jobId);
    this.emit(job.robotId);
    this.completeIfDone(job.robotId);
  }

  // 두 기물 모두 탐색 + 모든 행이 모이면 4셀 대칭 복사로 완성 → READY
  private completeIfDone(robotId: LUTRobotId): void {
    const run = this.runs[robotId];
    if (!PIECE_TYPES.every(t => run.searched[t] && run.rowsRemaining[t] === 0)) return;
    run.result = {
      luts: { POLLEN: mirrorLUTSet(run.reference.POLLEN), NECTAR: mirrorLUTSet(run.reference.NECTAR) },
      v0: { ...run.v0 },
      sweetSpotHitRate: { ...run.hitRate },
      issues: [],
    };
    run.state = 'READY';
    this.emit(robotId);
    if (this.cache && !run.fromCache && run.key) {
      // 저장 실패는 무시 (다음에 다시 생성하면 됨)
      const entry: LUTCacheEntry = { v0: { ...run.v0 }, sweetSpotHitRate: { ...run.hitRate }, reference: run.reference };
      try {
        this.cache.put(run.key, entry).catch(() => {});
      } catch {
        // 동기 예외도 무시
      }
    }
  }
}
