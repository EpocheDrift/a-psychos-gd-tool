// Stable PR smoke subset. It serves the already-built Agent artifact on the
// shared 5199 workbench, runs deterministic WebGPU checks, and always releases
// the port before the job exits.
import { spawn } from 'node:child_process';
import process from 'node:process';

const WORKBENCH_URL = 'http://127.0.0.1:5199/';
const STARTUP_TIMEOUT_MS = 30_000;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function startNpm(script, trailingArgs = []) {
  return spawn(
    npmCommand,
    [
      'run',
      script,
      ...(trailingArgs.length > 0 ? ['--', ...trailingArgs] : []),
    ],
    {
      env: process.env,
      stdio: 'inherit',
    },
  );
}

function waitForExit(child, label) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveExit();
        return;
      }
      rejectExit(new Error(
        `${label} exited with ${code ?? `signal ${signal ?? 'unknown'}`}`,
      ));
    });
  });
}

async function waitForWorkbench(preview, previewError) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (previewError.value) throw previewError.value;
    if (preview.exitCode !== null || preview.signalCode !== null) {
      throw new Error(
        'Agent workbench exited before becoming ready '
        + `(${preview.exitCode ?? `signal ${preview.signalCode}`}).`,
      );
    }
    try {
      const response = await fetch(WORKBENCH_URL, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `Agent workbench did not become ready within ${STARTUP_TIMEOUT_MS}ms.`,
  );
}

async function stopPreview(preview) {
  if (preview.exitCode !== null || preview.signalCode !== null) return;
  const exited = new Promise((resolveExit) => {
    preview.once('exit', resolveExit);
  });
  preview.kill('SIGTERM');
  const result = await Promise.race([
    exited.then(() => 'exited'),
    new Promise((resolveWait) =>
      setTimeout(() => resolveWait('timeout'), 3_000)),
  ]);
  if (
    result === 'timeout'
    && preview.exitCode === null
    && preview.signalCode === null
  ) {
    preview.kill('SIGKILL');
    await exited;
  }
}

const previewError = { value: null };
const preview = startNpm('preview:agent', [
  '--host',
  '127.0.0.1',
  '--port',
  '5199',
  '--strictPort',
]);
preview.once('error', (error) => {
  previewError.value = error;
});

try {
  await waitForWorkbench(preview, previewError);
  await waitForExit(startNpm('smoke:baseline'), 'smoke:baseline');
  await waitForExit(startNpm('smoke:frame'), 'smoke:frame');
  await waitForExit(startNpm('smoke:workbench'), 'smoke:workbench');
} finally {
  await stopPreview(preview);
}
