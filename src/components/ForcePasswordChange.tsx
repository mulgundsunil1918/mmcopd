import { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export function ForcePasswordChange() {
  const { user, clearMustChangePassword } = useAuth();
  const toast = useToast();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (newPw !== confirmPw) { toast('Passwords do not match', 'error'); return; }
    if (!user) return;
    setBusy(true);
    try {
      await window.electronAPI.auth.changePassword(user.id, newPw);
      clearMustChangePassword();
      toast('Password updated — you are now logged in', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to update password', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)' }}>
      <form onSubmit={submit} className="card p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white bg-amber-500">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="text-base font-extrabold text-gray-900 dark:text-slate-100">Set a Secure Password</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">Required before continuing</div>
          </div>
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3 mb-5">
          You are logged in with the factory default password. Please set a unique password now — it cannot be skipped.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Password</label>
            <input
              type="password"
              className="input mt-1"
              placeholder="Min. 8 characters"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirm Password</label>
            <input
              type="password"
              className="input mt-1"
              placeholder="Repeat new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full mt-2" disabled={busy || !newPw || !confirmPw}>
            <KeyRound className="w-4 h-4" /> {busy ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
