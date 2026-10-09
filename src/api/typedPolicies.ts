import { checked, PolicyApiError, request, type PolicyLimit } from './policies';

/**
 * 类型化规则（多维度限流）API 客户端。
 *
 * 后端契约（Management 完整版）：目录三接口（services/declarations/objects）、
 * 规则 CRUD（/v2/policy/rule、/v2/policy/rules）、类型化快照。所有响应严格校验，
 * 拒绝未知形态；错误码语义与 v1 相同（400/401/403/404/409）。
 */

export type TypedDimension = 'RESOURCE' | 'IP' | 'USER' | 'SERVICE' | 'CREDENTIAL' | 'CUSTOMER' | 'CUSTOM';
export type TypedSelector = 'DEFAULT' | 'EXACT';

export interface TypedRule {
  id: number;
  serviceCode: string;
  resourceCode: string;
  dimension: TypedDimension;
  selector: TypedSelector;
  namespace: string;
  customType: string | null;
  objectId: string | null;
  limits: PolicyLimit[];
  enabled: boolean;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface TypedRulePage { items: TypedRule[]; page: number; size: number; total: number }

export interface TypedMutation { rule: TypedRule | null; revision: number }

export interface ServiceSummary { serviceCode: string; displayName: string }

export interface ServiceDeclaration {
  serviceCode: string;
  controlMode: string;
  displayName: string;
  resources: Record<string, string[]>;
  namespaces: Record<string, string>;
  customTypes: string[];
}

export interface DirectoryObject { dimension: string; customType: string | null; id: string; name: string | null }

export interface TypedRuleQuery {
  serviceCode?: string;
  resourceCode?: string;
  dimension?: string;
  selector?: string;
  objectId?: string;
  enabled?: string;
  page: number;
  size: number;
}

function rec(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function str(value: unknown): value is string { return typeof value === 'string'; }
function int(value: unknown, min = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min; }

export function isTypedRule(value: unknown): value is TypedRule {
  return rec(value) && int(value.id, 1) && int(value.rowVersion) && typeof value.enabled === 'boolean'
    && str(value.createdAt) && str(value.updatedAt)
    && str(value.serviceCode) && str(value.resourceCode)
    && str(value.dimension) && str(value.selector) && str(value.namespace)
    && (value.customType === null || str(value.customType))
    && (value.objectId === null || str(value.objectId))
    && Array.isArray(value.limits) && value.limits.length >= 1 && value.limits.length <= 16;
}

const V2 = '/v2/policy';

export async function loadTypedServices(signal?: AbortSignal): Promise<ServiceSummary[]> {
  const value = await request('/services', {}, signal, false, V2);
  return checked(value, (v): v is ServiceSummary[] => Array.isArray(v)
    && v.every(item => rec(item) && str(item.serviceCode) && str(item.displayName)));
}

export async function loadDeclaration(serviceCode: string, signal?: AbortSignal): Promise<ServiceDeclaration> {
  const value = await request(`/services/${encodeURIComponent(serviceCode)}/declarations`, {}, signal, false, V2);
  return checked(value, (v): v is ServiceDeclaration => rec(v) && str(v.serviceCode) && str(v.controlMode)
    && rec(v.resources) && rec(v.namespaces) && Array.isArray(v.customTypes));
}

export async function loadDirectoryObjects(serviceCode: string, dimension: string, customType: string | null,
  keyword: string, signal?: AbortSignal): Promise<DirectoryObject[]> {
  const params = new URLSearchParams({ dimension, limit: '20' });
  if (customType) params.set('customType', customType);
  if (keyword) params.set('keyword', keyword);
  const value = await request(`/services/${encodeURIComponent(serviceCode)}/objects?${params}`, {}, signal, false, V2);
  return checked(value, (v): v is DirectoryObject[] => Array.isArray(v)
    && v.every(item => rec(item) && str(item.id) && str(item.dimension)
      && (item.customType === null || str(item.customType)) && (item.name === null || str(item.name))));
}

export async function loadTypedRules(query: TypedRuleQuery, signal?: AbortSignal): Promise<TypedRulePage> {
  const params = new URLSearchParams({ page: String(query.page), size: String(query.size) });
  for (const key of ['serviceCode', 'resourceCode', 'dimension', 'selector', 'objectId', 'enabled'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const value = await request(`/rules?${params}`, {}, signal, false, V2);
  return checked(value, (v): v is TypedRulePage => rec(v) && Array.isArray(v.items) && v.items.every(isTypedRule)
    && int(v.page, 1) && int(v.size, 1) && int(v.total));
}

export async function loadTypedRule(id: string, signal?: AbortSignal): Promise<TypedRule> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new PolicyApiError(404, '规则不存在');
  const value = await request(`/rule/${id}`, {}, signal, false, V2);
  return checked(value, isTypedRule);
}

export interface TypedRuleCreateBody {
  serviceCode: string;
  resourceCode: string;
  dimension: TypedDimension;
  selector: TypedSelector;
  namespace: string;
  customType?: string;
  objectId?: string;
  enabled: boolean;
  limits: PolicyLimit[];
}

export async function createTypedRule(body: TypedRuleCreateBody, signal?: AbortSignal): Promise<TypedMutation> {
  const value = await request('/rule', { method: 'POST', body: JSON.stringify(body) }, signal, false, V2);
  return checked(value, (v): v is TypedMutation => rec(v) && (v.rule === null || isTypedRule(v.rule)) && int(v.revision));
}

export async function updateTypedRule(id: number, expectedRowVersion: number, limits: PolicyLimit[],
  signal?: AbortSignal): Promise<TypedMutation> {
  const value = await request(`/rule/${id}`, { method: 'PUT', body: JSON.stringify({ expectedRowVersion, limits }) },
    signal, false, V2);
  return checked(value, (v): v is TypedMutation => rec(v) && isTypedRule(v.rule) && int(v.revision));
}

export async function setTypedRuleState(id: number, expectedRowVersion: number, enabled: boolean,
  signal?: AbortSignal): Promise<TypedMutation> {
  const value = await request(`/rule/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled, expectedRowVersion }) },
    signal, false, V2);
  return checked(value, (v): v is TypedMutation => rec(v) && isTypedRule(v.rule) && int(v.revision));
}

export async function deleteTypedRule(id: number, expectedRowVersion: number,
  signal?: AbortSignal): Promise<TypedMutation> {
  const value = await request(`/rule/${id}?expectedRowVersion=${expectedRowVersion}`, { method: 'DELETE' },
    signal, false, V2);
  return checked(value, (v): v is TypedMutation => rec(v) && (v.rule === null || isTypedRule(v.rule)) && int(v.revision));
}

/** 维度中文短名（列表/表单共用） */
export const DIMENSION_LABELS: Record<TypedDimension, string> = {
  RESOURCE: '资源', IP: 'IP', USER: '人员', SERVICE: '服务主体', CREDENTIAL: '凭据', CUSTOMER: '客户', CUSTOM: '自定义'
};

/** 各视图入口覆盖的维度集合（主体页三段合一） */
export const VIEW_DIMENSIONS: Record<string, TypedDimension[]> = {
  resources: ['RESOURCE'],
  ips: ['IP'],
  subjects: ['USER', 'SERVICE', 'CREDENTIAL'],
  customers: ['CUSTOMER'],
  custom: ['CUSTOM']
};

/** 各视图的使用提示（页面副标题，说明计数方式与目录可见性） */
export const VIEW_HINTS: Record<string, string> = {
  resources: '所选资源的全部调用者共用同一份额度；仅列出目录声明了资源维度的服务。',
  ips: '按来源 IP 分别计数；仅列出目录声明了 IP 维度的服务。',
  subjects: '按人员、服务主体或凭据分别计数，新建时在表单中选择计数类别。',
  customers: '同一客户关联的人员与凭据在同一资源内合并计数；精确对象从客户目录选择。',
  custom: '按宿主声明的业务类型（如设备、渠道）分别计数；类型来自服务目录。'
};
