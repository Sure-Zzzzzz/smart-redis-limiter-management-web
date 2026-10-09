<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next';
import type { PolicyLimit, TimeUnit } from '../api/policies';
const props = defineProps<{ modelValue: PolicyLimit[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: PolicyLimit[]] }>();
const units: { value: TimeUnit; label: string }[] = [{ value: 'SECONDS', label: '秒' }, { value: 'MINUTES', label: '分钟' }, { value: 'HOURS', label: '小时' }, { value: 'DAYS', label: '天' }];
function updateLimit(index: number, key: 'window' | 'count' | 'unit', value: string): void {
  emit('update:modelValue', props.modelValue.map((limit, at) => at === index ? { ...limit, [key]: key === 'unit' ? value : Number(value) } : limit));
}
</script>
<template>
  <section class="assignment-section">
    <div class="section-heading"><h2>限额窗口</h2><button v-if="!disabled" class="button-secondary" type="button" :disabled="modelValue.length >= 16" @click="emit('update:modelValue', [...modelValue, { window: 1, unit: 'MINUTES', count: 100 }])"><Plus :size="16" aria-hidden="true" />添加窗口</button></div>
    <div class="window-labels"><span>时长</span><span>单位</span><span>请求上限</span><span></span></div>
    <div v-for="(limit, index) in modelValue" :key="index" class="window-row">
      <input :aria-label="`窗口 ${index + 1} 时长`" type="number" min="1" step="1" required :disabled="disabled" :value="limit.window" @input="updateLimit(index, 'window', ($event.target as HTMLInputElement).value)">
      <select :aria-label="`窗口 ${index + 1} 单位`" :disabled="disabled" :value="limit.unit" @change="updateLimit(index, 'unit', ($event.target as HTMLSelectElement).value)"><option v-for="unit in units" :key="unit.value" :value="unit.value">{{ unit.label }}</option></select>
      <input :aria-label="`窗口 ${index + 1} 请求上限`" type="number" min="1" step="1" required :disabled="disabled" :value="limit.count" @input="updateLimit(index, 'count', ($event.target as HTMLInputElement).value)">
      <button v-if="!disabled" class="icon-button danger" type="button" :disabled="modelValue.length <= 1" :title="`删除窗口 ${index + 1}`" :aria-label="`删除窗口 ${index + 1}`" @click="emit('update:modelValue', modelValue.filter((_, at) => at !== index))"><Trash2 :size="18" aria-hidden="true" /></button><span v-else></span>
    </div>
  </section>
</template>
