import { TIME_UNITS, type PolicyLimit } from './api/policies';

export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function validatePolicyForm(serviceCode: string, resourceCode: string, subject: string, limits: PolicyLimit[]): string {
  if (!CODE_PATTERN.test(serviceCode) || !CODE_PATTERN.test(resourceCode)) return '服务、资源编码须为 1–128 位字母、数字、点、下划线或短横线，首位为字母或数字';
  const hasControl = [...subject].some(char => { const code = char.charCodeAt(0); return code <= 31 || (code >= 127 && code <= 159); });
  if (!subject.trim() || subject !== subject.trim() || subject.length > 256 || hasControl) return '对象须为 1–256 个字符且无首尾空格或控制字符';
  if (limits.length < 1 || limits.length > 16) return '限额窗口须为 1–16 个';
  const windows = new Set<number>();
  const multiplier = { SECONDS: 1, MINUTES: 60, HOURS: 3600, DAYS: 86400 };
  for (const limit of limits) {
    if (!TIME_UNITS.includes(limit.unit) || !Number.isSafeInteger(limit.window) || limit.window < 1
      || !Number.isSafeInteger(limit.count) || limit.count < 1) return '时长和请求上限须为可精确表示的正整数';
    const seconds = limit.window * multiplier[limit.unit];
    if (!Number.isSafeInteger(seconds)) return '窗口时长超过浏览器安全整数范围';
    if (windows.has(seconds)) return '限额窗口时长不能重复';
    windows.add(seconds);
  }
  return '';
}
