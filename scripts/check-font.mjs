// Verify the exact freely licensed font and its license notice committed to
// the repository. This uses only Node built-ins so setup behaves consistently
// across supported development environments.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expectedFiles = new Map([
  [
    'public/fonts/JetBrainsMono-Regular.ttf',
    'e6fd0d7e91550b3ed2b735d4312474362c4716edc4fc0577a0f61ed782d5aed1',
  ],
  [
    'public/fonts/OFL.txt',
    'a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697',
  ],
]);

for (const [path, expectedSha256] of expectedFiles) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`Bundled font asset is missing: ${path}`);
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Bundled font asset failed SHA-256 verification: ${path}`);
  }
  console.log(`bundled font asset verified: ${path}`);
}
