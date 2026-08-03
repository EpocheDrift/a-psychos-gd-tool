import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installBrowserAgentBridge } from './agent/browserBridge';
import './app.css';

if (__GFX_AGENT_BUILD__) {
  document.title = 'Graphic Design Workbench — Agent + Human';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Vite replaces this literal at build time. Keep the Agent entry as a static
// import: a dynamic bridge chunk would force Rollup to export bindings from
// the main chunk, including the Zustand store used by browser dependencies.
// The default production build dead-code-eliminates this branch and its
// otherwise unreachable Agent dependency graph.
if (__GFX_AGENT_BUILD__) {
  installBrowserAgentBridge();
}
