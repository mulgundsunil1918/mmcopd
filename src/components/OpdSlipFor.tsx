import { useQuery } from '@tanstack/react-query';
import { OpdSlip } from './OpdSlip';
import type { AppointmentWithJoins } from '../types';

export function OpdSlipFor({
  appointment,
  onClose,
}: {
  appointment: AppointmentWithJoins;
  onClose: () => void;
}) {
  const { data: doctor } = useQuery({
    queryKey: ['doctors', appointment.doctor_id],
    queryFn: () => window.electronAPI.doctors.get(appointment.doctor_id),
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const { data: consultation } = useQuery({
    queryKey: ['consultation', appointment.id],
    queryFn: () => window.electronAPI.consultations.getByAppointment(appointment.id),
  });
  const { data: rxItems = [] } = useQuery({
    queryKey: ['rx', appointment.id],
    queryFn: () => window.electronAPI.rx.getByAppointment(appointment.id),
  });
  const { data: allLabOrders = [] } = useQuery({
    queryKey: ['lab-orders-patient', appointment.patient_id],
    queryFn: () => window.electronAPI.lab.listOrders({ patient_id: appointment.patient_id }),
  });
  const labOrders = allLabOrders.filter((o) => o.appointment_id === appointment.id);
  // Scans the doctor ordered (X-Ray, ultrasound, CT, MRI) are listed with the lab tests under
  // "Investigations Ordered". Radiology is its own department but the patient's paper is one list.
  const { data: allRadOrders = [] } = useQuery({
    queryKey: ['radiology-orders-patient', appointment.patient_id, appointment.id],
    queryFn: () => window.electronAPI.radiology.listOrders({ patient_id: appointment.patient_id }),
  });
  const radOrders = allRadOrders
    .filter((o) => o.appointment_id === appointment.id && o.status !== 'cancelled')
    // Negative id: lab order #3 and radiology order #3 must not collide as list keys.
    .map((o) => ({ ...o, id: -o.id, status: o.status === 'done' ? 'scan done' : o.status } as any));
  const investigations = [...labOrders, ...radOrders];

  if (!doctor || !settings) return null;

  return (
    <OpdSlip
      appointment={appointment}
      consultation={consultation ?? null}
      doctor={doctor}
      settings={settings}
      rxItems={rxItems}
      labOrders={investigations}
      onClose={onClose}
    />
  );
}
