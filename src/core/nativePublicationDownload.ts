import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type Job = {
  id: string;
  name: string;
  expected: number;
  received: number;
  nextSeq: number;
  staging: File;
};
type Reply = { id: string; seq: number; ok: boolean; message?: string };
const MAX_BYTES = 12 * 1024 * 1024;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

/**
 * A file transfer sink, not an Android RPC bridge. The shared React UI owns
 * presentation and the per-host publication is already authorized on Gateway.
 * This sink never accepts filesystem paths from JavaScript.
 */
export class NativePublicationDownloads {
  private active: Job | null = null;
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
        Number(seq) > 512) return null;
    const reply = (ok: boolean, message?: string): Reply =>
      ({ id, seq: Number(seq), ok, ...(message ? { message } : {}) });
    try {
      if (request.type === 'publication.start') {
        if (this.active) throw Error('DOWNLOAD_ALREADY_ACTIVE');
        if (seq !== 0 || !Number.isSafeInteger(request.size) ||
            Number(request.size) <= 0 || Number(request.size) > MAX_BYTES ||
            typeof request.name !== 'string' || request.name.length > 200) {
          throw Error('INVALID_DOWNLOAD');
        }
        const staging = new File(Paths.cache, 'codexpub-' + id + '.part');
        if (staging.exists) staging.delete();
        staging.create();
        this.active = { id, name: request.name, expected: Number(request.size),
          received: 0, nextSeq: 1, staging };
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
        return reply(true);
      }
      if (request.type === 'publication.finish') {
        if (job.received !== job.expected || job.staging.size !== job.expected) {
          throw Error('DOWNLOAD_INCOMPLETE');
        }
        const suffix = /\.[a-zA-Z0-9]{1,6}$/.exec(job.name)?.[0] ?? '.bin';
        const folder = new Directory(Paths.document, 'published-files');
        folder.create({ idempotent: true, intermediates: true });
        const target = new File(folder, id + suffix);
        await job.staging.move(target, { overwrite: true });
        this.active = null;
        if (!await Sharing.isAvailableAsync()) throw Error('SHARING_NOT_AVAILABLE');
        await Sharing.shareAsync(target.uri, { dialogTitle: '保存或打开 Codex 文件' });
        return reply(true);
      }
      throw Error('INVALID_OPERATION');
    } catch (error) {
      const job = this.active;
      if (job?.id === id) {
        if (job.staging.exists) job.staging.delete();
        this.active = null;
      }
      const message = error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'DOWNLOAD_FAILED';
      return reply(false, message);
    }
  }
}
