import { Directory, File, Paths } from 'expo-file-system';
import {
  MAX_PUBLICATION_BYTES, MAX_PUBLICATION_SEQUENCE, safePublicationFileName,
} from '../../shared/publicationProtocol';

type Job = {
  id: string;
  expected: number;
  received: number;
  nextSeq: number;
  staging: File;
  folder: Directory;
  watchdog: ReturnType<typeof setTimeout> | null;
};
type Reply = { id: string; seq: number; ok: boolean; message?: string };
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

/**
 * A file transfer sink, not an Android RPC bridge. The shared React UI owns
 * presentation and the per-host publication is already authorized on Gateway.
 * This sink never accepts filesystem paths from JavaScript.
 */
export class NativePublicationDownloads {
  private active: Job | null = null;
  private clearActive(job = this.active): void {
    if (!job) return;
    if (job.watchdog) clearTimeout(job.watchdog);
    if (this.active === job) this.active = null;
    try {
      if (job.folder.exists) job.folder.delete();
    } catch { /* Cache cleanup must not hold the transfer lock. */ }
  }
  private touch(job: Job): void {
    if (job.watchdog) clearTimeout(job.watchdog);
    job.watchdog = setTimeout(() => this.clearActive(job), DOWNLOAD_IDLE_TIMEOUT_MS);
  }
  async handle(raw: string): Promise<Reply | null> {
    let request: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      request = parsed as Record<string, unknown>;
    } catch { return null; }
    if (typeof request.type !== 'string' || !request.type.startsWith('publication.')) return null;
    const { id, seq } = request;
    if (!validId(id) || !Number.isSafeInteger(seq) || Number(seq) < 0 ||
        Number(seq) > MAX_PUBLICATION_SEQUENCE) return null;
    const reply = (ok: boolean, message?: string): Reply =>
      ({ id, seq: Number(seq), ok, ...(message ? { message } : {}) });
    try {
      if (request.type === 'publication.cancel') {
        if (this.active?.id === id) this.clearActive();
        return reply(true);
      }
      if (request.type === 'publication.start') {
        if (this.active) {
          if (this.active.id !== id) throw Error('DOWNLOAD_ALREADY_ACTIVE');
          this.clearActive();
        }
        if (seq !== 0 || !Number.isSafeInteger(request.size) ||
            Number(request.size) <= 0 || Number(request.size) > MAX_PUBLICATION_BYTES ||
            typeof request.name !== 'string' || request.name.length > 200) {
          throw Error('INVALID_DOWNLOAD');
        }
        const folder = new Directory(Paths.cache, 'codexpub-' + id);
        folder.create({ idempotent: true, intermediates: true });
        const staging = new File(folder, safePublicationFileName(request.name));
        if (staging.exists) staging.delete();
        staging.create();
        const job: Job = {
          id, expected: Number(request.size),
          received: 0, nextSeq: 1, staging, folder, watchdog: null,
        };
        this.active = job;
        this.touch(job);
        return reply(true);
      }
      const job = this.active;
      if (!job || job.id !== id || job.nextSeq !== seq) throw Error('DOWNLOAD_NOT_ACTIVE');
      if (request.type === 'publication.chunk') {
        const data = request.data;
        if (typeof data !== 'string' || data.length === 0 || data.length > 150_000 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
          throw Error('INVALID_CHUNK');
        }
        const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
        if (request.offset !== job.received || job.received + bytes > job.expected) {
          throw Error('INVALID_OFFSET');
        }
        await job.staging.write(data, { encoding: 'base64', append: true });
        job.received += bytes;
        job.nextSeq++;
        this.touch(job);
        return reply(true);
      }
      if (request.type === 'publication.finish') {
        if (job.received !== job.expected || job.staging.size !== job.expected) {
          throw Error('DOWNLOAD_INCOMPLETE');
        }
        if (job.watchdog) clearTimeout(job.watchdog);
        job.watchdog = null;
        const destination = await Directory.pickDirectoryAsync();
        if (this.active !== job) return reply(false, 'DOWNLOAD_CANCELLED');
        await job.staging.copy(destination);
        this.clearActive(job);
        return reply(true);
      }
      throw Error('INVALID_OPERATION');
    } catch (error) {
      const job = this.active;
      if (job?.id === id) {
        this.clearActive(job);
      }
      const message = error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'DOWNLOAD_FAILED';
      return reply(false, message);
    }
  }
}
