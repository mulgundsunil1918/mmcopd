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
  Drug,
  IpAdmission,
  LabOrder,
  LabOrderItem,
  LabTest,
  NotificationLog,
  Patient,
  PatientInput,
  PaymentMode,
  PharmacySale,
  PrescriptionItem,
  Settings,
  Vitals,
} from './types';

type Role = 'admin' | 'receptionist' | 'doctor' | 'lab_tech' | 'pharmacist';
type SessionUser = { id: number; username: string; role: Role; display_name: string | null; doctor_id: number | null };

const api = {
  auth: {
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password) as Promise<SessionUser | null>,
    createUser: (input: { username: string; password: string; role: Role; display_name?: string; doctor_id?: number }) =>
      ipcRenderer.invoke('auth:createUser', input) as Promise<SessionUser>,
    changePassword: (userId: number, newPassword: string) => ipcRenderer.invoke('auth:changePassword', userId, newPassword) as Promise<boolean>,
    listUsers: () => ipcRenderer.invoke('auth:listUsers') as Promise<any[]>,
    updateUser: (id: number, patch: any) => ipcRenderer.invoke('auth:updateUser', id, patch) as Promise<any[]>,
  },
  audit: {
    list: (limit?: number) => ipcRenderer.invoke('audit:list', limit) as Promise<any[]>,
    log: (user: SessionUser | null, action: string, entity?: string, entity_id?: number, details?: string) =>
      ipcRenderer.invoke('audit:log', user, action, entity, entity_id, details) as Promise<void>,
  },
  admin: {
    verifyPassword: (password: string) => ipcRenderer.invoke('auth:verifyAdminPassword', password) as Promise<boolean>,
    changePassword: (currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:changeAdminPassword', currentPassword, newPassword) as Promise<{ ok: boolean; error?: string }>,
    resetAuditLog: (confirmPhrase: string) =>
      ipcRenderer.invoke('admin:resetAuditLog', confirmPhrase) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    resetNotificationLog: (confirmPhrase: string) =>
      ipcRenderer.invoke('admin:resetNotificationLog', confirmPhrase) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    deletePatient: (patientId: number, confirmPhrase: string) =>
      ipcRenderer.invoke('admin:deletePatient', patientId, confirmPhrase) as Promise<{ ok: boolean; error?: string; patient?: any }>,
  },
  patients: {
    search: (q: string) => ipcRenderer.invoke('patients:search', q) as Promise<(Patient & { last_visit: string | null })[]>,
    get: (id: number) => ipcRenderer.invoke('patients:get', id) as Promise<Patient | undefined>,
    create: (input: PatientInput) => ipcRenderer.invoke('patients:create', input) as Promise<Patient>,
    update: (id: number, input: PatientInput) => ipcRenderer.invoke('patients:update', id, input) as Promise<Patient>,
    recentAppointments: (id: number, limit?: number) =>
      ipcRenderer.invoke('patients:recentAppointments', id, limit) as Promise<
        (Appointment & { doctor_name: string; doctor_specialty: string })[]
      >,
    knownPlaces: () =>
      ipcRenderer.invoke('patients:knownPlaces') as Promise<{ places: string[]; districts: string[] }>,
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
  emr: {
    allergies: (patientId: number) => ipcRenderer.invoke('emr:allergies', patientId) as Promise<any[]>,
    addAllergy: (p: { patient_id: number; allergen: string; reaction?: string; severity?: string }) =>
      ipcRenderer.invoke('emr:addAllergy', p) as Promise<any>,
    deleteAllergy: (id: number) => ipcRenderer.invoke('emr:deleteAllergy', id) as Promise<boolean>,

    conditions: (patientId: number) => ipcRenderer.invoke('emr:conditions', patientId) as Promise<any[]>,
    addCondition: (p: { patient_id: number; condition: string; since?: string; notes?: string }) =>
      ipcRenderer.invoke('emr:addCondition', p) as Promise<any>,
    deleteCondition: (id: number) => ipcRenderer.invoke('emr:deleteCondition', id) as Promise<boolean>,

    family: (patientId: number) => ipcRenderer.invoke('emr:family', patientId) as Promise<any[]>,
    addFamily: (p: { patient_id: number; relation: string; condition: string; notes?: string }) =>
      ipcRenderer.invoke('emr:addFamily', p) as Promise<any>,
    deleteFamily: (id: number) => ipcRenderer.invoke('emr:deleteFamily', id) as Promise<boolean>,

    immunizations: (patientId: number) => ipcRenderer.invoke('emr:immunizations', patientId) as Promise<any[]>,
    addImmunization: (p: { patient_id: number; vaccine: string; given_at?: string; dose?: string; notes?: string }) =>
      ipcRenderer.invoke('emr:addImmunization', p) as Promise<any>,
    deleteImmunization: (id: number) => ipcRenderer.invoke('emr:deleteImmunization', id) as Promise<boolean>,

    documents: (patientId: number) => ipcRenderer.invoke('emr:documents', patientId) as Promise<any[]>,
    addDocument: (p: { patient_id: number; file_name: string; file_type: string; data_base64: string; note?: string }) =>
      ipcRenderer.invoke('emr:addDocument', p) as Promise<any>,
    openDocument: (id: number) => ipcRenderer.invoke('emr:openDocument', id) as Promise<void>,
    deleteDocument: (id: number) => ipcRenderer.invoke('emr:deleteDocument', id) as Promise<boolean>,
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
  rx: {
    getByAppointment: (appointmentId: number) =>
      ipcRenderer.invoke('rx:getByAppointment', appointmentId) as Promise<PrescriptionItem[]>,
    saveAll: (appointmentId: number, items: Omit<PrescriptionItem, 'id' | 'appointment_id' | 'order_idx'>[]) =>
      ipcRenderer.invoke('rx:saveAll', appointmentId, items) as Promise<PrescriptionItem[]>,
  },
  lab: {
    listTests: (activeOnly = true) => ipcRenderer.invoke('lab:listTests', activeOnly) as Promise<LabTest[]>,
    upsertTest: (test: Partial<LabTest>) => ipcRenderer.invoke('lab:upsertTest', test) as Promise<LabTest>,
    createOrder: (payload: {
      appointment_id: number | null;
      patient_id: number;
      doctor_id: number | null;
      notes?: string;
      items: { lab_test_id?: number; test_name: string }[];
    }) => ipcRenderer.invoke('lab:createOrder', payload) as Promise<LabOrder>,
    listOrders: (filter?: { status?: string; patient_id?: number }) =>
      ipcRenderer.invoke('lab:listOrders', filter || {}) as Promise<(LabOrder & { patient_name: string; patient_uhid: string; doctor_name: string | null })[]>,
    getOrderItems: (orderId: number) => ipcRenderer.invoke('lab:getOrderItems', orderId) as Promise<LabOrderItem[]>,
    updateOrderStatus: (orderId: number, status: string) => ipcRenderer.invoke('lab:updateOrderStatus', orderId, status) as Promise<LabOrder>,
    updateResults: (orderId: number, items: { id: number; result: string; is_abnormal?: number }[]) =>
      ipcRenderer.invoke('lab:updateResults', orderId, items) as Promise<LabOrderItem[]>,
  },
  pharmacy: {
    listDrugs: (filter?: { q?: string; activeOnly?: boolean }) =>
      ipcRenderer.invoke('pharmacy:listDrugs', filter || {}) as Promise<Drug[]>,
    upsertDrug: (drug: Partial<Drug>) => ipcRenderer.invoke('pharmacy:upsertDrug', drug) as Promise<Drug>,
    alerts: () => ipcRenderer.invoke('pharmacy:alerts') as Promise<{ lowStock: Drug[]; expiringSoon: Drug[] }>,
    pendingRx: () => ipcRenderer.invoke('pharmacy:pendingRx') as Promise<(AppointmentWithJoins & { rx_count: number })[]>,
    getAppointmentRx: (appointmentId: number) =>
      ipcRenderer.invoke('pharmacy:getAppointmentRx', appointmentId) as Promise<PrescriptionItem[]>,
    sell: (payload: {
      patient_id?: number | null;
      appointment_id?: number | null;
      items: { drug_id?: number | null; drug_name: string; qty: number; rate: number }[];
      discount?: number;
      payment_mode?: string;
      sold_by?: string;
    }) => ipcRenderer.invoke('pharmacy:sell', payload) as Promise<PharmacySale>,
    listSales: (filter?: { from?: string; to?: string }) =>
      ipcRenderer.invoke('pharmacy:listSales', filter || {}) as Promise<(PharmacySale & { patient_name: string | null; patient_uhid: string | null })[]>,
  },
  ip: {
    list: (filter?: { status?: string }) =>
      ipcRenderer.invoke('ip:list', filter || {}) as Promise<(IpAdmission & { patient_name: string; patient_uhid: string; patient_phone: string; doctor_name: string | null })[]>,
    admit: (payload: { patient_id: number; admission_doctor_id?: number; bed_number?: string; ward?: string; admission_notes?: string }) =>
      ipcRenderer.invoke('ip:admit', payload) as Promise<IpAdmission>,
    discharge: (id: number, summary: string) => ipcRenderer.invoke('ip:discharge', id, summary) as Promise<IpAdmission>,
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
  origin: {
    summary: (filter: { from: string; to: string }) =>
      ipcRenderer.invoke('origin:summary', filter) as Promise<{
        totalVisits: number;
        uniquePatients: number;
        missingPlace: number;
        byPlace: { name: string; visits: number; patients: number }[];
        byDistrict: { name: string; visits: number; patients: number }[];
        byState: { name: string; visits: number; patients: number }[];
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
  reports: {
    run: (params: { kind: string; from?: string; to?: string }) =>
      ipcRenderer.invoke('reports:run', params) as Promise<any[]>,
  },
  backup: {
    now: () => ipcRenderer.invoke('backup:now') as Promise<{ path: string; totalBackups: number }>,
    list: () => ipcRenderer.invoke('backup:list') as Promise<{ name: string; path: string; size: number; mtime: string }[]>,
    open: () => ipcRenderer.invoke('backup:open') as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
