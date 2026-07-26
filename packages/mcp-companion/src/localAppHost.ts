import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COMPANION_META_NAME,
  AGENT_COMPANION_META_VALUE,
  AGENT_COOKIE_NAME,
  AGENT_EXPECTED_HOST,
  AGENT_HEALTH_PATH,
  AGENT_HOST,
  AGENT_PORT,
  AGENT_SECURITY_HEADERS,
  AGENT_WEBSOCKET_PATH,
  AGENT_WEBSOCKET_PROTOCOL,
} from './agentSecurity.js';
import type { BridgeClient } from './bridgeClient.js';
import { COMPANION_TRANSPORT_LIMITS } from './protocol.js';

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
});

interface StaticAsset {
  body: Buffer;
  contentType: string;
}

export interface LocalAppHostOptions {
  bridge: BridgeClient;
  appDirectory?: string;
  bootstrapToken?: string;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function defaultAppDirectory(): string {
  return fileURLToPath(new URL('./app/', import.meta.url));
}

function headerValues(
  request: IncomingMessage,
  name: string,
): readonly string[] {
  const output: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      output.push(request.rawHeaders[index + 1] ?? '');
    }
  }
  return output;
}

export function hasExactHost(request: IncomingMessage): boolean {
  const values = headerValues(request, 'host');
  return values.length === 1 && values[0] === AGENT_EXPECTED_HOST;
}

export function hasExactOrigin(request: IncomingMessage): boolean {
  const values = headerValues(request, 'origin');
  return values.length === 1 && values[0] === AGENT_ALLOWED_ORIGIN;
}

function hasExactSubprotocol(request: IncomingMessage): boolean {
  const values = headerValues(request, 'sec-websocket-protocol');
  return values.length === 1 && values[0] === AGENT_WEBSOCKET_PROTOCOL;
}

function isLoopbackPeer(request: IncomingMessage): boolean {
  return request.socket.remoteAddress === AGENT_HOST;
}

function cookieValues(request: IncomingMessage, name: string): string[] {
  const headers = headerValues(request, 'cookie');
  const values: string[] = [];
  for (const header of headers) {
    for (const pair of header.split(';')) {
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      if (pair.slice(0, separator).trim() === name) {
        values.push(pair.slice(separator + 1).trim());
      }
    }
  }
  return values;
}

function sameToken(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  const safeReason = reason.replace(/[\r\n]/g, ' ').slice(0, 80);
  socket.write(
    `HTTP/1.1 ${status} ${safeReason}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Length: 0\r\n'
    + 'Cache-Control: no-store\r\n'
    + '\r\n',
  );
  socket.destroy();
}

function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(AGENT_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

async function loadStaticAssets(
  directory: string,
): Promise<Map<string, StaticAsset>> {
  const root = resolve(directory);
  const assets = new Map<string, StaticAsset>();
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      const fromRoot = relative(root, absolute);
      if (
        fromRoot.startsWith(`..${sep}`)
        || fromRoot === '..'
        || resolve(root, fromRoot) !== absolute
      ) {
        throw new Error('The packaged Agent artifact escaped its fixed root.');
      }
      if (entry.isSymbolicLink()) {
        throw new Error('The packaged Agent artifact cannot contain symlinks.');
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const route = `/${fromRoot.split(sep).join('/')}`;
      if (route.split('/').some((segment) => segment.startsWith('.'))) {
        throw new Error('The packaged Agent artifact cannot contain dotfiles.');
      }
      let body = await readFile(absolute);
      if (route === '/index.html') {
        const html = body.toString('utf8');
        const marker =
          `<meta name="${AGENT_COMPANION_META_NAME}" `
          + `content="${AGENT_COMPANION_META_VALUE}">`;
        if (!html.includes('</head>')) {
          throw new Error('The packaged Agent index is missing </head>.');
        }
        body = Buffer.from(html.replace('</head>', `${marker}</head>`));
      }
      assets.set(route, {
        body,
        contentType:
          MIME_TYPES[extname(route).toLowerCase()]
          ?? 'application/octet-stream',
      });
    }
  };
  await visit(root);
  if (!assets.has('/index.html')) {
    throw new Error('The packaged Agent artifact has no index.html.');
  }
  return assets;
}

export class LocalAppHost {
  readonly bootstrapToken: string;
  private readonly bridge: BridgeClient;
  private readonly appDirectory: string;
  private readonly httpServer;
  private readonly webSocketServer: WebSocketServer;
  private assets = new Map<string, StaticAsset>();
  private started = false;

  constructor(options: LocalAppHostOptions) {
    this.bridge = options.bridge;
    this.appDirectory = options.appDirectory ?? defaultAppDirectory();
    this.bootstrapToken =
      options.bootstrapToken ?? base64Url(randomBytes(32));
    if (!/^[A-Za-z0-9_-]{43}$/.test(this.bootstrapToken)) {
      throw new Error('The companion bootstrap token must contain 256 bits.');
    }
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      perMessageDeflate: false,
      maxPayload: COMPANION_TRANSPORT_LIMITS.maxBinaryMessageBytes,
    });
    this.httpServer = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.httpServer.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('The local app host is already started.');
    this.assets = await loadStaticAssets(this.appDirectory);
    await new Promise<void>((resolveStart, rejectStart) => {
      const onError = (error: Error) => {
        this.httpServer.off('listening', onListening);
        rejectStart(error);
      };
      const onListening = () => {
        this.httpServer.off('error', onError);
        resolveStart();
      };
      this.httpServer.once('error', onError);
      this.httpServer.once('listening', onListening);
      this.httpServer.listen(AGENT_PORT, AGENT_HOST);
    });
    const address = this.httpServer.address();
    if (
      !address
      || typeof address === 'string'
      || address.address !== AGENT_HOST
      || address.port !== AGENT_PORT
    ) {
      await this.close();
      throw new Error('The companion did not bind the exact documented origin.');
    }
    this.started = true;
  }

  async close(): Promise<void> {
    this.started = false;
    this.bridge.close('host shutdown');
    this.webSocketServer.close();
    if (!this.httpServer.listening) return;
    await new Promise<void>((resolveClose) => {
      this.httpServer.close(() => resolveClose());
      this.httpServer.closeAllConnections();
    });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    setSecurityHeaders(response);
    if (!isLoopbackPeer(request) || !hasExactHost(request)) {
      response.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Misdirected Request');
      return;
    }
    const requestTarget = request.url ?? '';
    if (
      requestTarget.length === 0
      || requestTarget.includes('://')
      || requestTarget.includes('\\')
      || requestTarget.includes('\0')
    ) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    let url: URL;
    try {
      url = new URL(requestTarget, AGENT_ALLOWED_ORIGIN);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    if (url.origin !== AGENT_ALLOWED_ORIGIN || url.search || url.hash) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Method Not Allowed');
      return;
    }
    if (url.pathname === AGENT_HEALTH_PATH) {
      const body = Buffer.from(JSON.stringify({
        status: 'ok',
        version: '0.0.1',
        bridge: this.bridge.healthState(),
      }));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.byteLength,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    if (!this.hasValidCookie(request)) {
      response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unauthorized');
      return;
    }
    const route = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = this.assets.get(route);
    if (!asset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Content-Length': asset.body.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    if (
      !isLoopbackPeer(request)
      || !hasExactHost(request)
      || !hasExactOrigin(request)
      || !hasExactSubprotocol(request)
      || request.url !== AGENT_WEBSOCKET_PATH
      || !this.hasValidCookie(request)
    ) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    if (this.bridge.hasOwner()) {
      rejectUpgrade(socket, 409, 'Owner Already Connected');
      return;
    }
    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.bridge.attach(webSocket);
    });
  }

  private hasValidCookie(request: IncomingMessage): boolean {
    if (headerValues(request, 'cookie').length !== 1) return false;
    const values = cookieValues(request, AGENT_COOKIE_NAME);
    return values.length === 1
      && sameToken(values[0]!, this.bootstrapToken);
  }
}
