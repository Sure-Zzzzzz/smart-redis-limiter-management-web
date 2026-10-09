import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom', include: ['src/**/*.test.ts'],
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:5182' } },
    poolOptions: { threads: { singleThread: true } },
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.ts'], exclude: ['src/main.ts', 'src/**/*.test.ts'] }
  }
});
