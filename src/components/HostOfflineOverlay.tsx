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

  /**
   * Diagnose the moment we go offline, without being asked.
   *
   * The diagnostics were already good enough to say exactly what was wrong —
   * "Port 4321 is open but CureDesk did not answer. Restart CureDesk on the
   * host PC." — but only if someone thought to open Settings and press a
   * button. During an actual outage the staff are looking at a blocked screen
   * with a spinner, not hunting through Settings, so the app sat on an answer
   * it already had.
   *
   * Running it here costs nothing (it only runs while blocked) and turns a
   * generic "can't reach the main computer" into the specific failing step and
   * its fix. Re-runs every 20s so the message tracks a changing situation —
   * host powered off, then booting, then app starting — rather than freezing
   * on the first verdict.
   */
  const { data: diag } = useQuery({
    queryKey: ['offline-diagnosis'],
    queryFn: () => window.electronAPI.network.diagnose(),
    enabled: offline,
    refetchInterval: offline ? 20_000 : false,
    retry: false,
  });

  if (!offline) return null;

  const serverUrl = (net as any)?.client?.serverUrl || (net as any)?.serverUrl || '';
  // The first failing step IS the diagnosis: steps run in dependency order, so
  // everything after the first failure is a consequence, not a separate cause.
  const culprit = diag?.steps?.find((s) => !s.ok);
  // How far it got before failing tells the user which machine to walk to.
  const lastOk = [...(diag?.steps || [])].filter((s) => s.ok).pop();

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

        {culprit ? (
          <>
            {/* The specific failure, in the words a person can act on. */}
            <p className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{culprit.label} — failed</p>
            {culprit.detail && (
              <p className="text-[12px] text-gray-500 dark:text-slate-400 mt-0.5">{culprit.detail}</p>
            )}
            {culprit.hint && (
              <div className="mt-3 rounded-lg px-3 py-2 text-left text-[12px] bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200">
                <b>What to do:</b> {culprit.hint}
              </div>
            )}
            {lastOk && (
              <p className="text-[11px] text-gray-400 mt-2">Last step that passed: {lastOk.label}</p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-gray-600 dark:text-slate-300">
            This computer runs off your clinic's <b>main computer</b>, which looks <b>switched off or off the network</b> right now.
            {!diag && <> Checking what went wrong…</>}
          </p>
        )}

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
