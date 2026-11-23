import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWebAutoTitle } from '../gateway/webTitleService';

test('web auto titles respect the 36-character structured-title limit', () => {
  assert.equal(parseWebAutoTitle(['{"title":"网页历史对话同步"}']), '网页历史对话同步');
  assert.equal(parseWebAutoTitle(['note\n{"title":"  网页文件预览排查  "}']), '网页文件预览排查');
  assert.equal(parseWebAutoTitle(['not json']), null);
  assert.equal(parseWebAutoTitle(['{"title":"查"}']), '查');
  assert.equal(parseWebAutoTitle(['{"title":"' + '中'.repeat(36) + '"}']), '中'.repeat(36));
  assert.equal(parseWebAutoTitle(['{"title":"' + '中'.repeat(37) + '"}']), null);
  assert.equal(parseWebAutoTitle(['{"title":"bad\\nline"}']), 'bad line');
});
