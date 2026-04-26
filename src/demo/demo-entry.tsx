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

// Install the mock on window before anything else runs.
(window as any).electronAPI = createMockElectronAPI();

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
