import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { Modal } from '../Modal';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn, formatINR } from '../../lib/utils';
import { RadiologyTestPicker, pickedSummary } from './RadiologyTestPicker';
import type { Patient, RadiologyOrderDetail } from '../../types';

type PayMode = 'Cash' | 'UPI' | 'Card';

/**
 * Raise a radiology request straight from the Radiology desk — a walk-in with a doctor's
 * slip, or a patient the clinic already knows. Pick the patient, who referred them, the
 * scans, and either take the money now or leave the bill to be paid later. The bill is
 * raised automatically from the scan prices.
 */
export function NewRadiologyRequest({
  onClose, onCreated, presetPatient,
}: {
  onClose: () => void;
  onCreated: (order: RadiologyOrderDetail) => void;
  presetPatient?: Patient | null;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState<Patient | null>(presetPatient ?? null);
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [referredBy, setReferredBy] = useState('');
  const [referredOther, setReferredOther] = useState(false);
  const [clinicalInfo, setClinicalInfo] = useState('');
  const [selected, setSelected] = useState<Record<number, true>>({});
  const [collectNow, setCollectNow] = useState(true);
  const [payMode, setPayMode] = useState<PayMode>('Cash');
  const [busy, setBusy] = useState(false);

  const { data: results = [] } = useQuery({
    queryKey: ['rad-patient-search', q],
    queryFn: () => window.electronAPI.patients.search(q),
    enabled: !patient && q.trim().length > 0,
  });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const { data: referrers = [] } = useQuery({ queryKey: ['referring-doctors'], queryFn: () => window.electronAPI.referringDoctors.list(true) });
  const { data: tests = [] } = useQuery({ queryKey: ['radiology-tests', true], queryFn: () => window.electronAPI.radiology.listTests(true) });

  const sum = pickedSummary(tests, selected);

  const submit = async () => {
    if (!patient) return toast('Pick the patient first.', 'error');
    if (sum.count === 0) return toast('Tick at least one scan.', 'error');
    setBusy(true);
    try {
      const r = await window.electronAPI.radiology.createOrder({
        patient_id: patient.id,
        doctor_id: doctorId ? Number(doctorId) : null,
        referred_by: referredBy.trim() || null,
        clinical_info: clinicalInfo.trim() || null,
        items: Object.keys(selected).map((id) => ({ test_id: Number(id) })),
      });
      if (!r.ok) { toast(r.error, 'error'); return; }
      const order = r.order;
      if (collectNow && order.bill_id && Number(order.bill_total) > 0) {
        const pay = await window.electronAPI.billing.pay(Number(order.bill_id), Number(order.bill_total), payMode, user?.username);
        if (!pay.ok) toast(`Order ${order.order_number} created, but the payment was not recorded: ${pay.error || 'unknown error'}. Collect it from the order screen.`, 'error');
        else toast(`${order.order_number} created — ${formatINR(Number(order.bill_total))} received (${payMode}).`, 'success');
      } else {
        toast(
          order.bill_id
            ? `${order.order_number} created — bill ${order.bill_number} raised for the counter.`
            : `${order.order_number} created — no bill (none of these scans has a price).`,
          'success',
        );
      }
      onCreated(order);
    } catch (e: any) {
      toast(e?.message || 'Could not create the radiology request.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New Radiology Request" size="lg">
      <div className="space-y-4">
        {/* Patient */}
        {!patient ? (
          <div>
            <label className="label">Patient *</label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
              <input className="input pl-9" autoFocus placeholder="Search by name, phone or UHID…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {q.trim() && (
              <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700">
                {results.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500">No patients found — register the patient in Reception first.</div>
                ) : results.slice(0, 12).map((p) => (
                  <button key={p.id} type="button" onClick={() => setPatient(p)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 border-b border-gray-100 dark:border-slate-800 last:border-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                    <div className="text-[11px] text-gray-500">{p.uhid} · {p.phone}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{patient.first_name} {patient.last_name}</div>
              <div className="text-[11px] text-gray-500">{patient.uhid} · {patient.phone}</div>
            </div>
            {!presetPatient && <button type="button" className="btn-ghost text-xs" onClick={() => setPatient(null)}><X className="w-3.5 h-3.5" /> Change</button>}
          </div>
        )}

        {/* Doctors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Consulting doctor <span className="text-gray-400 font-normal">(optional)</span></label>
            <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— none —</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Referred by <span className="text-gray-400 font-normal">(optional)</span></label>
            {referredOther ? (
              <div className="flex items-center gap-2">
                <input className="input" autoFocus value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="Doctor's name" />
                <button type="button" className="text-xs text-gray-500 hover:underline whitespace-nowrap" onClick={() => { setReferredOther(false); setReferredBy(''); }}>List</button>
              </div>
            ) : (
              <select className="input"
                value={referrers.some((r) => r.name === referredBy) ? referredBy : ''}
                onChange={(e) => { if (e.target.value === '__other__') { setReferredOther(true); setReferredBy(''); } else setReferredBy(e.target.value); }}>
                <option value="">— none —</option>
                {referrers.map((r) => <option key={r.id} value={r.name}>Dr. {r.name}{r.place ? ` · ${r.place}` : ''}</option>)}
                <option value="__other__">Other (type a name)…</option>
              </select>
            )}
          </div>
        </div>

        {/* Scans */}
        <div>
          <label className="label">Scans *</label>
          <RadiologyTestPicker
            tests={tests}
            selected={selected}
            onToggle={(id, on) => setSelected((s) => { const c = { ...s }; if (on) c[id] = true; else delete c[id]; return c; })}
          />
        </div>

        <div>
          <label className="label">Clinical information <span className="text-gray-400 font-normal">(shown to the radiologist)</span></label>
          <textarea className="input" rows={2} value={clinicalInfo} onChange={(e) => setClinicalInfo(e.target.value)}
            placeholder="e.g. Fall from height, pain in right wrist, ? fracture" />
        </div>

        {/* Money */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700 dark:text-slate-300">
              {sum.count} scan{sum.count === 1 ? '' : 's'} · <b className="text-gray-900 dark:text-slate-100">{formatINR(sum.total)}</b>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={collectNow} onChange={() => setCollectNow(true)} /> Collect now
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={!collectNow} onChange={() => setCollectNow(false)} /> Pay later
              </label>
            </div>
          </div>
          {collectNow && sum.total > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">Payment mode:</span>
              {(['Cash', 'UPI', 'Card'] as PayMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setPayMode(m)}
                  className={cn('px-3 py-1 text-xs rounded-md border', payMode === m ? 'bg-sky-600 text-white border-sky-600' : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300')}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {sum.unpriced.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-300">
              <b>{sum.unpriced.length} selected scan{sum.unpriced.length === 1 ? ' has' : 's have'} no price</b> and will not be billed: {sum.unpriced.map((t) => t.name).join(', ')}. Set prices under Catalogue &amp; Prices.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !patient || sum.count === 0} onClick={submit}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create request{collectNow && sum.total > 0 ? ' & take payment' : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
