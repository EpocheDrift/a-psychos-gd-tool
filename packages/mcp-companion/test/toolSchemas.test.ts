import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import {
  applyTransactionInputSchema,
  commandSchema,
  toolOutcomeSchema,
} from '../src/toolSchemas.js';
import { assertBoundedWireJson } from '../src/boundedJson.js';

describe('MCP tool schemas', () => {
  it('accepts every command discriminator and rejects nested unknown fields', () => {
    const commands = [
      { op: 'set_frame', width: 320, height: 240 },
      { op: 'add_layer', clientRef: 'layer' },
      { op: 'update_layer', layerId: 'layer', patch: { visible: true } },
      { op: 'move_layer', layerId: 'layer', index: 0 },
      { op: 'remove_layer', layerId: 'layer' },
      {
        op: 'add_node',
        layerId: 'layer',
        clientRef: 'node',
        nodeType: 'Text',
        params: { text: 'hello' },
      },
      {
        op: 'set_node_params',
        layerId: 'layer',
        nodeId: 'node',
        patch: { text: 'updated' },
      },
      {
        op: 'move_nodes',
        layerId: 'layer',
        positions: [{ nodeId: 'node', position: { x: 1, y: 2 } }],
      },
      { op: 'remove_nodes', layerId: 'layer', nodeIds: ['node'] },
      {
        op: 'connect',
        layerId: 'layer',
        from: { nodeId: 'node', socket: 'out' },
        to: { nodeId: 'output', socket: 'in' },
      },
      {
        op: 'disconnect',
        layerId: 'layer',
        to: { nodeId: 'output', socket: 'in' },
      },
      { op: 'auto_layout_graph', layerId: 'layer', direction: 'LR' },
    ];
    for (const command of commands) {
      expect(commandSchema.safeParse(command).success).toBe(true);
    }
    expect(commandSchema.safeParse({
      op: 'connect',
      layerId: 'layer',
      from: { nodeId: 'node', socket: 'out', extra: true },
      to: { nodeId: 'output', socket: 'in' },
    }).success).toBe(false);
    expect(applyTransactionInputSchema.safeParse({
      requestId: 'request_1',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 320, height: 240 }],
      unknown: true,
    }).success).toBe(false);
    expect(commandSchema.safeParse({
      op: 'add_layer',
      clientRef: 'unicode_layer',
      name: '😀'.repeat(128),
    }).success).toBe(true);
    expect(commandSchema.safeParse({
      op: 'add_layer',
      clientRef: 'unicode_layer',
      name: '😀'.repeat(129),
    }).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(commandSchema))).toContain(
      '"name":{"type":"string","minLength":1,"maxLength":128',
    );
  });

  it('publishes one strict success-or-failure structured envelope', () => {
    expect(toolOutcomeSchema.safeParse({
      outcome: { ok: true, value: { revision: 1 } },
    }).success).toBe(true);
    expect(toolOutcomeSchema.safeParse({
      outcome: {
        ok: false,
        revision: 1,
        error: {
          code: 'TYPE_MISMATCH',
          message: 'Socket types differ.',
          recoverable: true,
        },
      },
    }).success).toBe(true);
    expect(toolOutcomeSchema.safeParse({
      outcome: { ok: true, value: {}, extra: true },
    }).success).toBe(false);
  });

  it('rejects deep or prototype-sensitive dynamic JSON iteratively', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < 130; index++) deep = [deep];
    expect(() => assertBoundedWireJson(deep)).toThrow('depth or value');
    expect(() => assertBoundedWireJson(
      JSON.parse('{"__proto__":{"polluted":true}}'),
    )).toThrow('prototype-sensitive');
  });
});
