import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 3,
  forbidOnly: !!process.env.CI,
  use: { baseURL: 'http://127.0.0.1:4178/Dials/', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178/Dials/',
    reuseExistingServer: !process.env.CI,
  },
});
