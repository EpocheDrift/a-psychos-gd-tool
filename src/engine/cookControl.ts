export interface CookControl {
  revision?: number;
  signal?: AbortSignal;
  /** Absolute `performance.now()` deadline. */
  deadline?: number;
}

export class CookCancelledError extends Error {
  readonly code = 'RENDER_SUPERSEDED' as const;
  readonly recoverable = true;

  constructor(readonly revision?: number) {
    super(
      revision === undefined
        ? 'The cook was cancelled.'
        : `Render revision ${revision} was superseded.`,
    );
    this.name = 'CookCancelledError';
  }
}

export class CookDeadlineExceededError extends Error {
  readonly code = 'TIMEOUT' as const;
  readonly recoverable = true;

  constructor(readonly revision?: number) {
    super(
      revision === undefined
        ? 'The cook exceeded its deadline.'
        : `Render revision ${revision} exceeded its deadline.`,
    );
    this.name = 'CookDeadlineExceededError';
  }
}

export class CookResourceLimitError extends Error {
  readonly code = 'RESOURCE_LIMIT' as const;
  readonly recoverable = true;

  constructor(message: string, readonly details?: Record<string, number>) {
    super(message);
    this.name = 'CookResourceLimitError';
  }
}

export class GpuDeviceLostError extends Error {
  readonly code = 'RENDER_FAILED' as const;
  readonly recoverable = true;
  readonly phase = 'gpu' as const;
  readonly details = { kind: 'gpu-device-lost' } as const;

  constructor(message = 'The WebGPU device was lost.') {
    super(message);
    this.name = 'GpuDeviceLostError';
  }
}

export function cookInterruptReason(control: CookControl): Error | null {
  if (control.signal?.aborted) {
    return control.signal.reason instanceof Error
      ? control.signal.reason
      : new CookCancelledError(control.revision);
  }
  if (
    typeof control.deadline === 'number'
    && Number.isFinite(control.deadline)
    && performance.now() >= control.deadline
  ) {
    return new CookDeadlineExceededError(control.revision);
  }
  return null;
}

export function throwIfCookInterrupted(control: CookControl): void {
  const reason = cookInterruptReason(control);
  if (reason) throw reason;
}

export function remainingCookMs(control: CookControl): number | null {
  if (typeof control.deadline !== 'number' || !Number.isFinite(control.deadline)) {
    return null;
  }
  return Math.max(0, control.deadline - performance.now());
}

/**
 * Race a browser primitive that cannot directly accept an AbortSignal.
 * `onInterrupt` must make the underlying operation release/reject safely.
 */
export function waitForCookControl<T>(
  promise: Promise<T>,
  control: CookControl,
  onInterrupt?: (reason: Error) => void,
): Promise<T> {
  const immediate = cookInterruptReason(control);
  if (immediate) {
    onInterrupt?.(immediate);
    return Promise.reject(immediate);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      control.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const interrupt = (reason: Error): void => {
      finish(() => {
        try {
          onInterrupt?.(reason);
        } finally {
          reject(reason);
        }
      });
    };
    const onAbort = (): void => {
      interrupt(
        control.signal?.reason instanceof Error
          ? control.signal.reason
          : new CookCancelledError(control.revision),
      );
    };

    control.signal?.addEventListener('abort', onAbort, { once: true });
    const remaining = remainingCookMs(control);
    if (remaining !== null) {
      timer = setTimeout(
        () => interrupt(new CookDeadlineExceededError(control.revision)),
        remaining,
      );
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
