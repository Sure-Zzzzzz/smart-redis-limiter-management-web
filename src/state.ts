import { reactive } from 'vue';
import { resetPolicySession } from './api/policies';
import { LIMITER_PORTAL_IDENTITY_KEY } from './auth/pkce';

export interface PortalUser { subjectId?: string; id?: string | number; userId?: string | number; username?: string; displayName?: string }
export const portalState = reactive({ sessionVersion: 0, mounted: false });
function storage(): Storage | null { try { return window.top?.sessionStorage ?? window.sessionStorage; } catch { return null; } }
function readIdentity(): string | null { try { return storage()?.getItem(LIMITER_PORTAL_IDENTITY_KEY) ?? null; } catch { return null; } }
function writeIdentity(value: string): void { try { storage()?.setItem(LIMITER_PORTAL_IDENTITY_KEY, value); } catch { /* 存储不可用时不假设旧令牌的归属。 */ } }

export function applyPortalIdentity(user?: PortalUser | null): void {
  // 授权回调独立加载时没有门户身份参数，不因此删除同会话 verifier 或令牌。
  if (user === undefined) { portalState.mounted = true; return; }
  const next = user ? JSON.stringify([user.subjectId ?? '', user.id ?? user.userId ?? '', user.username ?? '']) : '';
  if (next !== readIdentity()) {
    resetPolicySession();
    portalState.sessionVersion += 1;
  }
  writeIdentity(next);
  portalState.mounted = true;
}

export function releasePortalIdentity(): void {
  resetPolicySession(false);
  portalState.sessionVersion += 1;
  portalState.mounted = false;
}
