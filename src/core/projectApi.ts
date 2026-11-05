import { recordOf, type CodexThread } from './protocol';
import type { ThreadRpcClient } from './threadApi';

export interface CodexProject {
  id: string;
  name: string;
  roots: string[];
  position: number | null;
}

function parseProject(value: unknown): CodexProject | null {
  const row = recordOf(value);
  if (typeof row.id !== 'string' || !row.id ||
      typeof row.name !== 'string' || !row.name) return null;
  const roots = Array.isArray(row.roots) ? row.roots.flatMap((root) => {
    const path = typeof root === 'string' ? root : recordOf(root).path;
    return typeof path === 'string' && /^[A-Za-z]:[\\/]|^\//.test(path) ? [path] : [];
  }) : [];
  return {
    id: row.id, name: row.name, roots,
    position: typeof row.position === 'number' && Number.isFinite(row.position)
      ? row.position : null,
  };
}

export async function listAllProjects(client: ThreadRpcClient): Promise<CodexProject[]> {
  const projects = new Map<string, CodexProject>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let index = 0; index < 100; index++) {
    const response = recordOf(await client.request('project/list', {
      limit: 100, ...(cursor ? { cursor } : {}),
    }));
    if (!Array.isArray(response.data)) throw new Error('project/list 项目列表格式错误');
    for (const item of response.data) {
      const project = parseProject(item);
      if (project) projects.set(project.id, project);
    }
    if (response.nextCursor == null) {
      return [...projects.values()].sort((a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    }
    if (typeof response.nextCursor !== 'string' || !response.nextCursor ||
        cursors.has(response.nextCursor)) throw new Error('project/list 分页游标无效');
    cursor = response.nextCursor;
    cursors.add(cursor);
  }
  throw new Error('project/list 超出分页上限');
}

export function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/** Explicit server assignments override path-based legacy classification. */
export function threadProjectId(
  thread: CodexThread, projects: readonly CodexProject[], explicitlyUnassigned = false,
): string | null {
  if (thread.projectId) return thread.projectId;
  if (explicitlyUnassigned) return null;
  const cwd = thread.cwd ? normalizedPath(thread.cwd) : '';
  if (!cwd) return null;
  const roots = projects.flatMap((project) =>
    project.roots.map((root) => ({ id: project.id, root: normalizedPath(root) })))
    .filter((entry) => entry.root && (cwd === entry.root || cwd.startsWith(entry.root + '/')))
    .sort((a, b) => b.root.length - a.root.length);
  return roots[0]?.id ?? null;
}

export function threadCategory(thread: CodexThread, projects: readonly CodexProject[]): string {
  if (thread.projectId) return thread.projectId;
  if (thread.cwd && /[\\/]Documents[\\/]Codex[\\/]MobileUI[\\/]\d{4}-\d\d-\d\d[\\/][\d-]+[a-f\d]{16,40}$/i.test(thread.cwd)) {
    return 'unassigned';
  }
  return threadProjectId(thread, projects) ?? 'uncategorized';
}
