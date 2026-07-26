import { describe, expect, it } from 'vitest';
import type { Doc } from '../engine/graph';
import type {
  RuntimeDocumentState,
  TransactionRequest,
  TransactionResult,
} from './commandTypes';
import {
  applyDocumentTransaction,
  applyNormalizedDocumentTransaction,
  normalizeTransactionRequest,
} from './commands';
import {
  boundedCanonicalJsonByteLength,
  type JsonValue,
} from './json';
import { DEFAULT_AGENT_LIMITS } from './limits';
import {
  TransactionSession,
  type SessionApplication,
} from './transactionSession';

function documentWithOutput(): Doc {
  return {
    frame: { width: 320, height: 240 },
    layers: [{
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true },
            position: { x: 800, y: 0 },
          },
        },
        edges: [],
      },
    }],
  };
}

function runtime(revision = 0): RuntimeDocumentState {
  return {
    documentId: 'document_1',
    document: documentWithOutput(),
    revision,
  };
}

function setFrameRequest(
  requestId: string,
  expectedRevision = 0,
  width = 640,
  dryRun?: boolean,
): unknown {
  return {
    requestId,
    expectedRevision,
    commands: [{ op: 'set_frame', width, height: 480 }],
    ...(dryRun === undefined ? {} : { dryRun }),
  };
}

function transactionRequestAtByteLimitMinusOne(): TransactionRequest {
  const commands: TransactionRequest['commands'] = [{
    op: 'set_frame',
    width: 321,
    height: 241,
  }];
  for (let index = 0; index < 33; index++) {
    const clientRef = `boundary_text_${index}`;
    commands.push({
      op: 'add_node',
      layerId: 'layer_1',
      clientRef,
      nodeType: 'Text',
      params: {
        content: 'x'.repeat(index === 32 ? 1 : 63_367),
      },
    });
    commands.push({
      op: 'remove_nodes',
      layerId: 'layer_1',
      nodeIds: [{ clientRef }],
    });
  }

  const request: TransactionRequest = {
    requestId: 'near_request_limit',
    expectedRevision: 0,
    commands,
  };
  const targetBytes = DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes - 1;
  const currentBytes = boundedCanonicalJsonByteLength(
    request as unknown as JsonValue,
    Number.MAX_SAFE_INTEGER,
  );
  const finalAdd = commands.at(-2);
  if (finalAdd?.op !== 'add_node') {
    throw new Error('Boundary fixture must end with add_node, remove_nodes.');
  }
  finalAdd.params = {
    content: 'x'.repeat(1 + targetBytes - currentBytes),
  };
  return request;
}

function expectFailureCode(result: TransactionResult, code: string): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

function commitApply(
  session: TransactionSession,
  current: RuntimeDocumentState,
  request: unknown,
): SessionApplication {
  const prepared = session.prepareApply(current, session.captureApply(request));
  if (prepared.finalizeToken) {
    expect(session.finalize(prepared.finalizeToken)).toBe(true);
  }
  return prepared;
}

function commitRevert(
  session: TransactionSession,
  current: RuntimeDocumentState,
  request: unknown,
): SessionApplication {
  const prepared = session.prepareRevert(current, session.captureRevert(request));
  if (prepared.finalizeToken) {
    expect(session.finalize(prepared.finalizeToken)).toBe(true);
  }
  return prepared;
}

describe('TransactionSession replay and capacity', () => {
  it('matches direct strict apply at exactly one byte below the raw request limit', () => {
    const request = transactionRequestAtByteLimitMinusOne();
    const byteLength = boundedCanonicalJsonByteLength(
      request as unknown as JsonValue,
      Number.MAX_SAFE_INTEGER,
    );
    expect(byteLength).toBe(DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes - 1);

    const finalAdd = request.commands.at(-2);
    if (finalAdd?.op !== 'add_node') {
      throw new Error('Boundary fixture must end with add_node, remove_nodes.');
    }
    expect((finalAdd.params?.content as string).length)
      .toBeLessThanOrEqual(DEFAULT_AGENT_LIMITS.maxStringBytes);

    const direct = applyDocumentTransaction(runtime(), request, {
      transactionId: 'transaction_1',
    });
    expect(direct.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
      revision: 1,
    });

    const session = new TransactionSession();
    const prepared = session.prepareApply(
      runtime(),
      session.captureApply(request),
    );
    expect(prepared.result).toEqual(direct.result);
    expect(prepared.next).toEqual(direct.next);
    expect(session.finalize(prepared.finalizeToken!)).toBe(true);
  });

  it('replays a deep copy without returning a second committable state', () => {
    const session = new TransactionSession();
    const first = commitApply(session, runtime(), {
      requestId: 'create_shape',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    });
    expect(first.next?.revision).toBe(1);
    expect(first.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
      created: { shape: 'shape_1' },
    });

    if (first.result.ok) first.result.created.shape = 'caller_corruption';
    const replay = commitApply(session, first.next!, {
      requestId: 'create_shape',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.next).toBeUndefined();
    expect(replay.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
      created: { shape: 'shape_1' },
    });
    expect(session.getStats()).toEqual({
      replayEntries: 1,
      ledgerEntries: 1,
      ledgerBytes: expect.any(Number),
    });
  });

  it('rejects reuse with different semantics before checking the newer revision', () => {
    const session = new TransactionSession();
    const first = commitApply(session, runtime(), setFrameRequest('same'));
    expect(first.result.ok).toBe(true);
    const reused = commitApply(session, first.next!, setFrameRequest('same', 1, 800));
    expectFailureCode(reused.result, 'REQUEST_ID_REUSED');
    expect(reused.next).toBeUndefined();
  });

  it('caches normalized failures and does not re-evaluate them after state changes', () => {
    const session = new TransactionSession();
    const request = {
      requestId: 'bad_type',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'bad',
        nodeType: 'NotAType',
      }],
    };
    const first = commitApply(session, runtime(), request);
    expectFailureCode(first.result, 'UNKNOWN_NODE_TYPE');
    const replay = commitApply(session, runtime(9), request);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
    expect(replay.next).toBeUndefined();
  });

  it('caches dry-runs without consuming a ledger entry or transaction ID', () => {
    const session = new TransactionSession();
    const dry = commitApply(session, runtime(), setFrameRequest('dry', 0, 640, true));
    expect(dry.result).toMatchObject({
      ok: true,
      committed: false,
      transactionId: null,
      revision: 0,
      proposedRevision: 1,
    });
    expect(dry.next).toBeUndefined();
    expect(session.getStats()).toMatchObject({ replayEntries: 1, ledgerEntries: 0 });

    const commit = commitApply(session, runtime(), setFrameRequest('commit'));
    expect(commit.result).toMatchObject({ ok: true, transactionId: 'transaction_1' });
  });

  it('never evicts old request IDs when the replay cache is full', () => {
    const session = new TransactionSession({
      limits: { maxRequestCacheEntries: 1 },
    });
    const firstRequest = setFrameRequest('first');
    const first = commitApply(session, runtime(), firstRequest);
    const full = commitApply(session, first.next!, setFrameRequest('second', 1, 800));
    expectFailureCode(full.result, 'RESOURCE_LIMIT');
    expect(full.next).toBeUndefined();

    const replay = commitApply(session, first.next!, firstRequest);
    expect(replay.replayed).toBe(true);
    const reused = commitApply(session, first.next!, setFrameRequest('first', 1, 900));
    expectFailureCode(reused.result, 'REQUEST_ID_REUSED');
  });

  it('lets dry-runs proceed when the non-evicting transaction ledger is full', () => {
    const session = new TransactionSession({
      limits: {
        maxRequestCacheEntries: 4,
        maxTransactionLedgerEntries: 1,
      },
    });
    const first = commitApply(session, runtime(), setFrameRequest('first'));
    const dry = commitApply(session, first.next!, setFrameRequest('dry', 1, 800, true));
    expect(dry.result).toMatchObject({ ok: true, committed: false });
    const blocked = commitApply(session, first.next!, setFrameRequest('blocked', 1, 900));
    expectFailureCode(blocked.result, 'RESOURCE_LIMIT');
    expect(blocked.next).toBeUndefined();
  });

  it('bounds ledger snapshots by bytes as well as entry count', () => {
    const session = new TransactionSession({
      limits: { maxTransactionLedgerBytes: 64 },
    });
    const result = commitApply(session, runtime(), setFrameRequest('too_large'));
    expectFailureCode(result.result, 'RESOURCE_LIMIT');
    expect(result.next).toBeUndefined();
    expect(session.getStats()).toMatchObject({ ledgerEntries: 0, ledgerBytes: 0 });
  });
});

describe('normalized transaction authority', () => {
  it('deep-freezes authorized handles and rejects structurally identical forgeries', () => {
    const normalized = normalizeTransactionRequest({
      requestId: 'sealed_handle',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'text',
        nodeType: 'Text',
        params: { content: 'safe' },
        position: { x: 10, y: 20 },
      }],
    }, 0, {
      computeFingerprint: false,
    } as never);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error('Expected a normalized request handle.');

    const handle = normalized.value;
    const command = handle.request.commands[0];
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.request)).toBe(true);
    expect(Object.isFrozen(handle.request.commands)).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    if (command.op !== 'add_node') throw new Error('Expected add_node command.');
    expect(Object.isFrozen(command.params)).toBe(true);
    expect(Object.isFrozen(command.position)).toBe(true);
    expect(handle.fingerprint).not.toBe('trusted-ui-untracked');

    expect(() => {
      (command.params as Record<string, JsonValue>).content = 'mutated';
    }).toThrow(TypeError);
    expect(command.params?.content).toBe('safe');

    const authorized = applyNormalizedDocumentTransaction(runtime(), handle, {
      transactionId: 'transaction_1',
    });
    expect(authorized.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
    });

    const forged = structuredClone(handle);
    const rejected = applyNormalizedDocumentTransaction(
      runtime(),
      forged,
      { transactionId: 'transaction_1' },
    );
    expect(rejected.next).toBeUndefined();
    expectFailureCode(rejected.result, 'INTERNAL');
  });
});

describe('TransactionSession conflict-safe revert', () => {
  it('restores the exact before project as a new commit and replays once', () => {
    const session = new TransactionSession();
    const before = runtime();
    const applied = commitApply(session, before, setFrameRequest('apply'));
    expect(applied.next?.document.frame).toEqual({ width: 640, height: 480 });

    const reverted = commitRevert(session, applied.next!, {
      requestId: 'revert',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    expect(reverted.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_2',
      previousRevision: 1,
      revision: 2,
      changed: { frame: true },
    });
    expect(reverted.next).toMatchObject({
      documentId: before.documentId,
      document: before.document,
      revision: 2,
    });

    const replay = commitRevert(session, reverted.next!, {
      requestId: 'revert',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.next).toBeUndefined();
    expect(replay.result).toEqual(reverted.result);
  });

  it('can revert the immediately preceding revert without rewinding revision', () => {
    const session = new TransactionSession();
    const applied = commitApply(session, runtime(), setFrameRequest('apply'));
    const reverted = commitRevert(session, applied.next!, {
      requestId: 'revert',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    const restored = commitRevert(session, reverted.next!, {
      requestId: 'revert_the_revert',
      expectedRevision: 2,
      transactionId: 'transaction_2',
    });
    expect(restored.next?.document.frame).toEqual({ width: 640, height: 480 });
    expect(restored.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_3',
      previousRevision: 2,
      revision: 3,
    });
  });

  it('refuses to undo a later human edit or a digest-tampered head', () => {
    const session = new TransactionSession();
    const applied = commitApply(session, runtime(), setFrameRequest('apply'));

    const humanDocument = structuredClone(applied.next!.document);
    humanDocument.frame = { width: 700, height: 500 };
    const afterHuman: RuntimeDocumentState = {
      ...applied.next!,
      document: humanDocument,
      revision: 2,
    };
    const afterHumanResult = commitRevert(session, afterHuman, {
      requestId: 'after_human',
      expectedRevision: 2,
      transactionId: 'transaction_1',
    });
    expectFailureCode(afterHumanResult.result, 'REVISION_CONFLICT');

    const bypassDocument = structuredClone(applied.next!.document);
    bypassDocument.frame = { width: 701, height: 501 };
    const bypass = commitRevert(session, {
      ...applied.next!,
      document: bypassDocument,
    }, {
      requestId: 'digest_bypass',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    expectFailureCode(bypass.result, 'REVISION_CONFLICT');
  });

  it('keeps an immutable before snapshot even if the caller later mutates its input', () => {
    const session = new TransactionSession();
    const before = runtime();
    const applied = commitApply(session, before, setFrameRequest('apply'));
    before.document.frame.width = 999;
    const reverted = commitRevert(session, applied.next!, {
      requestId: 'revert',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    expect(reverted.next?.document.frame).toEqual({ width: 320, height: 240 });
  });

  it('uses one requestId namespace across apply and revert operations', () => {
    const session = new TransactionSession();
    const applied = commitApply(session, runtime(), setFrameRequest('shared'));
    const crossOperation = commitRevert(session, applied.next!, {
      requestId: 'shared',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    });
    expectFailureCode(crossOperation.result, 'REQUEST_ID_REUSED');
    expect(crossOperation.next).toBeUndefined();
  });

  it('returns a structured error for a revoked revert request proxy', () => {
    const session = new TransactionSession();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => commitRevert(session, runtime(), proxy)).not.toThrow();
    expect(commitRevert(session, runtime(), proxy).result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', recoverable: false },
    });
  });
});

describe('TransactionSession two-phase finalization', () => {
  it('does not reserve cache, ledger, sequence, or IDs until finalize', () => {
    const session = new TransactionSession();
    const captured = session.captureApply(setFrameRequest('prepared_only'));
    expect(Reflect.ownKeys(captured)).toEqual([]);
    expect(Object.getPrototypeOf(captured)).toBeNull();
    expect(Object.isFrozen(captured)).toBe(true);
    const abandoned = session.prepareApply(runtime(), captured);
    expect(abandoned.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
    });
    expect(abandoned.finalizeToken).not.toBeNull();
    expect(Reflect.ownKeys(abandoned.finalizeToken!)).toEqual([]);
    expect(Object.getPrototypeOf(abandoned.finalizeToken!)).toBeNull();
    expect(Object.isFrozen(abandoned.finalizeToken!)).toBe(true);
    expect(session.getStats()).toEqual({
      replayEntries: 0,
      ledgerEntries: 0,
      ledgerBytes: 0,
    });

    const retry = session.prepareApply(runtime(), session.captureApply(
      setFrameRequest('prepared_only'),
    ));
    expect(retry.replayed).toBe(false);
    expect(retry.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_1',
    });
    expect(session.finalize(retry.finalizeToken!)).toBe(true);
    expect(session.getStats()).toMatchObject({
      replayEntries: 1,
      ledgerEntries: 1,
    });
  });

  it('makes tokens one-shot and rejects a stale concurrent preparation', () => {
    const session = new TransactionSession();
    const first = session.prepareApply(
      runtime(),
      session.captureApply(setFrameRequest('prepared_first')),
    );
    const stale = session.prepareApply(
      runtime(),
      session.captureApply(setFrameRequest('prepared_stale', 0, 800)),
    );
    expect(first.finalizeToken).not.toBeNull();
    expect(stale.finalizeToken).not.toBeNull();
    expect(session.finalize(first.finalizeToken!)).toBe(true);
    expect(session.finalize(first.finalizeToken!)).toBe(false);
    expect(session.finalize(stale.finalizeToken!)).toBe(false);
    expect(session.getStats()).toMatchObject({
      replayEntries: 1,
      ledgerEntries: 1,
    });
  });

  it('keeps opaque captures bound to their originating session', () => {
    const owner = new TransactionSession();
    const other = new TransactionSession();
    const captured = owner.captureApply(setFrameRequest('owned_capture'));
    expect(other.prepareApply(runtime(), captured).result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', recoverable: false },
    });

    const prepared = owner.prepareApply(runtime(), captured);
    expect(prepared.result).toMatchObject({ ok: true, transactionId: 'transaction_1' });
    expect(owner.finalize(prepared.finalizeToken!)).toBe(true);
  });

  it('can abandon and retry a prepared revert without ghost ledger state', () => {
    const session = new TransactionSession();
    const applied = commitApply(session, runtime(), setFrameRequest('revert_source'));
    const request = {
      requestId: 'prepared_revert',
      expectedRevision: 1,
      transactionId: 'transaction_1',
    };
    const before = session.getStats();
    const abandoned = session.prepareRevert(
      applied.next!,
      session.captureRevert(request),
    );
    expect(abandoned.result).toMatchObject({
      ok: true,
      transactionId: 'transaction_2',
    });
    expect(session.getStats()).toEqual(before);

    const retry = session.prepareRevert(
      applied.next!,
      session.captureRevert(request),
    );
    expect(session.finalize(retry.finalizeToken!)).toBe(true);
    expect(retry.next?.document.frame).toEqual({ width: 320, height: 240 });
    expect(session.getStats().ledgerEntries).toBe(2);
  });
});
