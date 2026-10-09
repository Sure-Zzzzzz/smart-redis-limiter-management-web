<script setup lang="ts">
import { portalState } from './state';
</script>
<template>
  <div class="limiter-management-app">
    <RouterView :key="portalState.sessionVersion" />
  </div>
</template>
