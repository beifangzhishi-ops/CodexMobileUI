import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostFileError, readHostFile, writeHostFile } from '../gateway/hostFiles';

test('global AGENTS and config.toml use the actual dedicated CODEX_HOME, with CAS saves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-codex-files-'));
  const context = { homeRoot: root, readProject: async () => { throw new Error('not needed'); } };
  try {
    const rule = { kind: 'globalRules' };
    const original = await readHostFile(rule, context);
    assert.equal(original.exists, false);
    assert.equal(original.filename, 'AGENTS.md');
    assert.equal(original.revision, 'missing');
    assert.equal(original.text, '');
    const saved = await writeHostFile({ ...rule, text: '# Computer rules\n',
      revision: original.revision, filename: original.filename }, context);
    assert.equal(saved.exists, true);
    assert.equal(saved.text, '# Computer rules\n');
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), saved.text);
    assert.notEqual(saved.revision, original.revision);
    writeFileSync(join(root, 'AGENTS.md'), '# changed on computer\n');
    await assert.rejects(writeHostFile({ ...rule, text: 'overwrite',
      revision: saved.revision, filename: saved.filename }, context),
    (e: unknown) => e instanceof HostFileError && e.code === 'CONFLICT');
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# changed on computer\n');

    const config = { kind: 'config' };
    const configOriginal = await readHostFile(config, context);
    assert.equal(configOriginal.filename, 'config.toml');
    const configSaved = await writeHostFile({ ...config, text: 'model = "gpt-6"\n',
      revision: configOriginal.revision, filename: configOriginal.filename }, context);
    assert.equal(configSaved.text, readFileSync(join(root, 'config.toml'), 'utf8'));
    assert.equal((await readHostFile(config, context)).revision, configSaved.revision);
    await assert.rejects(writeHostFile({ ...config, filename: configSaved.filename,
      revision: configOriginal.revision, text: 'approval_policy = "never"' }, context),
    (e: unknown) => e instanceof HostFileError && e.code === 'CONFLICT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('override instructions take priority, and a new override conflicts with a stale draft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-rule-override-'));
  const context = { homeRoot: root, readProject: async () => { throw new Error('not needed'); } };
  try {
    writeFileSync(join(root, 'AGENTS.md'), '# Base');
    let read = await readHostFile({ kind: 'globalRules' }, context);
    assert.equal(read.filename, 'AGENTS.md');
    writeFileSync(join(root, 'AGENTS.override.md'), '# Override');
    await assert.rejects(writeHostFile({ kind: 'globalRules',
      text: '# Updated base', revision: read.revision, filename: read.filename }, context),
    (e: unknown) => e instanceof HostFileError && e.code === 'CONFLICT');
    read = await readHostFile({ kind: 'globalRules' }, context);
    assert.equal(read.filename, 'AGENTS.override.md');
    const saved = await writeHostFile({ kind: 'globalRules',
      text: '# Edited override', revision: read.revision, filename: read.filename }, context);
    assert.equal(saved.filename, 'AGENTS.override.md');
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Base');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('project rules resolve only the native project ID and selected native root', async () => {
  const base = mkdtempSync(join(tmpdir(), 'mobile-project-rule-'));
  const rootA = join(base, 'a');
  const rootB = join(base, 'b');
  mkdirSync(rootA); mkdirSync(rootB);
  const context = { homeRoot: join(base, 'isolated-home'), readProject: async (id: string) => ({
    project: { id: 'native-project', roots: [{ path: rootA }, { path: rootB }] },
  }) };
  try {
    const selected = { kind: 'projectRules', projectId: 'native-project', rootIndex: 1 };
    const state = await readHostFile(selected, context);
    assert.equal(state.path, join(rootB, 'AGENTS.md'));
    await writeHostFile({ ...selected, revision: state.revision,
      filename: state.filename, text: '# B-only' }, context);
    assert.equal(readFileSync(join(rootB, 'AGENTS.md'), 'utf8'), '# B-only');
    assert.notEqual((await readHostFile({ ...selected, rootIndex: 0 }, context)).text, '# B-only');
    for (const bad of [
      { kind: 'projectRules', projectId: '../Desktop' },
      { kind: 'projectRules', projectId: 'native-project', rootIndex: 4 },
      { kind: 'projectRules', projectId: 'wrong-project' },
      { kind: 'config', path: rootB },
      { kind: 'globalRules', projectId: 'native-project' },
    ]) await assert.rejects(readHostFile(bad, context));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('invalid saves reject excess content and never create their target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-invalid-config-'));
  const context = { homeRoot: root, readProject: async () => ({}) };
  try {
    await assert.rejects(writeHostFile({ kind: 'config', revision: 'missing',
      filename: 'config.toml', text: 'a'.repeat(262_145) }, context));
    await assert.rejects(writeHostFile({ kind: 'config', revision: 'missing',
      filename: 'config.toml', text: 'test\0invalid' }, context));
    await assert.rejects(writeHostFile({ kind: 'config', revision: 'missing',
      filename: 'AGENTS.md', text: 'test' }, context));
    assert.equal((await readHostFile({ kind: 'config' }, context)).exists, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
