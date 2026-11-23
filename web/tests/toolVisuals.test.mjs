import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findToolLogo, parseToolLogos, safeToolLogoUrl, toolDisplayName,
} from '../../shared/toolVisuals.ts';

test('logo catalog uses explicit native identities and HTTPS images only', () => {
  const logos = parseToolLogos({ data: [
    { id: 'app-1', name: 'App One', logo: { dark: { url: 'https://cdn.example/app.png' } } },
    { id: 'app-2', name: 'Unsafe', iconUrl: 'file:///C:/secret' },
  ] }, { marketplaces: [{ plugins: [
    { id: 'plugin-1', name: 'Plugin One', icon: { small: 'https://cdn.example/logo.svg' } },
  ] }] });
  assert.equal(findToolLogo(logos, 'plugin-1')?.url, 'https://cdn.example/logo.svg');
  assert.equal(findToolLogo(logos, undefined, 'app-1')?.name, 'App One');
  assert.equal(findToolLogo(logos, 'not-listed'), undefined);
  assert.ok(!logos.some((entry) => entry.id === 'app-2'));
  assert.equal(safeToolLogoUrl('http://example.com/pic.png'), '');
  assert.equal(safeToolLogoUrl('https://u:p@example.com/a.png'), '');
});

test('compact tool labels hide redundant type names and retain actual commands', () => {
  assert.equal(toolDisplayName('commandExecution', '执行命令', 'pwd'), 'pwd');
  assert.equal(toolDisplayName('imageView', '查看图片', 'C:\\out\\preview.png'), 'preview.png');
  assert.equal(toolDisplayName('mcpToolCall', 'MCP 工具调用',
    'service / lookup', 'service', 'lookup'), 'service · lookup');
});
