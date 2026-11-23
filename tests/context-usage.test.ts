import test from 'node:test';
import assert from 'node:assert/strict';
import { contextUsagePercent, formatContextTokens, parseContextWindowUsage } from '../shared/contextUsage';

test('context usage uses native last.totalTokens, never accumulated total', () => {
  const result = parseContextWindowUsage({
    last: { totalTokens: 97_000, inputTokens: 90_000 },
    total: { totalTokens: 3_000_000 },
    modelContextWindow: 258_000,
  });
  assert.deepEqual(result, { usedTokens: 97_000, windowTokens: 258_000 });
  assert.equal(contextUsagePercent(result!), 38);
  assert.equal(formatContextTokens(result!.usedTokens), '97k');
});

test('context can shrink after native compaction and unknown data remains unknown', () => {
  assert.equal(contextUsagePercent({ usedTokens: 1_000, windowTokens: 10_000 }), 10);
  assert.equal(contextUsagePercent({ usedTokens: 20_000, windowTokens: 10_000 }), 100);
  assert.equal(parseContextWindowUsage({ total: { totalTokens: 12_000 }, modelContextWindow: 20_000 }), null);
  assert.equal(parseContextWindowUsage({ last: { totalTokens: -1 }, modelContextWindow: 20_000 }), null);
  assert.equal(parseContextWindowUsage({ last: { totalTokens: 200 }, modelContextWindow: null }), null);
});
