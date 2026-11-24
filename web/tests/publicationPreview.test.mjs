import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  ISOLATED_MARKUP_CSP, parsePublicationRange, streamPublicationRange,
} from '../server/publicationPreview.mjs';

test('publication preview supports bounded single byte ranges', () => {
  assert.deepEqual(parsePublicationRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parsePublicationRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parsePublicationRange('bytes=-50', 1000), { start: 950, end: 999 });
  assert.deepEqual(parsePublicationRange('bytes=999-2000', 1000), { start: 999, end: 999 });
  assert.equal(parsePublicationRange(undefined, 1000), null);
});

test('publication preview rejects multiple, reversed and non-byte ranges', () => {
  assert.equal(parsePublicationRange('bytes=0-1,4-5', 1000), false);
  assert.equal(parsePublicationRange('bytes=20-10', 1000), false);
  assert.equal(parsePublicationRange('items=0-1', 1000), false);
  assert.equal(parsePublicationRange('bytes=1000-', 1000), false);
  assert.equal(parsePublicationRange('bytes=-0', 1000), false);
});

test('HTML and SVG previews run in a no-script no-network sandbox', () => {
  assert.match(ISOLATED_MARKUP_CSP, /^sandbox;/);
  assert.match(ISOLATED_MARKUP_CSP, /default-src 'none'/);
  assert.doesNotMatch(ISOLATED_MARKUP_CSP, /allow-scripts|unsafe-eval/);
});

test('publication range streaming reads only the requested bounded bytes', async () => {
  const calls = [];
  const chunks = [
    Buffer.from('abcd'), Buffer.from('efgh'), Buffer.from('ijkl'),
  ];
  const session = {
    request: async (_method, params) => {
      calls.push(params.offset);
      const remaining = chunks[Math.floor(params.offset / 4)]?.subarray(params.offset % 4) ??
        Buffer.alloc(0);
      const data = remaining.subarray(0, 4);
      return {
        data: data.toString('base64'), received: params.offset + data.length, total: 12,
      };
    },
  };
  class Response extends EventEmitter {
    destroyed = false;
    data = [];
    write(value) { this.data.push(Buffer.from(value)); return true; }
  }
  const response = new Response();
  await streamPublicationRange(session, 'a'.repeat(64), 2, 9, response);
  assert.equal(Buffer.concat(response.data).toString(), 'cdefghij');
  assert.deepEqual(calls, [2, 4, 8]);
});
