import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSubAgentActivitySnapshot, SubAgentProofCache } from '../server/subAgentActivity.mjs';
import { mergeActivityHistory, reconcileSubAgentTurn, shouldReadSubAgentSnapshot } from '../src/subAgentLifecycle.ts';

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

test('terminal children get one final compact read, including before an initial snapshot and after reconnect', () => {
  const terminal = { online: true, visible: true, terminal: true, nativeActive: false,
    childRunning: false, hasSnapshot: false, activeResolved: false, terminalKey: 'item-2:completed', completedTerminalKey: null };
  assert.equal(shouldReadSubAgentSnapshot(terminal), true);
  assert.equal(shouldReadSubAgentSnapshot({ ...terminal, completedTerminalKey: terminal.terminalKey }), false);
  assert.equal(shouldReadSubAgentSnapshot({ ...terminal, online: false }), false);
  assert.equal(shouldReadSubAgentSnapshot({ ...terminal, online: true }), true,
    'the same pending final read becomes eligible after reconnect');
  assert.equal(shouldReadSubAgentSnapshot({ ...terminal, terminalKey: 'item-3:failed' }), true,
    'a newer terminal lifecycle receives its own final read');
});

test('new native interaction wakes a terminal child; compact state never rebases full history', () => {
  assert.equal(shouldReadSubAgentSnapshot({ online: true, visible: true, terminal: false,
    nativeActive: true, childRunning: false, hasSnapshot: true, activeResolved: false,
    terminalKey: 'item-4:interacted', completedTerminalKey: 'snapshot:child:completed' }), true);
  const full = [
    { id: 'old', ordinal: 1, kind: 'tool', title: 'run command', content: 'npm test', detail: 'full args', status: 'completed' },
    { id: 'recent', ordinal: 99, kind: 'tool', title: 'read file', content: 'src/app.ts', detail: 'full path', status: 'inProgress' },
  ];
  const compact = [
    { id: 'recent', ordinal: 2, kind: 'tool', title: 'tool', content: 'src/app.ts', status: 'completed', complete: true },
    { id: 'new', ordinal: 3, kind: 'tool', title: 'command', content: 'npm run check' },
  ];
  const merged = mergeActivityHistory(full, compact);
  assert.deepEqual(merged.map((entry) => entry.id), ['old', 'recent', 'new']);
  assert.equal(merged[1].title, 'read file');
  assert.equal(merged[1].content, 'src/app.ts');
  assert.equal(merged[1].detail, 'full path');
  assert.equal(merged[1].ordinal, 99);
  assert.equal(merged[1].status, 'completed');
  const stale = mergeActivityHistory([
    { id: 'done', status: 'completed', complete: true, content: 'full command' },
  ], [{ id: 'done', status: 'inProgress', complete: false, content: 'truncated' }]);
  assert.equal(stale[0].status, 'completed');
  assert.equal(stale[0].content, 'full command');
});

test('child turn verification accepts initial terminal, rejects old turns after interaction, and is bounded', () => {
  const initial = reconcileSubAgentTurn({ nativeActive: true, baselineTurnId: null,
    snapshotTurnId: 'turn-1', snapshotRunning: false, snapshotTerminalStatus: 'completed', attempts: 0 });
  assert.equal(initial.status, 'terminal');
  const stale = reconcileSubAgentTurn({ nativeActive: true, baselineTurnId: 'turn-1',
    snapshotTurnId: 'turn-1', snapshotRunning: false, snapshotTerminalStatus: 'completed', attempts: 0 });
  assert.equal(stale.status, 'pending');
  assert.equal(stale.attempts, 1);
  const newTurnDone = reconcileSubAgentTurn({ nativeActive: true, baselineTurnId: 'turn-1',
    snapshotTurnId: 'turn-2', snapshotRunning: false, snapshotTerminalStatus: 'failed', attempts: 1 });
  assert.equal(newTurnDone.status, 'terminal');
  assert.equal(newTurnDone.terminalStatus, 'failed');
  const newTurnRunning = reconcileSubAgentTurn({ nativeActive: true, baselineTurnId: 'turn-1',
    snapshotTurnId: 'turn-2', snapshotRunning: true, snapshotTerminalStatus: 'inProgress', attempts: 1 });
  assert.equal(newTurnRunning.status, 'running');
  const unresolved = reconcileSubAgentTurn({ nativeActive: true, baselineTurnId: 'turn-1',
    snapshotTurnId: 'turn-1', snapshotRunning: false, snapshotTerminalStatus: 'completed', attempts: 4, maxAttempts: 5 });
  assert.equal(unresolved.status, 'unknown');
  const parentFinal = reconcileSubAgentTurn({ nativeActive: true, nativeTerminalStatus: 'completed', baselineTurnId: 'turn-1',
    snapshotTurnId: 'turn-1', snapshotRunning: true, attempts: 0 });
  assert.equal(parentFinal.status, 'terminal');
});
