/**
 * Printable pharmacy sale receipt (counter sale / dispensing).
 *
 * Uses the same clinic letterhead as the OPD slip and the OPD/IPD bill, so all
 * of a clinic's printed paper looks like one family of documents. Shows batch
 * numbers + expiry per line (pulled from the dispensing register), which is what
 * a pharmacy receipt needs for Schedule-H traceability and for returns.
 *
 * Rendered inside the shared .print-area scaffold from index.css: everything
 * outside it is hidden by @media print.
 */
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer, X } from 'lucide-react';
import type { Settings } from '../../types';

const inr = (n: number) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PharmacySaleReceipt({ saleId, onClose }: { saleId: number; onClose: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: sale, isLoading } = useQuery({
    queryKey: ['pharmacy-sale-detail', saleId],
    queryFn: () => window.electronAPI.pharmacy.saleDetail(saleId),
    enabled: !!saleId,
  });

  if (isLoading || !settings || !sale) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center">
        <div className="card p-8 text-sm">Loading receipt…</div>
      </div>
    );
  }

  const s = settings as Settings;
  const items: any[] = (sale as any).items || [];
  const subtotal = Number((sale as any).subtotal || 0);
  const discount = Number((sale as any).discount || 0);
  const total = Number((sale as any).total || 0);
  const hasSchedule = items.some((i) => i.schedule === 'H' || i.schedule === 'H1' || i.schedule === 'X');

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4 no-print-bg">
      {/* Toolbar — hidden when printing */}
      <div className="no-print max-w-[210mm] mx-auto flex justify-end gap-2 mb-2">
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" style={{ width: '210mm', minHeight: '148mm', padding: '12mm 14mm' }}>
        {/* ===== Letterhead ===== */}
        <div className="flex items-start gap-4 pb-3" style={{ borderBottom: '2px solid #047857' }}>
          {s.clinic_logo ? (
            <img src={s.clinic_logo} alt="Logo" style={{ width: '18mm', height: '18mm', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 8 }} />
          ) : (
            <div className="rounded-lg flex items-center justify-center text-white" style={{ width: '18mm', height: '18mm', background: 'linear-gradient(135deg,#047857,#059669)' }}>
              <HeartPulse className="w-8 h-8" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-extrabold uppercase" style={{ color: '#065f46', fontSize: 22, lineHeight: 1.1 }}>{s.clinic_name || 'CureDesk HMS'}</div>
            {s.clinic_tagline && <div className="italic" style={{ color: '#047857', fontSize: 12 }}>{s.clinic_tagline}</div>}
            <div className="text-[11px] text-slate-600 mt-1">{s.clinic_address}</div>
            <div className="text-[11px] text-slate-600">
              {s.clinic_phone && <>☎ {s.clinic_phone} </>}
              {(s as any).pharmacy_drug_license_no && <> · D.L. No: {(s as any).pharmacy_drug_license_no}</>}
              {s.gst_enabled && s.clinic_gstin && <> · GSTIN: {s.clinic_gstin}</>}
              {/* Legal name and state code are required on a GST invoice and were
                  collected in Settings but never printed anywhere. */}
              {s.gst_enabled && s.clinic_legal_name && s.clinic_legal_name !== s.clinic_name && (
                <> · {s.clinic_legal_name}</>
              )}
              {s.gst_enabled && s.clinic_state_code && <> · State code: {s.clinic_state_code}</>}
            </div>
          </div>
        </div>

        {/* ===== Title ===== */}
        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#ecfdf5', color: '#065f46', fontSize: 14 }}>
            PHARMACY {Number(sale?.is_tax_invoice) === 1 ? 'TAX INVOICE' : s.gst_enabled ? 'BILL OF SUPPLY' : 'RECEIPT'}
          </span>
        </div>

        {/* ===== Customer + sale block ===== */}
        <div className="flex justify-between gap-6 text-[12px] mb-3 p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Customer</div>
            <div className="font-bold text-[13px]">{(sale as any).patient_name || 'Walk-in (cash)'}</div>
            {(sale as any).patient_uhid && <div className="text-slate-600">UHID: {(sale as any).patient_uhid}</div>}
            {(sale as any).patient_phone && <div className="text-slate-600">☎ {(sale as any).patient_phone}</div>}
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Sale details</div>
            <div><b>No:</b> {(sale as any).sale_number || '—'}</div>
            <div className="text-slate-600">
              <b>Date:</b> {(sale as any).created_at ? new Date((sale as any).created_at).toLocaleString('en-IN') : new Date().toLocaleString('en-IN')}
            </div>
            <div className="text-slate-600"><b>Payment:</b> {(sale as any).payment_mode || '—'}</div>
            {(sale as any).sold_by && <div className="text-slate-600">By: {(sale as any).sold_by}</div>}
          </div>
        </div>

        {/* ===== Items ===== */}
        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#ecfdf5' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #d1fae5' }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #d1fae5' }}>Medicine</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #d1fae5' }}>Batch / Expiry</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #d1fae5' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #d1fae5' }}>Rate</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #d1fae5' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '10px 8px', border: '1px solid #e2e8f0', textAlign: 'center', color: '#64748b' }}>No items</td></tr>
            ) : items.map((it, i) => (
              <tr key={it.id ?? i}>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0' }}>{i + 1}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0' }}>
                  <div className="font-semibold">
                    {it.drug_name}
                    {(it.schedule === 'H' || it.schedule === 'H1' || it.schedule === 'X') && (
                      <span style={{ color: '#b91c1c', fontWeight: 700 }}> [Sch. {it.schedule}]</span>
                    )}
                  </div>
                  {(it.generic_name || it.strength) && (
                    <div className="text-slate-500 text-[10px]">
                      {[it.generic_name, it.strength, it.form].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0', fontSize: 10 }}>{it.batches || '—'}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{it.qty}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0', textAlign: 'right' }}>₹{inr(it.rate)}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 600 }}>₹{inr(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ===== Totals ===== */}
        <div className="flex justify-end mt-3">
          <table className="text-[12px]" style={{ minWidth: '70mm' }}>
            <tbody>
              <tr>
                <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>Subtotal</td>
                <td style={{ padding: '3px 10px', textAlign: 'right' }}>₹{inr(subtotal)}</td>
              </tr>
              {discount > 0 && (
                <tr>
                  <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>Discount</td>
                  <td style={{ padding: '3px 10px', textAlign: 'right', color: '#b91c1c' }}>− ₹{inr(discount)}</td>
                </tr>
              )}
              {/* GST is EXTRACTED from the MRP, not added — Indian medicine prices
                  are tax-inclusive, so this shows the tax already inside the total
                  rather than an extra charge. A registered clinic must show it. */}
              {Number(sale?.cgst_total) > 0 && (
                <>
                  <tr>
                    <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>Taxable value</td>
                    <td style={{ padding: '3px 10px', textAlign: 'right' }}>₹{inr(Number(sale.taxable_total) || 0)}</td>
                  </tr>
                  {Number(sale?.exempt_total) > 0 && (
                    <tr>
                      <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>Exempt value</td>
                      <td style={{ padding: '3px 10px', textAlign: 'right' }}>₹{inr(Number(sale.exempt_total) || 0)}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>CGST</td>
                    <td style={{ padding: '3px 10px', textAlign: 'right' }}>₹{inr(Number(sale.cgst_total) || 0)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 10px', textAlign: 'right', color: '#475569' }}>SGST</td>
                    <td style={{ padding: '3px 10px', textAlign: 'right' }}>₹{inr(Number(sale.sgst_total) || 0)}</td>
                  </tr>
                </>
              )}
              <tr style={{ background: '#ecfdf5' }}>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Total</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: 14 }}>₹{inr(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== Footer ===== */}
        <div className="mt-6 pt-3 text-[10px] text-slate-500" style={{ borderTop: '1px solid #e2e8f0' }}>
          {hasSchedule && (
            <div style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 4 }}>
              Schedule H / H1 drug(s) dispensed against a valid prescription. To be sold by retail on the prescription of a Registered Medical Practitioner only.
            </div>
          )}
          <div className="flex justify-between gap-6">
            <div>Medicines once sold are not returnable / exchangeable except as required by law. Please check batch &amp; expiry before use.</div>
            <div className="text-right whitespace-nowrap pt-5" style={{ borderTop: '1px dotted #94a3b8', minWidth: '45mm' }}>Pharmacist signature</div>
          </div>
        </div>
      </div>
    </div>
  );
}
