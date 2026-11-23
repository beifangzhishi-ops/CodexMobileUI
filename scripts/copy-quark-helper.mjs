// Keep the bundled Python helper beside compiled CommonJS Gateway modules.
// Node TypeScript compilation does not copy non-TypeScript runtime assets.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('gateway/quark-transfer/cloud_transfer.py');
const target = resolve('dist/gateway/quark-transfer/cloud_transfer.py');
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
