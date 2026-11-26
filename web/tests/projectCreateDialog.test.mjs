import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
});
after(() => server.close());

const {
  displayedProjectName,
  projectDirectoryBasename,
  validProjectName,
} = await server.ssrLoadModule('/src/ProjectCreateDialog.tsx');

test('project defaults use the selected Windows or UNC directory basename', () => {
  assert.equal(projectDirectoryBasename('C:\\Users\\Example\\新建项目'), '新建项目');
  assert.equal(projectDirectoryBasename('C:\\Users\\Example\\新建项目\\'), '新建项目');
  assert.equal(projectDirectoryBasename('\\\\server\\share\\repo\\'), 'repo');
  assert.equal(projectDirectoryBasename('C:/Users/Example/repo/'), 'repo');
  assert.equal(projectDirectoryBasename('C:\\'), '');
  assert.equal(projectDirectoryBasename('\\\\server\\share\\'), 'share');
  assert.equal(projectDirectoryBasename(null), '');
});

test('project names count Unicode code points and enforce the 80-character bound', () => {
  const eighty = '😀'.repeat(80);
  assert.equal(validProjectName(eighty), true);
  assert.equal(validProjectName(eighty + '😀'), false);
  assert.equal(validProjectName(' 项目 '), true);
  assert.equal(validProjectName('   '), false);
  assert.equal(validProjectName('project\nname'), false);
});

test('an empty editable name stays empty until automatic defaulting is restored', () => {
  assert.equal(displayedProjectName('repo', null), 'repo');
  assert.equal(displayedProjectName('repo', 'Manual name'), 'Manual name');
  assert.equal(displayedProjectName('repo', ''), '');
  assert.equal(displayedProjectName('repo', 'N'), 'N');
});
