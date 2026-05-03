/**
 * Welcome wizard — shown on first launch (when network_mode hasn't been set
 * deliberately AND the user hasn't dismissed it). Two big paths:
 *
 *   1. "This is my clinic's main PC"  → flips Network Mode = Server, mints a
 *      join code, displays it big on screen for cabin PCs to type in.
 *   2. "Connect to existing clinic"   → auto-discovers servers on the LAN via
 *      UDP broadcast (or accepts a typed join code), pairs, saves config,
 *      reloads in Network = Client mode.
 *   3. "Use this PC alone (skip)"     → dismisses the wizard, network stays Local.
 *
 * The whole point: no IP / port / shared-secret typing for the user.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hospital, Wifi, Server, ArrowRight, Loader2, RefreshCw, X, Check, AlertTriangle } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';

type Step = 'pick' | 'host-name' | 'host-bootstrap' | 'host-show-code' | 'connect-discover' | 'connect-enter-code' | 'connect-name' | 'connect-success';

export function WelcomeWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<{ ip: string; port: number; version: string }[]>([]);
  const [pickedServer, setPickedServer] = useState<{ ip: string; port: number } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Station identity — what THIS PC is called in the clinic. Shown in sidebar
  // pill, audit logs, and (next session) the connected-clients list on the host.
  const [stationName, setStationName] = useState('');

  // ----- HOST PATH -----
  const becomeHost = async () => {
    setBusy(true);
    setError(null);
    try {
      // Switch to Server mode with default port; main process auto-mints secret + join code.
      await window.electronAPI.settings.save({
        network_mode: 'server',
        network_listen_port: 4321,
        station_name: stationName.trim() || 'Reception Desk',
      });
      try { localStorage.setItem('caredesk:network-mode', 'server'); } catch { /* ignore */ }
      await window.electronAPI.network.applyMode();
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['network-status'] });
      setStep('host-show-code');
    } catch (e: any) {
      setError(e?.message || 'Failed to start host');
    } finally {
      setBusy(false);
    }
  };

  // Live join-code refresh while on the host-show-code screen.
  const { data: joinCodeInfo, refetch: refetchJoin } = useQuery({
    queryKey: ['join-code'],
    queryFn: () => window.electronAPI.network.joinCode(),
    enabled: step === 'host-show-code',
    refetchInterval: 5_000,
  });

  // ----- CONNECT PATH -----
  const startDiscover = async () => {
    setStep('connect-discover');
    setBusy(true);
    setError(null);
    setDiscovered([]);
    try {
      const list = await window.electronAPI.network.discover({ timeoutMs: 4_500 });
      setDiscovered(list);
    } catch (e: any) {
      setError(e?.message || 'Discovery failed');
    } finally {
      setBusy(false);
    }
  };

  const pairAndConnect = async (server: { ip: string; port: number }, joinCode: string) => {
    setBusy(true);
    setError(null);
    try {
      const url = `http://${server.ip}:${server.port}`;
      const cleaned = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleaned.length !== 6) {
        setError('Join code must be 6 characters');
        setBusy(false);
        return;
      }
      const r = await window.electronAPI.network.pair({ url, code: cleaned });
      if (!r.ok) {
        setError(r.error || 'Pairing failed');
        setBusy(false);
        return;
      }
      // Save config so the renderer routes through this server next launch.
      await window.electronAPI.settings.save({
        network_mode: 'client',
        network_server_url: url,
        network_secret: r.secret,
      });
      try {
        localStorage.setItem('caredesk:network-mode', 'client');
        localStorage.setItem('caredesk:network-server-url', url);
        localStorage.setItem('caredesk:network-secret', r.secret);
      } catch { /* ignore */ }
      await window.electronAPI.network.applyMode();
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['network-status'] });
      // Ask for station name BEFORE finishing — so the cabin is identifiable
      // in the connected-clients list right away.
      setStep('connect-name');
    } catch (e: any) {
      setError(e?.message || 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    try { localStorage.setItem('caredesk:welcome-dismissed', '1'); } catch { /* ignore */ }
    onClose();
  };

  // Auto-discover on mount of the connect step (manual button still available).
  useEffect(() => { if (step === 'connect-discover' && discovered.length === 0 && !busy) startDiscover(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [step]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur p-6">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-auto p-8 relative">
        <button onClick={dismiss} className="absolute top-3 right-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500" title="Skip — use this PC alone">
          <X className="w-5 h-5" />
        </button>

        {step === 'pick' && (
          <PickStep
            onHost={() => setStep('host-name')}
            onConnect={() => setStep('connect-discover')}
            onSkip={dismiss}
          />
        )}

        {step === 'host-name' && (
          <NameStep
            kind="host"
            value={stationName}
            setValue={setStationName}
            placeholder="Reception Desk"
            onBack={() => setStep('pick')}
            onNext={() => { setStep('host-bootstrap'); becomeHost(); }}
          />
        )}

        {step === 'host-bootstrap' && (
          <div className="text-center py-12">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-blue-600 mb-4" />
            <div className="text-lg font-semibold text-gray-900 dark:text-slate-100">Setting up this PC as the clinic host…</div>
            <div className="text-xs text-gray-500 mt-1">Starting LAN server, generating join code, opening firewall.</div>
          </div>
        )}

        {step === 'host-show-code' && (
          <HostCodeStep
            joinCode={joinCodeInfo?.code || null}
            lanIp={joinCodeInfo?.lanIp || null}
            port={joinCodeInfo?.port || 4321}
            expiresAt={joinCodeInfo?.expiresAt || null}
            onRefresh={async () => { await window.electronAPI.network.regenJoinCode(); await refetchJoin(); toast('New join code minted'); }}
            onDone={dismiss}
          />
        )}

        {step === 'connect-discover' && (
          <ConnectDiscoverStep
            busy={busy}
            servers={discovered}
            error={error}
            onRescan={startDiscover}
            onPick={(s) => { setPickedServer(s); setStep('connect-enter-code'); }}
            onTypeManually={() => { setPickedServer(null); setStep('connect-enter-code'); }}
            onBack={() => setStep('pick')}
          />
        )}

        {step === 'connect-enter-code' && (
          <ConnectCodeStep
            initialServer={pickedServer}
            code={code}
            setCode={setCode}
            busy={busy}
            error={error}
            onConnect={(server) => pairAndConnect(server, code)}
            onBack={() => setStep('connect-discover')}
          />
        )}

        {step === 'connect-name' && (
          <NameStep
            kind="client"
            value={stationName}
            setValue={setStationName}
            placeholder="Cabin 1 — Dr. Patil"
            onBack={() => setStep('connect-enter-code')}
            onNext={async () => {
              try {
                await window.electronAPI.settings.save({ station_name: stationName.trim() || 'Cabin' });
                await qc.invalidateQueries({ queryKey: ['settings'] });
              } catch { /* non-fatal */ }
              setStep('connect-success');
            }}
          />
        )}

        {step === 'connect-success' && (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-300" strokeWidth={3} />
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-slate-100">Connected!</div>
            <div className="text-xs text-gray-500 mt-1 mb-6">This PC is now a CureDesk client. The renderer-side data routing ships in the next update — for now reload to see the connected status.</div>
            <button className="btn-primary" onClick={dismiss}>Continue</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PickStep({ onHost, onConnect, onSkip }: { onHost: () => void; onConnect: () => void; onSkip: () => void }) {
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow mb-3">
          <Hospital className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Welcome to CureDesk HMS</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">How is this PC going to be used in your clinic?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={onHost}
          className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/15 p-6 text-left hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition group"
        >
          <Server className="w-8 h-8 text-blue-600 mb-3 group-hover:scale-110 transition" />
          <div className="text-base font-bold text-blue-900 dark:text-blue-200">🏥 This is my clinic's main PC</div>
          <p className="text-[12px] text-blue-700 dark:text-blue-300 mt-1.5">All patient data lives here. Other doctor cabin PCs will connect to this one.</p>
          <div className="mt-3 inline-flex items-center gap-1 text-[12px] text-blue-700 dark:text-blue-400 font-semibold">
            Set up host <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          onClick={onConnect}
          className="rounded-xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/15 p-6 text-left hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition group"
        >
          <Wifi className="w-8 h-8 text-violet-600 mb-3 group-hover:scale-110 transition" />
          <div className="text-base font-bold text-violet-900 dark:text-violet-200">👤 Connect to existing clinic</div>
          <p className="text-[12px] text-violet-700 dark:text-violet-300 mt-1.5">There's already a CureDesk PC running in this clinic. Connect to it as a doctor / pharmacy / billing station.</p>
          <div className="mt-3 inline-flex items-center gap-1 text-[12px] text-violet-700 dark:text-violet-400 font-semibold">
            Find host PC <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>
      </div>

      <div className="mt-6 text-center">
        <button onClick={onSkip} className="text-[12px] text-gray-500 hover:text-gray-700 dark:hover:text-slate-300 underline">
          Or just use this PC alone (single-station mode)
        </button>
      </div>
    </div>
  );
}

function HostCodeStep({
  joinCode, lanIp, port, expiresAt, onRefresh, onDone,
}: {
  joinCode: string | null; lanIp: string | null; port: number; expiresAt: number | null;
  onRefresh: () => void; onDone: () => void;
}) {
  const remaining = useMemo(() => {
    if (!expiresAt) return null;
    const sec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}m ${s}s`;
  }, [expiresAt, joinCode]);

  const display = joinCode ? `${joinCode.slice(0, 4)}-${joinCode.slice(4)}` : '······';

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-300" strokeWidth={3} />
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Host is running</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
          Other CureDesk PCs in your clinic can now connect using this code:
        </p>
      </div>

      <div className="rounded-2xl border-4 border-blue-300 dark:border-blue-700 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-8 text-center mb-4">
        <div className="text-[10px] uppercase tracking-widest font-bold text-blue-900 dark:text-blue-200 mb-2">Join Code</div>
        <div className="text-6xl font-extrabold tracking-[0.3em] font-mono text-blue-900 dark:text-blue-100 mb-3">
          {display}
        </div>
        <div className="text-[12px] text-blue-700 dark:text-blue-300">
          {remaining ? `Valid for ${remaining}` : 'Code not minted yet'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px] text-gray-600 dark:text-slate-400 mb-4">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">This PC's IP</div>
          <div className="font-mono text-sm text-gray-900 dark:text-slate-100 mt-1">{lanIp || 'detecting…'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Listening on port</div>
          <div className="font-mono text-sm text-gray-900 dark:text-slate-100 mt-1">{port}</div>
        </div>
      </div>

      <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-3 text-[12px] text-amber-900 dark:text-amber-200 mb-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            If Windows asks <b>"Allow CureDesk HMS to communicate on networks?"</b>, click <b>Allow access</b>. This is one-time and only opens the LAN, not the internet.
          </div>
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <button className="btn-secondary text-xs" onClick={onRefresh}>
          <RefreshCw className="w-3.5 h-3.5" /> New code
        </button>
        <button className="btn-primary" onClick={onDone}>
          Done — start using CureDesk
        </button>
      </div>
    </div>
  );
}

function ConnectDiscoverStep({
  busy, servers, error, onRescan, onPick, onTypeManually, onBack,
}: {
  busy: boolean; servers: { ip: string; port: number; version: string }[]; error: string | null;
  onRescan: () => void; onPick: (s: { ip: string; port: number }) => void;
  onTypeManually: () => void; onBack: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Find your clinic's host PC</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
          Looking for CureDesk servers on this Wi-Fi / LAN…
        </p>
      </div>

      {busy && (
        <div className="text-center py-10 rounded-lg border-2 border-dashed border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/10">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-600 mb-2" />
          <div className="text-sm text-violet-900 dark:text-violet-200 font-semibold">Scanning the network…</div>
          <div className="text-[11px] text-violet-700 dark:text-violet-400 mt-1">Make sure both PCs are on the same Wi-Fi.</div>
        </div>
      )}

      {!busy && servers.length === 0 && (
        <div className="text-center py-10 rounded-lg border-2 border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
          <Wifi className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <div className="text-sm text-gray-700 dark:text-slate-300 font-semibold">No clinics found</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Make sure the host PC is running CureDesk and on the same Wi-Fi as this PC. Or click <b>Type code manually</b> if you already have a join code.
          </div>
        </div>
      )}

      {!busy && servers.length > 0 && (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={`${s.ip}:${s.port}`}>
              <button
                onClick={() => onPick(s)}
                className="w-full rounded-lg border-2 border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-900 p-3 text-left hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-violet-600" />
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">CureDesk HMS · v{s.version}</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400 font-mono">{s.ip}:{s.port}</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-violet-600" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-3 text-[12px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button className="btn-ghost text-xs" onClick={onBack}>← Back</button>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={onTypeManually}>Type code manually</button>
          <button className="btn-secondary text-xs" onClick={onRescan} disabled={busy}>
            <RefreshCw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} /> Rescan
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectCodeStep({
  initialServer, code, setCode, busy, error, onConnect, onBack,
}: {
  initialServer: { ip: string; port: number } | null;
  code: string; setCode: (s: string) => void;
  busy: boolean; error: string | null;
  onConnect: (server: { ip: string; port: number }) => void;
  onBack: () => void;
}) {
  const [manualIp, setManualIp] = useState(initialServer?.ip || '');
  const [manualPort, setManualPort] = useState(String(initialServer?.port || 4321));

  const submit = () => {
    const ip = (initialServer?.ip || manualIp).trim();
    const port = initialServer?.port || parseInt(manualPort, 10) || 4321;
    if (!ip) return;
    onConnect({ ip, port });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Enter the join code</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
          {initialServer
            ? <>Connecting to <span className="font-mono">{initialServer.ip}:{initialServer.port}</span></>
            : 'Type the host PC\'s IP address and the join code shown on its screen.'}
        </p>
      </div>

      {!initialServer && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="col-span-2">
            <label className="label">Host IP address</label>
            <input className="input font-mono" placeholder="192.168.1.100" value={manualIp} onChange={(e) => setManualIp(e.target.value)} />
          </div>
          <div>
            <label className="label">Port</label>
            <input className="input font-mono" placeholder="4321" value={manualPort} onChange={(e) => setManualPort(e.target.value)} />
          </div>
        </div>
      )}

      <label className="label">Join code</label>
      <input
        className="input font-mono text-2xl tracking-[0.3em] text-center uppercase"
        placeholder="XXXX-XX"
        maxLength={7} // 6 chars + 1 dash
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        autoFocus
      />
      <div className="text-[11px] text-gray-500 mt-1">Shown on the host PC's screen — 6 letters/digits.</div>

      {error && (
        <div className="mt-3 text-[12px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button className="btn-ghost text-xs" onClick={onBack} disabled={busy}>← Back</button>
        <button className="btn-primary" onClick={submit} disabled={busy || code.replace(/-/g, '').length !== 6}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</> : <>Connect <ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}

/** Step shown to both host + client: ask what THIS PC should be called.
 *  Defaults to a useful placeholder if the user just clicks Continue. */
function NameStep({
  kind, value, setValue, placeholder, onBack, onNext,
}: {
  kind: 'host' | 'client';
  value: string;
  setValue: (s: string) => void;
  placeholder: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const isHost = kind === 'host';
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">
          {isHost ? 'Name this main PC' : 'Name this station'}
        </h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
          {isHost
            ? 'A friendly label so cabin PCs and audit logs can identify the host. Defaults to "Reception Desk" if blank.'
            : 'Tell the clinic what to call this PC. Shown on the sidebar and in audit logs.'}
        </p>
      </div>

      <label className="label">{isHost ? 'Main PC name' : 'Station / room name'}</label>
      <input
        autoFocus
        className="input text-base"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onNext(); }}
      />
      {!isHost && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['Cabin 1', 'Cabin 2', 'Cabin 3', 'Pharmacy', 'Lab', 'Billing'].map((p) => (
            <button key={p} type="button" onClick={() => setValue(p)}
              className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-slate-700 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 text-gray-700 dark:text-slate-300">
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button className="btn-ghost text-xs" onClick={onBack}>← Back</button>
        <button className="btn-primary" onClick={onNext}>Continue <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
