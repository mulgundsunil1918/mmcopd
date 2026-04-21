import { useState } from 'react';
import { HeartPulse, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await login(username, password);
      if (!ok) toast('Invalid credentials', 'error');
    } catch (err: any) {
      toast(err.message || 'Login failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #4f46e5 100%)' }}>
      <form onSubmit={submit} className="card p-8 w-full max-w-sm" style={{ backgroundColor: '#ffffff' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #6366f1)' }}>
            <HeartPulse className="w-7 h-7" />
          </div>
          <div>
            <div className="text-lg font-extrabold" style={{ color: '#0f172a' }}>CareDesk HMS</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Sign in to continue</div>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#475569' }}>Username</label>
            <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#475569' }}>Password</label>
            <input type="password" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary w-full mt-2" disabled={busy}>
            <LogIn className="w-4 h-4" /> {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
        <div className="text-[11px] mt-4 p-2 rounded-md" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
          Default admin: <code>admin</code> / <code>admin123</code> — change this immediately in Settings → Users.
        </div>
      </form>
    </div>
  );
}
