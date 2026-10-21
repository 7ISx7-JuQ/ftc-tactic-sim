// 메인 화면 브라우저 테스트 (명세서 3.7 테스트, 3.8 웹 화면): 실제 Chromium에서 앱 화면을 띄워 주요 상호작용 흐름을 확인한다.
// 명중 확률표는 바로 준비되는 캐시를 주입해 Worker 생성 시간(10 ~ 60초)을 건너뛴다 (실제 Worker / IndexedDB는 lutWorker.browser.test.ts).
// 스크린샷 비교는 하지 않는다 (글꼴 / 안티앨리어싱 차이로 불안정). 화면 문구는 영어 기본값 기준.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MainScreen from '../MainScreen';
import type { MainScreenServices } from '../MainScreen';
import type { LUTCacheEntry } from '../../workers/lutCache';
import type { LUTWorkerLike } from '../../workers/lutManager';
import { DEFAULT_DRAFT_VALUES, setupFromDrafts } from '../../app/defaultSetup';
import { buildMatchRecipe, serializeMatchRecipe, timelineRecord } from '../../app/matchRecipe';
import { MATCH_TICKS, SimulationEngine } from '../../core/simulationEngine';
import '../../index.css';

// 바로 준비되는 명중 확률표: 어떤 요청이든 캐시 적중 (기준 LUT = 전 격자 0.5)
const READY_ENTRY: LUTCacheEntry = {
  v0: { POLLEN: 270, NECTAR: 280 },
  sweetSpotHitRate: { POLLEN: 0.5, NECTAR: 0.5 },
  reference: { POLLEN: new Float32Array(144 * 144).fill(0.5), NECTAR: new Float32Array(144 * 144).fill(0.5) },
};
const idleWorker = (): LUTWorkerLike => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} });
const SERVICES: MainScreenServices = {
  createLUTWorker: idleWorker,
  createLUTCache: () => ({ get: async () => READY_ENTRY, put: async () => {} }),
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): void {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root!.render(<MainScreen services={SERVICES} />));
}

function unmount(): void {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
}

const timerText = () => document.querySelector('.timer-value')?.textContent; // 좌측 패널 타이머 (보는 틱 기준)
const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

beforeEach(() => {
  localStorage.clear(); // 설정 자동 보관 (3.8항) — 테스트마다 기본값에서 시작
  mount();
});
afterEach(unmount);

describe('앱 시작', () => {
  it('경기 전 화면: 2:00 / 확률표가 준비되면 START 활성', async () => {
    await expect.poll(timerText).toBe('2:00');
    await expect.element(button('START')).toBeEnabled();
    await expect.element(button('VIEW')).toBeDisabled(); // 경기 전에는 보기 전환 없음
  });
});

describe('config 창', () => {
  it('펼치기 → 탭 4개 → Esc로 접기', async () => {
    await userEvent.click(button('Open settings'));
    for (const tab of ['R1', 'R2', 'SCENARIO', 'SETTINGS']) await expect.element(page.getByRole('tab', { name: tab })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tab', { name: 'R1' })).not.toBeInTheDocument();
  });

  it('로봇 탭: 범위 밖 입력은 빨간 오류 + APPLY 막힘, 올바른 값은 APPLY로 적용', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'R1' }));
    const width = page.getByLabelText('Width', { exact: true }).first(); // 제원 가로 칸 (흡입 구역 폭 칸보다 앞)
    await userEvent.fill(width, '30');
    await expect.element(page.getByRole('alert').filter({ hasText: '18.00' })).toBeVisible();
    await expect.element(button('APPLY')).toBeDisabled();

    await userEvent.fill(width, '16');
    await expect.element(page.getByRole('alert').filter({ hasText: '18.00' })).not.toBeInTheDocument();
    await expect.element(button('APPLY')).toBeEnabled();
    await userEvent.click(button('APPLY'));
    await expect.element(button('APPLY')).toBeDisabled(); // 적용 값 = 초안
  });

  it('로봇 탭 슈터 구성 (13-3): 기물별 2개 → NECTAR 슈터 카드, NECTAR 흡입을 끄면 오류 / 구성 제한, 없음 → 슈터 · 스윗스팟 숨김, 투입 방향 구역 추가', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'R1' }));
    const setup = page.getByRole('radiogroup', { name: 'Setup' });
    await userEvent.click(setup.getByRole('radio', { name: 'Per piece' }));
    await expect.element(page.getByRole('heading', { name: 'NECTAR shooter' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'POLLEN sweet spot → hit map' })).toBeVisible();

    // 고정형 슈터 카드에는 허용 조준 오차 칸이 없음 (11-3): NECTAR 카드를 터렛으로 바꾸면 한계 칸, 고정형으로 되돌리면 숨김
    await expect.element(page.getByText('Aim tolerance', { exact: false })).not.toBeInTheDocument();
    // 미리보기 (13-5): 고정형 슈터 = 사출구에서 앞으로 발사 방향 선, 터렛 = 회전 범위 부채꼴
    const previewAims = () => [...document.querySelectorAll('.robot-preview .preview-aim')].map(e => `${e.tagName}${e.classList.contains('is-nectar') ? ':NECTAR' : ''}`).sort();
    expect(previewAims()).toEqual(['line', 'line:NECTAR']);
    const nectarType = page.getByRole('radiogroup', { name: 'NECTAR shooter Type' });
    await userEvent.click(nectarType.getByRole('radio', { name: 'Turret' }));
    await expect.element(page.getByLabelText('Left limit')).toBeVisible();
    expect(previewAims()).toEqual(['line', 'path:NECTAR']);
    await userEvent.click(nectarType.getByRole('radio', { name: 'Fixed' }));
    await expect.element(page.getByLabelText('Left limit')).not.toBeInTheDocument();
    expect(previewAims()).toEqual(['line', 'line:NECTAR']);

    // NECTAR 카드 좌우 오프셋 (두 번째 칸): 범위 밖이면 오류 + APPLY 막힘
    const lateral = page.getByLabelText('Launcher offset (+ right)').nth(1);
    await userEvent.fill(lateral, '25');
    await expect.element(page.getByRole('alert').filter({ hasText: '18.00' })).toBeVisible();
    await expect.element(button('APPLY')).toBeDisabled();
    await userEvent.fill(lateral, '-3');
    await expect.element(button('APPLY')).toBeEnabled();

    // NECTAR 흡입 끄기: 기물별 2개는 그대로 두고 오류로 알림, 다른 NECTAR 구성은 고를 수 없음
    await userEvent.click(page.getByText('Can intake NECTAR', { exact: true })); // 토글 줄(label)을 누름 — 체크박스는 스위치 그림 아래
    await expect.element(page.getByRole('checkbox', { name: 'Can intake NECTAR' })).not.toBeChecked();
    await expect.element(page.getByText('This shooter setup needs NECTAR intake')).toBeVisible();
    await expect.element(button('APPLY')).toBeDisabled();
    await expect.element(setup.getByRole('radio', { name: 'POLLEN only' })).toBeDisabled();
    await userEvent.click(setup.getByRole('radio', { name: 'Shared' }));
    await expect.element(page.getByText('This shooter setup needs NECTAR intake')).not.toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'NECTAR shooter' })).not.toBeInTheDocument();
    await expect.element(button('APPLY')).toBeEnabled();

    // 없음: 슈터 칸 / 스윗스팟 구역 숨김
    await userEvent.click(setup.getByRole('radio', { name: 'None' }));
    await expect.element(page.getByLabelText('Launch angle')).not.toBeInTheDocument();
    await expect.element(page.getByRole('heading', { name: 'Sweet spot → hit map' })).not.toBeInTheDocument();

    // 리프트: 주행 속도 칸 + 투입 방향 구역 추가
    await expect.element(page.getByLabelText('Drive speed with lift up')).toBeVisible();
    await userEvent.click(button('Add drop zone'));
    await expect.element(page.getByText('Drop zone 1', { exact: true })).toBeVisible();
    await expect.element(button('APPLY')).toBeEnabled();
    await userEvent.click(button('APPLY'));
    await expect.element(button('APPLY')).toBeDisabled();
  });

  it('기물별 확률표 화면 (13-4): NECTAR 슈터 SET ON FIELD → 그 슈터 스윗스팟 모드, POLLEN 전용 적용 → 히트맵 NECTAR 버튼 비활성 · 상태 상자 "쏘지 않음"', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'R1' }));
    const setup = page.getByRole('radiogroup', { name: 'Setup' });
    await userEvent.click(setup.getByRole('radio', { name: 'Per piece' }));
    await userEvent.click(button('NECTAR shooter SET ON FIELD'));
    const spotBanner = page.getByRole('region', { name: 'SWEET SPOT · R1 · NECTAR shooter' });
    await expect.element(spotBanner).toBeVisible();
    const pieces = spotBanner.getByRole('radiogroup', { name: 'Hit rate' });
    await expect.element(pieces.getByRole('radio', { name: 'NECTAR' })).toBeChecked();
    await expect.element(pieces.getByRole('radio', { name: 'POLLEN' })).toBeDisabled();
    await expect.element(button('NECTAR shooter SETTING ON FIELD')).toBeDisabled();
    await userEvent.keyboard('{Escape}'); // 취소
    await expect.element(spotBanner).not.toBeInTheDocument();

    await userEvent.click(setup.getByRole('radio', { name: 'POLLEN only' }));
    await userEvent.click(button('APPLY'));
    await expect.element(page.getByText('NECTAR: not shot by this robot (shooter setup), no hit map')).toBeVisible();
    await userEvent.click(button('SHOW HIT MAP'));
    const mapBanner = page.getByRole('region', { name: 'HIT MAP · R1' });
    await expect.element(mapBanner).toBeVisible();
    await expect.element(mapBanner.getByRole('radio', { name: 'NECTAR' })).toBeDisabled();
    await expect.element(mapBanner.getByRole('radio', { name: 'POLLEN' })).toBeChecked();
    await userEvent.keyboard('{Escape}');
    await expect.element(mapBanner).not.toBeInTheDocument();
  });

  it('시나리오 필드 편집 (14-1a): EDIT ON FIELD → 탭 변경 되돌리기 / 다시 하기, 겹친 자리에 끌어 놓으면 원래 자리 + 사유 토스트, Ctrl+Z, CANCEL', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    await userEvent.click(button('EDIT ON FIELD').first());
    const banner = page.getByRole('region', { name: 'SCENARIO ON FIELD' });
    await expect.element(banner).toBeVisible();
    await expect.element(banner.getByRole('button', { name: 'UNDO' })).toBeDisabled();
    // 탭에서 바꾼 값도 되돌리기 기록에 남음
    const alliance = page.getByRole('radiogroup', { name: 'ALLIANCE' });
    await userEvent.click(alliance.getByRole('radio', { name: 'BLUE' }));
    await expect.element(alliance.getByRole('radio', { name: 'BLUE' })).toBeChecked();
    await userEvent.click(banner.getByRole('button', { name: 'UNDO' }));
    await expect.element(alliance.getByRole('radio', { name: 'RED' })).toBeChecked();
    await userEvent.click(banner.getByRole('button', { name: 'REDO' }));
    await expect.element(alliance.getByRole('radio', { name: 'BLUE' })).toBeChecked();
    await userEvent.click(banner.getByRole('button', { name: 'UNDO' }));

    // 필드 좌표 → 캔버스 안 위치 (관중석 시점: 여백 8 in, 160 in = 캔버스 한 변)
    const canvas = document.querySelector('.field-canvas') as HTMLCanvasElement;
    const at = (x: number, y: number) => {
      const k = canvas.getBoundingClientRect().width / 160;
      return { x: (x + 8) * k, y: (y + 8) * k };
    };
    const field = page.elementLocator(canvas);
    const x1 = page.getByLabelText('X').first(); // R1 시작 자세 X 칸
    await expect.element(x1).toHaveValue('9.0');
    // R1을 R2 위로 끌어 놓음 → 놓지 않음 (원래 자리) + 사유 토스트
    await userEvent.dragAndDrop(field, field, { sourcePosition: at(9, 36), targetPosition: at(20, 100) });
    await expect.element(page.getByText(/^Not placed — /)).toBeVisible();
    await expect.element(x1).toHaveValue('9.0');
    await expect.element(banner.getByRole('button', { name: 'UNDO' })).toBeDisabled();
    // 빈 자리로 끌기 → 확정 + 되돌리기 기록, Ctrl+Z로 원래 자리
    await userEvent.dragAndDrop(field, field, { sourcePosition: at(9, 36), targetPosition: at(30, 40) });
    await expect.element(x1).not.toHaveValue('9.0');
    await expect.element(banner.getByRole('button', { name: 'UNDO' })).toBeEnabled();
    await userEvent.keyboard('{Control>}z{/Control}');
    await expect.element(x1).toHaveValue('9.0');
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    await expect.element(x1).not.toHaveValue('9.0');
    // CANCEL = 들어오기 전으로 + 모드 닫힘
    await userEvent.click(banner.getByRole('button', { name: 'CANCEL' }));
    await expect.element(banner).not.toBeInTheDocument();
    await expect.element(x1).toHaveValue('9.0');
    await expect.element(button('APPLY')).toBeDisabled();
  });

  it('시나리오 필드 편집 바닥 기물 (14-1b): + POLLEN → 놓을 기물 없음 토스트, GARDEN을 줄이면 바닥 클릭으로 추가, 겹치면 거부, Esc = 추가만 끝, 필드 밖으로 끌어 빼기, 되돌리기', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    await userEvent.click(button('EDIT ON FIELD').first());
    const banner = page.getByRole('region', { name: 'SCENARIO ON FIELD' });
    const canvas = document.querySelector('.field-canvas') as HTMLCanvasElement;
    const at = (x: number, y: number) => {
      const k = canvas.getBoundingClientRect().width / 160;
      return { x: (x + 8) * k, y: (y + 8) * k };
    };
    const field = page.elementLocator(canvas);
    const summary = () => [...document.querySelectorAll('.settings-note')].map(e => e.textContent ?? '').find(text => text.startsWith('Floor:'));
    const addPollen = banner.getByRole('button', { name: 'POLLEN' });

    // 기본 시나리오는 바닥 기물 0개 → 놓지 않고 토스트
    await userEvent.click(addPollen);
    await expect.element(addPollen).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(field, { position: at(40, 40) });
    await expect.element(page.getByText(/^No POLLEN left for the floor/)).toBeVisible();
    await expect.poll(summary).toMatch(/POLLEN \d+ \(placed 0/);

    // 아군 GARDEN 4 → 3 (바닥 POLLEN 1개) → 바닥 클릭으로 추가
    await userEvent.click(page.getByRole('group', { name: 'Ally GARDEN' }).getByRole('button', { name: 'Decrease' }));
    await expect.element(banner.getByText(/^Not placed: POLLEN 1 /)).toBeVisible();
    await userEvent.click(field, { position: at(40, 40) });
    await expect.poll(summary).toMatch(/POLLEN \d+ \(placed 1/);
    await expect.element(banner.getByText(/^Not placed: POLLEN 0 /)).toBeVisible();
    // GARDEN을 하나 더 줄이고 같은 자리 → 겹침 거부
    await userEvent.click(page.getByRole('group', { name: 'Ally GARDEN' }).getByRole('button', { name: 'Decrease' }));
    await userEvent.click(field, { position: at(42.6, 40) }); // 기존 기물(잡기 여유 2.4 in) 바로 밖 — 반지름 합 2.8 in 안이라 겹침
    await expect.element(page.getByText('Not placed — overlaps another placed piece')).toBeVisible();
    await expect.poll(summary).toMatch(/POLLEN \d+ \(placed 1/);
    // Esc = 추가 상태만 끝 (모드는 그대로)
    await userEvent.keyboard('{Escape}');
    await expect.element(addPollen).toHaveAttribute('aria-pressed', 'false');
    await expect.element(banner).toBeVisible();
    // 필드 밖으로 끌어 빼기 → 되돌리기로 다시
    await userEvent.dragAndDrop(field, field, { sourcePosition: at(40, 40), targetPosition: at(-5, 40) });
    await expect.poll(summary).toMatch(/POLLEN \d+ \(placed 0/);
    await userEvent.click(banner.getByRole('button', { name: 'UNDO' }));
    await expect.poll(summary).toMatch(/POLLEN \d+ \(placed 1/);
    // DONE · APPLY → 적용
    await userEvent.click(banner.getByRole('button', { name: 'DONE · APPLY' }));
    await expect.element(banner).not.toBeInTheDocument();
    await expect.element(button('APPLY')).toBeDisabled();
  });

  it('시나리오 필드 편집 팝오버 (14-1c): HIVE / FLOWER를 누르면 개수 조절 팝오버, 값은 탭과 같은 초안 + 되돌리기, Esc = 팝오버만 닫기, 빈 자리 = 닫기', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    await userEvent.click(button('EDIT ON FIELD').first());
    const banner = page.getByRole('region', { name: 'SCENARIO ON FIELD' });
    const canvas = document.querySelector('.field-canvas') as HTMLCanvasElement;
    const at = (x: number, y: number) => {
      const k = canvas.getBoundingClientRect().width / 160;
      return { x: (x + 8) * k, y: (y + 8) * k };
    };
    const field = page.elementLocator(canvas);
    const stepperValue = (scope: ReturnType<typeof page.getByRole>, name: string) => () => scope.getByRole('group', { name }).element().querySelector('.stepper-value')?.textContent;
    const tab = page.getByRole('tabpanel');

    // 우리 HIVE (RED 셀 가운데) → HIVE 팝오버, POLLEN + 1 → 탭에도 반영
    await userEvent.click(field, { position: at(59, 60) });
    const hive = page.getByRole('dialog', { name: 'HIVE' });
    await expect.element(hive).toBeVisible();
    await userEvent.click(hive.getByRole('group', { name: 'POLLEN in upward CELL' }).getByRole('button', { name: 'Increase' }));
    await expect.poll(stepperValue(hive, 'POLLEN in upward CELL')).toBe('1');
    await expect.poll(stepperValue(tab, 'POLLEN in upward CELL')).toBe('1');
    // Esc = 팝오버만 닫기 (모드는 그대로), 되돌리기
    await userEvent.keyboard('{Escape}');
    await expect.element(hive).not.toBeInTheDocument();
    await expect.element(banner).toBeVisible();
    await userEvent.click(banner.getByRole('button', { name: 'UNDO' }));
    await expect.poll(stepperValue(tab, 'POLLEN in upward CELL')).toBe('0');

    // FLOWER 1 (2, 96) → FLOWER 팝오버, 빈 자리를 누르면 닫힘
    await userEvent.click(field, { position: at(3, 95) });
    const flower = page.getByRole('dialog', { name: 'FLOWER 1' });
    await expect.element(flower).toBeVisible();
    await userEvent.click(flower.getByRole('button', { name: 'Decrease' }));
    await expect.poll(stepperValue(tab, 'FLOWER 1')).toBe('3');
    await userEvent.click(field, { position: at(100, 120) });
    await expect.element(flower).not.toBeInTheDocument();
    await expect.element(banner).toBeVisible();
  });

  it('시나리오 필드 편집 로봇 팝오버 (14-1d): 로봇 클릭 → 적재물 칸 / 오토 이동, PARK가 LOADING ZONE 밖이면 빨간 사유, 다시 클릭하면 닫기', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    await userEvent.click(button('EDIT ON FIELD').first());
    const canvas = document.querySelector('.field-canvas') as HTMLCanvasElement;
    const at = (x: number, y: number) => {
      const k = canvas.getBoundingClientRect().width / 160;
      return { x: (x + 8) * k, y: (y + 8) * k };
    };
    const field = page.elementLocator(canvas);
    // R2 (9, 108) 몸체를 끌지 않고 클릭
    await userEvent.click(field, { position: at(5, 112) });
    const popover = page.getByRole('dialog', { name: 'R2' });
    await expect.element(popover).toBeVisible();
    const movement = popover.getByRole('radiogroup', { name: 'Auto movement' });
    await expect.element(movement.getByRole('radio', { name: 'LEAVE' })).toBeChecked();
    // PARK: R2 기본 자세는 LOADING ZONE 밖 → 빨간 사유 + 탭 무효
    await userEvent.click(movement.getByRole('radio', { name: 'PARK' }));
    await expect.element(popover.getByText('R2 auto PARK needs a start pose in the LOADING ZONE')).toBeVisible();
    await userEvent.click(movement.getByRole('radio', { name: 'LEAVE' }));
    await expect.element(popover.getByText('R2 auto PARK needs a start pose in the LOADING ZONE')).not.toBeInTheDocument();
    // 적재물 1번 칸: POLLEN → NECTAR (탭에도 반영)
    await userEvent.click(popover.getByRole('button', { name: 'Slot 1: POLLEN' }));
    await expect.element(popover.getByRole('button', { name: 'Slot 1: NECTAR' })).toBeVisible();
    await expect.element(page.getByRole('tabpanel').getByRole('button', { name: 'Slot 1: NECTAR' })).toBeVisible();
    // 같은 로봇을 다시 클릭 = 닫기 (자세는 그대로)
    await userEvent.click(field, { position: at(5, 112) });
    await expect.element(popover).not.toBeInTheDocument();
  });

  it('시나리오 탭 RP 기준값 / 오토 이동 (14-2): POLLINATOR 1 > 2 = 오류 + APPLY 막힘, SWARM 21 = 경고만, DEFAULT, PARK가 LOADING ZONE 밖이면 오류', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    const p1 = page.getByLabelText('POLLINATOR 1 TIPs');
    const swarm = page.getByLabelText('SWARM points');
    await expect.element(p1).toHaveValue('4');
    await expect.element(page.getByText('Default thresholds')).toBeVisible();
    // POLLINATOR 1 = 8 > POLLINATOR 2 = 7 → 오류, APPLY 막힘
    await userEvent.fill(p1, '8');
    await expect.element(page.getByText('RP thresholds must be integers from 1 to 99, POLLINATOR 1 ≤ POLLINATOR 2').first()).toBeVisible();
    await expect.element(button('APPLY')).toBeDisabled();
    await userEvent.fill(p1, '3');
    // 범위 밖 글자 → 칸 오류 (글자 보관)
    await userEvent.fill(swarm, '0');
    await expect.element(button('APPLY')).toBeDisabled();
    // SWARM 21 → 경고만, 적용 가능
    await userEvent.fill(swarm, '21');
    await expect.element(page.getByText(/^SWARM 21 points cannot be reached with 2 robots/)).toBeVisible();
    await expect.element(button('APPLY')).toBeEnabled();
    // DEFAULT = 기본 기준으로 (지정 해제)
    await userEvent.click(page.getByRole('button', { name: 'DEFAULT' }).last());
    await expect.element(swarm).toHaveValue('16');
    await expect.element(p1).toHaveValue('4');
    await expect.element(page.getByText('Default thresholds')).toBeVisible();
    // 오토 이동: R2 PARK (기본 자세는 LOADING ZONE 밖) → 오류, R1 PARK는 통과
    await userEvent.click(page.getByRole('radiogroup', { name: 'R2 Auto movement' }).getByRole('radio', { name: 'PARK' }));
    await expect.element(page.getByText('R2 auto PARK needs a start pose in the LOADING ZONE').first()).toBeVisible();
    await expect.element(button('APPLY')).toBeDisabled();
    await userEvent.click(page.getByRole('radiogroup', { name: 'R2 Auto movement' }).getByRole('radio', { name: 'LEAVE' }));
    await userEvent.click(page.getByRole('radiogroup', { name: 'R1 Auto movement' }).getByRole('radio', { name: 'PARK' }));
    await expect.element(button('APPLY')).toBeEnabled();
    await userEvent.click(button('APPLY'));
    await expect.element(button('APPLY')).toBeDisabled();
  });

  it('TIP 진행 목표 (14-3): 좌측 패널 TIP 목표 = 적용한 시나리오의 POLLINATOR 1 기준 (기본 4)', async () => {
    const tipTarget = () => document.querySelector('.tip-target')?.textContent?.trim();
    await expect.poll(tipTarget).toBe('/ 4');
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    await userEvent.fill(page.getByLabelText('POLLINATOR 1 TIPs'), '3');
    await expect.poll(tipTarget).toBe('/ 4'); // 초안만 바뀜
    await userEvent.click(button('APPLY'));
    await expect.poll(tipTarget).toBe('/ 3');
  });

  it('시나리오 REROLL은 APPLY 없이 바로 적용된다', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SCENARIO' }));
    const seedText = () => document.querySelector('.seed-value')?.textContent;
    await expect.poll(seedText).toMatch(/^\d+$/);
    const before = seedText();
    await userEvent.click(button(/REROLL/));
    await expect.poll(seedText).not.toBe(before);
    await expect.element(button('APPLY')).toBeDisabled();
  });

  it('언어를 한국어로 바꾸면 화면 문구가 바뀌고, 다시 열어도 유지된다 (설정 자동 보관)', async () => {
    await userEvent.click(button('Open settings'));
    await userEvent.click(page.getByRole('tab', { name: 'SETTINGS' }));
    await userEvent.click(page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: '한국어' }));
    await expect.element(button('시작')).toBeVisible();

    unmount();
    mount();
    await expect.element(button('시작')).toBeVisible();
  });
});

describe('도움말', () => {
  it('? 버튼으로 열고 Esc로 닫는다', async () => {
    await userEvent.click(button('Help'));
    await expect.element(page.getByRole('dialog', { name: 'FTC TacticSim help' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: 'FTC TacticSim help' })).not.toBeInTheDocument();
  });
});

// 경기 파일 글자: 중립 입력(틱마다 정지)으로 진행한 가지들 — 같은 입력이라 모든 가지가 원본 타임라인의 앞부분과 같다
function neutralRecipeText(branches: { number: number; parent: number | null; forkTick: number; name: string | null; headTick: number }[], current: number): string {
  const setup = setupFromDrafts(DEFAULT_DRAFT_VALUES);
  const engine = new SimulationEngine(setup.r1Config, setup.r2Config, setup.shotJudge, 'RED', setup.scenario, setup.shooters);
  engine.runFullMatch();
  const neutral = { robot1: new Int8Array(MATCH_TICKS * 4), robot2: new Int8Array(MATCH_TICKS * 4) };
  return serializeMatchRecipe(
    buildMatchRecipe({
      setup: DEFAULT_DRAFT_VALUES,
      branches: branches.map(({ headTick, ...b }) => ({ ...b, inputs: neutral, record: timelineRecord(engine.timeline.slice(0, headTick + 1)) })),
      current,
      nextNumber: Math.max(...branches.map(b => b.number)) + 1,
      createdAt: new Date(),
    }),
  );
}

// 파일 선택창 가로채기: 주어진 글자를 고른 것으로. 반환 = 되돌리기
function interceptFilePick(text: string): () => void {
  const inputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    if (this.type !== 'file') return inputClick.call(this);
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'match.json', { type: 'application/json' }));
    this.files = transfer.files;
    this.dispatchEvent(new Event('change'));
  };
  return () => {
    HTMLInputElement.prototype.click = inputClick;
  };
}

// 경기 전 화면 → SETTINGS 탭 경기 줄 IMPORT → 확인창(가지 수) Enter
async function importMatchFile(branchCount: number): Promise<void> {
  await expect.element(button('START')).toBeEnabled();
  await userEvent.click(button('Open settings'));
  await userEvent.click(page.getByRole('tab', { name: 'SETTINGS' }));
  await userEvent.click(page.getByRole('button', { name: 'IMPORT', exact: true }).last());
  await expect.poll(() => document.querySelector('[role="alertdialog"]')?.textContent ?? '').toContain(`Loads ${branchCount} branches.`);
  await userEvent.keyboard('{Enter}');
}

describe('경기 흐름', () => {
  it('START → 진행 → Space 일시정지 → 되감기 → BRANCH 확인창(Esc 취소) → NEW 확인(Enter) → 경기 전', async () => {
    await userEvent.click(button('START'));
    await expect.element(button('PAUSE'), { timeout: 5000 }).toBeVisible(); // 보기 회전 700 ms 뒤 진행
    await new Promise(r => setTimeout(r, 600)); // 몇 십 틱 진행

    await userEvent.keyboard(' ');
    await expect.element(button('RESUME')).toBeVisible(); // 보는 틱 = 머리

    await userEvent.click(button('Back 1 tick'));
    await expect.element(button('BRANCH')).toBeVisible(); // 보는 틱 < 머리
    await userEvent.click(button('BRANCH'));
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(button('BRANCH')).toBeVisible(); // 취소하면 그대로 일시정지

    await userEvent.click(button('NEW'));
    await expect.element(page.getByRole('alertdialog')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect.element(button('START'), { timeout: 5000 }).toBeEnabled(); // 관중석으로 회전 뒤 경기 전
    await expect.poll(timerText).toBe('2:00');
  });

  it('경기 파일 (15-3): 가지 목록 EXPORT MATCH = 트리 전체(미종료 포함) → NEW → 경기 줄 IMPORT(가지 수 확인) → 재계산 → 보던 가지 머리에서 일시정지', async () => {
    // 다운로드 / 파일 선택창 가로채기: 내려받은 글자를 그대로 불러오기 파일로 돌려준다
    let saved: { name: string; text: Promise<string> } | null = null;
    const createObjectURL = URL.createObjectURL;
    const anchorClick = HTMLAnchorElement.prototype.click;
    const inputClick = HTMLInputElement.prototype.click;
    let lastBlob: Blob | null = null;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      lastBlob = blob as Blob;
      return 'blob:test';
    };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (lastBlob) saved = { name: this.download, text: lastBlob.text() };
    };
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type !== 'file' || !saved) return inputClick.call(this);
      void saved.text.then(text => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], saved!.name, { type: 'application/json' }));
        this.files = transfer.files;
        this.dispatchEvent(new Event('change'));
      });
    };
    try {
      // 원본을 조금 진행 → 1틱 되감아 가지 2 → 가지 2를 조금 진행하고 일시정지 (미종료)
      await userEvent.click(button('START'));
      await expect.element(button('PAUSE'), { timeout: 5000 }).toBeVisible();
      await new Promise(r => setTimeout(r, 600));
      await userEvent.keyboard(' ');
      await userEvent.click(button('Back 1 tick'));
      await userEvent.click(button('BRANCH'));
      await userEvent.keyboard('{Enter}');
      await expect.element(button('PAUSE'), { timeout: 5000 }).toBeVisible();
      await new Promise(r => setTimeout(r, 300));
      await userEvent.keyboard(' ');
      await expect.element(button('RESUME')).toBeVisible();
      const head = timerText();

      // 가지 목록 아래 EXPORT MATCH → 메뉴가 닫히고 파일 이름 = 머리 남은 시간 + _b2 + _2br
      await userEvent.click(page.getByRole('button', { name: /Branch 2/ }));
      await userEvent.click(button('EXPORT MATCH'));
      await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
      expect(saved).not.toBeNull();
      expect(saved!.name).toMatch(new RegExp(`^tacticsim-match_\\d{8}-\\d{4}_(RED|BLUE)_${head!.replace(':', '-')}_b2_2br\\.json$`));
      const file = JSON.parse(await saved!.text);
      expect(file.branches).toHaveLength(2);
      expect(file.current).toBe(2);

      // NEW → 경기 전 → 경기 줄 IMPORT → 확인창에 가지 수 → Enter
      await userEvent.click(button('NEW'));
      await userEvent.keyboard('{Enter}');
      await expect.element(button('START'), { timeout: 5000 }).toBeEnabled();
      await userEvent.click(button('Open settings'));
      await userEvent.click(page.getByRole('tab', { name: 'SETTINGS' }));
      await userEvent.click(page.getByRole('button', { name: 'IMPORT', exact: true }).last()); // 맨 아래 경기(MATCH) 줄
      await expect.poll(() => document.querySelector('[role="alertdialog"]')?.textContent ?? '').toContain('Loads 2 branches.');
      await userEvent.keyboard('{Enter}');

      // 재계산 → 보던 가지(가지 2)의 머리에서 일시정지, 체크섬 일치(배너 없음), 목록에 가지 2개
      await expect.element(button('RESUME'), { timeout: 10000 }).toBeVisible();
      await expect.poll(timerText).toBe(head);
      await expect.element(page.getByRole('button', { name: /Branch 2/ })).toBeVisible();
      expect(document.body.textContent).not.toContain('Results differ from the file');
      await userEvent.click(page.getByRole('button', { name: /Branch 2/ }));
      await expect.element(page.getByRole('menu')).toBeVisible();
      expect(page.getByRole('menuitemradio').elements()).toHaveLength(2);
    } finally {
      URL.createObjectURL = createObjectURL;
      HTMLAnchorElement.prototype.click = anchorClick;
      HTMLInputElement.prototype.click = inputClick;
    }
  });

  it('결과 팝업 가지 비교 (16-1): 종료한 가지 2개 경기 파일 IMPORT → RESULT → 비교 칩을 누르면 팝업이 열린 채 그 가지로 전환 → REVIEW = 그 가지 복기', async () => {
    // 끝까지 간 원본 + 3000틱에서 갈라 끝까지 간 가지 2 "Plan B" (지금 가지)
    const restore = interceptFilePick(
      neutralRecipeText(
        [
          { number: 1, parent: null, forkTick: 0, name: null, headTick: 6000 },
          { number: 2, parent: 1, forkTick: 3000, name: 'Plan B', headTick: 6000 },
        ],
        2,
      ),
    );
    try {
      await importMatchFile(2);
      await expect.element(button('RESULT'), { timeout: 10000 }).toBeEnabled(); // 종료한 지금 가지 = 복기
      expect(document.body.textContent).not.toContain('Results differ from the file');

      await userEvent.click(button('RESULT'));
      const popup = page.getByRole('dialog');
      await expect.element(popup).toBeVisible();
      const header = () => document.querySelector('.result-branch')?.textContent;
      const currentChip = () => document.querySelector('.result-compare-chip[aria-current="true"] .result-compare-name')?.textContent;
      expect(header()).toBe('Plan B');
      expect(currentChip()).toBe('Plan B');

      // 원본 칩 → 팝업은 그대로, 헤더 / 강조 칩이 원본으로
      await userEvent.click(popup.getByRole('button', { name: /Main/ }));
      await expect.poll(header).toBe('Main');
      expect(currentChip()).toBe('Main');
      await expect.element(popup).toBeVisible();
      // 지금 가지 칩을 다시 눌러도 그대로
      await userEvent.click(popup.getByRole('button', { name: /Main/ }));
      expect(header()).toBe('Main');

      // REVIEW → 원본 복기 (가지 목록 버튼 = 원본)
      await userEvent.click(button('REVIEW'));
      await expect.element(popup).not.toBeInTheDocument();
      await expect.element(page.getByRole('button', { name: /Main/ })).toBeVisible();
    } finally {
      restore();
    }
  });

  it('가지 전환 재계산 (16-2): 다른 가지는 프레임 없이 보관 → 전환 / 지금 가지 삭제 때 "가지 계산 중"을 먼저 보이고 다시 계산해 전환', async () => {
    // 1 (끝) ─(100) 2 (끝, 지금 가지) / ─(50) 3 (3000틱까지)
    const restore = interceptFilePick(
      neutralRecipeText(
        [
          { number: 1, parent: null, forkTick: 0, name: null, headTick: 6000 },
          { number: 2, parent: 1, forkTick: 100, name: null, headTick: 6000 },
          { number: 3, parent: 1, forkTick: 50, name: null, headTick: 3000 },
        ],
        2,
      ),
    );
    // 계산 중 표시는 계산 직전 한 프레임만 보이므로 DOM 변화로 기록
    let busySeen = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('.branch-busy')) busySeen = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const branchButton = (name: RegExp) => page.getByRole('button', { name, expanded: false });
    const pick = async (from: RegExp, to: RegExp) => {
      busySeen = false;
      await userEvent.click(branchButton(from));
      await userEvent.click(page.getByRole('menuitemradio', { name: to }));
      await expect.element(branchButton(to), { timeout: 5000 }).toBeVisible();
      expect(busySeen).toBe(true);
      expect(document.querySelector('.branch-busy')).toBeNull();
    };
    try {
      await importMatchFile(3);
      await expect.element(button('RESULT'), { timeout: 15000 }).toBeEnabled(); // 종료한 지금 가지 = 복기
      await pick(/Branch 2/, /Main/);       // 원본: 100틱부터 다시 계산
      await pick(/Main/, /Branch 3/);       // 미종료 가지: 50틱부터 3000틱까지
      await expect.element(button('RESULT')).toBeDisabled(); // 미종료 가지

      // 지금 가지(3) 삭제 → 부모(원본)로 전환하며 다시 계산
      busySeen = false;
      await userEvent.click(branchButton(/Branch 3/));
      await userEvent.click(page.getByRole('button', { name: 'Delete' }).last()); // 만든 순서 마지막 줄 = 가지 3
      await expect.element(page.getByRole('alertdialog')).toBeVisible();
      await userEvent.keyboard('{Enter}');
      await expect.element(page.getByRole('menuitemradio', { name: /Main/, checked: true }), { timeout: 5000 }).toBeVisible(); // 삭제 뒤 목록은 열린 채
      expect(page.getByRole('menuitemradio').elements()).toHaveLength(2);
      expect(busySeen).toBe(true);
      await userEvent.keyboard('{Escape}');
      await expect.element(branchButton(/Main/)).toBeVisible();
      await expect.element(button('RESULT')).toBeEnabled(); // 종료한 원본 = 복기
    } finally {
      observer.disconnect();
      restore();
    }
  });
});
