import { execFile } from 'node:child_process';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const runGit = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runGit('git', ['-C', cwd, ...args], {
    timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  return result.stdout.trim();
}

/** Only Codex-native project roots can reach this entrypoint; never accept a client path. */
export async function inspectGitProject(projectRoot: string): Promise<{
  repository: string; relativeProject: string;
}> {
  if (!isAbsolute(projectRoot)) throw new Error('PROJECT_ROOT_INVALID');
  const physical = await realpath(projectRoot);
  let repository: string;
  try { repository = await realpath(await git(physical, 'rev-parse', '--show-toplevel')); }
  catch { throw new Error('WORKTREE_NOT_GIT'); }
  const diff = relative(repository, physical);
  if (diff.startsWith('..' + sep) || diff === '..' || isAbsolute(diff)) {
    throw new Error('WORKTREE_ROOT_INVALID');
  }
  return { repository, relativeProject: diff };
}

/** A stable, per-task checkout. It is never auto-deleted or reset on completion. */
export async function ensureTaskWorktree(projectRoot: string, taskId: string,
  stateDirectory: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(taskId)) throw new Error('WORKTREE_ID_INVALID');
  const { repository, relativeProject } = await inspectGitProject(projectRoot);
  const parent = resolve(stateDirectory, 'automation-worktrees');
  await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  const target = join(parentReal, taskId);
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('WORKTREE_UNSAFE');
    const actual = await realpath(await git(target, 'rev-parse', '--show-toplevel'));
    if (actual !== await realpath(target)) throw new Error('WORKTREE_UNSAFE');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error instanceof Error && error.message === 'WORKTREE_UNSAFE'
        ? error : new Error('WORKTREE_UNAVAILABLE');
    }
    try { await git(repository, 'worktree', 'add', '--detach', target, 'HEAD'); }
    catch { throw new Error('WORKTREE_CREATE_FAILED'); }
  }
  return join(target, relativeProject);
}
