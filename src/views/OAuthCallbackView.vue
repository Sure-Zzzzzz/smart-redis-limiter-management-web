<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ErrorState from '../components/ErrorState.vue';
import { handleLimiterOAuthCallback } from '../auth/pkce';
const errorMessage = ref('');
const controller = new AbortController();
onMounted(async () => {
  errorMessage.value = '';
  try {
    const silent = window.self !== window.top;
    const outcome = await handleLimiterOAuthCallback({ silent, signal: controller.signal });
    if (controller.signal.aborted) return;
    if (outcome.kind === 'authorized') {
      // qiankun 的回调挂载与菜单目标页之间使用顶层导航，避免壳路由吞掉成功回调。
      window.location.replace(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${outcome.target}`);
    } else if (outcome.kind === 'missing-params') errorMessage.value = '授权回调参数缺失，请从统一应用门户进入';
  } catch (error) {
    if (!controller.signal.aborted) errorMessage.value = error instanceof Error ? error.message : '授权失败';
  }
});
onUnmounted(() => controller.abort());
</script>
<template><main class="page"><h1>授权</h1><ErrorState v-if="errorMessage" :message="errorMessage" /><p v-else class="muted" role="status">正在完成授权…</p></main></template>
