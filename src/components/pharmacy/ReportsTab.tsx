/**
 * Reports — the three registers an inspector asks for. (This used to be a popup behind a Reports button; now it is a tab.)
 * Each one opens an A4 print preview. Profit, margin and stock value are in Analytics → Pharmacy.
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { todayISO } from '../../lib/utils';
import type { DrugSchedule } from '../../types';
import { DispensingRegisterPrint } from '../DispensingRegisterPrint';
import { StockRegisterPrint } from '../StockRegisterPrint';
import { PurchaseRegisterPrint } from '../PurchaseRegisterPrint';
import { Field, daysAgo } from './shared';

export function ReportsTab() {
  const [view, setView] = useState<'menu' | 'dispensing' | 'stock' | 'purchase'>('menu');
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

  return (
    <section className="card p-4 space-y-4">
      <div className="text-xs text-gray-600 dark:text-slate-300">
        Each register opens an A4 print preview — use your browser's <b>Print</b> dialog to print on paper or
        <b> "Save as PDF"</b>. Profit, margin and stock value are in <b>Analytics → Pharmacy</b>.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
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
            All purchase invoices in a date range with wholesaler drug license numbers, GST breakdown,
            and payment status. The inspector's traceability source for any batch.
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
      </div>

      <div className="text-[11px] text-gray-500 dark:text-slate-400 italic px-1">
        💡 For a full data dump (all sheets, every table), use <b>Settings → Backup → Backup Now</b> — the
        generated <code>.xlsx</code> includes the Drug List, Batches, Wholesalers, Invoices, Sales, and Dispensing Register sheets.
      </div>
    </section>
  );
}
