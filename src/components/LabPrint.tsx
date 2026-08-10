import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer, X } from 'lucide-react';
import { formatINR } from '../lib/utils';
import type { Settings } from '../types';

/**
 * Print a lab document on the clinic letterhead — same header family as the OPD
 * slip and bill. Two modes:
 *   - 'bill'   : the ordered tests with prices and a total (a requisition/receipt)
 *   - 'report' : the tests with results, reference ranges and abnormal flags
 */
export function LabPrint({ order, items, mode, onClose }: {
  order: { order_number?: string; patient_name?: string; patient_uhid?: string; doctor_name?: string | null; ordered_at?: string };
  items: any[];
  mode: 'bill' | 'report';
  onClose: () => void;
}) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  if (!settings) return <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center"><div className="card p-8">Loading…</div></div>;
  const s = settings as Settings;
  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
  const title = mode === 'bill' ? 'LABORATORY BILL' : 'LABORATORY REPORT';

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4 no-print-bg">
      <div className="no-print max-w-[210mm] mx-auto flex justify-end gap-2 mb-2">
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" style={{ width: '210mm', minHeight: '148mm', padding: '12mm 14mm' }}>
        <div className="flex items-start gap-4 pb-3" style={{ borderBottom: '2px solid #1e3a8a' }}>
          {s.clinic_logo ? (
            <img src={s.clinic_logo} alt="Logo" style={{ width: '18mm', height: '18mm', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 8 }} />
          ) : (
            <div className="rounded-lg flex items-center justify-center text-white" style={{ width: '18mm', height: '18mm', background: 'linear-gradient(135deg,#1d4ed8,#4f46e5)' }}>
              <HeartPulse className="w-8 h-8" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-extrabold uppercase" style={{ color: '#1e3a8a', fontSize: 22, lineHeight: 1.1 }}>{s.clinic_name || 'CureDesk HMS'}</div>
            {s.clinic_tagline && <div className="italic" style={{ color: '#1e40af', fontSize: 12 }}>{s.clinic_tagline}</div>}
            <div className="text-[11px] text-slate-600 mt-1">{s.clinic_address}</div>
            <div className="text-[11px] text-slate-600">{s.clinic_phone && <>☎ {s.clinic_phone}</>}{s.clinic_registration_no && <> · Reg. {s.clinic_registration_no}</>}</div>
          </div>
        </div>

        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>{title}</span>
        </div>

        <div className="flex justify-between gap-6 text-[12px] mb-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Patient</div>
            <div className="font-bold text-[13px] text-slate-900">{order.patient_name || '—'}</div>
            <div className="text-slate-600">{order.patient_uhid ? <>UHID: {order.patient_uhid}</> : null}{order.doctor_name ? <> · Ref: {order.doctor_name}</> : null}</div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Order</div>
            <div className="text-slate-700 font-medium font-mono">{order.order_number || '—'}</div>
            <div className="text-slate-600">{order.ordered_at ? new Date(order.ordered_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #cbd5e1', textAlign: 'left' }}>
              <th className="py-1.5">#</th>
              <th className="py-1.5">Test</th>
              {mode === 'report' ? (
                <>
                  <th className="py-1.5">Result</th>
                  <th className="py-1.5">Unit</th>
                  <th className="py-1.5">Reference</th>
                </>
              ) : (
                <th className="py-1.5 text-right">Amount (₹)</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id ?? i} style={{ borderBottom: '1px solid #eef2f7' }}>
                <td className="py-1.5 text-slate-500">{i + 1}</td>
                <td className="py-1.5 font-medium text-slate-900">{it.test_name}</td>
                {mode === 'report' ? (
                  <>
                    <td className={`py-1.5 ${it.is_abnormal ? 'font-bold text-red-600' : 'text-slate-800'}`}>{it.result || '—'}{it.is_abnormal ? ' ⚑' : ''}</td>
                    <td className="py-1.5 text-slate-600">{it.unit || '—'}</td>
                    <td className="py-1.5 text-slate-600">{it.ref_range || '—'}</td>
                  </>
                ) : (
                  <td className="py-1.5 text-right tabular-nums">{formatINR(Number(it.price) || 0)}</td>
                )}
              </tr>
            ))}
          </tbody>
          {mode === 'bill' && (
            <tfoot>
              <tr style={{ borderTop: '1.5px solid #cbd5e1' }}>
                <td></td>
                <td className="py-2 font-bold text-slate-900">Total</td>
                <td className="py-2 text-right font-bold text-slate-900 tabular-nums">{formatINR(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>

        <div className="flex justify-between items-end mt-10 text-[11px]">
          <div className="text-slate-500">
            {mode === 'report' ? '⚑ = outside reference range. Computer-generated report — correlate clinically.' : 'Computer-generated laboratory bill.'}
          </div>
          <div className="text-center">
            <div style={{ borderTop: '1px solid #94a3b8', width: '55mm', paddingTop: 4 }}>{mode === 'report' ? 'Lab In-charge / Pathologist' : 'Authorised Signatory'}</div>
            <div className="text-slate-600 mt-0.5">For {s.clinic_name || 'the clinic'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
