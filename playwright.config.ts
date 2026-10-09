import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  use: { baseURL: 'http://127.0.0.1:5182', channel: 'chrome' },
  workers: 1
});
