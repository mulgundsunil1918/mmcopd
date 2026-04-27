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
  DrugMaster,
  DrugStockBatch,
  DispensingRow,
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
  PurchaseInvoice,
  PurchaseInvoiceInput,
  Settings,
  Vitals,
  Wholesaler,
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
    isDefaultAdminPassword: () => ipcRenderer.invoke('auth:isDefaultAdminPassword') as Promise<boolean>,
    changePassword: (currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:changeAdminPassword', currentPassword, newPassword) as Promise<{ ok: boolean; error?: string }>,
    resetAuditLog: (confirmPhrase: string) =>
      ipcRenderer.invoke('admin:resetAuditLog', confirmPhrase) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    resetNotificationLog: (confirmPhrase: string) =>
      ipcRenderer.invoke('admin:resetNotificationLog', confirmPhrase) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    deletePatient: (patientId: number) =>
      ipcRenderer.invoke('admin:deletePatient', patientId) as Promise<{ ok: boolean; error?: string; patient?: any }>,
    deletePatients: (patientIds: number[]) =>
      ipcRenderer.invoke('admin:deletePatients', patientIds) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    deleteAppointment: (appointmentId: number) =>
      ipcRenderer.invoke('admin:deleteAppointment', appointmentId) as Promise<{ ok: boolean; error?: string; appointment?: any }>,
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
    dependents: (id: number) =>
      ipcRenderer.invoke('doctors:dependents', id) as Promise<{
        counts: { appointments: number; consultations: number; lab_orders: number; ip_admissions: number };
        total: number;
      }>,
    delete: (id: number) =>
      ipcRenderer.invoke('doctors:delete', id) as Promise<
        | { ok: true; mode: 'hard_deleted'; doctorName: string }
        | { ok: false; mode: 'has_records'; counts: { appointments: number; consultations: number; lab_orders: number; ip_admissions: number }; total: number; doctorName: string; error: string }
        | { ok: false; error: string }
      >,
    deactivate: (id: number) =>
      ipcRenderer.invoke('doctors:deactivate', id) as Promise<{ ok: boolean; doctorName?: string; error?: string }>,
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
      is_free_followup?: number;
      is_relaxed_followup?: number;
      followup_parent_appt_id?: number | null;
      marks_registration_fee_paid?: number;
    }) => ipcRenderer.invoke('bills:create', payload) as Promise<BillWithJoins>,
    list: (filter: { q?: string; from?: string; to?: string }) =>
      ipcRenderer.invoke('bills:list', filter) as Promise<BillWithJoins[]>,
    get: (id: number) => ipcRenderer.invoke('bills:get', id) as Promise<BillWithJoins | undefined>,
  },
  followup: {
    checkEligibility: (patientId: number, doctorId: number, checkDate?: string) =>
      ipcRenderer.invoke('followup:checkEligibility', patientId, doctorId, checkDate) as Promise<import('./types').FollowupEligibility>,
    summaryForAppointment: (appointmentId: number) =>
      ipcRenderer.invoke('followup:summaryForAppointment', appointmentId) as Promise<import('./types').FollowupSummary>,
  },
  misc: {
    create: (payload: {
      patient_id: number;
      doctor_id: number | null;
      description: string;
      amount: number;
      payment_mode: PaymentMode;
      notes?: string | null;
    }) => ipcRenderer.invoke('misc:create', payload) as Promise<BillWithJoins>,
    list: (filter: { from?: string; to?: string; q?: string; doctor_id?: number } = {}) =>
      ipcRenderer.invoke('misc:list', filter) as Promise<BillWithJoins[]>,
    summary: (filter: { from?: string; to?: string } = {}) =>
      ipcRenderer.invoke('misc:summary', filter) as Promise<{
        from: string; to: string; count: number; revenue: number;
        topServices: { service: string; count: number; revenue: number }[];
        byDoctor: { doctor_name: string | null; doctor_color: string | null; count: number; revenue: number }[];
      }>,
    trend: (filter: { from?: string; to?: string } = {}) =>
      ipcRenderer.invoke('misc:trend', filter) as Promise<{ day: string; count: number; revenue: number }[]>,
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
      extra_fields?: Record<string, string>;
    }) => ipcRenderer.invoke('consultations:save', payload) as Promise<Consultation>,
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list') as Promise<import('./types').SlipTemplate[]>,
    saveAll: (templates: import('./types').SlipTemplate[]) =>
      ipcRenderer.invoke('templates:saveAll', templates) as Promise<{ ok: true }>,
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
    // listDrugs returns DrugMaster rows joined with summed batch qty + earliest expiry.
    // Returns shape stays Drug-compatible for legacy callers (mrp/batch/expiry/stock_qty aliased).
    listDrugs: (filter?: { q?: string; activeOnly?: boolean }) =>
      ipcRenderer.invoke('pharmacy:listDrugs', filter || {}) as Promise<(DrugMaster & Drug)[]>,
    listBatches: (drugMasterId: number) =>
      ipcRenderer.invoke('pharmacy:listBatches', drugMasterId) as Promise<DrugStockBatch[]>,
    upsertDrug: (drug: Partial<DrugMaster>) =>
      ipcRenderer.invoke('pharmacy:upsertDrug', drug) as Promise<DrugMaster>,
    upsertBatch: (batch: Partial<DrugStockBatch>) =>
      ipcRenderer.invoke('pharmacy:upsertBatch', batch) as Promise<DrugStockBatch>,
    bulkDeleteDrugs: (ids: number[]) =>
      ipcRenderer.invoke('pharmacy:bulkDeleteDrugs', ids) as Promise<{
        ok: boolean;
        hardDeleted: number;
        softDeleted: number;
        results: Array<{ id: number; name: string; mode: 'hard_deleted' | 'soft_deleted' | 'failed'; refs?: any; error?: string }>;
      }>,
    alerts: () =>
      ipcRenderer.invoke('pharmacy:alerts') as Promise<{ lowStock: (DrugMaster & Drug)[]; expiringSoon: DrugStockBatch[] }>,
    pendingRx: () => ipcRenderer.invoke('pharmacy:pendingRx') as Promise<(AppointmentWithJoins & { rx_count: number })[]>,
    getAppointmentRx: (appointmentId: number) =>
      ipcRenderer.invoke('pharmacy:getAppointmentRx', appointmentId) as Promise<PrescriptionItem[]>,
    sell: (payload: {
      patient_id?: number | null;
      appointment_id?: number | null;
      items: { drug_id?: number | null; drug_master_id?: number | null; drug_name: string; qty: number; rate: number; gst_amount?: number }[];
      discount?: number;
      payment_mode?: string;
      sold_by?: string;
    }) => ipcRenderer.invoke('pharmacy:sell', payload) as Promise<PharmacySale>,
    listSales: (filter?: { from?: string; to?: string }) =>
      ipcRenderer.invoke('pharmacy:listSales', filter || {}) as Promise<(PharmacySale & { patient_name: string | null; patient_uhid: string | null })[]>,
  },
  wholesalers: {
    list: (filter?: { activeOnly?: boolean }) =>
      ipcRenderer.invoke('wholesalers:list', filter || {}) as Promise<Wholesaler[]>,
    upsert: (w: Partial<Wholesaler>) =>
      ipcRenderer.invoke('wholesalers:upsert', w) as Promise<Wholesaler>,
    delete: (id: number) =>
      ipcRenderer.invoke('wholesalers:delete', id) as Promise<{ ok: boolean }>,
  },
  purchases: {
    list: (filter?: { from?: string; to?: string; wholesaler_id?: number }) =>
      ipcRenderer.invoke('purchase:list', filter || {}) as Promise<(PurchaseInvoice & { wholesaler_name: string; wholesaler_license_no: string })[]>,
    get: (id: number) =>
      ipcRenderer.invoke('purchase:get', id) as Promise<(PurchaseInvoice & { wholesaler_name: string; items: any[] }) | null>,
    create: (payload: PurchaseInvoiceInput) =>
      ipcRenderer.invoke('purchase:create', payload) as Promise<PurchaseInvoice>,
    attachScan: (invoiceId: number, fileDataUrl: string, ext: string) =>
      ipcRenderer.invoke('purchase:attachScan', invoiceId, fileDataUrl, ext) as Promise<{ ok: boolean; path?: string; error?: string }>,
  },
  dispensing: {
    register: (filter: { from: string; to: string; schedule?: string }) =>
      ipcRenderer.invoke('dispensing:register', filter) as Promise<DispensingRow[]>,
  },
  stock: {
    register: (filter?: { activeOnly?: boolean; includeExpired?: boolean }) =>
      ipcRenderer.invoke('stock:register', filter || {}) as Promise<Array<DrugStockBatch & {
        drug_name: string; generic_name: string | null; manufacturer: string | null;
        form: string | null; strength: string | null; schedule: string;
        hsn_code: string | null; days_to_expiry: number;
      }>>,
  },
  purchasesReport: {
    register: (filter: { from: string; to: string; wholesaler_id?: number }) =>
      ipcRenderer.invoke('purchase:register', filter) as Promise<Array<PurchaseInvoice & {
        wholesaler_name: string; wholesaler_license_no: string;
        wholesaler_gstin: string | null; line_count: number;
      }>>,
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
    summary: (filter: { from?: string; to?: string } = {}) =>
      ipcRenderer.invoke('finance:summary', filter) as Promise<any>,
  },
  analytics: {
    overview: () => ipcRenderer.invoke('analytics:overview') as Promise<{
      asOf: string;
      todayVisits: number; todayDone: number; todayRevenue: number;
      monthRevenue: number; pharmacyMonthRevenue: number;
      totalPatients: number; patientsThisMonth: number; activeDoctors: number;
      pendingRx: number;
      lowStockDrugs: number; expiringSoonBatches: number; expiredBatches: number;
      freeFollowupsThisMonth: number;
      relaxedFollowupsThisMonth: number;
      registrationFeesThisMonth: number;
      registrationFeeCountThisMonth: number;
      servicesCountThisMonth: number;
      servicesRevenueThisMonth: number;
    }>,
    followups: (filter: { from?: string; to?: string } = {}) =>
      ipcRenderer.invoke('analytics:followups', filter) as Promise<{
        from: string; to: string;
        free_count: number; relaxed_count: number; total_waivers: number;
        revenue_forgone_free: number; revenue_forgone_relaxed: number; revenue_forgone_total: number;
      }>,
    demographics: () => ipcRenderer.invoke('analytics:demographics') as Promise<{
      total: number;
      byGender: { gender: string; c: number }[];
      byAgeGroup: { label: string; c: number }[];
      byBloodGroup: { label: string; c: number }[];
      byProfession: { label: string; c: number }[];
      newPatientsByMonth: { month: string; c: number }[];
      revenueByGender: { label: string; bills: number; revenue: number }[];
      revenueByAge: { label: string; bills: number; revenue: number }[];
      revenueByProfession: { label: string; bills: number; revenue: number }[];
    }>,
    pharmacyOverview: (filter: { from: string; to: string }) =>
      ipcRenderer.invoke('analytics:pharmacyOverview', filter) as Promise<{
        totalDispensed: number; scheduleHCount: number;
        totalRevenue: number; totalSales: number;
        topDrugs: { name: string; units: number; revenue: number; sales: number }[];
        salesMix: { kind: string; count: number; revenue: number }[];
        scheduleMix: { schedule: string; count: number; units: number }[];
        lowStock: { name: string; stock: number; low_stock_threshold: number }[];
        expiringSoon: { drug_name: string; batch_no: string; expiry: string; qty_remaining: number; days: number }[];
      }>,
    retention: () =>
      ipcRenderer.invoke('analytics:retention') as Promise<{
        totalPatients: number;
        window30: { eligible: number; returned: number; rate: number };
        window60: { eligible: number; returned: number; rate: number };
        window90: { eligible: number; returned: number; rate: number };
      }>,
    cohort: () =>
      ipcRenderer.invoke('analytics:cohort') as Promise<{
        cohorts: { cohort_month: string; size: number; retention: number[] }[];
      }>,
    weekdayHourHeatmap: () =>
      ipcRenderer.invoke('analytics:weekdayHourHeatmap') as Promise<
        { weekday: number; hour: number; visits: number }[]
      >,
    pharmacyBasket: () =>
      ipcRenderer.invoke('analytics:pharmacyBasket') as Promise<
        { month: string; sales: number; avg_revenue: number; total_revenue: number; avg_units: number }[]
      >,
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state') as Promise<{ state: string; appVersion: string; isPackaged: boolean; version?: string; releaseNotes?: string; error?: string }>,
    checkNow: () => ipcRenderer.invoke('updates:checkNow') as Promise<{ ok: boolean; isPackaged: boolean }>,
    installNow: () => ipcRenderer.invoke('updates:installNow') as Promise<{ ok: boolean }>,
    onState: (cb: (s: any) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('updates:state', handler);
      return () => ipcRenderer.removeListener('updates:state', handler);
    },
    onPromptInstall: (cb: (s: any) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('updates:promptInstall', handler);
      return () => ipcRenderer.removeListener('updates:promptInstall', handler);
    },
  },
  app: {
    getClinicName: () => ipcRenderer.invoke('app:getClinicName') as Promise<string>,
    forceQuit: () => ipcRenderer.invoke('app:forceQuit') as Promise<void>,
    openExternal: (url: string) =>
      ipcRenderer.invoke('app:openExternal', url) as Promise<{ ok: boolean; error?: string }>,
    setAutoLaunch: (enabled: boolean, startMinimized: boolean) =>
      ipcRenderer.invoke('app:setAutoLaunch', enabled, startMinimized) as Promise<{
        ok: boolean; reason?: string; registered?: boolean; exePath?: string;
      }>,
    getAutoLaunchStatus: () =>
      ipcRenderer.invoke('app:getAutoLaunchStatus') as Promise<{
        supported: boolean; isPackaged: boolean; registered: boolean; exePath: string | null; reason?: string;
      }>,
    onCloseRequested: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('app:closeRequested', handler);
      return () => ipcRenderer.removeListener('app:closeRequested', handler);
    },
    onReminderTick: (cb: (info: { reminder: string }) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('app:reminderTick', handler);
      return () => ipcRenderer.removeListener('app:reminderTick', handler);
    },
    onUsbReminderTick: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('app:usbReminderTick', handler);
      return () => ipcRenderer.removeListener('app:usbReminderTick', handler);
    },
  },
  reports: {
    run: (params: { kind: string; from?: string; to?: string }) =>
      ipcRenderer.invoke('reports:run', params) as Promise<any[]>,
  },
  backup: {
    now: () => ipcRenderer.invoke('backup:now') as Promise<{ path: string; bundleDir: string; totalBundles: number; documentCount: number }>,
    nowTo: (targetDir: string) => ipcRenderer.invoke('backup:nowTo', targetDir) as Promise<{ ok: boolean; path?: string; documentCount?: number; error?: string }>,
    list: () => ipcRenderer.invoke('backup:list') as Promise<{ name: string; path: string; size: number; mtime: string }[]>,
    open: () => ipcRenderer.invoke('backup:open') as Promise<void>,
    status: () => ipcRenderer.invoke('backup:status') as Promise<{ lastBackupAt: string | null; lastBackupName: string | null; totalBackups: number; dir: string }>,
    quitAfter: () => ipcRenderer.invoke('backup:quitAfter') as Promise<{ ok: boolean; path: string }>,
    restore: (sourcePath: string, confirmPhrase: string) =>
      ipcRenderer.invoke('backup:restore', sourcePath, confirmPhrase) as Promise<{ ok: boolean; error?: string; restartIn?: number }>,
    previewRestore: (sourcePath: string) =>
      ipcRenderer.invoke('backup:previewRestore', sourcePath) as Promise<
        | { ok: true; sourcePath: string; sqlitePath: string; hasBundleDocs: boolean; documentFileCount: number | null;
            backupTakenAt: string | null;
            backup: { counts: Record<string, number | null>; totalRows: number };
            current: { counts: Record<string, number | null>; totalRows: number };
            currentDbPath: string;
          }
        | { ok: false; error: string }
      >,
  },
  dialog: {
    pickFolder: (opts?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke('dialog:pickFolder', opts || {}) as Promise<string | null>,
    pickFile: (opts?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:pickFile', opts || {}) as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
