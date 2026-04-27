import { useQuery } from '@tanstack/react-query';
import { Calendar, Clock4, CheckCircle2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export function StatusBar() {
  const { data } = useQuery({
    queryKey: ['stats', 'today'],
    queryFn: () => window.electronAPI.stats.today(),
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const queueOn = settings?.queue_flow_enabled ?? false;

  return (
    <div className="statusbar px-6 py-2 flex items-center justify-between text-xs no-print">
      <div className="flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5" />
        <span>{format(new Date(), 'EEEE, do MMMM yyyy')}</span>
      </div>
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold">{data?.total ?? 0}</span> visits today
        </span>
        {queueOn && (
          <>
            <span className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
              <Clock4 className="w-3.5 h-3.5" /> {data?.waiting ?? 0} waiting
            </span>
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
              <Loader2 className="w-3.5 h-3.5" /> {data?.inprogress ?? 0} in progress
            </span>
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <CheckCircle2 className="w-3.5 h-3.5" /> {data?.done ?? 0} done
            </span>
          </>
        )}
      </div>
    </div>
  );
}
