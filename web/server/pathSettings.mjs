import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_PATH_HOSTS, validatePathHosts } from './pathResolver.mjs';

export class PathSettingsStore {
  constructor(filename) { this.filename = filename; this.current = null; }
  async read() {
    if (this.current) return this.current;
    try { this.current = validatePathHosts(JSON.parse(await readFile(this.filename, 'utf8'))); }
    catch { this.current = validatePathHosts(DEFAULT_PATH_HOSTS); }
    return this.current;
  }
  async save(value) {
    const parsed = validatePathHosts(value);
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = this.filename + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify(parsed), { flag: 'w' });
    await rename(temporary, this.filename);
    this.current = parsed;
    return parsed;
  }
}
