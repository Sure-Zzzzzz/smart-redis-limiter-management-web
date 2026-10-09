<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { ArrowLeft, Save, Trash2, Power, RotateCw, Check } from 'lucide-vue-next';
import { loadCapabilities, loadPolicy, mutatePolicy, PolicyApiError, type Policy, type PolicyLimit } from '../api/policies';
import { CODE_PATTERN, validatePolicyForm } from '../policyForm';
import ErrorState from '../components/ErrorState.vue';
import LimitEditor from '../components/LimitEditor.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
const route = useRoute();
const router = useRouter();
const isCreate = computed(() => route.path === '/policies/new');
const policy = ref<Policy | null>(null);
const form = reactive({ serviceCode: '', resourceCode: '', subject: '', enabled: true, limits: [{ count: 100, window: 1, unit: 'MINUTES' }] as PolicyLimit[] });
const loading = ref(true);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const forbidden = ref(false);
const pageAllowed = ref(false);
const canWrite = ref(false);
const checkingPermission = ref(false);
const conflict = ref(false);
const latest = ref<Policy | null>(null);
const deleting = ref(false);
const baseline = ref('');
const dirty = computed(() => JSON.stringify(form.limits) !== baseline.value);
let sequence = 0;
let permissionSequence = 0;
let controller: AbortController | null = null;
let permissionController: AbortController | null = null;
let permissionTimer: number | undefined;
let disposed = false;

function cloneLimits(limits: PolicyLimit[]): PolicyLimit[] { return limits.map(limit => ({ ...limit })); }
function applyPolicy(value: Policy): void {
  policy.value = value;
  Object.assign(form, value.key, { enabled: value.enabled, limits: cloneLimits(value.limits) });
  baseline.value = JSON.stringify(value.limits);
}
function cancel(): void {
  sequence += 1;
  permissionSequence += 1;
  controller?.abort();
  permissionController?.abort();
  window.clearTimeout(permissionTimer);
}
async function loadEditor(): Promise<void> {
  cancel();
  const own = sequence;
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  errorMessage.value = '';
  message.value = '';
  forbidden.value = false;
  pageAllowed.value = false;
  canWrite.value = false;
  policy.value = null;
  latest.value = null;
  conflict.value = false;
  deleting.value = false;
  submitting.value = false;
  Object.assign(form, { serviceCode: '', resourceCode: '', subject: '', enabled: true, limits: [{ count: 100, window: 1, unit: 'MINUTES' }] });
  baseline.value = JSON.stringify(form.limits);
  try {
    const gate = await loadCapabilities('', signal);
    if (own !== sequence) return;
    pageAllowed.value = gate.pageAllowed;
    if (!gate.pageAllowed) { forbidden.value = true; return; }
    if (!isCreate.value) {
      const result = await loadPolicy(String(route.params.id), signal);
      if (own !== sequence) return;
      applyPolicy(result);
      const scoped = await loadCapabilities(result.key.serviceCode, signal);
      if (own !== sequence) return;
      canWrite.value = scoped.pageAllowed && scoped.canWrite;
      forbidden.value = !scoped.pageAllowed;
    }
  } catch (error) {
    if (own === sequence && !signal.aborted) {
      forbidden.value = error instanceof PolicyApiError && error.status === 403;
      errorMessage.value = error instanceof Error ? error.message : '加载失败';
    }
  } finally { if (own === sequence) loading.value = false; }
}

async function loadWriteCapability(code: string, own: number): Promise<void> {
  permissionController = new AbortController();
  const signal = permissionController.signal;
  try {
    const result = await loadCapabilities(code, signal);
    if (own === permissionSequence && code === form.serviceCode && !disposed) canWrite.value = result.pageAllowed && result.canWrite;
  } catch (error) {
    if (own === permissionSequence && !signal.aborted && !disposed) errorMessage.value = error instanceof Error ? error.message : '权限检查失败';
  } finally { if (own === permissionSequence && !disposed) checkingPermission.value = false; }
}
watch(() => form.serviceCode, code => {
  if (!isCreate.value) return;
  canWrite.value = false;
  permissionSequence += 1;
  permissionController?.abort();
  window.clearTimeout(permissionTimer);
  checkingPermission.value = false;
  if (!pageAllowed.value || !CODE_PATTERN.test(code)) return;
  checkingPermission.value = true;
  const own = permissionSequence;
  permissionTimer = window.setTimeout(() => void loadWriteCapability(code, own), 250);
}, { flush: 'sync' });
watch(() => route.fullPath, () => void loadEditor(), { immediate: true });

async function submitSave(): Promise<void> {
  if (submitting.value || !canWrite.value || checkingPermission.value || conflict.value) return;
  errorMessage.value = '';
  message.value = '';
  const validation = validatePolicyForm(form.serviceCode, form.resourceCode, form.subject, form.limits);
  if (validation) { errorMessage.value = validation; return; }
  const own = sequence;
  const signal = controller?.signal;
  submitting.value = true;
  try {
    const result = isCreate.value
      ? await mutatePolicy('', 'POST', { key: { serviceCode: form.serviceCode, resourceCode: form.resourceCode, subject: form.subject }, limits: cloneLimits(form.limits), enabled: form.enabled }, signal)
      : await mutatePolicy(`/${policy.value?.id}`, 'PUT', { expectedRowVersion: policy.value?.rowVersion, limits: cloneLimits(form.limits) }, signal);
    if (own !== sequence || disposed) return;
    if (!result.policy) throw new PolicyApiError(0, '接口未返回策略');
    if (isCreate.value) await router.replace(`/policies/${result.policy.id}`);
    else { applyPolicy(result.policy); message.value = result.changed ? '策略已保存' : '策略未变化'; }
  } catch (error) {
    if (own === sequence && !disposed && !signal?.aborted) {
      conflict.value = error instanceof PolicyApiError && error.status === 409 && !isCreate.value;
      errorMessage.value = error instanceof Error ? error.message : '保存失败';
    }
  } finally { if (own === sequence && !disposed) submitting.value = false; }
}
async function submitState(): Promise<void> {
  if (!policy.value || !canWrite.value || submitting.value || conflict.value || dirty.value) return;
  const own = sequence;
  const signal = controller?.signal;
  errorMessage.value = '';
  message.value = '';
  submitting.value = true;
  try {
    const result = await mutatePolicy(`/${policy.value.id}`, 'PATCH', { expectedRowVersion: policy.value.rowVersion, enabled: !policy.value.enabled }, signal);
    if (own !== sequence || disposed) return;
    if (!result.policy) throw new PolicyApiError(0, '接口未返回策略');
    applyPolicy(result.policy);
    message.value = result.policy.enabled ? '策略已启用' : '策略已停用';
  } catch (error) {
    if (own === sequence && !disposed && !signal?.aborted) { conflict.value = error instanceof PolicyApiError && error.status === 409; errorMessage.value = error instanceof Error ? error.message : '操作失败'; }
  } finally { if (own === sequence && !disposed) submitting.value = false; }
}
async function submitDelete(): Promise<void> {
  if (!policy.value || !canWrite.value || submitting.value || conflict.value) return;
  const own = sequence;
  const signal = controller?.signal;
  errorMessage.value = '';
  message.value = '';
  submitting.value = true;
  try {
    await mutatePolicy(`/${policy.value.id}?expectedRowVersion=${policy.value.rowVersion}`, 'DELETE', undefined, signal);
    if (own !== sequence || disposed) return;
    deleting.value = false;
    await router.replace('/policies');
  } catch (error) {
    if (own === sequence && !disposed && !signal?.aborted) { deleting.value = false; conflict.value = error instanceof PolicyApiError && error.status === 409; errorMessage.value = error instanceof Error ? error.message : '删除失败'; }
  } finally { if (own === sequence && !disposed) submitting.value = false; }
}
async function loadLatest(): Promise<void> {
  if (!policy.value || submitting.value) return;
  const own = sequence;
  const signal = controller?.signal;
  errorMessage.value = '';
  submitting.value = true;
  try {
    const result = await loadPolicy(String(policy.value.id), signal);
    if (own !== sequence || disposed) return;
    latest.value = result;
  } catch (error) {
    if (own === sequence && !disposed && !signal?.aborted) errorMessage.value = error instanceof Error ? error.message : '读取失败';
  } finally { if (own === sequence && !disposed) submitting.value = false; }
}
function keepDraft(): void {
  if (!latest.value) return;
  policy.value = latest.value;
  form.enabled = latest.value.enabled;
  baseline.value = JSON.stringify(latest.value.limits);
  latest.value = null;
  conflict.value = false;
  errorMessage.value = '';
}
function useLatest(): void {
  if (!latest.value) return;
  applyPolicy(latest.value);
  latest.value = null;
  conflict.value = false;
  errorMessage.value = '';
}
onBeforeRouteLeave(() => { cancel(); return true; });
onUnmounted(() => { disposed = true; cancel(); });
</script>
<template>
  <div>
    <main class="page" data-page-content>
      <header class="page-header"><div class="title-line"><RouterLink class="icon-button" to="/policies" aria-label="返回策略列表" title="返回策略列表"><ArrowLeft :size="20" aria-hidden="true" /></RouterLink><h1>{{ isCreate ? '新建策略' : '策略详情' }}</h1><span v-if="policy" class="status-badge" :class="policy.enabled ? 'success' : 'neutral'">{{ policy.enabled ? '已启用' : '已停用' }}</span></div><div v-if="!isCreate && policy && canWrite" class="commands"><button class="button-secondary" type="button" :disabled="submitting || conflict || dirty" @click="() => void submitState()"><Power :size="16" aria-hidden="true" />{{ policy.enabled ? '停用' : '启用' }}</button><button class="icon-button danger" type="button" title="删除策略" aria-label="删除策略" :disabled="submitting || conflict" @click="deleting = true"><Trash2 :size="18" aria-hidden="true" /></button></div></header>
      <div v-if="forbidden" class="empty-state"><h2>无权访问限流策略</h2><p>请联系应用管理员确认授权。</p></div>
      <p v-else-if="loading" class="loading-state" role="status">正在加载策略…</p>
      <template v-else>
        <ErrorState v-if="errorMessage" :message="errorMessage" :retryable="!pageAllowed || (!isCreate && !policy)" @retry="() => void loadEditor()" />
        <p v-if="message" class="notice success" role="status"><Check :size="17" aria-hidden="true" />{{ message }}</p>
        <section v-if="conflict" class="conflict-panel">
          <h2>策略发生并发变更</h2><p>当前编辑内容已保留。</p><button class="button-secondary" type="button" :disabled="submitting" @click="() => void loadLatest()"><RotateCw :size="16" aria-hidden="true" />重新读取</button>
          <template v-if="latest"><h3>最新窗口 · 版本 {{ latest.rowVersion }}</h3><ul><li v-for="(limit, index) in latest.limits" :key="index">{{ limit.count }} 次 / {{ limit.window }} {{ ({ SECONDS: '秒', MINUTES: '分钟', HOURS: '小时', DAYS: '天' })[limit.unit] }}</li></ul><div class="commands"><button class="button-secondary" type="button" @click="useLatest">采用最新内容</button><button class="button-secondary" type="button" @click="keepDraft">保留当前编辑，使用最新版本</button></div></template>
        </section>
        <form v-if="pageAllowed && (isCreate || policy)" class="drawer-form" @submit.prevent="() => void submitSave()">
          <section class="assignment-section"><h2>策略标识</h2><div class="identity-fields"><label>服务编码<input v-model="form.serviceCode" maxlength="128" required :readonly="!isCreate" :disabled="submitting || (!isCreate && !canWrite)" placeholder="orders"></label><label>资源编码<input v-model="form.resourceCode" maxlength="128" required :readonly="!isCreate" :disabled="submitting || (!isCreate && !canWrite)" placeholder="create-order"></label><label>对象<input v-model="form.subject" maxlength="256" required :readonly="!isCreate" :disabled="submitting || (!isCreate && !canWrite)" placeholder="*"></label></div><label v-if="isCreate" class="checkbox-field"><input v-model="form.enabled" type="checkbox" :disabled="submitting">启用策略</label><dl v-if="policy" class="metadata"><div><dt>版本</dt><dd>{{ policy.rowVersion }}</dd></div><div><dt>创建时间</dt><dd>{{ new Date(policy.createdAt).toLocaleString() }}</dd></div><div><dt>更新时间</dt><dd>{{ new Date(policy.updatedAt).toLocaleString() }}</dd></div></dl></section>
          <LimitEditor v-model="form.limits" :disabled="submitting || (!isCreate && !canWrite)" />
          <footer class="form-footer"><span v-if="checkingPermission" class="muted" role="status">正在检查服务权限…</span><span v-else-if="isCreate && form.serviceCode && !canWrite" class="muted">没有该服务的写权限</span><button v-if="isCreate || canWrite" class="button-primary" type="submit" :disabled="!canWrite || checkingPermission || submitting || conflict || (!isCreate && !dirty)"><Save :size="16" aria-hidden="true" />{{ submitting ? '保存中…' : (isCreate ? '创建策略' : '保存') }}</button></footer>
        </form>
      </template>
    </main>
    <ConfirmDialog v-if="deleting && policy" :subject="`${policy.key.serviceCode} / ${policy.key.resourceCode} / ${policy.key.subject}`" :submitting="submitting" @close="() => { if (!submitting) deleting = false; }" @confirm="() => void submitDelete()" />
  </div>
</template>
