import { defineConfig } from '@playwright/test';

const remote = process.env.BASE_URL;
export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: ['chromium', 'firefox', 'webkit'].map(name => ({ name, use: { browserName: name as 'chromium' | 'firefox' | 'webkit', launchOptions: name === 'chromium' ? { args: ['--enable-unsafe-swiftshader'] } : {} } })),
  use: {
    actionTimeout: 15000,
    baseURL: remote || 'http://127.0.0.1:4174/cuemol-wasm/',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: remote ? undefined : {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:4174/cuemol-wasm/',
    reuseExistingServer: !process.env.CI,
  },
});
