import { cp, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(
  new URL('../../../dist-agent/', import.meta.url),
);
const target = fileURLToPath(new URL('../dist/app/', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedTarget = resolve(packageRoot, 'dist/app');

if (resolve(target) !== expectedTarget) {
  throw new Error('Refusing to replace an unexpected app artifact target.');
}
if (!(await stat(source)).isDirectory()) {
  throw new Error('Run the Agent Vite build before building the companion.');
}
await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  errorOnExist: true,
  force: false,
  filter: (entry) => !entry.endsWith('.map'),
});
if (!(await readdir(target)).includes('index.html')) {
  throw new Error('The copied Agent artifact is missing index.html.');
}
