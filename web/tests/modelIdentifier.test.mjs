import test from 'node:test';
import assert from 'node:assert/strict';
import { validModelIdentifier } from '../server/modelIdentifier.mjs';

test('native model ids accept catalog namespaced models for all Web Bridge flows', () => {
  for (const id of ['gpt-6', 'ds/deepseek-flash', 'provider/model.v2', 'a/b/c']) {
    assert.equal(validModelIdentifier(id), true, id);
  }
});

test('native model ids reject unbounded or unsafe values', () => {
  for (const id of ['', '/ds', 'ds/', 'ds//model', 'ds/../model', 'ds/./model',
    '../model', 'model?key=secret', 'model#fragment', 'model\\path', 'with space',
    'model\nname', 'x'.repeat(81), null, 3]) {
    assert.equal(validModelIdentifier(id), false, String(id));
  }
});
