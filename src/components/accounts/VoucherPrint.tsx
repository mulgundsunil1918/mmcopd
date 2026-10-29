/** A voucher on paper: who was paid what, how, for what, by whom — with the clinic's letterhead and two signature lines. */
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { PrintHeader } from '../print/PrintHeader';
import { voucherType } from '../../lib/accountsRules';
import { fmtDate, formatINR } from '../../lib/utils';
import type { VoucherRow } from '../../main/accounts';

export function VoucherPrint({ voucher, onClose }: { voucher: VoucherRow; onClose: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const t = voucherType(voucher.voucher_type);
  const row = (k: string, v: React.ReactNode) => v ? <tr><td className="py-1.5 pr-4 align-top text-[11px] uppercase tracking-wide" style={{ color: '#64748b', width: 150 }}>{k}</td><td className="py-1.5 text-sm" style={{ color: '#0f172a' }}>{v}</td></tr> : null;
  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="p-6 pb-28 flex justify-center">
        <div className="print-area print-page bg-white shadow-2xl" style={{ width: '148mm', minHeight: '140mm', padding: '10mm', color: '#0f172a' }}>
          {settings && <PrintHeader settings={settings} compact />}
          <div className="text-center mt-3 mb-3">
            <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>Payment Voucher{voucher.status === 'cancelled' ? ' — CANCELLED' : ''}</div>
            <div className="text-xs" style={{ color: '#475569' }}>{t?.label} · No. <b className="font-mono">{voucher.voucher_no}</b> · {fmtDate(voucher.voucher_date)}</div>
          </div>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}><tbody>
            {row('Paid to', <b>{voucher.payee_name}</b>)}
            {row('Heading', voucher.category)}
            {row('For', voucher.description)}
            {row('Period', voucher.period_from && voucher.period_to ? `${fmtDate(voucher.period_from)} — ${fmtDate(voucher.period_to)}` : '')}
            {row('Amount', formatINR(voucher.gross_amount))}
            {voucher.deduction_amount > 0 && row(voucher.deduction_label || 'Deduction', `− ${formatINR(voucher.deduction_amount)}`)}
            {row('Paid', <b className="text-base">{formatINR(voucher.net_amount)}</b>)}
            {row('Paid by', `${voucher.pay_mode}${voucher.pay_reference ? ` · ${voucher.pay_reference}` : ''}`)}
            {voucher.days && voucher.days.length > 0 && row('Days settled', voucher.days.map((d) => `${fmtDate(d.day)} ${formatINR(d.amount)}`).join(' · '))}
            {voucher.status === 'cancelled' && row('Cancelled', `${voucher.cancel_reason || ''} (${voucher.cancelled_by || ''})`)}
          </tbody></table>
          <div className="mt-3 text-[11px]" style={{ color: '#64748b' }}>Raised by {voucher.raised_by || '—'}</div>
          <div className="grid grid-cols-2 gap-10 mt-14 text-center text-[11px]" style={{ color: '#475569' }}>
            <div style={{ borderTop: '1px solid #94a3b8', paddingTop: 4 }}>Received by</div>
            <div style={{ borderTop: '1px solid #94a3b8', paddingTop: 4 }}>Authorised by</div>
          </div>
        </div>
      </div>
      <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl" style={{ backgroundColor: '#1e293b' }}>
        <button onClick={onClose} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#475569' }}><X className="w-4 h-4" /> Close</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}><Printer className="w-4 h-4" /> Print voucher</button>
      </div>
    </div>
  );
}
