import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Standalone port of CCM's WCM-derived Quark desktop transfer helper.
 * Uses Quark's logged-in desktop client, not CCM or an exported account token.
 * Only a fully verified FINISH/100%/matching-size result counts as success.
 */
export async function uploadToQuark(path: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('QUARK_UNAVAILABLE');
  const helper = resolve(__dirname, 'quark-transfer', 'cloud_transfer.py');
  if (!existsSync(helper)) throw new Error('QUARK_HELPER_MISSING');
  await new Promise<void>((resolveUpload, rejectUpload) => {
    const child = spawn('python.exe', [helper, 'upload', path, '--timeout', '1800', '--json'], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
        QUARK_DESKTOP_URL: 'http://127.0.0.1:9125' },
    });
    let output = '';
    let outputOverflow = false;
    let done = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('QUARK_TIMEOUT'));
    }, 31 * 60_000);
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) rejectUpload(error);
      else resolveUpload();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > 64 * 1024) {
        outputOverflow = true;
        child.kill();
        return;
      }
      output += chunk.toString('utf8');
    });
    // The helper's errors may contain local filenames. Do not collect/log them.
    child.stderr.resume();
    child.on('error', () => finish(new Error('QUARK_UNAVAILABLE')));
    child.on('close', (code) => {
      if (outputOverflow || code !== 0) return finish(new Error('QUARK_UPLOAD_FAILED'));
      try {
        const reply = JSON.parse(output.trim()) as {
          ok?: unknown; accepted?: unknown; completed?: unknown;
        };
        const completed = Array.isArray(reply.completed) ? reply.completed : [];
        const entry = completed[0] as Record<string, unknown> | undefined;
        if (reply.ok !== true || reply.accepted !== true || completed.length !== 1 ||
            !entry || !['FINISH', 'SUCCESS', 'SUCCEEDED'].includes(String(entry.status)) ||
            typeof entry.progress !== 'number' || entry.progress < 100 ||
            typeof entry.size !== 'number' || entry.size <= 0) {
          throw new Error('UNVERIFIED_QUARK_UPLOAD');
        }
        finish();
      } catch { finish(new Error('QUARK_UPLOAD_FAILED')); }
    });
  });
}
