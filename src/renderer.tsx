import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './hooks/useToast';
import { ThemeProvider } from './hooks/useTheme';
import './index.css';

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
          <HashRouter>
            <App />
          </HashRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
