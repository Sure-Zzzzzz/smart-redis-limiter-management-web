<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { X, Trash2 } from 'lucide-vue-next';
defineProps<{ subject: string; submitting: boolean }>();
const emit = defineEmits<{ close: []; confirm: [] }>();
const dialog = ref<HTMLElement | null>(null);
let focus: HTMLElement | null = null;
let release = () => undefined as void;
onMounted(async () => {
  focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = document.body;
  const value = body.style.getPropertyValue('overflow');
  const priority = body.style.getPropertyPriority('overflow');
  const scroll = [window.scrollX, window.scrollY];
  const main = dialog.value?.closest('.limiter-management-app')?.querySelector<HTMLElement>('[data-page-content]');
  const inert = main?.inert ?? false;
  if (main) main.inert = true;
  body.style.setProperty('overflow', 'hidden');
  release = () => {
    if (value) body.style.setProperty('overflow', value, priority); else body.style.removeProperty('overflow');
    if (main) main.inert = inert;
    window.scrollTo(scroll[0], scroll[1]);
    if (focus?.isConnected) focus.focus();
  };
  await nextTick();
  dialog.value?.querySelector<HTMLButtonElement>('button')?.focus();
});
onUnmounted(() => release());
function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
  if (event.key !== 'Tab') return;
  const buttons = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])];
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first || !last) { event.preventDefault(); dialog.value?.focus(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
</script>
<template>
  <div class="modal-layer" @keydown="handleKey">
    <section ref="dialog" class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" tabindex="-1">
      <header><h2 id="delete-title">删除策略</h2><button class="icon-button" type="button" title="关闭" aria-label="关闭" :disabled="submitting" @click="emit('close')"><X :size="18" aria-hidden="true" /></button></header>
      <p id="delete-description">确认删除 <strong>{{ subject }}</strong> 的策略？</p>
      <footer><button class="button-secondary" type="button" :disabled="submitting" @click="emit('close')">取消</button><button class="button-danger" type="button" :disabled="submitting" @click="emit('confirm')"><Trash2 :size="16" aria-hidden="true" />{{ submitting ? '删除中…' : '删除' }}</button></footer>
    </section>
  </div>
</template>
