import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
});
after(() => server.close());

globalThis.window = {};
const { ReasoningActivity, visibleReasoningProcess } = await server.ssrLoadModule('/src/ThreadActivity.tsx');

test('reasoning process removes summary copies and repeated native parts', () => {
  assert.equal(visibleReasoningProcess({
    content: 'Summary one\n\nSummary two',
    summaryParts: ['Summary one', 'Summary two'],
    reasoningText: 'Summary one\n\nProcess A\n\nProcess A\n\nSummary two\n\nProcess B\n\nProcess A',
    reasoningParts: [' Summary one ', 'Process A', 'Process A', 'Summary two\n\nProcess B', 'Process A'],
  }), 'Process A\n\nProcess B');
});

test('reasoning process ignores harmless prose whitespace but keeps distinct content', () => {
  assert.equal(visibleReasoningProcess({
    content: 'The user wants   a concise answer.',
    summaryParts: ['The user wants\na concise answer.'],
    reasoningText: 'The user wants a concise answer.\n\nThe process checks another edge case.',
    reasoningParts: [' The user wants a concise answer. ', 'The process checks another edge case.'],
  }), 'The process checks another edge case.');
  assert.equal(visibleReasoningProcess({
    content: 'Summary',
    summaryParts: ['Summary'],
    reasoningText: '',
    reasoningParts: ['```\nconst a = 1;\n\nconst b = 2;\n```'],
  }), '```\nconst a = 1;\n\nconst b = 2;\n```');
});

test('reasoning process falls back to joined display text for older messages', () => {
  assert.equal(visibleReasoningProcess({
    content: 'Summary',
    reasoningText: 'Summary\n\nOnly in the process',
  }), 'Only in the process');
});

test('deduplicated reasoning has no empty toggle or duplicated expanded text', () => {
  const duplicate = renderToStaticMarkup(createElement(ReasoningActivity, {
    message: {
      id: 'reasoning-duplicate', role: 'assistant', kind: 'reasoning', complete: true,
      content: 'Summary', summaryParts: ['Summary'], reasoningText: 'Summary', reasoningParts: ['Summary'],
    },
  }));
  assert.match(duplicate, /思考摘要/);
  assert.doesNotMatch(duplicate, /reasoning-toggle/);

  const partial = renderToStaticMarkup(createElement(ReasoningActivity, {
    message: {
      id: 'reasoning-partial', role: 'assistant', kind: 'reasoning', complete: true,
      content: 'Summary', summaryParts: ['Summary'],
      reasoningText: 'Summary\n\nUnique process', reasoningParts: ['Summary', 'Unique process'],
    },
  }));
  assert.match(partial, /reasoning-toggle/);
  assert.match(partial, /Summary/);
  assert.doesNotMatch(partial, /Unique process/);
});
