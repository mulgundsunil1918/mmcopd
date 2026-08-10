import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Loader2, Check, X, Clock } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { fmtDateTime } from '../lib/utils';
import { GrowthChartPrint } from '../components/peds/GrowthChartPrint';
import { GrowthChart as GrowthChartPlot } from '../components/peds/GrowthChart';
import { IapGrowthChart } from '../components/peds/IapGrowthChart';
import type { Sex } from '../lib/peds/growth';

/**
 * Reception's print-job inbox. Doctors "Send to Reception" a document (currently
 * growth charts); each lands here with a Print button that re-renders it on the
 * clinic letterhead. Marking printed clears it from the queue.
 */
export function PrintJobs() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [opened, setOpened] = useState<any | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['print-jobs'],
    queryFn: () => window.electronAPI.printJobs.list('pending'),
    refetchInterval: 20_000,
  });

  const markPrinted = async (job: any) => {
    const r = await window.electronAPI.printJobs.markPrinted(job.id, user?.username);
    if (r.ok) { toast('Marked printed', 'success'); qc.invalidateQueries({ queryKey: ['print-jobs'] }); setOpened(null); }
    else toast(r.error || 'Could not update', 'error');
  };
  const cancel = async (job: any) => {
    const r = await window.electronAPI.printJobs.cancel(job.id);
    if (r.ok) { toast('Removed', 'info'); qc.invalidateQueries({ queryKey: ['print-jobs'] }); }
    else toast(r.error || 'Could not remove', 'error');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Printer className="w-5 h-5 text-blue-500" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Print Jobs</h1>
        {jobs.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold">{jobs.length}</span>}
      </div>
      <p className="text-[12px] text-gray-500 dark:text-slate-400">Documents doctors have sent to reception to print. Open one, print it on the letterhead, then mark it printed.</p>

      {isLoading ? (
        <div className="card p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
      ) : jobs.length === 0 ? (
        <div className="card p-10 text-center">
          <Clock className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <div className="text-[13px] font-semibold text-gray-700 dark:text-slate-200">Nothing waiting to print</div>
          <div className="text-[11px] text-gray-500 mt-1">When a doctor sends a chart or document here, it shows up for you to print.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((j: any) => (
            <div key={j.id} className="card p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{j.title}</div>
                <div className="text-[11px] text-gray-500">{j.patient_name || '—'} · {j.kind} · {fmtDateTime(j.created_at)}{j.created_by ? ` · by ${j.created_by}` : ''}</div>
              </div>
              <div className="flex gap-1.5">
                <button className="btn-primary text-xs" onClick={() => setOpened(j)}><Printer className="w-3.5 h-3.5" /> Open &amp; print</button>
                <button className="btn-ghost text-xs" onClick={() => markPrinted(j)} title="Mark printed"><Check className="w-3.5 h-3.5" /></button>
                <button className="btn-ghost text-xs text-red-600" onClick={() => cancel(j)} title="Remove"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {opened && <PrintJobViewer job={opened} onClose={() => setOpened(null)} onPrinted={() => markPrinted(opened)} />}
    </div>
  );
}

/** Re-renders a job's document. Extend the switch as new job kinds are added. */
function PrintJobViewer({ job, onClose }: { job: any; onClose: () => void; onPrinted: () => void }) {
  let payload: any = {};
  try { payload = JSON.parse(job.payload_json || '{}'); } catch { payload = {}; }

  if (job.kind === 'growth') {
    const sex: Sex = payload?.patient?.gender === 'F' ? 'F' : 'M';
    const one = (chart: string, iapMetric: any, points: any[], key?: any) =>
      payload.standard === 'iap' && iapMetric
        ? <IapGrowthChart key={key} metric={iapMetric} sex={sex} points={points} />
        : <GrowthChartPlot key={key} chart={(chart as any) || 'wfa'} sex={sex} points={points} />;
    // "All charts" jobs carry every chart for the standard; render them on one sheet.
    const chartEl = payload.mode === 'all' && Array.isArray(payload.charts)
      ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {payload.charts
            .filter((ch: any) => (ch.points || []).length > 0)
            .map((ch: any, i: number) => one(ch.chart, ch.iapMetric, ch.points || [], i))}
        </div>
      : one(payload.chart, payload.iapMetric, payload.points || []);
    return (
      <GrowthChartPrint patient={payload.patient || {}} subtitle={payload.subtitle || 'Growth chart'} onClose={onClose}>
        {chartEl}
      </GrowthChartPrint>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="text-[13px] font-semibold mb-2">Can’t preview this job type ({job.kind})</div>
        <button className="btn-secondary text-xs" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
