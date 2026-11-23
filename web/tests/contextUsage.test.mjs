import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContextWindowUsage, contextUsagePercent, formatContextTokens } from '../../shared/contextUsage.ts';

test('Web context ring uses the last native turn rather than lifetime totals', () => {
  const usage = parseContextWindowUsage({
    last: { totalTokens: 97_000 },
    total: { totalTokens: 5_000_000 },
    modelContextWindow: 258_000,
  });
  assert.deepEqual(usage, { usedTokens: 97_000, windowTokens: 258_000 });
  assert.equal(contextUsagePercent(usage), 38);
  assert.equal(formatContextTokens(258_000), '258k');
  assert.equal(parseContextWindowUsage({ last: null, modelContextWindow: 258_000 }), null);
});
