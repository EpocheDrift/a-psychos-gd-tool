import process from 'node:process';
import { Transform, Writable, type Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { COMPANION_TRANSPORT_LIMITS } from './protocol.js';

type ObjectState =
  | 'key-or-end'
  | 'key'
  | 'colon'
  | 'value'
  | 'comma-or-end';

type ArrayState =
  | 'value-or-end'
  | 'value'
  | 'comma-or-end';

type ContainerFrame =
  | {
    kind: 'object';
    state: ObjectState;
    completesParent: boolean;
  }
  | {
    kind: 'array';
    state: ArrayState;
    completesParent: boolean;
  };

type ActiveToken =
  | {
    kind: 'string';
    role: 'key' | 'value';
    escaped: boolean;
    completesParent: boolean;
  }
  | {
    kind: 'scalar';
    completesParent: boolean;
  };

function isJsonWhitespace(character: string): boolean {
  return (
    character === ' '
    || character === '\t'
    || character === '\r'
    || character === '\n'
  );
}

function isScalarDelimiter(character: string): boolean {
  return (
    isJsonWhitespace(character)
    || character === '{'
    || character === '}'
    || character === '['
    || character === ']'
    || character === ','
    || character === ':'
    || character === '"'
  );
}

/**
 * Counts JSON values and nesting while bytes are still held by the stdio
 * framer. It deliberately leaves full syntax validation to the MCP SDK, but
 * counts wire values on the same budget as assertBoundedWireJson: the root,
 * every object property value, and every array element count; keys do not.
 * Duplicate object properties each consume wire budget before JSON.parse can
 * collapse them.
 */
class JsonResourceScanner {
  private readonly frames: ContainerFrame[] = [];
  private rootState: 'value' | 'complete' = 'value';
  private activeToken: ActiveToken | null = null;
  private valueCount = 0;

  write(text: string): void {
    let index = 0;
    while (index < text.length) {
      const character = text[index]!;
      if (this.activeToken?.kind === 'string') {
        this.scanStringCharacter(character);
        index++;
        continue;
      }
      if (this.activeToken?.kind === 'scalar') {
        if (!isScalarDelimiter(character)) {
          index++;
          continue;
        }
        this.finishActiveValue();
        continue;
      }
      if (isJsonWhitespace(character)) {
        index++;
        continue;
      }
      if (character === '"') {
        this.startString();
        index++;
        continue;
      }
      if (character === '{' || character === '[') {
        this.startContainer(character);
        index++;
        continue;
      }
      if (character === '}' || character === ']') {
        this.finishContainer(character);
        index++;
        continue;
      }
      if (character === ':') {
        const frame = this.frames.at(-1);
        if (frame?.kind === 'object' && frame.state === 'colon') {
          frame.state = 'value';
        }
        index++;
        continue;
      }
      if (character === ',') {
        const frame = this.frames.at(-1);
        if (frame?.kind === 'object' && frame.state === 'comma-or-end') {
          frame.state = 'key';
        } else if (
          frame?.kind === 'array'
          && frame.state === 'comma-or-end'
        ) {
          frame.state = 'value';
        }
        index++;
        continue;
      }
      this.startScalar();
      index++;
    }
  }

  endLine(): void {
    if (this.activeToken?.kind === 'scalar') {
      this.finishActiveValue();
    }
  }

  private expectsValue(): boolean {
    const frame = this.frames.at(-1);
    if (!frame) return this.rootState === 'value';
    if (frame.kind === 'object') return frame.state === 'value';
    return frame.state === 'value-or-end' || frame.state === 'value';
  }

  private countValue(): void {
    const depth = this.frames.length;
    if (depth > COMPANION_TRANSPORT_LIMITS.maxJsonDepth) {
      throw new Error(
        'MCP stdio JSON nesting depth exceeds '
        + `${COMPANION_TRANSPORT_LIMITS.maxJsonDepth} before parsing.`,
      );
    }
    this.valueCount++;
    if (
      this.valueCount
      > COMPANION_TRANSPORT_LIMITS.maxJsonValues
    ) {
      throw new Error(
        'MCP stdio JSON value count exceeds '
        + `${COMPANION_TRANSPORT_LIMITS.maxJsonValues} before parsing.`,
      );
    }
  }

  private startString(): void {
    const frame = this.frames.at(-1);
    if (
      frame?.kind === 'object'
      && (frame.state === 'key-or-end' || frame.state === 'key')
    ) {
      this.activeToken = {
        kind: 'string',
        role: 'key',
        escaped: false,
        completesParent: false,
      };
      return;
    }
    const completesParent = this.expectsValue();
    this.countValue();
    this.activeToken = {
      kind: 'string',
      role: 'value',
      escaped: false,
      completesParent,
    };
  }

  private scanStringCharacter(character: string): void {
    const token = this.activeToken;
    if (token?.kind !== 'string') return;
    if (token.escaped) {
      token.escaped = false;
      return;
    }
    if (character === '\\') {
      token.escaped = true;
      return;
    }
    if (character !== '"') return;
    this.activeToken = null;
    if (token.role === 'key') {
      const frame = this.frames.at(-1);
      if (frame?.kind === 'object') frame.state = 'colon';
      return;
    }
    if (token.completesParent) this.finishExpectedValue();
  }

  private startScalar(): void {
    const completesParent = this.expectsValue();
    this.countValue();
    this.activeToken = {
      kind: 'scalar',
      completesParent,
    };
  }

  private finishActiveValue(): void {
    const token = this.activeToken;
    this.activeToken = null;
    if (token?.kind === 'scalar' && token.completesParent) {
      this.finishExpectedValue();
    }
  }

  private startContainer(character: '{' | '['): void {
    const completesParent = this.expectsValue();
    this.countValue();
    this.frames.push(
      character === '{'
        ? {
          kind: 'object',
          state: 'key-or-end',
          completesParent,
        }
        : {
          kind: 'array',
          state: 'value-or-end',
          completesParent,
        },
    );
  }

  private finishContainer(character: '}' | ']'): void {
    const frame = this.frames.at(-1);
    if (
      !frame
      || (character === '}' && frame.kind !== 'object')
      || (character === ']' && frame.kind !== 'array')
    ) {
      return;
    }
    this.frames.pop();
    if (frame.completesParent) this.finishExpectedValue();
  }

  private finishExpectedValue(): void {
    const frame = this.frames.at(-1);
    if (!frame) {
      if (this.rootState === 'value') this.rootState = 'complete';
      return;
    }
    if (frame.kind === 'object') {
      if (frame.state === 'value') frame.state = 'comma-or-end';
      return;
    }
    if (frame.state === 'value-or-end' || frame.state === 'value') {
      frame.state = 'comma-or-end';
    }
  }
}

export class BoundedLineInput extends Transform {
  private readonly pending: Buffer;
  private pendingBytes = 0;
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private jsonScanner = new JsonResourceScanner();

  constructor(
    private readonly maximumLineBytes =
      COMPANION_TRANSPORT_LIMITS.maxStdioLineBytes,
  ) {
    super();
    if (
      !Number.isSafeInteger(maximumLineBytes)
      || maximumLineBytes < 1
    ) {
      throw new Error('The MCP stdio line budget must be a positive integer.');
    }
    // A fixed backing buffer bounds retained pre-newline heap independently
    // of how aggressively stdin is fragmented.
    this.pending = Buffer.allocUnsafe(maximumLineBytes);
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, encoding);
    let offset = 0;
    try {
      while (offset < buffer.byteLength) {
        const newline = buffer.indexOf(0x0a, offset);
        const end = newline === -1 ? buffer.byteLength : newline + 1;
        const segment = buffer.subarray(offset, end);
        if (
          this.pendingBytes + segment.byteLength
          > this.maximumLineBytes
        ) {
          throw new Error(
            `MCP stdio line exceeds ${this.maximumLineBytes} bytes.`,
          );
        }
        const jsonSegment = newline === -1
          ? segment
          : segment.subarray(0, segment.byteLength - 1);
        this.scanJsonBytes(jsonSegment);
        if (newline === -1) {
          if (segment.byteLength > 0) {
            segment.copy(this.pending, this.pendingBytes);
            this.pendingBytes += segment.byteLength;
          }
          break;
        }
        this.finishJsonLine();
        const line = this.pendingBytes === 0
          ? Buffer.from(segment)
          : Buffer.allocUnsafe(this.pendingBytes + segment.byteLength);
        if (this.pendingBytes > 0) {
          this.pending.copy(line, 0, 0, this.pendingBytes);
          segment.copy(line, this.pendingBytes);
        }
        this.pendingBytes = 0;
        this.push(line);
        offset = end;
      }
      callback();
    } catch (error) {
      this.pendingBytes = 0;
      this.resetJsonLine();
      callback(error instanceof Error ? error : new Error('Invalid MCP stdin.'));
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.pendingBytes === 0) {
      callback();
      return;
    }
    this.pendingBytes = 0;
    callback(new Error('MCP stdio ended with an incomplete JSON-RPC line.'));
  }

  private scanJsonBytes(bytes: Buffer): void {
    try {
      this.jsonScanner.write(this.decoder.decode(bytes, { stream: true }));
    } catch (error) {
      if (
        error instanceof Error
        && error.message.startsWith('MCP stdio JSON ')
      ) {
        throw error;
      }
      throw new Error('MCP stdio line is not valid UTF-8.', {
        cause: error,
      });
    }
  }

  private finishJsonLine(): void {
    try {
      this.jsonScanner.write(this.decoder.decode());
      this.jsonScanner.endLine();
    } catch (error) {
      if (
        error instanceof Error
        && error.message.startsWith('MCP stdio JSON ')
      ) {
        throw error;
      }
      throw new Error('MCP stdio line is not valid UTF-8.', {
        cause: error,
      });
    }
    this.resetJsonLine();
  }

  private resetJsonLine(): void {
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.jsonScanner = new JsonResourceScanner();
  }
}

export class BoundedLineOutput extends Writable {
  constructor(
    private readonly target: Writable,
    private readonly maximumLineBytes =
      COMPANION_TRANSPORT_LIMITS.maxStdioOutputLineBytes,
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, encoding);
    if (
      buffer.byteLength > this.maximumLineBytes
      || buffer.byteLength === 0
      || buffer[buffer.byteLength - 1] !== 0x0a
    ) {
      callback(new Error(
        `MCP stdout line exceeds ${this.maximumLineBytes} bytes or is unframed.`,
      ));
      return;
    }
    if (this.target.write(buffer)) callback();
    else this.target.once('drain', callback);
  }
}

export interface BoundedStdio {
  transport: StdioServerTransport;
  input: BoundedLineInput;
  output: BoundedLineOutput;
  detach(): void;
}

export function createBoundedStdio(
  source: Readable = process.stdin,
  target: Writable = process.stdout,
): BoundedStdio {
  const input = new BoundedLineInput();
  const output = new BoundedLineOutput(target);
  source.pipe(input);
  return {
    transport: new StdioServerTransport(input, output),
    input,
    output,
    detach: () => {
      source.unpipe(input);
      input.destroy();
      output.destroy();
    },
  };
}
