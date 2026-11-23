import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';

/** A deliberately narrow host-owned file editor, NOT an arbitrary file RPC. */
export type HostFileKind = 'globalRules' | 'projectRules' | 'config';
export type HostFileSelection = { kind: HostFileKind; projectId?: string; rootIndex?: number };
export type HostFileSnapshot = {
  kind: HostFileKind;
  filename: string;
  path: string;
  text: string;
  revision: string;
  exists: boolean;
};
export class HostFileError extends Error {
  constructor(public readonly code: 'INVALID' | 'CONFLICT' | 'UNAVAILABLE', message: string) {
    super(message);
  }
}

type NativeProjectRead = (id: string) => Promise<unknown>;
type HostFileContext = { homeRoot?: string; readProject: NativeProjectRead };
const utf8 = new TextDecoder('utf-8', { fatal: true });
const locks = new Map<string, Promise<void>>();

function strictSelection(value: unknown): HostFileSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostFileError('INVALID', '文件请求无效');
  }
  const p = value as Record<string, unknown>;
  if (!['globalRules', 'projectRules', 'config'].includes(String(p.kind)) ||
      Object.keys(p).some((key) => !['kind', 'projectId', 'rootIndex'].includes(key))) {
    throw new HostFileError('INVALID', '文件类型无效');
  }
  if (p.kind === 'projectRules') {
    if (typeof p.projectId !== 'string' || !/^[\w-]{1,128}$/.test(p.projectId) ||
        (p.rootIndex !== undefined && (!Number.isInteger(p.rootIndex) ||
          Number(p.rootIndex) < 0 || Number(p.rootIndex) > 31))) {
      throw new HostFileError('INVALID', '项目标识或目录无效');
    }
    return { kind: 'projectRules', projectId: p.projectId, rootIndex: Number(p.rootIndex ?? 0) };
  }
  if (p.projectId !== undefined || p.rootIndex !== undefined) {
    throw new HostFileError('INVALID', '全局文件不接受项目目录参数');
  }
  return { kind: p.kind as 'globalRules' | 'config' };
}

function configHome(): string {
  // Must match scripts/mobile-app-server.ps1. Never read or modify the Desktop ~/.codex.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'CodexMobileUI', 'CodexHome');
  }
  throw new HostFileError('UNAVAILABLE', '当前主机未配置独立 Codex 目录');
}

async function directory(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('not a physical directory');
    return await realpath(path);
  } catch {
    throw new HostFileError('UNAVAILABLE', '电脑上的规则目录不可用');
  }
}

function rootFromProjectResult(value: unknown, projectId: string, rootIndex: number): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostFileError('UNAVAILABLE', '电脑未确认项目目录');
  }
  const result = value as Record<string, unknown>;
  const raw = result.project ?? result;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HostFileError('UNAVAILABLE', '电脑未确认项目目录');
  }
  const project = raw as Record<string, unknown>;
  if (project.id !== projectId || !Array.isArray(project.roots) ||
      rootIndex >= project.roots.length) {
    throw new HostFileError('UNAVAILABLE', '电脑上的项目不存在或未设置目录');
  }
  const root = project.roots[rootIndex];
  const path = typeof root === 'string' ? root
    : root && typeof root === 'object' && !Array.isArray(root)
      ? (root as Record<string, unknown>).path : null;
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new HostFileError('UNAVAILABLE', '项目目录不是有效绝对路径');
  }
  return path;
}

async function fileStat(path: string): Promise<'missing' | 'regular'> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new HostFileError('UNAVAILABLE', '拒绝修改链接或非普通文件');
    }
    return 'regular';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}

async function resolveTarget(input: HostFileSelection, context: HostFileContext): Promise<string> {
  const root = input.kind === 'projectRules'
    ? rootFromProjectResult(await context.readProject(input.projectId!),
      input.projectId!, input.rootIndex ?? 0)
    : (context.homeRoot ?? configHome());
  const folder = await directory(root);
  if (input.kind === 'config') return join(folder, 'config.toml');
  const override = join(folder, 'AGENTS.override.md');
  if (await fileStat(override) === 'regular') {
    // Codex ignores an empty override and falls back to AGENTS.md.
    const bytes = await readFile(override);
    if (bytes.toString('utf8').trim()) return override;
  }
  return join(folder, 'AGENTS.md');
}

async function snapshot(path: string, kind: HostFileKind): Promise<HostFileSnapshot> {
  const exists = (await fileStat(path)) === 'regular';
  const limit = kind === 'config' ? 262_144 : 131_072;
  if (exists && (await lstat(path)).size > limit) {
    throw new HostFileError('UNAVAILABLE', '规则文件过大，手机端不支持编辑');
  }
  const bytes = exists ? await readFile(path) : Buffer.alloc(0);
  if (bytes.byteLength > limit) throw new HostFileError('UNAVAILABLE', '规则文件过大，手机端不支持编辑');
  let text: string;
  try { text = utf8.decode(bytes); }
  catch { throw new HostFileError('UNAVAILABLE', '文件不是有效 UTF-8，已拒绝覆盖'); }
  return {
    kind, path, filename: path.endsWith('AGENTS.override.md') ? 'AGENTS.override.md'
      : kind === 'config' ? 'config.toml' : 'AGENTS.md',
    text, exists,
    revision: exists ? 'sha256:' + createHash('sha256').update(bytes).digest('hex') : 'missing',
  };
}

export async function readHostFile(input: unknown, context: HostFileContext): Promise<HostFileSnapshot> {
  const selection = strictSelection(input);
  const path = await resolveTarget(selection, context);
  return snapshot(path, selection.kind);
}

export async function writeHostFile(
  input: unknown, context: HostFileContext,
): Promise<HostFileSnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HostFileError('INVALID', '保存请求无效');
  }
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some((key) => !['kind', 'projectId', 'rootIndex',
    'text', 'revision', 'filename'].includes(key)) ||
      typeof p.text !== 'string' || typeof p.revision !== 'string' ||
      !/^(missing|sha256:[a-f0-9]{64})$/.test(p.revision) ||
      !['AGENTS.md', 'AGENTS.override.md', 'config.toml'].includes(String(p.filename))) {
    throw new HostFileError('INVALID', '保存参数无效');
  }
  const selection = strictSelection(Object.fromEntries(Object.entries(p).filter(([key]) =>
    ['kind', 'projectId', 'rootIndex'].includes(key))));
  const max = selection.kind === 'config' ? 262_144 : 131_072;
  const contents = Buffer.from(p.text, 'utf8');
  if (contents.byteLength > max || p.text.includes('\0')) {
    throw new HostFileError('INVALID', '文件内容超出允许范围');
  }
  const path = await resolveTarget(selection, context);
  const previous = locks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((done) => { release = done; });
  locks.set(path, next);
  await previous;
  try {
    const current = await snapshot(path, selection.kind);
    if (current.revision !== p.revision || current.filename !== p.filename) {
      throw new HostFileError('CONFLICT', '电脑上的文件已更改，请刷新后核对再保存');
    }
    // Re-check the active override after waiting for other mobile saves.
    if (await resolveTarget(selection, context) !== path) {
      throw new HostFileError('CONFLICT', '规则文件优先级已变化，请刷新');
    }
    const temporary = path + '.mobile-' + randomBytes(12).toString('hex') + '.tmp';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(contents); await handle.sync(); }
      finally { await handle.close(); }
      const latest = await snapshot(path, selection.kind);
      if (latest.revision !== p.revision || latest.filename !== p.filename) {
        throw new HostFileError('CONFLICT', '电脑上的文件已更改，请刷新后核对再保存');
      }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => undefined); }
    return snapshot(path, selection.kind);
  } finally {
    release();
    if (locks.get(path) === next) locks.delete(path);
  }
}
