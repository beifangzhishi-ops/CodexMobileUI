/**
 * Codex Desktop's native file-reference envelope. Only host-owned upload
 * paths verified by the destination host belong here (uploaded files or
 * accessible SMB references). This is not a custom instruction
 * to read files and must not be appended to image-only user messages.
 */
export type DesktopFileReference = { name: string; path: string };

export function desktopFileMessage(text: string, files: readonly DesktopFileReference[]): string {
  if (files.length === 0) return text.trim();
  if (files.length > 4 || files.some((file) =>
    !file.name || !file.path || /[\r\n]/.test(file.name + file.path))) {
    throw new Error('INVALID_FILE_REFERENCES');
  }
  return '# Files mentioned by the user:\n\n' +
    files.map((file) => '## ' + file.name + ': ' + file.path).join('\n\n') +
    '\n\n## My request for Codex:\n\n' + text.trim();
}
