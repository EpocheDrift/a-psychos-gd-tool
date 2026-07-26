import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../src/bridgeClient.js';
import { createToolServer } from '../src/tools.js';

const closers: Array<() => Promise<void>> = [];
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'url',
  'uri',
  'path',
  'file',
  'command',
  'shell',
]);

function schemaPropertyNames(value: unknown): Set<string> {
  const names = new Set<string>();
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (!Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if (
        record.properties
        && typeof record.properties === 'object'
        && !Array.isArray(record.properties)
      ) {
        for (const name of Object.keys(record.properties)) names.add(name);
      }
      stack.push(...Object.values(record));
    } else {
      stack.push(...current);
    }
  }
  return names;
}

async function connectedTools(
  allowEdit: boolean,
  call: (operation: string, input: unknown) => Promise<unknown>,
) {
  const bridge = { call: vi.fn(call) } as unknown as BridgeClient;
  const server = createToolServer({ bridge, allowEdit });
  const client = new Client(
    { name: 'companion-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { bridge, client };
}

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

describe('MCP tool adapter', () => {
  it('lists six default read/preview tools and eight explicit edit tools', async () => {
    const readOnly = await connectedTools(false, async () => ({}));
    const readTools = await readOnly.client.listTools();
    expect(readTools.tools.map((tool) => tool.name)).toEqual([
      'gfx_get_capabilities',
      'gfx_get_document',
      'gfx_get_render_status',
      'gfx_validate_document',
      'gfx_await_render',
      'gfx_capture_preview',
    ]);
    for (const tool of readTools.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.outputSchema?.additionalProperties).toBe(false);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      const propertyNames = schemaPropertyNames(tool.inputSchema);
      expect(
        [...propertyNames].filter((name) =>
          FORBIDDEN_AUTHORITY_FIELDS.has(name.toLowerCase())),
      ).toEqual([]);
    }

    const editable = await connectedTools(true, async () => ({}));
    const editTools = await editable.client.listTools();
    expect(editTools.tools.map((tool) => tool.name)).toEqual([
      'gfx_get_capabilities',
      'gfx_get_document',
      'gfx_get_render_status',
      'gfx_validate_document',
      'gfx_apply_transaction',
      'gfx_await_render',
      'gfx_capture_preview',
      'gfx_revert_transaction',
    ]);
    for (const tool of editTools.tools) {
      const propertyNames = schemaPropertyNames(tool.inputSchema);
      expect(
        [...propertyNames].filter((name) =>
          FORBIDDEN_AUTHORITY_FIELDS.has(name.toLowerCase())),
      ).toEqual([]);
    }
    expect(
      editTools.tools.find((tool) => tool.name === 'gfx_apply_transaction')
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('preserves structured domain errors after client output validation', async () => {
    const tools = await connectedTools(true, async () => ({
      ok: false,
      requestId: 'invalid_wire',
      revision: 4,
      error: {
        code: 'TYPE_MISMATCH',
        message: 'Text cannot connect to raster.',
        path: '/commands/0/to',
        commandIndex: 0,
        details: { fromType: 'text', toType: 'raster' },
        recoverable: true,
        suggestedFix: 'Insert Rasterize.',
      },
    }));
    await tools.client.listTools();
    const result = await tools.client.callTool({
      name: 'gfx_apply_transaction',
      arguments: {
        requestId: 'invalid_wire',
        expectedRevision: 4,
        commands: [{
          op: 'connect',
          layerId: 'layer',
          from: { nodeId: 'text', socket: 'out' },
          to: { nodeId: 'output', socket: 'in' },
        }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      outcome: {
        ok: false,
        revision: 4,
        requestId: 'invalid_wire',
        error: {
          code: 'TYPE_MISMATCH',
          commandIndex: 0,
        },
      },
    });
  });

  it('rejects malformed input before invoking the bridge', async () => {
    const tools = await connectedTools(true, async () => ({}));
    await tools.client.listTools();
    const result = await tools.client.callTool({
      name: 'gfx_apply_transaction',
      arguments: {
        requestId: 'bad',
        expectedRevision: 0,
        commands: [{
          op: 'set_frame',
          width: 320,
          height: 240,
          unknown: true,
        }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      outcome: {
        ok: false,
        revision: 0,
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'The MCP tool arguments failed schema validation.',
          recoverable: true,
        },
      },
    });
    expect((tools.bridge.call as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('wraps unknown tool errors in the same structured envelope', async () => {
    const tools = await connectedTools(false, async () => ({}));
    const result = await tools.client.callTool({
      name: 'gfx_unknown_tool',
      arguments: {},
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: {
          ok: false,
          revision: 0,
          error: {
            code: 'INVALID_ARGUMENT',
            recoverable: true,
          },
        },
      },
    });
  });

  it('fails safely when a remote fault has an invalid optional field', async () => {
    const tools = await connectedTools(false, async () => {
      throw {
        name: 'AgentControllerFault',
        ok: false,
        revision: 9,
        error: {
          code: 'INTERNAL',
          message: 'Malformed fault.',
          recoverable: false,
          suggestedFix: 42,
        },
      };
    });
    const result = await tools.client.callTool({
      name: 'gfx_get_document',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      outcome: {
        ok: false,
        revision: 0,
        error: {
          code: 'INTERNAL',
          message: 'The local companion failed safely.',
          recoverable: false,
        },
      },
    });
  });
});
