import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/app/limiter-management/',
  plugins: [vue(), qiankun('limiter-management', { useDevMode: true })],
  server: { headers: { 'Access-Control-Allow-Origin': '*' }, watch: { ignored: ['**/coverage/**', '**/test-results/**', '**/dist/**'] } }
});
