import assert from 'node:assert/strict';
import { listSiteAdapters } from '../lib/site-adapters.mjs';

const expected = new Set([
  'agirobot.jobs.feishu.cn',
  'zhaopin.meituan.com',
  'hr-campus.vivo.com',
  'join.qq.com',
  'talent.baidu.com',
  'careers.oppo.com',
]);

const adapters = await listSiteAdapters();
for (const adapter of adapters) {
  assert.equal(typeof adapter.domain, 'string');
  assert.equal(typeof adapter.formSignature, 'string');
  const serialized = JSON.stringify(adapter);
  assert.doesNotMatch(serialized, /"(cookies?|tokens?|password|value|phoneNumber|emailAddress)"\s*:/i, `${adapter.domain} must contain structure only`);
  assert.doesNotMatch(serialized, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/, `${adapter.domain} must not contain personal values`);
  assert.doesNotMatch(serialized, /\/html\[|\/body\[/i, `${adapter.domain} must not use absolute XPath`);
  expected.delete(adapter.domain);
}
assert.deepEqual([...expected], []);
console.log('adapter tests passed');
