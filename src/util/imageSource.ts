const EMBEDDED_IMAGE =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const BUNDLED_FACTORY_IMAGE = '/factory-image.jpg';

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw new DOMException('Image loading was aborted.', 'AbortError');
}

/**
 * Resolve a schema-approved image source without granting `fetch(data:)` or
 * arbitrary URL authority. PR7 replaces embedded bytes with isolated asset
 * handles; this keeps legacy documents working under the strict Agent CSP.
 */
export async function imageSourceBlob(
  source: string,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  const embedded = EMBEDDED_IMAGE.exec(source);
  if (embedded) {
    const payload = embedded[2];
    if (payload.length % 4 !== 0) {
      throw new Error('Embedded image data has invalid base64 padding.');
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    throwIfAborted(signal);
    return new Blob([bytes.buffer], { type: embedded[1] });
  }
  if (source !== BUNDLED_FACTORY_IMAGE) {
    throw new Error('Image source is outside the bundled/embedded allowlist.');
  }
  const response = await fetch(source, { signal });
  if (!response.ok) {
    throw new Error(`Bundled image request failed with HTTP ${response.status}.`);
  }
  throwIfAborted(signal);
  const blob = await response.blob();
  throwIfAborted(signal);
  return blob;
}
