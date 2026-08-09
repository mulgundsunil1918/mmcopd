/**
 * Entry point for the GitHub Pages showcase build.
 *
 * Runs BEFORE any React code: installs the mocked electronAPI on
 * window.electronAPI so every existing component / hook / page
 * (which calls window.electronAPI.*) sees the demo dataset instead
 * of crashing with 'Cannot read properties of undefined'.
 *
 * Then mounts the same React tree the Electron renderer uses.
 */

import { createMockElectronAPI } from './mock-api';

/**
 * Wrap the hand-written mock so any domain/method it doesn't define resolves to
 * a safe empty value ([] or { ok: true }) instead of crashing. This lets the
 * showcase render newer screens (IPD, billing, pediatrics, TPA) that the mock
 * dataset doesn't cover — and, used as a QA harness, surfaces any screen that
 * mishandles empty/undefined data.
 */
function safeFill(api: any): any {
  const fallbackFn = () => Promise.resolve([] as any);
  const wrapDomain = (domain: any) => new Proxy(domain ?? {}, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      if (typeof prop === 'string') {
        // Mutations → { ok: true }; single-object reads → {}; everything else
        // (list-style reads) → [] so a render that maps the result never
        // crashes in the showcase.
        const isMutation = /^(save|add|update|delete|remove|set|create|give|pay|refund|seed|reject|approve|transfer|discharge|admit|request|stop|respond)/.test(prop) || /Save$|Add$|Update$|Delete$|Status$/.test(prop);
        const isObject = /^(get|preview|status|config|health|info|joinCode|previewById|previewAdmission)/.test(prop) || /Config$|Status$|By[A-Z]/.test(prop);
        return (..._args: any[]) => Promise.resolve(isMutation ? { ok: true } : isObject ? {} : []);
      }
      return fallbackFn;
    },
  });
  return new Proxy(api, {
    get(target, prop) {
      const v = (target as any)[prop];
      if (v && typeof v === 'object') return wrapDomain(v);
      if (v === undefined && typeof prop === 'string') return wrapDomain({});
      return v;
    },
  });
}

// Install the mock on window before anything else runs.
(window as any).electronAPI = safeFill(createMockElectronAPI());

// Now the normal app boot sequence — same as src/renderer.tsx.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { ToastProvider } from '../hooks/useToast';
import { ThemeProvider } from '../hooks/useTheme';
import { AuthProvider } from '../hooks/useAuth';
import { DemoBanner } from './DemoBanner';
import '../index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

// Match the Electron renderer: blur number inputs on wheel so scrolling never
// corrupts a focused fee/quantity field.
document.addEventListener('wheel', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t as HTMLInputElement).type === 'number' && document.activeElement === t) {
    (t as HTMLInputElement).blur();
  }
}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <HashRouter>
              <DemoBanner />
              <App />
            </HashRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
