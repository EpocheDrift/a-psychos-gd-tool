export const AGENT_HOST = '127.0.0.1';
export const AGENT_PORT = 5199;
export const AGENT_ALLOWED_ORIGIN = `http://${AGENT_HOST}:${AGENT_PORT}`;

export const AGENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'none'",
  "style-src-elem 'self'",
  // ReactFlow and the app use audited style attributes for geometry.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob:",
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
