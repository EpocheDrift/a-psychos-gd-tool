export const AGENT_HOST = '127.0.0.1';
export const AGENT_PORT = 5199;
export const AGENT_ALLOWED_ORIGIN = `http://${AGENT_HOST}:${AGENT_PORT}`;
export const AGENT_EXPECTED_HOST = `${AGENT_HOST}:${AGENT_PORT}`;
export const AGENT_COMPANION_META_NAME = 'gfx-agent-companion';
export const AGENT_COMPANION_META_VALUE = 'local-v1';
export const AGENT_COMPANION_CONTROL_META_NAME = 'gfx-agent-control-mode';
export const AGENT_COMPANION_CONTROL_MODE_INTERACTIVE = 'interactive-v1';
export const AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL = 'trusted-local-v1';
export type AgentCompanionControlMode =
  | typeof AGENT_COMPANION_CONTROL_MODE_INTERACTIVE
  | typeof AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL;
export const AGENT_HEALTH_PATH = '/healthz';
export const AGENT_WEBSOCKET_PATH = '/__gfx_agent_bridge_v1';
// The fixed companion origin is plain loopback HTTP. Do not use a __Host- or
// __Secure- prefix: those require a Secure cookie and would not be portable
// over this intentionally local, non-TLS origin.
export const AGENT_COOKIE_NAME = 'gfx_agent_bootstrap';
export const AGENT_WEBSOCKET_PROTOCOL = 'gfx-agent-bridge-v1';

export const AGENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'none'",
  "style-src-elem 'self'",
  // ReactFlow and the app use audited style attributes for geometry.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 'self' covers the same-origin WebSocket in current browsers; spelling the
  // exact endpoint out keeps the intended companion authority auditable.
  `connect-src 'self' blob: ws://${AGENT_HOST}:${AGENT_PORT}`,
  "worker-src 'self' blob:",
  "media-src 'none'",
  "manifest-src 'self'",
].join('; ');

export const AGENT_SECURITY_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    'Content-Security-Policy': AGENT_CONTENT_SECURITY_POLICY,
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'serial=()',
      'bluetooth=()',
      'display-capture=()',
      'local-fonts=()',
      'clipboard-read=()',
      'clipboard-write=()',
    ].join(', '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
