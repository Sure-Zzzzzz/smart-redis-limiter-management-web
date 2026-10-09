<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { Plus, Search, ChevronRight, SlidersHorizontal } from 'lucide-vue-next';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import ErrorState from '../components/ErrorState.vue';
import { loadCapabilities, loadPolicies, PolicyApiError, type Capabilities, type Policy } from '../api/policies';
const filterForm = reactive({ serviceCode: '', resourceCode: '', subject: '', enabled: '' });
const applied = reactive({ ...filterForm });
const policies = ref<Policy[]>([]);
const currentPage = ref(1);
const totalPages = ref(0);
const totalElements = ref(0);
const pageSize = ref(20);
const loading = ref(true);
const errorMessage = ref('');
const forbidden = ref(false);
const capabilities = ref<Capabilities | null>(null);
let sequence = 0;
let controller: AbortController | null = null;
function cancel(): void { sequence += 1; controller?.abort(); }
async function loadList(): Promise<void> {
  cancel();
  const own = sequence;
  controller = new AbortController();
  const signal = controller.signal;
  errorMessage.value = '';
  loading.value = true;
  policies.value = [];
  try {
    if (!capabilities.value) capabilities.value = await loadCapabilities('', signal);
    if (own !== sequence) return;
    if (!capabilities.value.pageAllowed) { forbidden.value = true; return; }
    const result = await loadPolicies({ ...applied, page: currentPage.value, size: pageSize.value }, signal);
    if (own !== sequence) return;
    policies.value = result.items;
    totalElements.value = result.totalElements;
    totalPages.value = result.totalPages;
    if (result.totalPages > 0 && currentPage.value > result.totalPages) { currentPage.value = result.totalPages; void loadList(); }
  } catch (error) {
    if (own === sequence && !signal.aborted) {
      forbidden.value = error instanceof PolicyApiError && error.status === 403;
      errorMessage.value = error instanceof Error ? error.message : '加载失败';
    }
  } finally { if (own === sequence) loading.value = false; }
}
function searchPolicies(): void { Object.assign(applied, filterForm); currentPage.value = 1; void loadList(); }
function resetFilters(): void { Object.assign(filterForm, { serviceCode: '', resourceCode: '', subject: '', enabled: '' }); searchPolicies(); }
function changePage(page: number): void { currentPage.value = page; void loadList(); }
function changePageSize(size: number): void { pageSize.value = size; currentPage.value = 1; void loadList(); }
/** 表格列声明：对象列不设宽，吃剩余宽度（契约 DataTable 形态） */
const policyColumns: DataTableColumn[] = [
  { key: 'service', label: '服务', width: '15%' },
  { key: 'resource', label: '资源', width: '15%' },
  { key: 'subject', label: '对象' },
  { key: 'limits', label: '限额窗口', width: '92px' },
  { key: 'enabled', label: '状态', width: '96px' },
  { key: 'version', label: '版本', width: '64px' },
  { key: 'actions', label: '操作', width: '76px' }
];
/** 行数据拍平为展示模型，契约缺省单元格按字段直读 */
const policyRows = computed(() => policies.value.map(policy => ({
  id: policy.id,
  service: policy.key.serviceCode,
  resource: policy.key.resourceCode,
  subject: policy.key.subject,
  limits: `${policy.limits.length} 个`,
  enabled: policy.enabled,
  version: String(policy.rowVersion)
})));
const policyEmptyText = computed(() =>
  Object.values(applied).some(Boolean) ? '没有匹配的策略，请调整筛选条件' : '当前可访问服务暂无策略');
onMounted(() => void loadList());
onUnmounted(cancel);
</script>
<template>
  <main class="page" data-page-content>
    <header class="page-header"><div class="title-line"><SlidersHorizontal :size="24" aria-hidden="true" /><h1>限流策略</h1></div><RouterLink v-if="capabilities?.pageAllowed && capabilities.canWrite" class="button-primary" to="/policies/new"><Plus :size="17" aria-hidden="true" />新建策略</RouterLink></header>
    <div v-if="forbidden" class="empty-state"><h2>无权访问限流策略</h2><p>请联系应用管理员确认授权。</p></div>
    <section v-else class="panel">
      <div class="panel-heading"><h2>策略列表<template v-if="!loading && !errorMessage"> {{ totalElements }}</template></h2></div>
      <form class="filters" @submit.prevent="searchPolicies">
        <label>服务编码<input v-model="filterForm.serviceCode" maxlength="128" placeholder="全部服务"></label>
        <label>资源编码<input v-model="filterForm.resourceCode" maxlength="128" placeholder="全部资源"></label>
        <label>对象<input v-model="filterForm.subject" maxlength="256" placeholder="全部对象"></label>
        <label>状态<select v-model="filterForm.enabled"><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select></label>
        <div class="filter-actions"><button class="button-primary" type="submit"><Search :size="16" aria-hidden="true" />查询</button><button class="button-secondary" type="button" @click="resetFilters">重置</button></div>
      </form>
      <ErrorState v-if="errorMessage" :message="errorMessage" retryable @retry="() => void loadList()" />
      <template v-else>
        <DataTable :columns="policyColumns" :rows="policyRows" row-key="id" :loading="loading" :empty-text="policyEmptyText" scroll-min-width="900px">
          <template #cell-enabled="{ row }"><span class="status-badge" :class="row.enabled ? 'success' : 'neutral'">{{ row.enabled ? '已启用' : '已停用' }}</span></template>
          <template #cell-actions="{ row }"><RouterLink class="table-action" :to="`/policies/${row.id}`">详情<ChevronRight :size="15" aria-hidden="true" /></RouterLink></template>
        </DataTable>
        <div v-if="totalElements" class="pagination-row" :data-total-pages="totalPages" :inert="loading"><Pagination :current="currentPage" :total="totalElements" :page-size="pageSize" @update:current="changePage" @update:page-size="changePageSize" /></div>
      </template>
    </section>
  </main>
</template>
