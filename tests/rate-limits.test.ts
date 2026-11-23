import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRateQuota, quotaPercent, quotaResetLabel } from '../shared/rateLimits';

const window = (usedPercent: number, windowDurationMins: number) =>
  ({ usedPercent, windowDurationMins, resetsAt: 1780000000 });

test('rate quotas resolve 5-hour and weekly windows by duration, not field position', () => {
  const result = parseRateQuota({ rateLimits: {
    primary: window(35, 10080), secondary: window(20, 300),
  } }, 123);
  assert.equal(quotaPercent(result, 'fiveHour'), 80);
  assert.equal(quotaPercent(result, 'weekly'), 65);
  assert.equal(result?.weeklyUnlimited, false);
  assert.equal(result?.updatedAt, 123);
});

test('missing weekly limit is full only when a valid 5-hour bucket proves the snapshot', () => {
  const result = parseRateQuota({ rateLimits: { primary: window(60, 300), secondary: null } });
  assert.equal(quotaPercent(result, 'weekly'), 100);
  assert.equal(quotaResetLabel(result, 'weekly'), '无每周额度限制');
  assert.equal(quotaPercent(result, 'fiveHour'), 40);
  assert.equal(quotaPercent(parseRateQuota({}), 'weekly'), null);
  assert.equal(quotaPercent(parseRateQuota({ rateLimits: {} }), 'weekly'), null);
});

test('weekly-only plans show their real weekly usage instead of treating primary as 5h', () => {
  const result = parseRateQuota({ rateLimits: { primary: window(11.2, 10080), secondary: null } });
  assert.equal(quotaPercent(result, 'fiveHour'), null);
  assert.equal(quotaPercent(result, 'weekly'), 89);
});

test('prefers codex bucket and rejects malformed percentages', () => {
  const result = parseRateQuota({ rateLimits: { primary: window(99, 300) },
    rateLimitsByLimitId: { codex: { primary: window(-50, 300), secondary: window(200, 10080) } } });
  assert.equal(quotaPercent(result, 'fiveHour'), 100);
  assert.equal(quotaPercent(result, 'weekly'), 0);
  assert.equal(quotaPercent(parseRateQuota({ rateLimits: { primary: window(NaN, 300) } }), 'fiveHour'), null);
});
