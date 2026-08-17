/**
 * "Forgot the password?" recovery — the customer-support unlock flow.
 *
 * Shown as a small link anywhere the app asks for a password (login, admin gate,
 * first-run password screens). It never reveals or bypasses anything on its own:
 * the clinic reads their **Machine ID** to CureDesk support over the phone, support
 * types it into the keygen tool and reads back a one-time **reset code** (an
 * Ed25519-signed, machine-bound, short-expiry token). The clinic pastes that code
 * here and sets a brand-new password. Because the code is signed with the vendor's
 * private key, only support can produce a working one — no self-reset, no backdoor.
 *
 * Self-contained (its own fixed overlay, no context needed) so it also works on
 * the pre-login screen, before any providers mount.
 */
import { useEffect, useState } from 'react';
import { KeyRound, Copy, Check, ShieldCheck, X, Phone, Loader2, Eye, EyeOff } from 'lucide-react';
import { copyText } from '../lib/clipboard';

function Dialog({ onClose }: { onClose: () => void }) {
  const [machineId, setMachineId] = useState('');
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [contactPhone, setContactPhone] = useState<string>('');

  useEffect(() => {
    (async () => {
      try { setMachineId(await window.electronAPI.license.machineId()); } catch { /* ignore */ }
      try {
        const st: any = await window.electronAPI.license.status();
        const p = st?.contact?.phone || st?.payload?.contact?.phone || '';
        if (p) setContactPhone(String(p));
      } catch { /* ignore */ }
    })();
  }, []);

  const doCopy = async () => {
    if (await copyText(machineId)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  const submit = async () => {
    setErr(null);
    if (!code.trim()) { setErr('Paste the reset code support gave you.'); return; }
    if (pw.length < 4) { setErr('Choose a new password (at least 4 characters).'); return; }
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return; }
    setBusy(true);
    try {
      const r = await window.electronAPI.auth.recoverWithCode(code.trim(), pw);
      if (r.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 2200);
      } else {
        setErr(r.error || 'Could not reset the password.');
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not reset the password.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100050] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.72)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6 relative text-left"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="w-5 h-5" />
        </button>

        {done ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
              <ShieldCheck className="w-7 h-7 text-emerald-600" />
            </div>
            <div className="text-base font-bold text-gray-900 dark:text-slate-100">Password reset</div>
            <p className="text-[13px] text-gray-600 dark:text-slate-300 mt-1">
              Sign in with your new password. Restarting the screen…
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-6 h-6 text-blue-600" />
              <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100">Forgot the password?</h1>
            </div>
            <p className="text-[13px] text-gray-600 dark:text-slate-300 leading-relaxed mb-4">
              For your clinic’s security, only CureDesk support can unlock this. It takes one phone call:
            </p>

            <ol className="text-[12.5px] text-gray-700 dark:text-slate-300 space-y-3">
              <li>
                <div className="font-semibold mb-1 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> 1. Call CureDesk support
                  {contactPhone && <span className="font-mono text-blue-700 dark:text-blue-300">· {contactPhone}</span>}
                </div>
                <div className="text-gray-500 dark:text-slate-400">Tell them you forgot the admin password and read out this Machine ID:</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 font-mono text-[12px] bg-gray-100 dark:bg-slate-800 rounded px-2 py-1.5 break-all select-all">
                    {machineId || '…'}
                  </code>
                  <button type="button" onClick={doCopy}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800">
                    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
              </li>

              <li>
                <div className="font-semibold mb-1">2. Paste the reset code they give you</div>
                <input className="input font-mono text-[12px]" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="Reset code from support" spellCheck={false} autoComplete="off" />
              </li>

              <li>
                <div className="font-semibold mb-1">3. Set a new password</div>
                <div className="relative mb-2">
                  <input className="input pr-9" type={show ? 'text' : 'password'} value={pw}
                    onChange={(e) => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" />
                  <button type="button" onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600" aria-label="Toggle visibility">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input className="input" type={show ? 'text' : 'password'} value={pw2}
                  onChange={(e) => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password"
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
                <div className="text-[11px] text-gray-400 mt-1">This becomes both the admin login and the admin unlock PIN.</div>
              </li>
            </ol>

            {err && <div className="text-[12px] text-red-600 dark:text-red-400 mt-3">{err}</div>}

            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={submit} disabled={busy || !code.trim() || !pw || !pw2}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Reset password
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Drop-in link that opens the recovery dialog. Place wherever a password is asked. */
export function ForgotPasswordLink({ className = '', label = 'Forgot the password?' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={className || 'text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold'}>
        {label}
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  );
}
