import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './hooks/useToast';
import { ThemeProvider } from './hooks/useTheme';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

// ─── Crash-visible diagnostics ────────────────────────────────────────────
// The packaged Electron app shows a blank white window when the renderer JS
// crashes during boot. These two handlers replace the empty #root with a
// red error card showing the actual exception + stack so it's never silent
// again. Cheap insurance — only activates if something genuinely breaks.
function showFatalError(label: string, err: any) {
  try {
    const root = document.getElementById('root');
    if (!root) return;
    const stack = err?.stack || err?.message || String(err || 'unknown error');
    root.innerHTML = `
      <div style="font-family: system-ui, -apple-system, sans-serif; padding: 32px; max-width: 900px; margin: 24px auto;">
        <div style="background: #fee2e2; border: 2px solid #dc2626; border-radius: 12px; padding: 24px; color: #7f1d1d;">
          <div style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">CureDesk failed to start</div>
          <div style="font-size: 13px; opacity: 0.9; margin-bottom: 12px;">${label}</div>
          <pre style="background: #fff; padding: 12px; border-radius: 6px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: #1f2937; max-height: 400px; overflow: auto;">${stack.replace(/[<>&]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c))}</pre>
          <div style="font-size: 11px; opacity: 0.7; margin-top: 12px;">
            Press <b>Ctrl+Shift+I</b> to open DevTools for full details. Send a screenshot of this whole window when reporting.
          </div>
        </div>
      </div>`;
  } catch { /* if even THIS fails, there's nothing more we can do */ }
}
window.addEventListener('error', (e) => showFatalError('Uncaught error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatalError('Unhandled promise rejection', e.reason));

// Globally disable mouse-wheel value changes on focused <input type="number">.
// Default browser behavior turns scroll-while-focused into ±1 stepper which has
// silently corrupted values (consultation fee, slot duration, drug stock) for
// receptionists. CSS already hides the spinner arrows; this kills the wheel too.
document.addEventListener('wheel', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t as HTMLInputElement).type === 'number' && document.activeElement === t) {
    (t as HTMLInputElement).blur();
  }
}, { passive: true });

try {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <HashRouter>
                <App />
              </HashRouter>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
} catch (err) {
  showFatalError('React mount failed', err);
}
