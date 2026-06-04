import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_PORT = 5000;
const PREVIEW_PORT = 4173;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://cartly:cartlypass@localhost:5433/cartly_test?schema=public';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: path.resolve(__dirname, './e2e/global-setup.ts'),
  webServer: [
    {
      command: 'node ../backend/server.js',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET || 'e2e-secret',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'e2e-refresh',
        SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-session',
        FRONTEND_URL: `http://localhost:${PREVIEW_PORT}`,
      },
    },
    {
      command: `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      port: PREVIEW_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
