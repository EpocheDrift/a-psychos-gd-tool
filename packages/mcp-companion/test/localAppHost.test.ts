import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BridgeClient } from '../src/bridgeClient.js';
import { LocalAppHost } from '../src/localAppHost.js';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COMPANION_CONTROL_META_NAME,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
  AGENT_COOKIE_NAME,
  AGENT_SECURITY_HEADERS,
  AGENT_WEBSOCKET_PROTOCOL,
} from '../src/agentSecurity.js';
import { COMPANION_VERSION } from '../src/version.js';

let fixtureDirectory = '';
let host: LocalAppHost | null = null;
let bridge: BridgeClient | null = null;

beforeEach(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'gfx-mcp-host-'));
  await writeFile(
    join(fixtureDirectory, 'index.html'),
    '<!doctype html><html><head></head><body>fixture</body></html>',
  );
  await writeFile(join(fixtureDirectory, 'app.js'), 'export const ok = true;');
  await writeFile(
    join(fixtureDirectory, 'factory-image.jpg'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  await writeFile(
    join(fixtureDirectory, 'alternate.jpeg'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  bridge = new BridgeClient({ requestedScopes: ['read', 'preview'] });
  host = new LocalAppHost({
    bridge,
    appDirectory: fixtureDirectory,
  });
  await host.start();
});

afterEach(async () => {
  await host?.close();
  host = null;
  bridge = null;
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

function httpCall(options: {
  path: string;
  host?: string;
  cookie?: string;
  method?: string;
}): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: '127.0.0.1',
      port: 5199,
      path: options.path,
      method: options.method ?? 'GET',
      headers: {
        Host: options.host ?? '127.0.0.1:5199',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

function rawHttp(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(5199, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.once('connect', () => socket.end(text));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.once('error', reject);
  });
}

function rawWebSocket(headers: readonly string[]): Promise<string> {
  return rawHttp(
    [
      'GET /__gfx_agent_bridge_v1 HTTP/1.1',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      ...headers,
      '',
      '',
    ].join('\r\n'),
  );
}

function rejectedWebSocket(options: {
  origin?: string;
  cookie?: string;
  path?: string;
  protocol?: string | readonly string[] | null;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const protocols = options.protocol === null
      ? []
      : options.protocol ?? AGENT_WEBSOCKET_PROTOCOL;
    const socket = new WebSocket(
      `ws://127.0.0.1:5199${options.path ?? '/__gfx_agent_bridge_v1'}`,
      protocols as string | string[],
      {
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.cookie
          ? { headers: { Cookie: options.cookie } }
          : {}),
      },
    );
    socket.once('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      resolve(status);
    });
    socket.once('open', () => {
      socket.close();
      reject(new Error('WebSocket unexpectedly opened.'));
    });
    socket.once('error', () => {
      // unexpected-response supplies the useful status.
    });
  });
}

describe('authenticated loopback app host', () => {
  it('validates exact Host on health, static, error, and raw requests', async () => {
    const health = await httpCall({ path: '/healthz' });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      status: 'ok',
      version: COMPANION_VERSION,
      bridge: 'waiting-for-browser',
    });
    expect(health.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    for (const [name, value] of Object.entries(AGENT_SECURITY_HEADERS)) {
      expect(health.headers[name.toLowerCase()]).toBe(value);
    }

    expect((await httpCall({
      path: '/healthz',
      host: 'localhost:5199',
    })).status).toBe(421);
    expect((await httpCall({
      path: '/healthz',
      host: '*',
    })).status).toBe(421);
    const missingHost = await rawHttp(
      'GET /healthz HTTP/1.1\r\n'
      + 'Connection: close\r\n\r\n',
    );
    expect(missingHost).not.toContain(' 200 ');
    const duplicate = await rawHttp(
      'GET /healthz HTTP/1.1\r\n'
      + 'Host: 127.0.0.1:5199\r\n'
      + 'Host: attacker.invalid\r\n'
      + 'Connection: close\r\n\r\n',
    );
    expect(duplicate).not.toContain(' 200 ');
    const absolute = await rawHttp(
      'GET http://127.0.0.1:5199/healthz HTTP/1.1\r\n'
      + 'Host: 127.0.0.1:5199\r\n'
      + 'Connection: close\r\n\r\n',
    );
    expect(absolute).toContain(' 400 ');
    expect((await httpCall({
      path: '/healthz?query=forbidden',
    })).status).toBe(400);
  });

  it('requires the in-memory cookie and injects only a non-secret marker', async () => {
    expect((await httpCall({ path: '/' })).status).toBe(401);
    expect((await httpCall({
      path: '/',
      cookie: `${AGENT_COOKIE_NAME}=wrong`,
    })).status).toBe(401);
    const authorized = await httpCall({
      path: '/',
      cookie: `${AGENT_COOKIE_NAME}=${host!.bootstrapToken}`,
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toContain(
      '<meta name="gfx-agent-companion" content="local-v1">',
    );
    expect(authorized.body).toContain(
      `<meta name="${AGENT_COMPANION_CONTROL_META_NAME}" `
      + 'content="interactive-v1">',
    );
    expect(authorized.body).not.toContain(host!.bootstrapToken);

    const missing = await httpCall({
      path: '/missing',
      cookie: `${AGENT_COOKIE_NAME}=${host!.bootstrapToken}`,
    });
    expect(missing.status).toBe(404);
    expect(missing.headers['x-frame-options']).toBe('DENY');
  });

  it('injects trusted-local mode only into the cookie-protected app', async () => {
    await host!.close();
    bridge = new BridgeClient({
      requestedScopes: ['read', 'preview', 'edit', 'assets', 'model'],
    });
    host = new LocalAppHost({
      bridge,
      appDirectory: fixtureDirectory,
      controlMode: AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
    });
    await host.start();

    expect((await httpCall({ path: '/' })).status).toBe(401);
    const authorized = await httpCall({
      path: '/',
      cookie: `${AGENT_COOKIE_NAME}=${host.bootstrapToken}`,
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toContain(
      `<meta name="${AGENT_COMPANION_CONTROL_META_NAME}" `
      + 'content="trusted-local-v1">',
    );
    expect(authorized.body).not.toContain(host.bootstrapToken);
  });

  it('rejects packaged indexes that predeclare companion metadata', async () => {
    await host!.close();
    await writeFile(
      join(fixtureDirectory, 'index.html'),
      '<!doctype html><html><head>'
      + '<meta name="gfx-agent-companion" content="attacker-controlled">'
      + '</head><body>fixture</body></html>',
    );
    bridge = new BridgeClient({ requestedScopes: ['read', 'preview'] });
    host = new LocalAppHost({
      bridge,
      appDirectory: fixtureDirectory,
    });

    await expect(host.start()).rejects.toThrow(
      'cannot predeclare companion metadata',
    );
  });

  it('serves packaged JPEG assets with a nosniff-compatible MIME type', async () => {
    const cookie = `${AGENT_COOKIE_NAME}=${host!.bootstrapToken}`;
    for (const path of ['/factory-image.jpg', '/alternate.jpeg']) {
      const response = await httpCall({ path, cookie, method: 'HEAD' });
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.body).toBe('');
    }
  });

  it('rejects wrong Origin/token and a second WebSocket owner', async () => {
    const cookie = `${AGENT_COOKIE_NAME}=${host!.bootstrapToken}`;
    for (const response of await Promise.all([
      rawWebSocket([
        `Origin: ${AGENT_ALLOWED_ORIGIN}`,
        `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}`,
        `Cookie: ${cookie}`,
      ]),
      rawWebSocket([
        'Host: attacker.invalid',
        `Origin: ${AGENT_ALLOWED_ORIGIN}`,
        `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}`,
        `Cookie: ${cookie}`,
      ]),
      rawWebSocket([
        'Host: 127.0.0.1:5199',
        'Host: attacker.invalid',
        `Origin: ${AGENT_ALLOWED_ORIGIN}`,
        `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}`,
        `Cookie: ${cookie}`,
      ]),
      rawWebSocket([
        'Host: 127.0.0.1:5199',
        `Origin: ${AGENT_ALLOWED_ORIGIN}`,
        `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}, attacker`,
        `Cookie: ${cookie}`,
      ]),
      rawWebSocket([
        'Host: 127.0.0.1:5199',
        `Origin: ${AGENT_ALLOWED_ORIGIN}`,
        `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}`,
        'Sec-WebSocket-Protocol: attacker',
        `Cookie: ${cookie}`,
      ]),
    ])) {
      expect(response).not.toContain(' 101 ');
    }
    await expect(rejectedWebSocket({
      cookie,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: 'null',
      cookie,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: '*',
      cookie,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: 'http://localhost:5199',
      cookie,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: 'https://attacker.invalid',
      cookie,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie: `${AGENT_COOKIE_NAME}=wrong`,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie: `${cookie}; ${cookie}`,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie,
      path: '/__gfx_agent_bridge_v1?token=forbidden',
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie,
      path: '/wrong',
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie,
      protocol: null,
    })).resolves.toBe(403);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie,
      protocol: 'wrong.protocol',
    })).resolves.toBe(403);

    const duplicateOrigin = await rawHttp(
      'GET /__gfx_agent_bridge_v1 HTTP/1.1\r\n'
      + 'Host: 127.0.0.1:5199\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + 'Sec-WebSocket-Version: 13\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}\r\n`
      + `Cookie: ${cookie}\r\n`
      + `Origin: ${AGENT_ALLOWED_ORIGIN}\r\n`
      + 'Origin: https://attacker.invalid\r\n\r\n',
    );
    expect(duplicateOrigin).not.toContain(' 101 ');
    const duplicateCookieHeader = await rawHttp(
      'GET /__gfx_agent_bridge_v1 HTTP/1.1\r\n'
      + 'Host: 127.0.0.1:5199\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + 'Sec-WebSocket-Version: 13\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + `Sec-WebSocket-Protocol: ${AGENT_WEBSOCKET_PROTOCOL}\r\n`
      + `Cookie: ${cookie}\r\n`
      + `Cookie: ${cookie}\r\n`
      + `Origin: ${AGENT_ALLOWED_ORIGIN}\r\n\r\n`,
    );
    expect(duplicateCookieHeader).not.toContain(' 101 ');

    const owner = new WebSocket(
      'ws://127.0.0.1:5199/__gfx_agent_bridge_v1',
      AGENT_WEBSOCKET_PROTOCOL,
      {
        origin: AGENT_ALLOWED_ORIGIN,
        headers: { Cookie: cookie },
      },
    );
    const welcomePromise = new Promise<Record<string, unknown>>((resolve) => {
      owner.once('message', (data) => resolve(
        JSON.parse(data.toString()) as Record<string, unknown>,
      ));
    });
    await new Promise<void>((resolve, reject) => {
      owner.once('open', resolve);
      owner.once('error', reject);
    });
    const welcome = await welcomePromise;
    expect(welcome).toMatchObject({
      kind: 'welcome',
      protocolVersion: '1.0',
    });
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie,
    })).resolves.toBe(409);
    owner.close();
  });

  it('invalidates the old process cookie after restart', async () => {
    const oldToken = host!.bootstrapToken;
    await host!.close();
    bridge = new BridgeClient({ requestedScopes: ['read', 'preview'] });
    host = new LocalAppHost({ bridge, appDirectory: fixtureDirectory });
    await host.start();
    expect(host.bootstrapToken).not.toBe(oldToken);
    expect((await httpCall({
      path: '/',
      cookie: `${AGENT_COOKIE_NAME}=${oldToken}`,
    })).status).toBe(401);
    await expect(rejectedWebSocket({
      origin: AGENT_ALLOWED_ORIGIN,
      cookie: `${AGENT_COOKIE_NAME}=${oldToken}`,
    })).resolves.toBe(403);
  });
});
