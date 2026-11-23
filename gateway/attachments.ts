/** Authenticated, bounded mobile uploads. Never accept a caller-selected host path. */
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

const LIMIT = 8 * 1024 * 1024;
const CHUNK = 64 * 1024;
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.txt', '.md', '.json', '.jsonl', '.csv', '.log', '.yaml', '.yml', '.xml',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.sh', '.ps1', '.java',
  '.kt', '.rs', '.go', '.c', '.cpp', '.h', '.pdf', '.docx', '.xlsx', '.pptx',
  '.zip']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

// Gateway is launched under a workspace-scoped sandbox. The isolated Codex
// home is writable by App Server, not necessarily by Gateway. Keep uploads
// under the ignored, Gateway-owned state directory instead.
export const attachmentRoot = () => resolve('.state', 'mobile-uploads');

export function attachmentFailureMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return ['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(code ?? '')
    ? '电脑附件存储不可用，请检查网关写入权限或磁盘空间'
    : code === 'ENOENT' ? '电脑上的附件已不存在，请重新上传'
    : '附件格式、大小或上传顺序无效';
}

/** All reads are limited to host-generated, non-symlinked upload files. */
export function isManagedAttachmentPath(path: unknown, root = attachmentRoot()): boolean {
  if (typeof path !== 'string' || path.length > 400) return false;
  const file = resolve(path);
  const name = basename(file);
  if (!file.toLowerCase().startsWith((root + sep).toLowerCase()) ||
      !/^[a-f\d]{8}-[a-f\d-]{27,40}\.[a-z\d]+$/i.test(name) ||
      !EXTENSIONS.has(extname(name).toLowerCase())) return false;
  try {
    const info = lstatSync(file);
    return info.isFile() && info.size > 0 && info.size <= LIMIT;
  }
  catch { return false; }
}

export function isManagedImagePath(path: unknown, root = attachmentRoot()): boolean {
  return isManagedAttachmentPath(path, root) &&
    IMAGE_EXTENSIONS.has(extname(path as string).toLowerCase());
}

type Upload = {
  id: string; name: string; extension: string; kind: 'image' | 'file';
  size: number; received: number; index: number; partial: string; final: string;
};

export function createAttachmentUploader(root = attachmentRoot()) {
  const active = new Map<string, Upload>();
  // Retain only per-connection upload IDs so a cancellation racing with
  // attachmentFinish can discard its completed file without accepting a path.
  const finished = new Map<string, string>();
  let queue = Promise.resolve();
  let closed = false;
  const invalid = () => { throw new Error('附件参数无效或超过 8 MB 限制'); };

  const invoke = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (closed) return invalid();
    const keys = Object.keys(params);
    const only = (...expected: string[]) => keys.length === expected.length &&
      keys.every((key) => expected.includes(key));
    if (method === 'workspace/attachmentStart') {
      if (!only('name', 'size', 'kind') || typeof params.name !== 'string' ||
          params.name.length < 1 || params.name.length > 100 ||
          /[\\/\x00-\x1f]/.test(params.name) || !Number.isSafeInteger(params.size) ||
          Number(params.size) < 1 || Number(params.size) > LIMIT ||
          !['image', 'file'].includes(String(params.kind)) || active.size >= 4) return invalid();
      const extension = extname(params.name).toLowerCase();
      if (!EXTENSIONS.has(extension) ||
          params.kind === 'image' && !IMAGE_EXTENSIONS.has(extension)) return invalid();
      const id = randomUUID();
      const final = join(root, id + extension);
      const partial = final + '.part';
      await mkdir(root, { recursive: true });
      await writeFile(partial, Buffer.alloc(0), { flag: 'wx' });
      active.set(id, { id, name: params.name, extension,
        kind: params.kind as Upload['kind'], size: Number(params.size),
        received: 0, index: 0, partial, final });
      return { uploadId: id };
    }
    if (method === 'workspace/attachmentRead') {
      if (!only('path', 'offset') || !isManagedAttachmentPath(params.path, root) ||
          !Number.isSafeInteger(params.offset) || Number(params.offset) < 0) return invalid();
      const path = params.path as string;
      const file = await open(path, 'r');
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size < 1 || info.size > LIMIT ||
            Number(params.offset) >= info.size) return invalid();
        const buffer = Buffer.alloc(Math.min(CHUNK, info.size - Number(params.offset)));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, Number(params.offset));
        if (bytesRead < 1) return invalid();
        return { data: buffer.subarray(0, bytesRead).toString('base64'),
          received: Number(params.offset) + bytesRead, total: info.size };
      } finally { await file.close(); }
    }
    if (method === 'workspace/attachmentCancel') {
      if (!only('uploadId') || typeof params.uploadId !== 'string') return invalid();
      const upload = active.get(params.uploadId);
      const completedPath = finished.get(params.uploadId);
      if (!upload && !completedPath) return invalid();
      if (upload) {
        active.delete(upload.id);
        await rm(upload.partial, { force: true });
      }
      if (completedPath) {
        finished.delete(params.uploadId);
        await rm(completedPath, { force: true });
      }
      return {};
    }
    if (typeof params.uploadId !== 'string' || !active.has(params.uploadId)) return invalid();
    const upload = active.get(params.uploadId)!;
    if (method === 'workspace/attachmentChunk') {
      if (!only('uploadId', 'index', 'data') || params.index !== upload.index ||
          typeof params.data !== 'string' || !params.data.length ||
          params.data.length > CHUNK * 4 / 3 + 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.data)) {
        return invalid();
      }
      const bytes = Buffer.from(params.data, 'base64');
      if (!bytes.length || bytes.length > CHUNK || upload.received + bytes.length > upload.size) return invalid();
      await appendFile(upload.partial, bytes);
      upload.received += bytes.length;
      upload.index++;
      return { received: upload.received };
    }
    if (method === 'workspace/attachmentFinish') {
      if (!only('uploadId') || upload.received !== upload.size) return invalid();
      if ((await stat(upload.partial)).size !== upload.size) return invalid();
      await rename(upload.partial, upload.final);
      active.delete(upload.id);
      finished.set(upload.id, upload.final);
      // Forget old cancellation capabilities without deleting accepted files.
      if (finished.size > 64) finished.delete(finished.keys().next().value!);
      return { name: upload.name, kind: upload.kind, path: upload.final };
    }
    return invalid();
  };

  return {
    handle(method: string, params: Record<string, unknown>): Promise<unknown> {
      const task = queue.then(() => invoke(method, params));
      queue = task.then(() => undefined, () => undefined);
      return task;
    },
    dispose() {
      closed = true;
      finished.clear();
      void queue.then(() => Promise.all([...active.values()].map((upload) =>
        rm(upload.partial, { force: true }))));
      active.clear();
    },
  };
}
