import { describe, expect, it } from 'vitest';
import { validatePolicyForm } from './policyForm';
import type { PolicyLimit } from './api/policies';
const limits: PolicyLimit[] = [{ count: 100, window: 1, unit: 'MINUTES' }];
describe('策略表单精确契约', () => {
  it('接受精确标识和JavaScript安全整数内的大窗口', () => {
    expect(validatePolicyForm('orders', 'create-order', '*', limits)).toBe('');
    expect(validatePolicyForm('orders', 'create-order', 'subject', [{ count: 1, window: 2147483648, unit: 'SECONDS' }])).toBe('');
  });
  it('拒绝相同秒数的不同单位窗口', () => {
    expect(validatePolicyForm('a', 'b', '*', [...limits, { count: 200, window: 60, unit: 'SECONDS' }])).toContain('重复');
  });
  it.each(['', ' bad', 'bad ', 'a/b', '-bad', 'x'.repeat(129)])('拒绝非法服务标识 %s', service => {
    expect(validatePolicyForm(service, 'b', '*', limits)).not.toBe('');
  });
  it.each(['', ' ', 'x\u0001y', 'x\u0085y', 'x'.repeat(257)])('拒绝空或控制字符对象', subject => {
    expect(validatePolicyForm('a', 'b', subject, limits)).not.toBe('');
  });
  it('拒绝超精度、浮点、非有限和超过16的窗口', () => {
    for (const count of [0, -1, .1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validatePolicyForm('a', 'b', '*', [{ count, window: 1, unit: 'SECONDS' }])).not.toBe('');
    }
    expect(validatePolicyForm('a', 'b', '*', Array.from({ length: 17 }, (_, i) => ({ count: 1, window: i + 1, unit: 'SECONDS' })))).toContain('16');
    expect(validatePolicyForm('a', 'b', '*', [{ count: 1, window: Number.MAX_SAFE_INTEGER, unit: 'DAYS' }])).toContain('安全整数');
  });
});
