import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PATH_HOSTS, validatePathHosts, localToNetwork, networkToLocal,
  pathForViewer, resolveInputPath, resolveUserText, resolveUserTextDetailed,
} from '../server/pathResolver.mjs';
import { PathSettingsStore } from '../server/pathSettings.mjs';
import { PathOverlayStore } from '../server/pathOverlays.mjs';
import { localFileName, renderableLocalFileLinks } from '../../shared/localFileLinks.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hosts = DEFAULT_PATH_HOSTS;
const local = 'C:\\Users\\noha\\Documents\\report.pdf';
const network = '\\\\100.96.30.32\\noha\\Users\\noha\\Documents\\report.pdf';
const has = (...paths) => async (path) => paths.some((item) =>
  path.toLowerCase() === item.toLowerCase());

test('share name maps whole C drive; viewer maps between hosts', () => {
  assert.equal(localToNetwork(local, 'noha', hosts), network);
  assert.deepEqual(networkToLocal(network, hosts), { owner: 'noha', path: local });
  assert.equal(pathForViewer(local, 'noha', 'noha', hosts), local);
  assert.equal(pathForViewer(local, 'noha', '6v', hosts), network);
  assert.equal(pathForViewer(network, 'noha', 'noha', hosts), local);
  assert.equal(pathForViewer(network, 'noha', '6v', hosts), network);
  assert.equal(pathForViewer('C:\\NotAFile', 'noha', '6v', hosts),
    '\\\\100.96.30.32\\noha\\NotAFile');
});

test('only explicit UNC Markdown links become clickable host file references', () => {
  const wrapped = renderableLocalFileLinks('[report](' + network + ')');
  assert.deepEqual(Object.values(wrapped.targets).map(({ path }) => path), [network]);
  assert.match(wrapped.markdown, /codexmobile\.invalid\/local-file\/0/);
  assert.equal(renderableLocalFileLinks('普通路径 ' + network).markdown,
    '普通路径 ' + network);
  assert.deepEqual(Object.values(renderableLocalFileLinks('`[code](' +
    network + ')`').targets), []);
});

test('source locations retain line and column independently of the full copy and reveal path', () => {
  const source = '[source](' + network + ':185) [other](file:///C:/Some%20Folder/source.ts:49:2)';
  const [remote, drive] = Object.values(renderableLocalFileLinks(source).targets);
  assert.equal(remote.path, network);
  assert.equal(localFileName(remote.path) + remote.location, 'report.pdf:185');
  assert.equal(drive.path, 'C:\\Some Folder\\source.ts');
  assert.equal(localFileName(drive.path) + drive.location, 'source.ts:49:2');
});

test('C path is probed on each drive and returns only one confirmed match', async () => {
  assert.equal(await resolveInputPath(local, '6v', hosts, has(network)), network);
  assert.equal(await resolveInputPath(local, 'noha', hosts, has(local)), local);
  assert.equal(await resolveInputPath(local, '6v', hosts, has(local, network)), local);
  // Both computers have that same absolute path: do NOT guess a source.
  assert.equal(await resolveInputPath(local, '6v', hosts, has(local, network)),
    local);
  assert.equal(await resolveInputPath(local, '6v', hosts, has()), local);
  assert.equal(await resolveInputPath(network, 'noha', hosts, has(local)), local);
});

test('unambiguous C path on noha destination uses 6v share', async () => {
  const source = 'C:\\Users\\Songjx\\report.txt';
  const expected = '\\\\100.76.74.124\\6v1f\\Users\\Songjx\\report.txt';
  assert.equal(await resolveInputPath(source, 'noha', hosts, has(expected)), expected);
});

test('user absolute path in ordinary text and code changes, other prose stays', async () => {
  const text = '检查 ' + local + ' 并保存。\n\x60' + local + '\x60';
  const expected = '检查 ' + network + ' 并保存。\n\x60' + network + '\x60';
  assert.equal(await resolveUserText(text, '6v', hosts, has(network)), expected);
  assert.equal(await resolveUserText('普通文件名 report.pdf', '6v', hosts, has(network)),
    '普通文件名 report.pdf');
});

test('two absolute paths on one line are each resolved independently', async () => {
  const six = 'C:\\Users\\Songjx\\test.txt';
  const sixNetwork = '\\\\100.76.74.124\\6v1f\\Users\\Songjx\\test.txt';
  const text = '文件 ' + local + ' 和 ' + six;
  assert.equal(await resolveUserText(text, 'noha', hosts, has(local, sixNetwork)),
    '文件 ' + local + ' 和 ' + sixNetwork);
});

test('duplicate C files stop sending rather than silently choose target local C', async () => {
  const result = await resolveUserTextDetailed('用 ' + local, '6v', hosts,
    has(local, network));
  assert.deepEqual(result.ambiguities, [local]);
  assert.equal(result.text, '用 ' + local);
  assert.deepEqual(result.changes, []);
});


test('third registered host participates in verified path resolution', async () => {
  const expanded = validatePathHosts({ ...hosts, 'third-pc': { ip: '100.90.10.11', share: 'third' } });
  const remote = localToNetwork(local, 'third-pc', expanded);
  assert.equal(await resolveInputPath(local, '6v', expanded, has(remote)), remote);
  assert.deepEqual((await resolveUserTextDetailed(local, '6v', expanded, has(local, remote))).ambiguities, [local]);
  assert.equal(await resolveInputPath(local, 'third-pc', hosts, has(local)), local);
  assert.equal(pathForViewer(local, 'third-pc', '6v', hosts), local);
});

test('invalid configs and unknown UNC shares cannot redirect', async () => {
  assert.throws(() => validatePathHosts({ ...hosts, noha: { ip: '8.8.8.8', share: 'noha' } }));
  assert.throws(() => validatePathHosts({ ...hosts, noha: { ip: '100.96.30.32', share: '..' } }));
  assert.equal(await resolveInputPath('\\\\untrusted\\data\\file.txt', '6v', hosts, has()),
    '\\\\untrusted\\data\\file.txt');
});

test('persisted per-host IP and share config survives reload', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'path-host-test-'));
  try {
    const file = join(folder, 'path-hosts.json');
    const store = new PathSettingsStore(file);
    assert.deepEqual(await store.read(), hosts);
    const changed = { ...hosts, noha: { ip: '100.96.30.31', share: 'noha2' } };
    assert.deepEqual(await store.save(changed), changed);
    assert.deepEqual(await new PathSettingsStore(file).read(), changed);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('original user file references persist by native turn and merge steers', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'path-overlays-test-'));
  try {
    const store = new PathOverlayStore(join(folder, 'overlay.json'));
    const base = { hostId: '6v', threadId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    await store.save({ ...base, changes: [{ from: local, to: network }] });
    await store.save({ ...base, changes: [{ from: 'C:\\X\\b.txt',
      to: '\\\\100.96.30.32\\noha\\X\\b.txt' }] });
    const after = await new PathOverlayStore(join(folder, 'overlay.json'))
      .read(base.hostId, base.threadId);
    assert.equal(after.length, 1);
    assert.equal(after[0].changes.length, 2);
    assert.deepEqual(await store.read('noha', base.threadId), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
