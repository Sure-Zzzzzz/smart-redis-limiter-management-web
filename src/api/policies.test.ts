import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePolicyApi, loadCapabilities, loadPolicies, loadPolicy, mutatePolicy, resetPolicySession, type Policy } from './policies';
import * as pkce from '../auth/pkce';
const policy: Policy = { id: 1, key: { serviceCode: 'orders', resourceCode: 'create', subject: '*' }, limits: [{ count: 100, window: 1, unit: 'MINUTES' }], enabled: true, rowVersion: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function token(value = 'mock-token'): void { sessionStorage.setItem('limiter.accessToken', value); sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 3600000)); }
beforeEach(() => { resetPolicySession(); sessionStorage.clear(); token(); configurePolicyApi(); });
afterEach(() => { resetPolicySession(); vi.restoreAllMocks(); });
describe('Bearer-only精确契约', () => {
  it('能力查询和列表字段同契约，凭据omit且无Cookie桥', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(json({ pageAllowed: true, canWrite: false }));
    expect(await loadCapabilities('orders')).toEqual({ pageAllowed: true, canWrite: false });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/limiter/v1/policy/capabilities?serviceCode=orders');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', headers: { Authorization: 'Bearer mock-token' }, cache: 'no-store' });
    fetch.mockResolvedValue(json({ items: [policy], page: 1, size: 20, totalElements: 1, totalPages: 1 }));
    expect((await loadPolicies({ serviceCode: '', resourceCode: '', subject: 'user/a', enabled: 'false', page: 1, size: 20 })).items[0]?.limits[0]).toEqual({ count: 100, window: 1, unit: 'MINUTES' });
    expect(String(fetch.mock.calls[1]?.[0])).toContain('subject=user%2Fa');
  });
  it('写请求只提交完整窗口/预期版本，删除无body', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(json({ policy, deletedPolicyKey: null, revision: 1, changed: true }));
    await mutatePolicy('/1', 'PUT', { expectedRowVersion: 0, limits: policy.limits });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ expectedRowVersion: 0, limits: policy.limits });
    fetch.mockResolvedValue(json({ policy: null, deletedPolicyKey: policy.key, revision: 2, changed: true }));
    await mutatePolicy('/1?expectedRowVersion=0', 'DELETE');
    expect(fetch.mock.calls[1]?.[1]?.body).toBeUndefined();
  });
  it.each([403, 404, 409, 500])('%i不触发重新授权', async status => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(json({}, status));
    await expect(loadPolicy('1')).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('mock-token');
  });
  it('旧401遇新token只重发一次，不清新token', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockImplementationOnce(async () => { token('new-token'); return json({}, 401); }).mockResolvedValue(json(policy));
    expect((await loadPolicy('1')).id).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('new-token');
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer new-token' } });
  });
  it('返回SPA HTML、字段缺失和超精度数字均拒绝', async () => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(loadPolicy('1')).rejects.toThrow('网关映射');
    fetch.mockResolvedValue(json({ ...policy, rowVersion: Number.MAX_SAFE_INTEGER + 1 }));
    await expect(loadPolicy('1')).rejects.toThrow('服务版本');
    fetch.mockResolvedValue(json({ pageAllowed: true }));
    await expect(loadCapabilities()).rejects.toThrow('服务版本');
  });
  it('身份变化使解析中的旧结果失效', async () => {
    let release!: (value: Response) => void;
    vi.spyOn(window, 'fetch').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const work = loadPolicy('1');
    resetPolicySession();
    token('identity-b');
    release(json(policy));
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('identity-b');
  });
  it('取消请求不能返回结果', async () => {
    const controller = new AbortController();
    vi.spyOn(window, 'fetch').mockImplementation(async () => { controller.abort(); return json(policy); });
    await expect(loadPolicy('1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('拒绝跨源/协议相对API地址和超精度id', async () => {
    expect(() => configurePolicyApi('https://api.example.test')).toThrow('同源');
    expect(() => configurePolicyApi('//api.example.test')).toThrow('同源');
    await expect(loadPolicy(String(Number.MAX_SAFE_INTEGER + 1))).rejects.toMatchObject({ status: 404 });
  });
  it('缺token并发请求只静默授权一次', async () => {
    sessionStorage.clear();
    let release!: (value: boolean) => void;
    const silent = vi.spyOn(pkce, 'silentLimiterAuthorization').mockReturnValue(new Promise(resolve => { release = resolve; }));
    vi.spyOn(window, 'fetch').mockImplementation(async () => json(policy));
    const first = loadPolicy('1');
    const second = loadPolicy('1');
    token('new-token');
    release(true);
    await expect(first).resolves.toMatchObject({ id: 1 });
    await expect(second).resolves.toMatchObject({ id: 1 });
    expect(silent).toHaveBeenCalledOnce();
  });
  it('静默失败至多一次整页授权，不发送匿名API', async () => {
    sessionStorage.clear();
    vi.spyOn(pkce, 'silentLimiterAuthorization').mockResolvedValue(false);
    const begin = vi.spyOn(pkce, 'beginLimiterAuthorization').mockResolvedValue(undefined);
    const fetch = vi.spyOn(window, 'fetch');
    await expect(loadPolicy('1')).rejects.toThrow('正在重新授权');
    expect(begin).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('取消等待中的授权不能随后跳转', async () => {
    sessionStorage.clear();
    let release!: (value: boolean) => void;
    vi.spyOn(pkce, 'silentLimiterAuthorization').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const begin = vi.spyOn(pkce, 'beginLimiterAuthorization');
    const controller = new AbortController();
    const work = loadPolicy('1', controller.signal);
    controller.abort();
    release(false);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(begin).not.toHaveBeenCalled();
  });
  it('当前token401只恢复一次，新token再次401终止并熔断', async () => {
    sessionStorage.setItem('limiter.lastAuthAt', String(Date.now()));
    vi.spyOn(pkce, 'silentLimiterAuthorization').mockImplementation(async () => { token('renewed'); sessionStorage.setItem('limiter.lastAuthAt', String(Date.now())); return true; });
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(json({}, 401));
    await expect(loadPolicy('1')).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pkce.isLimiterAuthorizationSuspended()).toBe(true);
    await expect(loadPolicy('1')).rejects.toThrow('自动授权已暂停');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('旧页面取消不取消新页面共享的授权工作', async () => {
    sessionStorage.clear();
    let release!: (value: boolean) => void;
    const silent = vi.spyOn(pkce, 'silentLimiterAuthorization').mockReturnValue(new Promise(resolve => { release = resolve; }));
    vi.spyOn(window, 'fetch').mockImplementation(async () => json(policy));
    const old = new AbortController();
    const oldRequest = loadPolicy('1', old.signal);
    const currentRequest = loadPolicy('1');
    old.abort();
    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    token('current-token');
    release(true);
    await expect(currentRequest).resolves.toMatchObject({ id: 1 });
    expect(silent).toHaveBeenCalledOnce();
  });
  it('并发旧401不能重复reset或清已有fresh-reject计数', async () => {
    sessionStorage.setItem('limiter.lastAuthAt', String(Date.now()));
    let release!: (value: boolean) => void;
    vi.spyOn(pkce, 'silentLimiterAuthorization').mockReturnValue(new Promise(resolve => { release = resolve; }));
    let rejected = 0;
    const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (_url, options) => {
      const header = (options?.headers as Record<string, string>).Authorization;
      if (header === 'Bearer mock-token') { rejected += 1; return json({}, 401); }
      return json(policy);
    });
    const first = loadPolicy('1');
    const second = loadPolicy('1');
    await vi.waitFor(() => expect(rejected).toBe(2));
    expect(sessionStorage.getItem('limiter.auth.freshRejectStreak')).toBe('1');
    token('renewed');
    release(true);
    await expect(first).resolves.toMatchObject({ id: 1 });
    await expect(second).resolves.toMatchObject({ id: 1 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sessionStorage.getItem('limiter.auth.freshRejectStreak')).toBe('1');
  });
  it('省略nullable mutation字段归一化为null', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(json({ policy, revision: 1, changed: true }));
    expect((await mutatePolicy('', 'POST', {})).deletedPolicyKey).toBeNull();
  });
});
