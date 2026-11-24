import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  MAX_PUBLICATION_BYTES, MAX_PUBLICATION_CACHE_BYTES, MAX_PUBLICATIONS_PER_THREAD,
  PUBLICATION_CHUNK_BYTES, PUBLICATION_ORPHAN_TTL_MS, PUBLICATION_RETENTION_MS,
  isValidPublicationId, mimeForFileName, previewKindForMime,
  type PublicationFile, type PublicationPreviewKind,
} from '../shared/publicationProtocol.js';
import { localFileLinks } from '../shared/localFileLinks.js';

/** A verified immutable publication returned by the host-owned Gateway. */
export type Publication = PublicationFile;

type SourceLink = { name: string; path: string };
type NativeAgentMessage = { id: string; text: string };

/** Only deliberate Markdown file links, not plain-text absolute paths, are deliverables. */
export function explicitFileLinks(markdown: string): SourceLink[] {
  const links: SourceLink[] = [];
  for (const link of localFileLinks(markdown)) {
    const sourceName = basename(link.path.replace(/\\/g, '/'));
    if (!sourceName || sourceName === '.' || sourceName === '..') continue;
    links.push({ name: sourceName, path: link.path });
  }
  return links;
}

function agentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const node = part as { type?: unknown; text?: unknown };
    return node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  }).join('\n');
}

function exactAgentMessage(nativeRead: unknown, threadId: string, itemId: string): NativeAgentMessage | null {
  const thread = (nativeRead as { thread?: Record<string, unknown> } | null)?.thread;
  if (!thread || thread.id !== threadId || !Array.isArray(thread.turns) ||
      typeof thread.cwd !== 'string' || !isAbsolute(thread.cwd)) return null;
  for (const turn of thread.turns) {
    if (!turn || typeof turn !== 'object') continue;
    const items = (turn as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const agent = item as { id?: unknown; type?: unknown; text?: unknown; content?: unknown };
      if (agent.type === 'agentMessage' && agent.id === itemId) {
        return { id: itemId, text: agentText(agent.text ?? agent.content) };
      }
    }
  }
  return null;
}

async function sniffText(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const sample = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    const bytes = sample.subarray(0, bytesRead);
    if (!bytes.length || bytes.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  } finally {
    await handle.close();
  }
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolvePromise);
    stream.on('error', rejectPromise);
  });
  return hash.digest('hex');
}

export class PublicationStore {
  private readonly root: string;
  private readonly running = new Map<string, Promise<Publication>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(stateFile: string) {
    this.root = resolve(stateFile, '..', 'published-files');
  }

  private dataFile(id: string) { return resolve(this.root, `${id}.data`); }
  private metadataFile(id: string) { return resolve(this.root, `${id}.json`); }

  /** Return only already-published snapshots. Reading a thread never copies files. */
  async listForThread(threadId: string): Promise<Publication[]> {
    await this.cleanup();
    let names: string[] = [];
    try { names = await readdir(this.root); } catch { return []; }
    const records = await Promise.all(names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => this.get(name.slice(0, -5), false)));
    return records.filter((item): item is Publication => item?.threadId === threadId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_PUBLICATIONS_PER_THREAD);
  }

  /**
   * Publish exactly one explicit Markdown link from one native agentMessage.
   * `linkIndex` is bounded and identifies a link inside that exact message.
   */
  async publishFromThread(
    threadId: string, itemId: string, linkIndex: number, nativeRead: unknown,
  ): Promise<Publication> {
    const message = exactAgentMessage(nativeRead, threadId, itemId);
    if (!message || !Number.isSafeInteger(linkIndex) || linkIndex < 0) {
      throw Error('PUBLICATION_SELECTION_INVALID');
    }
    const link = explicitFileLinks(message.text)[linkIndex];
    if (!link) throw Error('PUBLICATION_SELECTION_NOT_FOUND');
    const path = resolve(link.path);
    const id = createHash('sha256').update(JSON.stringify([threadId, itemId, path])).digest('hex');
    const now = Date.now();
    const record: Publication = {
      id, threadId, itemId, path, name: link.name, status: 'unavailable',
      size: 0, mime: mimeForFileName(link.name) ?? 'application/octet-stream',
      previewKind: null, createdAt: now, expiresAt: now + PUBLICATION_RETENTION_MS,
    };
    const existing = await this.get(id);
    if (existing?.status === 'ready') return existing;
    const active = this.running.get(id);
    if (active) return active;
    const task = this.queue.then(() => this.snapshot(record))
      .finally(() => this.running.delete(id));
    this.queue = task.then(() => undefined, () => undefined);
    this.running.set(id, task);
    return task;
  }

  private async snapshot(meta: Publication): Promise<Publication> {
    await this.cleanup();
    let canonical: string;
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      if (!(await lstat(meta.path)).isFile()) return { ...meta, error: 'unsafe' };
      canonical = await realpath(meta.path);
      info = await lstat(canonical);
      if (!info.isFile() || info.isSymbolicLink() || !info.size) return { ...meta, error: 'missing' };
      if (info.size > MAX_PUBLICATION_BYTES) return { ...meta, size: info.size, error: 'tooLarge' };
    } catch {
      return { ...meta, error: 'missing' };
    }

    const target = this.dataFile(meta.id);
    const temp = `${target}.${process.pid}.${randomUUID()}.part`;
    try {
      await mkdir(this.root, { recursive: true });
      await this.makeRoom(info.size);
      await copyFile(canonical, temp);
      const latest = await lstat(canonical);
      if (!latest.isFile() || latest.dev !== info.dev || latest.ino !== info.ino || latest.size !== info.size ||
          latest.mtimeMs !== info.mtimeMs) throw Error('file changed during copy');
      const copied = await stat(temp);
      if (!copied.isFile() || copied.size !== info.size) throw Error('file changed during copy');
      const hash = await fileHash(temp);
      const mime = mimeForFileName(meta.name) ?? (await sniffText(temp) ? 'text/plain' : 'application/octet-stream');
      const record: Publication = {
        ...meta, status: 'ready', size: info.size, hash, mime,
        previewKind: previewKindForMime(mime), createdAt: Date.now(),
        expiresAt: Date.now() + PUBLICATION_RETENTION_MS,
      };
      await rename(temp, target);
      await this.writeMetadata(record);
      return record;
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      await rm(target, { force: true }).catch(() => undefined);
      return { ...meta, size: info.size, status: 'unavailable', error: 'unreadable' };
    }
  }

  async get(id: string, cleanup = true): Promise<Publication | null> {
    if (!isValidPublicationId(id)) return null;
    const record = await this.load(id);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      if (cleanup) await this.deleteRecord(record);
      return null;
    }
    return record;
  }

  private async load(id: string): Promise<Publication | null> {
    try {
      const raw = JSON.parse(await readFile(this.metadataFile(id), 'utf8')) as Partial<Publication>;
      if (raw.id !== id || raw.status !== 'ready' || !raw.hash ||
          !Number.isSafeInteger(raw.size) || Number(raw.size) < 1 ||
          Number(raw.size) > MAX_PUBLICATION_BYTES ||
          typeof raw.name !== 'string' || typeof raw.itemId !== 'string' ||
          typeof raw.threadId !== 'string' || typeof raw.path !== 'string') return null;
      const info = await stat(this.dataFile(id));
      if (!info.isFile() || info.size !== raw.size) return null;
      const createdAt = Number.isSafeInteger(raw.createdAt) ? Number(raw.createdAt) : info.mtimeMs;
      const expiresAt = Number.isSafeInteger(raw.expiresAt)
        ? Number(raw.expiresAt) : createdAt + PUBLICATION_RETENTION_MS;
      const mime = typeof raw.mime === 'string' && raw.mime
        ? raw.mime : mimeForFileName(raw.name) ?? 'application/octet-stream';
      return {
        ...(raw as Publication), id, status: 'ready', createdAt, expiresAt, mime,
        previewKind: previewKindForMime(mime),
      };
    } catch {
      return null;
    }
  }

  async stat(id: unknown): Promise<Publication> {
    const record = await this.get(typeof id === 'string' ? id : '');
    if (!record) throw Error('PUBLICATION_UNAVAILABLE');
    return record;
  }

  async read(id: unknown, offset: unknown): Promise<{ data: string; received: number; total: number }> {
    if (!isValidPublicationId(id) || !Number.isSafeInteger(offset) || Number(offset) < 0) {
      throw Error('INVALID_PARAMS');
    }
    const meta = await this.get(id);
    if (!meta || Number(offset) >= meta.size) throw Error('PUBLICATION_UNAVAILABLE');
    const handle = await open(this.dataFile(id), 'r');
    try {
      const chunk = Buffer.alloc(Math.min(PUBLICATION_CHUNK_BYTES, meta.size - Number(offset)));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, Number(offset));
      if (bytesRead === 0) throw Error('PUBLICATION_UNAVAILABLE');
      return {
        data: chunk.subarray(0, bytesRead).toString('base64'),
        received: Number(offset) + bytesRead,
        total: meta.size,
      };
    } finally {
      await handle.close();
    }
  }

  private async makeRoom(incoming: number): Promise<void> {
    if (incoming > MAX_PUBLICATION_CACHE_BYTES) throw Error('PUBLICATION_CACHE_LIMIT');
    const records = await this.records(false);
    let total = records.reduce((sum, item) => sum + item.size, 0);
    for (const item of records.sort((a, b) => a.createdAt - b.createdAt)) {
      if (total + incoming <= MAX_PUBLICATION_CACHE_BYTES) break;
      await this.deleteRecord(item);
      total -= item.size;
    }
    if (total + incoming > MAX_PUBLICATION_CACHE_BYTES) throw Error('PUBLICATION_CACHE_LIMIT');
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    let names: string[] = [];
    try { names = await readdir(this.root); } catch { return; }
    const metadataIds = new Set(names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => name.slice(0, -5)));
    for (const name of names) {
      const id = /^([a-f0-9]{64})\./.exec(name)?.[1];
      if (!id) continue;
      if (name.endsWith('.json')) continue;
      try {
        const info = await stat(resolve(this.root, name));
        if (now - info.mtimeMs > PUBLICATION_ORPHAN_TTL_MS &&
            (name.includes('.part') || name.includes('.tmp') || !metadataIds.has(id))) {
          await rm(resolve(this.root, name), { force: true });
        }
      } catch { /* A concurrently removed orphan is already clean. */ }
    }
    for (const item of await this.records(false)) {
      if (item.expiresAt <= now) await this.deleteRecord(item);
    }
  }

  private async records(cleanup: boolean): Promise<Publication[]> {
    if (cleanup) await this.cleanup();
    let names: string[] = [];
    try { names = await readdir(this.root); } catch { return []; }
    const rows = await Promise.all(names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => this.load(name.slice(0, -5))));
    return rows.filter((item): item is Publication => item !== null);
  }

  private async deleteRecord(record: Publication): Promise<void> {
    await Promise.all([
      rm(this.metadataFile(record.id), { force: true }).catch(() => undefined),
      rm(this.dataFile(record.id), { force: true }).catch(() => undefined),
    ]);
  }

  private async writeMetadata(record: Publication): Promise<void> {
    const target = this.metadataFile(record.id);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' });
    try {
      await rm(target, { force: true });
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}

export type { PublicationPreviewKind };
