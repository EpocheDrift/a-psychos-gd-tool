import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import type { PreviewResult } from '../render/preview';
import type { PublicPreviewHandle } from './contracts';
import { controllerFault } from './faults';

const DEFAULT_HANDLE_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_HANDLES = 4;
const DEFAULT_MAX_BYTES = DEFAULT_AGENT_LIMITS.maxPreviewBytes * 4;

type TimerHandle = ReturnType<typeof setTimeout>;

interface StoredPreview {
  handle: PublicPreviewHandle;
  bytes: ArrayBuffer;
  timer: TimerHandle;
}

export interface PreviewHandleVaultOptions {
  now?: () => number;
  randomId?: () => string;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  ttlMs?: number;
  maxHandles?: number;
  maxBytes?: number;
}

function randomHandleId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `preview_${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export class PreviewHandleVault {
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly ttlMs: number;
  private readonly maxHandles: number;
  private readonly maxBytes: number;
  private readonly handles = new Map<string, StoredPreview>();
  private totalBytes = 0;

  constructor(options: PreviewHandleVaultOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? randomHandleId;
    this.createObjectUrl = options.createObjectUrl
      ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl
      ?? ((url) => URL.revokeObjectURL(url));
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.ttlMs = options.ttlMs ?? DEFAULT_HANDLE_TTL_MS;
    this.maxHandles = options.maxHandles ?? DEFAULT_MAX_HANDLES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  store(result: PreviewResult, revision: number): PublicPreviewHandle {
    this.sweep();
    const bytes = result.image.bytes;
    if (
      !(bytes instanceof ArrayBuffer)
      || bytes.byteLength !== result.byteLength
      || bytes.byteLength > DEFAULT_AGENT_LIMITS.maxPreviewBytes
    ) {
      throw controllerFault(
        revision,
        'INTERNAL',
        'The preview encoder returned an invalid bounded binary result.',
        { recoverable: false },
      );
    }
    while (
      this.handles.size >= this.maxHandles
      || this.totalBytes + bytes.byteLength > this.maxBytes
    ) {
      const oldest = this.handles.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.remove(oldest);
    }
    if (
      this.handles.size >= this.maxHandles
      || this.totalBytes + bytes.byteLength > this.maxBytes
    ) {
      throw controllerFault(
        revision,
        'RESOURCE_LIMIT',
        'The session preview-handle budget is exhausted.',
        {
          details: {
            maximumHandles: this.maxHandles,
            maximumBytes: this.maxBytes,
          },
        },
      );
    }

    let handleId = this.randomId();
    for (let attempts = 0; this.handles.has(handleId) && attempts < 4; attempts++) {
      handleId = this.randomId();
    }
    if (this.handles.has(handleId)) {
      throw controllerFault(
        revision,
        'INTERNAL',
        'Preview handle allocation failed.',
        { recoverable: false },
      );
    }
    const copy = bytes.slice(0);
    const url = this.createObjectUrl(
      new Blob([copy], { type: result.mimeType }),
    );
    const expiresAtMs = this.now() + this.ttlMs;
    const handle: PublicPreviewHandle = {
      kind: 'browser-object-url-v1',
      handleId,
      url,
      mimeType: result.mimeType,
      byteLength: result.byteLength,
      contentHash: result.contentHash,
      trust: 'untrusted-document-render',
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    const timer = this.setTimer(
      () => this.remove(handleId),
      this.ttlMs,
    );
    this.handles.set(handleId, { handle, bytes: copy, timer });
    this.totalBytes += copy.byteLength;
    return { ...handle };
  }

  /**
   * Internal transport adapter only. It is intentionally absent from
   * AgentController and the browser global; PR6 can map it to MCP image
   * content without adding arbitrary URL or filesystem access.
   */
  resolveBytes(handleId: string): ArrayBuffer | null {
    this.sweep();
    const stored = this.handles.get(handleId);
    return stored ? stored.bytes.slice(0) : null;
  }

  remove(handleId: string): void {
    const stored = this.handles.get(handleId);
    if (!stored) return;
    this.handles.delete(handleId);
    this.clearTimer(stored.timer);
    this.totalBytes -= stored.bytes.byteLength;
    this.revokeObjectUrl(stored.handle.url);
  }

  clear(): void {
    for (const handleId of [...this.handles.keys()]) this.remove(handleId);
  }

  stats(): Readonly<{ handles: number; bytes: number }> {
    return Object.freeze({
      handles: this.handles.size,
      bytes: this.totalBytes,
    });
  }

  private sweep(): void {
    const now = this.now();
    for (const [handleId, stored] of this.handles) {
      if (Date.parse(stored.handle.expiresAt) <= now) this.remove(handleId);
    }
  }
}
