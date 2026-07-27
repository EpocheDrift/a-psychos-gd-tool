import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const target = fileURLToPath(new URL('../dist/', import.meta.url));
const expectedTarget = resolve(packageRoot, 'dist');

if (resolve(target) !== expectedTarget || expectedTarget === resolve(packageRoot)) {
  throw new Error('Refusing to clean an unexpected companion build target.');
}

await rm(target, { recursive: true, force: true });
