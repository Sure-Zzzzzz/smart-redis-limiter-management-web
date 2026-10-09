import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLimiterAuthorizeUrl, cancelLimiterTokenRenewal, handleLimiterOAuthCallback, resolveLimiterRedirectUri, safeLimiterTarget, silentLimiterAuthorization } from './pkce';
beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv('VITE_LIMITER_PKCE_CLIENT_ID', 'mock-limiter-pkce');
  vi.stubGlobal('crypto', webcrypto);
  window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=mock-code&state=mock-state');
});
afterEach(() => { cancelLimiterTokenRenewal(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('授权安全及生命周期', () => {
  it('localhost不能只改回调host，127和正式origin逐字保留', () => {
    expect(() => resolveLimiterRedirectUri('http://localhost:5182', '/app/limiter-management/')).toThrow('127.0.0.1');
    expect(resolveLimiterRedirectUri('http://127.0.0.1:5182', '/app/limiter-management/')).toBe('http://127.0.0.1:5182/app/limiter-management/oauth-callback');
    expect(resolveLimiterRedirectUri('https://portal.example.test', '/app/limiter-management/')).toBe('https://portal.example.test/app/limiter-management/oauth-callback');
  });
  it.each(['//evil.example.test', 'https://evil.example.test', '/oauth-callback?code=old', '/policies\\evil', '/tokens'])('回调目标 %s 不得外跳或回到授权码页', target => {
    expect(safeLimiterTarget(target)).toBe('/policies');
  });
  it('会话存储写失败不能发起授权', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await expect(buildLimiterAuthorizeUrl('/policies')).rejects.toThrow('会话存储不可用');
  });
  it('摘要计算期间取消不保存PKCE state', async () => {
    const controller = new AbortController();
    const work = buildLimiterAuthorizeUrl('/policies', controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(Object.keys(sessionStorage)).toHaveLength(0);
  });
  it('交换结果在身份取消后不能写token或重试', async () => {
    sessionStorage.setItem('limiter.pkce.mock-state', JSON.stringify({ verifier: 'verifier', target: '/policies/1' }));
    let release!: (value: Response) => void;
    vi.spyOn(window, 'fetch').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const controller = new AbortController();
    const work = handleLimiterOAuthCallback({ signal: controller.signal });
    controller.abort();
    sessionStorage.setItem('limiter.accessToken', 'new-identity-token');
    release(new Response(JSON.stringify({ access_token: 'old-token', expires_in: 3600 }), { status: 200 }));
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('new-identity-token');
    expect(sessionStorage.getItem('limiter.pkce.retry')).toBeNull();
  });
  it.each([undefined, 0, -1, Infinity, '3600'])('有效期 %s 不合约时不保存令牌', async expiresIn => {
    sessionStorage.setItem('limiter.pkce.mock-state', JSON.stringify({ verifier: 'verifier', target: '/policies' }));
    sessionStorage.setItem('limiter.pkce.retry', '1');
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'token', expires_in: expiresIn }), { status: 200 }));
    await expect(handleLimiterOAuthCallback()).rejects.toThrow('授权码交换失败');
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
  });
  it('静默授权配置缺失时受控失败并清iframe', async () => {
    vi.stubEnv('VITE_LIMITER_PKCE_CLIENT_ID', '');
    expect(await silentLimiterAuthorization()).toBe(false);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });
  it('授权码交换期间共享会话身份变化不能写回旧iframe令牌', async () => {
    sessionStorage.setItem('limiter.portalIdentity', 'identity-a');
    sessionStorage.setItem('limiter.pkce.mock-state', JSON.stringify({ verifier: 'verifier', target: '/policies/1', identity: 'identity-a' }));
    let release!: (value: Response) => void;
    vi.spyOn(window, 'fetch').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const work = handleLimiterOAuthCallback({ silent: true });
    sessionStorage.setItem('limiter.portalIdentity', 'identity-b');
    sessionStorage.setItem('limiter.accessToken', 'token-b');
    release(new Response(JSON.stringify({ access_token: 'old-token-a', expires_in: 3600 }), { status: 200 }));
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('token-b');
  });
});
