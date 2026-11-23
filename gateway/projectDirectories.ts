import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Filesystem access exposed to MobileUI is confined to host-approved roots.
 * The client sends only opaque directory locators, never an arbitrary path. */
export type ProjectDirectory = { locator: string; name: string; path: string };
export type ProjectDirectoryListing = {
  locator: string | null;
  path: string | null;
  directories: ProjectDirectory[];
};

export class ProjectDirectoryError extends Error {}

function configuredRoots(home: string, configured?: string): string[] {
  const defaults = [join(home, 'Documents'), join(home, 'Desktop')];
  const extras = (configured ?? '').split(';').map((value) => value.trim()).filter(Boolean);
  return [...new Set([...defaults, ...extras].filter(isAbsolute).map((value) => resolve(value)))];
}

function decodeLocator(locator: unknown): { index: number; segments: string[] } {
  if (typeof locator !== 'string' || locator.length > 1600) {
    throw new ProjectDirectoryError('目录选择无效');
  }
  const parts = locator.split('/');
  if (!/^r\d{1,2}$/.test(parts[0] ?? '') || parts.length > 14) {
    throw new ProjectDirectoryError('目录选择无效');
  }
  const segments = parts.slice(1).map((part) => {
    let name: string;
    try { name = decodeURIComponent(part); }
    catch { throw new ProjectDirectoryError('目录选择无效'); }
    if (!name || name === '.' || name === '..' || name.length > 255 ||
        /[\\/\x00-\x1f:]/.test(name) || name.endsWith('.') || name.endsWith(' ')) {
      throw new ProjectDirectoryError('目录选择无效');
    }
    return name;
  });
  return { index: Number(parts[0].slice(1)), segments };
}

async function directoryOnly(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch { return false; }
}

export async function resolveProjectDirectory(
  locator: unknown, home = homedir(), configured = process.env.MOBILE_PROJECT_ROOTS,
): Promise<string> {
  const { index, segments } = decodeLocator(locator);
  const roots = configuredRoots(home, configured);
  if (index >= roots.length) throw new ProjectDirectoryError('目录选择无效');
  const root = roots[index];
  if (!await directoryOnly(root)) throw new ProjectDirectoryError('电脑上的目录不可用');
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!await directoryOnly(current)) throw new ProjectDirectoryError('目录不存在或无权访问');
  }
  const targetReal = await realpath(current);
  const diff = relative(rootReal, targetReal);
  if (diff === '..' || diff.startsWith('..' + sep) || isAbsolute(diff)) {
    throw new ProjectDirectoryError('目录超出电脑允许范围');
  }
  return targetReal;
}

export async function listProjectDirectories(
  locator?: unknown, home = homedir(), configured = process.env.MOBILE_PROJECT_ROOTS,
): Promise<ProjectDirectoryListing> {
  const roots = configuredRoots(home, configured);
  if (locator === undefined || locator === null) {
    const available = await Promise.all(roots.map(async (path, index) =>
      await directoryOnly(path) ? { locator: `r${index}`, name: basename(path), path } : null));
    return { locator: null, path: null, directories: available.filter((item) => item !== null) };
  }
  const path = await resolveProjectDirectory(locator, home, configured);
  const entries = await readdir(path, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() &&
    !/[\\/\x00-\x1f:]/.test(entry.name) && entry.name !== '.' && entry.name !== '..');
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return {
    locator: locator as string, path,
    directories: folders.slice(0, 150).map((entry) => ({
      locator: `${locator as string}/${encodeURIComponent(entry.name)}`,
      name: entry.name,
      path: join(path, entry.name),
    })),
  };
}
