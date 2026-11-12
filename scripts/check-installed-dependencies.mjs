import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Validate npm's actual installed inventory, not just copied lockfile bytes. */
export function checkInstalledDependencies(lockFile, modulesDirectory) {
  try {
    const expected = JSON.parse(readFileSync(lockFile, 'utf8'));
    const installedLock = join(modulesDirectory, '.package-lock.json');
    const installed = JSON.parse(readFileSync(installedLock, 'utf8'));
    const root = expected.packages?.[''];
    if (!root || !expected.packages || !installed.packages) return false;

    const direct = { ...root.dependencies, ...root.devDependencies };
    for (const packageName of Object.keys(direct)) {
      const key = `node_modules/${packageName}`;
      const target = expected.packages[key];
      const actual = installed.packages[key];
      if (!target?.version || target.version !== actual?.version ||
        !existsSync(join(modulesDirectory, packageName, 'package.json'))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-installed-dependencies.mjs')) {
  const [lockFile, modulesDirectory] = process.argv.slice(2);
  const current = lockFile && modulesDirectory && checkInstalledDependencies(lockFile, modulesDirectory);
  if (!current) console.log('Installed dependency inventory differs from lockfile; npm ci required.');
  process.exitCode = current ? 0 : 1;
}
