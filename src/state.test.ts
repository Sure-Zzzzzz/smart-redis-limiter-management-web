import { afterEach, describe, expect, it } from 'vitest';
import { applyPortalIdentity, portalState, releasePortalIdentity } from './state';
afterEach(() => { releasePortalIdentity(); sessionStorage.clear(); });
describe('门户身份仅用于隔离数据', () => {
  it('同身份展示名变化不清token，A→B→A每次同步推进版本并清token', () => {
    applyPortalIdentity({ subjectId: 'subject-a', username: 'a', displayName: '甲' });
    const initial = portalState.sessionVersion;
    sessionStorage.setItem('limiter.accessToken', 'token-a');
    applyPortalIdentity({ subjectId: 'subject-a', username: 'a', displayName: '新名称' });
    expect(portalState.sessionVersion).toBe(initial);
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('token-a');
    applyPortalIdentity({ subjectId: 'subject-b', username: 'b' });
    expect(portalState.sessionVersion).toBe(initial + 1);
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
    sessionStorage.setItem('limiter.accessToken', 'token-b');
    applyPortalIdentity({ subjectId: 'subject-a', username: 'a' });
    expect(portalState.sessionVersion).toBe(initial + 2);
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
  });
  it('卸载保留同会话token供回调/重挂载使用，但不保留身份标记', () => {
    applyPortalIdentity({ userId: 1, username: 'a' });
    sessionStorage.setItem('limiter.accessToken', 'token-a');
    releasePortalIdentity();
    expect(portalState.mounted).toBe(false);
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('token-a');
    applyPortalIdentity({ id: 1, username: 'a' });
    expect(portalState.mounted).toBe(true);
  });
  it('人员转为空身份清除旧token', () => {
    applyPortalIdentity({ id: 1 });
    sessionStorage.setItem('limiter.accessToken', 'token-a');
    applyPortalIdentity(null);
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
  });
  it('A卸载后B挂载必须清A令牌，回调无身份props不能清verifier', () => {
    applyPortalIdentity({ subjectId: 'a' });
    sessionStorage.setItem('limiter.accessToken', 'token-a');
    sessionStorage.setItem('limiter.pkce.state', 'verifier-a');
    releasePortalIdentity();
    applyPortalIdentity();
    expect(sessionStorage.getItem('limiter.accessToken')).toBe('token-a');
    expect(sessionStorage.getItem('limiter.pkce.state')).toBe('verifier-a');
    applyPortalIdentity({ subjectId: 'b' });
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
    expect(sessionStorage.getItem('limiter.pkce.state')).toBe('verifier-a');
  });
  it('同会话持久化身份支持模块重新加载后的归属核验', () => {
    sessionStorage.setItem('limiter.portalIdentity', JSON.stringify(['a', '', '']));
    sessionStorage.setItem('limiter.accessToken', 'token-a');
    applyPortalIdentity({ subjectId: 'b' });
    expect(sessionStorage.getItem('limiter.accessToken')).toBeNull();
    expect(sessionStorage.getItem('limiter.portalIdentity')).toBe(JSON.stringify(['b', '', '']));
  });
});
