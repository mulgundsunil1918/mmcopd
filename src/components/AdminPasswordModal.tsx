/**
 * "Type the admin password to delete this" — used for erasing a consultation, a visit or a bill.
 *
 * The password is sent with the delete itself and checked in the main process (a screen being "admin unlocked" is not trusted for
 * this), so a wrong one changes nothing. What is about to be erased is spelled out above the box, and the button stays off until
 * a password has been typed.
 */
import { useState } from 'react';
import { Loader2, Lock, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

export function AdminPasswordModal({ title, confirmLabel = 'Delete', onConfirm, onClose, children }: {
  title: string;
  confirmLabel?: string;
  /** Runs the delete with the typed password. `ok` closes the box; otherwise `error` is shown under the password field. */
  onConfirm: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await onConfirm(pw);
      if (r.ok) onClose();
      else { setErr(r.error || 'Could not delete.'); setPw(''); }
    } catch (e: any) { setErr(e?.message || 'Could not delete.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title={title} size="md">
      <div className="space-y-3">
        <div className="text-sm text-gray-900 dark:text-slate-100 space-y-1.5">{children}</div>
        <div>
          <label className="label flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Admin password</label>
          <input
            className="input" type="password" autoFocus autoComplete="off" value={pw} placeholder="Type the admin password to confirm"
            onChange={(e) => { setPw(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          />
          {err && <div className="text-[12px] text-red-600 dark:text-red-400 mt-1.5" role="alert">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-danger" onClick={go} disabled={!pw || busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
