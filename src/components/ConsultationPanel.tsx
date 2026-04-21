import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, Save, Send } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { OpdSlip } from './OpdSlip';
import type { AppointmentWithJoins, Consultation, Doctor, Vitals } from '../types';

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

  const { data: existing } = useQuery({
    queryKey: ['consultation', appointment.id],
    queryFn: () => window.electronAPI.consultations.getByAppointment(appointment.id),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const [history, setHistory] = useState('');
  const [examination, setExamination] = useState('');
  const [impression, setImpression] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [vitals, setVitals] = useState<Vitals>({});

  useEffect(() => {
    setHistory(existing?.history || '');
    setExamination(existing?.examination || '');
    setImpression(existing?.impression || '');
    setAdvice(existing?.advice || '');
    setFollowUp(existing?.follow_up_date || '');
    setVitals(existing?.vitals || {});
  }, [existing?.id, appointment.id]);

  const save = useMutation({
    mutationFn: () =>
      window.electronAPI.consultations.save({
        appointment_id: appointment.id,
        patient_id: appointment.patient_id,
        doctor_id: appointment.doctor_id,
        history,
        examination,
        impression,
        advice,
        vitals,
        follow_up_date: followUp || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultation', appointment.id] });
      toast('Consultation saved');
    },
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  const onPrint = async () => {
    await save.mutateAsync();
    setShowSlip(true);
  };

  const sendToReception = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      await window.electronAPI.appointments.updateStatus(appointment.id, 'Ready for Print');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['ready-for-print'] });
      toast('Sent to reception for printing');
    },
    onError: (e: any) => toast(e.message || 'Failed to send', 'error'),
  });

  const vitalsPreview: Consultation = {
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    doctor_id: appointment.doctor_id,
    history, examination, impression, advice,
    vitals, follow_up_date: followUp || null,
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
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
          <VInput label="BP (mmHg)" value={vitals.bp} placeholder="120/80" onChange={(v) => setVitals({ ...vitals, bp: v })} />
          <VInput label="Pulse" value={vitals.pulse} placeholder="78" onChange={(v) => setVitals({ ...vitals, pulse: v })} />
          <VInput label="Temp (°F)" value={vitals.temp} placeholder="98.4" onChange={(v) => setVitals({ ...vitals, temp: v })} />
          <VInput label="SpO₂ (%)" value={vitals.spo2} placeholder="98" onChange={(v) => setVitals({ ...vitals, spo2: v })} />
          <VInput label="RR" value={vitals.rr} placeholder="16" onChange={(v) => setVitals({ ...vitals, rr: v })} />
          <VInput label="Weight (kg)" value={vitals.weight} placeholder="65" onChange={(v) => setVitals({ ...vitals, weight: v })} />
          <VInput label="Height (cm)" value={vitals.height} placeholder="170" onChange={(v) => setVitals({ ...vitals, height: v })} />
          <VInput label="Follow-up Date" value={followUp} placeholder="" type="date" onChange={setFollowUp} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 mt-4">
        <TextBlock label="Chief Complaints / History" value={history} onChange={setHistory} rows={3} />
        <TextBlock label="Examination" value={examination} onChange={setExamination} rows={3} />
        <TextBlock label="Impression / Diagnosis" value={impression} onChange={setImpression} rows={2} />
        <TextBlock label="Advice / Rx" value={advice} onChange={setAdvice} rows={4} placeholder={"Tab. Paracetamol 500mg — 1-0-1 × 3 days\nPlenty of fluids\nReview if fever persists"} />
      </div>

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
