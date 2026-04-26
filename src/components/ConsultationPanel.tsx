import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, Save, Send, Plus, Trash2, FlaskConical } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { OpdSlip } from './OpdSlip';
import { Modal } from './Modal';
import type { AppointmentWithJoins, Consultation, Doctor, PrescriptionItem, Vitals } from '../types';

type RxRow = {
  /** When the receptionist later dispenses this Rx, knowing which inventory
   *  SKU the doctor meant kills fragile fuzzy-name matching at the pharmacy. */
  drug_master_id?: number | null;
  drug_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

const EMPTY_RX: RxRow = { drug_master_id: null, drug_name: '', dosage: '', frequency: '', duration: '', instructions: '' };

export function ConsultationPanel({
  appointment,
  doctor,
}: {
  appointment: AppointmentWithJoins;
  doctor: Doctor;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showSlip, setShowSlip] = useState(false);
  const [labPickerOpen, setLabPickerOpen] = useState(false);

  const { data: existing } = useQuery({
    queryKey: ['consultation', appointment.id],
    queryFn: () => window.electronAPI.consultations.getByAppointment(appointment.id),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const { data: rxItems = [] } = useQuery({
    queryKey: ['rx', appointment.id],
    queryFn: () => window.electronAPI.rx.getByAppointment(appointment.id),
  });

  const { data: labOrders = [] } = useQuery({
    queryKey: ['lab-orders-patient', appointment.patient_id, appointment.id],
    queryFn: () => window.electronAPI.lab.listOrders({ patient_id: appointment.patient_id }),
  });
  const relatedLabOrders = useMemo(
    () => labOrders.filter((o) => o.appointment_id === appointment.id),
    [labOrders, appointment.id]
  );

  const [history, setHistory] = useState('');
  const [examination, setExamination] = useState('');
  const [impression, setImpression] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [vitals, setVitals] = useState<Vitals>({});
  const [rxRows, setRxRows] = useState<RxRow[]>([{ ...EMPTY_RX }]);

  useEffect(() => {
    setHistory(existing?.history || '');
    setExamination(existing?.examination || '');
    setImpression(existing?.impression || '');
    setAdvice(existing?.advice || '');
    setFollowUp(existing?.follow_up_date || '');
    setVitals(existing?.vitals || {});
  }, [existing?.id, appointment.id]);

  useEffect(() => {
    if (rxItems.length > 0) {
      setRxRows(
        rxItems.map((r: PrescriptionItem) => ({
          drug_master_id: r.drug_master_id ?? null,
          drug_name: r.drug_name || '',
          dosage: r.dosage || '',
          frequency: r.frequency || '',
          duration: r.duration || '',
          instructions: r.instructions || '',
        }))
      );
    } else {
      setRxRows([{ ...EMPTY_RX }]);
    }
  }, [appointment.id, rxItems.length]);

  // Drug master for autocomplete
  const { data: drugCatalog = [] } = useQuery({
    queryKey: ['pharmacy-drugs-active'],
    queryFn: () => window.electronAPI.pharmacy.listDrugs({ activeOnly: true }),
  });

  const save = useMutation({
    mutationFn: async () => {
      await window.electronAPI.consultations.save({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        doctor_id: appointment.doctor_id,
        history,
        examination,
        impression,
        advice,
        vitals,
        follow_up_date: followUp || null,
      });
      await window.electronAPI.rx.saveAll(
        appointment.id,
        rxRows
          .filter((r) => r.drug_name.trim())
          .map((r) => ({
            drug_master_id: r.drug_master_id ?? null,
            drug_name: r.drug_name.trim(),
            dosage: r.dosage || null,
            frequency: r.frequency || null,
            duration: r.duration || null,
            instructions: r.instructions || null,
          }))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultation', appointment.id] });
      qc.invalidateQueries({ queryKey: ['rx', appointment.id] });
      toast('Consultation saved');
    },
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  const sendToReception = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      await window.electronAPI.appointments.updateStatus(appointment.id, 'Ready for Print');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast('Sent to reception for printing');
    },
    onError: (e: any) => toast(e.message || 'Failed to send', 'error'),
  });

  const onPrint = async () => {
    await save.mutateAsync();
    setShowSlip(true);
  };

  const setRx = (idx: number, patch: Partial<RxRow>) => {
    setRxRows((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addRxRow = () => setRxRows((rows) => [...rows, { ...EMPTY_RX }]);
  const removeRxRow = (idx: number) => setRxRows((rows) => rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows);

  const vitalsPreview: Consultation = {
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    doctor_id: appointment.doctor_id,
    history, examination, impression, advice,
    vitals, follow_up_date: followUp || null,
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          Consultation
        </h3>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-primary" onClick={onPrint} disabled={save.isPending}>
            <Printer className="w-4 h-4" /> Print OPD Slip
          </button>
          <button
            className="btn bg-cyan-600 text-white hover:bg-cyan-700 focus:ring-cyan-500"
            onClick={() => sendToReception.mutate()}
            disabled={sendToReception.isPending || save.isPending}
            title="Saves consultation and notifies reception to print the slip"
          >
            <Send className="w-4 h-4" /> {sendToReception.isPending ? 'Sending…' : 'Send to Reception'}
          </button>
        </div>
      </div>

      {/* Vitals */}
      <div>
        <div className="label">Vitals</div>
        <div className="grid grid-cols-4 gap-2">
          <VInput label="Temp (°F)" value={vitals.temp} placeholder="98.4" onChange={(v) => setVitals({ ...vitals, temp: v })} />
          <VInput label="Pulse" value={vitals.pulse} placeholder="78" onChange={(v) => setVitals({ ...vitals, pulse: v })} />
          <VInput label="RR" value={vitals.rr} placeholder="16" onChange={(v) => setVitals({ ...vitals, rr: v })} />
          <VInput label="SpO₂ (%)" value={vitals.spo2} placeholder="98" onChange={(v) => setVitals({ ...vitals, spo2: v })} />
          <VInput label="BP (mmHg)" value={vitals.bp} placeholder="120/80" onChange={(v) => setVitals({ ...vitals, bp: v })} />
          <VInput label="Weight (kg)" value={vitals.weight} placeholder="65" onChange={(v) => setVitals({ ...vitals, weight: v })} />
          <VInput label="Height (cm)" value={vitals.height} placeholder="170" onChange={(v) => setVitals({ ...vitals, height: v })} />
          <VInput label="Follow-up Date" value={followUp} placeholder="" type="date" onChange={setFollowUp} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 mt-4">
        <TextBlock label="Chief Complaints / History" value={history} onChange={setHistory} rows={3} />
        <TextBlock label="Examination" value={examination} onChange={setExamination} rows={3} />
        <TextBlock label="Impression / Diagnosis" value={impression} onChange={setImpression} rows={2} />
        <TextBlock label="Advice / Notes" value={advice} onChange={setAdvice} rows={3} />
      </div>

      {/* Rx / Prescription */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Prescription (Rx)</h4>
          <button className="btn-ghost text-xs" onClick={addRxRow}><Plus className="w-3.5 h-3.5" /> Add drug</button>
        </div>
        <div className="space-y-2">
          {rxRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr_auto] gap-2 items-start">
              <div>
                <input
                  className="input"
                  list="rx-drug-master"
                  placeholder="Drug name (e.g. Paracetamol 500mg)"
                  value={row.drug_name}
                  onChange={(e) => {
                    const typed = e.target.value;
                    const match = drugCatalog.find((d) => d.name === typed);
                    setRx(idx, match
                      ? { drug_master_id: match.id, drug_name: match.name }
                      : { drug_master_id: null, drug_name: typed }
                    );
                  }}
                />
                {row.drug_master_id != null && (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                    ✓ linked to inventory · auto-deducts on dispense
                  </div>
                )}
              </div>
              <input className="input" placeholder="Dosage (1 tab)" value={row.dosage} onChange={(e) => setRx(idx, { dosage: e.target.value })} />
              <input className="input" placeholder="Frequency (1-0-1)" value={row.frequency} onChange={(e) => setRx(idx, { frequency: e.target.value })} />
              <input className="input" placeholder="Duration (5 days)" value={row.duration} onChange={(e) => setRx(idx, { duration: e.target.value })} />
              <input className="input" placeholder="Instructions (after food)" value={row.instructions} onChange={(e) => setRx(idx, { instructions: e.target.value })} />
              <button
                type="button"
                className="p-2 text-red-500 hover:text-red-700 disabled:opacity-30"
                onClick={() => removeRxRow(idx)}
                disabled={rxRows.length === 1}
                title="Remove row"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <datalist id="rx-drug-master">
          {drugCatalog.map((d) => (
            <option key={d.id} value={d.name}>
              {[d.generic_name, d.form, d.strength, d.manufacturer].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
      </div>

      {/* Lab Orders */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-fuchsia-500" /> Lab Orders
          </h4>
          <button className="btn-secondary text-xs" onClick={() => setLabPickerOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Order Tests
          </button>
        </div>
        {relatedLabOrders.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-slate-400">No tests ordered yet.</div>
        ) : (
          <ul className="space-y-1">
            {relatedLabOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between text-xs border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
                <span className="font-mono text-gray-700 dark:text-slate-200">{o.order_number}</span>
                <span className="text-gray-500 dark:text-slate-400">{o.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {labPickerOpen && (
        <LabOrderPicker
          appointment={appointment}
          onClose={() => setLabPickerOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['lab-orders-patient', appointment.patient_id, appointment.id] });
            qc.invalidateQueries({ queryKey: ['lab-orders'] });
            setLabPickerOpen(false);
            toast('Lab order created');
          }}
        />
      )}

      {showSlip && settings && (
        <OpdSlip
          appointment={appointment}
          consultation={vitalsPreview}
          doctor={doctor}
          settings={settings}
          onClose={() => setShowSlip(false)}
        />
      )}
    </div>
  );
}

function LabOrderPicker({
  appointment,
  onClose,
  onCreated,
}: {
  appointment: AppointmentWithJoins;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: tests = [] } = useQuery({
    queryKey: ['lab-tests', true],
    queryFn: () => window.electronAPI.lab.listTests(true),
  });
  const [selected, setSelected] = useState<Record<number, true>>({});
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: () =>
      window.electronAPI.lab.createOrder({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        doctor_id: appointment.doctor_id,
        notes: notes || undefined,
        items: Object.keys(selected)
          .map((idStr) => Number(idStr))
          .map((id) => {
            const t = tests.find((x) => x.id === id);
            return { lab_test_id: id, test_name: t?.name || '' };
          })
          .filter((i) => i.test_name),
      }),
    onSuccess: onCreated,
  });

  const selectedCount = Object.keys(selected).length;

  return (
    <Modal open onClose={onClose} title="Order Lab Tests" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-auto p-1">
          {tests.map((t) => {
            const isSelected = !!selected[t.id];
            return (
              <label
                key={t.id}
                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    setSelected((s) => {
                      const copy = { ...s };
                      if (e.target.checked) copy[t.id] = true;
                      else delete copy[t.id];
                      return copy;
                    });
                  }}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{t.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">
                    {t.sample_type ? `${t.sample_type} · ` : ''}₹{t.price}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={selectedCount === 0 || create.isPending}>
            {create.isPending ? 'Creating…' : `Create Order (${selectedCount})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function VInput({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="label" style={{ fontSize: 10 }}>{label}</label>
      <input
        type={type}
        className="input"
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function TextBlock({
  label, value, onChange, rows, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
