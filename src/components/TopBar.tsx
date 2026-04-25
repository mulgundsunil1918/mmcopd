import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Phone, MapPin, Clock, CloudUpload, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

export function TopBar() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: backupStatus } = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => window.electronAPI.backup.status(),
    refetchInterval: 120_000,
  });

  const backedUpToday = backupStatus?.lastBackupAt?.slice(0, 10) === new Date().toISOString().slice(0, 10);

  const backupLabel = (() => {
    if (!backupStatus?.lastBackupAt) return 'No backup yet';
    const last = new Date(backupStatus.lastBackupAt);
    const today = new Date();
    const sameDay = last.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
    if (sameDay) return `Backed up ${format(last, 'hh:mm a')}`;
    const days = Math.floor((today.getTime() - last.getTime()) / 86400000);
    if (days <= 0) return `Backed up ${format(last, 'hh:mm a')}`;
    return `Last backup ${days}d ago — ${format(last, 'dd MMM')}`;
  })();

  return (
    <header className="no-print border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3 flex items-center gap-4">
      {settings?.clinic_logo ? (
        <img
          src={settings.clinic_logo}
          alt="Logo"
          className="w-10 h-10 rounded-lg object-contain"
          style={{ background: '#ffffff' }}
        />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow">
          <HeartPulse className="w-5 h-5 text-white" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-base font-extrabold text-gray-900 dark:text-slate-100 leading-tight truncate">
          {settings?.clinic_name || 'Mulgund Multispeciality Clinic'}
        </div>
        {settings?.clinic_tagline && (
          <div className="text-[11px] italic text-gray-500 dark:text-slate-400 leading-tight truncate">
            {settings.clinic_tagline}
          </div>
        )}
      </div>

      <div className="hidden md:flex items-center gap-4 text-[11px] text-gray-600 dark:text-slate-300">
        {settings?.clinic_address && (
          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-blue-600" /> {settings.clinic_address}</span>
        )}
        {settings?.clinic_phone && (
          <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-blue-600" /> {settings.clinic_phone}</span>
        )}
      </div>

      {/* Backup status pill */}
      <div
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap"
        title={backupStatus?.lastBackupAt ? `Last backup ${format(new Date(backupStatus.lastBackupAt), 'dd MMM yyyy hh:mm a')}` : 'Never backed up'}
        style={
          backedUpToday
            ? { borderColor: '#86efac', backgroundColor: 'rgba(16,185,129,0.12)', color: '#047857' }
            : { borderColor: '#fdba74', backgroundColor: 'rgba(234,88,12,0.12)', color: '#c2410c' }
        }
      >
        {backedUpToday ? <CloudUpload className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {backupLabel}
      </div>

      {/* Live clock */}
      <div className="flex items-center gap-2 pl-4 border-l border-gray-200 dark:border-slate-700">
        <Clock className="w-4 h-4 text-emerald-600" />
        <div className="text-right leading-tight">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 tabular-nums">
            {format(now, 'hh:mm:ss a')}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-slate-400">
            {format(now, 'EEE, dd MMM yyyy')}
          </div>
        </div>
      </div>
    </header>
  );
}
