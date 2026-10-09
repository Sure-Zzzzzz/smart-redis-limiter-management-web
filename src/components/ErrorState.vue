<script setup lang="ts">
import { CircleAlert, RotateCw } from 'lucide-vue-next';
defineProps<{ message: string; retryable?: boolean }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div class="notice danger" role="alert">
    <CircleAlert :size="18" aria-hidden="true" />
    <span>{{ message }}</span>
    <button v-if="retryable" class="button-secondary" type="button" @click="$emit('retry')"><RotateCw :size="16" aria-hidden="true" />重试</button>
  </div>
</template>
