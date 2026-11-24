import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVisualize } from '../gateway/visualize';
import { visualizeReferences } from '../shared/visualizeReferences';

const marker = (path: string) =>
  '\uE200visualize\uE202' + JSON.stringify({ path, mode: 'wide', title: '预览' }) + '\uE201';

test('only standalone official Visualize references outside code identify a component', () => {
  const path = 'C:/Workspace/滑块.html';
  const line = marker(path);
  const text = '预览\r\n\r\n' + line + '\r\n\r\n~~~html\r\n' + line +
    '\r\n~~~\r\n    ' + line + '\r\n' + marker('C:/Workspace/../other.html');
  const refs = visualizeReferences(text);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].path, path);
  assert.equal(refs[0].wide, true);
  assert.equal(refs[0].title, '预览');
  assert.equal(text.slice(refs[0].start, refs[0].end).trim(), line);
});

test('host reads only the selected assistant component and validates its cached bytes', {
  skip: process.platform !== 'win32',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-visualize-'));
  const path = join(directory, 'slider.html');
  const html = '<p>滑块</p>';
  const key = { threadId: '00000000-0000-4000-8000-000000000001', itemId: 'assistant-1', index: 0 };
  let type = 'agentMessage';
  const native = async (method: string, params: Record<string, unknown>) => {
    assert.equal(method, 'thread/read');
    assert.deepEqual(params, { threadId: key.threadId, includeTurns: true });
    return { thread: { id: key.threadId, turns: [{
      items: [{ id: key.itemId, type, text: marker(path) }],
    }] } };
  };
  try {
    await writeFile(path, html);
    const first = await readVisualize(key, native);
    assert.equal(Buffer.from(first.data ?? '', 'base64').toString(), html);
    assert.deepEqual(await readVisualize({ ...key, etag: first.etag }, native), { etag: first.etag });
    await writeFile(path, '<p>新版</p>');
    const updated = await readVisualize({ ...key, etag: first.etag }, native);
    assert.notEqual(updated.etag, first.etag);
    await assert.rejects(readVisualize({ ...key, path }, native), /INVALID_VISUALIZE_SELECTION/);
    await assert.rejects(readVisualize({ ...key, index: 1 }, native), /VISUALIZE_UNAVAILABLE/);
    type = 'userMessage';
    await assert.rejects(readVisualize(key, native), /VISUALIZE_UNAVAILABLE/);
  } finally {
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
