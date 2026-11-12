import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkInstalledDependencies } from '../scripts/check-installed-dependencies.mjs';

test('dependency cache reuse requires actual installed modules, not only an updated lockfile', () => {
  const folder = mkdtempSync(join(tmpdir(), 'visual-dependency-'));
  try {
    const lock = join(folder, 'package-lock.json');
    const modules = join(folder, 'node_modules');
    const packageFolder = join(modules, 'expo-clipboard');
    mkdirSync(packageFolder, { recursive: true });
    writeFileSync(lock, JSON.stringify({ packages: {
      '': { dependencies: { 'expo-clipboard': '~58.0.4' } },
      'node_modules/expo-clipboard': { version: '58.0.4' },
    } }));
    assert.equal(checkInstalledDependencies(lock, modules), false, 'no installed-state lock');
    writeFileSync(join(modules, '.package-lock.json'), JSON.stringify({ packages: {
      'node_modules/expo-clipboard': { version: '58.0.4' },
    } }));
    assert.equal(checkInstalledDependencies(lock, modules), false, 'missing package directory manifest');
    writeFileSync(join(packageFolder, 'package.json'), JSON.stringify({ name: 'expo-clipboard', version: '58.0.4' }));
    assert.equal(checkInstalledDependencies(lock, modules), true, 'complete install may be reused');
    writeFileSync(join(modules, '.package-lock.json'), JSON.stringify({ packages: {
      'node_modules/expo-clipboard': { version: '58.0.3' },
    } }));
    assert.equal(checkInstalledDependencies(lock, modules), false, 'stale native module must be reinstalled');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
