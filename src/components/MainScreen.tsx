// 메인 화면 (명세서 3.8 화면 구성, 09-6d 화면 뼈대): 좌측 득점 패널 / 필드 / 접힌 config 아이콘 띠 / 스크러버 줄.
// 시뮬레이션 / 그리기는 AppController(React 밖)가 소유하고, React는 약 10 Hz 상태 알림으로 패널 / 버튼만 그린다.
// 09-7b: 확인창 모달 / 경고 토스트 / 자동 일시정지 배너 / 타임라인 끌기. 09-7c: 경기 종료 연출(흰빛 / 배너 · 진행바). 09-8a: config 창 틀(펼치기 / 탭 / 초안 · 적용 / START 막기).
// 09-8b: SETTINGS 탭(즉시 적용) + localStorage 자동 보관, 언어는 SETTINGS 값.
// 09-10a: 명중 확률표(LUT) 생성 연결 — 앱 시작(자동 보관 / 기본 프리셋)과 로봇 탭 APPLY에서 요청, 두 로봇이 준비되면 경기 판정 = LUT,
// 준비될 때까지 START를 막는다 (Worker 풀 / 캐시는 LUTTracker가 소유, React는 약 10 Hz 요약만 받음).
// 09-10b: 필드 편집 모드(히트맵) — 로봇 탭 SHOW HIT MAP으로 열고, 그 탭을 떠나거나 창을 닫거나 START하면 끝남. 장면은 컨트롤러가 그림.
// 09-11a: 시나리오 탭(초안 / APPLY) + 시드 REROLL(바로 적용 + 자동 보관). 18-1: 시드 직접 입력은 초안 / APPLY.
// 09-11b: 시작 자세 모드(EDIT ON FIELD) — 로봇 몸체 / 회전 핸들 끌기(포인터 캡처) = 초안 시작 자세, DONE · APPLY = SCENARIO 탭 적용.
// 14-1a: 시작 자세 모드 → 시나리오 필드 편집 모드(SCENARIO): 겹친 자리에 놓으면 끌기 전으로 + 사유 토스트, 모드 중 시나리오 변경의
// 되돌리기 / 다시 하기(Ctrl / ⌘ + Z, Ctrl / ⌘ + Shift + Z, Ctrl + Y, 안내 띠 버튼).
// 14-1b: 바닥 기물 — 안내 띠 + POLLEN / + NECTAR(추가 상태, 바닥 클릭 = 하나씩, Esc = 추가 상태만 끝), 끌어 옮기기 / 필드 밖으로 끌어 빼기,
// 겹친 자리 / 놓을 기물 없음 = 놓지 않고 사유 토스트.
// 14-1c: HIVE / FLOWER / GARDEN을 누르면 그 옆 팝오버(개수 조절기, 탭과 같은 고치기 · 되돌리기 기록), Esc = 팝오버만 닫기.
// 14-1d: 로봇을 끌지 않고 클릭하면 로봇 팝오버(적재물 칸 + 오토 이동), 다시 클릭하면 닫기.
// 09-10c: 스윗스팟 모드(SET ON FIELD) — 필드 클릭 = 초안 스윗스팟, DONE · APPLY = 그 로봇 탭 적용, CANCEL / Esc / START = 들어오기 전 값으로.

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AppController } from '../app/appController';
import type { AppStatus, LiftToast, MatchLoadJob } from '../app/appController';
import { DEFAULT_DRAFT_VALUES, setupFromDrafts } from '../app/defaultSetup';
import { LUTTracker } from '../app/lutTracker';
import type { MatchLUTResults } from '../app/lutTracker';
import type { RobotId } from '../input/inputConfig';
import { createBrowserLUTWorker } from '../workers/createLUTWorker';
import { createBrowserLUTCache } from '../workers/lutCache';
import type { LUTCache } from '../workers/lutCache';
import type { LUTWorkerLike } from '../workers/lutManager';
import { PENDING_LUT_VIEW, lutInputsChanged, startBlocker } from '../ui/lutView';
import type { RobotLutView } from '../ui/lutView';
import { DEFAULT_RNG_SEED } from '../core/simulationEngine';
import { RecipeInputCache, buildMatchRecipe, parseMatchRecipe, recipeLoadTree, serializeMatchRecipe } from '../app/matchRecipe';
import type { MatchRecipe, RecipeWarning } from '../app/matchRecipe';
import { AutosaveScheduler, autosaveSignature, createBrowserAutosave } from '../app/matchAutosave';
import type { AutosaveStore } from '../app/matchAutosave';
import { LIBRARY_KINDS, createBrowserLibrary, newLibraryId } from '../app/libraryStore';
import type { LibraryItem, LibraryKind, LibraryStore } from '../app/libraryStore';
import {
  findByName,
  libraryMaxItems,
  matchItemMeta,
  matchItemName,
  matchItemSummary,
  robotItemSummary,
  saveDecision,
  scenarioItemSummary,
  setupItemSummary,
  sortLibrary,
} from '../ui/library';
import type { LibrarySummary } from '../ui/library';
import LibrarySection from './LibrarySection';
import type { LibrarySectionKind } from './LibrarySection';
import { autosaveRestoreMessage, compareLoadedBranch, matchComputingText, matchFileName, matchImportConfirmMessage, matchImportErrorMessage, matchImportProgress, matchSummaryText, mismatchBanner, summaryFileName } from '../ui/matchFile';
import type { MatchComparison, MatchImportError } from '../ui/matchFile';
import { t } from '../ui/i18n';
import type { Language } from '../ui/i18n';
import { DEFAULT_SETTINGS, browserSettingsStorage, loadStoredConfig, saveStoredConfig } from '../ui/settings';
import { ROW_KIND, ROW_TABS, buildPresetFile, importOverwriteTabs, importPresetToDrafts, parsePresetFile, presetErrorMessage, presetFileName, presetLoadedNotice, tabNames } from '../ui/presetFile';
import type { PresetError, PresetRow } from '../ui/presetFile';
import { downloadTextFile, pickTextFile } from '../ui/fileTransfer';
import type { UiSettings } from '../ui/settings';
import { fieldCanvasSize, layoutCssVars, robotLabel } from '../ui/mainScreenModel';
import { branchComparison, branchConfirmText, branchFullText, branchLabel, branchMenuEnabled, currentBranchInfo, deleteConfirmText, fileBranchNumber, newMatchConfirmText, shownBranchName, switchNeedsBusy } from '../ui/branchView';
import {
  DRAFT_TABS,
  TAB_LABEL_KEYS,
  applyTab,
  canCopyRobotTab,
  copyRobotTab,
  editDraft,
  setFieldText,
  canApply,
  canResetTab,
  configCanOpen,
  draftTabsLocked,
  initialDrafts,
  resetTabDraft,
  tabStatus,
} from '../ui/configDraft';
import type { ConfigDrafts, ConfigTab, DraftTab, DraftValues, TabStatus } from '../ui/configDraft';
import ConfigPanel from './ConfigPanel';
import ConfigRail from './ConfigRail';
import ConfirmDialog from './ConfirmDialog';
import type { ConfirmRequest } from './ConfirmDialog';
import EndOverlay from './EndOverlay';
import FieldEditBanner, { ScenarioEditBanner, SpawnPoseTag, SweetSpotHoverTip } from './FieldEditBanner';
import FieldNotices from './FieldNotices';
import HelpDialog from './HelpDialog';
import type { ToastItem } from './FieldNotices';
import LeftPanel from './LeftPanel';
import ResultPopup from './ResultPopup';
import ScrubberBar from './ScrubberBar';
import SettingsTab from './SettingsTab';
import RobotTab from './RobotTab';
import ScenarioTab from './ScenarioTab';
import ScenarioFieldPopover from './ScenarioFieldPopover';
import { readSweetSpot } from '../ui/robotForm';
import { SEED_FIELD_KEY, issueFieldSet, newSeed, readScenario, rerollSeed, scenarioFormIssues, scenarioFormWarnings, scenarioIssueText } from '../ui/scenarioForm';
import { spawnHitTest } from '../renderer/spawnEditLayout';
import type { SpawnPart, SpawnRobotId } from '../renderer/spawnEditLayout';
import type { RobotPose } from '../core/types';
import type { ScenarioConfig } from '../core/types';
import type { RobotProfile } from '../ui/robotForm';
import {
  cancelFieldEdit,
  clickSweetSpot,
  dragSpawnPose,
  editDoneAction,
  addFloorPiece,
  dragFloorPoint,
  editTab,
  finishFloorDrag,
  removeFloorPiece,
  finishRobotDrag,
  floorPieceHitTest,
  floorRefusalText,
  floorRemaining,
  isOffField,
  moveFloorPiece,
  robotPopoverIssues,
  sameTarget,
  scenarioTargetAnchor,
  scenarioTargetHitTest,
  openScenarioEdit,
  placeSpawn,
  recordScenarioChange,
  redoScenarioEdit,
  scenarioEditScene,
  scenarioSnapshot,
  spawnRobots,
  undoScenarioEdit,
  editPieces,
  effectivePiece,
  fieldEditStays,
  fieldEditUsable,
  fieldGridCell,
  heatmapEditScene,
  openSweetSpotEdit,
  sweetSpotCandidateIssues,
  sweetSpotEditScene,
  sweetSpotIssueCodes,
  toggleHeatmapEdit,
} from '../ui/fieldEdit';
import type { FieldEdit, ScenarioSceneUi, ScenarioSnapshot, ScenarioTarget } from '../ui/fieldEdit';
import { SCENE_WIDTH_PX, canvasToField, cssToCanvas, fieldToCanvas, fitScale } from '../renderer/viewTransform';
import type { ScrubberActions } from './ScrubberBar';
import './MainScreen.css';

const LAYOUT_STYLE = layoutCssVars(false) as CSSProperties;
const LAYOUT_STYLE_OPEN = layoutCssVars(true) as CSSProperties;
const setupOf = setupFromDrafts;
const TOAST_VISIBLE_MS = 1500; // 경고 토스트 표시 시간 (그 뒤 흐려지며 사라짐)
const TOAST_FADE_MS = 300;
const EDIT_TOAST_VISIBLE_MS = 2500; // 편집 안내 토스트 (놓지 않은 사유 — 읽을 시간을 조금 더, 14-1a)
// 브라우저 안 목록 종류별 구역 문구 / 설명 줄 (19-2a · 19-2b)
const LIBRARY_SECTION_KIND: Readonly<Record<LibraryKind, LibrarySectionKind>> = { SCENARIO: 'scenario', ROBOT: 'robot', SETUP: 'setup', MATCH: 'match' };
const LIBRARY_SUMMARY: Readonly<Record<LibraryKind, (lang: Language, item: LibraryItem, defaults: DraftValues) => LibrarySummary | null>> = {
  SCENARIO: scenarioItemSummary,
  ROBOT: robotItemSummary,
  SETUP: setupItemSummary,
  MATCH: matchItemSummary,
};
// 설정 자동 보관 (09-8b): 앱 시작 시 한 번 읽음 (SETTINGS + 마지막으로 적용한 로봇 / 시나리오)
const settingsStorage = browserSettingsStorage();
const sameResults = (a: MatchLUTResults | null, b: MatchLUTResults | null) => a?.robot1 === b?.robot1 && a?.robot2 === b?.robot2;

// 명중 확률표 Worker / 캐시 주입 (기본 = 브라우저 Worker 풀 + IndexedDB 캐시). 브라우저 화면 테스트는 바로 준비되는 캐시를 넣는다
export interface MainScreenServices {
  createLUTWorker: () => LUTWorkerLike;
  createLUTCache: () => LUTCache | null;
  createAutosave: () => AutosaveStore | null; // 경기 자동 저장 (19-1, null = 자동 저장 없음)
  createLibrary: () => LibraryStore | null;   // 브라우저 안 목록 (19-2, null = 목록 없음)
}
const BROWSER_SERVICES: MainScreenServices = {
  createLUTWorker: createBrowserLUTWorker,
  createLUTCache: createBrowserLUTCache,
  createAutosave: createBrowserAutosave,
  createLibrary: createBrowserLibrary,
};

export default function MainScreen({ services = BROWSER_SERVICES }: { services?: MainScreenServices }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AppController | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [stored] = useState(() => loadStoredConfig(settingsStorage, DEFAULT_DRAFT_VALUES));
  const [settings, setSettings] = useState<UiSettings>(stored.settings);
  const lang = settings.language;
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<{ request: ConfirmRequest; anchor: { x: number; y: number } | null; resolve: (ok: boolean) => void } | null>(null);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Set<number>());
  // config 창: 초안 / 적용 값 (적용 값이 경기 설정이 됨), 펼침 / 탭 / 안내
  const [drafts, setDrafts] = useState<ConfigDrafts>(() => initialDrafts(stored.applied ?? DEFAULT_DRAFT_VALUES));
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>('robot1');
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  // 브라우저 안 목록 (19-2a): 저장소(마운트 때 한 번) + 저장된 시나리오 (최근 저장 순)
  const libraryRef = useRef<LibraryStore | null>(null);
  const [matchSaveNotice, setMatchSaveNotice] = useState<{ endSeq: number; text: string } | null>(null); // 결과 팝업 안 경기 저장 안내 (19-2b-2)
  const [libraryItems, setLibraryItems] = useState<Readonly<Record<LibraryKind, LibraryItem[]>> | null>(null); // null = 목록 없음 (저장소 없음)
  // 프리셋 불러오기 거부 사유 (그 줄 아래 빨간 글자, 10-2)
  const [presetError, setPresetError] = useState<{ row: PresetRow; error: PresetError } | null>(null);
  // 도움말 창 (v1.0.0): 열면 진행 중인 경기 / 재생을 멈추고 단축키를 끔
  const [helpOpen, setHelpOpen] = useState(false);
  // 경기 불러오기 (10-4): 명중 확률표 준비 대기(LUT) → 가지 단위 재계산(done / total, 15-3), 거부 사유, 체크섬 불일치 배너
  const [matchImport, setMatchImport] = useState<'LUT' | { done: number; total: number } | null>(null);
  const [matchImportError, setMatchImportError] = useState<MatchImportError | null>(null);
  // 체크섬 불일치 배너: 처음 어긋난 가지(가지가 2개 이상인 트리일 때) + 그 밖에 어긋난 가지 수 (15-3)
  const [matchNotice, setMatchNotice] = useState<{
    comparison: MatchComparison;
    warnings: RecipeWarning[];
    branch: { name: string | null; number: number; parentId: number | null; others: number } | null;
  } | null>(null);
  // 가지 전환 계산 중 (16-2): 다른 가지 프레임은 해제되어 있어 전환할 때 다시 계산한다 (길면 표시를 먼저 그림)
  const [branchBusy, setBranchBusy] = useState(false);
  const branchBusyRef = useRef(false);
  const importJobRef = useRef<MatchLoadJob | null>(null); // 진행 중인 재계산 작업 (CANCEL = 버림)
  const pendingMatchRef = useRef<{ recipe: MatchRecipe; warnings: RecipeWarning[] } | null>(null);
  const completeImportRef = useRef<(results: MatchLUTResults) => void>(() => {});
  // 경기 자동 저장 / 복구 (19-1): 저장소 · 언제 저장할지 · 저장 / 복구 제안 (렌더마다 최신 상태로 다시 묶음)
  const autosaveRef = useRef<AutosaveStore | null>(null);
  const autosaveSchedulerRef = useRef<AutosaveScheduler | null>(null);
  const saveAutosaveRef = useRef<() => void>(() => {});
  // 떠난 가지의 잘라 낸 입력 / 부호화 글자 재사용 (22-1c) — 아래 효과는 렌더마다 다시 묶이므로 캐시는 화면 수명 동안 하나
  const [autosaveInputCache] = useState(() => new RecipeInputCache());
  const offerRestoreRef = useRef<(text: string) => void>(() => {});
  const initialApplied = useRef(drafts.applied);
  const initialSettings = useRef(settings);
  // 명중 확률표 (09-10a): 추적기 / 경기 설정에 쓴 적용 값 · LUT 결과 / 화면 요약
  const trackerRef = useRef<LUTTracker | null>(null);
  const appliedRef = useRef(drafts.applied);
  const lutResultsRef = useRef<MatchLUTResults | null>(null);
  const [lutViews, setLutViews] = useState<Record<RobotId, RobotLutView> | null>(null);
  // 필드 편집 모드 (09-10b)
  const [fieldEdit, setFieldEdit] = useState<FieldEdit | null>(null);
  // 스윗스팟 모드: 마우스를 올린 격자 중심(필드 좌표) + 안내 말풍선 위치(필드 영역 CSS px) — 칸이 바뀔 때만 갱신
  const [spotHover, setSpotHover] = useState<{ cell: { x: number; y: number }; left: number; top: number } | null>(null);
  // 클릭은 마지막 포인터 이동의 칸을 쓴다 (상태는 다음 렌더에야 바뀌므로 이동 직후 클릭에도 맞도록 즉시 갱신되는 ref)
  const spotHoverRef = useRef<typeof spotHover>(null);
  // 시나리오 필드 편집 모드: 끄는 중(포인터 캡처, 끌기 전 시나리오 탭 스냅샷 / 마지막 자세) / 마우스를 올린 로봇 부분 (강조 · 커서)
  // popoverWasOpen: 누를 때 그 로봇 팝오버가 열려 있었음 (끌지 않고 클릭 = 팝오버 열기 / 닫기 토글, 14-1d)
  const spawnDragRef = useRef<{ robot: SpawnRobotId; part: SpawnPart; pointerStart: { x: number; y: number }; poseStart: RobotPose; before: ScenarioSnapshot; lastPose: RobotPose | null; popoverWasOpen: boolean } | null>(null);
  const [spawnActive, setSpawnActive] = useState<{ robot: SpawnRobotId; part: SpawnPart } | null>(null);
  // 바닥 기물 (14-1b): 끄는 중(누른 점 / 끌기 전 자리 · 스냅샷 / 마지막 자리 · 포인터), 강조, 추가 상태(켜진 기물) / 추가 미리보기
  // popoverWasOpen: 누를 때 그 기물 팝오버가 열려 있었음 (끌지 않고 클릭 = 열기 / 닫기, 14-1b 보완)
  const floorDragRef = useRef<{ index: number; pointerStart: { x: number; y: number }; start: { x: number; y: number }; before: ScenarioSnapshot; lastPoint: { x: number; y: number } | null; lastPointer: { x: number; y: number } | null; popoverWasOpen: boolean } | null>(null);
  const [floorActive, setFloorActive] = useState<ScenarioSceneUi['floorActive']>(null);
  const [addTool, setAddTool] = useState<'POLLEN' | 'NECTAR' | null>(null);
  const [addPreview, setAddPreview] = useState<ScenarioSceneUi['addPreview']>(null);
  // HIVE / FLOWER / GARDEN 팝오버 (14-1c): 열린 대상 / 마우스를 올린 대상 (강조 · 커서)
  const [popover, setPopover] = useState<ScenarioTarget | null>(null);
  const [targetHover, setTargetHover] = useState<ScenarioTarget | null>(null);
  const [spawnDragging, setSpawnDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null); // 캔버스와 같은 크기 / 위치의 글자 층 (시작 자세 글자를 장면 비율로 배치)
  const servicesRef = useRef(services); // 마운트 때 한 번만 씀 (컨트롤러 / 추적기와 같은 수명)

  useEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!area || !canvas || !ctx) return;

    // 필드 영역에 맞는 정사각형: CSS 크기 = 영역의 짧은 변, 버퍼 = CSS px × devicePixelRatio, 배율 = 버퍼 / 800.
    // 버퍼를 바꾸면 캔버스가 지워지므로 다시 그림. 배율은 버퍼가 그대로여도 매번 넘긴다
    // (개발 모드 StrictMode 재마운트처럼 이미 맞춰진 캔버스에 새 컨트롤러가 붙는 경우)
    const measure = () => {
      const size = fieldCanvasSize(area.clientWidth, area.clientHeight, window.devicePixelRatio || 1);
      canvas.style.width = canvas.style.height = `${size.cssPx}px`;
      if (overlayRef.current) overlayRef.current.style.width = overlayRef.current.style.height = `${size.cssPx}px`;
      const resized = canvas.width !== size.bufferPx || canvas.height !== size.bufferPx;
      if (resized) canvas.width = canvas.height = size.bufferPx;
      return { scale: size.scale, resized };
    };

    // 경고 토스트: 약 1.5초 보인 뒤 흐려지며 사라짐 (같은 로봇 2초 간격은 컨트롤러가 보장)
    const timers = toastTimers.current;
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const onToast = ({ robot }: LiftToast) => {
      const id = ++toastSeq.current;
      setToasts(list => [...list.filter(x => x.robot !== robot), { id, robot, leaving: false }]);
      later(TOAST_VISIBLE_MS, () => setToasts(list => list.map(x => (x.id === id ? { ...x, leaving: true } : x))));
      later(TOAST_VISIBLE_MS + TOAST_FADE_MS, () => setToasts(list => list.filter(x => x.id !== id)));
    };

    // 경기 자동 저장 (19-1): 상태 알림의 저장 표식이 바뀌면 저장 예약, 탭을 떠나면 예약을 바로 저장
    const autosave = servicesRef.current.createAutosave();
    autosaveRef.current = autosave;
    const scheduler = autosave
      ? new AutosaveScheduler({ save: () => saveAutosaveRef.current(), now: () => performance.now(), setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: id => window.clearTimeout(id) })
      : null;
    autosaveSchedulerRef.current = scheduler;
    const flushAutosave = () => scheduler?.flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flushAutosave();

    // 상태 알림: 펼칠 수 없는 상태(진행 / 재생 / 회전 / 종료 강조 · 결과)가 되면 config 창을 자동으로 접음
    const onStatus = (s: AppStatus) => {
      setStatus(s);
      scheduler?.update(autosaveSignature(s), s.loopState === 'RUNNING');
      if (!configCanOpen(s)) setConfigOpen(false);
      if (s.phase !== 'SETUP') setFieldEdit(null);
      else setMatchNotice(null); // 불러온 경기의 불일치 배너는 NEW(경기 전 화면)에서 사라짐
    };
    const s0 = initialSettings.current;
    const controller = new AppController({
      ctx,
      dpr: measure().scale,
      setup: setupOf(initialApplied.current),
      onStatus,
      onToast,
      input: { assignment: s0.devices, mappings: s0.gamepadMappings, driveModes: s0.driveModes },
      defaultView: s0.defaultView,
      options: s0.renderOptions,
      smoothMotion: s0.smoothMotion,
    });
    controllerRef.current = controller;
    setStatus(controller.status());

    // 명중 확률표: 적용 값으로 생성 요청 (캐시 적중이면 곧 READY). 두 로봇 결과가 바뀌면 경기 설정을 LUT 판정으로 교체
    lutResultsRef.current = null;
    const tracker = new LUTTracker({
      createWorker: servicesRef.current.createLUTWorker,
      cache: servicesRef.current.createLUTCache(),
      onUpdate: () => {
        setLutViews({ robot1: tracker.view('robot1'), robot2: tracker.view('robot2') });
        const results = tracker.results();
        if (sameResults(results, lutResultsRef.current)) return;
        lutResultsRef.current = results;
        controller.setSetup(setupOf(appliedRef.current, results));
        if (results && pendingMatchRef.current) completeImportRef.current(results); // 경기 불러오기: 명중 확률표 준비 → 재계산
      },
    });
    trackerRef.current = tracker;
    tracker.request(initialApplied.current);

    const fit = () => {
      const { scale, resized } = measure();
      controller.setRenderScale(scale);
      if (resized) controller.redraw();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    window.addEventListener('resize', fit); // 브라우저 확대 / 모니터 이동으로 devicePixelRatio만 바뀐 경우
    // 웹폰트(Pretendard)가 늦게 도착하면 캔버스 글자(로봇 번호 / HIVE 알약)를 다시 그림
    let alive = true;
    void document.fonts?.ready.then(() => alive && controller.redraw());
    // 저장된 시나리오 / 로봇 / 전체 설정 / 경기 목록 (19-2a · 19-2b, 경기는 요약만 — 본문은 불러올 때)
    const library = servicesRef.current.createLibrary();
    libraryRef.current = library;
    if (library)
      void Promise.all(LIBRARY_KINDS.map(kind => library.list(kind))).then(
        lists => alive && setLibraryItems(Object.fromEntries(LIBRARY_KINDS.map((kind, i) => [kind, sortLibrary(lists[i])])) as Record<LibraryKind, LibraryItem[]>),
      );
    // 자동 저장된 지난 경기가 있으면 복구 제안 (19-1, 확인창). 탭 숨김(자동 일시정지 뒤) / 페이지 닫힘에 예약 저장을 바로
    void autosave?.load().then(text => alive && text && offerRestoreRef.current(text));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushAutosave);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushAutosave);
      scheduler?.dispose();
      autosaveSchedulerRef.current = null;
      autosaveRef.current = null;
      libraryRef.current = null;
      observer.disconnect();
      window.removeEventListener('resize', fit);
      timers.forEach(id => window.clearTimeout(id));
      timers.clear();
      tracker.dispose();
      trackerRef.current = null;
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const c = () => controllerRef.current;

  // ---------------- config 창 ----------------
  const statuses = Object.fromEntries(DRAFT_TABS.map(tab => [tab, tabStatus(drafts, tab)])) as Record<DraftTab, TabStatus>;
  const luts = lutViews ?? { robot1: PENDING_LUT_VIEW, robot2: PENDING_LUT_VIEW };
  const canOpen = status ? configCanOpen(status) : false;
  const locked = status ? draftTabsLocked(status.phase) : false;
  // 편집 모드는 연 로봇 탭이 보이는 경기 전 동안만: 탭 이동 / 창 닫기 / START에서 끝내고, 그 밖의 경우도 조건이 깨지면 보이지 않음
  // 13-4: 슈터 구성을 바꿔 그 모드를 쓸 수 없게 되면(쏠 기물 없음 / 쓰지 않는 슈터 자리) 보이지 않음
  const activeEdit =
    fieldEdit && status && fieldEditStays(fieldEdit, { phase: status.phase, configOpen, tab: configTab }) && fieldEditUsable(fieldEdit, drafts) ? fieldEdit : null;
  // 편집 모드의 기물 버튼에서 고를 수 있는 기물 (히트맵 = 적용한 설정, 스윗스팟 = 초안의 그 슈터) + 지금 보여 줄 기물
  const editPieceList = activeEdit && activeEdit.mode !== 'SCENARIO' ? editPieces(activeEdit, activeEdit.mode === 'HEATMAP' ? drafts.applied[activeEdit.robot] : drafts.draft[activeEdit.robot]) : [];
  const editPiece = activeEdit && activeEdit.mode !== 'SCENARIO' ? effectivePiece(activeEdit.piece, editPieceList) : null;
  const scenarioEdit = activeEdit?.mode === 'SCENARIO' ? activeEdit : null;
  const editAlliance = drafts.draft.scenario.allianceColor;
  const openConfig = (tab?: ConfigTab) => {
    if (!canOpen) return;
    if (tab) setConfigTab(tab);
    setConfigNotice(null);
    setConfigOpen(true);
  };
  const closeConfig = () => {
    setConfigOpen(false);
    setFieldEdit(null);
    setConfigNotice(null);
  };
  // APPLY: 경기 전에만 (경기가 있는 동안 잠금). 적용 값이 바뀌면 새 0틱 경기 설정 + LUT 요청 (입력이 같으면 그대로 READY)
  const applyCurrentTab = () => {
    if (configTab === 'settings' || locked) return;
    const next = applyTab(drafts, configTab);
    if (next === drafts) return;
    cancelMatchImport(); // 불러오던 경기의 설정이 바뀌므로 불러오기 취소
    setDrafts(next);
    appliedRef.current = next.applied;
    const tracker = trackerRef.current;
    tracker?.request(next.applied);
    lutResultsRef.current = tracker?.results() ?? null;
    c()?.setSetup(setupOf(next.applied, lutResultsRef.current));
    saveStoredConfig(settingsStorage, { settings, applied: next.applied });
  };
  const resetCurrentTab = () => {
    if (configTab === 'settings' || locked) return;
    if (configTab === 'scenario') commitScenario(resetTabDraft(drafts, configTab, DEFAULT_DRAFT_VALUES));
    else setDrafts(resetTabDraft(drafts, configTab, DEFAULT_DRAFT_VALUES));
  };
  // ---------------- 로봇 탭 (09-9a): 초안 편집 / 틀린 입력 글자 / COPY TO ----------------
  const editRobot = (tab: 'robot1' | 'robot2') => (profile: RobotProfile | null, key: string | null, invalidText: string | null, clearKeys: readonly string[] = []) => {
    if (locked) return;
    setConfigNotice(null); // 고치기 시작하면 START 막힘 / 복사 안내는 지움
    setDrafts(d => {
      let next = profile ? editDraft(d, tab, profile) : d;
      for (const k of clearKeys) next = setFieldText(next, tab, k, null);
      if (key) next = setFieldText(next, tab, key, invalidText);
      return next;
    });
  };
  const copyRobot = (from: 'robot1' | 'robot2') => {
    const to = from === 'robot1' ? 'robot2' : 'robot1';
    if (locked || !canCopyRobotTab(drafts, from)) return;
    const doCopy = () => {
      setDrafts(d => copyRobotTab(d, from));
      setConfigNotice(t(lang, 'robot.copied', { robot: robotLabel(to) }));
    };
    // 상대 탭에 적용 안 된 수정 / 틀린 글자가 있으면 덮어쓰기 전에 확인
    if (tabStatus(drafts, to) === 'OK') doCopy();
    else
      void ask(t(lang, 'confirm.copyOverwrite', { target: robotLabel(to), source: robotLabel(from) }), t(lang, 'robot.copyTo', { robot: robotLabel(to) })).then(ok => {
        if (ok) doCopy();
      });
  };

  // ---------------- 시나리오 탭 (09-11a): 초안 편집 / 틀린 입력 글자 / 시드 REROLL ----------------
  const editScenario = (scenario: ScenarioConfig | null, key: string | null, invalidText: string | null, clearKeys: readonly string[] = []) => {
    if (locked) return;
    setConfigNotice(null);
    let next = scenario ? editDraft(drafts, 'scenario', scenario) : drafts;
    for (const k of clearKeys) next = setFieldText(next, 'scenario', k, null);
    if (key) next = setFieldText(next, 'scenario', key, invalidText);
    commitScenario(next, key);
  };
  // 시나리오 초안 변경 확정: 시나리오 필드 편집 모드가 열려 있으면 되돌리기 기록에 남김 (key = 숫자 칸 — 같은 칸 연속 입력은 한 단계, 14-1a).
  // 시드 칸은 되돌리기 대상이 아니라 기록하지 않음 (18-1)
  const commitScenario = (next: ConfigDrafts, key: string | null = null) => {
    const before = scenarioSnapshot(drafts);
    setDrafts(next);
    if (scenarioEdit && key !== SEED_FIELD_KEY) setFieldEdit(edit => (edit?.mode === 'SCENARIO' ? recordScenarioChange(edit, before, scenarioSnapshot(next), key) : edit));
  };
  // 되돌리기 / 다시 하기 (모드 중, 끄는 중에는 무시)
  const stepScenarioHistory = (direction: 'undo' | 'redo') => {
    if (!scenarioEdit || spawnDragRef.current || floorDragRef.current) return;
    const result = (direction === 'undo' ? undoScenarioEdit : redoScenarioEdit)(scenarioEdit, drafts);
    if (!result) return;
    setConfigNotice(null);
    setDrafts(result.drafts);
    setFieldEdit(result.edit);
  };
  // 편집 안내 토스트 (놓지 않은 사유 등): 이전 편집 토스트를 바꾸고 약 2.5초 뒤 흐려지며 사라짐. info = 알림 모양 (경기 저장 결과, 19-2b-2)
  const showEditToast = (text: string, info = false) => {
    const id = ++toastSeq.current;
    const timers = toastTimers.current;
    const later = (ms: number, fn: () => void) => {
      const handle = window.setTimeout(() => {
        timers.delete(handle);
        fn();
      }, ms);
      timers.add(handle);
    };
    setToasts(list => [...list.filter(x => x.text === undefined), { id, text, info, leaving: false }]);
    later(EDIT_TOAST_VISIBLE_MS, () => setToasts(list => list.map(x => (x.id === id ? { ...x, leaving: true } : x))));
    later(EDIT_TOAST_VISIBLE_MS + TOAST_FADE_MS, () => setToasts(list => list.filter(x => x.id !== id)));
  };
  // REROLL (09-11 확정): APPLY 없이 적용 값 / 초안의 시드만 바꿔 경기 전 설정을 바로 교체하고 저장 (NEW는 시드 유지)
  const rerollScenarioSeed = () => {
    if (locked) return;
    cancelMatchImport();
    const current = readScenario(drafts.applied.scenario, drafts.applied.robot1.config, drafts.applied.robot2.config).seed;
    const next = rerollSeed(drafts, newSeed(current));
    setDrafts(next);
    appliedRef.current = next.applied;
    c()?.setSetup(setupOf(next.applied, lutResultsRef.current));
    saveStoredConfig(settingsStorage, { settings, applied: next.applied });
  };

  // ---------------- SETTINGS (즉시 적용 + 자동 보관) ----------------
  const pushSettings = (next: UiSettings, prev: UiSettings | null) => {
    const controller = c();
    if (!controller) return;
    if (!prev || next.renderOptions !== prev.renderOptions) controller.setOptions(next.renderOptions);
    if (!prev || next.defaultView !== prev.defaultView) controller.setDefaultView(next.defaultView);
    if (!prev || next.smoothMotion !== prev.smoothMotion) controller.setSmoothMotion(next.smoothMotion);
    if (!prev || next.devices !== prev.devices) controller.setAssignment(next.devices);
    if (!prev || next.gamepadMappings !== prev.gamepadMappings) controller.setGamepadMappings(next.gamepadMappings);
    if (!prev || next.driveModes !== prev.driveModes) {
      controller.setDriveMode('robot1', next.driveModes.robot1);
      controller.setDriveMode('robot2', next.driveModes.robot2);
    }
  };
  const updateSettings = (patch: Partial<UiSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    pushSettings(next, settings);
    saveStoredConfig(settingsStorage, { settings: next, applied: drafts.applied });
  };
  // RESET ALL (경기 전만, 확인창): SETTINGS 즉시 기본값, R1 / R2 / SCENARIO는 초안만 기본값 (각 탭 APPLY 필요)
  const resetAll = () => {
    if (status?.phase !== 'SETUP') return;
    void ask(t(lang, 'confirm.resetAll'), t(lang, 'config.resetAll')).then(ok => {
      if (!ok) return;
      cancelMatchImport();
      const next = { ...DEFAULT_SETTINGS, renderOptions: { ...DEFAULT_SETTINGS.renderOptions }, driveModes: { ...DEFAULT_SETTINGS.driveModes } };
      setSettings(next);
      pushSettings(next, null);
      let d = drafts;
      for (const tab of DRAFT_TABS) d = resetTabDraft(d, tab, DEFAULT_DRAFT_VALUES);
      setDrafts(d);
      saveStoredConfig(settingsStorage, { settings: next, applied: d.applied });
    });
  };
  // ---------------- 저장된 시나리오 / 로봇 / 전체 설정 / 경기 (19-2a · 19-2b): 파일 대신 브라우저 안 이름 붙인 칸 ----------------
  // 저장 = 그 줄의 프리셋 EXPORT(적용 값), 불러오기 = 그 줄의 프리셋 IMPORT(초안). 로봇 항목은 R1 / R2 공용이라 줄 = 지금 로봇 탭.
  // 경기 = EXPORT MATCH와 같은 글자를 본문으로(자동 이름), 불러오기 = IMPORT MATCH와 같은 흐름 (row = null).
  const refreshLibrary = (kind: LibraryKind) =>
    void libraryRef.current?.list(kind).then(items => setLibraryItems(current => current && { ...current, [kind]: sortLibrary(items) }));
  const putLibraryItem = (item: LibraryItem, notice: string) =>
    void libraryRef.current?.put(item).then(ok => {
      setConfigNotice(ok ? notice : t(lang, 'library.failed'));
      refreshLibrary(item.kind);
    });
  const saveToLibrary = (row: PresetRow | null, name: string) => {
    if (row === null) return;
    const kind = ROW_KIND[row];
    if (ROW_TABS[row].some(tab => tabStatus(drafts, tab) !== 'OK')) return;
    const text = buildPresetFile(row, drafts.applied);
    const decision = saveDecision(libraryItems?.[kind] ?? [], name, libraryMaxItems(kind));
    if (decision.kind === 'FULL') {
      setConfigNotice(t(lang, 'library.full', { max: libraryMaxItems(kind) }));
      return;
    }
    if (decision.kind === 'NEW') {
      putLibraryItem({ id: newLibraryId(), kind, name, savedAt: new Date().getTime(), text }, t(lang, 'library.saved', { name }));
      return;
    }
    const { item } = decision;
    void ask(t(lang, 'confirm.libraryOverwrite', { name: item.name }), t(lang, 'library.saveAs')).then(ok => {
      if (ok) putLibraryItem({ ...item, name, savedAt: new Date().getTime(), text }, t(lang, 'library.saved', { name }));
    });
  };
  const loadFromLibrary = (row: PresetRow | null, item: LibraryItem) => {
    if (locked) return;
    if (row === null) {
      loadMatchFromLibrary(item);
      return;
    }
    const parsed = parsePresetFile(item.text, row, DEFAULT_DRAFT_VALUES);
    if (!parsed.ok) {
      setConfigNotice(t(lang, 'library.broken'));
      return;
    }
    cancelMatchImport();
    // 시나리오 필드 편집 모드가 열려 있으면 되돌리기 기록에 남김 (commitScenario, 모드가 없으면 setDrafts와 같음)
    const doLoad = () => {
      commitScenario(importPresetToDrafts(drafts, parsed.preset));
      setConfigNotice(t(lang, 'library.loaded', { name: item.name, tabs: tabNames(lang, ROW_TABS[row]) }));
    };
    const overwrite = importOverwriteTabs(drafts, row);
    if (overwrite.length === 0) doLoad();
    else
      void ask(t(lang, 'confirm.importOverwrite', { tabs: tabNames(lang, overwrite) }), t(lang, 'library.load')).then(ok => {
        if (ok) doLoad();
      });
  };
  // 경기 저장 (결과 팝업 / 가지 목록): 트리 전체 = EXPORT MATCH와 같은 글자, 자동 이름. 알릴 글자를 돌려줌 (null = 저장할 경기 없음)
  const saveMatchToLibrary = async (): Promise<string | null> => {
    const library = libraryRef.current;
    const src = c()?.recipeSource();
    const meta = status && matchItemMeta(status);
    if (!library || !libraryItems || !src || !meta) return null;
    const items = libraryItems.MATCH;
    const now = new Date();
    const name = matchItemName(lang, meta, now, items);
    if (saveDecision(items, name, libraryMaxItems('MATCH')).kind === 'FULL') return t(lang, 'library.full', { max: libraryMaxItems('MATCH') });
    const body = serializeMatchRecipe(buildMatchRecipe({ setup: drafts.applied, ...src, createdAt: now }));
    const ok = await library.put({ id: newLibraryId(), kind: 'MATCH', name, savedAt: now.getTime(), text: JSON.stringify(meta) }, body);
    refreshLibrary('MATCH');
    return ok ? t(lang, 'library.matchSaved', { name }) : t(lang, 'library.failed');
  };
  const saveMatchFromResult = () => {
    const endSeq = status?.endSeq ?? 0;
    void saveMatchToLibrary().then(text => text && setMatchSaveNotice({ endSeq, text }));
  };
  const saveMatchFromMenu = () => void saveMatchToLibrary().then(text => text && showEditToast(text, true));
  // 경기 불러오기: 본문 → 경기 파일과 같은 해석 / 확인창 / 확률표 준비 / 재계산
  const loadMatchFromLibrary = (item: LibraryItem) => {
    if (matchImport) return;
    setMatchImportError(null);
    void libraryRef.current?.body(item.id).then(text => {
      const parsed = text === null ? null : parseMatchRecipe(text, DEFAULT_DRAFT_VALUES);
      if (!parsed?.ok) {
        setConfigNotice(parsed ? `${t(lang, 'library.broken')} · ${matchImportErrorMessage(lang, parsed.error)}` : t(lang, 'library.broken'));
        return;
      }
      void ask(matchImportConfirmMessage(lang, parsed.warnings, parsed.recipe.branches.length), t(lang, 'library.load')).then(ok => {
        if (ok) beginMatchImport(parsed.recipe, parsed.warnings);
      });
    });
  };
  const renameLibraryItem = (item: LibraryItem, name: string) => {
    if (findByName(libraryItems?.[item.kind] ?? [], name, item.id)) {
      setConfigNotice(t(lang, 'library.nameTaken', { name }));
      return;
    }
    putLibraryItem({ ...item, name }, t(lang, 'library.saved', { name }));
  };
  const deleteLibraryItem = (item: LibraryItem) =>
    void ask(t(lang, 'confirm.libraryDelete', { name: item.name }), t(lang, 'library.delete')).then(ok => {
      if (ok) void libraryRef.current?.delete(item.id).then(() => refreshLibrary(item.kind));
    });
  /** 목록 구역 (저장소가 없으면 그리지 않음, row = null이면 경기 목록) */
  const librarySection = (row: PresetRow | null) => {
    const kind = row === null ? 'MATCH' : ROW_KIND[row];
    const items = libraryItems?.[kind];
    if (!items) return null;
    const summarize = LIBRARY_SUMMARY[kind];
    return (
      <LibrarySection
        kind={LIBRARY_SECTION_KIND[kind]}
        row={row}
        items={items}
        lang={lang}
        summary={item => summarize(lang, item, DEFAULT_DRAFT_VALUES)}
        canSave={row !== null && ROW_TABS[row].every(tab => statuses[tab] === 'OK')}
        canLoad={!locked && (row !== null || !matchImport)}
        onSave={row === null ? undefined : saveToLibrary}
        onLoad={loadFromLibrary}
        onRename={renameLibraryItem}
        onDelete={deleteLibraryItem}
      />
    );
  };

  // ---------------- 프리셋 파일 (10-2): EXPORT = 적용 값 → 파일(언제나), IMPORT = 파일 → 초안(경기 전만, APPLY는 각 탭) ----------------
  const exportPreset = (row: PresetRow) => {
    setPresetError(null);
    downloadTextFile(presetFileName(row, drafts.applied, new Date()), buildPresetFile(row, drafts.applied));
  };
  const importPreset = (row: PresetRow) => {
    if (locked) return;
    cancelMatchImport();
    setPresetError(null);
    void pickTextFile().then(picked => {
      if (!picked) return;
      const parsed = picked.ok ? parsePresetFile(picked.text, row, DEFAULT_DRAFT_VALUES) : { ok: false as const, error: { code: picked.code } };
      if (!parsed.ok) {
        setPresetError({ row, error: parsed.error });
        return;
      }
      const doImport = () => {
        setDrafts(d => importPresetToDrafts(d, parsed.preset));
        setConfigNotice(presetLoadedNotice(lang, row));
      };
      // 바꿀 탭에 적용 안 된 수정 / 틀린 입력이 있으면 덮어쓰기 전에 확인 (COPY TO와 같은 규칙)
      const overwrite = importOverwriteTabs(drafts, row);
      if (overwrite.length === 0) doImport();
      else
        void ask(t(lang, 'confirm.importOverwrite', { tabs: tabNames(lang, overwrite) }), t(lang, 'preset.import')).then(ok => {
          if (ok) doImport();
        });
    });
  };
  // ---------------- 경기 파일 (10-4) ----------------
  // 불러오기: 파일 → 해석 / 검증(거부 사유) → 확인창(버전 경고) → R1 / R2 / SCENARIO 적용 값 · 초안 교체(자동 보관) + 명중 확률표 준비
  //   → 준비되면 재계산해 복기 상태로 열고, 체크포인트가 다르면 배너. 준비 중 CANCEL / APPLY / REROLL / RESET ALL / 프리셋 불러오기는 취소
  const cancelMatchImport = () => {
    pendingMatchRef.current = null;
    importJobRef.current = null; // 재계산 작업은 commit하지 않고 버림 (경기 전 화면 그대로, 15-3)
    setMatchImport(null);
  };
  const importMatch = () => {
    if (locked || matchImport) return;
    setMatchImportError(null);
    void pickTextFile().then(picked => {
      if (!picked) return;
      const parsed = picked.ok ? parseMatchRecipe(picked.text, DEFAULT_DRAFT_VALUES) : { ok: false as const, error: { code: picked.code } };
      if (!parsed.ok) {
        setMatchImportError(parsed.error);
        return;
      }
      void ask(matchImportConfirmMessage(lang, parsed.warnings, parsed.recipe.branches.length), t(lang, 'preset.import')).then(ok => {
        if (ok) beginMatchImport(parsed.recipe, parsed.warnings);
      });
    });
  };
  const beginMatchImport = (recipe: MatchRecipe, warnings: RecipeWarning[]) => {
    const values = recipe.setup;
    setFieldEdit(null);
    setConfigNotice(null);
    setPresetError(null);
    setDrafts(initialDrafts(values));
    appliedRef.current = values;
    saveStoredConfig(settingsStorage, { settings, applied: values });
    pendingMatchRef.current = { recipe, warnings };
    setMatchImport('LUT');
    const tracker = trackerRef.current;
    tracker?.request(values);
    const results = tracker?.results() ?? null;
    lutResultsRef.current = results;
    c()?.setSetup(setupOf(values, results));
    if (results) completeImportRef.current(results); // 같은 명중 확률표가 이미 준비됨
  };
  // 재계산 (15-2 / 15-3): 트리를 가지 하나씩 계산하고(가지 하나 최대 약 1.5초) 그 사이에 "재계산 n / m"을 그린다.
  // 모두 계산하면 commit해 파일의 지금 가지로 열고, CANCEL(작업을 버림)이면 경기 전 화면 그대로
  useEffect(() => {
    completeImportRef.current = results => {
      const pending = pendingMatchRef.current;
      if (!pending) return;
      pendingMatchRef.current = null;
      const { recipe } = pending;
      const job = controllerRef.current?.beginLoadMatch(setupOf(appliedRef.current, results), recipeLoadTree(recipe)) ?? null;
      if (!job) {
        setMatchImport(null);
        return;
      }
      importJobRef.current = job;
      setMatchImport({ done: 0, total: job.total });
      const next = () =>
        window.setTimeout(() => {
          if (importJobRef.current !== job) return; // 취소됨
          if (!job.step()) {
            setMatchImport({ done: job.done, total: job.total });
            next();
            return;
          }
          importJobRef.current = null;
          setMatchImport(null);
          const loaded = job.commit();
          if (!loaded) return;
          // 체크포인트 + 판정 결과(12-16): 가지마다 비교, 배너 = 처음 어긋난 가지(만든 순서) + 그 밖에 어긋난 가지 수
          const mismatches = loaded
            .map(b => {
              const branch = recipe.branches.find(r => r.number === b.number)!;
              return { branch, comparison: compareLoadedBranch(branch, b) };
            })
            .filter(m => !m.comparison.match);
          const first = mismatches[0];
          setMatchNotice(
            first
              ? {
                  comparison: first.comparison,
                  warnings: pending.warnings,
                  branch: recipe.branches.length >= 2 ? { name: first.branch.name, number: first.branch.number, parentId: first.branch.parent, others: mismatches.length - 1 } : null,
                }
              : null,
          );
        }, 30);
      next();
    };
  });
  const matchImportText = (() => {
    if (!matchImport) return null;
    if (matchImport !== 'LUT') return { text: matchComputingText(lang, matchImport.done, matchImport.total), error: false };
    const progress = matchImportProgress(luts);
    return progress.error ? { text: t(lang, 'matchImport.lutError'), error: true } : { text: t(lang, 'matchImport.loading', { percent: progress.percent }), error: false };
  })();
  // 내보내기 (결과 팝업 / 가지 목록, 15-3): 경기 레시피(.json, 분기 트리 전체) / 요약(.txt, 지금 가지). 적용 값 = 이 경기의 설정 (경기 중에는 잠금)
  const exportMatch = () => {
    const src = c()?.recipeSource();
    const current = status && currentBranchInfo(status);
    if (!src || !status || !current) return;
    const now = new Date();
    const recipe = buildMatchRecipe({ setup: drafts.applied, ...src, createdAt: now });
    const state = current.totalScore !== null ? { total: current.totalScore } : { headTick: current.headTick };
    downloadTextFile(matchFileName(now, status.alliance, state, fileBranchNumber(status), status.branches.length), serializeMatchRecipe(recipe));
  };
  const exportSummary = () => {
    const result = status?.result;
    if (!result || !status) return;
    const now = new Date();
    const text = matchSummaryText({
      lang,
      result,
      alliance: status.alliance,
      teams: { robot1: drafts.applied.robot1, robot2: drafts.applied.robot2 },
      branchName: shownBranchName(lang, status),
      date: now,
      seed: drafts.applied.scenario.rngSeed ?? DEFAULT_RNG_SEED,
    });
    downloadTextFile(summaryFileName(now, status.alliance, result.total, fileBranchNumber(status)), text, 'text/plain');
  };

  // 화면 언어 (문서 lang 속성도 맞춤)
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // ---------------- 필드 편집 모드 (09-10b) ----------------
  // 편집 장면: 적용한 설정의 명중 확률표 (생성 중이면 약 10 Hz 진행 알림마다 조립 중 버퍼를 다시 읽음)
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!activeEdit) {
      controller.setEditScene(null);
      return;
    }
    if (activeEdit.mode === 'SCENARIO') {
      controller.setEditScene(scenarioEditScene(drafts.draft, spawnActive, { floorActive, addPreview, target: popover ?? targetHover }));
      return;
    }
    const robot = activeEdit.robot;
    const piece = editPiece ?? activeEdit.piece;
    const heatmap = trackerRef.current?.heatmap(robot, piece) ?? null;
    controller.setEditScene(
      activeEdit.mode === 'HEATMAP'
        ? heatmapEditScene(editAlliance, drafts.applied[robot], heatmap, piece)
        : sweetSpotEditScene(editAlliance, drafts.draft[robot], drafts.applied[robot], heatmap, spotHover?.cell ?? null, activeEdit.slot),
    );
  }, [activeEdit, editPiece, editAlliance, drafts.applied, drafts.draft, lutViews, spotHover, spawnActive, floorActive, addPreview, popover, targetHover]);
  // 편집 중 Esc = 편집 모드 닫기 / 스윗스팟 모드는 취소 (config 창은 그대로, 확인창이 떠 있으면 확인창이 먼저)
  useEffect(() => {
    if (!activeEdit || confirm) return;
    const edit = activeEdit;
    const adding = addTool !== null;
    const popoverOpen = popover !== null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      // 팝오버가 열려 있으면 팝오버만 닫기 (14-1c), 바닥 기물 추가 상태면 추가 상태만 끝 (모드는 그대로, 14-1b)
      if (popoverOpen) {
        setPopover(null);
        return;
      }
      if (adding) {
        setAddTool(null);
        setAddPreview(null);
        return;
      }
      // CANCEL과 같음: 스윗스팟 / 시나리오 필드 편집 모드면 들어오기 전 값으로
      setDrafts(d => cancelFieldEdit(d, edit));
      setFieldEdit(null);
      spotHoverRef.current = null;
      setSpotHover(null);
      spawnDragRef.current = null;
      setSpawnActive(null);
      floorDragRef.current = null;
      setFloorActive(null);
      setAddTool(null);
      setAddPreview(null);
      setPopover(null);
      setTargetHover(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeEdit, confirm, addTool, popover]);

  // 시나리오 필드 편집 모드: Ctrl / ⌘ + Z 되돌리기, Ctrl / ⌘ + Shift + Z · Ctrl + Y 다시 하기 (글자 입력칸에서는 브라우저 글자 되돌리기)
  useEffect(() => {
    if (!scenarioEdit || confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const undo = key === 'z' && !e.shiftKey;
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey);
      if (!undo && !redo) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      e.preventDefault();
      stepScenarioHistory(undo ? 'undo' : 'redo');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 펼친 동안 Esc = 닫기 (확인창이 떠 있으면 확인창이 먼저 받음)
  useEffect(() => {
    if (!configOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setConfigOpen(false);
        setFieldEdit(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [configOpen]);

  // ---------------- 스윗스팟 모드 (09-10c) ----------------
  const clearEditPointer = () => {
    spotHoverRef.current = null;
    setSpotHover(null);
    spawnDragRef.current = null;
    setSpawnActive(null);
    setSpawnDragging(false);
    floorDragRef.current = null;
    setFloorActive(null);
    setAddTool(null);
    setAddPreview(null);
    setPopover(null);
    setTargetHover(null);
  };
  // CANCEL / Esc: 스윗스팟 / 시작 자세 모드면 들어오기 전 값으로 되돌리고 닫음 (히트맵 모드는 닫기만)
  const cancelEdit = () => {
    const edit = fieldEdit;
    if (edit) setDrafts(d => cancelFieldEdit(d, edit));
    setFieldEdit(null);
    clearEditPointer();
  };
  // DONE: 스윗스팟 / 시작 자세 모드면 그 탭 APPLY까지 (09-10c · 09-11 확정). 적용할 수 없으면(틀린 칸) 초안에만 남기고 안내
  const doneEdit = () => {
    const edit = activeEdit;
    setFieldEdit(null);
    clearEditPointer();
    if (!edit || edit.mode === 'HEATMAP') return;
    const action = editDoneAction(drafts, editTab(edit) as DraftTab);
    if (action === 'APPLY') applyCurrentTab();
    else if (action === 'KEEP_DRAFT') setConfigNotice(t(lang, edit.mode === 'SCENARIO' ? 'edit.scenario.notApplied' : 'edit.sweetSpot.notApplied'));
  };
  // 화면 좌표 → 필드 좌표 (관중석 시점 역변환, 3.7항 cssToCanvas → canvasToField)
  const fieldPointAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !status) return null;
    const rect = canvas.getBoundingClientRect();
    const view = { angle: status.viewAngle, scale: fitScale(status.viewAngle) };
    const p = cssToCanvas(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    return canvasToField(view, p.x, p.y);
  };
  // 필드 좌표 → 필드 영역 안 CSS 위치 (말풍선 / 글자 배치)
  const areaCssAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const area = areaRef.current;
    if (!canvas || !area || !status) return null;
    const rect = canvas.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const at = fieldToCanvas({ angle: status.viewAngle, scale: fitScale(status.viewAngle) }, x, y);
    const k = rect.width / SCENE_WIDTH_PX;
    return { left: rect.left - areaRect.left + at.x * k, top: rect.top - areaRect.top + at.y * k };
  };
  // 팝오버 위치 (14-1c): 대상 기준점의 장면 비율(%, 캔버스와 같은 크기의 글자 층 기준) + 펼칠 방향 (scenarioTargetAnchor)
  const popoverPlacement = (target: ScenarioTarget) => {
    const anchor = scenarioTargetAnchor(drafts.draft, target);
    const view = status ? { angle: status.viewAngle, scale: fitScale(status.viewAngle) } : { angle: 0, scale: 1 };
    const at = fieldToCanvas(view, anchor.x, anchor.y);
    return { leftPct: (at.x / SCENE_WIDTH_PX) * 100, topPct: (at.y / SCENE_WIDTH_PX) * 100, below: anchor.below };
  };
  // 필드 CSS 좌표 → 격자 중심 + 말풍선 위치. 필드 밖이면 null
  const spotAt = (clientX: number, clientY: number) => {
    const p = fieldPointAt(clientX, clientY);
    const cell = p && fieldGridCell(p);
    const at = cell && areaCssAt(cell.x, cell.y);
    return cell && at ? { cell, ...at } : null;
  };
  const spotEdit = activeEdit?.mode === 'SWEET_SPOT' ? activeEdit : null;
  const sameActive = (a: typeof spawnActive, b: typeof spawnActive) => a?.robot === b?.robot && a?.part === b?.part;
  // 시나리오 필드 편집 모드: 누른 로봇 부분을 잡고(핸들 우선) 포인터 캡처
  const onFieldPointerDown = (e: ReactPointerEvent) => {
    if (!scenarioEdit || e.button !== 0) return;
    const p = fieldPointAt(e.clientX, e.clientY);
    if (!p) return;
    const robots = spawnRobots(drafts.draft);
    const hit = spawnHitTest(robots, p);
    // 잡기 순서: 로봇 회전 핸들 → 바닥 기물 → 로봇 몸체 → (추가 상태면) 새 바닥 기물
    const pieces = drafts.draft.scenario.floorPieces ?? [];
    const pieceHit = hit?.part === 'handle' ? null : floorPieceHitTest(pieces, p);
    if (pieceHit !== null) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      floorDragRef.current = {
        index: pieceHit,
        pointerStart: p,
        start: { x: pieces[pieceHit].x, y: pieces[pieceHit].y },
        before: scenarioSnapshot(drafts),
        lastPoint: null,
        lastPointer: null,
        popoverWasOpen: sameTarget(popover, { kind: 'FLOOR', index: pieceHit }),
      };
      setFloorActive({ index: pieceHit, state: 'DRAG' });
      setSpawnActive(null);
      setAddPreview(null);
      setPopover(null);
      setSpawnDragging(true);
      setConfigNotice(null);
      return;
    }
    if (hit) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      spawnDragRef.current = { ...hit, pointerStart: p, poseStart: robots[hit.robot].pose, before: scenarioSnapshot(drafts), lastPose: null, popoverWasOpen: sameTarget(popover, { kind: 'ROBOT', robot: hit.robot }) };
      setSpawnActive(hit);
      setAddPreview(null);
      setPopover(null);
      setSpawnDragging(true);
      setConfigNotice(null);
      return;
    }
    if (addTool && !isOffField(p)) {
      e.preventDefault();
      setConfigNotice(null);
      const result = addFloorPiece(drafts, addTool, p);
      if (result.refusal) showEditToast(floorRefusalText(result.refusal, lang));
      else {
        commitScenario(result.drafts);
        setAddPreview(null);
      }
      return;
    }
    // HIVE / FLOWER / GARDEN → 팝오버 (같은 대상이면 닫기), 빈 자리 → 닫기 (14-1c)
    const target = scenarioTargetHitTest(drafts.draft.scenario.allianceColor, p);
    setPopover(current => (target && !sameTarget(current, target) ? target : null));
  };
  // 바닥 기물 빼기 (14-1b 보완: 팝오버 빼기 / Delete 키) — 되돌리기 기록에 남김
  const removeFloorAt = (index: number) => {
    commitScenario(removeFloorPiece(drafts, index));
    setPopover(null);
    setFloorActive(null);
  };
  // 바닥 기물 팝오버가 열려 있으면 Delete / Backspace = 빼기 (14-1b 보완, 글자 입력칸에서는 글자 지우기, 확인창이 떠 있으면 확인창이 먼저)
  useEffect(() => {
    if (!scenarioEdit || popover?.kind !== 'FLOOR' || confirm) return;
    const index = popover.index;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      e.preventDefault();
      removeFloorAt(index);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  // 놓기: 그 로봇이 겹치는 자리면 끌기 전으로 되돌리고 사유 토스트, 아니면 확정 + 되돌리기 기록 (14-1a)
  const onFieldPointerUp = (e: ReactPointerEvent) => {
    // 바닥 기물: 필드 밖이면 빼기, 겹치는 자리면 끌기 전으로 + 사유, 아니면 확정 + 되돌리기 기록 (14-1b)
    const floorDrag = floorDragRef.current;
    if (floorDrag) {
      floorDragRef.current = null;
      setSpawnDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      const result = finishFloorDrag(drafts, floorDrag.index, floorDrag.before, floorDrag.lastPoint, floorDrag.lastPointer);
      setDrafts(result.drafts);
      if (result.refusal) showEditToast(floorRefusalText(result.refusal, lang));
      else setFieldEdit(edit => (edit?.mode === 'SCENARIO' ? recordScenarioChange(edit, floorDrag.before, scenarioSnapshot(result.drafts)) : edit));
      setFloorActive(null);
      // 끌지 않고 클릭한 기물 = 그 기물 팝오버(빼기) 열기 / 닫기. 0.1 in 반올림으로 자리가 그대로인 아주 작은 끌기도 클릭으로 본다
      const { lastPoint, start } = floorDrag;
      const clicked = !result.removed && (!lastPoint || (lastPoint.x === start.x && lastPoint.y === start.y));
      if (clicked) setPopover(floorDrag.popoverWasOpen ? null : { kind: 'FLOOR', index: floorDrag.index });
      return;
    }
    const drag = spawnDragRef.current;
    if (!drag) return;
    spawnDragRef.current = null;
    setSpawnDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // 끌지 않고 클릭한 몸체 = 로봇 팝오버 열기 / 닫기 (14-1d). 0.1 in 반올림으로 자세가 그대로인 아주 작은 끌기도 클릭으로 본다
    const moved = drag.lastPose && (drag.lastPose.x !== drag.poseStart.x || drag.lastPose.y !== drag.poseStart.y || drag.lastPose.heading !== drag.poseStart.heading);
    if (!moved && drag.part === 'body') setPopover(drag.popoverWasOpen ? null : { kind: 'ROBOT', robot: drag.robot });
    const result = finishRobotDrag(drafts, drag.robot, drag.before, moved ? drag.lastPose : null);
    setDrafts(result.drafts);
    if (result.refused.length > 0) showEditToast(t(lang, 'edit.scenario.refused', { reason: scenarioIssueText(result.refused[0], lang) }));
    else setFieldEdit(edit => (edit?.mode === 'SCENARIO' ? recordScenarioChange(edit, drag.before, scenarioSnapshot(result.drafts)) : edit));
    const p = fieldPointAt(e.clientX, e.clientY);
    const hover = p ? spawnHitTest(spawnRobots(result.drafts.draft), p) : null;
    setSpawnActive(hover);
  };
  const onFieldPointerMove = (e: ReactPointerEvent) => {
    if (scenarioEdit) {
      const p = fieldPointAt(e.clientX, e.clientY);
      if (!p) return;
      const floorDrag = floorDragRef.current;
      if (floorDrag) {
        const at = dragFloorPoint(floorDrag.start, floorDrag.pointerStart, p);
        floorDrag.lastPoint = at;
        floorDrag.lastPointer = p;
        setDrafts(d => moveFloorPiece(d, floorDrag.index, at));
        const state = isOffField(p) || isOffField(at) ? 'REMOVE' : 'DRAG';
        if (floorActive?.state !== state) setFloorActive({ index: floorDrag.index, state });
        return;
      }
      const drag = spawnDragRef.current;
      if (drag) {
        const pose = dragSpawnPose(drag.poseStart, drag.part, drag.pointerStart, p);
        drag.lastPose = pose;
        setDrafts(d => placeSpawn(d, drag.robot, pose));
        return;
      }
      const overBanner = e.target instanceof Element && e.target.closest('.field-edit-banner');
      const hover = overBanner ? null : spawnHitTest(spawnRobots(drafts.draft), p);
      const pieceHover = overBanner || hover?.part === 'handle' ? null : floorPieceHitTest(drafts.draft.scenario.floorPieces ?? [], p);
      const robotHover = pieceHover === null ? hover : null;
      if (!sameActive(robotHover, spawnActive)) setSpawnActive(robotHover);
      if (pieceHover !== (floorActive?.index ?? null)) setFloorActive(pieceHover === null ? null : { index: pieceHover, state: 'HOVER' });
      // 추가 상태: 포인터 자리 미리보기 (놓을 수 있으면 초록 / 없으면 빨강)
      const preview =
        addTool && !overBanner && !robotHover && pieceHover === null && !isOffField(p)
          ? { type: addTool, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, valid: addFloorPiece(drafts, addTool, p).refusal === null }
          : null;
      if (preview?.x !== addPreview?.x || preview?.y !== addPreview?.y || preview?.valid !== addPreview?.valid || preview?.type !== addPreview?.type) setAddPreview(preview);
      const target = !overBanner && !robotHover && pieceHover === null && !addTool ? scenarioTargetHitTest(drafts.draft.scenario.allianceColor, p) : null;
      if (!sameTarget(target, targetHover)) setTargetHover(target);
      return;
    }
    if (!spotEdit) return;
    const overBanner = e.target instanceof Element && e.target.closest('.field-edit-banner');
    const next = overBanner ? null : spotAt(e.clientX, e.clientY);
    const prev = spotHoverRef.current;
    if (next?.cell.x === prev?.cell.x && next?.cell.y === prev?.cell.y) return;
    spotHoverRef.current = next;
    setSpotHover(next);
  };
  const onFieldClick = (e: ReactMouseEvent) => {
    if (scenarioEdit) return;
    if (!spotEdit) {
      c()?.skipHighlight(); // 정착 재생 / 종료 강조 5초 중 필드를 누르면 건너뛰기 (13-7)
      return;
    }
    // 강조된 칸 그대로 찍음 (클릭 좌표는 정수로 반올림되어 칸 경계에서 포인터 이동 좌표와 다른 칸이 될 수 있음)
    const hit = spotHoverRef.current ?? spotAt(e.clientX, e.clientY);
    if (!hit) return;
    setConfigNotice(null);
    setDrafts(d => clickSweetSpot(d, spotEdit.robot, editAlliance, hit.cell, spotEdit.slot));
  };

  // START: 적용 안 된 수정 / 검증 실패 / 명중 확률표 미준비가 있으면 시작하지 않고 첫 문제 탭(R1 → R2 → SCENARIO)으로 펼침
  const start = () => {
    // 편집 중 START = 편집 취소 후 시작 절차 (명세서 3.8): 스윗스팟 모드면 들어오기 전 값으로 되돌린 초안으로 검사
    let current = drafts;
    if (fieldEdit && fieldEdit.mode !== 'HEATMAP') {
      current = cancelFieldEdit(drafts, fieldEdit);
      setDrafts(current);
    }
    setFieldEdit(null);
    clearEditPointer();
    const blocking = startBlocker(current, { robot1: luts.robot1.phase, robot2: luts.robot2.phase });
    if (blocking) {
      setConfigTab(blocking.tab);
      setConfigOpen(true);
      setConfigNotice(t(lang, 'config.startBlocked', { reason: `${t(lang, TAB_LABEL_KEYS[blocking.tab])} — ${t(lang, `config.status.${blocking.reason}`)}` }));
      return;
    }
    closeConfig();
    c()?.start();
  };

  const openHelp = () => {
    const controller = c();
    controller?.pause();
    controller?.stopPlayback();
    controller?.setShortcutsEnabled(false);
    setHelpOpen(true);
  };
  const closeHelp = () => {
    setHelpOpen(false);
    c()?.setShortcutsEnabled(true);
  };

  // 확인창 (09-7b): 필드 영역 중앙의 모달. 떠 있는 동안 컨트롤러 단축키를 끔
  // cancel = false: 확인 버튼 하나인 안내창 (10-6 가지 가득 참), 문자열 = 취소 버튼 문구 (19-1 복구 제안의 버리기)
  const ask = (message: string, okLabel: string, cancel: boolean | string = true): Promise<boolean> =>
    new Promise(resolve => {
      const rect = areaRef.current?.getBoundingClientRect();
      c()?.setShortcutsEnabled(false);
      setConfirm({
        request: { message, okLabel, cancelLabel: typeof cancel === 'string' ? cancel : cancel ? t(lang, 'confirm.cancel') : null },
        anchor: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
        resolve,
      });
    });
  const closeConfirm = (ok: boolean) => {
    const current = confirm;
    setConfirm(null);
    c()?.setShortcutsEnabled(true);
    current?.resolve(ok);
  };

  // 자동 저장 / 복구 제안 (19-1): 렌더마다 최신 상태로 다시 묶음 (마운트 효과의 저장 예약 / 복구 제안이 부름)
  useEffect(() => {
    // 자동 저장 (19-1): 저장하는 순간의 분기 트리 전체를 경기 파일과 같은 레시피 글자로 (진행 중에도, 설정 = 적용 값).
    // 바뀌지 않은 가지(떠난 가지)는 캐시에서 재사용 → 진행 중 저장은 지금 가지만 새로 부호화
    saveAutosaveRef.current = () => {
      const store = autosaveRef.current;
      const src = c()?.recipeSource({ whileRunning: true });
      if (!store || !src) return;
      try {
        void store.save(serializeMatchRecipe(buildMatchRecipe({ setup: appliedRef.current, ...src, createdAt: new Date() }, autosaveInputCache), autosaveInputCache));
      } catch {
        // 재료가 틀리면(있을 수 없음) 이번 저장만 건너뜀
      }
    };
    // 복구 제안 (19-1): 저장 글자를 경기 파일처럼 해석 → 확인창(복구 / 버리기) → 복구 = 경기 불러오기 흐름, 버리기 = 저장 지움.
    // 해석 실패(형식이 바뀐 이전 앱 등)면 조용히 지움. 경기 전이 아니거나 불러오는 중이면 묻지 않음
    offerRestoreRef.current = text => {
      const parsed = parseMatchRecipe(text, DEFAULT_DRAFT_VALUES);
      const discard = () => {
        autosaveSchedulerRef.current?.reset();
        void autosaveRef.current?.clear();
      };
      if (!parsed.ok) {
        discard();
        return;
      }
      if (c()?.status().phase !== 'SETUP' || matchImport) return;
      void ask(autosaveRestoreMessage(lang, parsed.recipe, parsed.warnings), t(lang, 'autosave.restore'), t(lang, 'autosave.discard')).then(ok => {
        if (!ok) discard();
        else if (c()?.status().phase === 'SETUP') beginMatchImport(parsed.recipe, parsed.warnings);
      });
    };
  });

  // 분기: 재생 중이면 멈춘 뒤 그 틱 기준으로 확인 (명세서 3.8 분기 확인창)
  const branch = () => {
    const controller = c();
    if (!controller) return;
    controller.stopPlayback();
    const s = controller.status();
    if (!s.canBranch) return;
    // 10-6: 가지가 가득 찼으면 안내창만 (분기하지 않음), 아니면 새 가지 확인창
    if (!s.canFork) {
      void ask(branchFullText(lang), t(lang, 'confirm.ok'), false);
      return;
    }
    void ask(branchConfirmText(lang, s), t(lang, 'control.branch')).then(ok => {
      if (ok) controller.branch();
    });
  };
  // 가지 전환 / 삭제 (16-2): 다시 계산할 틱이 많으면 "가지 계산 중"을 먼저 그린 뒤(rAF → 다음 작업) 계산한다. 계산 중에는 다른 전환을 받지 않음
  const runBranchSwitch = (cost: number, run: () => void) => {
    if (branchBusyRef.current) return;
    if (!switchNeedsBusy(cost)) {
      run();
      return;
    }
    branchBusyRef.current = true;
    setBranchBusy(true);
    requestAnimationFrame(() =>
      window.setTimeout(() => {
        run();
        branchBusyRef.current = false;
        setBranchBusy(false);
      }, 0),
    );
  };
  const switchBranch = (id: number) => {
    const controller = c();
    if (controller) runBranchSwitch(controller.switchCost(id), () => controller.switchBranch(id));
  };
  // 가지 목록 (10-6): 전환 / 이름 바꾸기는 바로, 삭제는 확인창 (하위 가지 수 포함)
  const branchActions = {
    switchBranch,
    renameBranch: (id: number, name: string) => c()?.renameBranch(id, name),
    deleteBranch: (id: number) => {
      const controller = c();
      if (!controller) return;
      void ask(deleteConfirmText(lang, controller.status(), id), t(lang, 'branch.delete')).then(ok => {
        if (ok) runBranchSwitch(controller.deleteCost(id), () => controller.deleteBranch(id));
      });
    },
    exportMatch,
    saveMatch: libraryItems ? saveMatchFromMenu : undefined,
  };

  // NEW: 진행 중이면 먼저 일시정지하고 확인, 취소하면 일시정지 상태로 남음 (09-7 확정)
  const newMatch = () => {
    const controller = c();
    if (!controller) return;
    controller.pause();
    controller.stopPlayback();
    void ask(newMatchConfirmText(lang, controller.status()), t(lang, 'control.newMatch')).then(ok => {
      if (!ok) return;
      controller.reset();
      // 확인창을 거쳐 버린 경기 = 자동 저장도 지움 (19-1 확정)
      autosaveSchedulerRef.current?.reset();
      void autosaveRef.current?.clear();
    });
  };

  const actions: ScrubberActions = {
    start,
    pause: () => c()?.pause(),
    resume: () => c()?.resume(),
    branch,
    stepView: delta => c()?.stepView(delta),
    setViewTick: tick => c()?.setViewTick(tick),
    togglePlayback: () => c()?.togglePlayback(),
    setSpeed: speed => c()?.setPlaybackSpeed(speed),
    toggleView: () => c()?.setMatchView(status?.matchView === 'AUDIENCE' ? 'DRIVER' : 'AUDIENCE'),
    newMatch,
    openResult: () => c()?.openResult(),
  };

  return (
    <div className={`main-screen${configOpen ? ' is-config-open' : ''}`} lang={lang} style={configOpen ? LAYOUT_STYLE_OPEN : LAYOUT_STYLE}>
      {status && <LeftPanel status={status} lang={lang} teams={{ robot1: drafts.applied.robot1, robot2: drafts.applied.robot2 }} />}
      {/* 종료 강조 5초 중 필드를 누르면 건너뛰기 */}
      <div
        className={`field-area${spotEdit ? ' is-picking' : ''}${scenarioEdit ? ` is-scenario-edit${spawnActive ? ` is-over-${spawnActive.part}` : floorActive ? ' is-over-body' : ''}${spawnDragging ? ' is-dragging' : ''}${addTool ? ' is-adding' : ''}${targetHover ? ' is-over-target' : ''}` : ''}`}
        ref={areaRef}
        onClick={onFieldClick}
        onPointerDown={onFieldPointerDown}
        onPointerUp={onFieldPointerUp}
        onPointerCancel={onFieldPointerUp}
        onPointerMove={onFieldPointerMove}
        onPointerLeave={() => {
          if (!spawnDragging) {
            setSpawnActive(null);
            setFloorActive(null);
          }
          setAddPreview(null);
          setTargetHover(null);
          spotHoverRef.current = null;
          setSpotHover(null);
        }}
      >
        <canvas ref={canvasRef} className="field-canvas" />
        <FieldNotices
          autoPauseReason={status?.autoPauseReason ?? null}
          toasts={toasts}
          lang={lang}
          matchNotice={matchNotice && mismatchBanner(lang, matchNotice.comparison, matchNotice.warnings, matchNotice.branch && { label: branchLabel(lang, matchNotice.branch), others: matchNotice.branch.others })}
          onDismissMatchNotice={() => setMatchNotice(null)}
          below={!!activeEdit}
        />
        {scenarioEdit && (
          <ScenarioEditBanner
            issues={[...new Set(scenarioFormIssues(drafts.draft).map(issue => scenarioIssueText(issue, lang)))]}
            canUndo={scenarioEdit.history.past.length > 0}
            canRedo={scenarioEdit.history.future.length > 0}
            addTool={addTool}
            remaining={floorRemaining(drafts.draft)}
            faded={spawnDragging}
            lang={lang}
            onUndo={() => stepScenarioHistory('undo')}
            onRedo={() => stepScenarioHistory('redo')}
            onAddTool={piece => {
              setAddTool(piece);
              setAddPreview(null);
              setPopover(null);
            }}
            onDone={doneEdit}
            onCancel={cancelEdit}
          />
        )}
        <div className="field-overlay" ref={overlayRef}>
          {scenarioEdit && popover && status && (popover.kind !== 'FLOOR' || popover.index < (drafts.draft.scenario.floorPieces?.length ?? 0)) && (
            <ScenarioFieldPopover
              target={popover}
              scenario={drafts.draft.scenario}
              view={readScenario(drafts.draft.scenario, drafts.draft.robot1.config, drafts.draft.robot2.config)}
              red={issueFieldSet(scenarioFormIssues(drafts.draft))}
              robots={{ robot1: drafts.draft.robot1, robot2: drafts.draft.robot2 }}
              issues={popover.kind === 'ROBOT' ? robotPopoverIssues(drafts.draft, popover.robot).map(issue => scenarioIssueText(issue, lang)) : []}
              at={popoverPlacement(popover)}
              lang={lang}
              onEdit={next => editScenario(next, null, null)}
              onRemoveFloor={() => popover.kind === 'FLOOR' && removeFloorAt(popover.index)}
              onClose={() => setPopover(null)}
            />
          )}
          {scenarioEdit &&
            status &&
            (['robot1', 'robot2'] as const).map(robot => {
              const { pose, size } = spawnRobots(drafts.draft)[robot];
              // 몸체 위쪽 (외접원 위) — 장면 논리 px를 캔버스 크기 비율로
              const at = fieldToCanvas({ angle: status.viewAngle, scale: fitScale(status.viewAngle) }, pose.x, pose.y - Math.hypot(size.length, size.width) / 2);
              const bad = scenarioFormIssues(drafts.draft).some(i => i.code.startsWith('PLACEMENT_') && i.fields.includes(`spawn.${robot}`));
              return <SpawnPoseTag key={robot} at={{ left: `${(at.x / SCENE_WIDTH_PX) * 100}%`, top: `${(at.y / SCENE_WIDTH_PX) * 100}%` }} label={robotLabel(robot)} pose={pose} bad={bad} unit={settings.lengthUnit} />;
            })}
        </div>
        {activeEdit && activeEdit.mode !== 'SCENARIO' && (
          <FieldEditBanner
            edit={activeEdit}
            piece={editPiece ?? activeEdit.piece}
            pieces={editPieceList}
            shooter={activeEdit.mode === 'SWEET_SPOT' && drafts.draft[activeEdit.robot].config.shooterSetup === 'PER_PIECE' ? activeEdit.slot : null}
            alliance={editAlliance}
            lut={luts[activeEdit.robot]}
            pendingApply={lutInputsChanged(drafts.draft[activeEdit.robot], drafts.applied[activeEdit.robot])}
            sweetSpot={
              spotEdit && {
                spot: readSweetSpot(drafts.draft[spotEdit.robot], editAlliance, spotEdit.slot),
                issues: sweetSpotIssueCodes(drafts.draft[spotEdit.robot], spotEdit.slot),
                heatmapStale: lutInputsChanged(drafts.draft[spotEdit.robot], drafts.applied[spotEdit.robot]),
              }
            }
            unit={settings.lengthUnit}
            lang={lang}
            onPiece={piece => setFieldEdit(activeEdit.mode === 'HEATMAP' ? { ...activeEdit, piece } : { ...activeEdit, piece })}
            onDone={doneEdit}
            onCancel={cancelEdit}
          />
        )}
        {spotEdit && spotHover && (
          <SweetSpotHoverTip
            at={spotHover}
            issues={sweetSpotCandidateIssues(drafts.draft[spotEdit.robot], editAlliance, spotHover.cell, spotEdit.slot)}
            unit={settings.lengthUnit}
            lang={lang}
          />
        )}
        {(status?.endStage === 'SETTLE' || status?.endStage === 'HIGHLIGHT') && <EndOverlay key={status.endSeq} lang={lang} settling={status.endStage === 'SETTLE'} />}
      </div>
      {status &&
        (configOpen ? (
          <ConfigPanel
            lang={lang}
            tab={configTab}
            statuses={statuses}
            locked={locked}
            notice={configNotice}
            canApply={configTab !== 'settings' && canApply(drafts, configTab)}
            canReset={configTab !== 'settings' && canResetTab(drafts, configTab, DEFAULT_DRAFT_VALUES)}
            onTab={tab => {
              setConfigTab(tab);
              if (!fieldEdit || tab !== editTab(fieldEdit)) {
                setFieldEdit(null);
                clearEditPointer();
              }
              setConfigNotice(null);
              setPresetError(null);
            }}
            onClose={closeConfig}
            onApply={applyCurrentTab}
            onResetTab={resetCurrentTab}
            content={
              configTab === 'settings' ? (
                <SettingsTab
                  status={status}
                  lang={lang}
                  settings={settings}
                  onSettings={updateSettings}
                  onSourceChoice={(robot, choice) => c()?.setSourceChoice(robot, choice)}
                  onResetAll={resetAll}
                  teams={{ robot1: drafts.applied.robot1, robot2: drafts.applied.robot2 }}
                  presetError={presetError && { row: presetError.row, message: presetErrorMessage(lang, presetError.error) }}
                  onPresetExport={exportPreset}
                  onPresetImport={importPreset}
                  matchImport={{ loading: matchImportText, error: matchImportError && matchImportErrorMessage(lang, matchImportError) }}
                  onMatchImport={importMatch}
                  onMatchCancel={cancelMatchImport}
                  readGamepadButtons={slot => c()?.gamepadButtons(slot) ?? null}
                  library={
                    <>
                      {librarySection('all')}
                      {librarySection(null)}
                    </>
                  }
                />
              ) : configTab === 'robot1' || configTab === 'robot2' ? (
                <RobotTab
                  key={configTab}
                  robotId={configTab}
                  profile={drafts.draft[configTab]}
                  fieldText={drafts.fieldText[configTab]}
                  unit={settings.lengthUnit}
                  lang={lang}
                  locked={locked}
                  canCopy={canCopyRobotTab(drafts, configTab)}
                  alliance={drafts.draft.scenario.allianceColor}
                  lut={luts[configTab]}
                  appliedSetup={drafts.applied[configTab].config.shooterSetup}
                  lutPending={lutInputsChanged(drafts.draft[configTab], drafts.applied[configTab])}
                  onRetry={() => trackerRef.current?.retry(configTab)}
                  heatmapOn={activeEdit?.mode === 'HEATMAP' && activeEdit.robot === configTab}
                  onHeatmap={() => setFieldEdit(current => toggleHeatmapEdit(current, configTab, drafts.applied[configTab]))}
                  spotEditSlot={spotEdit?.robot === configTab ? spotEdit.slot : null}
                  onSetOnField={slot => {
                    spotHoverRef.current = null;
                    setSpotHover(null);
                    setFieldEdit(current => openSweetSpotEdit(current, drafts, configTab, slot));
                  }}
                  onEdit={editRobot(configTab)}
                  onCopy={() => copyRobot(configTab)}
                  library={librarySection(configTab)}
                />
              ) : configTab === 'scenario' ? (
                <ScenarioTab
                  scenario={drafts.draft.scenario}
                  robots={{ robot1: drafts.draft.robot1, robot2: drafts.draft.robot2 }}
                  fieldText={drafts.fieldText.scenario}
                  issues={scenarioFormIssues(drafts.draft)}
                  warnings={scenarioFormWarnings(drafts.draft)}
                  unit={settings.lengthUnit}
                  lang={lang}
                  locked={locked}
                  onEdit={editScenario}
                  onReroll={rerollScenarioSeed}
                  library={librarySection('scenario')}
                  fieldEditOn={!!scenarioEdit}
                  onEditOnField={() => {
                    clearEditPointer();
                    setFieldEdit(current => openScenarioEdit(current, drafts));
                  }}
                />
              ) : null
            }
          />
        ) : (
          <ConfigRail status={status} lang={lang} statuses={statuses} luts={luts} canOpen={canOpen} onOpen={openConfig} onHelp={openHelp} />
        ))}
      {status && <ScrubberBar status={status} lang={lang} actions={actions} branchMenu={{ enabled: branchMenuEnabled(status) && !confirm, actions: branchActions }} />}
      {status?.endStage === 'RESULT' && status.result && (
        <ResultPopup result={status.result} alliance={status.alliance} teams={{ robot1: drafts.applied.robot1, robot2: drafts.applied.robot2 }} lang={lang} onReview={() => c()?.closeResult()}
          onRestart={newMatch}
          onExportMatch={exportMatch}
          onSaveMatch={libraryItems ? saveMatchFromResult : undefined}
          saveNotice={matchSaveNotice?.endSeq === status.endSeq ? matchSaveNotice.text : null}
          onExportSummary={exportSummary}
          onSwitchBranch={switchBranch}
          branchName={shownBranchName(lang, status)}
          comparison={branchComparison(lang, status)}
        />
      )}
      {confirm && <ConfirmDialog request={confirm.request} anchor={confirm.anchor} onClose={closeConfirm} />}
      {helpOpen && <HelpDialog lang={lang} devices={settings.devices} mappings={settings.gamepadMappings} onClose={closeHelp} />}
      {branchBusy && (
        <div className="branch-busy" role="status">
          <LoaderCircle />
          {t(lang, 'branch.computing')}
        </div>
      )}
    </div>
  );
}
