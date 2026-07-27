import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../src/bridgeClient.js';
import type { PublicModelStatus } from '../src/modelPublicContract.js';
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
  allowAssets = false,
  allowModel = false,
  status: () => Promise<PublicModelStatus> = async () =>
    fixtureModelStatus('not-installed'),
) {
  const bridge = { call: vi.fn(call) } as unknown as BridgeClient;
  const modelManager = { status: vi.fn(status) };
  const server = createToolServer({
    bridge,
    allowEdit,
    allowAssets,
    allowModel,
    ...(allowModel ? { modelManager } : {}),
  });
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
  return { bridge, client, modelManager };
}

function fixtureModelStatus(
  state: PublicModelStatus['state'],
): PublicModelStatus {
  const ready = state === 'ready';
  return {
    schemaVersion: 1,
    modelKey: 'rmbg-1.4',
    revision: '2ceba5a5efaec153162aedea169f76caf9b46cf8',
    manifestSha256:
      '561ce573597fda1b7b540f7e5929c5f47fcfdce65c33f7f581aa0c3da9eaa269',
    state,
    bytes: ready ? 345 : 0,
    totalBytes: 345,
    artifacts: [{
      id: 'preprocessor-config',
      state: ready ? 'ready' : 'missing',
      bytes: ready ? 345 : 0,
      totalBytes: 345,
    }],
    license: {
      id: 'bria-rmbg-1.4',
      name: 'BRIA RMBG 1.4 Model License',
      summary:
        'Non-commercial use; commercial use requires a separate agreement.',
      commercialUse: 'separate-agreement-required',
      requiresExplicitApproval: true,
    },
  };
}

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

describe('MCP tool adapter', () => {
  it.each([
    {
      label: 'read/preview',
      allowEdit: false,
      allowAssets: false,
      allowModel: false,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_await_render',
        'gfx_capture_preview',
      ],
    },
    {
      label: 'edit',
      allowEdit: true,
      allowAssets: false,
      allowModel: false,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_apply_transaction',
        'gfx_await_render',
        'gfx_capture_preview',
        'gfx_revert_transaction',
      ],
    },
    {
      label: 'assets',
      allowEdit: false,
      allowAssets: true,
      allowModel: false,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_put_asset',
        'gfx_list_assets',
        'gfx_get_asset_metadata',
        'gfx_remove_asset',
        'gfx_await_render',
        'gfx_capture_preview',
      ],
    },
    {
      label: 'edit+assets',
      allowEdit: true,
      allowAssets: true,
      allowModel: false,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_apply_transaction',
        'gfx_put_asset',
        'gfx_list_assets',
        'gfx_get_asset_metadata',
        'gfx_remove_asset',
        'gfx_await_render',
        'gfx_capture_preview',
        'gfx_revert_transaction',
      ],
    },
    {
      label: 'model',
      allowEdit: false,
      allowAssets: false,
      allowModel: true,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_get_model_status',
        'gfx_prepare_model',
        'gfx_await_render',
        'gfx_capture_preview',
      ],
    },
    {
      label: 'edit+assets+model',
      allowEdit: true,
      allowAssets: true,
      allowModel: true,
      expected: [
        'gfx_get_capabilities',
        'gfx_get_document',
        'gfx_get_render_status',
        'gfx_validate_document',
        'gfx_get_model_status',
        'gfx_prepare_model',
        'gfx_apply_transaction',
        'gfx_put_asset',
        'gfx_list_assets',
        'gfx_get_asset_metadata',
        'gfx_remove_asset',
        'gfx_await_render',
        'gfx_capture_preview',
        'gfx_revert_transaction',
      ],
    },
  ])('publishes the exact $label tool profile', async (profile) => {
    const connected = await connectedTools(
      profile.allowEdit,
      async () => ({}),
      profile.allowAssets,
      profile.allowModel,
    );
    const listed = await connected.client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(profile.expected);
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.outputSchema?.additionalProperties).toBe(false);
      const propertyNames = schemaPropertyNames(tool.inputSchema);
      expect(
        [...propertyNames].filter((name) =>
          FORBIDDEN_AUTHORITY_FIELDS.has(name.toLowerCase())),
      ).toEqual([]);
    }
  });

  it('never lets the MCP preparation tool approve or start a first download', async () => {
    const tools = await connectedTools(
      false,
      async () => ({}),
      false,
      true,
    );
    const result = await tools.client.callTool({
      name: 'gfx_prepare_model',
      arguments: { requestId: 'agent-model-request' },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: {
          ok: false,
          requestId: 'agent-model-request',
          error: {
            code: 'MODEL_DOWNLOAD_REQUIRED',
            details: {
              reason: 'CONFIRMATION_REQUIRED',
              modelStatus: {
                modelKey: 'rmbg-1.4',
                state: 'not-installed',
              },
            },
          },
        },
      },
    });
    expect(tools.modelManager.status).toHaveBeenCalledOnce();
    expect(tools.bridge.call).not.toHaveBeenCalled();

    const ready = await connectedTools(
      false,
      async () => ({}),
      false,
      true,
      async () => fixtureModelStatus('ready'),
    );
    await expect(ready.client.callTool({
      name: 'gfx_prepare_model',
      arguments: { requestId: 'already-ready' },
    })).resolves.toMatchObject({
      structuredContent: {
        outcome: {
          ok: true,
          value: { state: 'ready' },
        },
      },
    });
    expect(ready.bridge.call).not.toHaveBeenCalled();
  });

  it('publishes truthful write annotations for graph and asset mutations', async () => {
    const editable = await connectedTools(
      true,
      async () => ({}),
      true,
    );
    const editTools = await editable.client.listTools();
    expect(
      editTools.tools.find((tool) => tool.name === 'gfx_apply_transaction')
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(
      editTools.tools.find((tool) => tool.name === 'gfx_put_asset')
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(
      editTools.tools.find((tool) => tool.name === 'gfx_remove_asset')
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    for (const name of ['gfx_list_assets', 'gfx_get_asset_metadata']) {
      expect(
        editTools.tools.find((tool) => tool.name === name)?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
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

  it('rejects non-canonical or oversized asset chunks before the bridge', async () => {
    const tools = await connectedTools(
      false,
      async () => ({}),
      true,
    );
    await tools.client.listTools();
    for (const dataBase64 of [
      'YR==',
      'A'.repeat(1_398_108),
    ]) {
      const result = await tools.client.callTool({
        name: 'gfx_put_asset',
        arguments: {
          phase: 'chunk',
          requestId: 'asset_chunk',
          uploadId: `upload_${'a'.repeat(22)}`,
          offset: 0,
          dataBase64,
          chunkSha256: '0'.repeat(64),
        },
      });
      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          outcome: {
            ok: false,
            error: { code: 'INVALID_ARGUMENT' },
          },
        },
      });
    }
    expect(
      tools.bridge.call as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
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
