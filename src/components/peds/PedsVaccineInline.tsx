import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Syringe, Check, Loader2, Plus } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, fmtDate } from '../../lib/utils';

/**
 * Compact immunisation panel embedded in the consultation, so a pediatrician can
 * mark vaccines given without leaving the OPD screen. Shows due / overdue doses
 * first; each can be marked given (or undone). Full diary lives in Pediatrics.
 * Gating is the caller's job.
 */
export function PedsVaccineInline({ patientId }: { patientId: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['peds-vax', patientId],
    queryFn: () => window.electronAPI.peds.vaccineList(patientId),
  });

  const seed = async () => {
    const r = await window.electronAPI.peds.vaccineSeed(patientId);
    if (r.ok) { toast(`Built diary — ${r.added} vaccines`, 'success'); qc.invalidateQueries({ queryKey: ['peds-vax', patientId] }); }
    else toast(r.error || 'Could not build the diary', 'error');
  };
  const setStatus = async (rec: any, status: string, given_date: string | null) => {
    const r = await window.electronAPI.peds.vaccineUpdate(rec.id, { status, given_date, recorded_by: user?.username });
    if (r.ok) qc.invalidateQueries({ queryKey: ['peds-vax', patientId] });
    else toast(r.error || 'Could not update', 'error');
  };

  if (isLoading) return null;

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50/40 dark:bg-pink-900/10 p-3 flex items-center justify-between">
        <div className="text-[12px] text-gray-600 dark:text-slate-300 flex items-center gap-1.5"><Syringe className="w-4 h-4 text-pink-500" /> No immunisation diary for this child yet.</div>
        <button className="btn-secondary text-xs" onClick={seed}><Plus className="w-3.5 h-3.5" /> Build diary</button>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const pending = records.filter((r: any) => r.status !== 'given' && r.status !== 'skipped');
  const recentlyGiven = records.filter((r: any) => r.status === 'given').slice(0, 3);

  return (
    <div className="rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50/40 dark:bg-pink-900/10 p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-pink-700 dark:text-pink-300 flex items-center gap-1.5"><Syringe className="w-3.5 h-3.5" /> Immunisation</div>
      {pending.length === 0 ? (
        <div className="text-[12px] text-emerald-700 dark:text-emerald-300">All scheduled vaccines are up to date. 🎉</div>
      ) : (
        <div className="space-y-1">
          {pending.slice(0, 6).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-[12px]">
              <div className="min-w-0">
                <span className="font-medium text-gray-900 dark:text-slate-100">{r.vaccine}</span>
                {r.dose ? <span className="text-[10px] text-gray-400"> · {r.dose}</span> : null}
                <span className={cn('ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold', r.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{r.status}</span>
                {r.due_date && <span className="text-[10px] text-gray-400 ml-1">due {fmtDate(r.due_date)}</span>}
              </div>
              <button className="btn-primary text-xs !py-1" onClick={() => setStatus(r, 'given', today)}><Check className="w-3.5 h-3.5" /> Given</button>
            </div>
          ))}
          {pending.length > 6 && <div className="text-[10px] text-gray-400">+ {pending.length - 6} more in the full diary (Pediatrics)</div>}
        </div>
      )}
      {recentlyGiven.length > 0 && (
        <div className="text-[10px] text-gray-400 pt-1 border-t border-pink-100 dark:border-pink-900/40">
          Given: {recentlyGiven.map((r: any) => r.vaccine).join(', ')}
          {recentlyGiven[0] && <button className="ml-1 text-gray-500 hover:text-red-600 underline" onClick={() => setStatus(recentlyGiven[0], recentlyGiven[0].due_date && recentlyGiven[0].due_date < today ? 'overdue' : 'due', null)}>undo last</button>}
        </div>
      )}
    </div>
  );
}
