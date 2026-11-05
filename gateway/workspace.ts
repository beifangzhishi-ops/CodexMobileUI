import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';

/** Untrusted mobile IDs contain the creation timestamp and a random suffix.
 * Deterministic paths preserve idempotence even after a gateway restart. */
export function workspacePath(draftId: unknown, home = homedir()): string {
  if (typeof draftId !== 'string' || !/^\d{13}-[a-f0-9]{16,40}$/.test(draftId)) {
    throw new Error('无效的待发送工作区标识');
  }
  const timestamp = Number(draftId.slice(0, 13));
  if (!Number.isSafeInteger(timestamp) || timestamp < Date.UTC(2020, 0, 1) ||
      timestamp > Date.now() + 86_400_000) {
    throw new Error('无效的工作区创建时间');
  }
  const date = new Date(timestamp);
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
  const root = resolve(home);
  const result = join(root, 'Documents', 'Codex', 'MobileUI', day, draftId);
  const relative = result.slice(root.length + 1);
  if (!relative || relative.startsWith('..') || parse(result).root === result) {
    throw new Error('工作区路径超出允许范围');
  }
  // Do not traverse a preexisting symlink/junction or a non-directory on
  // the fixed path. Native RPC creates the remaining directories.
  let current = parse(root).root;
  for (const part of result.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('工作区路径包含文件或重解析点');
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
      throw error;
    }
  }
  return result;
}

export function validateWorkspaceMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const info = metadata as Record<string, unknown>;
  return info.isDirectory === true && info.isSymlink === false;
}
