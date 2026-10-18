import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// 테스트 프로젝트 2개 (명세서 3.7 테스트):
// - unit: 순수 함수 Vitest (Node). `npm test`
// - browser: 실제 Chromium에서 화면 상호작용 / Web Worker / IndexedDB 점검 (*.browser.test.ts(x)). `npm run test:browser`
//   Playwright가 쓰는 Chromium이 필요하다 (처음 한 번 `npx playwright install chromium`).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: ['src/**/*.browser.test.{ts,tsx}'],
          },
        },
        {
          extends: true,
          // 실행 중 의존성 재최적화로 React가 두 벌 로드되지 않도록 미리 묶음
          optimizeDeps: {
            include: ['react', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'lucide-react'],
          },
          test: {
            name: 'browser',
            include: ['src/**/*.browser.test.{ts,tsx}'],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              // 화면 설계 기준 크기 (3.8항 최소 1366 × 768, 창 안쪽 가용 약 1366 × 650)
              viewport: { width: 1366, height: 650 },
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
    },
  }),
)
