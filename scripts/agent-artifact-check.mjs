// CI-safe production artifact gate. It deliberately poisons the old ambient
// VITE_* knobs while building the default artifact, then proves only
// `--mode agent` contains the Agent entry.
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);

async function runNpm(script, env = process.env) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['run', script], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (code !== 0) {
    throw new Error(`npm run ${script} exited with ${code}`);
  }
}

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const values = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await textFiles(path));
    else if (/\.(?:html|js|css)$/.test(entry.name)) {
      values.push(await readFile(path, 'utf8'));
    }
  }
  return values;
}

if (process.argv.includes('--build')) {
  await runNpm('build', {
    ...process.env,
    VITE_AGENT_CONTROLLER: '1',
    VITE_AGENT_ALLOWED_ORIGIN: 'http://127.0.0.1:5201',
  });
  await runNpm('build:agent');
}

const defaultText = (await textFiles(join(projectRoot, 'dist'))).join('\n');
const agentText = (await textFiles(join(projectRoot, 'dist-agent'))).join('\n');
for (const marker of [
  'gfxAgentPairing',
  'gfx.agent.claim.v1',
  'browser-object-url-v1',
]) {
  if (defaultText.includes(marker)) {
    throw new Error(`Default production artifact contains Agent marker: ${marker}`);
  }
  if (!agentText.includes(marker)) {
    throw new Error(`Agent production artifact is missing marker: ${marker}`);
  }
}
for (const [label, pattern] of [
  ['legacy __app global', /(?:globalThis|window)\.__app\b|["']__app["']/],
  ['legacy __render global', /(?:globalThis|window)\.__render\b|["']__render["']/],
  ['Google Fonts stylesheet', /fonts\.googleapis\.com/],
  ['Google Fonts asset', /fonts\.gstatic\.com/],
  ['Node-native ONNX runtime', /onnxruntime-node|onnxruntime_binding/],
  ['Node-native archive/image stack', /adm-zip|libvips|node_modules\/sharp/],
]) {
  if (pattern.test(defaultText) || pattern.test(agentText)) {
    throw new Error(`Production artifact contains forbidden marker: ${label}`);
  }
}

console.log('poisoned default artifact: Agent surface absent');
console.log('explicit Agent artifact: narrow bridge present');
console.log('production artifact markers: PASS');
