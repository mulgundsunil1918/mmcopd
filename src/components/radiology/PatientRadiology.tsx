import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, Printer } from 'lucide-react';
import { RadiologyPrint } from './RadiologyPrint';
import { cn, fmtDate, formatINR } from '../../lib/utils';

const STATUS: Record<string, string> = {
  ordered: 'bg-blue-100 text-blue-700',
  done: 'bg-amber-100 text-amber-800',
  reported: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};
const LABEL: Record<string, string> = { ordered: 'Ordered', done: 'Scan done', reported: 'Reported', cancelled: 'Cancelled' };

/**
 * A patient's scans, on their record. Shown only when they have any — a patient who never had
 * an X-Ray should not carry an empty Radiology box. Each reported scan can print its report
 * from here without going to the Radiology desk.
 */
export function PatientRadiology({ patientId }: { patientId: number }) {
  const [printId, setPrintId] = useState<number | null>(null);
  const { data: orders = [] } = useQuery({
    queryKey: ['radiology-orders-patient', patientId, 'record'],
    queryFn: () => window.electronAPI.radiology.listOrders({ patient_id: patientId, limit: 50 }),
  });
  if (orders.length === 0) return null;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-sky-500" /> Radiology
        </h3>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">{orders.length} order{orders.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-slate-700 max-h-72 overflow-auto">
        {orders.map((o) => {
          const names = (o.test_names || '').split('\u001f').filter(Boolean);
          return (
            <li key={o.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                  {names[0]}{names.length > 1 ? ` +${names.length - 1} more` : ''}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  <span className="font-mono">{o.order_number}</span> · {fmtDate(o.ordered_at)}
                  {o.referred_by ? ` · Referral: ${o.referred_by}` : ''}
                  {o.bill_id && Number(o.bill_total) > 0 ? ` · ${formatINR(Number(o.bill_total))}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn('badge', STATUS[o.status] || 'bg-gray-100 text-gray-700')}>{LABEL[o.status] || o.status}</span>
                {o.status === 'reported' && (
                  <button className="btn-ghost text-xs" onClick={() => setPrintId(o.id)} title="Print the radiology report">
                    <Printer className="w-3.5 h-3.5" /> Report
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {printId !== null && <RadiologyPrint orderId={printId} onClose={() => setPrintId(null)} />}
    </div>
  );
}
