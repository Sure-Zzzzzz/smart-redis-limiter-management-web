import { describe, expect, it } from 'vitest';
import { limitLines, limitShortText, limitSummary, selectorEffectLabel, selectorShortLabel, typedRuleToYaml, type TypedRule } from './typedPolicies';
import type { PolicyLimit } from './policies';

describe('选择器标签与效果句', () => {
  it('紧凑标签：DEFAULT 按维度短词，EXACT 统一为指定对象', () => {
    expect(selectorShortLabel('DEFAULT', 'RESOURCE')).toBe('全资源总量');
    expect(selectorShortLabel('DEFAULT', 'IP')).toBe('按 IP 分计');
    expect(selectorShortLabel('DEFAULT', 'USER')).toBe('按人员分计');
    expect(selectorShortLabel('DEFAULT', 'SERVICE')).toBe('按服务分计');
    expect(selectorShortLabel('DEFAULT', 'CREDENTIAL')).toBe('按凭据分计');
    expect(selectorShortLabel('DEFAULT', 'CUSTOMER')).toBe('按客户分计');
    expect(selectorShortLabel('DEFAULT', 'CUSTOM')).toBe('按对象分计');
    expect(selectorShortLabel('EXACT', 'IP')).toBe('指定对象');
  });
  it('效果句保持完整语义（详情与编辑器提示用）', () => {
    expect(selectorEffectLabel('DEFAULT', 'RESOURCE')).toBe('该资源总量');
    expect(selectorEffectLabel('DEFAULT', 'IP')).toBe('每个来源 IP各一份额度');
    expect(selectorEffectLabel('EXACT', 'USER')).toBe('仅此对象，单独设额');
  });
});

describe('限额摘要', () => {
  const one: PolicyLimit[] = [{ count: 30, window: 1, unit: 'MINUTES' }];
  it('单档直显"次数/单位"', () => {
    expect(limitShortText(one[0]!)).toBe('30 次/分');
    expect(limitSummary(one)).toBe('30 次/分');
  });
  it('多档主显最小时间窗并追加档数', () => {
    const limits: PolicyLimit[] = [
      { count: 1000, window: 1, unit: 'HOURS' },
      { count: 30, window: 1, unit: 'MINUTES' },
      { count: 5, window: 1, unit: 'SECONDS' }
    ];
    expect(limitSummary(limits)).toBe('5 次/秒 +2 档');
    expect(limitLines(limits)).toBe('1000 次/时；30 次/分；5 次/秒');
  });
  it('跨单位按秒数比较取最紧档', () => {
    const limits: PolicyLimit[] = [{ count: 100, window: 2, unit: 'MINUTES' }, { count: 90, window: 1, unit: 'MINUTES' }];
    expect(limitSummary(limits)).toBe('90 次/分 +1 档');
  });
  it('空档位回退占位符', () => {
    expect(limitSummary([])).toBe('—');
    expect(limitLines([])).toBe('');
  });
});

describe('规则等价 YAML', () => {
  const rule: TypedRule = {
    id: 1, serviceCode: 'aksk', resourceCode: 'oauth2-token', dimension: 'CUSTOMER', selector: 'DEFAULT',
    namespace: 'customer', customType: null, objectId: null, limits: [{ count: 100, window: 1, unit: 'MINUTES' }],
    enabled: true, rowVersion: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  };
  it('业务侧实装形态：typed.gates 配置树', () => {
    expect(typedRuleToYaml(rule)).toBe(
      'io:\n' +
      '  github:\n' +
      '    surezzzzzz:\n' +
      '      sdk:\n' +
      '        limiter:\n' +
      '          redis:\n' +
      '            smart:\n' +
      '              me: aksk\n' +
      '              typed:\n' +
      '                enabled: true\n' +
      '                expected-policy-epoch: 1\n' +
      '                gates:\n' +
      '                  - dimension: CUSTOMER\n' +
      '                    namespace: customer\n' +
      '                    limits:\n' +
      '                      - count: 100\n' +
      '                        window: 1\n' +
      '                        unit: MINUTES');
  });
  it('CUSTOM 门禁带 custom-type，多档位按序输出', () => {
    const exact: TypedRule = { ...rule, dimension: 'CUSTOM', selector: 'EXACT', customType: 'channel', objectId: 'channel-openapi', namespace: 'custom' };
    expect(typedRuleToYaml(exact)).toContain('                  - dimension: CUSTOM\n                    namespace: custom\n                    custom-type: channel');
    const multi: TypedRule = { ...rule, limits: [{ count: 30, window: 1, unit: 'MINUTES' }, { count: 1000, window: 1, unit: 'HOURS' }] };
    expect(typedRuleToYaml(multi)).toContain('                      - count: 30\n                        window: 1\n                        unit: MINUTES\n                      - count: 1000\n                        window: 1\n                        unit: HOURS');
  });
});
