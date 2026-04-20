import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Phone, MapPin, Clock } from 'lucide-react';
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
