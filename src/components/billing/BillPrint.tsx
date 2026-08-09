import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer, X } from 'lucide-react';
import type { Settings } from '../../types';

/**
 * Printable bill on the clinic letterhead, matching the OPD slip's header so a
 * clinic's bills and prescriptions look like one family of documents.
 *
 * Uses the shared .print-area / @media print scaffold in index.css: everything
 * outside .print-area is hidden when the browser prints.
 *
 * The document TITLE switches automatically:
 *   - any taxable line  → "TAX INVOICE" with CGST/SGST columns
 *   - otherwise         → "BILL OF SUPPLY" (or "RECEIPT" when GST is off)
 * A single consolidated bill can legally hold both exempt and taxable lines, so
 * the exempt and taxable subtotals are always shown separately.
 */
function inr(n: number): string {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Amount in words (Indian system) for the total-in-words line invoices need. */
function inWords(num: number): string {
  const n = Math.round(num);
  if (n === 0) return 'Zero Rupees';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number): string => x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`;
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return `${h ? ones[h] + ' Hundred' + (r ? ' ' : '') : ''}${r ? two(r) : ''}`;
  };
  let words = '';
  const crore = Math.floor(n / 10000000); let rem = n % 10000000;
  const lakh = Math.floor(rem / 100000); rem %= 100000;
  const thousand = Math.floor(rem / 1000); rem %= 1000;
  if (crore) words += three(crore) + ' Crore ';
  if (lakh) words += three(lakh) + ' Lakh ';
  if (thousand) words += three(thousand) + ' Thousand ';
  if (rem) words += three(rem);
  return words.trim() + ' Rupees';
}

export function BillPrint({ admissionId, billId, onClose }: {
  admissionId?: number; billId?: number; onClose: () => void;
}) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data, isLoading } = useQuery({
    queryKey: ['bill-print', admissionId, billId],
    queryFn: () => window.electronAPI.billing.previewAdmission(admissionId!),
    enabled: !!admissionId,
  });

  if (isLoading || !settings) {
    return <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center"><div className="card p-8">Loading…</div></div>;
  }

  const s = settings as Settings;
  const bill = data?.bill;
  const items = data?.items || [];
  const totals = data?.totals;
  const isTax = totals?.isTaxInvoice;
  const title = !s.gst_enabled ? 'RECEIPT' : isTax ? 'TAX INVOICE' : 'BILL OF SUPPLY';

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-auto p-4 no-print-bg">
      {/* Toolbar — hidden when printing */}
      <div className="no-print max-w-[210mm] mx-auto flex justify-end gap-2 mb-2">
        <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
        <button className="btn-secondary" onClick={onClose}><X className="w-4 h-4" /> Close</button>
      </div>

      <div className="print-area mx-auto bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm' }}>
        {/* ===== Letterhead (mirrors OpdSlip) ===== */}
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
            <div className="text-[11px] text-slate-600">
              {s.clinic_phone && <>☎ {s.clinic_phone} </>}
              {s.clinic_registration_no && <> · Reg. {s.clinic_registration_no}</>}
              {s.gst_enabled && s.clinic_gstin && <> · GSTIN: {s.clinic_gstin}</>}
            </div>
          </div>
        </div>

        {/* ===== Title ===== */}
        <div className="text-center my-3">
          <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>{title}</span>
        </div>

        {/* ===== Bill meta ===== */}
        <div className="flex justify-between text-[12px] mb-3">
          <div>
            <div><b>Patient:</b> {bill?.patient_name || data?.patient_name || '—'}</div>
            <div className="text-slate-600">{bill?.patient_uhid || ''}</div>
          </div>
          <div className="text-right">
            <div><b>Invoice #:</b> {bill?.bill_number || '—'}</div>
            <div className="text-slate-600">{bill?.created_at ? new Date(bill.created_at).toLocaleString('en-IN') : ''}</div>
          </div>
        </div>

        {/* ===== Items ===== */}
        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={cellHead}>#</th>
              <th style={{ ...cellHead, textAlign: 'left' }}>Description</th>
              {isTax && <th style={cellHead}>HSN/SAC</th>}
              <th style={cellHead}>Qty</th>
              <th style={cellHead}>Rate</th>
              {isTax && <th style={cellHead}>Taxable</th>}
              {isTax && <th style={cellHead}>CGST</th>}
              {isTax && <th style={cellHead}>SGST</th>}
              <th style={{ ...cellHead, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={it.id}>
                <td style={cell}>{i + 1}</td>
                <td style={{ ...cell, textAlign: 'left' }}>{it.description}{!it.is_taxable && s.gst_enabled ? ' (Exempt)' : ''}</td>
                {isTax && <td style={cell}>{it.hsn_sac || '—'}</td>}
                <td style={cell}>{it.qty}</td>
                <td style={cell}>{inr(it.rate)}</td>
                {isTax && <td style={cell}>{it.is_taxable ? inr(it.amount) : '—'}</td>}
                {isTax && <td style={cell}>{it.cgst ? inr(it.cgst) : '—'}</td>}
                {isTax && <td style={cell}>{it.sgst ? inr(it.sgst) : '—'}</td>}
                <td style={{ ...cell, textAlign: 'right' }}>{inr(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ===== Totals ===== */}
        {totals && (
          <div className="flex justify-end mt-3">
            <table className="text-[12px]" style={{ minWidth: '70mm' }}>
              <tbody>
                <tr><td className="pr-6 text-slate-600">Subtotal</td><td className="text-right">₹{inr(totals.subtotal)}</td></tr>
                {totals.discountValue > 0 && <tr><td className="pr-6 text-slate-600">Discount</td><td className="text-right">− ₹{inr(totals.discountValue)}</td></tr>}
                {totals.exemptTotal > 0 && isTax && <tr><td className="pr-6 text-slate-600">Exempt supply</td><td className="text-right">₹{inr(totals.exemptTotal)}</td></tr>}
                {totals.taxableTotal > 0 && <tr><td className="pr-6 text-slate-600">Taxable value</td><td className="text-right">₹{inr(totals.taxableTotal)}</td></tr>}
                {totals.cgstTotal > 0 && <tr><td className="pr-6 text-slate-600">CGST</td><td className="text-right">₹{inr(totals.cgstTotal)}</td></tr>}
                {totals.sgstTotal > 0 && <tr><td className="pr-6 text-slate-600">SGST</td><td className="text-right">₹{inr(totals.sgstTotal)}</td></tr>}
                {totals.roundOff !== 0 && <tr><td className="pr-6 text-slate-600">Round off</td><td className="text-right">₹{inr(totals.roundOff)}</td></tr>}
                <tr style={{ borderTop: '1px solid #cbd5e1' }}><td className="pr-6 font-bold pt-1">Total</td><td className="text-right font-bold pt-1">₹{inr(totals.total)}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {totals && <div className="text-[11px] text-slate-600 mt-2"><b>In words:</b> {inWords(totals.total)} only</div>}

        {/* ===== Footer ===== */}
        <div className="flex justify-between items-end mt-12 text-[11px]">
          <div className="text-slate-500">
            {s.gst_enabled && !isTax && <div>Clinical services are exempt from GST.</div>}
            <div>This is a computer-generated document.</div>
          </div>
          <div className="text-center">
            <div style={{ borderTop: '1px solid #94a3b8', width: '50mm', paddingTop: 4 }}>Authorised Signatory</div>
            <div className="text-slate-600 mt-0.5">For {s.clinic_name}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const cellHead: React.CSSProperties = { border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'center', fontWeight: 700 };
const cell: React.CSSProperties = { border: '1px solid #e2e8f0', padding: '3px 6px', textAlign: 'center' };
