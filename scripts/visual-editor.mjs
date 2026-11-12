/**
 * Loopback-only Windows visual editor for the Android emulator.
 * No authentication, network relay, file browser or arbitrary script runner:
 * POST operations require a same-origin browser and accept only known tokens.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokenPath = path.join(root, 'src', 'ui', 'visual-tokens.json');
const pagePath = path.join(root, 'scripts', 'visual-editor.html');
const logoPath = path.join(root, 'assets', 'adaptive-icon.png');
const port = 49173;
const address = '127.0.0.1';
const definitions = {
  headerHeight: ['顶部栏高度', '顶部与按钮', 44, 84],
  sidebarWidthPercent: ['侧边栏宽度 (%)', '侧边栏动画', 65, 95],
  sidebarMaxWidth: ['侧边栏最大宽度', '侧边栏动画', 280, 500],
  sidebarSlideDurationMs: ['侧边栏滑动时长 (ms)', '侧边栏动画', 100, 500],
  sidebarProjectRowHeight: ['项目行高度', '侧边栏内容', 32, 72],
  sidebarConversationRowHeight: ['对话行高度', '侧边栏内容', 30, 70],
  sidebarSectionHeight: ['分组标题行高度', '侧边栏内容', 32, 70],
  sidebarTopHeight: ['侧边栏顶部固定区域', '侧边栏内容', 65, 120],
  sidebarBottomHeight: ['侧边栏底部固定区域', '侧边栏内容', 65, 120],
  newChatHeight: ['新对话按钮高度', '顶部与按钮', 36, 65],
  newChatIconSize: ['写字板图标尺寸', '顶部与按钮', 14, 34],
  composerMinHeight: ['输入框最小高度', '聊天输入区', 70, 160],
  composerRadius: ['输入框圆角', '聊天输入区', 10, 40],
  composerToolbarHeight: ['输入工具栏高度', '聊天输入区', 34, 66],
  composerBackground: ['输入框底色', '聊天输入区', 'color'],
  logoMarkWidth: ['普通图标内部几何 (px/1024)', '应用图标', 420, 840],
  logoAdaptiveMarkWidth: ['自适应图标内部几何 (px/1024)', '应用图标', 360, 750],
};
export const fields = definitions;

function readSaved() {
  const source = fs.readFileSync(tokenPath, 'utf8');
  return {
    tokens: JSON.parse(source),
    revision: createHash('sha256').update(source).digest('hex'),
  };
}
let { tokens: saved, revision } = readSaved();
let preview = { ...saved };
function refreshSaved() {
  const disk = readSaved();
  if (disk.revision !== revision) {
    // Source edits from another worker/editor win over stale local previews.
    // POST requests must bring the new revision before they can mutate state.
    saved = disk.tokens;
    revision = disk.revision;
    preview = { ...saved };
  }
}

export function validateTokens(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== Object.keys(definitions).length) return null;
  const clean = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const value = input[name];
    if (definition[2] === 'color') {
      if (typeof value !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value)) return null;
    } else if (!Number.isInteger(value) || value < definition[2] || value > definition[3]) {
      return null;
    }
    clean[name] = value;
  }
  return clean;
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

function respond(response, bytes, contentType) {
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(bytes);
}

async function readBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function makeServer() {
  return http.createServer(async (req, res) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (!['127.0.0.1:49173', 'localhost:49173', '10.0.2.2:49173'].includes(host)) {
      return json(res, 403, { error: 'Host forbidden' });
    }
    const route = req.url?.split('?')[0];
    refreshSaved();
    if (req.method === 'GET') {
      if (route === '/') return respond(res, fs.readFileSync(pagePath), 'text/html; charset=utf-8');
      if (route === '/api/config') return json(res, 200, { tokens: preview, saved, fields: definitions, revision });
      if (route === '/api/tokens') return json(res, 200, preview);
      if (route === '/api/icon') return respond(res, fs.readFileSync(logoPath), 'image/png');
      if (route === '/health') return json(res, 200, { ok: true, mode: 'local-visual-editor' });
      return json(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'POST' ||
        !['/api/preview', '/api/save', '/api/reset'].includes(route)) {
      return json(res, 404, { error: 'Not found' });
    }
    // Same-origin browser actions only. Reject form POSTs and cross-origin
    // requests, including CSRF attempts from ordinary websites.
    const origin = req.headers.origin;
    if (!['http://127.0.0.1:49173', 'http://localhost:49173'].includes(origin) ||
        !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return json(res, 403, { error: 'Same-origin JSON request required' });
    }
    try {
      if (route === '/api/reset') {
        preview = { ...saved };
        return json(res, 200, { tokens: preview, saved, revision });
      }
      const body = await readBody(req);
      if (body?.revision !== revision) {
        return json(res, 409, { error: '源码已在别处更新，请点击撤销未保存以载入最新版本' });
      }
      const value = validateTokens(body.tokens);
      if (!value) return json(res, 400, { error: 'Invalid visual parameters' });
      preview = value;
      if (route === '/api/save') {
        const temporary = tokenPath + '.new';
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
        fs.renameSync(temporary, tokenPath);
        const updated = readSaved();
        saved = updated.tokens;
        revision = updated.revision;
      }
      return json(res, 200, { tokens: preview, saved, revision });
    } catch {
      return json(res, 400, { error: 'Unable to process request' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeServer().listen(port, address, () => {
    console.log(`CodexMobile visual editor: http://127.0.0.1:${port}`);
    console.log('Preview follows the Android emulator; Save writes src/ui/visual-tokens.json.');
  });
}
