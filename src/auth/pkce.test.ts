import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LimiterPkceError,
  beginLimiterAuthorization,
  buildLimiterAuthorizeUrl,
  cancelLimiterTokenRenewal,
  clearLimiterAuthorizationSuspension,
  getLimiterAccessToken,
  handleLimiterOAuthCallback,
  isLimiterAuthorizationSuspended,
  hasValidLimiterAccessToken,
  resetLimiterUnauthorizedRecovery,
  scheduleLimiterTokenRenewal,
  silentLimiterAuthorization
} from './pkce';

function seedValidToken(token = 'token-1') {
  window.sessionStorage.setItem('limiter.accessToken', token);
  window.sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 3600_000));
}

function tokenResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function pkceStateKeys(): string[] {
  return Object.keys(window.sessionStorage).filter(key => key.startsWith('limiter.pkce.') && key !== 'limiter.pkce.retry');
}

// beginLimiterAuthorization 的整页跳转在 jsdom 下会打“Not implemented: navigation”，与断言无关，静音
function silenceJsdomNavigation() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('pkce', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubEnv('VITE_LIMITER_PKCE_CLIENT_ID', 'limiter-admin-web');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('hasValidLimiterAccessToken', () => {
    it('无 token、缺过期时间或已过期均视为无效', () => {
      expect(hasValidLimiterAccessToken()).toBe(false);
      window.sessionStorage.setItem('limiter.accessToken', 'token-1');
      expect(hasValidLimiterAccessToken()).toBe(false);
      window.sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() - 1000));
      expect(hasValidLimiterAccessToken()).toBe(false);
    });

    it('未过期的 token 视为有效', () => {
      seedValidToken();
      expect(hasValidLimiterAccessToken()).toBe(true);
    });
  });


  describe('beginLimiterAuthorization', () => {
    it('未配置客户端 ID 时直接报配置错误', async () => {
      vi.stubEnv('VITE_LIMITER_PKCE_CLIENT_ID', '');
      await expect(beginLimiterAuthorization('/policies')).rejects.toBeInstanceOf(LimiterPkceError);
      await expect(beginLimiterAuthorization('/policies')).rejects.toThrow('未配置 VITE_LIMITER_PKCE_CLIENT_ID');
    });

    it('刚完成授权且仍持有有效令牌时抛循环防护错误', async () => {
      window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now()));
      window.sessionStorage.setItem('limiter.accessToken', 'token-1');
      window.sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 3_600_000));
      await expect(beginLimiterAuthorization('/policies')).rejects.toThrow('刚刚完成授权仍无法通过校验');
    });

    it('刚完成授权但令牌已被清除时阻止再次整页授权', async () => {
      window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now()));
      await expect(beginLimiterAuthorization('/policies')).rejects.toThrow('刚刚完成授权仍无法通过校验');
      expect(pkceStateKeys()).toHaveLength(0);
    });

    it('服务端 401 恢复会清理节流与重试状态，允许重新建立授权链', async () => {
      silenceJsdomNavigation();
      window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now()));
      window.sessionStorage.setItem('limiter.pkce.retry', '1');
      seedValidToken('stale-token');

      resetLimiterUnauthorizedRecovery();

      expect(getLimiterAccessToken()).toBeNull();
      expect(window.sessionStorage.getItem('limiter.lastAuthAt')).toBeNull();
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBeNull();
      await expect(beginLimiterAuthorization('/policies')).resolves.toBeUndefined();
      expect(pkceStateKeys()).toHaveLength(1);
    });

    it('构造授权 URL 时按 state 存储 verifier、目标路由和标准 OIDC scopes', async () => {
      const authorizationUrl = new URL(await buildLimiterAuthorizeUrl('/policies/detail'), window.location.origin);
      const keys = pkceStateKeys();
      expect(keys).toHaveLength(1);
      const stored = JSON.parse(window.sessionStorage.getItem(keys[0])!) as { verifier: string; target: string };
      expect(stored.verifier.length).toBeGreaterThanOrEqual(40);
      expect(stored.target).toBe('/policies/detail');
      expect(authorizationUrl.searchParams.get('scope')).toBe('openid profile');
    });
  });

  describe('handleLimiterOAuthCallback', () => {
    it('无 code/state 参数时按直接访问兜底', async () => {
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback');
      const outcome = await handleLimiterOAuthCallback();
      expect(outcome).toEqual({ kind: 'missing-params' });
    });

    it('error 参数直接报授权失败', async () => {
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?error=access_denied');
      await expect(handleLimiterOAuthCallback()).rejects.toThrow('授权失败：access_denied');
    });

    it('合法回调：交换令牌、落位、清理 URL 并按 state 恢复目标路由', async () => {
      const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('code-1');
        expect(body.get('code_verifier')).toBe('verifier-1');
        expect(body.get('client_id')).toBe('limiter-admin-web');
        expect(body.get('redirect_uri')).toContain('oauth-callback');
        return Promise.resolve(tokenResponse({ access_token: 'exchanged-token', expires_in: 1800 }));
      });
      vi.stubGlobal('fetch', fetchMock);
      window.sessionStorage.setItem('limiter.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/policies/1' }));
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=code-1&state=state-1');

      const outcome = await handleLimiterOAuthCallback();

      expect(outcome).toEqual({ kind: 'authorized', target: '/policies/1' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getLimiterAccessToken()).toBe('exchanged-token');
      expect(hasValidLimiterAccessToken()).toBe(true);
      expect(window.location.search).toBe('');
      expect(window.sessionStorage.getItem('limiter.pkce.state-1')).toBeNull();
      expect(Number(window.sessionStorage.getItem('limiter.lastAuthAt'))).toBeGreaterThan(Date.now() - 60_000);
    });

    it('state 无法匹配时受控重走一次授权', async () => {
      silenceJsdomNavigation();
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=code-1&state=unknown');
      const outcome = await handleLimiterOAuthCallback();
      expect(outcome.kind).toBe('retrying');
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBe('1');
      expect(pkceStateKeys()).toHaveLength(1);
    });

    it('交换失败第二次直接终止并提示从门户重进', async () => {
      window.sessionStorage.setItem('limiter.pkce.retry', '1');
      window.sessionStorage.setItem('limiter.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/policies' }));
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=stale&state=state-1');

      await expect(handleLimiterOAuthCallback()).rejects.toThrow('授权码交换失败，请重新从统一应用门户进入');
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBeNull();
      expect(getLimiterAccessToken()).toBeNull();
    });

    it('交换失败首次自动重走一次', async () => {
      silenceJsdomNavigation();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)));
      window.sessionStorage.setItem('limiter.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/policies' }));
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=used&state=state-1');

      const outcome = await handleLimiterOAuthCallback();
      expect(outcome.kind).toBe('retrying');
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBe('1');
    });

    it('静默形态不抛错不重试，成功落位新令牌', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ access_token: 'renewed-token', expires_in: 3600 })));
      window.sessionStorage.setItem('limiter.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/policies' }));
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=fresh&state=state-1');

      const outcome = await handleLimiterOAuthCallback({ silent: true });
      expect(outcome).toEqual({ kind: 'silent', ok: true });
      expect(getLimiterAccessToken()).toBe('renewed-token');
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBeNull();
    });

    it('静默形态交换失败按失败回报并清令牌', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)));
      seedValidToken('old-token');
      window.sessionStorage.setItem('limiter.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/policies' }));
      window.history.replaceState(null, '', '/app/limiter-management/oauth-callback?code=stale&state=state-1');

      const outcome = await handleLimiterOAuthCallback({ silent: true });
      expect(outcome).toEqual({ kind: 'silent', ok: false });
      expect(getLimiterAccessToken()).toBeNull();
      expect(window.sessionStorage.getItem('limiter.pkce.retry')).toBeNull();
    });
  });

  describe('静默续签调度', () => {
    afterEach(async () => {
      cancelLimiterTokenRenewal();
      document.body.innerHTML = '';
      await Promise.resolve();
    });

    it('令牌临近过期时触发隐藏 iframe 续签', async () => {
      vi.useFakeTimers();
      try {
        window.sessionStorage.setItem('limiter.accessToken', 'token-1');
        window.sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 180_000));
        scheduleLimiterTokenRenewal();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(document.body.querySelector('iframe')).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('无令牌时不安排续签', async () => {
      vi.useFakeTimers();
      try {
        scheduleLimiterTokenRenewal();
        await vi.advanceTimersByTimeAsync(6_000);
        expect(document.body.querySelector('iframe')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('并发静默授权单飞：未完成期间两次调用共享同一 promise', async () => {
      const first = silentLimiterAuthorization();
      const second = silentLimiterAuthorization();
      expect(second).toBe(first);
      const iframe = document.body.querySelector('iframe');
      expect(iframe).toBeTruthy();
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe!.contentWindow,
        data: { type: 'limiter:pkce-silent-renew', ok: false }
      }));
      await expect(first).resolves.toBe(false);
    });

    it('静默回调只在同源 iframe 回传完整令牌后由主应用落位', async () => {
      const authorization = silentLimiterAuthorization();
      const iframe = document.body.querySelector('iframe');
      expect(iframe).toBeTruthy();

      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe!.contentWindow,
        data: {
          type: 'limiter:pkce-silent-renew',
          ok: true,
          accessToken: 'renewed-in-parent',
          expiresAt: Date.now() + 3600_000
        }
      }));

      await expect(authorization).resolves.toBe(true);
      expect(getLimiterAccessToken()).toBe('renewed-in-parent');
      expect(hasValidLimiterAccessToken()).toBe(true);
    });

    it('静默回调缺少令牌时拒绝重试，避免匿名请求伪装成续签成功', async () => {
      const authorization = silentLimiterAuthorization();
      const iframe = document.body.querySelector('iframe');
      expect(iframe).toBeTruthy();

      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe!.contentWindow,
        data: { type: 'limiter:pkce-silent-renew', ok: true }
      }));

      await expect(authorization).resolves.toBe(false);
      expect(getLimiterAccessToken()).toBeNull();
    });
  });
});


describe('授权熔断：新令牌连续被拒不跳 PKCE 风暴', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('新授权令牌 30 秒内被拒两次后进入熔断，begin 授权被拦截', async () => {
    window.sessionStorage.setItem('limiter.accessToken', 'fresh-token');
    window.sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 3600_000));
    window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now() - 5_000));

    resetLimiterUnauthorizedRecovery();
    // 第二次新令牌被拒（lastAuthAt 由授权链重写，这里再次模拟刚授权状态）
    window.sessionStorage.setItem('limiter.accessToken', 'fresh-token-2');
    window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now() - 3_000));
    resetLimiterUnauthorizedRecovery();

    expect(isLimiterAuthorizationSuspended()).toBe(true);
    await expect(beginLimiterAuthorization('/policies')).rejects.toThrow('已暂停自动授权');
  });

  it('旧令牌被拒不计入熔断：仅清状态走常规恢复', () => {
    window.sessionStorage.setItem('limiter.accessToken', 'stale-token');
    window.sessionStorage.setItem('limiter.lastAuthAt', String(Date.now() - 10 * 60_000));

    resetLimiterUnauthorizedRecovery();
    expect(isLimiterAuthorizationSuspended()).toBe(false);
  });

  it('熔断超时后自动解除', () => {
    window.sessionStorage.setItem('limiter.auth.suspendedUntil', String(Date.now() - 1_000));
    expect(isLimiterAuthorizationSuspended()).toBe(false);
  });

  it('人工清除熔断后可再次授权', async () => {
    window.sessionStorage.setItem('limiter.auth.suspendedUntil', String(Date.now() + 60_000));
    expect(isLimiterAuthorizationSuspended()).toBe(true);
    clearLimiterAuthorizationSuspension();
    expect(isLimiterAuthorizationSuspended()).toBe(false);
  });
});
