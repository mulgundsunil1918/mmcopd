/**
 * Supplier accounts — every supplier on one A4 report: what was billed, what was paid, what is owed TODAY and how old the unpaid bills are
 * (0–30, 31–60, 61–90, over 90 days). The same numbers as each supplier's Statement (lib/supplierStatement.ts). Prints through the .print-area /
 * .print-page scaffold, so "Save as PDF" in the print dialog makes a PDF.
 */
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { fmtDate, formatINR } from '../../lib/utils';
import { PrintHeader } from '../print/PrintHeader';

const CELL = { border: '1px solid #cbd5e1', padding: '3px 5px' } as const;
const HEAD = { ...CELL, background: '#eff6ff', color: '#1e3a8a', fontWeight: 700 } as const;
const money = (v: number) => (v > 0.004 ? formatINR(v) : '—');
const PAGE_ROWS = 26;

export function SupplierAccountsPrint({ onClose }: { onClose: () => void }) {
  const { data: clinic } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: acc, isLoading } = useQuery({ queryKey: ['supplier-accounts'], queryFn: () => window.electronAPI.wholesalers.accounts() });

  const rows = acc?.suppliers ?? [];
  const pages: (typeof rows)[] = [];
  for (let i = 0; i < Math.max(1, rows.length); i += PAGE_ROWS) pages.push(rows.slice(i, i + PAGE_ROWS));
  const t = acc?.totals;

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          Supplier accounts · {rows.length} supplier{rows.length === 1 ? '' : 's'} · you owe {formatINR(t?.owed ?? 0)}
        </div>
      </div>

      <div className="p-6 pb-28 flex flex-col items-center gap-4">
        {isLoading || !acc ? (
          <div className="bg-white p-12 rounded text-sm text-gray-600">Loading…</div>
        ) : pages.map((pageRows, pi) => (
          <div key={pi} className="print-area print-page bg-white shadow-2xl"
            style={{ width: '210mm', height: '297mm', padding: '14mm', backgroundColor: '#ffffff', color: '#0f172a', display: 'flex', flexDirection: 'column' }}>
            {clinic && <PrintHeader settings={clinic} compact />}
            <div className="text-center mt-3 mb-3">
              <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>Supplier accounts</div>
              <div className="text-[10px]" style={{ color: '#475569' }}>As on {fmtDate(acc.as_of)} · Page {pi + 1} of {pages.length} · Printed {format(new Date(), 'do MMM yyyy HH:mm')}</div>
            </div>

            {pi === 0 && t && (
              <table className="w-full text-[11px] mb-3" style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ ...CELL, background: '#fef2f2', width: '30%' }}><div style={{ fontSize: 9, color: '#64748b' }}>TOTAL OWED TO SUPPLIERS</div><div style={{ fontSize: 18, fontWeight: 800, color: t.owed > 0.004 ? '#b91c1c' : '#15803d' }}>{formatINR(t.owed)}</div></td>
                    <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>BILLED</div><div style={{ fontSize: 14, fontWeight: 700 }}>{formatINR(t.billed)}</div><div style={{ fontSize: 9, color: '#64748b' }}>{t.bills} bills · {t.suppliers} suppliers</div></td>
                    <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>PAID</div><div style={{ fontSize: 14, fontWeight: 700 }}>{formatINR(t.paid)}</div></td>
                    <td style={CELL}><div style={{ fontSize: 9, color: '#64748b' }}>PENDING BILLS</div><div style={{ fontSize: 14, fontWeight: 700 }}>{t.open_bills}</div></td>
                  </tr>
                </tbody>
              </table>
            )}

            <div style={{ flex: 1 }}>
              <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...HEAD, textAlign: 'left' }}>Supplier</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Bills</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Billed</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Paid</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Owed now</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>0–30 d</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>31–60 d</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>61–90 d</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Over 90 d</th>
                    <th style={{ ...HEAD, textAlign: 'right' }}>Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={10} style={{ ...CELL, textAlign: 'center', color: '#64748b', padding: 14 }}>No purchase bills yet.</td></tr>
                  ) : pageRows.map((s) => (
                    <tr key={s.id}>
                      <td style={CELL}>
                        <div style={{ fontWeight: 600 }}>{s.name}{s.is_active !== 1 ? ' (inactive)' : ''}</div>
                        <div style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace' }}>{s.drug_license_no}{s.gstin ? ` · ${s.gstin}` : ''}</div>
                        {s.unknown_bills > 0 && <div style={{ fontSize: 8, color: '#92400e' }}>+ {s.unknown_bills} bill{s.unknown_bills === 1 ? '' : 's'} ({formatINR(s.unknown_total)}) payment unknown</div>}
                      </td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{s.bills}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(s.billed)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(s.paid)}</td>
                      <td style={{ ...CELL, textAlign: 'right', fontWeight: 800, color: s.owed > 0.004 ? '#b91c1c' : undefined }}>{money(s.owed)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(s.ageing.d0_30)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(s.ageing.d31_60)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(s.ageing.d61_90)}</td>
                      <td style={{ ...CELL, textAlign: 'right', color: s.ageing.d90_plus > 0.004 ? '#b91c1c' : undefined, fontWeight: s.ageing.d90_plus > 0.004 ? 700 : undefined }}>{money(s.ageing.d90_plus)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{s.oldest_pending_days != null ? `${s.oldest_pending_days} d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {pi === pages.length - 1 && t && (
                  <tfoot>
                    <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
                      <td style={CELL}>Total</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{t.bills}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(t.billed)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(t.paid)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{formatINR(t.owed)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(t.ageing.d0_30)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(t.ageing.d31_60)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(t.ageing.d61_90)}</td>
                      <td style={{ ...CELL, textAlign: 'right' }}>{money(t.ageing.d90_plus)}</td>
                      <td style={CELL}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
              <p className="text-[9px] mt-2" style={{ color: '#64748b' }}>
                Owed now = bills − payments. The four age columns split what is owed by how old the supplier’s bill is, and add up to Owed now.
                A bill marked part-paid before payments were tracked is not in any figure — how much was paid is unknown.
              </p>
            </div>

            {pi === pages.length - 1 && (
              <div className="mt-4 grid grid-cols-2 gap-8" style={{ fontSize: '11px' }}>
                <div><div style={{ borderBottom: '1px solid #475569', height: 32 }} /><div style={{ color: '#475569', marginTop: 2 }}>Prepared by</div></div>
                <div className="text-right"><div style={{ borderBottom: '1px solid #475569', height: 32 }} /><div style={{ color: '#475569', marginTop: 2 }}>Authorised signatory</div></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 px-5 py-3 rounded-2xl shadow-2xl" style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}>
        <button onClick={onClose} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#e2e8f0', color: '#0f172a' }}>
          <X className="w-4 h-4" /> Close
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)' }}>
          <Printer className="w-4 h-4" /> Print supplier accounts
        </button>
      </div>
    </div>
  );
}
