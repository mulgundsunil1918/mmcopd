import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Eye, EyeOff } from 'lucide-react';

/**
 * First-run security gate. If the clinic is still on the factory admin password
 * (1234), block the app with a one-time "set your admin password" screen so no
 * install ever ships wide open. Skipped in Client mode — a cabin's admin
 * password lives on the host, not here — and never re-appears once a real
 * password is set. Fails open (renders nothing) if the check itself errors, so
 * a hiccup can never lock a clinic out of its own app.
 */
export function ForceAdminPasswordGate() {
  const [checked, setChecked] = useState(false);
  const [needed, setNeeded] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await window.electronAPI.settings.get();
        if ((s as any)?.network_mode === 'client') return; // host owns the admin password
        const isDefault = await window.electronAPI.admin.isDefaultAdminPassword();
        setNeeded(!!isDefault);
      } catch { /* fail open — never block on a check error */ }
      finally { setChecked(true); }
    })();
  }, []);

  if (!checked || !needed) return null;

  const strong = pw.length >= 8;
  const match = pw2.length > 0 && pw === pw2;

  const submit = async () => {
    setErr(null);
    if (!strong) { setErr('Use at least 8 characters.'); return; }
    if (!match) { setErr('The two passwords don’t match.'); return; }
    setBusy(true);
    try {
      const r = await window.electronAPI.admin.setInitialAdminPassword(pw);
      if (r.ok) setNeeded(false);
      else setErr(r.error || 'Could not set the password.');
    } catch (e: any) { setErr(e?.message || 'Failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-5"
      style={{ background: 'linear-gradient(160deg,#0f172a,#1e3a8a)' }}>
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100">Secure your clinic</h1>
        </div>
        <p className="text-[13px] text-gray-600 dark:text-slate-300 mb-4 leading-relaxed">
          This app is still on the default admin password. Set your own <b>admin password</b> now — it guards Settings,
          staff logins, billing tools and patient-data deletion.
        </p>

        <label className="label">New admin password</label>
        <div className="relative mb-2">
          <input className="input pr-9" type={show ? 'text' : 'password'} value={pw} autoFocus
            onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
          <button type="button" onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600" aria-label="Toggle visibility">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <label className="label">Confirm password</label>
        <input className="input mb-3" type={show ? 'text' : 'password'} value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Re-type it" />

        {err && <div className="text-[12px] text-red-600 dark:text-red-400 mb-2">{err}</div>}

        <button className="btn-primary w-full justify-center" disabled={busy || !strong || !match} onClick={submit}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Set admin password
        </button>

        <p className="text-[11px] text-gray-400 mt-3 text-center leading-relaxed">
          Change it later in Settings → Security. Keep it safe — a fully offline app has no “forgot password”.
        </p>
      </div>
    </div>
  );
}
