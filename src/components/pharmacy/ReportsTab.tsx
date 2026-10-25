/**
 * Reports — the three registers an inspector asks for, and the suppliers' accounts. (This used to be a popup behind a Reports button; now it is a tab.)
 * Each one opens an A4 print preview. Profit, margin and stock value are in Analytics → Pharmacy.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { todayISO } from '../../lib/utils';
import type { DrugSchedule } from '../../types';
import { DispensingRegisterPrint } from '../DispensingRegisterPrint';
import { StockRegisterPrint } from '../StockRegisterPrint';
import { PurchaseRegisterPrint } from '../PurchaseRegisterPrint';
import { SupplierAccountsPrint } from './SupplierAccountsPrint';
import { SupplierStatementPrintFor } from './SupplierStatementPrint';
import { Field, daysAgo } from './shared';

export function ReportsTab() {
  const [view, setView] = useState<'menu' | 'dispensing' | 'stock' | 'purchase' | 'accounts' | 'statement'>('menu');
  const [supplierId, setSupplierId] = useState(0);
  const { data: wholesalers = [] } = useQuery({ queryKey: ['wholesalers-all'], queryFn: () => window.electronAPI.wholesalers.list({ activeOnly: false }) });
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [schedule, setSchedule] = useState<DrugSchedule | 'ALL'>('H');
  const [includeExpired, setIncludeExpired] = useState(true);

  if (view === 'dispensing') {
    return (
      <DispensingRegisterPrint
        from={from}
        to={to}
        schedule={schedule === 'ALL' ? undefined : schedule}
        onClose={() => setView('menu')}
      />
    );
  }
  if (view === 'stock') return <StockRegisterPrint includeExpired={includeExpired} onClose={() => setView('menu')} />;
  if (view === 'purchase') return <PurchaseRegisterPrint from={from} to={to} onClose={() => setView('menu')} />;
  if (view === 'accounts') return <SupplierAccountsPrint onClose={() => setView('menu')} />;
  if (view === 'statement' && supplierId) return <SupplierStatementPrintFor supplierId={supplierId} onClose={() => setView('menu')} />;

  return (
    <section className="card p-4 space-y-4">
      <div className="text-xs text-gray-600 dark:text-slate-300">
        Each register opens an A4 print preview — use your browser's <b>Print</b> dialog to print on paper or
        <b> "Save as PDF"</b>. Profit, margin and stock value are in <b>Analytics → Pharmacy</b>.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* === Schedule H Dispensing Register === */}
        <div className="card p-3 space-y-2 flex flex-col">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">📋 Schedule H/H1 Dispensing Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Per-batch register — every dispense slice with date, patient, drug, batch, expiry, qty, doctor.
            Required by Karnataka inspectors for Schedule H drugs.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <div className="col-span-2">
              <Field label="Schedule">
                <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value as any)}>
                  <option value="H">H only</option>
                  <option value="H1">H1 only</option>
                  <option value="ALL">All schedules</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="flex justify-end mt-auto pt-1">
            <button className="btn-primary text-xs" onClick={() => setView('dispensing')}>
              <FileText className="w-3.5 h-3.5" /> Open Dispensing Register
            </button>
          </div>
        </div>

        {/* === Stock Register === */}
        <div className="card p-3 space-y-2 flex flex-col">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">📦 Stock Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Every batch currently in stock, sorted by drug then expiry. Highlights expired (red) and
            expiring within 90 days (amber). Includes manufacturer license number per batch.
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
            <span>Include expired batches still in stock (recommended for inspector visit)</span>
          </label>
          <div className="flex justify-end mt-auto pt-1">
            <button className="btn-primary text-xs" onClick={() => setView('stock')}>
              <FileText className="w-3.5 h-3.5" /> Open Stock Register
            </button>
          </div>
        </div>

        {/* === Purchase Register === */}
        <div className="card p-3 space-y-2 flex flex-col">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">🚚 Purchase Register</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            All purchase invoices in a date range with wholesaler drug license numbers, discount, GST,
            what was paid and what is still owed. The inspector's traceability source for any batch.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end mt-auto pt-1">
            <button className="btn-primary text-xs" onClick={() => setView('purchase')}>
              <FileText className="w-3.5 h-3.5" /> Open Purchase Register
            </button>
          </div>
        </div>

        {/* === Supplier accounts === */}
        <div className="card p-3 space-y-2 flex flex-col">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">🧾 Supplier accounts</div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            What you owe each supplier today and how old the unpaid bills are (0–30, 31–60, 61–90, over 90 days) — or one
            supplier’s full statement: every bill (credit) and payment (debit) with a running balance.
          </p>
          <div className="flex justify-end">
            <button className="btn-primary text-xs" onClick={() => setView('accounts')}>
              <FileText className="w-3.5 h-3.5" /> Open all supplier accounts
            </button>
          </div>
          <div className="border-t border-gray-100 dark:border-slate-800 pt-2 mt-auto">
            <Field label="One supplier's statement">
              <div className="flex gap-2">
                <select className="input flex-1" value={supplierId || ''} onChange={(e) => setSupplierId(Number(e.target.value))}>
                  <option value="">— Choose a supplier —</option>
                  {wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button className="btn-secondary text-xs" disabled={!supplierId} onClick={() => setView('statement')}>
                  <FileText className="w-3.5 h-3.5" /> Open statement
                </button>
              </div>
            </Field>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-slate-400 italic px-1">
        💡 For a full data dump (all sheets, every table), use <b>Settings → Backup → Backup Now</b> — the
        generated <code>.xlsx</code> includes the Drug List, Batches, Wholesalers, Invoices, Sales, and Dispensing Register sheets.
      </div>
    </section>
  );
}
