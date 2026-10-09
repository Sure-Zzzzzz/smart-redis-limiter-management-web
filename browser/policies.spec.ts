import { test, expect, type Page } from '@playwright/test';
interface MockPolicy { id: number; key: { serviceCode: string; resourceCode: string; subject: string }; limits: { count: number; window: number; unit: string }[]; enabled: boolean; rowVersion: number; createdAt: string; updatedAt: string }
const original: MockPolicy = { id: 1, key: { serviceCode: 'orders', resourceCode: 'create-order', subject: '*' }, limits: [{ count: 100, window: 1, unit: 'MINUTES' }], enabled: true, rowVersion: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
async function fixture(page: Page, options: { pageAllowed?: boolean; canWrite?: boolean; fail?: number; conflict?: boolean; longSubject?: boolean; many?: boolean } = {}) {
  let policies = [structuredClone(original)];
  if (options.many) policies = Array.from({ length: 45 }, (_, i) => ({ ...structuredClone(original), id: i + 1, key: { ...original.key, subject: `subject-${i + 1}` } }));
  if (options.longSubject) policies[0]!.key.subject = 'subject-'.repeat(32);
  let writeConflict = options.conflict ?? false;
  const calls: { method: string; body: unknown; url: string }[] = [];
  await page.addInitScript(() => {
    if (window.self !== window.top) return;
    sessionStorage.setItem('limiter.accessToken', 'mock-person-token');
    sessionStorage.setItem('limiter.accessTokenExpiresAt', String(Date.now() + 3600000));
    const actual = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('/api/limiter/')) {
        if (init?.credentials !== 'omit') throw new Error('业务请求不得发送Cookie');
      }
      return actual(input, init);
    };
  });
  await page.route('**/api/limiter/v1/policy**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON() as { key?: MockPolicy['key']; limits?: MockPolicy['limits']; enabled?: boolean; expectedRowVersion?: number } | null;
    calls.push({ method, body, url: url.pathname + url.search });
    expect(request.headers()['authorization']).toBe('Bearer mock-person-token');
    const json = async (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname.endsWith('/capabilities')) return json({ pageAllowed: options.pageAllowed ?? true, canWrite: (options.canWrite ?? true) && url.searchParams.get('serviceCode') !== 'denied' });
    if (options.fail) return json({}, options.fail);
    const id = Number(url.pathname.split('/').at(-1));
    if (method === 'GET' && !id) {
      const items = policies.filter(policy => ['serviceCode', 'resourceCode', 'subject'].every(key => !url.searchParams.get(key) || policy.key[key as keyof MockPolicy['key']] === url.searchParams.get(key))
        && (!url.searchParams.get('enabled') || String(policy.enabled) === url.searchParams.get('enabled')));
      const currentPage = Number(url.searchParams.get('page')) || 1;
      const pageSize = Number(url.searchParams.get('size')) || 20;
      return json({ items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize), page: currentPage, size: pageSize, totalElements: items.length, totalPages: Math.ceil(items.length / pageSize) });
    }
    if (method === 'GET') return policies.find(policy => policy.id === id) ? json(policies.find(policy => policy.id === id)) : json({}, 404);
    if (method === 'POST') {
      const policy = { ...structuredClone(original), id: 2, key: body!.key!, limits: body!.limits!, enabled: body!.enabled! };
      policies.push(policy);
      return json({ policy, deletedPolicyKey: null, revision: 1, changed: true }, 201);
    }
    const policy = policies.find(policy => policy.id === id)!;
    if (writeConflict && method === 'PUT') { writeConflict = false; policy.rowVersion += 1; policy.limits[0]!.count = 150; return json({}, 409); }
    if (method === 'DELETE') { policies = policies.filter(policy => policy.id !== id); return json({ policy: null, deletedPolicyKey: policy.key, revision: 3, changed: true }); }
    policy.rowVersion += 1;
    if (method === 'PUT') policy.limits = body!.limits!;
    if (method === 'PATCH') policy.enabled = body!.enabled!;
    return json({ policy, deletedPolicyKey: null, revision: 2, changed: true });
  });
  return calls;
}
test('列表筛选、新建、完整更新、启停和删除闭环', async ({ page }) => {
  const calls = await fixture(page);
  await page.goto('/app/limiter-management/policies');
  await expect(page.getByRole('heading', { name: '限流策略', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '详情' })).toBeVisible();
  await page.getByLabel('资源编码', { exact: true }).fill('absent');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('没有匹配的策略', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByRole('link', { name: '详情' })).toBeVisible();
  await page.screenshot({ path: 'test-results/policies-desktop.png', fullPage: true });
  await page.getByRole('link', { name: '新建策略' }).click();
  await page.getByLabel('服务编码', { exact: true }).fill('orders');
  await page.getByLabel('资源编码', { exact: true }).fill('read-order');
  await page.getByLabel('对象', { exact: true }).fill('customer-1');
  await expect(page.getByRole('button', { name: '创建策略', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '添加窗口' }).click();
  await page.getByLabel('窗口 2 时长', { exact: true }).fill('2');
  await page.getByRole('button', { name: '创建策略', exact: true }).click();
  await expect(page).toHaveURL(/\/policies\/2$/);
  await page.getByLabel('窗口 1 请求上限', { exact: true }).fill('200');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('策略已保存');
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.getByRole('button', { name: '启用', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除策略', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '删除', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeFocused();
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page).toHaveURL(/\/policies$/);
  expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ limits: [{ count: 100, window: 1, unit: 'MINUTES' }, { count: 100, window: 2, unit: 'MINUTES' }] });
  expect(calls.find(call => call.method === 'PUT')?.body).toMatchObject({ expectedRowVersion: 0 });
  expect(calls.find(call => call.method === 'DELETE')?.url).toContain('expectedRowVersion=2');
});
test('无PAGE不调用列表和详情', async ({ page }) => {
  const calls = await fixture(page, { pageAllowed: false });
  await page.goto('/app/limiter-management/policies/1');
  await expect(page.getByRole('heading', { name: '无权访问限流策略' })).toBeVisible();
  expect(calls).toHaveLength(1);
});
test('实际API403不重新授权', async ({ page }) => {
  let oauthCalls = 0;
  await page.route('**/oauth2/**', async route => { oauthCalls += 1; await route.abort(); });
  const calls = await fixture(page, { fail: 403 });
  await page.goto('/app/limiter-management/policies');
  await expect(page.getByRole('heading', { name: '无权访问限流策略' })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(oauthCalls).toBe(0);
  expect(page.url()).toContain('/app/limiter-management/policies');
});
test('分页与每页条数使用1起点完整契约', async ({ page }) => {
  const calls = await fixture(page, { many: true });
  await page.goto('/app/limiter-management/policies');
  await expect(page.getByText('subject-1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('subject-21', { exact: true })).toBeVisible();
  expect(calls.at(-1)?.url).toContain('page=2');
  await page.getByLabel('每页条数').click();
  await page.getByRole('option', { name: '10 条/页', exact: true }).click();
  await expect(page.getByText('subject-1', { exact: true })).toBeVisible();
  expect(calls.at(-1)?.url).toContain('page=1&size=10');
});
test('只读用户详情完整但没有写命令', async ({ page }) => {
  await fixture(page, { canWrite: false });
  await page.goto('/app/limiter-management/policies/1');
  await expect(page.getByLabel('窗口 1 请求上限')).toHaveValue('100');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除策略', exact: true })).toHaveCount(0);
});
test('409保留编辑并显式比较后按最新版本写回', async ({ page }) => {
  const calls = await fixture(page, { conflict: true });
  await page.goto('/app/limiter-management/policies/1');
  await page.getByLabel('窗口 1 请求上限').fill('222');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '策略发生并发变更' })).toBeVisible();
  await expect(page.getByLabel('窗口 1 请求上限')).toHaveValue('222');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.getByRole('heading', { name: '最新窗口 · 版本 1' })).toBeVisible();
  await page.getByRole('button', { name: '保留当前编辑，使用最新版本' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('策略已保存');
  expect(calls.filter(call => call.method === 'PUT').at(-1)?.body).toMatchObject({ expectedRowVersion: 1, limits: [{ count: 222 }] });
});
test('新建服务变更同步关闭旧写权限，最多16窗口', async ({ page }) => {
  await fixture(page);
  await page.goto('/app/limiter-management/policies/new');
  await page.getByLabel('服务编码', { exact: true }).fill('orders');
  await expect(page.getByRole('button', { name: '创建策略', exact: true })).toBeEnabled();
  await page.getByLabel('服务编码', { exact: true }).fill('denied');
  await expect(page.getByRole('button', { name: '创建策略', exact: true })).toBeDisabled();
  for (let i = 1; i < 16; i++) await page.getByRole('button', { name: '添加窗口' }).click();
  await expect(page.getByLabel('窗口 16 时长')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加窗口' })).toBeDisabled();
});
test('手机表格局部滚动；长对象弹层不溢出，关闭恢复滚动和焦点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { longSubject: true });
  await page.goto('/app/limiter-management/policies');
  await expect(page.getByRole('link', { name: '详情' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.data-table-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/policies-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '详情' }).click();
  await page.getByRole('button', { name: '删除策略', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/delete-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '删除策略', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});
test('后端错误不伪装为空列表且重试可恢复', async ({ page }) => {
  await fixture(page, { fail: 500 });
  await page.goto('/app/limiter-management/policies');
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await expect(page.getByText('没有匹配的策略', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(page.url()).not.toContain('/oauth2/');
});
test('qiankun真实生命周期：增量props不误清身份，卸载/不同身份重挂载取消旧状态', async ({ page }) => {
  await page.addInitScript(() => {
    if (window.self !== window.top) return;
    const host = window as unknown as { __POWERED_BY_QIANKUN__: boolean; qiankunName: string };
    host.__POWERED_BY_QIANKUN__ = true;
    host.qiankunName = 'limiter-management';
    sessionStorage.setItem('limiter.portalIdentity', JSON.stringify(['subject-a', '', 'a']));
  });
  const calls = await fixture(page);
  await page.route('**/oauth2/authorize?**', route => route.fulfill({ contentType: 'text/html', body: `<script>top.postMessage({type:'limiter:pkce-silent-renew',ok:true,accessToken:'mock-person-token',expiresAt:Date.now()+3600000},location.origin)</script>` }));
  await page.goto('/app/limiter-management/policies');
  await page.waitForFunction(() => !!(window as unknown as { moudleQiankunAppLifeCycles?: Record<string, unknown> }).moudleQiankunAppLifeCycles?.['limiter-management']);
  await page.evaluate(() => {
    const life = (window as unknown as { moudleQiankunAppLifeCycles: Record<string, { mount(props: unknown): void }> }).moudleQiankunAppLifeCycles['limiter-management']!;
    life.mount({ container: document, currentUser: { subjectId: 'subject-a', username: 'a' } });
  });
  await expect(page.getByRole('link', { name: '详情' })).toBeVisible();
  const before = calls.length;
  await page.evaluate(() => (window as unknown as { moudleQiankunAppLifeCycles: Record<string, { update(props: unknown): void }> }).moudleQiankunAppLifeCycles['limiter-management']!.update({ apiBase: '/api/limiter' }));
  expect(await page.evaluate(() => sessionStorage.getItem('limiter.accessToken'))).toBe('mock-person-token');
  expect(calls.length).toBe(before);
  await page.evaluate(() => {
    const life = (window as unknown as { moudleQiankunAppLifeCycles: Record<string, { unmount(): void; mount(props: unknown): void }> }).moudleQiankunAppLifeCycles['limiter-management']!;
    life.unmount();
    life.mount({ container: document, currentUser: { subjectId: 'subject-b', username: 'b' } });
  });
  await expect(page.getByRole('link', { name: '详情' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('limiter.portalIdentity'))).toBe(JSON.stringify(['subject-b', '', 'b']));
  expect(calls.length).toBeGreaterThan(before);
  await page.evaluate(() => (window as unknown as { moudleQiankunAppLifeCycles: Record<string, { unmount(): void }> }).moudleQiankunAppLifeCycles['limiter-management']!.unmount());
  await expect(page.locator('.limiter-management-app')).toHaveCount(0);
  expect(await page.locator('iframe').count()).toBe(0);
});
