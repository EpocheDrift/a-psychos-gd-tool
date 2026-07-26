import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/graph';
import type { RenderStatus } from '../domain/renderCoordinator';
import {
  getCapabilitiesQuery,
  getDocumentQuery,
  publicRenderStatus,
  validateDocumentQuery,
  type ControllerDocumentState,
} from './queries';

function state(): ControllerDocumentState {
  const document: Doc = {
    frame: { width: 320, height: 240 },
    layers: [{
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          image: {
            id: 'image',
            type: 'Image',
            params: {
              src: 'data:image/png;base64,iVBORw0KGgo=',
              fit: 'contain',
            },
            position: { x: 10, y: 20 },
          },
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true },
            position: { x: 30, y: 40 },
          },
        },
        edges: [],
      },
    }],
  };
  return {
    documentId: 'document_1',
    document,
    revision: 4,
  };
}

describe('Agent queries', () => {
  it('returns compact capabilities by default and allowlisted detail on request', () => {
    const compact = getCapabilitiesQuery(undefined, 4);
    expect(compact.protocolVersion).toBe('1.0');
    expect(compact.nodes.length).toBeGreaterThan(20);
    expect(compact.nodes[0]).not.toHaveProperty('params');
    expect(compact.nodes[0]).not.toHaveProperty('execution');
    expect(compact.scopeAvailability).toMatchObject({
      read: { available: true },
      preview: { available: true },
      edit: { available: true },
      assets: { available: false },
      model: { available: false },
      export: { available: false },
    });

    const detailed = getCapabilitiesQuery({
      nodeTypes: ['Text', 'Output'],
      include: ['sockets', 'params', 'traits'],
    }, 4);
    expect(detailed.nodes.map((node) => node.type)).toEqual(['Text', 'Output']);
    expect(detailed.nodes[0]).toMatchObject({
      params: expect.any(Array),
      traits: expect.any(Object),
      execution: expect.any(Object),
    });
    expect(JSON.parse(JSON.stringify(detailed))).toEqual(detailed);
    expect(structuredClone(detailed)).toEqual(detailed);

    const deferred = getCapabilitiesQuery({
      nodeTypes: ['Trace', 'RemoveBackground'],
      include: ['traits'],
    }, 4);
    expect(deferred.nodes).toMatchObject([
      {
        type: 'Trace',
        traits: {
          agentExecution: {
            available: false,
            rolloutGate: 'PR7',
          },
        },
      },
      {
        type: 'RemoveBackground',
        traits: {
          agentExecution: {
            available: false,
            rolloutGate: 'PR7',
          },
        },
      },
    ]);
  });

  it('projects only public document fields and redacts embedded image data', () => {
    const snapshot = getDocumentQuery(state(), {});
    expect(snapshot).toMatchObject({
      revision: 4,
      trust: 'untrusted-document-content',
      documentId: 'document_1',
      redactions: [{
        path: expect.stringContaining('/params/src'),
        kind: 'embedded-image-data',
        mimeType: 'image/png',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('iVBORw0KGgo');
    expect(json).not.toContain('activeLayerId');
    expect(json).not.toContain('selectedNodeIds');
    expect(json).not.toContain('fonts');
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it('redacts data URIs even when their media type is omitted', () => {
    const current = state();
    current.document.layers[0].graph.nodes.image.params.src =
      'data:;base64,omitted-mime-secret';
    const snapshot = getDocumentQuery(current, {});
    expect(JSON.stringify(snapshot)).not.toContain('omitted-mime-secret');
    expect(snapshot.redactions).toMatchObject([{
      mimeType: 'application/octet-stream',
      kind: 'embedded-image-data',
    }]);
  });

  it('supports layer/include/compact filters and reports omissions', () => {
    const snapshot = getDocumentQuery(state(), {
      revision: 4,
      layerIds: ['layer_1'],
      include: ['nodes'],
      compact: true,
    });
    expect(snapshot).not.toHaveProperty('frame');
    expect(snapshot.layers).toHaveLength(1);
    expect(snapshot.omitted).toContain('/frame');
    expect(snapshot.omitted).toContain('editor positions');
    expect(JSON.stringify(snapshot)).not.toContain('"position"');
    expect(JSON.stringify(snapshot)).not.toContain('"name":"Layer 1"');
  });

  it('validates current and proposed projects without mutating state', () => {
    const current = state();
    const before = structuredClone(current);
    const report = validateDocumentQuery(current, {
      source: 'current',
      mode: 'editable',
    });
    expect(report.trust).toBe('untrusted-document-content');
    expect(report.report.mode).toBe('editable');
    expect(current).toEqual(before);

    const proposed = validateDocumentQuery(current, {
      source: 'project',
      mode: 'structural',
      project: {
        format: 'a-psychos-gd-tool',
        schemaVersion: 999,
        documentId: 'document_1',
        document: current.document,
      } as never,
    });
    expect(proposed.report.valid).toBe(false);
    expect(proposed.report.errors[0]?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    expect(current).toEqual(before);
  });

  it('bounds unknown project keys in public validation diagnostics', () => {
    const current = state();
    const secret = 'validation-secret-that-must-not-survive';
    const unknownKey = `data:;base64,${secret}${'x'.repeat(12_000)}`;
    const project = {
      format: 'a-psychos-gd-tool',
      schemaVersion: 3,
      documentId: current.documentId,
      document: current.document,
      [unknownKey]: true,
    };
    const result = validateDocumentQuery(current, {
      source: 'project',
      mode: 'structural',
      project: project as never,
    });
    const serialized = JSON.stringify(result);
    expect(result.report.valid).toBe(false);
    expect(serialized).not.toContain(secret);
    expect(serialized.length).toBeLessThan(4_000);
    expect(serialized).toContain('redacted data URI');
    expect(structuredClone(result)).toEqual(result);
  });

  it('does not invoke accessors at the query boundary', () => {
    const getter = vi.fn(() => 4);
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(request, 'revision', {
      enumerable: true,
      get: getter,
    });
    let failure: unknown;
    try {
      getDocumentQuery(state(), request);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('bounds render events and redacts sensitive diagnostics', () => {
    const status: RenderStatus = {
      documentRevision: 4,
      ticket: { revision: 4, attempt: 1 },
      displayedTicket: null,
      displayedRevision: null,
      requestedRevision: 4,
      renderRevision: 4,
      state: 'failed',
      error: {
        code: 'RENDER_FAILED',
        message: 'failed',
        revision: 4,
        attempt: 1,
        recoverable: true,
        details: {
          claimToken: 'do-not-leak',
          source: 'data:image/png;base64,AAAA',
        },
      },
      events: Array.from({ length: 300 }, (_, index) => ({
        revision: 4,
        attempt: 1,
        layerId: 'layer_1',
        nodeId: `node_${index}`,
        type: 'Shape',
        status: 'hit' as const,
        ms: index,
      })),
    };
    const result = publicRenderStatus(status, true);
    expect(result.events).toHaveLength(256);
    const json = JSON.stringify(result);
    expect(json).not.toContain('do-not-leak');
    expect(json).not.toContain('AAAA');
    expect(result.omitted).toContain('/events/256+');
  });

  it('omits non-JSON internal render diagnostics without breaking the public boundary', () => {
    const status: RenderStatus = {
      documentRevision: 4,
      ticket: { revision: 4, attempt: 1 },
      displayedTicket: null,
      displayedRevision: null,
      requestedRevision: 4,
      renderRevision: 4,
      state: 'failed',
      error: {
        code: 'RENDER_FAILED',
        message: 'failed',
        revision: 4,
        attempt: 1,
        recoverable: true,
        details: {
          unsafe: new Map([['secret', 'value']]),
        } as never,
      },
    };
    const result = publicRenderStatus(status, true);
    expect(result.error).not.toHaveProperty('details');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(structuredClone(result)).toEqual(result);
  });
});
