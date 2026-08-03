import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillName = 'collaborate-on-graphic-design';
const skillDir = join(repoRoot, '.agents', 'skills', skillName);
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

function headingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function validateMarkdownTargets(path, text) {
  for (const [, rawTarget] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = rawTarget.trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;

    const [rawFile, rawFragment] = target.split('#', 2);
    let relativeFile = rawFile;
    let fragment = rawFragment;
    try {
      relativeFile = decodeURIComponent(relativeFile);
      fragment = fragment ? decodeURIComponent(fragment) : fragment;
    } catch {
      fail(`${path} contains an invalid encoded Markdown target: ${rawTarget}`);
    }

    const targetPath = relativeFile ? resolve(dirname(path), relativeFile) : path;
    await stat(targetPath);
    if (!fragment) continue;

    const targetText = targetPath === path ? text : await readFile(targetPath, 'utf8');
    const headingSlugs = [...targetText.matchAll(/^#{1,6}\s+(.+)$/gm)]
      .map(([, heading]) => headingSlug(heading));
    if (!headingSlugs.includes(fragment)) {
      fail(`${path} links to missing heading #${fragment} in ${targetPath}.`);
    }
  }
}

try {
  await stat(join(repoRoot, 'skills', skillName));
  fail('legacy skills/ package still exists; keep the canonical repo Skill under .agents/skills.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
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

  if (path.endsWith('.md')) await validateMarkdownTargets(path, text);
}

const onboardingDocuments = [
  join(repoRoot, 'docs', 'codex-quickstart.md'),
  join(repoRoot, 'docs', 'codex-quickstart.zh-CN.md'),
];
const onboardingRequirements = [
  '.agents/skills/collaborate-on-graphic-design',
  'codex mcp add graphic-design',
  'codex mcp list',
  'codex mcp get graphic-design --json',
  'codex mcp remove graphic-design',
  '--profile=full-design-v1',
  '--trusted-local',
  '$collaborate-on-graphic-design',
  '/skills',
  '/mcp',
];
const posixRegistration = [
  'codex mcp add graphic-design -- \\',
  '  "$(command -v node)" \\',
  '  "$PWD/packages/mcp-companion/dist/index.js" \\',
  '  --profile=full-design-v1 \\',
  '  --trusted-local',
].join('\n');
const powershellRegistration = [
  '$gdNodePath = (Get-Command node).Source',
  '$gdRepoPath = (Get-Location).Path',
  "$gdEntryPath = Join-Path $gdRepoPath 'packages/mcp-companion/dist/index.js'",
  'codex mcp add graphic-design -- $gdNodePath $gdEntryPath --profile=full-design-v1 --trusted-local',
].join('\n');
const expectedNumberedHeadings = '1,2,3,4,5,6';

for (const path of onboardingDocuments) {
  const text = await readFile(path, 'utf8');
  for (const requirement of onboardingRequirements) {
    if (!text.includes(requirement)) {
      fail(`${path} is missing onboarding requirement: ${requirement}`);
    }
  }
  if (!text.includes(`\`\`\`sh\n${posixRegistration}\n\`\`\``)) {
    fail(`${path} does not contain the exact POSIX registration block.`);
  }
  if (!text.includes(`\`\`\`powershell\n${powershellRegistration}\n\`\`\``)) {
    fail(`${path} does not contain the exact PowerShell registration block.`);
  }
  const numberedHeadings = [...text.matchAll(/^## (\d+)\./gm)]
    .map(([, number]) => number)
    .join(',');
  if (numberedHeadings !== expectedNumberedHeadings) {
    fail(`${path} must keep the bilingual 1–6 onboarding sequence.`);
  }
  await validateMarkdownTargets(path, text);
}

const entryDocuments = [
  join(repoRoot, 'README.md'),
  join(repoRoot, 'README.zh-CN.md'),
];
for (const path of entryDocuments) {
  const text = await readFile(path, 'utf8');
  if (!text.includes('.agents/skills/collaborate-on-graphic-design/SKILL.md')) {
    fail(`${path} does not link to the discoverable repo-local Skill.`);
  }
  if (!text.includes('docs/codex-quickstart')) {
    fail(`${path} does not route Codex users to the Quick Start.`);
  }
  if (text.includes('](skills/collaborate-on-graphic-design/')) {
    fail(`${path} still links to the legacy Skill location.`);
  }
  await validateMarkdownTargets(path, text);
}

await import(pathToFileURL(join(
  repoRoot,
  'evals',
  skillName,
  'v0.1-alpha',
  'fixtures',
  'validate-fixtures.mjs',
)).href);

console.log(`Validated ${skillName} repo discovery layout, structure, metadata, exact onboarding contracts, links, references, and fixtures.`);
