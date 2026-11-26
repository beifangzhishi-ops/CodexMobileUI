import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSubAgentActivitySnapshot, SubAgentProofCache } from '../server/subAgentActivity.mjs';

test('automatic child activity projection is bounded, identifying and omits tool outputs', () => {
  const raw = { thread: { id: 'child', name: 'Worker', turns: [{ id: 'turn', status: 'inProgress', items: [
    { id: 'command', type: 'commandExecution', status: 'inProgress', command: 'npm test',
      cwd: 'C:/repo', aggregatedOutput: 'secret raw output' },
    { id: 'mcp', type: 'dynamicToolCall', status: 'completed', server: 'catalog', tool: 'search',
      arguments: { token: 'never send' }, result: { raw: 'never send' } },
    { id: 'file', type: 'fileChange', status: 'completed', changes: [{ kind: 'edit', path: 'C:/repo/file.ts', diff: 'private diff' }] },
    { id: 'response', type: 'agentMessage', content: [{ type: 'text', text: 'prose excluded from live preview' }] },
  ] }] } };
  const projected = projectSubAgentActivitySnapshot(raw, 'child');
  const serialized = JSON.stringify(projected);
  assert.match(serialized, /npm test/);
  assert.match(serialized, /catalog/);
  assert.match(serialized, /C:\/repo\/file\.ts/);
  assert.doesNotMatch(serialized, /secret raw output|never send|private diff|prose excluded/);
  assert.equal(projected.thread.turns[0].items.length, 3);
  assert.throws(() => projectSubAgentActivitySnapshot(raw, 'other'), /AGENT_NOT_FOUND/);
});

test('child attachment proof cache uses pair identity, expires, bounds and invalidates parents', () => {
  let now = 0;
  const proofs = new SubAgentProofCache({ maxEntries: 2, ttlMs: 10, now: () => now });
  proofs.remember('a:b', 'c');
  proofs.remember('a', 'b:c');
  assert.equal(proofs.has('a:b', 'c'), true);
  assert.equal(proofs.has('a', 'b:c'), true);
  proofs.remember('third', 'child');
  assert.equal(proofs.has('a:b', 'c'), false);
  assert.equal(proofs.has('a', 'b:c'), true);
  proofs.invalidateParent('a');
  assert.equal(proofs.has('a', 'b:c'), false);
  now = 11;
  assert.equal(proofs.has('third', 'child'), false);
});
