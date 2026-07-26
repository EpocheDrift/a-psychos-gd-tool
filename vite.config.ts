/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_HOST,
  AGENT_PORT,
  AGENT_SECURITY_HEADERS,
} from './packages/mcp-companion/src/agentSecurity';

export default defineConfig(({ command, isPreview, mode }) => {
  const agentMode = mode === 'agent';
  if (agentMode && command === 'serve' && !isPreview) {
    throw new Error(
      'Agent mode is available only as a built static artifact. '
      + 'Run `npm run dev:agent` or `npm run preview:agent` instead.',
    );
  }
  return {
    plugins: [react()],
    define: {
      __GFX_AGENT_BUILD__: JSON.stringify(agentMode),
      __GFX_AGENT_ALLOWED_ORIGIN__: JSON.stringify(
        agentMode ? AGENT_ALLOWED_ORIGIN : '',
      ),
    },
    // the trace worker dynamically imports Transformers.js, which needs an ESM
    // worker bundle (the default IIFE format can't code-split)
    worker: { format: 'es' },
    build: {
      outDir: agentMode ? 'dist-agent' : 'dist',
    },
    ...(agentMode
      ? {
          preview: {
            host: AGENT_HOST,
            port: AGENT_PORT,
            strictPort: true,
            allowedHosts: [AGENT_HOST],
            cors: false,
            headers: { ...AGENT_SECURITY_HEADERS },
          },
        }
      : {}),
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
