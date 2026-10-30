/**
 * The lab report as a printed document: letterhead, patient and order, then each test with its parameters — result, unit and normal range side by side,
 * abnormal values in bold with H / L / A — and the signature line. One component, used by the print overlay AND by the PDF that is sent on WhatsApp.
 */
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PrintHeader } from '../print/PrintHeader';
import { parseDbDate } from '../../lib/utils';
import type { Settings } from '../../types';
import type { SheetItem } from '../../db/labParams';

const FLAG_TEXT: Record<string, string> = { H: 'H', L: 'L', A: 'Abnormal' };

function Section({ item, legacy }: { item: SheetItem; legacy?: { result: string | null; unit: string | null; ref_range: string | null; is_abnormal: number } }) {
  const rows = item.rows;
  let lastGroup: string | null | undefined;
  return (
    <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: 14 }}>
      <div className="flex items-baseline justify-between" style={{ borderBottom: '1.5px solid #1e3a8a', paddingBottom: 2, marginBottom: 4 }}>
        <div className="font-bold uppercase tracking-wide" style={{ fontSize: 12.5, color: '#1e3a8a' }}>{item.test_name}</div>
        {item.sample_type && <div style={{ fontSize: 10.5, color: '#64748b' }}>Sample: {item.sample_type}</div>}
      </div>
      <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <th style={{ padding: '3px 0', width: '38%' }}>Investigation</th><th style={{ width: '20%' }}>Result</th><th style={{ width: '14%' }}>Unit</th><th>Normal range</th></tr></thead>
        <tbody>
          {rows.length === 0 && legacy && (
            <tr style={{ borderBottom: '1px solid #eef2f7' }}>
              <td style={{ padding: '4px 0' }}>{item.test_name}</td>
              <td style={{ fontWeight: legacy.is_abnormal ? 700 : 400, color: legacy.is_abnormal ? '#b91c1c' : '#0f172a' }}>{legacy.result || '—'}{legacy.is_abnormal ? ' (Abnormal)' : ''}</td>
              <td style={{ color: '#475569' }}>{legacy.unit || ''}</td><td style={{ color: '#475569' }}>{legacy.ref_range || ''}</td></tr>
          )}
          {rows.map((r) => {
            const head = r.grp && r.grp !== lastGroup ? <tr key={`g-${r.key}`}><td colSpan={4} style={{ padding: '6px 0 2px', fontWeight: 700, fontSize: 11, color: '#334155' }}>{r.grp}</td></tr> : null;
            lastGroup = r.grp;
            const abn = !!r.flag;
            return (
              <Fragment key={r.key}>{head}
                <tr style={{ borderBottom: '1px solid #eef2f7' }}>
                  <td style={{ padding: '3px 0 3px ' + (r.grp ? '10px' : '0') }}>{r.name}</td>
                  <td style={{ fontWeight: abn ? 700 : 500, color: abn ? '#b91c1c' : '#0f172a' }}>{r.value || '—'}{abn && <span style={{ marginLeft: 4, fontSize: 10 }}>{FLAG_TEXT[r.flag]}</span>}</td>
                  <td style={{ color: '#475569' }}>{r.unit || ''}</td><td style={{ color: '#475569' }}>{r.range_text}</td></tr></Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LabReportDocument({ orderId, onReady }: { orderId: number; onReady?: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data } = useQuery({ queryKey: ['lab-report-data', orderId], queryFn: () => window.electronAPI.lab.reportData(orderId), staleTime: 0 });
  const { data: items = [] } = useQuery({ queryKey: ['lab-order-items', orderId], queryFn: () => window.electronAPI.lab.getOrderItems(orderId) });
  if (!settings || !data) return <div className="p-8 text-sm text-slate-500">Loading the report…</div>;
  const s = settings as Settings; const when = (iso: string | null) => (iso ? (parseDbDate(iso) || new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const legacyOf = (id: number) => (items as any[]).find((x) => x.id === id);
  return (
    <div className="print-area mx-auto bg-white text-slate-900" data-report-ready="1" style={{ width: '210mm', minHeight: '240mm', padding: '12mm 14mm' }} ref={() => { onReady?.(); }}>
      <PrintHeader settings={s} />
      <div className="text-center my-3"><span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>LABORATORY REPORT</span></div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 mb-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12 }}>
        <div><span style={{ color: '#64748b' }}>Patient </span><b>{data.patient.name}</b></div>
        <div className="text-right"><span style={{ color: '#64748b' }}>Report no. </span><b className="font-mono">{data.order.order_number}</b></div>
        <div><span style={{ color: '#64748b' }}>Age / Sex </span>{[data.patient.age, data.patient.sex].filter(Boolean).join(' / ') || '—'}<span style={{ color: '#64748b' }}> · UHID </span>{data.patient.uhid}</div>
        <div className="text-right"><span style={{ color: '#64748b' }}>Ordered </span>{when(data.order.ordered_at)}</div>
        <div><span style={{ color: '#64748b' }}>Referred by </span>{data.order.doctor_name || '—'}</div>
        <div className="text-right"><span style={{ color: '#64748b' }}>Reported </span>{when(data.order.reported_at)}</div>
      </div>
      {data.items.map((it) => <Section key={it.item_id} item={it} legacy={legacyOf(it.item_id)} />)}
      <div className="flex justify-between items-end mt-8" style={{ fontSize: 10.5, breakInside: 'avoid' }}>
        <div style={{ color: '#64748b', maxWidth: '110mm' }}>H = above the normal range, L = below it, Abnormal = not the normal finding. Normal ranges are for adults and can differ with the method used — correlate clinically. This is a computer-generated report.</div>
        <div className="text-center"><div style={{ borderTop: '1px solid #94a3b8', width: '55mm', paddingTop: 4 }}>Lab In-charge / Pathologist</div><div style={{ color: '#475569' }} className="mt-0.5">For {s.clinic_name || 'the clinic'}</div></div>
      </div>
    </div>
  );
}
