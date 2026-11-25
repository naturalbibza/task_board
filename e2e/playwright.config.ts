import { defineConfig, devices } from '@playwright/test';

/**
 * E2E по требованию (NFR-14): перед запуском поднимите `pnpm dev`.
 * Адрес можно переопределить: E2E_BASE_URL=http://localhost:5173 pnpm e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
// Локально — установленный Edge; в CI — скачанный Chromium (channel не задаём).
const channel = process.env.CI ? undefined : ('msedge' as const);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'ru-RU',
  },
  projects: [
    {
      name: 'chromium',
      // Локально используем установленный Edge (не нужен скачиваемый Chromium);
      // в CI channel не задаётся — Playwright берёт установленный Chromium.
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
  ],
});
