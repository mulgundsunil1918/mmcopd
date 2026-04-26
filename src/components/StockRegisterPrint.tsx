import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { fmtDate, formatINR } from '../lib/utils';

/**
 * Stock register — every batch grouped by drug, sorted by drug name then expiry.
 * Highlights expired (red) and expiring within 90 days (amber). Uses the same
 * .print-area / .print-page CSS scaffold as the OPD slip.
 */
export function StockRegisterPrint({
  includeExpired,
  onClose,
}: {
  includeExpired: boolean;
  onClose: () => void;
}) {
  const { data: clinic } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['stock-register', includeExpired],
    queryFn: () => window.electronAPI.stock.register({ includeExpired }),
  });

  const PAGE_ROWS = 26;
  const pages: typeof rows[] = [];
  for (let i = 0; i < Math.max(1, rows.length); i += PAGE_ROWS) {
    pages.push(rows.slice(i, i + PAGE_ROWS));
  }
  const totalPages = pages.length;

  // Aggregate header stats (shown on first page only).
  const totalBatches = rows.length;
  const totalUnits = rows.reduce((s, r) => s + (r.qty_remaining || 0), 0);
  const totalValue = rows.reduce((s, r) => s + (r.qty_remaining || 0) * (r.mrp || 0), 0);
  const expiredCount = rows.filter((r) => r.days_to_expiry < 0).length;
  const expiringCount = rows.filter((r) => r.days_to_expiry >= 0 && r.days_to_expiry <= 90).length;

  return (
    <div className="fixed inset-0 z-[100] overflow-auto" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          Stock Register · {totalBatches} batches · {totalPages} page{totalPages === 1 ? '' : 's'}
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
            {/* Letterhead */}
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
                  <div className="font-mono">Generated {format(new Date(), 'dd MMM yyyy HH:mm')}</div>
                </div>
              </div>
            </div>

            {/* Title + summary */}
            <div className="text-center mb-2">
              <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>Stock Register</div>
              <div className="text-[11px]" style={{ color: '#475569' }}>
                As on {fmtDate(new Date().toISOString().slice(0, 10))}
                {!includeExpired && ' · expired batches hidden'}
              </div>
            </div>

            {pIdx === 0 && (
              <div className="grid grid-cols-4 gap-2 text-center text-[11px] mb-3">
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '6px', borderRadius: 4 }}>
                  <div style={{ color: '#1e3a8a', fontWeight: 700, fontSize: 14 }}>{totalBatches}</div>
                  <div style={{ color: '#475569' }}>Active batches</div>
                </div>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '6px', borderRadius: 4 }}>
                  <div style={{ color: '#1e3a8a', fontWeight: 700, fontSize: 14 }}>{totalUnits.toLocaleString('en-IN')}</div>
                  <div style={{ color: '#475569' }}>Total units</div>
                </div>
                <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', padding: '6px', borderRadius: 4 }}>
                  <div style={{ color: '#92400e', fontWeight: 700, fontSize: 14 }}>{expiringCount}</div>
                  <div style={{ color: '#78350f' }}>Expiring ≤ 90d</div>
                </div>
                <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '6px', borderRadius: 4 }}>
                  <div style={{ color: '#991b1b', fontWeight: 700, fontSize: 14 }}>{expiredCount}</div>
                  <div style={{ color: '#7f1d1d' }}>Expired (in stock)</div>
                </div>
              </div>
            )}

            <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', flex: 1 }}>
              <thead>
                <tr style={{ background: '#eff6ff', color: '#1e3a8a' }}>
                  <th style={cellHead(5, 'left')}>Sl</th>
                  <th style={cellHead(22, 'left')}>Drug (Generic · Mfg)</th>
                  <th style={cellHead(8, 'center')}>Sch</th>
                  <th style={cellHead(7, 'left')}>Form</th>
                  <th style={cellHead(7, 'left')}>Str.</th>
                  <th style={cellHead(11, 'left')}>Batch</th>
                  <th style={cellHead(8, 'left')}>Expiry</th>
                  <th style={cellHead(7, 'right')}>Qty</th>
                  <th style={cellHead(8, 'right')}>MRP ₹</th>
                  <th style={cellHead(9, 'right')}>Value ₹</th>
                  <th style={cellHead(8, 'left')}>Mfg.Lic</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={11} style={{ border: '1px solid #cbd5e1', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>No batches in stock.</td></tr>
                ) : pageRows.map((r, idx) => {
                  const expired = r.days_to_expiry < 0;
                  const expiringSoon = r.days_to_expiry >= 0 && r.days_to_expiry <= 90;
                  const tone = expired ? '#fee2e2' : expiringSoon ? '#fef3c7' : undefined;
                  return (
                    <tr key={r.id} style={{ background: tone }}>
                      <td style={cellBody(5, 'left')}>{pIdx * PAGE_ROWS + idx + 1}</td>
                      <td style={cellBody(22, 'left')}>
                        <div style={{ fontWeight: 600 }}>{r.drug_name}</div>
                        <div style={{ fontSize: 9, color: '#64748b' }}>
                          {[r.generic_name, r.manufacturer].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td style={cellBody(8, 'center', { fontWeight: 700 })}>{r.schedule}</td>
                      <td style={cellBody(7, 'left')}>{r.form || '—'}</td>
                      <td style={cellBody(7, 'left')}>{r.strength || '—'}</td>
                      <td style={cellBody(11, 'left', { fontFamily: 'monospace' })}>{r.batch_no}</td>
                      <td style={cellBody(8, 'left', { fontSize: 9 })}>
                        {(() => { try { return format(new Date(r.expiry), 'MMM yy'); } catch { return r.expiry; } })()}
                        {expired && <div style={{ fontSize: 8, fontWeight: 700, color: '#991b1b' }}>EXPIRED</div>}
                        {expiringSoon && <div style={{ fontSize: 8, color: '#92400e' }}>in {r.days_to_expiry}d</div>}
                      </td>
                      <td style={cellBody(7, 'right', { fontWeight: 600 })}>{r.qty_remaining}</td>
                      <td style={cellBody(8, 'right')}>{formatINR(r.mrp)}</td>
                      <td style={cellBody(9, 'right', { fontWeight: 600 })}>{formatINR((r.qty_remaining || 0) * (r.mrp || 0))}</td>
                      <td style={cellBody(8, 'left', { fontSize: 8, fontFamily: 'monospace', color: '#64748b' })}>
                        {r.manufacturer_license_no || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {pIdx === totalPages - 1 && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td colSpan={9} style={{ ...cellBody(0, 'right'), padding: '6px' }}>Total stock value</td>
                    <td style={{ ...cellBody(0, 'right', { fontSize: 11 }), padding: '6px' }}>{formatINR(totalValue)}</td>
                    <td style={cellBody(0, 'left')} />
                  </tr>
                </tfoot>
              )}
            </table>

            {pIdx === totalPages - 1 && (
              <div className="mt-4 grid grid-cols-2 gap-8" style={{ fontSize: '11px' }}>
                <div>
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Pharmacist — Signature & Date</div>
                </div>
                <div className="text-right">
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Verified by</div>
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
          <Printer className="w-4 h-4" /> Print Stock Register
        </button>
      </div>
    </div>
  );
}

function cellHead(widthPct: number, align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { border: '1px solid #cbd5e1', padding: '4px 6px', width: widthPct ? `${widthPct}%` : undefined, textAlign: align };
}
function cellBody(widthPct: number, align: 'left' | 'right' | 'center', extra: React.CSSProperties = {}): React.CSSProperties {
  return { border: '1px solid #cbd5e1', padding: '3px 6px', textAlign: align, width: widthPct ? `${widthPct}%` : undefined, ...extra };
}
