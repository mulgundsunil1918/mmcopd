/**
 * Full-screen "Can't reach the main computer" gate for CLIENT PCs.
 *
 * A client runs off the clinic's host PC over the LAN. If the host is switched
 * off or drops from the network, every data call fails — so instead of letting
 * the app hang with broken screens, we show a clear blocking overlay that keeps
 * auto-reconnecting (the WebSocket client retries every 5s) and offers a manual
 * "Retry now". It only ever appears in Client mode (that's the only mode whose
 * live status can be `disconnected`/`error`).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ServerCrash, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

export function HostOfflineOverlay({ offline }: { offline: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const { data: net } = useQuery({
    queryKey: ['network-status'],
    queryFn: () => window.electronAPI.network.status(),
    enabled: offline,
    refetchInterval: offline ? 4000 : false,
  });

  if (!offline) return null;

  const serverUrl = (net as any)?.client?.serverUrl || (net as any)?.serverUrl || '';

  const retry = async () => {
    setRetrying(true);
    try { await window.electronAPI.network.reconnect(); } catch { /* ignore */ }
    finally { setTimeout(() => setRetrying(false), 1500); }
  };

  return (
    <div
      className="no-print fixed inset-0 z-[100002] flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(160deg,#0f172a,#7f1d1d)' }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-7 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <ServerCrash className="w-7 h-7 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100 mb-2">Can't reach the main computer</h1>
        <p className="text-[13px] text-gray-600 dark:text-slate-300">
          This computer runs off your clinic's <b>main computer</b>, which looks <b>switched off or off the network</b> right now.
        </p>
        {serverUrl && <p className="text-[11px] font-mono text-gray-400 mt-2">{serverUrl}</p>}
        <div className="flex items-center justify-center gap-2 text-[13px] text-gray-500 dark:text-slate-400 my-5">
          <Loader2 className="w-4 h-4 animate-spin" /> Reconnecting automatically…
        </div>
        <button onClick={retry} disabled={retrying} className="btn-primary w-full justify-center">
          <RefreshCw className={cn('w-4 h-4', retrying && 'animate-spin')} /> {retrying ? 'Retrying…' : 'Retry now'}
        </button>
        <p className="text-[11px] text-gray-400 mt-4">
          Turn the main computer on and this reconnects on its own — your work resumes where you left off.
        </p>
      </div>
    </div>
  );
}
