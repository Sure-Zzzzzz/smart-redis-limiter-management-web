<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Plus, Search, ChevronRight } from 'lucide-vue-next';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import ErrorState from '../components/ErrorState.vue';
import { loadCapabilities, PolicyApiError, type Capabilities } from '../api/policies';
import {
  DIMENSION_LABELS, loadDeclaration, loadDirectoryObjects, loadTypedRules, loadTypedServices, VIEW_DIMENSIONS, VIEW_HINTS,
  type DirectoryObject, type ServiceSummary, type TypedRule
} from '../api/typedPolicies';

const props = defineProps<{ view: string }>();

const title = computed(() => ({
  resources: '资源限流', ips: 'IP 限流', subjects: '主体限流', customers: '客户限流', custom: '自定义限流'
}[props.view] ?? '限流策略'));
const dimensions = computed(() => VIEW_DIMENSIONS[props.view] ?? []);
const showDimensionColumn = computed(() => dimensions.value.length > 1);
/** 客户/自定义/IP 视图支持按对象目录检索；主体视图按对象文本过滤 */
const objectDirectoryMode = computed(() => ['customers', 'custom'].includes(props.view));

const filterForm = reactive({ serviceCode: '', resourceCode: '', objectId: '', enabled: '' });
const applied = reactive({ ...filterForm });
const rules = ref<TypedRule[]>([]);
const currentPage = ref(1);
const total = ref(0);
const totalPages = ref(0);
const pageSize = ref(20);
const loading = ref(true);
const errorMessage = ref('');
const forbidden = ref(false);
const capabilities = ref<Capabilities | null>(null);
const services = ref<ServiceSummary[]>([]);
const resources = ref<string[]>([]);
const objectOptions = ref<DirectoryObject[]>([]);
let sequence = 0;
let controller: AbortController | null = null;
function cancel(): void { sequence += 1; controller?.abort(); }

async function loadDirectory(signal: AbortSignal): Promise<void> {
  const own = sequence;
  try {
    if (!services.value.length) services.value = await loadTypedServices(signal);
    if (own !== sequence) return;
    const selected = applied.serviceCode || (services.value[0]?.serviceCode ?? '');
    if (selected) {
      const declaration = await loadDeclaration(selected, signal);
      if (own !== sequence) return;
      resources.value = Object.keys(declaration.resources)
        .filter(code => dimensions.value.some(dimension => declaration.resources[code]?.includes(dimension)));
      if (objectDirectoryMode.value) {
        const dimension = dimensions.value[0];
        const customType = props.view === 'custom' ? (declaration.customTypes[0] ?? '') : null;
        objectOptions.value = await loadDirectoryObjects(selected, dimension, customType, '', signal);
      }
    } else {
      resources.value = [];
      objectOptions.value = [];
    }
  } catch (error) {
    if (own === sequence && !(error instanceof PolicyApiError && error.status === 403)) {
      // 目录加载失败不阻断列表（筛选退化为手输）
    }
  }
}

async function loadList(): Promise<void> {
  cancel();
  const own = sequence;
  controller = new AbortController();
  const signal = controller.signal;
  errorMessage.value = '';
  loading.value = true;
  rules.value = [];
  try {
    if (!capabilities.value) capabilities.value = await loadCapabilities('', signal);
    if (own !== sequence) return;
    if (!capabilities.value.pageAllowed) { forbidden.value = true; return; }
    await loadDirectory(signal);
    if (own !== sequence) return;
    const dimensionFilter = dimensions.value.join(',');
    const result = await loadTypedRules({
      serviceCode: applied.serviceCode, resourceCode: applied.resourceCode,
      dimension: dimensionFilter, objectId: applied.objectId, enabled: applied.enabled,
      page: currentPage.value, size: pageSize.value
    }, signal);
    if (own !== sequence) return;
    rules.value = result.items;
    total.value = result.total;
    totalPages.value = Math.max(1, Math.ceil(result.total / pageSize.value));
    if (result.total > 0 && currentPage.value > totalPages.value) { currentPage.value = totalPages.value; void loadList(); }
  } catch (error) {
    if (own === sequence && !signal.aborted) {
      forbidden.value = error instanceof PolicyApiError && error.status === 403;
      errorMessage.value = error instanceof Error ? error.message : '加载失败';
    }
  } finally { if (own === sequence) loading.value = false; }
}
function searchRules(): void { Object.assign(applied, filterForm); currentPage.value = 1; void loadList(); }
function resetFilters(): void {
  Object.assign(filterForm, { serviceCode: '', resourceCode: '', objectId: '', enabled: '' });
  searchRules();
}
function changePage(page: number): void { currentPage.value = page; void loadList(); }
function changePageSize(size: number): void { pageSize.value = size; currentPage.value = 1; void loadList(); }
function objectLabel(rule: TypedRule): string {
  if (rule.selector === 'DEFAULT') return '全部对象（默认额度）';
  return rule.objectId ?? '';
}
watch(() => props.view, () => {
  Object.assign(filterForm, { serviceCode: '', resourceCode: '', objectId: '', enabled: '' });
  Object.assign(applied, filterForm);
  services.value = [];
  resources.value = [];
  objectOptions.value = [];
  currentPage.value = 1;
  void loadList();
});
onMounted(() => void loadList());
onUnmounted(cancel);
</script>
<template>
  <main class="page" data-page-content>
    <header class="page-header">
      <div class="title-line"><h1>{{ title }}</h1></div>
      <RouterLink v-if="capabilities?.pageAllowed && capabilities.canWrite" class="button-primary" :to="`/policies/typed/new?view=${view}`"><Plus :size="17" aria-hidden="true" />新建规则</RouterLink>
    </header>
    <p class="page-subtitle">{{ VIEW_HINTS[view] }}</p>
    <div v-if="forbidden" class="empty-state"><h2>无权访问限流策略</h2><p>请联系应用管理员确认授权。</p></div>
    <section v-else class="panel">
      <div class="panel-heading"><h2>规则列表<template v-if="!loading && !errorMessage"> {{ total }}</template></h2></div>
      <form class="filters" @submit.prevent="searchRules">
        <label>服务
          <select v-model="filterForm.serviceCode" @change="filterForm.resourceCode = ''">
            <option value="">全部服务</option>
            <option v-for="service in services" :key="service.serviceCode" :value="service.serviceCode">{{ service.displayName }}</option>
          </select>
        </label>
        <label>资源
          <select v-model="filterForm.resourceCode" :disabled="!filterForm.serviceCode">
            <option value="">{{ filterForm.serviceCode ? (resources.length ? '全部资源' : '该服务没有此维度的资源') : '请先选择服务' }}</option>
            <option v-for="code in resources" :key="code" :value="code">{{ code }}</option>
          </select>
        </label>
        <label v-if="objectDirectoryMode">对象
          <select v-model="filterForm.objectId">
            <option value="">全部对象</option>
            <option v-for="object in objectOptions" :key="object.id" :value="object.id">{{ object.name ?? object.id }}</option>
          </select>
        </label>
        <label v-else>对象<input v-model="filterForm.objectId" maxlength="256" placeholder="全部对象"></label>
        <label>状态<select v-model="filterForm.enabled"><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select></label>
        <div class="filter-actions"><button class="button-primary" type="submit"><Search :size="16" aria-hidden="true" />查询</button><button class="button-secondary" type="button" @click="resetFilters">重置</button></div>
      </form>
      <ErrorState v-if="errorMessage" :message="errorMessage" retryable @retry="() => void loadList()" />
      <p v-if="loading" class="loading-state" role="status">正在加载规则…</p>
      <template v-else-if="!errorMessage">
        <div v-if="rules.length" class="responsive-table">
          <table>
            <thead><tr><th>服务</th><th>资源</th><th v-if="showDimensionColumn">维度</th><th>范围</th><th>对象</th><th>限额窗口</th><th>状态</th><th class="ops-column">操作</th></tr></thead>
            <tbody>
              <tr v-for="rule in rules" :key="rule.id">
                <td>{{ rule.serviceCode }}</td>
                <td>{{ rule.resourceCode }}</td>
                <td v-if="showDimensionColumn">{{ DIMENSION_LABELS[rule.dimension] ?? rule.dimension }}</td>
                <td>{{ rule.selector === 'DEFAULT' ? '默认额度' : '精确对象' }}</td>
                <td class="subject-cell">{{ objectLabel(rule) }}</td>
                <td>{{ rule.limits.length }} 个</td>
                <td><span class="status-badge" :class="rule.enabled ? 'success' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span></td>
                <td><RouterLink class="table-action" :to="`/policies/typed/${rule.id}?view=${view}`">详情<ChevronRight :size="15" aria-hidden="true" /></RouterLink></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state"><h2>没有匹配的规则</h2><p v-if="Object.values(applied).some(Boolean)">请调整筛选条件。</p><p v-else>当前可访问服务暂无{{ title }}规则。</p></div>
        <div v-if="total" class="pagination-row" :data-total-pages="totalPages" :inert="loading"><Pagination :current="currentPage" :total="total" :page-size="pageSize" @update:current="changePage" @update:page-size="changePageSize" /></div>
      </template>
    </section>
  </main>
</template>
