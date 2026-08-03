import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillName = 'collaborate-on-graphic-design';
const skillDir = join(repoRoot, 'skills', skillName);
const skillPath = join(skillDir, 'SKILL.md');

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) {
      files.push(...await collectFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function fail(message) {
  throw new Error(`Aesthetic Skill check failed: ${message}`);
}

const skill = await readFile(skillPath, 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter) fail('SKILL.md is missing YAML frontmatter.');

const fields = new Map(
  frontmatter[1].split('\n').map((line) => {
    const colon = line.indexOf(':');
    if (colon < 1) fail(`invalid frontmatter line: ${line}`);
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);

if ([...fields.keys()].join(',') !== 'name,description') {
  fail('frontmatter must contain only name and description, in that order.');
}
if (fields.get('name') !== skillName) fail('frontmatter name differs from folder name.');
if (!fields.get('description')?.includes('Graphic Design MCP')) {
  fail('description must identify the Graphic Design MCP trigger context.');
}
if (!skill.includes('v0.1-alpha')) fail('alpha status boundary is missing.');

const requiredReferences = [
  'brief-and-directions.md',
  'mcp-execution.md',
  'critique-and-feedback.md',
  'evidence-and-evals.md',
];

for (const reference of requiredReferences) {
  const relative = `references/${reference}`;
  if (!skill.includes(`(${relative})`)) fail(`SKILL.md does not route to ${relative}.`);
  await stat(join(skillDir, relative));
}

const metadata = await readFile(join(skillDir, 'agents', 'openai.yaml'), 'utf8');
const shortDescription = metadata.match(/short_description: "([^"]+)"/)?.[1];
if (!shortDescription || shortDescription.length < 25 || shortDescription.length > 64) {
  fail('openai.yaml short_description must contain 25–64 characters.');
}
if (!metadata.includes(`$${skillName}`)) {
  fail('openai.yaml default_prompt must explicitly invoke the Skill.');
}
if (!metadata.includes('v0.1-alpha') || !metadata.toLowerCase().includes('alpha')) {
  fail('openai.yaml must expose the evidence-limited alpha boundary.');
}

const textFiles = (await collectFiles(skillDir)).filter((path) => path.endsWith('.md') || path.endsWith('.yaml'));
for (const path of textFiles) {
  const text = await readFile(path, 'utf8');
  if (!text.endsWith('\n')) fail(`${path} has no final newline.`);
  if (/\bTODO\b|\[TODO/.test(text)) fail(`${path} contains a placeholder.`);
  if (/\/Users\/|Documents\/Projects|file:\/\//.test(text)) {
    fail(`${path} contains a local absolute path.`);
  }

  if (path.endsWith('.md')) {
    for (const [, rawTarget] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = rawTarget.split('#', 1)[0];
      if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
      await stat(resolve(dirname(path), target));
    }
  }
}

await import(pathToFileURL(join(
  repoRoot,
  'evals',
  skillName,
  'v0.1-alpha',
  'fixtures',
  'validate-fixtures.mjs',
)).href);

console.log(`Validated ${skillName} structure, metadata, references, and fixtures.`);
