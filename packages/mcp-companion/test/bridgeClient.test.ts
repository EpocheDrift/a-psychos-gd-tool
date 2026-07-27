import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { BridgeClient } from '../src/bridgeClient.js';
import { COMPANION_TRANSPORT_LIMITS } from '../src/protocol.js';

interface Harness {
  bridge: BridgeClient;
  socket: WebSocket;
  server: WebSocketServer;
  nextJson(): Promise<Record<string, unknown>>;
  sendJson(value: unknown): void;
  close(): Promise<void>;
}

async function createHarness(options: {
  helloDeadlineMs?: number;
  now?: () => number;
  requestedScopes?: readonly (
    'read' | 'preview' | 'edit' | 'assets' | 'model'
  )[];
} = {}): Promise<Harness> {
  const bridge = new BridgeClient({
    requestedScopes:
      options.requestedScopes ?? ['read', 'preview', 'edit'],
    ...(options.helloDeadlineMs === undefined
      ? {}
      : { helloDeadlineMs: options.helloDeadlineMs }),
    ...(options.now ? { now: options.now } : {}),
  });
  const server = new WebSocketServer({
    port: 0,
    perMessageDeflate: false,
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) => bridge.attach(socket));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('Missing WebSocket test address.');
  }
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const queued: RawData[] = [];
  const waiters: Array<(data: RawData) => void> = [];
  socket.on('message', (data) => {
    const waiter = waiters.shift();
    if (waiter) waiter(data);
    else queued.push(data);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const nextRaw = () => new Promise<RawData>((resolve) => {
    const data = queued.shift();
    if (data) resolve(data);
    else waiters.push(resolve);
  });
  return {
    bridge,
    socket,
    server,
    nextJson: async () =>
      JSON.parse((await nextRaw()).toString()) as Record<string, unknown>,
    sendJson: (value) => socket.send(JSON.stringify(value)),
    close: async () => {
      bridge.close('test shutdown');
      socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.close();
});

async function pair(
  harness: Harness,
  expectedScopes?: readonly string[],
) {
  harnesses.push(harness);
  const welcome = await harness.nextJson();
  const connectionId = String(welcome.connectionId);
  const serverNonce = String(welcome.serverNonce);
  const channelToken = 'c'.repeat(43);
  harness.sendJson({
    kind: 'hello',
    protocolVersion: '1.0',
    connectionId,
    serverNonce,
    channelToken,
    sequence: 1,
  });
  const pairRequest = await harness.nextJson();
  const input = pairRequest.input as Record<string, unknown>;
  if (expectedScopes) {
    expect(input.requestedScopes).toEqual(expectedScopes);
  }
  const clientNonce = String(input.clientNonce);
  const fingerprint = createHash('sha256')
    .update(`gfx.agent.client.v1\u0000${clientNonce}`)
    .digest('hex')
    .slice(0, 12);
  const connectedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(connectedAt) + 30 * 60_000,
  ).toISOString();
  harness.sendJson({
    kind: 'response',
    protocolVersion: '1.0',
    connectionId,
    channelToken,
    sequence: 2,
    requestId: pairRequest.requestId,
    ok: true,
    value: {
      protocolVersion: '1.0',
      clientLabel: input.clientLabel,
      clientFingerprint: fingerprint,
      sessionFingerprint: 'd'.repeat(12),
      origin: 'http://127.0.0.1:5199',
      scopes: input.requestedScopes,
      connectedAt,
      expiresAt,
    },
  });
  await expect.poll(() => harness.bridge.healthState()).toBe('ready');
  return { connectionId, channelToken };
}

async function resolveJsonCall(
  harness: Harness,
  auth: { connectionId: string; channelToken: string },
  nextIncomingSequence: { value: number },
  operation: Parameters<BridgeClient['call']>[0],
  input: unknown,
): Promise<void> {
  const pending = harness.bridge.call(operation, input);
  const request = await harness.nextJson();
  expect(request).toMatchObject({ kind: 'request', operation });
  harness.sendJson({
    kind: 'response',
    protocolVersion: '1.0',
    ...auth,
    sequence: nextIncomingSequence.value++,
    requestId: request.requestId,
    ok: true,
    value: {},
  });
  await expect(pending).resolves.toEqual({});
}

function previewFrame(options: {
  connectionId: string;
  channelToken: string;
  sequence: number;
  requestId: string;
  bytes?: Buffer;
  headerPatch?: Record<string, unknown>;
  rawHeader?: Buffer;
}): Buffer {
  const bytes = options.bytes ?? Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('bounded-preview'),
  ]);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const header = options.rawHeader ?? Buffer.from(JSON.stringify({
    kind: 'binary-response',
    protocolVersion: '1.0',
    connectionId: options.connectionId,
    channelToken: options.channelToken,
    sequence: options.sequence,
    requestId: options.requestId,
    ok: true,
    value: {
      revision: 0,
      image: {
        kind: 'mcp-image-content-v1',
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        contentHash,
        trust: 'untrusted-document-render',
      },
    },
    mimeType: 'image/png',
    byteLength: bytes.byteLength,
    contentHash,
    ...options.headerPatch,
  }));
  const frame = Buffer.alloc(4 + header.byteLength + bytes.byteLength);
  frame.writeUInt32BE(header.byteLength, 0);
  header.copy(frame, 4);
  bytes.copy(frame, 4 + header.byteLength);
  return frame;
}

describe('authenticated bridge client protocol', () => {
  it('terminates a silent pre-hello owner and clears the owner slot', async () => {
    const harness = await createHarness({ helloDeadlineMs: 25 });
    harnesses.push(harness);
    await expect(harness.nextJson()).resolves.toMatchObject({
      kind: 'welcome',
    });
    expect(harness.bridge.healthState()).toBe('waiting-for-human');
    expect(harness.bridge.hasOwner()).toBe(true);

    await expect.poll(
      () => harness.bridge.healthState(),
      { timeout: 1_000 },
    ).toBe('failed');
    expect(harness.bridge.hasOwner()).toBe(false);
  });

  it('clears the pre-hello timer after a valid hello', async () => {
    const harness = await createHarness({ helloDeadlineMs: 100 });
    await pair(harness);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(harness.bridge.healthState()).toBe('ready');
    expect(harness.bridge.hasOwner()).toBe(true);
  });

  it('requests assets without implicitly requesting edit authority', async () => {
    const harness = await createHarness({
      requestedScopes: ['read', 'preview', 'assets'],
    });
    await pair(harness, ['read', 'preview', 'assets']);
    expect(harness.bridge.healthState()).toBe('ready');
  });

  it('closes and revokes transport authority when pairing validation fails', async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const welcome = await harness.nextJson();
    const connectionId = String(welcome.connectionId);
    const serverNonce = String(welcome.serverNonce);
    const channelToken = 'c'.repeat(43);
    harness.sendJson({
      kind: 'hello',
      protocolVersion: '1.0',
      connectionId,
      serverNonce,
      channelToken,
      sequence: 1,
    });
    const pairRequest = await harness.nextJson();
    harness.sendJson({
      kind: 'response',
      protocolVersion: '1.0',
      connectionId,
      channelToken,
      sequence: 2,
      requestId: pairRequest.requestId,
      ok: true,
      value: {
        protocolVersion: '1.0',
        clientLabel: 'unexpected client',
      },
    });

    await expect.poll(() => harness.bridge.healthState()).toBe('failed');
    await expect.poll(() => harness.bridge.hasOwner()).toBe(false);

    const address = harness.server.address();
    if (typeof address === 'string' || address === null) {
      throw new Error('Missing WebSocket test address.');
    }
    const replacement = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise<void>((resolve) => replacement.once('close', resolve));
    expect(harness.bridge.healthState()).toBe('failed');
    expect(harness.bridge.hasOwner()).toBe(false);
  });

  it('correlates strict sequenced JSON and verified binary preview responses', async () => {
    const harness = await createHarness();
    const auth = await pair(harness);

    const documentPromise = harness.bridge.call('getDocument', {});
    const documentRequest = await harness.nextJson();
    expect(documentRequest).toMatchObject({
      kind: 'request',
      sequence: 2,
      operation: 'getDocument',
    });
    harness.sendJson({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 3,
      requestId: documentRequest.requestId,
      ok: true,
      value: { revision: 0, trust: 'untrusted-document-content' },
    });
    await expect(documentPromise).resolves.toEqual({
      revision: 0,
      trust: 'untrusted-document-content',
    });

    const previewPromise = harness.bridge.call('capturePreview', {
      revision: 0,
    });
    const previewRequest = await harness.nextJson();
    expect(previewRequest).toMatchObject({
      sequence: 3,
      operation: 'capturePreview',
    });
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('bounded-preview'),
    ]);
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    harness.socket.send(previewFrame({
      ...auth,
      sequence: 4,
      requestId: String(previewRequest.requestId),
      bytes,
    }));
    await expect(previewPromise).resolves.toMatchObject({
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      contentHash,
    });
  });

  it('fails closed on a skipped browser sequence', async () => {
    const harness = await createHarness();
    const auth = await pair(harness);
    const call = harness.bridge.call('getDocument', {});
    const request = await harness.nextJson();
    harness.sendJson({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 4,
      requestId: request.requestId,
      ok: true,
      value: {},
    });
    await expect(call).rejects.toThrow('no longer available');
    expect(harness.bridge.healthState()).toBe('failed');
  });

  it('returns a structured preview fault without closing the session', async () => {
    const harness = await createHarness();
    const auth = await pair(harness);
    const call = harness.bridge.call('capturePreview', { revision: 99 });
    const request = await harness.nextJson();
    harness.sendJson({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 3,
      requestId: request.requestId,
      ok: false,
      fault: {
        name: 'AgentControllerFault',
        ok: false,
        revision: 4,
        error: {
          code: 'REVISION_CONFLICT',
          message: 'The preview revision is stale.',
          recoverable: true,
        },
      },
    });
    await expect(call).rejects.toMatchObject({
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(harness.bridge.healthState()).toBe('ready');
    expect(harness.bridge.hasOwner()).toBe(true);
  });

  it('keeps request and revision context on local transport faults', async () => {
    const harness = await createHarness();
    await pair(harness);
    const aborter = new AbortController();
    aborter.abort();

    await expect(harness.bridge.call('applyTransaction', {
      requestId: 'contextual_write',
      expectedRevision: 5,
      commands: [],
    }, aborter.signal)).rejects.toMatchObject({
      publicFault: {
        revision: 5,
        requestId: 'contextual_write',
        error: { code: 'TIMEOUT' },
      },
    });
    expect(harness.bridge.healthState()).toBe('ready');

    await expect(harness.bridge.call('applyTransaction', {
      requestId: 'oversized_contextual_write',
      expectedRevision: 7,
      commands: [{
        op: 'add_node',
        params: {
          payload: 'x'.repeat(
            COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes,
          ),
        },
      }],
    })).rejects.toMatchObject({
      publicFault: {
        revision: 7,
        requestId: 'oversized_contextual_write',
        error: { code: 'RESOURCE_LIMIT' },
      },
    });
    expect(harness.bridge.healthState()).toBe('ready');
  });

  it('keeps the bounded asset-upload burst independent from ordinary calls', async () => {
    let now = 0;
    const harness = await createHarness({
      now: () => now,
      requestedScopes: ['read', 'preview', 'assets'],
    });
    const auth = await pair(harness);
    const sequence = { value: 3 };

    for (
      let index = 0;
      index < COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst;
      index++
    ) {
      await resolveJsonCall(
        harness,
        auth,
        sequence,
        'putAsset',
        { phase: 'status', uploadId: `upload_${index}` },
      );
    }
    await expect(
      harness.bridge.call('putAsset', {
        phase: 'status',
        uploadId: 'upload_exhausted',
      }),
    ).rejects.toThrow('asset-upload request-rate budget');

    for (
      let index = 0;
      index < COMPANION_TRANSPORT_LIMITS.requestBurst;
      index++
    ) {
      await resolveJsonCall(
        harness,
        auth,
        sequence,
        'getDocument',
        {},
      );
    }
    await expect(
      harness.bridge.call('getDocument', {}),
    ).rejects.toThrow('request-rate budget');

    now += 60_000 / COMPANION_TRANSPORT_LIMITS.requestsPerMinute;
    await resolveJsonCall(
      harness,
      auth,
      sequence,
      'getDocument',
      {},
    );
    await resolveJsonCall(
      harness,
      auth,
      sequence,
      'putAsset',
      { phase: 'status', uploadId: 'upload_refilled' },
    );
  });

  it('serializes asset and graph writes through one reservation', async () => {
    const harness = await createHarness({
      requestedScopes: ['read', 'preview', 'edit', 'assets'],
    });
    const auth = await pair(harness);
    const pending = harness.bridge.call('putAsset', {
      phase: 'status',
      uploadId: 'upload_active',
    });
    const request = await harness.nextJson();
    await expect(harness.bridge.call('applyTransaction', {
      requestId: 'overlapping_write',
      expectedRevision: 0,
      commands: [],
    })).rejects.toThrow('Only one Agent write');
    harness.sendJson({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 3,
      requestId: request.requestId,
      ok: true,
      value: {},
    });
    await expect(pending).resolves.toEqual({});
  });

  it('retains cancelled render reservations until the browser settles', async () => {
    const harness = await createHarness();
    const auth = await pair(harness);
    const aborter = new AbortController();
    const calls: Array<Promise<unknown>> = [];
    calls.push(harness.bridge.call(
      'awaitRender',
      { revision: 1 },
      aborter.signal,
    ));
    const requests = [await harness.nextJson()];
    aborter.abort();
    await expect(harness.nextJson()).resolves.toMatchObject({
      kind: 'cancel',
      requestId: requests[0]!.requestId,
    });
    for (let index = 0; index < 3; index++) {
      calls.push(harness.bridge.call('awaitRender', { revision: 1 }));
      requests.push(await harness.nextJson());
    }
    await expect(
      harness.bridge.call('awaitRender', { revision: 1 }),
    ).rejects.toThrow('render-wait budget');
    for (let index = 0; index < requests.length; index++) {
      harness.sendJson({
        kind: 'response',
        protocolVersion: '1.0',
        ...auth,
        sequence: 3 + index,
        requestId: requests[index]!.requestId,
        ok: true,
        value: { state: 'complete' },
      });
    }
    await expect(calls[0]).rejects.toMatchObject({
      publicFault: {
        revision: 1,
        error: {
          code: 'TIMEOUT',
          message: expect.stringContaining('cancelled'),
        },
      },
    });
    await expect(Promise.all(calls.slice(1))).resolves.toEqual([
      { state: 'complete' },
      { state: 'complete' },
      { state: 'complete' },
    ]);
    expect(harness.bridge.healthState()).toBe('ready');
  });

  it.each([
    ['wrong channel token', (auth: {
      connectionId: string;
      channelToken: string;
    }, request: Record<string, unknown>) => ({
      kind: 'response',
      protocolVersion: '1.0',
      connectionId: auth.connectionId,
      channelToken: 'x'.repeat(43),
      sequence: 3,
      requestId: request.requestId,
      ok: true,
      value: {},
    })],
    ['unknown request id', (auth: {
      connectionId: string;
      channelToken: string;
    }) => ({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 3,
      requestId: 'x'.repeat(22),
      ok: true,
      value: {},
    })],
    ['malformed remote fault', (auth: {
      connectionId: string;
      channelToken: string;
    }, request: Record<string, unknown>) => ({
      kind: 'response',
      protocolVersion: '1.0',
      ...auth,
      sequence: 3,
      requestId: request.requestId,
      ok: false,
      fault: {
        name: 'AgentControllerFault',
        ok: false,
        revision: 0,
        error: {
          code: 'INTERNAL',
          message: 'Malformed remote fault.',
          recoverable: false,
          path: 7,
        },
      },
    })],
  ])('fails closed on %s', async (_label, response) => {
    const harness = await createHarness();
    const auth = await pair(harness);
    const call = harness.bridge.call('getDocument', {});
    const request = await harness.nextJson();
    harness.sendJson(response(auth, request));
    await expect(call).rejects.toThrow('no longer available');
    expect(harness.bridge.healthState()).toBe('failed');
    expect(harness.bridge.hasOwner()).toBe(false);
  });

  it.each([
    ['hash mismatch', {
      contentHash: '0'.repeat(64),
    }],
    ['declared byte mismatch', {
      byteLength: 1,
    }],
    ['MIME/magic mismatch', {
      mimeType: 'image/webp',
    }],
    ['unknown header field', {
      unexpected: true,
    }],
  ])('fails closed on preview binary %s', async (_label, headerPatch) => {
    const harness = await createHarness();
    const auth = await pair(harness);
    const call = harness.bridge.call('capturePreview', { revision: 0 });
    const request = await harness.nextJson();
    harness.socket.send(previewFrame({
      ...auth,
      sequence: 3,
      requestId: String(request.requestId),
      headerPatch,
    }));
    await expect(call).rejects.toThrow('no longer available');
    expect(harness.bridge.healthState()).toBe('failed');
    expect(harness.bridge.hasOwner()).toBe(false);
  });
});
