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

/** 维度的计量单位名（效果句用：额度按"每个什么"发放） */
export const DIMENSION_UNIT_NOUNS: Record<TypedDimension, string> = {
  RESOURCE: '该资源',
  IP: '每个来源 IP',
  USER: '每位人员',
  SERVICE: '每个调用服务',
  CREDENTIAL: '每对凭据',
  CUSTOMER: '每个客户',
  CUSTOM: '每个对象'
};

/** 选择器的效果句（按维度动态生成：告诉用户这条规则实际怎么计数） */
export function selectorEffectLabel(selector: TypedSelector, dimension: TypedDimension): string {
  if (selector === 'DEFAULT') {
    const noun = DIMENSION_UNIT_NOUNS[dimension] ?? '每个对象';
    return dimension === 'RESOURCE' ? `${noun}总量` : `${noun}各一份额度`;
  }
  return '仅此对象，单独设额';
}

/** 选择器的紧凑标签（列表列/筛选徽章用：短词不换行，拉丁词两侧留空） */
export function selectorShortLabel(selector: TypedSelector, dimension: TypedDimension): string {
  if (selector === 'EXACT') return '指定对象';
  if (dimension === 'RESOURCE') return '全资源总量';
  const noun: Partial<Record<TypedDimension, string>> = {
    IP: 'IP', USER: '人员', SERVICE: '服务', CREDENTIAL: '凭据', CUSTOMER: '客户', CUSTOM: '对象'
  };
  const word = noun[dimension] ?? '对象';
  return `按${/[A-Za-z]/.test(word) ? ` ${word} ` : word}分计`;
}

/** 时间单位换算成秒与中文单字（限额摘要用） */
const UNIT_SECONDS: Record<string, number> = { SECONDS: 1, MINUTES: 60, HOURS: 3600, DAYS: 86400 };
const UNIT_SHORT: Record<string, string> = { SECONDS: '秒', MINUTES: '分', HOURS: '时', DAYS: '天' };

/** 一档限额的紧凑摘要："30 次/分" */
export function limitShortText(limit: PolicyLimit): string {
  return `${limit.count} 次/${UNIT_SHORT[limit.unit] ?? limit.unit}`;
}

/** 一条规则的限额摘要：主显最小时间窗的一档，多档追加 "+N 档" */
export function limitSummary(limits: PolicyLimit[]): string {
  if (!limits.length) return '—';
  const primary = [...limits].sort((a, b) => a.window * (UNIT_SECONDS[a.unit] ?? 1) - b.window * (UNIT_SECONDS[b.unit] ?? 1))[0]!;
  const suffix = limits.length > 1 ? ` +${limits.length - 1} 档` : '';
  return `${limitShortText(primary)}${suffix}`;
}

/** 全部档位逐行文案（列表单元格悬停提示用） */
export function limitLines(limits: PolicyLimit[]): string {
  return limits.map(limit => limitShortText(limit)).join('；');
}

/**
 * 规则的业务侧实装等价 YAML：按运行端 starter 的 typed.gates 配置树拼装
 * （SmartRedisLimiterProperties.TypedConfig/TypedGateConfig，kebab-case 键名）。
 * 展示文本供运维对照业务服务实装形态；格式变化由快照测试钉死。
 */
export function typedRuleToYaml(rule: TypedRule): string {
  const gateLines: string[] = [
    `                  - dimension: ${rule.dimension}`,
    `                    namespace: ${rule.namespace}`
  ];
  if (rule.customType) gateLines.push(`                    custom-type: ${rule.customType}`);
  gateLines.push('                    limits:');
  for (const limit of rule.limits) {
    gateLines.push(`                      - count: ${limit.count}`, `                        window: ${limit.window}`, `                        unit: ${limit.unit}`);
  }
  return [
    'io:',
    '  github:',
    '    surezzzzzz:',
    '      sdk:',
    '        limiter:',
    '          redis:',
    '            smart:',
    `              me: ${rule.serviceCode}`,
    '              typed:',
    '                enabled: true',
    '                expected-policy-epoch: 1',
    '                gates:',
    ...gateLines
  ].join('\n');
}

/** 各视图入口覆盖的维度集合（主体页三段合一） */
export const VIEW_DIMENSIONS: Record<string, TypedDimension[]> = {
  resources: ['RESOURCE'],
  ips: ['IP'],
  subjects: ['USER', 'SERVICE', 'CREDENTIAL'],
  customers: ['CUSTOMER'],
  custom: ['CUSTOM']
};

/** 各视图的使用提示（页面副标题：额度按"每个什么"发放 + 名词自解释） */
export const VIEW_HINTS: Record<string, string> = {
  resources: '额度按接口整体发放：该接口的全部调用共用一份总量（如每分钟 3000 次），不区分谁在调。',
  ips: '额度按来源地址发放：每个 IP 各自一份（如每 IP 每分钟 60 次），防单点狂刷。',
  subjects: '额度按调用方发放：每位人员、每个调用服务或每对凭据各一份，新建时在表单里选类别。',
  customers: '额度按客户合并发放：同一客户名下的所有人员与凭据合算一份（区别于主体限流的各算各的）。',
  custom: '额度按业务对象发放：类型（如设备、渠道）由服务自己声明，每个对象各一份。'
};
