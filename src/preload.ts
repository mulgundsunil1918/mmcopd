import { contextBridge, ipcRenderer } from 'electron';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentWithJoins,
  Bill,
  BillItem,
  BillWithJoins,
  Consultation,
  Doctor,
  NotificationLog,
  Patient,
  PatientInput,
  PaymentMode,
  Settings,
  Vitals,
} from './types';

const api = {
  patients: {
    search: (q: string) => ipcRenderer.invoke('patients:search', q) as Promise<(Patient & { last_visit: string | null })[]>,
    get: (id: number) => ipcRenderer.invoke('patients:get', id) as Promise<Patient | undefined>,
    create: (input: PatientInput) => ipcRenderer.invoke('patients:create', input) as Promise<Patient>,
    update: (id: number, input: PatientInput) => ipcRenderer.invoke('patients:update', id, input) as Promise<Patient>,
    recentAppointments: (id: number, limit?: number) =>
      ipcRenderer.invoke('patients:recentAppointments', id, limit) as Promise<
        (Appointment & { doctor_name: string; doctor_specialty: string })[]
      >,
    log: (filter: { from: string; to: string; q?: string; doctor_id?: number }) =>
      ipcRenderer.invoke('patients:log', filter) as Promise<{
        rows: (AppointmentWithJoins & {
          bill_total: number | null;
          bill_payment_mode: string | null;
          bill_number: string | null;
        })[];
        intel: {
          totalVisits: number;
          uniquePatients: number;
          repeatVisits: number;
          revenue: number;
          daysCovered: number;
          avgPerDay: number;
          peakDay: { date: string; count: number } | null;
          byDoctor: { doctor: string; specialty: string; count: number }[];
          byStatus: { status: string; count: number }[];
        };
      }>,
  },
  doctors: {
    list: (activeOnly = true) => ipcRenderer.invoke('doctors:list', activeOnly) as Promise<Doctor[]>,
    get: (id: number) => ipcRenderer.invoke('doctors:get', id) as Promise<Doctor | undefined>,
    create: (d: Partial<Doctor>) => ipcRenderer.invoke('doctors:create', d) as Promise<Doctor>,
    update: (id: number, d: Partial<Doctor>) => ipcRenderer.invoke('doctors:update', id, d) as Promise<Doctor>,
  },
  appointments: {
    bookedSlots: (doctorId: number, date: string) =>
      ipcRenderer.invoke('appointments:bookedSlots', doctorId, date) as Promise<{ appointment_time: string }[]>,
    create: (payload: {
      patient_id: number;
      doctor_id: number;
      appointment_date: string;
      appointment_time: string;
      notes?: string | null;
      status?: AppointmentStatus;
    }) => ipcRenderer.invoke('appointments:create', payload) as Promise<AppointmentWithJoins>,
    list: (filter: { date?: string; doctor_id?: number; status?: AppointmentStatus }) =>
      ipcRenderer.invoke('appointments:list', filter) as Promise<AppointmentWithJoins[]>,
    updateStatus: (id: number, status: AppointmentStatus) =>
      ipcRenderer.invoke('appointments:updateStatus', id, status) as Promise<Appointment>,
    get: (id: number) => ipcRenderer.invoke('appointments:get', id) as Promise<AppointmentWithJoins | undefined>,
  },
  bills: {
    create: (payload: {
      appointment_id: number | null;
      patient_id: number;
      items: BillItem[];
      discount: number;
      discount_type: 'flat' | 'percent';
      payment_mode: PaymentMode;
    }) => ipcRenderer.invoke('bills:create', payload) as Promise<BillWithJoins>,
    list: (filter: { q?: string; from?: string; to?: string }) =>
      ipcRenderer.invoke('bills:list', filter) as Promise<BillWithJoins[]>,
    get: (id: number) => ipcRenderer.invoke('bills:get', id) as Promise<BillWithJoins | undefined>,
  },
  consultations: {
    getByAppointment: (appointmentId: number) =>
      ipcRenderer.invoke('consultations:getByAppointment', appointmentId) as Promise<Consultation | null>,
    save: (payload: {
      appointment_id: number;
      patient_id: number;
      doctor_id: number;
      history?: string;
      vitals?: Vitals;
      examination?: string;
      impression?: string;
      advice?: string;
      follow_up_date?: string | null;
    }) => ipcRenderer.invoke('consultations:save', payload) as Promise<Consultation>,
  },
  notifications: {
    list: (status?: string) => ipcRenderer.invoke('notifications:list', status) as Promise<NotificationLog[]>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    save: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch) as Promise<Settings>,
  },
  stats: {
    today: () =>
      ipcRenderer.invoke('stats:today') as Promise<{
        date: string;
        total: number;
        waiting: number;
        inprogress: number;
        done: number;
      }>,
  },
  finance: {
    summary: () =>
      ipcRenderer.invoke('finance:summary') as Promise<{
        today: { total: number; count: number; byMode: { payment_mode: string; total: number; count: number }[] };
        week: { total: number; count: number };
        month: { total: number; count: number };
        allTime: { total: number; count: number };
        byDay: { day: string; total: number; count: number }[];
        byWeek: { week: string; total: number; count: number }[];
        byMonth: { month: string; total: number; count: number }[];
        byMode: { payment_mode: string; total: number; count: number }[];
        byDoctor: { doctor: string; specialty: string; total: number; count: number }[];
      }>,
  },
  app: {
    getClinicName: () => ipcRenderer.invoke('app:getClinicName') as Promise<string>,
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
