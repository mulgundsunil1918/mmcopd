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
