import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, Power, FolderOpen, AlertTriangle, CheckCircle2, HardDriveDownload, Usb, Cloud, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from '../hooks/useToast';
import { fmtDateTime } from '../lib/utils';

/** Shape of the verified-backup receipt returned by backup.now() / nowTo(). */
type BackupReceipt = {
  verified: boolean;
  integrityOk: boolean;
  mismatches: { table: string; live: number; backup: number | null }[];
  items: { label: string; count: number }[];
  totalRows: number;
  documentCount: number;
  dest: string;
};

export function BackupAndClose() {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [destChoice, setDestChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<BackupReceipt | null>(null);
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

  // Listen for the main-process close request + reminder ticks (daily and weekly-USB).
  useEffect(() => {
    const off1 = window.electronAPI.app.onCloseRequested(() => {
      toast('Backup before closing?', 'info');
      setOpen(true);
    });
    const off2 = window.electronAPI.app.onReminderTick(() => {
      toast('Daily backup reminder', 'info');
      setOpen(true);
    });
    const off3 = window.electronAPI.app.onUsbReminderTick(() => {
      toast('Weekly USB backup reminder — please plug in your USB drive', 'info');
      setOpen(true);
      setDestChoice(true);
    });
    return () => { off1?.(); off2?.(); off3?.(); };
  }, []);

  const backupAndQuit = useMutation({
    mutationFn: async () => window.electronAPI.backup.quitAfter(),
    onError: (e: any) => { toast(e.message || 'Backup failed — not closing', 'error'); setBusy(false); },
  });

  const closeWithoutBackup = async () => {
    setBusy(true);
    await window.electronAPI.app.forceQuit();
  };

  const lastAgeHours = status?.lastBackupAt
    ? (Date.now() - new Date(status.lastBackupAt).getTime()) / (1000 * 60 * 60)
    : Infinity;
  const today = new Date().toISOString().slice(0, 10);
  const backedUpToday = status?.lastBackupAt?.slice(0, 10) === today;

  const successMessage = (label: string, attachments: number) => {
    const extra = attachments > 0 ? ` + ${attachments} EMR attachment${attachments === 1 ? '' : 's'}` : '';
    return `${label} saved · full database${extra}`;
  };

  const backupGoogleDrive = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.backup.now();
      toast(successMessage('Google Drive backup', r.documentCount || 0),
        r.verified ? 'success' : 'error');
      qc.invalidateQueries({ queryKey: ['backup-status'] });
      setDestChoice(false);
      setOpen(false);
      setReceipt({
        verified: r.verified, integrityOk: r.integrityOk, mismatches: r.mismatches || [],
        items: r.receipt || [], totalRows: r.totalRows || 0, documentCount: r.documentCount || 0,
        dest: 'Google Drive folder',
      });
    } catch (e: any) {
      toast(e.message || 'Backup failed', 'error');
    } finally { setBusy(false); }
  };

  const backupUsb = async () => {
    const dir = await window.electronAPI.dialog.pickFolder({ title: 'Pick the USB drive folder for backup' });
    if (!dir) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.backup.nowTo(dir);
      if (r.ok) {
        toast(successMessage('USB backup', r.documentCount || 0),
          r.verified ? 'success' : 'error');
        qc.invalidateQueries({ queryKey: ['backup-status'] });
        setDestChoice(false);
        setOpen(false);
        setReceipt({
          verified: !!r.verified, integrityOk: !!r.integrityOk, mismatches: r.mismatches || [],
          items: r.receipt || [], totalRows: r.totalRows || 0, documentCount: r.documentCount || 0,
          dest: `USB drive (${dir})`,
        });
      } else {
        toast(r.error || 'USB backup failed', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'USB backup failed', 'error');
    } finally { setBusy(false); }
  };

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
          Backup
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
            <div className="font-semibold text-gray-900 dark:text-slate-100 mb-1">What gets backed up</div>
            <ul className="list-disc pl-4 text-gray-600 dark:text-slate-300 space-y-0.5">
              <li>Full database — patients, appointments, consultations, Rx, lab, pharmacy, IPD, bills, EMR, settings, users, audit log</li>
              <li>All uploaded documents (scans / reports / PDFs)</li>
              <li>Clinic logo + doctor signatures</li>
            </ul>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 text-xs">
            <div className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Configured Google Drive folder</div>
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
          </div>

          <div className="flex justify-between items-center gap-2 pt-1 flex-wrap">
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={closeWithoutBackup}
              disabled={busy}
              title="Close without making a backup"
            >
              Close without backup
            </button>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Not now</button>
              <button
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                onClick={() => setDestChoice(true)}
                disabled={busy}
              >
                <HardDriveDownload className="w-4 h-4" /> Backup Now
              </button>
              <button
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow"
                style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}
                onClick={() => { setBusy(true); backupAndQuit.mutate(); }}
                disabled={busy}
              >
                <CloudUpload className="w-4 h-4" />
                {busy ? 'Backing up & closing…' : 'Backup & Close App'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Destination chooser */}
      <Modal open={destChoice} onClose={() => !busy && setDestChoice(false)} title="Where do you want to back up?" size="md">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={backupGoogleDrive}
            className="rounded-xl border-2 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-5 text-left hover:border-blue-500 transition disabled:opacity-50"
          >
            <Cloud className="w-7 h-7 text-blue-600 mb-2" />
            <div className="text-sm font-bold text-blue-900 dark:text-blue-100">Google Drive (sync folder)</div>
            <div className="text-[11px] text-blue-700 dark:text-blue-300 mt-1">
              Writes to the folder configured in Settings → Backup. Google Drive Desktop syncs it to the cloud automatically.
            </div>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={backupUsb}
            className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 p-5 text-left hover:border-emerald-500 transition disabled:opacity-50"
          >
            <Usb className="w-7 h-7 text-emerald-600 mb-2" />
            <div className="text-sm font-bold text-emerald-900 dark:text-emerald-100">USB Drive (pick folder)</div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
              Opens a folder picker so you can choose your USB drive (e.g. <code>E:\</code>). Recommended weekly as physical backup.
            </div>
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button className="btn-secondary" onClick={() => setDestChoice(false)} disabled={busy}>Cancel</button>
        </div>
      </Modal>

      {/* Verified receipt — proves the backup is complete AND not corrupt. */}
      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title={receipt?.verified ? 'Backup complete & verified' : 'Backup finished — please read'}
        size="md"
      >
        {receipt && (
          <div className="space-y-4">
            <div
              className="rounded-lg p-3 flex items-start gap-3"
              style={{ background: receipt.verified ? '#d1fae5' : '#fee2e2', color: '#0f172a' }}
            >
              {receipt.verified
                ? <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                : <ShieldAlert className="w-6 h-6 text-red-700 shrink-0 mt-0.5" />}
              <div>
                <div className="text-sm font-bold">
                  {receipt.verified
                    ? '✅ Saved & verified — safe to rely on'
                    : '⚠️ Saved, but the check found a problem'}
                </div>
                <div className="text-[11px] mt-1 space-y-0.5">
                  <div>{receipt.integrityOk
                    ? 'Integrity check: passed (file is not corrupt).'
                    : 'Integrity check: FAILED — the copied file may be corrupt. Try backing up again to a different folder/USB.'}</div>
                  <div>{receipt.mismatches.length === 0
                    ? 'Row counts: every table matches the live data exactly.'
                    : `Row counts: ${receipt.mismatches.length} table(s) did not match — see below.`}</div>
                  <div className="font-semibold">Total records copied: {receipt.totalRows.toLocaleString()} + {receipt.documentCount} document file(s)</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-gray-900 dark:text-slate-100 bg-gray-50 dark:bg-slate-800/60">
                What was backed up to {receipt.dest}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {receipt.items.filter((i) => i.count > 0).map((i) => (
                  <div key={i.label} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                    <span className="text-gray-600 dark:text-slate-300">{i.label}</span>
                    <span className="font-mono font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{i.count.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-1.5 text-[12px]">
                  <span className="text-gray-600 dark:text-slate-300">Uploaded document files (scans / PDFs)</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{receipt.documentCount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {receipt.mismatches.length > 0 && (
              <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-[11px] text-red-800 dark:text-red-200">
                <div className="font-semibold mb-1">Tables that did not match (live → backup):</div>
                <ul className="list-disc pl-4 space-y-0.5 font-mono">
                  {receipt.mismatches.slice(0, 12).map((m) => (
                    <li key={m.table}>{m.table}: {m.live} → {m.backup === null ? 'missing' : m.backup}</li>
                  ))}
                </ul>
                <div className="mt-1">Please run the backup again. If it keeps failing, the destination disk/USB may be full or faulty.</div>
              </div>
            )}

            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setReceipt(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
