import { defineConfig, devices } from '@playwright/test';

const port = 3017;
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: `node ./node_modules/next/dist/bin/next dev --webpack -p ${port}`,
    cwd: './apps/web',
    port,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop-hebrew',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile-hebrew', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
