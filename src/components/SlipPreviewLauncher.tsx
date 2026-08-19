import { useState } from 'react';
import { PREVIEW_APPOINTMENT_ID } from '../db/slip-templates';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, Printer } from 'lucide-react';
import { OpdSlip } from './OpdSlip';
import type { AppointmentWithJoins, Consultation, Doctor } from '../types';

/**
 * Settings-side preview of the OPD slip with fake patient + visit data.
 * Doctor selector + template slot picker let admins verify any template.
 */
export function SlipPreviewLauncher() {
  const [open, setOpen] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<1 | 2 | 3>(1);
  const [previewNonce, setPreviewNonce] = useState(0);
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
    refetchOnMount: 'always',
  });
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
    refetchOnMount: 'always',
  });

  const openPreview = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['settings'] }),
      qc.invalidateQueries({ queryKey: ['doctors'] }),
      qc.invalidateQueries({ queryKey: ['doctors-all'] }),
      qc.invalidateQueries({ queryKey: ['slip-templates'] }),
    ]);
    setPreviewNonce((n) => n + 1);
    setOpen(true);
  };

  if (!settings) return null;

  const activeDoctors = (doctors as Doctor[]).filter((d) => d.is_active);
  const pickedDoctor: Doctor = activeDoctors.find((d) => d.id === selectedDoctorId) ?? activeDoctors[0] ?? {
    id: 1,
    name: 'Dr. A. Sharma',
    specialty: 'General Physician',
    phone: '9019263206',
    email: 'sunil@mmc.clinic',
    room_number: '101',
    is_active: 1,
    default_fee: 500,
    qualifications: 'MBBS, MD (Medicine)',
    registration_no: 'KMC-12345',
    signature: null,
    color: '#10b981',
  };

  // Build a "preview doctor" with the selected slot's template_id swapped into template_id slot 1
  const slotNames: string[] = (() => {
    try { return JSON.parse(pickedDoctor.template_slot_names ?? '[]'); } catch { return []; }
  })();
  const templateIds: (number | null | undefined)[] = [
    pickedDoctor.template_id ?? null,
    pickedDoctor.template_id_2 ?? null,
    pickedDoctor.template_id_3 ?? null,
  ];
  const availableSlots = templateIds.map((tid, i) => ({ slot: (i + 1) as 1 | 2 | 3, tid, name: slotNames[i] || `Template ${i + 1}` }))
    .filter((s) => s.tid != null);

  const previewDoctor: Doctor = {
    ...pickedDoctor,
    template_id: templateIds[selectedSlot - 1] ?? pickedDoctor.template_id,
  };

  const today = new Date();
  const dobYears3 = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate() - 12);
  const sampleAppointment: AppointmentWithJoins = {
    id: PREVIEW_APPOINTMENT_ID,
    patient_id: 9999,
    doctor_id: pickedDoctor.id,
    appointment_date: today.toISOString().slice(0, 10),
    appointment_time: '10:30',
    token_number: 7,
    consultation_token: null,
    status: 'Done',
    notes: 'Fever since 3 days, cough, body ache',
    created_at: today.toISOString(),
    patient_name: 'Rohit Kulkarni (sample)',
    patient_uhid: 'PT-PREVIEW-0001',
    patient_dob: dobYears3.toISOString().slice(0, 10),
    patient_gender: 'M',
    patient_phone: '9876543210',
    patient_blood_group: 'O+',
    patient_created_at: today.toISOString(),
    doctor_name: pickedDoctor.name,
    doctor_specialty: pickedDoctor.specialty,
    doctor_room: pickedDoctor.room_number,
  } as AppointmentWithJoins;

  const sampleConsultation: Consultation = {
    id: 9999,
    appointment_id: PREVIEW_APPOINTMENT_ID,
    patient_id: 9999,
    doctor_id: pickedDoctor.id,
    history: 'Fever since 3 days, cough, body ache. No vomiting or loose stools. Eating reduced since yesterday.',
    examination: 'Throat congested, mild tonsillar enlargement. Chest clear. CVS — S1 S2 normal. P/A — soft, non-tender.',
    impression: 'Acute viral upper respiratory tract infection.',
    advice: 'Steam inhalation BD\nWarm fluids generously\nReturn for review if fever persists > 48h or any new symptoms appear.',
    follow_up_date: new Date(today.getTime() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    vitals: { bp: '110/72', pulse: '92', temp: '101.4', spo2: '98', rr: '20', weight: '14', height: '95' },
    created_at: today.toISOString(),
    updated_at: today.toISOString(),
  } as Consultation;

  const sampleRx = [
    { drug_name: 'Crocin Syrup 60ml', dosage: '5 ml', frequency: 'TID', duration: '3 days', instructions: 'After food' },
    { drug_name: 'ORS Sachet', dosage: '1 sachet', frequency: 'PRN', duration: 'As needed', instructions: 'In 200 ml water' },
    { drug_name: 'Cetirizine 10mg', dosage: '½ tab', frequency: 'HS', duration: '5 days', instructions: 'At night' },
  ] as any;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">OPD Slip Preview</h2>
        </div>
        <button className="btn-primary text-xs" onClick={openPreview}>
          <Eye className="w-3.5 h-3.5" /> Preview Slip
        </button>
      </div>

      {/* Doctor + slot picker */}
      {activeDoctors.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label !text-[11px]">Preview as doctor</label>
            <select
              className="input !py-1 !text-xs"
              value={selectedDoctorId ?? pickedDoctor.id}
              onChange={(e) => {
                setSelectedDoctorId(Number(e.target.value));
                setSelectedSlot(1);
              }}
            >
              {activeDoctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          {availableSlots.length > 1 && (
            <div>
              <label className="label !text-[11px]">Template slot</label>
              <div className="flex gap-1">
                {availableSlots.map(({ slot, name }) => (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      selectedSlot === slot
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-500 dark:text-slate-400">
        See how a real OPD slip will look using your clinic's current logo, name, contact info, and the selected
        doctor's template — with sample patient/visit data filled in. Once it looks right, you can hit
        <Printer className="inline w-3 h-3 mx-1" /> in the preview to print a test page on your printer.
      </p>
      <ul className="text-[11px] text-gray-600 dark:text-slate-300 mt-2 list-disc pl-5 space-y-0.5">
        <li>Clinic branding pulls from <b>Clinic Info</b> above (logo, name, tagline, reg no, address, phone, email).</li>
        <li>Doctor row pulls from the selected doctor; their qualifications, color, signature show as configured.</li>
        <li>Patient block uses sample 3-year-old paediatric data — confirms age (Y/M/D), UHID and Visit ID layout work.</li>
        <li>Pick a different doctor or slot above to compare templates side by side.</li>
      </ul>

      {open && (
        <OpdSlip
          key={previewNonce}
          appointment={sampleAppointment}
          consultation={sampleConsultation}
          doctor={previewDoctor}
          settings={settings}
          rxItems={sampleRx}
          labOrders={[]}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
