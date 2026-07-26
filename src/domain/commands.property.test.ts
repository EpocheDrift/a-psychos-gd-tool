import { describe, expect, it } from 'vitest';
import type { Doc } from '../engine/graph';
import type { DocumentCommand, RuntimeDocumentState } from './commandTypes';
import { applyDocumentTransaction } from './commands';
import { createSerializedProject } from './documentSchema';
import { validateSerializedProject } from './semanticValidation';

function runtime(): RuntimeDocumentState {
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
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true },
          },
        },
        edges: [],
      },
    }],
  };
  return { documentId: 'document_1', document, revision: 0 };
}

function randomSequence(seed: number): DocumentCommand[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const commands: DocumentCommand[] = [{
    op: 'set_frame',
    width: 321 + seed,
    height: 241 + seed,
  }];
  const live: string[] = [];
  let nextRef = 0;
  const add = (): void => {
    const clientRef = `shape_${nextRef++}`;
    live.push(clientRef);
    commands.push({
      op: 'add_node',
      layerId: 'layer_1',
      clientRef,
      nodeType: 'Shape',
    });
  };
  add();
  add();
  add();

  for (let index = 0; index < 24; index++) {
    const choice = random() % 5;
    if (choice === 0 || live.length === 0) {
      add();
      continue;
    }
    const liveIndex = random() % live.length;
    const clientRef = live[liveIndex];
    if (choice === 1) {
      commands.push({
        op: 'set_node_params',
        layerId: 'layer_1',
        nodeId: { clientRef },
        patch: { width: 1 + (random() % 2_000) },
      });
    } else if (choice === 2) {
      commands.push({
        op: 'move_nodes',
        layerId: 'layer_1',
        positions: [{
          nodeId: { clientRef },
          position: {
            x: (random() % 2_000) - 1_000,
            y: (random() % 2_000) - 1_000,
          },
        }],
      });
    } else if (choice === 3 && live.length > 1) {
      live.splice(liveIndex, 1);
      commands.push({
        op: 'remove_nodes',
        layerId: 'layer_1',
        nodeIds: [{ clientRef }],
      });
    } else {
      commands.push({
        op: 'update_layer',
        layerId: 'layer_1',
        patch: { opacity: (random() % 101) / 100 },
      });
    }
  }
  return commands;
}

describe('deterministic command-sequence property checks', () => {
  it('either produces a renderable isolated draft or leaves the base byte-equivalent', () => {
    for (let seed = 1; seed <= 64; seed++) {
      const base = runtime();
      const before = JSON.stringify(base.document);
      const request = {
        requestId: `property_${seed}`,
        expectedRevision: 0,
        commands: randomSequence(seed),
      };
      const first = applyDocumentTransaction(base, request, {
        transactionId: 'transaction_1',
      });
      const second = applyDocumentTransaction(base, structuredClone(request), {
        transactionId: 'transaction_1',
      });

      expect(first.result).toEqual(second.result);
      expect(JSON.stringify(base.document)).toBe(before);
      if (!first.result.ok) {
        expect(first.next).toBeUndefined();
        continue;
      }

      expect(first.next?.revision).toBe(1);
      expect(validateSerializedProject(
        createSerializedProject(
          first.next!.documentId,
          first.next!.document,
          first.next!.assets,
        ),
        { mode: 'renderable' },
      ).valid).toBe(true);
    }
  });
});
