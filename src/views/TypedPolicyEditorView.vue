<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Save, Trash2, Power } from 'lucide-vue-next';
import { loadCapabilities, PolicyApiError, type Capabilities, type PolicyLimit } from '../api/policies';
import {
  createTypedRule, deleteTypedRule, loadDeclaration, loadDirectoryObjects, loadTypedRule, loadTypedServices,
  setTypedRuleState, updateTypedRule, DIMENSION_LABELS, VIEW_DIMENSIONS,
  type DirectoryObject, type ServiceDeclaration, type ServiceSummary, type TypedDimension, type TypedRule
} from '../api/typedPolicies';
import ErrorState from '../components/ErrorState.vue';
import LimitEditor from '../components/LimitEditor.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const ruleId = computed(() => (route.params.id as string | undefined) ?? null);
const isCreate = computed(() => ruleId.value === null);
const viewKey = computed(() => (route.query.view as string | undefined) ?? 'resources');
const title = computed(() => ({
  resources: '资源限流', ips: 'IP 限流', subjects: '主体限流', customers: '客户限流', custom: '自定义限流'
}[viewKey.value] ?? '限流规则'));

const rule = ref<TypedRule | null>(null);
const capabilities = ref<Capabilities | null>(null);
const services = ref<ServiceSummary[]>([]);
const declaration = ref<ServiceDeclaration | null>(null);
const objectOptions = ref<DirectoryObject[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const forbidden = ref(false);
const submitting = ref(false);
const deleting = ref(false);
const conflict = ref(false);
const savedMessage = ref('');

const dimensions = computed<TypedDimension[]>(() =>
  rule.value ? [rule.value.dimension] : (VIEW_DIMENSIONS[viewKey.value] ?? ['RESOURCE']));
const isSubjects = computed(() => dimensions.value.length > 1);

const form = reactive({
  serviceCode: '', resourceCode: '', dimension: 'RESOURCE' as TypedDimension,
  selector: 'DEFAULT' as 'DEFAULT' | 'EXACT', objectId: '', customType: '',
  enabled: true, limits: [{ count: 100, window: 1, unit: 'MINUTES' }] as PolicyLimit[]
});
let sequence = 0;
let controller: AbortController | null = null;
function cancel(): void { sequence += 1; controller?.abort(); }

async function loadAll(): Promise<void> {
  cancel();
  const own = sequence;
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  errorMessage.value = '';
  try {
    if (!capabilities.value) capabilities.value = await loadCapabilities('', signal);
    if (own !== sequence) return;
    if (!capabilities.value.pageAllowed) { forbidden.value = true; return; }
    if (isCreate.value) {
      services.value = await loadTypedServices(signal);
      if (own !== sequence) return;
      if (services.value.length) {
        form.serviceCode = services.value[0].serviceCode;
        await loadDecl(signal);
      }
      form.dimension = dimensions.value[0];
      form.selector = form.dimension === 'RESOURCE' ? 'DEFAULT' : 'DEFAULT';
    } else {
      const loaded = await loadTypedRule(ruleId.value as string, signal);
      if (own !== sequence) return;
      rule.value = loaded;
      Object.assign(form, {
        serviceCode: loaded.serviceCode, resourceCode: loaded.resourceCode,
        dimension: loaded.dimension, selector: loaded.selector,
        objectId: loaded.objectId ?? '', customType: loaded.customType ?? '',
        enabled: loaded.enabled, limits: loaded.limits.map(limit => ({ ...limit }))
      });
      services.value = [{ serviceCode: loaded.serviceCode, displayName: loaded.serviceCode }];
      declaration.value = {
        serviceCode: loaded.serviceCode, controlMode: 'TYPED_V2', displayName: loaded.serviceCode,
        resources: { [loaded.resourceCode]: [loaded.dimension] },
        namespaces: { [loaded.dimension]: loaded.namespace },
        customTypes: loaded.customType ? [loaded.customType] : []
      };
    }
  } catch (error) {
    if (own === sequence && !signal.aborted) {
      forbidden.value = error instanceof PolicyApiError && error.status === 403;
      errorMessage.value = error instanceof Error ? error.message : '加载失败';
    }
  } finally { if (own === sequence) loading.value = false; }
}

async function loadDecl(signal?: AbortSignal): Promise<void> {
  const own = sequence;
  const sig = signal ?? controller?.signal;
  if (!sig) return;
  if (!form.serviceCode) { declaration.value = null; objectOptions.value = []; return; }
  try {
    const decl = await loadDeclaration(form.serviceCode, sig);
    if (own !== sequence) return;
    declaration.value = decl;
    const available = Object.keys(decl.resources)
      .filter(code => dimensions.value.some(dimension => decl.resources[code]?.includes(dimension)));
    if (available.length && !available.includes(form.resourceCode)) form.resourceCode = available[0];
    if (!available.includes(form.resourceCode)) form.resourceCode = '';
    if (['customers', 'custom'].includes(viewKey.value) && form.dimension) {
      const customType = form.dimension === 'CUSTOM' ? (form.customType || decl.customTypes[0] || '') : null;
      objectOptions.value = await loadDirectoryObjects(form.serviceCode, form.dimension, customType, '', sig);
    }
  } catch (error) {
    if (own === sequence && !(error instanceof PolicyApiError && (error.status === 403 || error.status === 404))) {
      errorMessage.value = error instanceof Error ? error.message : '目录加载失败';
    }
  }
}

const resourceOptions = computed(() => {
  const decl = declaration.value;
  if (!decl) return [];
  return Object.keys(decl.resources)
    .filter(code => decl.resources[code]?.includes(form.dimension));
});
const namespace = computed(() => declaration.value?.namespaces[form.dimension] ?? '');
const selectorLocked = computed(() => form.dimension === 'RESOURCE');
const objectIsDirectory = computed(() => form.dimension === 'CUSTOMER' && form.selector === 'EXACT');

async function changeService(): Promise<void> { form.resourceCode = ''; await loadDecl(); }
function changeDimension(): void {
  form.selector = 'DEFAULT';
  form.objectId = '';
  form.customType = form.dimension === 'CUSTOM' ? (declaration.value?.customTypes[0] ?? '') : '';
  void loadDecl();
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  conflict.value = false;
  errorMessage.value = '';
  savedMessage.value = '';
  try {
    if (isCreate.value) {
      const body = {
        serviceCode: form.serviceCode, resourceCode: form.resourceCode, dimension: form.dimension,
        selector: form.selector, namespace: namespace.value,
        customType: form.dimension === 'CUSTOM' ? form.customType : undefined,
        objectId: form.selector === 'EXACT' ? form.objectId : undefined,
        enabled: form.enabled, limits: form.limits
      };
      const result = await createTypedRule(body);
      router.replace(`/policies/typed/${result.rule?.id ?? ''}?view=${viewKey.value}`);
      savedMessage.value = '规则已创建';
      await loadAll();
    } else {
      await updateTypedRule(Number(ruleId.value), rule.value?.rowVersion ?? 0, form.limits);
      savedMessage.value = '规则已保存';
      await loadAll();
    }
  } catch (error) {
    if (error instanceof PolicyApiError && error.status === 409) {
      conflict.value = true;
      errorMessage.value = '规则已被其他操作修改，请重新读取后比较';
    } else {
      errorMessage.value = error instanceof Error ? error.message : '保存失败';
    }
  } finally { submitting.value = false; }
}
async function toggleState(): Promise<void> {
  if (!rule.value || submitting.value) return;
  submitting.value = true;
  conflict.value = false;
  try {
    await setTypedRuleState(rule.value.id, rule.value.rowVersion, !rule.value.enabled);
    savedMessage.value = rule.value.enabled ? '规则已停用' : '规则已启用';
    await loadAll();
  } catch (error) {
    if (error instanceof PolicyApiError && error.status === 409) {
      conflict.value = true;
      errorMessage.value = '规则已被其他操作修改，请重新读取后比较';
    } else {
      errorMessage.value = error instanceof Error ? error.message : '操作失败';
    }
  } finally { submitting.value = false; }
}
async function confirmDelete(): Promise<void> {
  if (!rule.value) return;
  submitting.value = true;
  conflict.value = false;
  try {
    await deleteTypedRule(rule.value.id, rule.value.rowVersion);
    router.replace(`/policies/${viewKey.value}`);
  } catch (error) {
    if (error instanceof PolicyApiError && error.status === 409) {
      conflict.value = true;
      errorMessage.value = '规则已被其他操作修改，请重新读取后比较';
    } else {
      errorMessage.value = error instanceof Error ? error.message : '删除失败';
    }
    submitting.value = false;
    deleting.value = false;
  }
}
onMounted(() => void loadAll());
onUnmounted(cancel);
</script>
<template>
  <main class="page" data-page-content>
    <header class="page-header">
      <div class="title-line">
        <RouterLink class="icon-button" :to="`/policies/${viewKey}`" aria-label="返回列表" title="返回列表"><ArrowLeft :size="20" aria-hidden="true" /></RouterLink>
        <h1>{{ isCreate ? `新建${title}规则` : '规则详情' }}</h1>
        <span v-if="rule" class="status-badge" :class="rule.enabled ? 'success' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span>
      </div>
      <div v-if="rule && capabilities?.canWrite" class="commands">
        <button class="button-secondary" type="button" :disabled="submitting || conflict" @click="() => void toggleState()"><Power :size="16" aria-hidden="true" />{{ rule.enabled ? '停用' : '启用' }}</button>
        <button class="icon-button danger" type="button" title="删除规则" aria-label="删除规则" :disabled="submitting || conflict" @click="deleting = true"><Trash2 :size="18" aria-hidden="true" /></button>
      </div>
    </header>
    <div v-if="forbidden" class="empty-state"><h2>无权访问限流策略</h2><p>请联系应用管理员确认授权。</p></div>
    <template v-else>
      <p v-if="loading" class="loading-state" role="status">正在加载规则…</p>
      <ErrorState v-else-if="errorMessage && !rule" :message="errorMessage" retryable @retry="() => void loadAll()" />
      <template v-else>
        <p v-if="savedMessage && !errorMessage" class="success-note" role="status">{{ savedMessage }}</p>
        <ErrorState v-if="errorMessage" :message="errorMessage" retryable @retry="() => void loadAll()" />
        <form class="drawer-form" @submit.prevent="() => void submit()">
          <section class="assignment-section">
            <div class="section-heading"><h2>规则标识</h2></div>
            <div class="form-grid">
              <label>服务
                <select v-model="form.serviceCode" :disabled="!isCreate" @change="() => void changeService()">
                  <option v-for="service in services" :key="service.serviceCode" :value="service.serviceCode">{{ service.displayName }}</option>
                </select>
              </label>
              <label>资源
                <select v-model="form.resourceCode" :disabled="!isCreate">
                  <option v-if="isCreate && !resourceOptions.length" value="">该服务未声明可用资源</option>
                  <option v-for="code in resourceOptions" :key="code" :value="code">{{ code }}</option>
                </select>
              </label>
              <label>计数类别
                <select v-model="form.dimension" :disabled="!isCreate || !isSubjects" @change="changeDimension">
                  <option v-for="dimension in dimensions" :key="dimension" :value="dimension">{{ DIMENSION_LABELS[dimension] }}</option>
                </select>
              </label>
              <label v-if="form.dimension === 'CUSTOM'">自定义类型
                <select v-model="form.customType" :disabled="!isCreate">
                  <option v-for="code in declaration?.customTypes ?? []" :key="code" :value="code">{{ code }}</option>
                </select>
              </label>
              <label>范围
                <select v-model="form.selector" :disabled="!isCreate || selectorLocked">
                  <option value="DEFAULT">默认额度（每个对象各自计数）</option>
                  <option value="EXACT" :disabled="selectorLocked">精确对象（单独覆盖额度）</option>
                </select>
              </label>
              <label v-if="form.selector === 'EXACT' && form.dimension === 'IP'">IP 地址<input v-model="form.objectId" :disabled="!isCreate" maxlength="45" placeholder="如 203.0.113.7" required></label>
              <label v-else-if="form.selector === 'EXACT' && objectIsDirectory">客户
                <select v-model="form.objectId" :disabled="!isCreate">
                  <option value="">请选择客户</option>
                  <option v-for="object in objectOptions" :key="object.id" :value="object.id">{{ object.name ?? object.id }}</option>
                </select>
              </label>
              <label v-else-if="form.selector === 'EXACT'">对象标识<input v-model="form.objectId" :disabled="!isCreate" maxlength="256" placeholder="稳定对象 ID" required></label>
              <label>命名空间<input :value="namespace || '—'" disabled title="由服务目录声明"></label>
            </div>
          </section>
          <section class="assignment-section">
            <div class="section-heading"><h2>启停</h2></div>
            <label class="checkbox-field"><input v-model="form.enabled" type="checkbox" :disabled="!isCreate">启用该规则（停用不取消其他门禁）</label>
          </section>
          <LimitEditor v-model="form.limits" :disabled="!capabilities?.canWrite" />
          <div v-if="capabilities?.canWrite" class="form-actions">
            <button class="button-primary" type="submit" :disabled="submitting || conflict || (isCreate && (!form.serviceCode || !form.resourceCode))"><Save :size="16" aria-hidden="true" />{{ isCreate ? '创建规则' : '保存' }}</button>
          </div>
        </form>
      </template>
    </template>
    <ConfirmDialog v-if="deleting && rule" :subject="`${rule.serviceCode} / ${rule.resourceCode} / ${DIMENSION_LABELS[rule.dimension]}`" :submitting="submitting" @close="deleting = false" @confirm="() => void confirmDelete()" />
  </main>
</template>
