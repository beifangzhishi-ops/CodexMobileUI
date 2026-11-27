import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_PATH_HOSTS, validatePathHosts } from './pathResolver.mjs';

export class PathSettingsStore {
  constructor(filename, acceptsHost = (id) => id === '6v' || id === 'noha') {
    this.filename = filename; this.current = null; this.acceptsHost = acceptsHost;
  }
  async read() {
    if (this.current) return this.current;
    try { this.current = validatePathHosts(JSON.parse(await readFile(this.filename, 'utf8'))); }
    catch { this.current = validatePathHosts(DEFAULT_PATH_HOSTS); }
    this.current = Object.fromEntries(Object.entries(this.current).filter(([id]) => this.acceptsHost(id)));
    return this.current;
  }
  async save(value) {
    const parsed = validatePathHosts(value);
    if (!Object.keys(parsed).every(this.acceptsHost)) throw Error('UNKNOWN_HOST');
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = this.filename + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify(parsed), { flag: 'w' });
    await rename(temporary, this.filename);
    this.current = parsed;
    return parsed;
  }
}
