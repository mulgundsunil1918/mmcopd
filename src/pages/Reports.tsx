import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Database, FolderOpen, HardDriveDownload } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../hooks/useToast';
import { cn, fmtDate, fmtDateTime, formatINR, todayISO } from '../lib/utils';

type ReportKind = 'daily_collection' | 'doctor_performance' | 'top_diagnoses' | 'top_drugs' | 'new_patients';

const REPORTS: { kind: ReportKind; title: string; desc: string }[] = [
  { kind: 'daily_collection', title: 'Daily Collection', desc: 'Revenue per day split by Cash/Card/UPI' },
  { kind: 'doctor_performance', title: 'Doctor Performance', desc: 'Visits, unique patients, revenue per doctor' },
  { kind: 'top_diagnoses', title: 'Top Diagnoses', desc: 'Most frequent impressions entered by doctors' },
  { kind: 'top_drugs', title: 'Top Drugs Sold', desc: 'Pharmacy bestsellers by revenue' },
  { kind: 'new_patients', title: 'New Patients', desc: 'First-time registrations per day' },
];

export function Reports() {
  const [kind, setKind] = useState<ReportKind>('daily_collection');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayISO());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['report', kind, from, to],
    queryFn: () => window.electronAPI.reports.run({ kind, from, to }),
  });

  const columns = useMemo(() => rows.length ? Object.keys(rows[0]) : [], [rows]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const headers = columns.join(',');
    const lines = [headers, ...rows.map((r) => columns.map((c) => `"${String((r as any)[c] ?? '').replaceAll('"', '""')}"`).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Reports</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Pre-built reports + CSV export (open in Excel / Google Sheets).</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-gray-500">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-primary" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {REPORTS.map((r) => (
          <button
            key={r.kind}
            onClick={() => setKind(r.kind)}
            className={cn(
              'text-left rounded-lg p-3 border-2 transition',
              kind === r.kind
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300'
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <BarChart3 className={cn('w-3.5 h-3.5', kind === r.kind ? 'text-blue-600' : 'text-gray-500')} />
              {r.title}
            </div>
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{r.desc}</div>
          </button>
        ))}
      </div>

      <section className="card p-4">
        {isLoading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No data" description="Try a wider date range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  {columns.map((c) => <th key={c} className="py-2 px-2">{c.replace(/_/g, ' ')}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, idx: number) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-slate-800">
                    {columns.map((c) => (
                      <td key={c} className="py-1.5 px-2 text-gray-800 dark:text-slate-200">
                        {renderCell(c, row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BackupSection />
    </div>
  );
}

function renderCell(col: string, val: any) {
  if (val == null) return '—';
  if (col === 'day' && typeof val === 'string' && val.length >= 10) return fmtDate(val);
  if (typeof val === 'number' && (col.includes('revenue') || col.includes('cash') || col === 'card' || col === 'upi')) return formatINR(val);
  return String(val);
}

function BackupSection() {
  const toast = useToast();
  const { data: backups = [] } = useQuery({
    queryKey: ['backup-list'],
    queryFn: () => window.electronAPI.backup.list(),
    refetchInterval: 30_000,
  });
  const now = useMutation({
    mutationFn: () => window.electronAPI.backup.now(),
    onSuccess: (r) => toast(`Backup created — ${r.totalBackups} total`),
    onError: (e: any) => toast(e.message || 'Backup failed', 'error'),
  });
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Backups</h2>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => window.electronAPI.backup.open()}>
            <FolderOpen className="w-4 h-4" /> Open Folder
          </button>
          <button className="btn-primary" onClick={() => now.mutate()} disabled={now.isPending}>
            <HardDriveDownload className="w-4 h-4" /> {now.isPending ? 'Backing up…' : 'Backup Now'}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
        Auto-backup runs on every app launch (max 1/day) + hourly while running. Last 30 backups are kept. Destination: <code>Settings → Default Location → Backup Folder</code> (defaults to <code>userData/backups</code>).
      </p>
      {backups.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400">No backups yet. Click "Backup Now" to create the first one.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">File</th>
              <th className="py-2">Created</th>
              <th className="py-2 text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {backups.slice(0, 10).map((b) => (
              <tr key={b.name} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-1.5 font-mono text-xs">{b.name}</td>
                <td className="py-1.5 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(b.mtime)}</td>
                <td className="py-1.5 text-right text-xs">{Math.round(b.size / 1024)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
