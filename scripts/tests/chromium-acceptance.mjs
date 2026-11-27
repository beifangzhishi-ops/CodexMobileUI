import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const root = resolve(import.meta.dirname, '../..');
const webRoot = resolve(root, 'web');
const tempRoot = resolve(root, '.tmp');
await mkdir(tempRoot, { recursive: true });
const runId = randomUUID();
const profileDir = resolve(tempRoot, `chromium-acceptance-${runId}`);
const screenshotDir = resolve(tempRoot, `chromium-acceptance-${runId}-screenshots`);
await mkdir(profileDir, { recursive: true });
await mkdir(screenshotDir, { recursive: true });

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', resolveListen).once('error', reject));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitUntil(check, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch { /* Wait for navigation/React mount. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)}`);
}

class DevTools {
  #nextId = 1;
  #pending = new Map();
  #socket;
  #events = new Map();
  constructor(socket) {
    this.#socket = socket;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (pending) {
          this.#pending.delete(message.id);
          if (message.error) pending.reject(Error(message.error.message));
          else pending.resolve(message.result);
        }
      } else if (message.method) {
        for (const listener of this.#events.get(message.method) ?? []) listener(message.params);
      }
    });
  }
  on(method, listener) {
    const listeners = this.#events.get(method) ?? new Set();
    listeners.add(listener); this.#events.set(method, listeners);
  }
  command(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolveCommand, reject) => {
      this.#pending.set(id, { resolve: resolveCommand, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.#socket.close(); }
}

let vite;
let chrome;
const browserErrors = [];
try {
  const webPort = await freePort();
  vite = spawn(process.execPath, [resolve(webRoot, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: webRoot, windowsHide: true, stdio: 'ignore',
  });
  await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${webPort}/tests/fixtures/project-thread-preview.chromium.html`);
    return response.ok;
  }, 'Vite fixture server');

  const chromePaths = [
    resolve(process.env.ProgramW6432 ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    resolve(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const chromePath = chromePaths.find((path) => existsSync(path));
  if (!chromePath) throw Error('Google Chrome or Microsoft Edge was not found.');
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  const activePortFile = resolve(profileDir, 'DevToolsActivePort');
  const activePort = await waitUntil(async () => {
    if (!existsSync(activePortFile)) return null;
    return (await readFile(activePortFile, 'utf8')).split(/\r?\n/)[0];
  }, 'Chrome DevTools endpoint');
  const debuggerBase = `http://127.0.0.1:${activePort}`;
  async function page(url) {
    const response = await fetch(`${debuggerBase}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw Error(`Chrome could not create a page: ${response.status}`);
    const target = await response.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
    const devtools = new DevTools(socket);
    devtools.on('Runtime.exceptionThrown', (event) => browserErrors.push(event.exceptionDetails?.text ?? 'Runtime exception'));
    await devtools.command('Page.enable');
    await devtools.command('Runtime.enable');
    await devtools.command('Page.navigate', { url });
    await waitUntil(() => devtools.evaluate('document.readyState === "complete"'), `page load ${url}`);
    return devtools;
  }
  async function click(devtools, selector) {
    await devtools.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing ${selector}'); element.click(); return true; })()`);
  }
  async function screenshot(devtools, path) {
    const result = await devtools.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path, Buffer.from(result.data, 'base64'));
  }
  async function projectState(devtools, key) {
    return devtools.evaluate(`(() => { const project = document.querySelector('[data-project="${key}"]'); return {
      rows: project?.querySelectorAll('.conversation-row').length ?? -1,
      more: Boolean(project?.querySelector('.project-thread-toggle')),
      expanded: project?.querySelector('.project-disclosure')?.getAttribute('aria-expanded'),
      activeThread: document.querySelector('.sidebar')?.dataset.activeThread,
      listLoads: document.querySelector('.sidebar')?.dataset.listLoads,
    }; })()`);
  }

  const projectPage = await page(`http://127.0.0.1:${webPort}/tests/fixtures/project-thread-preview.chromium.html`);
  try {
    await waitUntil(async () => (await projectState(projectPage, '6v:project-1')).expanded !== null,
      'project fixture render');
    await click(projectPage, '[data-project="6v:project-1"] .project-disclosure');
    assert.equal((await projectState(projectPage, '6v:project-1')).rows, 5);
    await click(projectPage, '[data-project="6v:project-1"] .project-thread-toggle');
    assert.equal((await projectState(projectPage, '6v:project-1')).rows, 15);
    assert.equal((await projectState(projectPage, '6v:project-1')).more, true);
    await click(projectPage, '[data-project="6v:project-1"] .project-thread-toggle');
    assert.deepEqual(await projectState(projectPage, '6v:project-1'), {
      rows: 23, more: false, expanded: 'true', activeThread: 'initial-thread', listLoads: '1',
    });
    await click(projectPage, '[data-project="6v:project-2"] .project-name');
    await click(projectPage, '[data-project="6v:project-2"] .project-thread-toggle');
    assert.equal((await projectState(projectPage, '6v:project-2')).rows, 15);
    await click(projectPage, '[data-project="6v:project-1"] .project-name');
    await click(projectPage, '[data-project="6v:project-1"] .project-disclosure');
    assert.equal((await projectState(projectPage, '6v:project-1')).rows, 5, 'reopening resets to the first five');
    assert.equal((await projectState(projectPage, '6v:project-2')).rows, 15, 'another project keeps its own limit');
    await click(projectPage, '[data-project="noha:project-1"] .project-disclosure');
    assert.equal((await projectState(projectPage, 'noha:project-1')).rows, 5, 'same project ID on another host is independent');
    assert.equal((await projectState(projectPage, '6v:project-1')).activeThread, 'initial-thread', 'project headers do not navigate');
    assert.equal((await projectState(projectPage, '6v:project-1')).listLoads, '1', 'local paging does not fetch more native rows');
    await screenshot(projectPage, resolve(screenshotDir, 'project-desktop.png'));
    await projectPage.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const projectNarrow = await projectPage.evaluate('({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})');
    assert.ok(projectNarrow.scrollWidth <= projectNarrow.width, `project narrow view overflow: ${JSON.stringify(projectNarrow)}`);
    await screenshot(projectPage, resolve(screenshotDir, 'project-narrow.png'));
  } finally { projectPage.close(); }

  const activityPage = await page(`http://127.0.0.1:${webPort}/tests/fixtures/subagent-activity.chromium.html`);
  try {
    const status = () => activityPage.evaluate(`document.querySelector('.subagent-lifecycle')?.textContent ?? ''`);
    await waitUntil(async () => (await status()).includes('运行中'), 'active child activity');
    assert.equal(await activityPage.evaluate(`document.querySelector('[data-testid="parent-turn"] .subagent-feed') !== null`), true,
      'activity feed must render inside the current parent turn');
    await activityPage.evaluate('window.fixture.newInteraction()');
    await waitUntil(async () => await activityPage.evaluate(`document.querySelector('[data-testid="parent-turn"]')?.dataset.parentTurn === 'parent-turn-2'`),
      'parent turn advances');
    await waitUntil(async () => (await status()).includes('运行中'), 'new child interaction wakes activity', 9000);
    assert.equal(await activityPage.evaluate(`document.querySelector('[data-testid="parent-turn"] .subagent-feed') !== null && document.querySelector('[data-testid="parent-turn"] .subagent-feed').closest('.parent-turn')?.dataset.parentTurn === 'parent-turn-2'`), true,
      'new interaction is anchored in the current parent turn');
    const activityReads = await activityPage.evaluate('window.fixture.activityReads');
    assert.ok(activityReads.length >= 2);
    assert.ok(activityReads.every((read) => read.hostId === '6v' && read.parentId === 'parent-thread-fixture' && read.childId === 'child-thread-fixture'));
    assert.equal(await activityPage.evaluate(`document.querySelector('.assistant-completion')?.textContent.includes('父会话已完成回复')`), true);
    await screenshot(activityPage, resolve(screenshotDir, 'subagent-active-desktop.png'));
    await activityPage.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const activityNarrow = await activityPage.evaluate('({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, feed: document.querySelector(".subagent-feed")?.getBoundingClientRect().width})');
    assert.ok(activityNarrow.scrollWidth <= activityNarrow.width, `activity narrow view overflow: ${JSON.stringify(activityNarrow)}`);
    assert.ok(activityNarrow.feed <= activityNarrow.width);
    await screenshot(activityPage, resolve(screenshotDir, 'subagent-active-narrow.png'));
    await activityPage.evaluate('window.fixture.completeChild()');
    await waitUntil(async () => (await status()).includes('已完成'), 'terminal child snapshot');
    assert.equal(await activityPage.evaluate(`document.body.textContent.includes('子会话完成答复。')`), true);
    assert.equal(await activityPage.evaluate(`document.body.textContent.includes('思考摘要保留')`), true);
    assert.equal(await activityPage.evaluate(`document.querySelector('.assistant-completion')?.textContent.includes('父会话已完成回复')`), true);
    await click(activityPage, '.reasoning-toggle');
    assert.equal(await activityPage.evaluate(`document.body.textContent.includes('未在摘要中重写的思考过程。')`), true);
    await screenshot(activityPage, resolve(screenshotDir, 'subagent-terminal-narrow.png'));
  } finally { activityPage.close(); }

  assert.deepEqual(browserErrors, [], `Chromium runtime errors: ${browserErrors.join('; ')}`);
  console.log(`PASS: real Chromium project pagination and parent/child activity at desktop and 390px; screenshots: ${screenshotDir}`);
} finally {
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (vite && vite.exitCode === null) vite.kill();
}
