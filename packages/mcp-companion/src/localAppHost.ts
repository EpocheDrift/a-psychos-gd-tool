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
import {
  MODEL_FILES_PATH_PREFIX,
  MODEL_PREPARE_PATH,
  MODEL_STATUS_PATH,
  type PublicModelStatus,
} from './modelManifest.js';
import {
  ModelManager,
  OneShotModelApprovalGate,
  type HumanModelApprovalRequest,
} from './modelManager.js';
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
const MODEL_PREPARATION_TIMEOUT_MS = 30 * 60_000;

interface StaticAsset {
  body: Buffer;
  contentType: string;
}

export interface LocalAppHostOptions {
  bridge: BridgeClient;
  appDirectory?: string;
  bootstrapToken?: string;
  modelManager?: ModelManager;
  modelApprovalGate?: OneShotModelApprovalGate;
}

const MAX_MODEL_PREPARE_BODY_BYTES = 2 * 1024;
const MODEL_PREPARE_CONTENT_TYPE = 'application/json';
const REQUEST_ID_PATTERN =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

class LocalHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'LocalHttpError';
  }
}

function writePlain(
  response: ServerResponse,
  status: number,
  message: string,
  extraHeaders: Readonly<Record<string, string | number>> = {},
): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  response.end(message);
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headOnly = false,
  extraHeaders: Readonly<Record<string, string | number>> = {},
): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.byteLength,
    ...extraHeaders,
  });
  response.end(headOnly ? undefined : body);
}

function waitForResponseDrain(
  response: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      response.off('drain', onDrain);
      response.off('close', onClose);
      response.off('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => finish();
    const onClose = () => finish(new Error('The model response closed.'));
    const onError = () => finish(new Error('The model response failed.'));
    const onAbort = () => finish(new Error('The model response was aborted.'));
    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function parseHumanModelApproval(
  value: unknown,
): HumanModelApprovalRequest {
  if (!isPlainRecord(value)) {
    throw new LocalHttpError(400, 'Bad Request');
  }
  const keys = Object.keys(value).sort();
  const expected = [
    'approved',
    'kind',
    'licenseId',
    'manifestSha256',
    'modelKey',
    'requestId',
    'schemaVersion',
  ];
  if (
    keys.length !== expected.length
    || !keys.every((key, index) => key === expected[index])
    || value.schemaVersion !== 1
    || value.kind !== 'model-download-approval'
    || typeof value.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(value.requestId)
    || value.approved !== true
    || value.modelKey !== 'rmbg-1.4'
    || typeof value.manifestSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.manifestSha256)
    || value.licenseId !== 'bria-rmbg-1.4'
  ) {
    throw new LocalHttpError(400, 'Bad Request');
  }
  return value as unknown as HumanModelApprovalRequest;
}

async function readModelPrepareBody(
  request: IncomingMessage,
): Promise<HumanModelApprovalRequest> {
  const contentTypes = headerValues(request, 'content-type');
  if (
    contentTypes.length !== 1
    || contentTypes[0] !== MODEL_PREPARE_CONTENT_TYPE
    || headerValues(request, 'content-encoding').length !== 0
  ) {
    throw new LocalHttpError(415, 'Unsupported Media Type');
  }
  const transferEncodings = headerValues(request, 'transfer-encoding');
  const contentLengths = headerValues(request, 'content-length');
  if (
    transferEncodings.length > 1
    || contentLengths.length > 1
    || (transferEncodings.length === 1 && contentLengths.length === 1)
  ) {
    throw new LocalHttpError(400, 'Bad Request');
  }
  let declaredLength: number | undefined;
  if (contentLengths.length === 1) {
    const raw = contentLengths[0]!;
    if (!/^(?:0|[1-9][0-9]{0,5})$/.test(raw)) {
      throw new LocalHttpError(400, 'Bad Request');
    }
    declaredLength = Number(raw);
    if (declaredLength > MAX_MODEL_PREPARE_BODY_BYTES) {
      throw new LocalHttpError(413, 'Payload Too Large');
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string'
      ? Buffer.from(chunk)
      : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_MODEL_PREPARE_BODY_BYTES) {
      throw new LocalHttpError(413, 'Payload Too Large');
    }
    chunks.push(bytes);
  }
  if (
    total < 2
    || (declaredLength !== undefined && declaredLength !== total)
  ) {
    throw new LocalHttpError(400, 'Bad Request');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, total),
      ),
    );
  } catch {
    throw new LocalHttpError(400, 'Bad Request');
  }
  return parseHumanModelApproval(parsed);
}

function parseSingleByteRange(
  request: IncomingMessage,
  byteLength: number,
): {
  readonly start: number;
  readonly endExclusive: number;
} | undefined {
  const values = headerValues(request, 'range');
  if (values.length === 0) return undefined;
  if (values.length !== 1 || values[0]!.length > 128) {
    throw new LocalHttpError(416, 'Range Not Satisfiable');
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(values[0]!);
  if (!match || (match[1] === '' && match[2] === '')) {
    throw new LocalHttpError(416, 'Range Not Satisfiable');
  }
  let start: number;
  let endExclusive: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) {
      throw new LocalHttpError(416, 'Range Not Satisfiable');
    }
    start = Math.max(0, byteLength - suffix);
    endExclusive = byteLength;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= byteLength) {
      throw new LocalHttpError(416, 'Range Not Satisfiable');
    }
    if (match[2] === '') {
      endExclusive = byteLength;
    } else {
      const inclusiveEnd = Number(match[2]);
      if (
        !Number.isSafeInteger(inclusiveEnd)
        || inclusiveEnd < start
      ) {
        throw new LocalHttpError(416, 'Range Not Satisfiable');
      }
      endExclusive = Math.min(byteLength, inclusiveEnd + 1);
    }
  }
  return { start, endExclusive };
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
  private readonly modelManager?: ModelManager;
  private readonly modelApprovalGate?: OneShotModelApprovalGate;
  private readonly modelPreparationAbort = new AbortController();
  private readonly httpServer;
  private readonly webSocketServer: WebSocketServer;
  private assets = new Map<string, StaticAsset>();
  private modelPreparationPromise: Promise<void> | null = null;
  private modelPrepareStarting = false;
  private started = false;

  constructor(options: LocalAppHostOptions) {
    this.bridge = options.bridge;
    this.appDirectory = options.appDirectory ?? defaultAppDirectory();
    if (
      Boolean(options.modelManager)
      !== Boolean(options.modelApprovalGate)
    ) {
      throw new Error(
        'The model manager and human approval gate must be configured together.',
      );
    }
    this.modelManager = options.modelManager;
    this.modelApprovalGate = options.modelApprovalGate;
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
      void this.handleRequest(request, response).catch((error: unknown) => {
        request.resume();
        if (error instanceof LocalHttpError) {
          writePlain(response, error.status, error.message);
          return;
        }
        writePlain(response, 500, 'Internal Server Error');
      });
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
    this.modelApprovalGate?.clear();
    this.modelPreparationAbort.abort();
    this.bridge.close('host shutdown');
    this.webSocketServer.close();
    if (this.httpServer.listening) {
      await new Promise<void>((resolveClose) => {
        this.httpServer.close(() => resolveClose());
        this.httpServer.closeAllConnections();
      });
    }
    await this.modelPreparationPromise?.catch(() => undefined);
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
    if (
      url.origin !== AGENT_ALLOWED_ORIGIN
      || url.search
      || url.hash
      || url.pathname !== requestTarget
    ) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    if (url.pathname === AGENT_HEALTH_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writePlain(response, 405, 'Method Not Allowed', {
          Allow: 'GET, HEAD',
        });
        return;
      }
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
      writePlain(response, 401, 'Unauthorized');
      return;
    }
    if (url.pathname === MODEL_STATUS_PATH) {
      await this.handleModelStatus(request, response);
      return;
    }
    if (url.pathname === MODEL_PREPARE_PATH) {
      await this.handleModelPrepare(request, response);
      return;
    }
    if (url.pathname.startsWith(MODEL_FILES_PATH_PREFIX)) {
      await this.handleModelArtifact(request, response, url.pathname);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writePlain(response, 405, 'Method Not Allowed', {
        Allow: 'GET, HEAD',
      });
      return;
    }
    const route = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = this.assets.get(route);
    if (!asset) {
      writePlain(response, 404, 'Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Content-Length': asset.body.byteLength,
    });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  }

  private async handleModelStatus(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.modelManager) {
      writePlain(response, 404, 'Not Found');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writePlain(response, 405, 'Method Not Allowed', {
        Allow: 'GET, HEAD',
      });
      return;
    }
    let status: PublicModelStatus;
    try {
      status = await this.modelManager.status();
    } catch {
      writePlain(response, 503, 'Model Unavailable');
      return;
    }
    writeJson(response, 200, status, request.method === 'HEAD');
  }

  private async handleModelPrepare(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.modelManager || !this.modelApprovalGate) {
      writePlain(response, 404, 'Not Found');
      return;
    }
    if (request.method !== 'POST') {
      writePlain(response, 405, 'Method Not Allowed', { Allow: 'POST' });
      return;
    }
    if (!hasExactOrigin(request)) {
      writePlain(response, 403, 'Forbidden');
      return;
    }
    const approval = await readModelPrepareBody(request);
    if (
      approval.manifestSha256
      !== this.modelManager.manifestSha256
    ) {
      writePlain(response, 409, 'Model Manifest Mismatch');
      return;
    }
    if (
      this.modelPrepareStarting
      || this.modelManager.isPreparing()
    ) {
      writeJson(response, 202, await this.modelManager.status());
      return;
    }

    this.modelPrepareStarting = true;
    try {
      const current = await this.modelManager.status();
      if (current.state === 'ready') {
        writeJson(response, 202, current);
        return;
      }
      if (this.modelManager.isPreparing()) {
        writeJson(response, 202, await this.modelManager.status());
        return;
      }
      this.modelApprovalGate.arm(approval);
      const preparationAbort = new AbortController();
      const relayHostAbort = () => preparationAbort.abort(
        this.modelPreparationAbort.signal.reason,
      );
      this.modelPreparationAbort.signal.addEventListener(
        'abort',
        relayHostAbort,
        { once: true },
      );
      if (this.modelPreparationAbort.signal.aborted) relayHostAbort();
      const preparationTimer = setTimeout(() => {
        preparationAbort.abort(new Error(
          'The model preparation exceeded its total deadline.',
        ));
      }, MODEL_PREPARATION_TIMEOUT_MS);
      preparationTimer.unref?.();
      const preparation = this.modelManager.prepare(
        { requestId: approval.requestId },
        preparationAbort.signal,
      );
      const tracked = preparation.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        clearTimeout(preparationTimer);
        this.modelPreparationAbort.signal.removeEventListener(
          'abort',
          relayHostAbort,
        );
        if (this.modelPreparationPromise === tracked) {
          this.modelPreparationPromise = null;
        }
      });
      this.modelPreparationPromise = tracked;
      writeJson(response, 202, await this.modelManager.status());
    } catch {
      this.modelApprovalGate.clear();
      writePlain(response, 409, 'Model Preparation Rejected');
    } finally {
      this.modelPrepareStarting = false;
    }
  }

  private async handleModelArtifact(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (!this.modelManager) {
      writePlain(response, 404, 'Not Found');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writePlain(response, 405, 'Method Not Allowed', {
        Allow: 'GET, HEAD',
      });
      return;
    }
    const artifactId =
      this.modelManager.artifactIdFromLocalPath(pathname);
    if (!artifactId) {
      writePlain(response, 404, 'Not Found');
      return;
    }

    const requestAbort = new AbortController();
    const abort = () => requestAbort.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    let opened:
      Awaited<ReturnType<ModelManager['openVerifiedArtifact']>>
      | undefined;
    try {
      const artifactByteLength =
        this.modelManager.artifactByteLength(artifactId);
      let range;
      try {
        range = parseSingleByteRange(request, artifactByteLength);
      } catch (error) {
        if (error instanceof LocalHttpError && error.status === 416) {
          writePlain(response, 416, error.message, {
            'Content-Range': `bytes */${artifactByteLength}`,
          });
          return;
        }
        throw error;
      }
      opened = await this.modelManager.openVerifiedArtifact(
        artifactId,
        {
          ...(range ? { range } : {}),
          signal: requestAbort.signal,
        },
      );
      const bodyLength =
        opened.range.endExclusive - opened.range.start;
      const partial =
        opened.range.start !== 0
        || opened.range.endExclusive !== opened.byteLength;
      response.writeHead(partial ? 206 : 200, {
        'Content-Type': opened.mediaType,
        'Content-Length': bodyLength,
        'Accept-Ranges': 'bytes',
        ...(partial
          ? {
              'Content-Range':
                `bytes ${opened.range.start}-`
                + `${opened.range.endExclusive - 1}/`
                + `${opened.byteLength}`,
            }
          : {}),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      for await (const chunk of opened.body) {
        if (!response.write(chunk)) {
          await waitForResponseDrain(response, requestAbort.signal);
        }
      }
      response.end();
    } catch {
      if (!response.headersSent) {
        writePlain(response, 409, 'Model Artifact Unavailable');
      } else {
        response.destroy();
      }
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
      await opened?.close().catch(() => undefined);
    }
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
