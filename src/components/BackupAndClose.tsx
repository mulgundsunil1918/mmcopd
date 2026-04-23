import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CloudUpload, Power, FolderOpen, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from '../hooks/useToast';
import { fmtDateTime } from '../lib/utils';

export function BackupAndClose() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reminderShownAtRef = useRef<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => window.electronAPI.backup.status(),
    refetchInterval: 60_000,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  // Daily reminder at the configured time
  useEffect(() => {
    if (!settings?.backup_reminder_time) return;
    const tick = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayKey = now.toISOString().slice(0, 10) + '@' + settings.backup_reminder_time;
      if (hhmm === settings.backup_reminder_time && reminderShownAtRef.current !== todayKey) {
        reminderShownAtRef.current = todayKey;
        toast(`It's ${settings.backup_reminder_time} — time to back up & close.`, 'info');
        setOpen(true);
      }
    };
    const t = setInterval(tick, 30_000);
    tick();
    return () => clearInterval(t);
  }, [settings?.backup_reminder_time]);

  const backupAndQuit = useMutation({
    mutationFn: async () => {
      const r = await window.electronAPI.backup.quitAfter();
      return r;
    },
    onSuccess: () => { /* app is shutting down */ },
    onError: (e: any) => { toast(e.message || 'Backup failed — not closing', 'error'); setBusy(false); },
  });

  const lastAgeHours = status?.lastBackupAt
    ? (Date.now() - new Date(status.lastBackupAt).getTime()) / (1000 * 60 * 60)
    : Infinity;
  const today = new Date().toISOString().slice(0, 10);
  const backedUpToday = status?.lastBackupAt?.slice(0, 10) === today;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition shadow"
        style={{
          background: backedUpToday
            ? 'linear-gradient(135deg, #059669, #047857)'
            : 'linear-gradient(135deg, #ea580c, #c2410c)',
          color: '#ffffff',
        }}
        title={backedUpToday ? 'Backed up today' : 'Not backed up today!'}
      >
        <span className="flex items-center gap-1.5">
          {backedUpToday ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          Backup & Close
        </span>
        <Power className="w-3.5 h-3.5" />
      </button>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="End-of-day Backup" size="md">
        <div className="space-y-4">
          <div className="rounded-lg p-3" style={{ background: backedUpToday ? '#d1fae5' : '#ffedd5', color: '#0f172a' }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {backedUpToday ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <AlertTriangle className="w-4 h-4 text-orange-700" />}
              {backedUpToday ? 'Already backed up today' : 'No backup today yet'}
            </div>
            <div className="text-[11px] mt-1">
              {status?.lastBackupAt
                ? `Last backup: ${fmtDateTime(status.lastBackupAt)} (${Math.round(lastAgeHours)}h ago)`
                : 'No backups exist yet.'}
            </div>
            <div className="text-[11px] mt-0.5">Total backups kept: {status?.totalBackups ?? 0}</div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 text-xs">
            <div className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Backup folder</div>
            <div className="font-mono text-[11px] text-gray-600 dark:text-slate-300 break-all">
              {status?.dir || '—'}
            </div>
            <button
              type="button"
              className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 mt-2"
              onClick={() => window.electronAPI.backup.open()}
            >
              <FolderOpen className="w-3 h-3" /> Open folder
            </button>
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-2">
              Tip: install <b>Google Drive for Desktop</b> and point this folder at a Drive-synced folder. Backups upload to Drive automatically.
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Not now</button>
            <button
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow"
              style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}
              onClick={() => { setBusy(true); backupAndQuit.mutate(); }}
              disabled={busy}
            >
              <CloudUpload className="w-4 h-4" />
              {busy ? 'Backing up & closing…' : 'Backup now & close app'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
