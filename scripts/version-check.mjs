import { readFile } from 'node:fs/promises';
import process from 'node:process';

const rootPackage = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const companionPackage = JSON.parse(await readFile(
  new URL('../packages/mcp-companion/package.json', import.meta.url),
  'utf8',
));
const versionSource = await readFile(
  new URL('../packages/mcp-companion/src/version.ts', import.meta.url),
  'utf8',
);
const runtimeMatch = versionSource.match(
  /export const COMPANION_VERSION = '([^']+)' as const;/u,
);

if (!runtimeMatch) {
  throw new Error('Companion runtime version constant was not found.');
}

const versions = {
  root: rootPackage.version,
  companion: companionPackage.version,
  runtime: runtimeMatch[1],
};
const uniqueVersions = new Set(Object.values(versions));
if (
  uniqueVersions.size !== 1
  || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(versions.root)
) {
  throw new Error(`Version mismatch: ${JSON.stringify(versions)}`);
}

if (process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `v${versions.root}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(
      `Release tag mismatch: expected ${expectedTag}, received ${
        process.env.GITHUB_REF_NAME ?? '(missing)'
      }`,
    );
  }
}

console.log(`version surfaces aligned: ${versions.root}`);
