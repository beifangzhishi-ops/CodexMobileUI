import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHosts } from '../src/hostRegistry.ts';
const hosts = [{ id: '6v', displayName: '6v' }, { id: 'noha', displayName: 'noha' },
  { id: 'third-pc', displayName: 'Third' }];
test('frontend roster uses Coordinator identities and labels, including a third host', () => {
  assert.deepEqual(parseHosts({ primaryHostId: '6v', hosts }), hosts);
  assert.throws(() => parseHosts({ primaryHostId: '6v', hosts: [hosts[0], hosts[0]] }));
  assert.throws(() => parseHosts({ primaryHostId: '6v', hosts: hosts.slice(1) }));
  assert.throws(() => parseHosts({ primaryHostId: '6v', hosts: [hosts[0], { id: 'constructor', displayName: 'bad' }] }));
});
