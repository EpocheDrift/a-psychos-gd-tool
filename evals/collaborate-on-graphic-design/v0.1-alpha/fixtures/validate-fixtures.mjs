import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(join(fixtureDir, 'generated', 'manifest.json'), 'utf8'),
);
const baseline = JSON.parse(
  await readFile(join(fixtureDir, 'baseline-spec.json'), 'utf8'),
);

if (manifest.containsPrivateAssets !== false) {
  throw new Error('Manifest must declare containsPrivateAssets=false.');
}

if (manifest.fixtures.length !== baseline.members.length) {
  throw new Error('Manifest and baseline member counts differ.');
}

const baselineByAsset = new Map(
  baseline.members.map((member) => [member.asset.replace('generated/', ''), member]),
);

for (const fixture of manifest.fixtures) {
  const bytes = await readFile(join(fixtureDir, 'generated', fixture.name));
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  const baselineMember = baselineByAsset.get(fixture.name);

  if (actualHash !== fixture.sha256) {
    throw new Error(`${fixture.name}: generated hash differs from manifest.`);
  }

  if (!baselineMember || baselineMember.sha256 !== actualHash) {
    throw new Error(`${fixture.name}: baseline hash is missing or stale.`);
  }

  if (bytes.readUInt32BE(16) !== manifest.dimensions.width
      || bytes.readUInt32BE(20) !== manifest.dimensions.height) {
    throw new Error(`${fixture.name}: PNG dimensions differ from manifest.`);
  }
}

console.log(`Validated ${manifest.fixtures.length} public synthetic fixtures.`);
