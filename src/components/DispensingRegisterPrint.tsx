import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fmtDate, fmtDateTime } from '../lib/utils';
import type { DrugSchedule } from '../types';

/**
 * Schedule H/H1 dispensing register — printed straight from the browser via
 * window.print() onto the .print-area / .print-page CSS scaffold defined in
 * src/index.css. Same pattern as the OPD slip; no PDF library needed.
 *
 * The register is the legal record asked for by Karnataka Drugs Inspectors:
 * one row per (sale_item × batch slice), columns Sl/Date/Patient/Drug/Batch/
 * Expiry/Qty/Doctor/Sign.
 */
export function DispensingRegisterPrint({
  from,
  to,
  schedule,
  onClose,
}: {
  from: string;
  to: string;
  schedule?: DrugSchedule;
  onClose: () => void;
}) {
  const { data: clinic } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['dispensing-register', from, to, schedule],
    queryFn: () => window.electronAPI.dispensing.register({ from, to, schedule }),
  });

  // Paginate at ~22 rows per page so each A4 sheet stays clean.
  const PAGE_ROWS = 22;
  const pages: typeof rows[] = [];
  for (let i = 0; i < Math.max(1, rows.length); i += PAGE_ROWS) {
    pages.push(rows.slice(i, i + PAGE_ROWS));
  }
  const totalPages = pages.length;

  return (
    <div className="fixed inset-0 z-[100] overflow-auto print-overlay" style={{ backgroundColor: '#94a3b8' }}>
      <div className="no-print sticky top-3 z-10 flex justify-center pointer-events-none">
        <div className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#1e293b' }}>
          {schedule ? `Schedule ${schedule}` : 'All schedules'} · {rows.length} entries · {totalPages} page{totalPages === 1 ? '' : 's'}
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
              width: '210mm',
              height: '297mm',
              padding: '14mm',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Letterhead (compact) */}
            <div style={{ borderBottom: '2px solid #1d4ed8' }} className="pb-2 mb-3">
              <div className="flex items-center gap-3">
                {clinic?.clinic_logo && (
                  <img src={clinic.clinic_logo} alt="Logo" className="w-12 h-12 object-contain" />
                )}
                <div className="flex-1">
                  <div className="text-xl font-extrabold tracking-tight" style={{ color: '#1e3a8a' }}>
                    {clinic?.clinic_name || 'Clinic'}
                  </div>
                  <div className="text-[11px]" style={{ color: '#475569' }}>
                    {clinic?.clinic_address}
                    {clinic?.clinic_phone ? ` · ${clinic.clinic_phone}` : ''}
                  </div>
                </div>
                <div className="text-right text-[11px]" style={{ color: '#475569' }}>
                  Page {pIdx + 1} of {totalPages}
                  <div className="font-mono">Generated {format(new Date(), 'dd MMM yyyy HH:mm')}</div>
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-3">
              <div className="text-base font-bold uppercase tracking-wider" style={{ color: '#1e3a8a' }}>
                {schedule ? `Schedule ${schedule} Dispensing Register` : 'Dispensing Register (All Schedules)'}
              </div>
              <div className="text-[11px]" style={{ color: '#475569' }}>
                Period: {fmtDate(from)} — {fmtDate(to)}
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', flex: 1 }}>
              <thead>
                <tr style={{ background: '#eff6ff', color: '#1e3a8a' }}>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '6%', textAlign: 'left' }}>Sl</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '14%', textAlign: 'left' }}>Date / Time</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '18%', textAlign: 'left' }}>Patient (UHID)</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '20%', textAlign: 'left' }}>Drug</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '10%', textAlign: 'left' }}>Batch</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '8%', textAlign: 'left' }}>Expiry</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '6%', textAlign: 'right' }}>Qty</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '12%', textAlign: 'left' }}>Doctor</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '4px 6px', width: '6%', textAlign: 'center' }}>Sch</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ border: '1px solid #cbd5e1', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                      No dispenses in this period.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px' }}>{pIdx * PAGE_ROWS + idx + 1}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px' }}>{fmtDateTime(r.dispensed_at)}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px' }}>
                        {r.patient_name || '—'}
                        <div style={{ fontSize: 9, color: '#64748b' }}>{(r as any).patient_uhid || ''}</div>
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px' }}>{r.drug_name || `#${r.drug_master_id}`}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px', fontFamily: 'monospace', fontSize: 9 }}>{r.batch_no}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px', fontSize: 9 }}>
                        {(() => { try { return format(parseISO(r.expiry), 'MMM yy'); } catch { return r.expiry; } })()}
                      </td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px', textAlign: 'right', fontWeight: 600 }}>{r.qty}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px', fontSize: 9 }}>{r.doctor_name || '—'}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '3px 6px', textAlign: 'center', fontWeight: 700 }}>{r.schedule}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Footer (only on last page) */}
            {pIdx === totalPages - 1 && (
              <div className="mt-4 grid grid-cols-2 gap-8" style={{ fontSize: '11px' }}>
                <div>
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Pharmacist — Signature & Date</div>
                </div>
                <div className="text-right">
                  <div style={{ borderBottom: '1px solid #475569', height: 36 }} />
                  <div style={{ color: '#475569', marginTop: 2 }}>Doctor / Registered Medical Practitioner</div>
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
          <Printer className="w-4 h-4" /> Print Register
        </button>
      </div>
    </div>
  );
}
