import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { File } from 'node:buffer';
import { createAttachmentUploader } from '../../gateway/attachments.ts';
import { desktopFileMessage } from '../../shared/desktopFileReferences.ts';
import { documentFileAllowed, uploadDocument } from '../src/documentUpload.ts';
import { validDocumentUploadRpc, documentUploadGatewayMethod } from '../server/attachmentProtocol.mjs';

const uuid = '12345678-1234-4123-8123-123456789abc';

test('document RPC only allows bounded upload commands, never arbitrary paths', () => {
  assert.ok(validDocumentUploadRpc('web/attachment/start', { name: 'notes.md', size: 7 }));
  assert.ok(validDocumentUploadRpc('web/attachment/chunk', {
    uploadId: uuid, index: 0, data: 'YWJjZA==',
  }));
  assert.equal(documentUploadGatewayMethod('web/attachment/finish'), 'workspace/attachmentFinish');
  for (const params of [
    { name: '../secrets.txt', size: 7 },
    { name: 'foo.exe', size: 7 },
    { name: 'notes.md', size: 8 * 1024 * 1024 + 1 },
    { name: 'notes.md', size: 7, path: 'C:\\secrets.txt' },
    { name: 'notes.md', size: 0 },
  ]) assert.equal(validDocumentUploadRpc('web/attachment/start', params), false);
  assert.equal(validDocumentUploadRpc('web/attachment/read', { path: 'C:\\secret' }), false);
  assert.equal(validDocumentUploadRpc('web/attachment/chunk', {
    uploadId: uuid, index: 0, data: 'A'.repeat(90000),
  }), false);
  assert.equal(validDocumentUploadRpc('web/attachment/chunk', {
    uploadId: uuid, index: 170, data: 'YWJj',
  }), true, '8 MiB documents need more than 128 chunks at 48 KiB each');
  assert.equal(validDocumentUploadRpc('web/attachment/chunk', {
    uploadId: uuid, index: 256, data: 'YWJj',
  }), false);
  assert.equal(validDocumentUploadRpc('web/attachment/cancel', { uploadId: uuid, path: '/tmp' }), false);
  assert.equal(documentFileAllowed({ name: 'notes.md', size: 7 }), true);
  assert.equal(documentFileAllowed({ name: 'bad.sh.exe', size: 7 }), false);
});

test('native Desktop file-reference envelope is shared and does not append instructions', () => {
  assert.equal(desktopFileMessage('检查这个文件', [{ name: 'a.md', path: 'C:\\uploads\\a.md' }]),
    '# Files mentioned by the user:\n\n## a.md: C:\\uploads\\a.md' +
    '\n\n## My request for Codex:\n\n检查这个文件');
  assert.equal(desktopFileMessage('just text', []), 'just text');
  assert.throws(() => desktopFileMessage('x', [{ name: 'line\nbreak', path: 'C:\\x' }]));
});

test('browser upload streams chunks into the per-connection host uploader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-doc-upload-'));
  const uploader = createAttachmentUploader(root);
  const otherSocket = createAttachmentUploader(root);
  try {
    const bytes = Uint8Array.from({ length: 120000 }, (_, index) => index % 251);
    const file = new File([bytes], 'example.pdf', { type: 'application/pdf' });
    const progress = [];
    const methods = {
      'web/attachment/start': 'workspace/attachmentStart',
      'web/attachment/chunk': 'workspace/attachmentChunk',
      'web/attachment/finish': 'workspace/attachmentFinish',
      'web/attachment/cancel': 'workspace/attachmentCancel',
    };
    const request = async (_host, method, params) => {
      assert.ok(validDocumentUploadRpc(method, params), 'valid client request');
      return uploader.handle(methods[method], method === 'web/attachment/start'
        ? { ...params, kind: 'file' } : params);
    };
    const saved = await uploadDocument('6v', file, request, undefined, (offset) =>
      progress.push(offset));
    assert.equal(saved.name, 'example.pdf');
    assert.deepEqual(await readFile(saved.path), Buffer.from(bytes));
    assert.equal(progress.at(-1), bytes.byteLength);
    assert.equal(progress.length, 3);
    // A second socket has no capability to delete this completed attachment.
    await assert.rejects(() => otherSocket.handle('workspace/attachmentCancel',
      { uploadId: saved.path.match(/[a-f\d-]{36}/i)?.[0] }));
  } finally {
    uploader.dispose();
    otherSocket.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancel before sending does not create an upload', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const file = new File(['text'], 'notes.md');
  await assert.rejects(uploadDocument('6v', file, () =>
    { throw Error('SHOULD_NOT_SEND'); }, aborted.signal, () => {}), /UPLOAD_CANCELLED/);
});
