import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Cable, CheckCircle2, Copy, Loader2, RefreshCw,
  Stethoscope, Unlink, Wifi, XCircle, HelpCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';

type DiagStep = { id: string; label: string; ok: boolean; detail: string; hint?: string; ms?: number };
type DiagReport = { ok: boolean; ranAt: string; target: string; steps: DiagStep[] };
type ConnState = 'idle' | 'connected' | 'degraded' | 'offline';

const STATE_UI: Record<ConnState, { label: string; dot: string; text: string; bg: string }> = {
  connected: { label: 'Connected',   dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800' },
  degraded:  { label: 'Unstable',    dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800' },
  offline:   { label: 'Disconnected',dot: 'bg-red-500',     text: 'text-red-700 dark:text-red-300',         bg: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800' },
  idle:      { label: 'Not connected',dot: 'bg-gray-400',   text: 'text-gray-600 dark:text-slate-400',      bg: 'bg-gray-50 dark:bg-slate-800/40 border-gray-200 dark:border-slate-700' },
};

export function NetworkTroubleshoot({ mode }: { mode: 'local' | 'server' | 'client' }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [report, setReport] = useState<DiagReport | null>(null);
  const [running, setRunning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [liveState, setLiveState] = useState<ConnState | null>(null);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['network-status-troubleshoot'],
    queryFn: () => window.electronAPI.network.status(),
    refetchInterval: 5_000,
  });

  const { data: ifaceInfo, refetch: refetchIfaces } = useQuery({
    queryKey: ['network-interfaces'],
    queryFn: () => window.electronAPI.network.interfaces(),
  });

  // Live push from the main process — updates the pill the instant the link
  // drops, rather than waiting for the 5s poll.
  useEffect(() => {
    if (typeof window.electronAPI.network.onState !== 'function') return;
    const off = window.electronAPI.network.onState((s: any) => {
      if (s?.state) setLiveState(s.state);
      qc.invalidateQueries({ queryKey: ['network-status-troubleshoot'] });
    });
    return () => { off?.(); };
  }, [qc]);

  const state: ConnState = (liveState ?? status?.client?.state ?? 'idle') as ConnState;
  const ui = STATE_UI[state] ?? STATE_UI.idle;
  const latency = status?.client?.latencyMs ?? null;
  const lastError = status?.client?.lastError ?? null;

  const runDiagnostics = async () => {
    setRunning(true);
    setReport(null);
    try {
      const r = await window.electronAPI.network.diagnose();
      setReport(r as DiagReport);
      if (r.ok) toast('All checks passed — the connection is healthy', 'success');
    } catch (e: any) {
      toast(e?.message || 'Diagnostics failed to run', 'error');
    } finally {
      setRunning(false);
    }
  };

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const r = await window.electronAPI.network.reconnect();
      if (r.ok) {
        toast(r.latencyMs != null ? `Reconnected (${r.latencyMs} ms)` : 'Reconnected', 'success');
      } else {
        toast(r.error || 'Still cannot reach the host PC', 'error');
      }
      await refetchStatus();
    } catch (e: any) {
      toast(e?.message || 'Reconnect failed', 'error');
    } finally {
      setReconnecting(false);
    }
  };

  const forget = async () => {
    try {
      await window.electronAPI.network.forget();
      toast('Server forgotten — this PC is back in Local mode. Re-pair with a fresh join code.', 'info');
      setConfirmForget(false);
      setReport(null);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await refetchStatus();
    } catch (e: any) {
      toast(e?.message || 'Could not reset the connection', 'error');
    }
  };

  const copyReport = async () => {
    const lines = [
      `CureDesk network report — ${new Date().toLocaleString()}`,
      `Mode: ${mode}   Target: ${report?.target || status?.serverUrl || '—'}`,
      `State: ${ui.label}${latency != null ? ` (${latency} ms)` : ''}`,
      lastError ? `Last error: ${lastError}` : '',
      '',
      'Adapters on this PC:',
      ...(ifaceInfo?.interfaces || []).map((i) => `  ${i.name} — ${i.address} (${i.kind})`),
      '',
      'Checks:',
      ...(report?.steps || []).map((s) => `  [${s.ok ? 'PASS' : 'FAIL'}] ${s.label} — ${s.detail}${s.hint ? `\n         Fix: ${s.hint}` : ''}`),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Report copied — paste it into WhatsApp or email for support', 'success');
    } catch {
      toast('Could not copy to clipboard', 'error');
    }
  };

  const pinInterface = async (ip: string) => {
    try {
      await window.electronAPI.settings.save({ network_bind_ip: ip } as any);
      await window.electronAPI.network.applyMode();
      await Promise.all([refetchIfaces(), refetchStatus()]);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast(ip ? `Host address pinned to ${ip}` : 'Back to automatic adapter selection', 'success');
    } catch (e: any) {
      toast(e?.message || 'Could not change the adapter', 'error');
    }
  };

  if (mode === 'local') return null;

  return (
    <div className="rounded-lg border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-blue-600" />
        <div className="text-sm font-bold text-gray-900 dark:text-slate-100">Connection &amp; Troubleshooting</div>
      </div>

      {/* ── Live status ─────────────────────────────────────────────────── */}
      {mode === 'client' && (
        <div className={cn('rounded-lg border-2 p-3', ui.bg)}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full', ui.dot, state === 'connected' && 'animate-pulse')} />
              <span className={cn('text-sm font-bold', ui.text)}>{ui.label}</span>
              {latency != null && state === 'connected' && (
                <span className="text-[11px] font-mono text-gray-600 dark:text-slate-400">{latency} ms</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-xs" onClick={reconnect} disabled={reconnecting}>
                {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {reconnecting ? 'Reconnecting…' : 'Reconnect now'}
              </button>
            </div>
          </div>
          <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-1.5 font-mono break-all">
            {status?.serverUrl || 'No host configured'}
          </div>
          {lastError && state !== 'connected' && (
            <div className="text-[11px] text-red-700 dark:text-red-300 mt-1.5">{lastError}</div>
          )}
          {state !== 'connected' && state !== 'idle' && (
            <div className="text-[11px] text-gray-700 dark:text-slate-300 mt-2 flex items-start gap-1.5">
              <Activity className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>Retrying automatically in the background. Your work is safe — this PC will reconnect on its own once the host is reachable.</span>
            </div>
          )}
        </div>
      )}

      {mode === 'server' && (
        <div className={cn(
          'rounded-lg border-2 p-3',
          status?.running ? STATE_UI.connected.bg : STATE_UI.offline.bg
        )}>
          <div className="flex items-center gap-2">
            <span className={cn('w-2.5 h-2.5 rounded-full', status?.running ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
            <span className={cn('text-sm font-bold', status?.running ? STATE_UI.connected.text : STATE_UI.offline.text)}>
              {status?.running ? `Hosting on port ${status.port}` : 'Server is NOT running'}
            </span>
          </div>
          <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-1.5">
            {status?.running
              ? `${status.clients} station${status.clients === 1 ? '' : 's'} connected · ${status.ipcChannels} channels exposed`
              : 'Other PCs cannot reach this host. Click Reconnect / restart CureDesk.'}
          </div>
          {!status?.running && (
            <button className="btn-ghost text-xs mt-2" onClick={reconnect} disabled={reconnecting}>
              {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Restart server
            </button>
          )}
        </div>
      )}

      {/* ── Adapter picker: wired vs Wi-Fi ──────────────────────────────── */}
      {mode === 'server' && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">
            Network adapter other PCs should use
          </div>
          <div className="space-y-1.5">
            {(ifaceInfo?.interfaces || []).map((i) => {
              const pinned = ifaceInfo?.pinned === i.address;
              const active = ifaceInfo?.active === i.address;
              return (
                <button
                  key={`${i.name}-${i.address}`}
                  type="button"
                  onClick={() => pinInterface(pinned ? '' : i.address)}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg border-2 p-2.5 text-left transition',
                    pinned
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-slate-700 hover:border-blue-400 bg-white dark:bg-slate-900'
                  )}
                >
                  {i.kind === 'wired'
                    ? <Cable className="w-4 h-4 text-emerald-600 shrink-0" />
                    : i.kind === 'wireless'
                      ? <Wifi className="w-4 h-4 text-blue-500 shrink-0" />
                      : <HelpCircle className="w-4 h-4 text-gray-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 font-mono">{i.address}</div>
                    <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
                      {i.name}
                      {i.kind === 'wired' && ' · wired LAN (most reliable)'}
                      {i.kind === 'wireless' && ' · Wi-Fi'}
                    </div>
                  </div>
                  {pinned && <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 shrink-0">PINNED</span>}
                  {!pinned && active && <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">IN USE</span>}
                </button>
              );
            })}
            {(ifaceInfo?.interfaces || []).length === 0 && (
              <div className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> No network adapter found — plug in the cable or join the Wi-Fi.
              </div>
            )}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1.5">
            Pin the <b>wired</b> adapter if this PC has both a cable and Wi-Fi — it stops the join code showing the wrong address.
            Click a pinned adapter again to go back to automatic.
          </div>
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button className="btn-primary text-xs" onClick={runDiagnostics} disabled={running}>
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stethoscope className="w-3.5 h-3.5" />}
          {running ? 'Checking…' : 'Run full diagnostics'}
        </button>
        {report && (
          <button className="btn-ghost text-xs" onClick={copyReport}>
            <Copy className="w-3.5 h-3.5" /> Copy report
          </button>
        )}
        {mode === 'client' && !confirmForget && (
          <button className="btn-ghost text-xs text-red-600 dark:text-red-400 ml-auto" onClick={() => setConfirmForget(true)}>
            <Unlink className="w-3.5 h-3.5" /> Forget this server
          </button>
        )}
      </div>

      {confirmForget && (
        <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20 p-3">
          <div className="text-[12px] font-semibold text-red-800 dark:text-red-200">Forget this server and go back to Local mode?</div>
          <div className="text-[11px] text-red-700 dark:text-red-300 mt-1">
            Clears the saved host address and access token on <b>this PC only</b>. No patient data is deleted —
            the records live on the host. You will need a fresh join code to reconnect.
          </div>
          <div className="flex gap-2 mt-2.5">
            <button className="btn-danger text-xs" onClick={forget}>Yes, forget &amp; go Local</button>
            <button className="btn-ghost text-xs" onClick={() => setConfirmForget(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Diagnostic results ──────────────────────────────────────────── */}
      {report && (
        <div className="space-y-1.5">
          <div className={cn(
            'text-[12px] font-bold flex items-center gap-1.5',
            report.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
          )}>
            {report.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {report.ok ? 'Everything checks out' : 'Found a problem — see the failing step below'}
          </div>
          {report.steps.map((s) => (
            <div
              key={s.id}
              className={cn(
                'rounded-lg border p-2.5',
                s.ok
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20'
              )}
            >
              <div className="flex items-start gap-2">
                {s.ok
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-px shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-600 mt-px shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100">
                    {s.label}
                    {s.ms != null && <span className="ml-1.5 text-[10px] font-mono font-normal text-gray-500">{s.ms} ms</span>}
                  </div>
                  <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5 break-words">{s.detail}</div>
                  {!s.ok && s.hint && (
                    <div className="text-[11px] text-red-800 dark:text-red-200 mt-1.5 bg-white/60 dark:bg-black/20 rounded p-2 border border-red-200 dark:border-red-900">
                      <b>How to fix:</b> {s.hint}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
