/**
 * The supplier statement on paper (A4): page 1 = who and how much (what is owed now, billed, paid) and the bills still pending, oldest first;
 * the next pages = the passbook (every bill as credit, every payment as debit, running balance). Printed straight from the browser through the
 * .print-area / .print-page scaffold of src/index.css, like the dispensing register — "Save as PDF" in the print dialog makes a PDF.
 */
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { fmtDate, formatINR } from '../../lib/utils';
import type { SupplierStatementResult } from '../../lib/supplierStatement';
import { PrintHeader } from '../print/PrintHeader';

const CELL = { border: '1px solid #cbd5e1', padding: '3px 6px' } as const;
const HEAD = { ...CELL, background: '#eff6ff', color: '#1e3a8a', fontWeight: 700 } as const;
const STATE_TEXT: Record<string, string> = { unpaid: 'Unpaid', part: 'Part-paid', paid: 'Paid', unknown: 'Unknown' };

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out.length ? out : [[]];
}

export function SupplierStatementPrint({ statement: st, onClose }: { statement: SupplierStatementResult; onClose: () => void }) {
  const { data: clinic } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const pending = chunk(st.pending, 14);
  const passbook = chunk(st.rows, 30);
  const total = pending.length + passbook.length;
  const t = st.totals;
  const period = st.from || st.to ? `${st.from ? fmtDate(st.from) : 'the start'} — ${st.to ? fmtDate(st.to) : fmtDate(st.as_of)}` : `All bills and payments up to ${fmtDate(st.as_of)}`;

  const page = (key: string, n: number, children: React.ReactNode, last = false) => (
    <div key={key} className="print-area print-page bg-white shadow-2xl"
      style={{ width: '210mm', height: '297mm', padding: '14mm', backgroundColor: '#ffffff', color: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      {clinic && <PrintHeader settings={clinic} compact />}
      <div className="text-center mt-3 mb-3">
        <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>Supplier statement</div>
        <div className="text-[12px] font-semibold">{st.supplier.name}</div>
        <div className="text-[10px]" style={{ color: '#475569' }}>
          Drug licence {st.supplier.drug_license_no}{st.supplier.gstin ? ` · GSTIN ${st.supplier.gstin}` : ''}{st.supplier.phone ? ` · ${st.supplier.phone}` : ''}
        </div>
        <div className="text-[10px]" style={{ color: '#475569' }}>{period} · Page {n} of {total} · Printed {format(new Date(), 'do MMM yyyy HH:mm')}</div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      {last && (
        <div className="mt-4 grid grid-cols-2 gap-8" style={{ fontSize: '11px' }}>
          <div><div style={{ borderBottom: '1px solid #475569', height: 32 }} /><div style={{ color: '#475569', marginTop: 2 }}>Prepared by — signature &amp; date</div></div>
          <div className="text-right"><div style={{ borderBottom: '1px solid #475569', height: 32 }} /><div style={{ color: '#475569', marginTop: 2 }}>Balance confirmed by supplier — signature &amp; date</div></div>
        </div>
      )}
    </div>
  );

  const pendingTable = (rows: typeof st.pending, startAt: number) => (
    <table className="w-full text-[10.5px]" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...HEAD, textAlign: 'left' }}>Bill</th><th style={{ ...HEAD, textAlign: 'left' }}>Date</th><th style={{ ...HEAD, textAlign: 'right' }}>Age (days)</th>
          <th style={{ ...HEAD, textAlign: 'right' }}>Amount</th><th style={{ ...HEAD, textAlign: 'right' }}>Paid</th><th style={{ ...HEAD, textAlign: 'right' }}>Balance</th><th style={{ ...HEAD, textAlign: 'left' }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={7} style={{ ...CELL, textAlign: 'center', color: '#64748b', padding: 14 }}>No pending bills.</td></tr>
        ) : rows.map((b, i) => (
          <tr key={b.invoice_id}>
            <td style={CELL}>{startAt + i + 1}. {b.invoice_number}{b.part_of ? ` (part of ${b.part_of})` : ''}</td>
            <td style={CELL}>{fmtDate(b.invoice_date)}</td>
            <td style={{ ...CELL, textAlign: 'right' }}>{b.days_old}</td>
            <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(b.total)}</td>
            <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(b.paid)}</td>
            <td style={{ ...CELL, textAlign: 'right', fontWeight: 700 }}>{formatINR(b.outstanding)}</td>
            <td style={CELL}>{STATE_TEXT[b.state]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          {st.supplier.name} · owed now {formatINR(t.owed)} · {total} page{total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        {pending.map((rows, pi) =>
          page(`p${pi}`, pi + 1, (
          <>
            {pi === 0 && (
              <>
                <table className="w-full text-[11px] mb-3" style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ ...CELL, background: '#fef2f2', width: '34%' }}><div style={{ fontSize: 9, color: '#64748b' }}>YOU OWE NOW</div><div style={{ fontSize: 18, fontWeight: 800, color: t.owed > 0.004 ? '#b91c1c' : '#15803d' }}>{formatINR(t.owed)}</div></td>
                      <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>TOTAL BILLED</div><div style={{ fontSize: 14, fontWeight: 700 }}>{formatINR(t.billed)}</div><div style={{ fontSize: 9, color: '#64748b' }}>{t.bills} bill{t.bills === 1 ? '' : 's'}</div></td>
                      <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>TOTAL PAID</div><div style={{ fontSize: 14, fontWeight: 700 }}>{formatINR(t.paid)}</div><div style={{ fontSize: 9, color: '#64748b' }}>{t.last_payment_date ? `last ${fmtDate(t.last_payment_date)}` : 'no payment yet'}</div></td>
                      <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>PENDING BILLS</div><div style={{ fontSize: 14, fontWeight: 700 }}>{t.open_bills}</div><div style={{ fontSize: 9, color: '#64748b' }}>{t.oldest_pending_days != null ? `oldest ${t.oldest_pending_days} days` : 'all settled'}</div></td>
                    </tr>
                  </tbody>
                </table>
                {t.owed > 0.004 && (
                  <div className="mb-3 text-[10px]" style={{ color: '#475569' }}>
                    Owed by age — 0–30 days: <b>{formatINR(st.ageing.d0_30)}</b> · 31–60: <b>{formatINR(st.ageing.d31_60)}</b> · 61–90: <b>{formatINR(st.ageing.d61_90)}</b> · over 90: <b style={{ color: st.ageing.d90_plus > 0.004 ? '#b91c1c' : undefined }}>{formatINR(st.ageing.d90_plus)}</b>
                  </div>
                )}
                {st.unknown.length > 0 && (
                  <div className="mb-3 text-[10px]" style={{ border: '1px solid #f59e0b', background: '#fffbeb', padding: '4px 8px' }}>
                    Not in the figures above — payment amount unknown ({st.unknown.map((b) => `${b.invoice_number} ${formatINR(b.total)}`).join(', ')}): marked part-paid before payments were tracked.
                  </div>
                )}
              </>
            )}
            <div className="text-[11px] font-bold mb-1" style={{ color: '#1e3a8a' }}>{pi === 0 ? 'Pending bills — oldest first' : 'Pending bills (continued)'}</div>
            {pendingTable(rows, pi * 14)}
          </>
        ), total === 1))}
        {passbook.map((rows, bi) =>
          page(`b${bi}`, pending.length + bi + 1, (
          <>
            <div className="text-[11px] font-bold mb-1" style={{ color: '#1e3a8a' }}>Passbook — credit = a bill (owed), debit = a payment (paid){bi > 0 ? ' (continued)' : ''}</div>
            <table className="w-full text-[10.5px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...HEAD, textAlign: 'left', width: '13%' }}>Date</th><th style={{ ...HEAD, textAlign: 'left' }}>Particulars</th>
                  <th style={{ ...HEAD, textAlign: 'right', width: '14%' }}>Credit</th><th style={{ ...HEAD, textAlign: 'right', width: '14%' }}>Debit</th><th style={{ ...HEAD, textAlign: 'right', width: '15%' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {bi === 0 && st.from && (
                  <tr><td style={CELL}>{fmtDate(st.from)}</td><td style={{ ...CELL, fontStyle: 'italic' }}>Brought forward</td><td style={CELL}></td><td style={CELL}></td><td style={{ ...CELL, textAlign: 'right', fontWeight: 700 }}>{formatINR(st.brought_forward)}</td></tr>
                )}
                {rows.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...CELL, textAlign: 'center', color: '#64748b', padding: 14 }}>No bills or payments in this period.</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...CELL, whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td style={CELL}>{r.particulars}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{r.credit > 0 ? formatINR(r.credit) : ''}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{r.debit > 0 ? formatINR(r.debit) : ''}</td>
                    <td style={{ ...CELL, textAlign: 'right', fontWeight: 700 }}>{formatINR(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {bi === passbook.length - 1 && (
                <tfoot>
                  <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
                    <td style={CELL} colSpan={2}>Total{st.from || st.to ? ' for this period' : ''}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(st.period.credit)}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(st.period.debit)}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(st.period.closing)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        ), bi === passbook.length - 1))}
      </div>

      <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl" style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}>
        <button onClick={onClose} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#e2e8f0', color: '#0f172a' }}>
          <X className="w-4 h-4" /> Close
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}>
          <Printer className="w-4 h-4" /> Print statement
        </button>
      </div>
    </div>
  );
}

/** Opens one supplier's statement for printing straight from the Reports tab (loads it first). */
export function SupplierStatementPrintFor({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['supplier-statement', supplierId, '', ''], queryFn: () => window.electronAPI.wholesalers.statement(supplierId, {}) });
  if (!data) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center print-overlay no-print" style={{ backgroundColor: '#94a3b8' }}>
        <div className="bg-white p-12 rounded text-sm text-gray-600">Loading…</div>
      </div>
    );
  }
  return <SupplierStatementPrint statement={data} onClose={onClose} />;
}
