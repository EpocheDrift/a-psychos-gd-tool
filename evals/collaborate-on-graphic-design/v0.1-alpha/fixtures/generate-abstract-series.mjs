import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const width = 600;
const height = 750;
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(fixtureDir, 'generated');

const fixtures = [
  { name: 'field-01.png', pattern: 'offset-orbit' },
  { name: 'field-02.png', pattern: 'vertical-slit' },
  { name: 'field-03.png', pattern: 'low-horizon' },
  { name: 'field-04.png', pattern: 'split-current' },
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function encodePng(rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    rgba.copy(scanlines, row + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(a, b, amount) {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, amount)));
}

function paint(pattern) {
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      let color;

      if (pattern === 'offset-orbit') {
        const distance = Math.hypot(nx - 0.73, ny - 0.28);
        const ring = Math.abs(distance - 0.24) < 0.035;
        const field = [mix(19, 62, ny), mix(28, 42, nx), mix(48, 83, nx)];
        color = ring ? [224, 127, 91] : field;
      } else if (pattern === 'vertical-slit') {
        const slit = nx > 0.18 && nx < 0.29;
        const block = nx > 0.57 && ny > 0.18 && ny < 0.67;
        color = slit ? [218, 209, 170] : block ? [52, 91, 103] : [17, 25, 31];
      } else if (pattern === 'low-horizon') {
        const wave = 0.66 + Math.sin(nx * Math.PI * 3.2) * 0.045;
        const above = ny < wave;
        color = above
          ? [mix(108, 38, ny), mix(123, 51, nx), mix(135, 78, nx)]
          : [222, 187, 111];
      } else {
        const diagonal = ny > 0.86 - nx * 0.72;
        const voidShape = Math.hypot(nx - 0.34, ny - 0.44) < 0.16;
        color = voidShape
          ? [19, 20, 25]
          : diagonal
            ? [177, 204, 196]
            : [58, 43, 76];
      }

      const index = (y * width + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }

  return rgba;
}

await mkdir(outputDir, { recursive: true });

const manifest = {
  schemaVersion: 1,
  generatedBy: 'generate-abstract-series.mjs',
  dimensions: { width, height },
  license: 'MIT',
  containsPrivateAssets: false,
  fixtures: [],
};

for (const fixture of fixtures) {
  const png = encodePng(paint(fixture.pattern));
  await writeFile(join(outputDir, fixture.name), png);
  manifest.fixtures.push({
    ...fixture,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  });
}

await writeFile(
  join(outputDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Generated ${fixtures.length} synthetic fixtures in ${outputDir}`);
