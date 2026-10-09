import {
  beginLimiterAuthorization, cancelLimiterTokenRenewal, clearLimiterAccessToken,
  getLimiterAccessToken, hasValidLimiterAccessToken, isLimiterAuthorizationSuspended,
  resetLimiterUnauthorizedRecovery, silentLimiterAuthorization
} from '../auth/pkce';

export const TIME_UNITS = ['SECONDS', 'MINUTES', 'HOURS', 'DAYS'] as const;
export type TimeUnit = typeof TIME_UNITS[number];
export interface PolicyKey { serviceCode: string; resourceCode: string; subject: string }
export interface PolicyLimit { window: number; unit: TimeUnit; count: number }
export interface Policy { id: number; key: PolicyKey; limits: PolicyLimit[]; enabled: boolean; rowVersion: number; createdAt: string; updatedAt: string }
export interface PolicyPage { items: Policy[]; page: number; size: number; totalElements: number; totalPages: number }
export interface Capabilities { pageAllowed: boolean; canWrite: boolean }
export interface PolicyMutation { policy: Policy | null; deletedPolicyKey: PolicyKey | null; revision: number; changed: boolean }
export interface PolicyQuery { serviceCode: string; resourceCode: string; subject: string; enabled: string; page: number; size: number }

export class PolicyApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'PolicyApiError'; }
}

let apiBase = '/api/limiter';
let epoch = 0;
let lifecycle = new AbortController();
interface AuthorizationFlight { promise: Promise<void>; controller: AbortController; waiters: Set<symbol> }
let authInflight: AuthorizationFlight | null = null;
let targetProvider = () => '/policies';

export function configurePolicyApi(base = '/api/limiter', target = () => '/policies'): void {
  if (!/^\/(?!\/)[^?#\\]*$/.test(base)) throw new PolicyApiError(0, 'API 路径必须为同源绝对路径');
  apiBase = base.replace(/\/$/, '');
  targetProvider = target;
}

export function resetPolicySession(clearToken = true): void {
  epoch += 1;
  lifecycle.abort();
  lifecycle = new AbortController();
  cancelLimiterTokenRenewal();
  if (clearToken) clearLimiterAccessToken();
  authInflight = null;
}

function active(version: number, signal?: AbortSignal): void {
  if (version !== epoch || signal?.aborted || lifecycle.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
}

async function authorize(version: number, signal?: AbortSignal): Promise<void> {
  active(version, signal);
  if (isLimiterAuthorizationSuspended()) throw new PolicyApiError(401, '授权验证持续失败，自动授权已暂停');
  if (!authInflight) {
    const own = lifecycle;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const cancel = () => cancelLimiterTokenRenewal();
    own.signal.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    const work = (async () => {
      try {
        const ok = await silentLimiterAuthorization();
        active(version, controller.signal);
        if (!ok) {
          await beginLimiterAuthorization(targetProvider(), controller.signal);
          throw new PolicyApiError(401, '正在重新授权');
        }
      } finally {
        own.signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', cancel);
      }
    })();
    const flight: AuthorizationFlight = { promise: work, controller, waiters: new Set() };
    authInflight = flight;
    void work.finally(() => { if (authInflight === flight) authInflight = null; }).catch(() => undefined);
  }
  const flight = authInflight;
  const waiter = Symbol();
  flight.waiters.add(waiter);
  await new Promise<void>((resolve, reject) => {
    let released = false;
    const release = (aborted: boolean) => {
      if (released) return false;
      released = true;
      signal?.removeEventListener('abort', onAbort);
      flight.waiters.delete(waiter);
      if (aborted && flight.waiters.size === 0) {
        if (authInflight === flight) authInflight = null;
        flight.controller.abort();
      }
      return true;
    };
    const onAbort = () => { if (release(true)) reject(new DOMException('请求已取消', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    void flight.promise.then(() => {
      if (!release(false)) return;
      try { active(version, signal); resolve(); } catch (error) { reject(error); }
    }, error => { if (release(false)) reject(error); });
  });
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, min = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min; }
function validKey(value: unknown): value is PolicyKey { return record(value) && ['serviceCode', 'resourceCode', 'subject'].every(key => typeof value[key] === 'string'); }
export function isPolicy(value: unknown): value is Policy {
  return record(value) && integer(value.id, 1) && integer(value.rowVersion) && validKey(value.key)
    && typeof value.enabled === 'boolean' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
    && Array.isArray(value.limits) && value.limits.length > 0 && value.limits.length <= 16 && value.limits.every(limit => record(limit)
      && integer(limit.window, 1) && integer(limit.count, 1) && TIME_UNITS.includes(limit.unit as TimeUnit));
}
function responseError(status: number): string {
  return ({ 400: '提交内容无效，请检查表单', 401: '登录授权失效', 403: '没有访问该操作或服务的权限',
    404: '策略不存在或不在可访问范围', 409: '策略已被其他操作修改，请重新读取并比较', 500: '服务暂时不可用，请稍后重试' } as Record<number, string>)[status] ?? `请求失败（HTTP ${status}）`;
}

export async function request(path: string, options: RequestInit = {}, signal?: AbortSignal, retried = false, prefix = '/v1/policy'): Promise<unknown> {
  const version = epoch;
  active(version, signal);
  if (!hasValidLimiterAccessToken()) await authorize(version, signal);
  active(version, signal);
  const token = getLimiterAccessToken();
  if (!token) throw new PolicyApiError(401, '登录授权失效');
  const controller = new AbortController();
  const globalSignal = lifecycle.signal;
  const abort = () => controller.abort();
  globalSignal.addEventListener('abort', abort, { once: true });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await window.fetch(`${apiBase}${prefix}${path}`, {
      ...options, credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` }
    });
    active(version, signal);
    if (response.status === 401) {
      // 旧请求拒绝旧令牌时，不得清除并发续签产生的新令牌。
      if (!retried && token !== getLimiterAccessToken() && hasValidLimiterAccessToken()) return request(path, options, signal, true, prefix);
      if (!retried) {
        if (token === getLimiterAccessToken()) resetLimiterUnauthorizedRecovery();
        if (!hasValidLimiterAccessToken()) await authorize(version, signal);
        return request(path, options, signal, true, prefix);
      }
      if (token === getLimiterAccessToken()) resetLimiterUnauthorizedRecovery();
    }
    if (!response.ok) throw new PolicyApiError(response.status, responseError(response.status));
    if (!response.headers.get('content-type')?.includes('application/json')) throw new PolicyApiError(0, '接口返回格式错误，请检查网关映射');
    const payload: unknown = await response.json();
    active(version, signal);
    return payload;
  } catch (error) {
    active(version, signal);
    if (error instanceof PolicyApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new PolicyApiError(0, '网络请求失败，请稍后重试');
  } finally {
    globalSignal.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', abort);
  }
}

export function checked<T>(value: unknown, valid: (value: unknown) => value is T): T {
  if (!valid(value)) throw new PolicyApiError(0, '接口返回格式错误，请检查服务版本');
  return value;
}
export async function loadCapabilities(serviceCode = '', signal?: AbortSignal): Promise<Capabilities> {
  return checked(await request(`/capabilities${serviceCode ? `?${new URLSearchParams({ serviceCode })}` : ''}`, {}, signal),
    (value): value is Capabilities => record(value) && typeof value.pageAllowed === 'boolean' && typeof value.canWrite === 'boolean');
}
export async function loadPolicies(query: PolicyQuery, signal?: AbortSignal): Promise<PolicyPage> {
  const params = new URLSearchParams({ page: String(query.page), size: String(query.size) });
  for (const key of ['serviceCode', 'resourceCode', 'subject', 'enabled'] as const) if (query[key]) params.set(key, query[key]);
  return checked(await request(`?${params}`, {}, signal), (value): value is PolicyPage => record(value) && Array.isArray(value.items)
    && value.items.every(isPolicy) && integer(value.page, 1) && integer(value.size, 1) && integer(value.totalElements) && integer(value.totalPages));
}
export async function loadPolicy(id: string, signal?: AbortSignal): Promise<Policy> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new PolicyApiError(404, '策略不存在');
  return checked(await request(`/${id}`, {}, signal), isPolicy);
}
export async function mutatePolicy(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<PolicyMutation> {
  const raw = await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, signal);
  const value = record(raw) ? { ...raw, policy: raw.policy ?? null, deletedPolicyKey: raw.deletedPolicyKey ?? null } : raw;
  return checked(value,
    (value): value is PolicyMutation => record(value) && (value.policy === null || isPolicy(value.policy))
      && (value.deletedPolicyKey === null || validKey(value.deletedPolicyKey)) && integer(value.revision) && typeof value.changed === 'boolean');
}
