import { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Loader2, Copy, Clock, AlertTriangle, X } from 'lucide-react';

/**
 * Licence gate. Reads the main-process licence status and:
 *  - blocks with an **activation screen** when there's no / an invalid / a
 *    wrong-machine licence (shows the Machine ID to send to the vendor),
 *  - blocks with a **clock screen** if the system clock was rolled back,
 *  - shows a persistent **read-only banner** once locked (grace exhausted),
 *  - shows escalating **renewal reminders** at 30 / 7 / 1 days and during grace.
 * Dev builds and a healthy licence render nothing. Read-only itself is enforced
 * in the main process; this is the UI around it.
 */
export function LicenseGate() {
  const [st, setSt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    (window as any).electronAPI?.license?.status?.().then((s: any) => { if (alive) setSt(s); }).catch(() => {});
    const off = (window as any).electronAPI?.license?.onState?.((s: any) => setSt(s));
    return () => { alive = false; off?.(); };
  }, []);

  if (!st || st.state === 'dev') return null;
  if (st.needsActivation) return <ActivationScreen status={st} onActivated={setSt} />;
  if (st.state === 'clock_tampered') return <ClockScreen status={st} />;

  const c = st.contact || {};
  const contact = [c.phone && `📞 ${c.phone}`, c.email && `✉ ${c.email}`].filter(Boolean).join('   ·   ');

  if (st.readOnly) {
    return <Banner tone="red">🔒 Licence expired — the app is <b>read-only</b> (you can still view &amp; back up your data). Renew to unlock:&nbsp; {contact}</Banner>;
  }
  if (st.state === 'grace') {
    return <Banner tone="amber">⚠ Licence expired — <b>{st.graceDaysLeft} grace day{st.graceDaysLeft === 1 ? '' : 's'} left</b> before read-only. Renew now:&nbsp; {contact}</Banner>;
  }
  if (!dismissed && st.reminder && st.reminder !== 'none') {
    return (
      <Banner tone={st.reminder === '1d' ? 'amber' : 'blue'} onClose={() => setDismissed(true)}>
        🗓️ Your licence expires in <b>{st.daysLeft} day{st.daysLeft === 1 ? '' : 's'}</b>. Renew to avoid interruption:&nbsp; {contact}
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, children, onClose }: { tone: 'red' | 'amber' | 'blue'; children: React.ReactNode; onClose?: () => void }) {
  const bg = tone === 'red' ? 'bg-red-600' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-600';
  return (
    <div className={`no-print fixed top-0 left-0 right-0 z-[155] ${bg} text-white px-4 py-1.5 text-xs text-center font-semibold shadow flex items-center justify-center gap-3`}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} className="opacity-80 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
}

function ClockScreen({ status }: { status: any }) {
  return (
    <div className="fixed inset-0 z-[100001] flex items-center justify-center p-6 text-center" style={{ background: 'linear-gradient(160deg,#7f1d1d,#111827)' }}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6">
        <Clock className="w-9 h-9 text-red-600 mx-auto mb-2" />
        <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100 mb-2">Check the date &amp; time</h1>
        <p className="text-[13px] text-gray-600 dark:text-slate-300">{status.message || 'The system clock is set earlier than the last time the app ran. Set the correct date & time, then reopen the app.'}</p>
      </div>
    </div>
  );
}

function ActivationScreen({ status, onActivated }: { status: any; onActivated: (s: any) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const machineId = status.hardwareId || '';
  const c = status.contact || {};

  const copyId = async () => { try { await navigator.clipboard.writeText(machineId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  const activate = async () => {
    setErr(null);
    if (!token.trim()) { setErr('Paste the licence code you were sent.'); return; }
    setBusy(true);
    try {
      const r = await (window as any).electronAPI.license.activate(token.trim());
      if (r.ok) onActivated(r.status);
      else setErr(r.error || 'Activation failed.');
    } catch (e: any) { setErr(e?.message || 'Activation failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100001] flex items-center justify-center p-5 overflow-auto" style={{ background: 'linear-gradient(160deg,#0f172a,#1e3a8a)' }}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6 my-auto">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100">Activate CureDesk HMS</h1>
        </div>
        {status.state === 'wrong_machine'
          ? <p className="text-[13px] text-amber-700 dark:text-amber-300 mb-4">{status.message}</p>
          : <p className="text-[13px] text-gray-600 dark:text-slate-300 mb-4">Enter the licence code for this clinic to start. Don’t have one? Share the <b>Machine ID</b> below with us and we’ll send your licence.</p>}

        <label className="label">Your Machine ID <span className="font-normal text-gray-400">(send this to us)</span></label>
        <div className="flex gap-2 mb-3">
          <input className="input font-mono text-xs" readOnly value={machineId} />
          <button className="btn-secondary text-xs whitespace-nowrap" onClick={copyId}><Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
        </div>

        <label className="label">Licence code</label>
        <textarea className="input font-mono text-[11px] leading-tight" rows={4} value={token} placeholder="Paste the licence code you were sent…"
          onChange={(e) => setToken(e.target.value)} />
        {err && <div className="text-[12px] text-red-600 dark:text-red-400 mt-2">{err}</div>}

        <button className="btn-primary w-full justify-center mt-3" disabled={busy || !token.trim()} onClick={activate}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Activate
        </button>

        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700 text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Need a licence or help? {c.phone ? <b>📞 {c.phone}</b> : null} {c.email ? <>· <b>✉ {c.email}</b></> : null}</span>
        </div>
      </div>
    </div>
  );
}
