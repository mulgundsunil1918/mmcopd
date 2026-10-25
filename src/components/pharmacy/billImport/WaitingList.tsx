/**
 * "Waiting to finish" — bills where some lines were set aside. The lines that were fine are already in stock; these are the rest, kept with the
 * bill's picture until the pharmacist can fill them in (a batch read off the pack, a medicine identified) or throws them away.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Pause, Trash2 } from 'lucide-react';
import { fmtDate } from '../../../lib/utils';
import { useToast } from '../../../hooks/useToast';
import type { WaitingRow } from '../../../lib/billImport';
import { Banner } from './ui';

export const WAITING_KEY = 'purchase-import-waiting';

export function WaitingList({ onFinish, onBack, finishing }: { onFinish: (row: WaitingRow) => void; onBack: () => void; finishing: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [sure, setSure] = useState<number | null>(null);
  const { data: rows = [], isLoading } = useQuery({ queryKey: [WAITING_KEY], queryFn: () => window.electronAPI.purchaseImport.waiting() });
  const discard = useMutation({
    mutationFn: (id: number) => window.electronAPI.purchaseImport.deleteWaiting(id),
    onSuccess: (r) => {
      setSure(null);
      qc.invalidateQueries({ queryKey: [WAITING_KEY] });
      toast(r.ok ? 'Thrown away. Those lines were never in your stock.' : 'That one was already gone.', r.ok ? 'success' : 'info');
    },
    onError: (e: any) => toast(String(e?.message || 'Could not throw it away'), 'error'),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-2"><Pause className="w-4 h-4" /> Waiting to finish</h3>
          <p className="text-xs text-gray-600 dark:text-slate-300 max-w-2xl">Lines you set aside while importing a bill. The rest of each bill is already in your stock; these are <b>not</b> — finish them when you have the answer (the batch off the pack, the right medicine), or throw them away.</p>
        </div>
        <button className="btn-secondary" onClick={onBack}>Import another bill</button>
      </div>

      {isLoading ? <div className="text-sm text-gray-500">Loading…</div> : rows.length === 0 ? (
        <Banner tone="green" title="Nothing is waiting">Every line of every imported bill has been dealt with.</Banner>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Invoice</th><th className="py-2">Supplier</th><th className="py-2">Bill date</th><th className="py-2 text-right">Lines waiting</th><th className="py-2">Set aside on</th><th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800 align-middle">
                <td className="py-2 font-mono text-xs">{r.invoice_number}{r.has_photo && <Camera className="inline w-3 h-3 ml-1.5 text-gray-400" aria-label="Has the bill picture" />}</td>
                <td className="py-2">{r.supplier_name || '—'}</td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{r.invoice_date ? fmtDate(r.invoice_date) : '—'}</td>
                <td className="py-2 text-right font-semibold">{r.line_count}</td>
                <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDate(r.created_at)}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  {sure === r.id ? (
                    <span className="inline-flex items-center gap-2 text-xs">
                      Throw away these {r.line_count} line{r.line_count === 1 ? '' : 's'}?
                      <button className="btn-danger text-xs px-2 py-1" disabled={discard.isPending} onClick={() => discard.mutate(r.id)}>Yes, throw away</button>
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => setSure(null)}>Keep</button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <button className="btn-primary text-xs px-3 py-1.5" disabled={finishing !== null} onClick={() => onFinish(r)}>
                        {finishing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Finish
                      </button>
                      <button className="btn-ghost text-xs px-2 py-1.5 text-red-600" title="Throw these lines away" onClick={() => setSure(r.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
