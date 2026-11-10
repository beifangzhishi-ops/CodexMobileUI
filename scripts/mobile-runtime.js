import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const requiredFiles = [
  'codex.exe', 'codex-code-mode-host.exe',
  'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe',
];

export function readRuntime(executable) {
  const directory = path.dirname(executable);
  const missing = requiredFiles.filter((name) => {
    try {
      const file = fs.statSync(path.join(directory, name));
      return !file.isFile() || file.size === 0;
    } catch { return true; }
  });
  if (missing.length) return { executable, missing };

  const names = fs.readdirSync(directory)
    .filter((name) => /^(codex.*\.exe|.*\.dll)$/i.test(name))
    .sort();
  const files = names.map((name) => ({
    name,
    hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex'),
  }));
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(files)).digest('hex');
  return { executable, missing, files, fingerprint, modified: fs.statSync(executable).mtimeMs };
}

export function selectRuntime({ desktop = [] }) {
  const rejected = [];
  const complete = [];
  for (const executable of new Set(desktop)) {
    try {
      const runtime = readRuntime(executable);
      if (!runtime.missing.length) complete.push(runtime);
      else rejected.push({
        executable,
        reason: `缺失或为空：${runtime.missing.join('、')}`,
      });
    } catch (error) {
      rejected.push({ executable, reason: error.message });
    }
  }
  complete.sort((a, b) =>
    b.modified - a.modified || a.executable.localeCompare(b.executable));
  return { selected: complete[0] ?? null, rejected };
}

export function prepareRuntime(selected, root) {
  if (!selected) throw new Error('未发现完整 Codex Desktop 内核，请检查桌面端安装');
  const resolvedRoot = path.resolve(root);
  const destination = path.join(resolvedRoot, selected.fingerprint);
  const executable = path.join(destination, 'codex.exe');
  if (fs.existsSync(destination)) {
    if (readRuntime(executable).fingerprint !== selected.fingerprint) {
      throw new Error(`独立运行时校验失败，保留原目录以免影响正在运行的进程：${destination}`);
    }
    return { ...selected, source: selected.executable, executable };
  }

  fs.mkdirSync(resolvedRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(resolvedRoot, '.staging-'));
  try {
    for (const { name } of selected.files) {
      fs.copyFileSync(
        path.join(path.dirname(selected.executable), name),
        path.join(staging, name),
      );
    }
    if (readRuntime(path.join(staging, 'codex.exe')).fingerprint !== selected.fingerprint) {
      throw new Error('复制期间源运行时发生变化，请重新检查 Desktop 内核版本');
    }
    fs.writeFileSync(
      path.join(staging, '来源.json'),
      JSON.stringify({ 来源: selected.executable, 指纹: selected.fingerprint }, null, 2),
    );
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(staging, destination);
        break;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (2 ** attempt));
      }
    }
  } finally {
    if (path.dirname(path.resolve(staging)) !== resolvedRoot) {
      throw new Error('临时目录超出运行时根目录');
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { ...selected, source: selected.executable, executable };
}

export function runtimeStatus(selected, activeExecutable, root) {
  if (!activeExecutable) return { active: null, updateAvailable: false, managed: false };
  const active = readRuntime(activeExecutable);
  const relative = path.relative(path.resolve(root), path.resolve(activeExecutable));
  const managed = relative !== '' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  const integrityError = managed && active.fingerprint &&
    path.basename(path.dirname(activeExecutable)) !== active.fingerprint;
  return {
    active, managed,
    integrityError: Boolean(integrityError),
    updateAvailable: Boolean(selected && active.fingerprint !== selected.fingerprint),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const request = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const result = selectRuntime(request.candidates);
    if (process.argv[2] === 'prepare') {
      result.prepared = prepareRuntime(result.selected, request.runtimeRoot);
    } else if (process.argv[2] === 'inspect') {
      Object.assign(result, runtimeStatus(result.selected, request.activeExecutable, request.runtimeRoot));
    } else {
      throw new Error('运行时检查命令无效');
    }
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
