import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Info } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { NumberInput } from '../NumberInput';
import type { Settings } from '../../types';

/**
 * A small labelled explanation shown under a control. This module leans on these
 * heavily on purpose: the software ships to many clinics, and the person setting
 * up GST is rarely the person who understands GST.
 */
function Explain({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 flex gap-1.5">
      <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
      <span>{children}</span>
    </div>
  );
}

export function BillingSettings({
  draft, set,
}: {
  draft: Partial<Settings>;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
}) {
  const gstOn = draft.gst_enabled ?? false;
  const regType = draft.gst_registration_type ?? 'unregistered';

  return (
    <div className="space-y-5">
      {/* ---- GST registration ---- */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">GST &amp; Invoicing</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            How bills are taxed and titled. If your clinic is not GST-registered, leave this off — bills print as
            simple receipts with no tax.
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={gstOn}
            onChange={(e) => set('gst_enabled', e.target.checked)} />
          <div>
            <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">This clinic is GST-registered</div>
            <Explain>
              In India, registration is generally required once turnover crosses about ₹20 lakh for services or ₹40 lakh
              for goods. If you are unsure, ask your accountant. When off, no tax appears on any bill.
            </Explain>
          </div>
        </label>

        {gstOn && (
          <div className="pl-6 space-y-4 border-l-2 border-blue-200 dark:border-blue-900">
            <div>
              <label className="label">Registration type</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                {[
                  { v: 'regular', t: 'Regular', d: 'You collect GST from patients and file monthly/quarterly returns. Bills show CGST + SGST.' },
                  { v: 'composition', t: 'Composition', d: 'You pay a flat rate and cannot collect GST on the bill. Bills print as a Bill of Supply.' },
                ].map((o) => (
                  <button key={o.v} type="button" onClick={() => set('gst_registration_type', o.v as any)}
                    className={cn('rounded-lg border-2 p-3 text-left transition',
                      regType === o.v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-slate-700 hover:border-blue-400')}>
                    <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100">{o.t}</div>
                    <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5">{o.d}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">GSTIN</label>
                <input className="input font-mono uppercase" maxLength={15} placeholder="29ABCDE1234F1Z5"
                  value={draft.clinic_gstin || ''} onChange={(e) => set('clinic_gstin', e.target.value.toUpperCase())} />
                <Explain>Your 15-character GST number. It is printed on every tax invoice.</Explain>
              </div>
              <div>
                <label className="label">State code</label>
                <input className="input" maxLength={2} placeholder="29"
                  value={draft.clinic_state_code || ''} onChange={(e) => set('clinic_state_code', e.target.value)} />
                <Explain>The first two digits of your GSTIN (e.g. 29 for Karnataka). Used to split tax into CGST + SGST.</Explain>
              </div>
              <div className="md:col-span-2">
                <label className="label">Legal name (if different from clinic name)</label>
                <input className="input" placeholder="As registered on the GSTIN"
                  value={draft.clinic_legal_name || ''} onChange={(e) => set('clinic_legal_name', e.target.value)} />
              </div>
            </div>

            {regType === 'regular' && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={draft.healthcare_gst_exempt ?? true}
                  onChange={(e) => set('healthcare_gst_exempt', e.target.checked)} />
                <div>
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                    Treat consultations and clinical services as GST-exempt
                  </div>
                  <Explain>
                    Recommended. Healthcare services by a recognised practitioner are exempt from GST in India, so
                    consultations should not be taxed. Medicines you dispense are still taxed at their own rate. Turning
                    this off would charge tax on consultations — only do that on your accountant's advice.
                  </Explain>
                </div>
              </label>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <div>
            <label className="label">Invoice number prefix</label>
            <input className="input" value={draft.invoice_prefix || 'INV'}
              onChange={(e) => set('invoice_prefix', e.target.value)} />
            <Explain>Bills are numbered like <code>{(draft.invoice_prefix || 'INV')}/2026-27/0001</code>, restarting each financial year.</Explain>
          </div>
          <div>
            <label className="label">Admission number prefix</label>
            <input className="input" value={draft.ip_number_prefix || 'IP'}
              onChange={(e) => set('ip_number_prefix', e.target.value)} />
            <Explain>Admissions are numbered like <code>{(draft.ip_number_prefix || 'IP')}/2026-27/0001</code>.</Explain>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={draft.bill_round_off ?? true}
            onChange={(e) => set('bill_round_off', e.target.checked)} />
          <div>
            <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Round bill totals to the nearest rupee</div>
            <Explain>A bill of ₹612.40 is shown as ₹612, with the ₹0.40 recorded as a round-off line. Most clinics keep this on.</Explain>
          </div>
        </label>
      </div>

      {/* ---- Charge heads ---- */}
      <ChargeHeadsEditor />

      {/* ---- Discounts ---- */}
      <DiscountSettings draft={draft} set={set} />
    </div>
  );
}

// =====================================================================

const CHARGE_CATEGORIES = [
  { value: 'doctor', label: 'Doctor', colour: '#7c3aed' },
  { value: 'bed', label: 'Bed', colour: '#2563eb' },
  { value: 'nursing', label: 'Nursing', colour: '#0d9488' },
  { value: 'procedure', label: 'Procedure', colour: '#db2777' },
  { value: 'lab', label: 'Laboratory', colour: '#d97706' },
  { value: 'pharmacy', label: 'Pharmacy', colour: '#059669' },
  { value: 'other', label: 'Other', colour: '#64748b' },
];

function ChargeHeadsEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: heads = [], refetch } = useQuery({
    queryKey: ['charge-heads-all'],
    queryFn: () => window.electronAPI.chargeHeads.list(),
  });

  const save = async (h: any) => {
    setBusy(true);
    try {
      const r = await window.electronAPI.chargeHeads.save(h);
      if (r.ok) { toast(h.id ? 'Charge updated' : 'Charge added', 'success'); setEditing(null); await refetch(); }
      else toast(r.error, 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Charge Heads</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Everything your clinic can put on a bill — consultation, bed, nursing, procedures, oxygen, and so on.
            Each gets a colour so staff can see at a glance where a bill's money is going.
          </div>
        </div>
        <button className="btn-primary text-xs"
          onClick={() => setEditing({ category: 'other', default_rate: 0, gst_rate: 0, is_taxable: false, applies_to: 'both', colour: '#64748b' })}>
          <Plus className="w-3.5 h-3.5" /> Add charge
        </button>
      </div>

      {editing && (
        <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Name *</label>
              <input className="input" value={editing.name || ''} placeholder="e.g. Oxygen per hour"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={editing.category}
                onChange={(e) => { const c = CHARGE_CATEGORIES.find((x) => x.value === e.target.value); setEditing({ ...editing, category: e.target.value, colour: c?.colour || editing.colour }); }}>
                {CHARGE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default rate (₹)</label>
              <NumberInput className="input" min={0} allowDecimal value={editing.default_rate}
                onChange={(n) => setEditing({ ...editing, default_rate: n })} />
            </div>
            <div>
              <label className="label">Applies to</label>
              <select className="input" value={editing.applies_to}
                onChange={(e) => setEditing({ ...editing, applies_to: e.target.value })}>
                <option value="both">OPD and IPD</option>
                <option value="opd">OPD only</option>
                <option value="ipd">IPD only</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={editing.is_taxable}
              onChange={(e) => setEditing({ ...editing, is_taxable: e.target.checked })} />
            <div>
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">This charge is taxable (GST applies)</div>
              <Explain>Leave off for consultations and clinical services, which are GST-exempt. Turn on for taxable goods.</Explain>
            </div>
          </label>

          {editing.is_taxable && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
              <div>
                <label className="label">GST rate (%)</label>
                <select className="input" value={editing.gst_rate}
                  onChange={(e) => setEditing({ ...editing, gst_rate: Number(e.target.value) })}>
                  {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div>
                <label className="label">HSN / SAC code</label>
                <input className="input" value={editing.hsn_sac || ''}
                  onChange={(e) => setEditing({ ...editing, hsn_sac: e.target.value })} />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn-primary text-xs" disabled={busy} onClick={() => save(editing)}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save
            </button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {heads.map((h: any) => (
          <button key={h.id} onClick={() => setEditing(h)}
            className="inline-flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition hover:border-blue-400 dark:border-slate-700">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: h.colour || '#94a3b8' }} />
            <span>
              <span className="block text-[12px] font-semibold text-gray-900 dark:text-slate-100">{h.name}</span>
              <span className="block text-[10px] text-gray-500">
                ₹{h.default_rate}{h.is_taxable ? ` · ${h.gst_rate}% GST` : ' · exempt'}
              </span>
            </span>
          </button>
        ))}
        {heads.length === 0 && (
          <div className="text-[12px] text-gray-500">No charges yet — add your first, such as "Consultation".</div>
        )}
      </div>
    </div>
  );
}

// =====================================================================

const DISCOUNT_ROLES = ['receptionist', 'nurse', 'ward_incharge', 'doctor', 'admin'];

function DiscountSettings({
  draft, set,
}: {
  draft: Partial<Settings>;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
}) {
  let caps: Record<string, number> = {};
  try { caps = JSON.parse(draft.discount_caps_json || '{}'); } catch { caps = {}; }

  const setCap = (role: string, pct: number) => {
    const next = { ...caps, [role]: Math.max(0, Math.min(100, pct)) };
    set('discount_caps_json', JSON.stringify(next));
  };

  return (
    <div className="card p-5 space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Discounts</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          The most each role may take off a bill. A discount above the limit is refused and must be applied by someone
          with a higher cap. Every discount is recorded in the audit log.
        </div>
      </div>

      <div className="space-y-2">
        {DISCOUNT_ROLES.map((role) => (
          <div key={role} className="flex items-center gap-3">
            <div className="w-40 text-[13px] text-gray-900 dark:text-slate-100 capitalize">{role.replace('_', ' ')}</div>
            <NumberInput min={0} max={100} className="input w-24" value={caps[role]}
              onChange={(n) => setCap(role, n)} />
            <span className="text-[12px] text-gray-500">% maximum</span>
          </div>
        ))}
      </div>
      <Explain>
        Set a role to 0 to stop it discounting at all. Admin is usually 100 (no limit). These are percentages of the
        bill; a flat-rupee discount is checked against the same limit.
      </Explain>

      <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-gray-100 dark:border-slate-800">
        <input type="checkbox" className="mt-1" checked={draft.discount_require_reason ?? true}
          onChange={(e) => set('discount_require_reason', e.target.checked)} />
        <div>
          <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Require a reason for every discount</div>
          <Explain>Staff must type why the discount was given. Recommended — it shows up in the audit log next to who gave it.</Explain>
        </div>
      </label>
    </div>
  );
}
