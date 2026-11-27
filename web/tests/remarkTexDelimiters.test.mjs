import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { remarkTexDelimiters } from '../src/remarkTexDelimiters.mjs';

const render = (children) => renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm, remarkMath, remarkTexDelimiters],
  rehypePlugins: [rehypeKatex],
  children,
}));

test('renders Codex TeX delimiters alongside dollar math in Markdown', () => {
  const html = render(String.raw`- 剪切率\(2026\,\mathrm{s^{-1}}\)，直径\(25\,\mu\mathrm m\)。[图 8](https://example.com)
  - $x_i$

\[x_i = 2\]`);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 4);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /katex-error/);
});

test('leaves code, escaped delimiters, and incomplete math as Markdown', () => {
  const html = render([
    '`\\(x_i\\)`',
    '',
    '```text',
    '\\[x_i\\]',
    '```',
    '',
    String.raw`\\(escaped\\) and \(incomplete`,
  ].join('\n'));
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /<code>\\\(x_i\\\)<\/code>/);
  assert.match(html, /\\\(escaped\\\) and \(incomplete/);
});
