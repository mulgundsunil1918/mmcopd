import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 no-print">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg text-sm text-white min-w-[240px]',
              t.kind === 'success' && 'bg-green-600',
              t.kind === 'error' && 'bg-red-600',
              t.kind === 'info' && 'bg-blue-600'
            )}
          >
            {t.kind === 'success' && <CheckCircle2 className="w-4 h-4" />}
            {t.kind === 'error' && <XCircle className="w-4 h-4" />}
            {t.kind === 'info' && <Info className="w-4 h-4" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
