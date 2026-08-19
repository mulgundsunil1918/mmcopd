/**
 * First-run safety gate: make the clinic choose a REAL backup folder.
 *
 * With no folder set the app falls back to a folder inside its own app-data
 * directory — so a dead disk, a wiped profile or a reinstall takes the backups
 * with it. That is the one failure a clinic can never recover from, so this
 * blocks until a folder outside the app is chosen (a synced cloud folder is
 * best: the copy then lives on another machine too).
 *
 * Deliberately permissive, like the admin-password gate:
 *   - skipped in Client mode (the HOST owns backups),
 *   - fails open (renders nothing) if the check itself errors,
 *   - "Remind me later" defers for this session only, so a busy clinic is never
 *     locked out mid-consultation but is asked again next launch.
 */
import { useEffect, useState } from 'react';
import { HardDrive, Cloud, FolderOpen, Loader2, ShieldAlert } from 'lucide-react';

export function ForceBackupFolderGate() {
  const [checked, setChecked] = useState(false);
  const [needed, setNeeded] = useState(false);
  const [cloud, setCloud] = useState<{ provider: string; path: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Never nag on the public showcase — backups are meaningless there.
        if ((window as any).__CUREDESK_DEMO__) return;
        let snoozed = false;
        try { snoozed = sessionStorage.getItem('caredesk:backup-folder-snoozed') === '1'; } catch { /* ignore */ }
        if (snoozed) return;
        const s = await window.electronAPI.settings.get();
        if ((s as any)?.network_mode === 'client') return;     // host owns backups
        if (String((s as any)?.backup_folder || '').trim()) return;  // already set
        setNeeded(true);
        // Offer any detected Google Drive / OneDrive / Dropbox folder as one-click.
        try {
          const d = await window.electronAPI.backup.detectCloudFolders();
          if (d?.ok && Array.isArray(d.folders)) setCloud(d.folders);
        } catch { /* optional */ }
      } catch { /* fail open — never block on a check error */ }
      finally { setChecked(true); }
    })();
  }, []);

  if (!checked || !needed) return null;

  const useCloud = async (baseDir: string, provider: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await window.electronAPI.backup.useCloudFolder(baseDir, provider);
      if (r?.ok) setNeeded(false);
      else setErr(r?.error || 'Could not use that folder.');
    } catch (e: any) { setErr(e?.message || 'Failed.'); }
    finally { setBusy(false); }
  };

  const pick = async () => {
    setErr(null);
    try {
      const dir = await window.electronAPI.dialog.pickFolder({ title: 'Choose where CureDesk saves your backups' });
      if (!dir) return;
      setBusy(true);
      await window.electronAPI.settings.save({ backup_folder: dir } as any);
      setNeeded(false);
    } catch (e: any) { setErr(e?.message || 'Could not save that folder.'); }
    finally { setBusy(false); }
  };

  const snooze = () => {
    try { sessionStorage.setItem('caredesk:backup-folder-snoozed', '1'); } catch { /* ignore */ }
    setNeeded(false);
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-5"
      style={{ background: 'linear-gradient(160deg,#7c2d12,#0f172a)' }}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-6 h-6 text-orange-600" />
          <h1 className="text-lg font-extrabold text-gray-900 dark:text-slate-100">Where should your backups go?</h1>
        </div>
        <p className="text-[13px] text-gray-600 dark:text-slate-300 mb-4 leading-relaxed">
          CureDesk keeps all your patient records on <b>this computer</b>. Choose a backup folder now — ideally a
          <b> Google Drive / OneDrive folder</b>, so a copy also lives outside this PC. Without it, a disk failure
          or a reinstall would take your data <b>and</b> the backups with it.
        </p>

        {cloud.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Detected on this PC — recommended</div>
            {cloud.map((c) => (
              <button key={c.path} type="button" disabled={busy} onClick={() => useCloud(c.path, c.provider)}
                className="w-full text-left rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 hover:border-emerald-500 transition disabled:opacity-50">
                <div className="flex items-center gap-2 text-[13px] font-bold text-emerald-900 dark:text-emerald-100">
                  <Cloud className="w-4 h-4" /> Use {c.provider}
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono break-all mt-0.5">{c.path}</div>
              </button>
            ))}
          </div>
        )}

        <button type="button" disabled={busy} onClick={pick}
          className="w-full text-left rounded-xl border-2 border-gray-300 dark:border-slate-700 p-3 hover:border-blue-500 transition disabled:opacity-50">
          <div className="flex items-center gap-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">
            <FolderOpen className="w-4 h-4" /> Choose a folder myself
          </div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            An external / USB drive or any synced folder. Avoid a folder on this PC's main drive only.
          </div>
        </button>

        {err && <div className="text-[12px] text-red-600 dark:text-red-400 mt-3">{err}</div>}
        {busy && <div className="text-[12px] text-gray-500 mt-3 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</div>}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5" /> You can change this any time in Settings → System.
          </span>
          <button type="button" onClick={snooze} className="text-[11px] text-gray-500 hover:underline">Remind me later</button>
        </div>
      </div>
    </div>
  );
}
