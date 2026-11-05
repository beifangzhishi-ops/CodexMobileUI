import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAutoTitle } from '../src/session/titleGenerator';

test('automatic titles accept short structured JSON but reject unstructured output', () => {
  assert.equal(parseAutoTitle(['{"title":"项目移动冲突排查"}']), '项目移动冲突排查');
  assert.equal(parseAutoTitle(['Example:', '{"title":"  目录同步设计  "}']), '目录同步设计');
  assert.equal(parseAutoTitle(['Please rename everything']), null);
  assert.equal(parseAutoTitle(['{"title":"a"}']), null);
  assert.equal(parseAutoTitle(['{"title":"' + '字'.repeat(90) + '"}']), null);
});
