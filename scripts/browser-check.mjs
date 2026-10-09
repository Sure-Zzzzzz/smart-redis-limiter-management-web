import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import process from 'node:process';

// Vite 由当前测试进程持有，避免 Windows 下 pnpm/cmd 子进程树清理挂起。
const server = await createServer({ define: { 'import.meta.env.VITE_LIMITER_PKCE_CLIENT_ID': JSON.stringify('mock-limiter-browser-pkce') }, server: { host: '127.0.0.1', port: 5182, strictPort: true } });
try {
  await server.listen();
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
} finally { await server.close(); }
