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
});
