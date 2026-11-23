import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const UUID = /^[0-9a-f-]{20,80}$/i;
const HOSTS = ['6v', 'noha'];
function valid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !HOSTS.includes(value.hostId) || !UUID.test(value.threadId) ||
      !UUID.test(value.turnId) || !Array.isArray(value.changes) ||
      value.changes.length < 1 || value.changes.length > 24) throw Error('INVALID_OVERLAY');
  for (const item of value.changes) {
    if (!item || typeof item.from !== 'string' || typeof item.to !== 'string' ||
        item.from.length > 2048 || item.to.length > 2048 ||
        !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(item.from) ||
        !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(item.to)) throw Error('INVALID_OVERLAY');
  }
  return { hostId: value.hostId, threadId: value.threadId,
    turnId: value.turnId, changes: value.changes.map(({ from, to }) => ({ from, to })) };
}

/** UI-only display metadata. Native thread content remains the sole inference source. */
export class PathOverlayStore {
  constructor(filename) { this.filename = filename; this.queue = Promise.resolve(); }
  async read(hostId, threadId) {
    if (!HOSTS.includes(hostId) || !UUID.test(threadId)) throw Error('INVALID_OVERLAY_QUERY');
    let data;
    try { data = JSON.parse(await readFile(this.filename, 'utf8')); }
    catch { return []; }
    if (!Array.isArray(data)) return [];
    return data.filter((record) => record.hostId === hostId &&
      record.threadId === threadId).map((record) => valid(record)).slice(-150);
  }
  async save(input) {
    const item = valid(input);
    const task = this.queue.then(async () => {
      let all;
      try { all = JSON.parse(await readFile(this.filename, 'utf8')); }
      catch { all = []; }
      if (!Array.isArray(all)) all = [];
      const previous = all.find((record) => record.hostId === item.hostId &&
        record.threadId === item.threadId && record.turnId === item.turnId);
      if (previous) {
        const existing = valid(previous);
        const merged = [...existing.changes, ...item.changes];
        item.changes = [...new Map(merged.map((part) => [part.to, part])).values()].slice(-24);
      }
      all = all.filter((record) => !(record.hostId === item.hostId &&
        record.threadId === item.threadId && record.turnId === item.turnId));
      all.push(item);
      all = all.slice(-1000);
      await mkdir(dirname(this.filename), { recursive: true });
      const temp = this.filename + '.' + process.pid + '.tmp';
      await writeFile(temp, JSON.stringify(all), 'utf8');
      await rename(temp, this.filename);
      return { ok: true };
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}
