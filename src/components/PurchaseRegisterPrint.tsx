import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { fmtDate, formatINR } from '../lib/utils';

/**
 * Purchase register — every wholesaler invoice in a date range, with GST
 * breakdown and the wholesaler's drug license number on each row (the
 * inspector's question: "show me where you bought this from"). Same A4
 * print scaffold as the other registers.
 */
export function PurchaseRegisterPrint({
  from,
  to,
  onClose,
}: {
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { data: clinic } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['purchase-register', from, to],
    queryFn: () => window.electronAPI.purchasesReport.register({ from, to }),
  });

  const PAGE_ROWS = 22;
  const pages: typeof rows[] = [];
  for (let i = 0; i < Math.max(1, rows.length); i += PAGE_ROWS) {
    pages.push(rows.slice(i, i + PAGE_ROWS));
  }
  const totalPages = pages.length;

  const totalSpend = rows.reduce((s, r) => s + (r.total || 0), 0);
  const totalGst = rows.reduce((s, r) => s + (r.cgst || 0) + (r.sgst || 0) + (r.igst || 0), 0);
  const paidCount = rows.filter((r) => r.payment_status === 'paid').length;
  // What is still owed on each bill = total − paid; a bill marked part-paid before payments were tracked has no recorded amount (shown as "?").
  const balanceOf = (r: { total: number; amount_paid?: number | null }) => (r.amount_paid == null ? null : Math.max(0, Math.round((r.total - r.amount_paid) * 100) / 100));
  const totalPaid = rows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const totalBalance = rows.reduce((s, r) => s + (balanceOf(r) ?? 0), 0);
  const totalDiscount = rows.reduce((s, r) => s + (r.discount || 0), 0);

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          Purchase Register · {rows.length} invoice{rows.length === 1 ? '' : 's'} · {totalPages} page{totalPages === 1 ? '' : 's'}
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        {isLoading ? (
          <div className="bg-white p-12 rounded text-sm text-gray-600">Loading…</div>
        ) : pages.map((pageRows, pIdx) => (
          <div
            key={pIdx}
            className="print-area print-page bg-white shadow-2xl"
            style={{
              width: '210mm', height: '297mm', padding: '14mm',
              backgroundColor: '#ffffff', color: '#0f172a',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ borderBottom: '2px solid #1d4ed8' }} className="pb-2 mb-3">
              <div className="flex items-center gap-3">
                {clinic?.clinic_logo && <img src={clinic.clinic_logo} alt="Logo" className="w-12 h-12 object-contain" />}
                <div className="flex-1">
                  <div className="text-xl font-extrabold tracking-tight" style={{ color: '#1e3a8a' }}>
                    {clinic?.clinic_name || 'Clinic'}
                  </div>
                  <div className="text-[11px]" style={{ color: '#475569' }}>
                    {clinic?.clinic_address}{clinic?.clinic_phone ? ` · ${clinic.clinic_phone}` : ''}
                  </div>
                </div>
                <div className="text-right text-[11px]" style={{ color: '#475569' }}>
                  Page {pIdx + 1} of {totalPages}
                  <div className="font-mono">Generated {format(new Date(), 'do MMMM yyyy HH:mm')}</div>
                </div>
              </div>
            </div>

            <div className="text-center mb-2">
              <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>Purchase Register</div>
              <div className="text-[11px]" style={{ color: '#475569' }}>Period: {fmtDate(from)} — {fmtDate(to)}</div>
            </div>

            {pIdx === 0 && (
              <div className="grid grid-cols-4 gap-2 text-center text-[11px] mb-3">
                <div style={tile('#eff6ff', '#bfdbfe', '#1e3a8a')}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{rows.length}</div>
                  <div style={{ color: '#475569' }}>Invoices</div>
                </div>
                <div style={tile('#eff6ff', '#bfdbfe', '#1e3a8a')}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatINR(totalSpend)}</div>
                  <div style={{ color: '#475569' }}>Total spend</div>
                </div>
                <div style={tile('#dcfce7', '#86efac', '#14532d')}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatINR(totalPaid)}</div>
                  <div style={{ color: '#166534' }}>Paid ({paidCount} bill{paidCount === 1 ? '' : 's'} settled)</div>
                </div>
                <div style={tile('#fee2e2', '#fca5a5', '#991b1b')}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatINR(totalBalance)}</div>
                  <div style={{ color: '#7f1d1d' }}>Still owed ({rows.length - paidCount} bill{rows.length - paidCount === 1 ? '' : 's'})</div>
                </div>
              </div>
            )}

            <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', flex: 1 }}>
              <thead>
                <tr style={{ background: '#eff6ff', color: '#1e3a8a' }}>
                  <th style={cellHead(4, 'left')}>Sl</th>
                  <th style={cellHead(9, 'left')}>Inv. Date</th>
                  <th style={cellHead(11, 'left')}>Invoice #</th>
                  <th style={cellHead(18, 'left')}>Wholesaler (Drug License)</th>
                  <th style={cellHead(5, 'right')}>Lines</th>
                  <th style={cellHead(9, 'right')}>Subtotal ₹</th>
                  <th style={cellHead(7, 'right')}>Disc. ₹</th>
                  <th style={cellHead(7, 'right')}>GST ₹</th>
                  <th style={cellHead(10, 'right')}>Total ₹</th>
                  <th style={cellHead(9, 'right')}>Paid ₹</th>
                  <th style={cellHead(11, 'right')}>Still owed ₹</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={11} style={{ border: '1px solid #cbd5e1', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>No purchase invoices in this period.</td></tr>
                ) : pageRows.map((r, idx) => (
                  <tr key={r.id}>
                    <td style={cellBody(4, 'left')}>{pIdx * PAGE_ROWS + idx + 1}</td>
                    <td style={cellBody(9, 'left', { fontSize: 9 })}>{fmtDate(r.invoice_date)}</td>
                    <td style={cellBody(11, 'left', { fontFamily: 'monospace', fontSize: 9 })}>{r.invoice_number}</td>
                    <td style={cellBody(18, 'left')}>
                      <div style={{ fontWeight: 600 }}>{r.wholesaler_name}</div>
                      <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>{r.wholesaler_license_no}</div>
                    </td>
                    <td style={cellBody(5, 'right')}>{r.line_count}</td>
                    <td style={cellBody(9, 'right')}>{formatINR(r.subtotal)}</td>
                    <td style={cellBody(7, 'right', { fontSize: 9 })}>{(r.discount || 0) > 0 ? formatINR(r.discount) : '—'}</td>
                    <td style={cellBody(7, 'right', { fontSize: 9 })}>{formatINR((r.cgst || 0) + (r.sgst || 0) + (r.igst || 0))}</td>
                    <td style={cellBody(10, 'right', { fontWeight: 700 })}>{formatINR(r.total)}</td>
                    <td style={cellBody(9, 'right')}>{r.amount_paid == null ? '?' : formatINR(r.amount_paid)}</td>
                    <td style={cellBody(11, 'right', { fontWeight: 700 })}>
                      {(() => {
                        const b = balanceOf(r);
                        if (b === null) return <span style={{ color: '#92400e' }} title="Marked part-paid before payments were tracked">unknown</span>;
                        return b > 0.004 ? <span style={{ color: '#991b1b' }}>{formatINR(b)}</span> : <span style={{ color: '#166534', fontWeight: 600, fontSize: 9 }}>Paid</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
              {pIdx === totalPages - 1 && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td colSpan={6} style={{ ...cellBody(0, 'right'), padding: '6px' }}>Totals</td>
                    <td style={{ ...cellBody(0, 'right'), padding: '6px' }}>{formatINR(totalDiscount)}</td>
                    <td style={{ ...cellBody(0, 'right'), padding: '6px' }}>{formatINR(totalGst)}</td>
                    <td style={{ ...cellBody(0, 'right', { fontSize: 11 }), padding: '6px' }}>{formatINR(totalSpend)}</td>
                    <td style={{ ...cellBody(0, 'right'), padding: '6px' }}>{formatINR(totalPaid)}</td>
                    <td style={{ ...cellBody(0, 'right', { fontSize: 11 }), padding: '6px' }}>{formatINR(totalBalance)}</td>
                  </tr>
                </tfoot>
              )}
            </table>

            {pIdx === totalPages - 1 && (
              <div className="mt-4 grid grid-cols-2 gap-8" style={{ fontSize: '11px' }}>
                <div>
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Prepared by</div>
                </div>
                <div className="text-right">
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Authorized Signatory</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl"
        style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
      >
        <button onClick={onClose} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#e2e8f0', color: '#0f172a' }}>
          <X className="w-4 h-4" /> Close
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}>
          <Printer className="w-4 h-4" /> Print Purchase Register
        </button>
      </div>
    </div>
  );
}

function tile(bg: string, border: string, color: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, padding: '6px', borderRadius: 4, color };
}
function cellHead(widthPct: number, align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { border: '1px solid #cbd5e1', padding: '4px 6px', width: widthPct ? `${widthPct}%` : undefined, textAlign: align };
}
function cellBody(widthPct: number, align: 'left' | 'right' | 'center', extra: React.CSSProperties = {}): React.CSSProperties {
  return { border: '1px solid #cbd5e1', padding: '3px 6px', textAlign: align, width: widthPct ? `${widthPct}%` : undefined, ...extra };
}
