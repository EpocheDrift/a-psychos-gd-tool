import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  BoundedLineInput,
  BoundedLineOutput,
} from '../src/boundedStdio.js';
import { COMPANION_TRANSPORT_LIMITS } from '../src/protocol.js';

describe('bounded MCP stdio', () => {
  it('reframes split lines without letting the SDK accumulate partial input', async () => {
    const input = new BoundedLineInput(64);
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    input.write('{"jsonrpc":"2.0"');
    input.write('}\n{"id":1}\n');
    input.end();
    await new Promise<void>((resolve, reject) => {
      input.once('end', resolve);
      input.once('error', reject);
    });
    expect(Buffer.concat(chunks).toString('utf8')).toBe(
      '{"jsonrpc":"2.0"}\n{"id":1}\n',
    );
  });

  it('rejects an oversized line before receiving a newline', async () => {
    const input = new BoundedLineInput(32);
    const error = new Promise<Error>((resolve) => {
      input.once('error', resolve);
    });
    input.write(Buffer.alloc(33, 0x61));
    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining('exceeds 32 bytes'),
    });
  });

  it('handles a near-limit line fragmented into one-byte chunks', async () => {
    const input = new BoundedLineInput(65_536);
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    const payload = Buffer.from(`"${'x'.repeat(65_533)}"\n`);
    for (const byte of payload) input.write(Buffer.from([byte]));
    input.end();
    await new Promise<void>((resolve, reject) => {
      input.once('end', resolve);
      input.once('error', reject);
    });
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it('tracks UTF-8 and escaped strings across one-byte chunks', async () => {
    const input = new BoundedLineInput();
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    const payload = Buffer.from(`${JSON.stringify({
      text: '🙂 quote " slash \\ '
        + '['.repeat(COMPANION_TRANSPORT_LIMITS.maxJsonDepth + 16)
        + ']'.repeat(COMPANION_TRANSPORT_LIMITS.maxJsonDepth + 16),
    })}\n`);
    for (const byte of payload) input.write(Buffer.from([byte]));
    input.end();
    await new Promise<void>((resolve, reject) => {
      input.once('end', resolve);
      input.once('error', reject);
    });
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it('rejects excessive nesting before forwarding the line', async () => {
    const allowed = new BoundedLineInput();
    const allowedChunks: Buffer[] = [];
    allowed.on('data', (chunk: Buffer) => allowedChunks.push(chunk));
    const maximumDepth = COMPANION_TRANSPORT_LIMITS.maxJsonDepth;
    const allowedPayload =
      `${'['.repeat(maximumDepth)}null${']'.repeat(maximumDepth)}\n`;
    allowed.end(allowedPayload);
    await new Promise<void>((resolve, reject) => {
      allowed.once('end', resolve);
      allowed.once('error', reject);
    });
    expect(Buffer.concat(allowedChunks).toString('utf8'))
      .toBe(allowedPayload);

    const input = new BoundedLineInput();
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    const error = new Promise<Error>((resolve) => {
      input.once('error', resolve);
    });
    const nesting = COMPANION_TRANSPORT_LIMITS.maxJsonDepth + 1;
    input.end(
      `${'['.repeat(nesting)}null${']'.repeat(nesting)}\n`,
    );
    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining('nesting depth exceeds'),
    });
    expect(chunks).toHaveLength(0);
  });

  it('rejects a JSON value bomb before forwarding the line', async () => {
    const maximumValues = COMPANION_TRANSPORT_LIMITS.maxJsonValues;
    const allowed = new BoundedLineInput();
    const allowedChunks: Buffer[] = [];
    allowed.on('data', (chunk: Buffer) => allowedChunks.push(chunk));
    const allowedPayload =
      `[${'null,'.repeat(maximumValues - 2)}null]\n`;
    allowed.end(allowedPayload);
    await new Promise<void>((resolve, reject) => {
      allowed.once('end', resolve);
      allowed.once('error', reject);
    });
    expect(Buffer.concat(allowedChunks).toString('utf8'))
      .toBe(allowedPayload);

    const input = new BoundedLineInput();
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    const error = new Promise<Error>((resolve) => {
      input.once('error', resolve);
    });
    input.end(`[${'null,'.repeat(maximumValues - 1)}null]\n`);
    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining('value count exceeds'),
    });
    expect(chunks).toHaveLength(0);
  });

  it('allows only bounded newline-framed stdout writes', async () => {
    const target = new PassThrough();
    const output = new BoundedLineOutput(target, 16);
    const received: Buffer[] = [];
    target.on('data', (chunk: Buffer) => received.push(chunk));
    await new Promise<void>((resolve, reject) => {
      output.write('{"ok":true}\n', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    expect(Buffer.concat(received).toString('utf8')).toBe('{"ok":true}\n');

    const invalid = new BoundedLineOutput(new PassThrough(), 8);
    const error = new Promise<Error>((resolve) => {
      invalid.once('error', resolve);
    });
    invalid.write('123456789\n');
    await expect(error).resolves.toMatchObject({
      message: expect.stringContaining('exceeds 8 bytes'),
    });
  });
});
