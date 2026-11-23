import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { uploadToQuark } from './quarkUpload.js';
import { localFileLinks } from '../shared/localFileLinks.js';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_QUARK_BYTES = 1024 * 1024 * 1024 * 1024;
const BLOCK_SIZE = 64 * 1024;
const MAX_ITEMS = 20;

export type Publication = {
  id: string; itemId: string; threadId: string; name: string; path: string;
  status: 'ready' | 'unavailable' | 'quarkUploading' | 'quarkUploaded' | 'quarkFailed';
  size: number; hash?: string; destination?: string; startedAt?: number;
};

/** Only deliberate Markdown file links, not plain-text absolute paths, are deliverables. */
export function explicitFileLinks(markdown: string): { name: string; path: string }[] {
  const links: { name: string; path: string }[] = [];
  for (const link of localFileLinks(markdown)) {
    if (link.location) continue;
    const sourceName = basename(link.path.replace(/\\/g, '/'));
    if (!sourceName || sourceName === '.' || sourceName === '..') continue;
    const caption = link.label.replace(/^下载\s+/u, '').trim();
    const sourceExtension = sourceName.lastIndexOf('.') >= 0 ? sourceName.slice(sourceName.lastIndexOf('.')) : '';
    const name = sourceExtension && caption.toLowerCase().endsWith(sourceExtension.toLowerCase()) &&
      caption.length <= 120 && !/[\\/:*?"<>|\x00-\x1f]/u.test(caption) ? caption : sourceName;
    links.push({ name, path: link.path });
  }
  return links;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export class PublicationStore {
  private readonly root: string;
  private readonly running = new Map<string, Promise<Publication>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(stateFile: string, private readonly quarkUpload: (path: string) => Promise<void> = uploadToQuark) {
    this.root = resolve(stateFile, '..', 'published-files');
  }

  private file(id: string) { return resolve(this.root, `${id}.data`); }
  private metadata(id: string) { return resolve(this.root, `${id}.json`); }

  /** The thread and item must have been obtained from native thread/read, never a caller's text. */
  async listFromThread(threadId: string, nativeRead: unknown): Promise<Publication[]> {
    const thread = (nativeRead as { thread?: Record<string, unknown> } | null)?.thread;
    if (!thread || thread.id !== threadId || !Array.isArray(thread.turns) ||
      typeof thread.cwd !== 'string' || !isAbsolute(thread.cwd)) return [];
    const publications: Publication[] = [];
    for (const turn of thread.turns) {
      if (!turn || typeof turn !== 'object') continue;
      const items = (turn as { items?: unknown }).items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const agent = item as { id?: unknown; type?: unknown; text?: unknown; content?: unknown };
        if (agent.type !== 'agentMessage' || typeof agent.id !== 'string') continue;
        const text = typeof agent.text === 'string' ? agent.text :
          Array.isArray(agent.content) ? agent.content.map((p: unknown) => {
            if (!p || typeof p !== 'object') return '';
            const node = p as { type?: unknown; text?: unknown };
            return node.type === 'text' && typeof node.text === 'string' ? node.text : '';
          }).join('\n') : '';
        for (const link of explicitFileLinks(text)) {
          if (publications.length >= MAX_ITEMS) return publications;
          const path = resolve(link.path);
          const id = createHash('sha256').update(JSON.stringify([threadId, agent.id, path]))
            .digest('hex');
          publications.push(await this.publish({ id, threadId, itemId: agent.id, path,
            name: link.name, status: 'unavailable', size: 0 }));
        }
      }
    }
    return publications;
  }

  private async publish(meta: Publication): Promise<Publication> {
    const existing = await this.get(meta.id);
    if (existing) {
      // A Gateway restart during an upload leaves no verified completion.
      if (existing.status === 'quarkUploading' && !this.running.has(meta.id) &&
          existing.startedAt && Date.now() - existing.startedAt > 35 * 60_000) {
        const failed: Publication = { ...existing, status: 'quarkFailed' };
        await this.saveMetadata(failed);
        return failed;
      }
      return existing;
    }
    const active = this.running.get(meta.id);
    if (active) return active;
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      await realpath(meta.path);
      info = await lstat(meta.path);
      if (!info.isFile() || info.isSymbolicLink() || !info.size ||
        info.size > MAX_QUARK_BYTES) return meta;
    } catch { return meta; }
    if (info.size <= MAX_BYTES) return this.snapshot(meta);
    const pending: Publication = {
      ...meta, size: info.size, status: 'quarkUploading', destination: '夸克上传文件',
      startedAt: Date.now(),
    };
    try { await this.saveMetadata(pending); }
    catch { return { ...pending, status: 'quarkFailed' }; }
    const run = this.queue.then(async () => {
      // Reconfirm the file before asking the Quark desktop app to read it.
      const current = await lstat(meta.path);
      if (!current.isFile() || current.isSymbolicLink() || current.size !== info.size) {
        throw new Error('QUARK_SOURCE_CHANGED');
      }
      await this.quarkUpload(meta.path);
    }).then(async (): Promise<Publication> => {
      const result: Publication = { ...pending, status: 'quarkUploaded' };
      await this.saveMetadata(result);
      return result;
    }).catch(async (): Promise<Publication> => {
      const result: Publication = { ...pending, status: 'quarkFailed' };
      await this.saveMetadata(result).catch(() => undefined);
      return result;
    }).finally(() => { this.running.delete(meta.id); });
    this.running.set(meta.id, run);
    this.queue = run.then(() => undefined);
    return pending;
  }

  private async saveMetadata(record: Publication): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temp = resolve(this.root, `${record.id}.${process.pid}.json.tmp`);
    try {
      await writeFile(temp, JSON.stringify(record), { flag: 'w' });
      await rename(temp, this.metadata(record.id));
    } finally { await rm(temp, { force: true }).catch(() => undefined); }
  }

  private async snapshot(meta: Publication): Promise<Publication> {
    const existing = await this.get(meta.id);
    if (existing) return existing;
    const active = this.running.get(meta.id);
    if (active) return active;
    const task = this.makeSnapshot(meta).finally(() => this.running.delete(meta.id));
    this.running.set(meta.id, task);
    return task;
  }

  private async makeSnapshot(meta: Publication): Promise<Publication> {
    let result = meta;
    const target = this.file(meta.id);
    const temp = `${target}.part`;
    try {
      // The path is solely from a native assistant message returned by
      // thread/read; a mobile request can only use an opaque publication ID.
      await realpath(meta.path);
      const info = await lstat(meta.path);
      if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > MAX_BYTES) {
        throw new Error('unsupported file');
      }
      await mkdir(this.root, { recursive: true });
      await copyFile(meta.path, temp);
      const copyInfo = await stat(temp);
      if (copyInfo.size !== info.size) throw new Error('file changed during copy');
      const hash = createHash('sha256').update(await readFile(temp)).digest('hex');
      await rename(temp, target);
      result = { ...meta, status: 'ready', size: info.size, hash };
      await writeFile(this.metadata(meta.id), JSON.stringify(result), { flag: 'wx' });
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      // An unavailable card is deliberately not cached: a later refresh can retry.
    }
    return result;
  }

  async get(id: string): Promise<Publication | null> {
    if (!safeId(id)) return null;
    try {
      const raw = JSON.parse(await readFile(this.metadata(id), 'utf8')) as Publication;
      if (raw.id !== id || !['ready', 'quarkUploading', 'quarkUploaded', 'quarkFailed'].includes(raw.status) ||
        !Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > MAX_QUARK_BYTES) return null;
      if (raw.status !== 'ready') return raw;
      if (!raw.hash) return null;
      const info = await stat(this.file(id));
      return info.isFile() && info.size === raw.size ? raw : null;
    } catch { return null; }
  }

  async read(id: unknown, offset: unknown): Promise<{ data: string; received: number; total: number }> {
    if (!safeId(id) || !Number.isSafeInteger(offset) || Number(offset) < 0) throw new Error('INVALID_PARAMS');
    const meta = await this.get(id);
    if (!meta || meta.status !== 'ready' || Number(offset) >= meta.size) {
      throw new Error('PUBLICATION_UNAVAILABLE');
    }
    const { open } = await import('node:fs/promises');
    const file = await open(this.file(id), 'r');
    try {
      const chunk = Buffer.alloc(Math.min(BLOCK_SIZE, meta.size - Number(offset)));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, Number(offset));
      if (bytesRead === 0) throw new Error('PUBLICATION_UNAVAILABLE');
      return { data: chunk.subarray(0, bytesRead).toString('base64'),
        received: Number(offset) + bytesRead, total: meta.size };
    } finally { await file.close(); }
  }
}
