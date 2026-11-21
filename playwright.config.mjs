import { defineConfig } from '@playwright/test';

const roomPort = process.env.AFTERSHIFT_TEST_ROOM_PORT ?? '8787';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run preview -w @ashears/fighter-demo -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    },
    {
      command: 'node apps/demo/room-server.mjs',
      url: `http://127.0.0.1:${roomPort}/health`,
      env: { PORT: roomPort },
      reuseExistingServer: false,
    },
  ],
});
