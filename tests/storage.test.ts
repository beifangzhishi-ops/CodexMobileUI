import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedWriteQueue } from '../src/storage/writeQueue';

test('same-thread draft writes are ordered; a cleared draft cannot be restored by older writes', async () => {
  const queue = createKeyedWriteQueue();
  const writes: string[] = [];
  const first = queue('host:thread', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    writes.push('first keystroke');
  });
  const second = queue('host:thread', async () => { writes.push('last keystroke'); });
  const cleared = queue('host:thread', async () => { writes.push(''); });
  await Promise.all([first, second, cleared]);
  assert.deepEqual(writes, ['first keystroke', 'last keystroke', '']);
});

test('failed draft write does not block subsequent saves', async () => {
  const queue = createKeyedWriteQueue();
  const failure = queue('one', async () => { throw new Error('database temporarily busy'); });
  const recovery = queue('one', async () => {});
  await assert.rejects(failure, /database temporarily busy/);
  await assert.doesNotReject(recovery);
});
