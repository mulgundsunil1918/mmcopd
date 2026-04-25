import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export function AdminGate({ children, title = 'Administrator area' }: { children: React.ReactNode; title?: string }) {
  const { adminUnlocked, unlockAdmin } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Only show the "default is 1918" hint while the admin still has the factory password.
  const { data: isDefault = false } = useQuery({
    queryKey: ['is-default-admin-password'],
    queryFn: () =>
      typeof window.electronAPI.admin.isDefaultAdminPassword === 'function'
        ? window.electronAPI.admin.isDefaultAdminPassword()
        : Promise.resolve(true),
  });

  if (adminUnlocked) return <>{children}</>;

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      const ok = await unlockAdmin(password);
      if (!ok) toast('Wrong admin password', 'error');
      setPassword('');
    } catch (err: any) {
      toast(err.message || 'Unlock failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <form onSubmit={submit} className="card max-w-md mx-auto mt-12 p-8 text-center">
        <div
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-base font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 mb-6">
          Enter the admin password to unlock clinic-wide settings, user management, and destructive operations.
        </p>
        <div>
          <input
            type="password"
            autoFocus
            className="input text-center tracking-widest"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !password}
          className="btn-primary w-full mt-4"
        >
          <Lock className="w-4 h-4" /> {busy ? 'Verifying…' : 'Unlock Admin'}
        </button>
        {isDefault ? (
          <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded p-2 mt-4">
            🔐 First-time setup: default password is <code className="font-mono font-bold">1918</code>.
            <br />Please change it under <b>Users → Admin Password</b> as soon as you log in.
          </div>
        ) : (
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-4">
            Forgot it? Reset from <b>Users & Access → Admin Password</b> when signed in as admin.
          </div>
        )}
      </form>
    </div>
  );
}
