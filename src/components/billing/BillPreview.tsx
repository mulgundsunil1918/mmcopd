import { useQuery } from '@tanstack/react-query';
import { Loader2, IndianRupee, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Live "what's the bill till now" for an admission — the running IPD bill.
 * Charges are colour-coded by category so staff can see where the money is going.
 */
const CATEGORY_COLOUR: Record<string, string> = {
  doctor: '#7c3aed', bed: '#2563eb', nursing: '#0d9488', procedure: '#db2777',
  lab: '#d97706', pharmacy: '#059669', other: '#64748b',
};

function rupee(n: number): string {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BillPreview({ admissionId, compact }: { admissionId: number; compact?: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bill-preview', admissionId],
    queryFn: () => window.electronAPI.billing.previewAdmission(admissionId),
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="card p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>;

  if (error || (data && data.ok === false)) {
    return (
      <div className="card p-4 border-2 border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-[13px] font-semibold">
          <AlertCircle className="w-4 h-4" /> Could not load the bill
        </div>
        <div className="text-[12px] text-red-600 dark:text-red-400 mt-1">
          {(data as any)?.error || (error as any)?.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  const { items = [], totals, advanceAvailable = 0, amountPaid = 0, balanceDue = 0 } = data || {};

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
          <IndianRupee className="w-4 h-4 text-blue-600" /> Bill so far
        </div>
        <div className="text-[10px] text-gray-500">{totals?.isTaxInvoice ? 'Tax Invoice' : 'Bill of Supply'}</div>
      </div>

      {items.length === 0 ? (
        <div className="text-[12px] text-gray-400 text-center py-4">Nothing charged yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b dark:border-slate-700">
                <th className="py-1.5"></th><th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Rate</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} className="border-b border-gray-50 dark:border-slate-800/50">
                  <td className="py-1.5 w-2">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: it.colour || CATEGORY_COLOUR[it.category] || '#94a3b8' }} />
                  </td>
                  <td className="py-1.5">
                    <div className="text-gray-900 dark:text-slate-100">{it.description}</div>
                    {it.is_taxable ? <div className="text-[9px] text-gray-400">GST {it.gst_rate}%{it.hsn_sac ? ` · HSN ${it.hsn_sac}` : ''}</div> : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{it.qty}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupee(it.rate)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{rupee(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totals && (
        <div className="space-y-1 pt-2 border-t dark:border-slate-700 text-[12px]">
          <Row label="Subtotal" value={rupee(totals.subtotal)} />
          {totals.discountValue > 0 && <Row label="Discount" value={'− ' + rupee(totals.discountValue)} muted />}
          {totals.exemptTotal > 0 && <Row label="Exempt (clinical services)" value={rupee(totals.exemptTotal)} muted />}
          {totals.taxableTotal > 0 && <Row label="Taxable value" value={rupee(totals.taxableTotal)} muted />}
          {totals.cgstTotal > 0 && <Row label="CGST" value={rupee(totals.cgstTotal)} muted />}
          {totals.sgstTotal > 0 && <Row label="SGST" value={rupee(totals.sgstTotal)} muted />}
          {totals.roundOff !== 0 && <Row label="Round off" value={rupee(totals.roundOff)} muted />}
          <Row label="Total" value={rupee(totals.total)} bold />
          {!compact && (
            <>
              {advanceAvailable > 0 && <Row label="Advance available" value={rupee(advanceAvailable)} muted />}
              {amountPaid > 0 && <Row label="Paid" value={rupee(amountPaid)} muted />}
              <Row label="Balance due" value={rupee(balanceDue)} bold
                className={balanceDue > 0 ? 'text-red-600' : 'text-emerald-600'} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, muted, className }: { label: string; value: string; bold?: boolean; muted?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn(muted ? 'text-gray-500' : 'text-gray-700 dark:text-slate-300', bold && 'font-bold text-gray-900 dark:text-slate-100')}>{label}</span>
      <span className={cn('tabular-nums', bold && 'font-bold', className)}>{value}</span>
    </div>
  );
}
