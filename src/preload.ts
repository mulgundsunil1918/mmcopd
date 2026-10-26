import { contextBridge, ipcRenderer } from 'electron';

import type {
  CostNotRecordedSummary, CounterSalesFilter, CounterSalesResult, IntegrityFinding, PriceHistoryRow, ProfitReport,
  SupplierReport, Valuation,
} from './lib/pharmacyReports';
import type { DiscountsGiven, ManualPharmacy, OrderBillResult, PatientPortal, Receivables, SetupStatus, UnbilledWork } from './lib/billingPortal';
import type { SupplierAccounts, SupplierStatementResult } from './lib/supplierStatement';
import type { ReferralStats } from './lib/referralStats';
import type { ImportCommit, ImportResult, ParseResult, WaitingGet, WaitingRow } from './lib/billImport/types';
import type { AdminPatientVisits, PurchaseDeletedSummary } from './types';

export type LicenseStatusIPC = {
  state: 'valid' | 'grace' | 'locked' | 'invalid' | 'wrong_machine' | 'clock_tampered' | 'none' | 'dev';
  ok: boolean; readOnly: boolean; needsActivation: boolean;
  daysLeft: number | null; graceDaysLeft: number | null;
  reminder: 'none' | '30d' | '7d' | '1d' | 'grace' | 'locked';
  modules: string[];
  payload: { clinic: string; customer?: string; edition?: string; modules: string[]; issued_at: string; expires_at: string; license_id: string } | null;
  contact: { phone?: string; email?: string };
  hardwareId: string; message: string;
  onlineAvailable: boolean;
  /** Module (add-on) codes installed here; their modules are already in `modules` while valid or in grace. */
  addons: { license_id: string; modules: string[]; issued_at: string; expires_at: string; state: 'valid' | 'grace' | 'expired'; daysLeft: number; graceDaysLeft: number }[];
};

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
  ClinicStockRow,
  ClearPreview,
  SupplierSummaryRow,
  PaySupplierResult,
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
  PurchaseDetail,
  PurchasePaymentInput,
  PurchaseResult,
  ReferringDoctor,
  RadiologyTest,
  RadiologyOrderRow,
  RadiologyOrderDetail,
  Settings,
  Vitals,
  Wholesaler,
} from './types';

/**
 * Assignable account roles. Must stay identical to Role in main/auth.ts.
 * (The renderer's Role in hooks/useAuth.tsx is this list plus the 'staff'
 * pseudo-role used for the default unauthenticated session, which is never
 * stored on an account.)
 *
 * Preload cannot import from main, so this is a deliberate duplicate — three
 * copies of this union previously drifted apart, which is what made the user
 * form offer a 'staff' role the backend rejected.
 */
type RadiologyFail = { ok: false; error: string };
type Role = 'admin' | 'manager' | 'receptionist' | 'doctor' | 'nurse' | 'ward_incharge' | 'lab_tech' | 'radiology_tech' | 'pharmacist';
type SessionUser = { id: number; username: string; role: Role; display_name: string | null; doctor_id: number | null };

const api = {
  auth: {
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password) as Promise<SessionUser | null>,
    createUser: (input: { username: string; password: string; role: Role; display_name?: string; doctor_id?: number }) =>
      ipcRenderer.invoke('auth:createUser', input) as Promise<SessionUser>,
    changePassword: (userId: number, newPassword: string) => ipcRenderer.invoke('auth:changePassword', userId, newPassword) as Promise<boolean>,
    /** "Forgot admin password" recovery: support-signed, machine-bound reset code + new password. */
    recoverWithCode: (code: string, newPassword: string) =>
      ipcRenderer.invoke('auth:recoverWithCode', code, newPassword) as Promise<{ ok: boolean; error?: string; username?: string | null }>,
    /** Clears the MAIN-process session so role enforcement stops applying to this user. */
    logout: () => ipcRenderer.invoke('auth:logout') as Promise<{ ok: boolean }>,
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
    setInitialAdminPassword: (newPassword: string) =>
      ipcRenderer.invoke('auth:setInitialAdminPassword', newPassword) as Promise<{ ok: boolean; error?: string }>,
    changePassword: (currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:changeAdminPassword', currentPassword, newPassword) as Promise<{ ok: boolean; error?: string }>,
    resetAuditLog: (confirmPhrase: string, adminPassword: string) =>
      ipcRenderer.invoke('admin:resetAuditLog', confirmPhrase, adminPassword) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    resetNotificationLog: (confirmPhrase: string) =>
      ipcRenderer.invoke('admin:resetNotificationLog', confirmPhrase) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    deletePatient: (patientId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deletePatient', patientId, adminPassword) as Promise<{ ok: boolean; error?: string; patient?: any }>,
    deletePatients: (patientIds: number[], adminPassword: string) =>
      ipcRenderer.invoke('admin:deletePatients', patientIds, adminPassword) as Promise<{ ok: boolean; error?: string; deleted?: number }>,
    /** A pharmacy counter sale: the sale, its lines, payments and register rows; the medicines go back on the shelf. Not for sales charged to an in-patient bill. */
    deleteSale: (saleId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deleteSale', saleId, adminPassword) as Promise<{ ok: boolean; error?: string; sale?: any }>,
    /** One patient's visits (each with its doctor, and what the visit carries) — to pick the single visit to erase instead of the whole patient. */
    patientVisits: (patientId: number) =>
      ipcRenderer.invoke('admin:patientVisits', patientId) as Promise<AdminPatientVisits>,
    /** Deleting needs the admin password typed again for that one deletion — checked in the main process. */
    deleteAppointment: (appointmentId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deleteAppointment', appointmentId, adminPassword) as Promise<{ ok: boolean; error?: string; appointment?: any }>,
    /** The doctor's notes + prescription of one visit (the visit and its bill stay). */
    deleteConsultation: (appointmentId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deleteConsultation', appointmentId, adminPassword) as Promise<{ ok: boolean; error?: string; consultation?: any }>,
    /** A supplier's purchase bill — ANY purchase bill, no conditions: the bill, its lines and payments go, the stock it brought in comes off the shelf, units already sold stay sold. */
    deletePurchase: (invoiceId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deletePurchase', invoiceId, adminPassword) as Promise<{ ok: boolean; error?: string; purchase?: PurchaseDeletedSummary }>,
    /** Any bill except an in-patient admission bill: the bill, its lines and its payment records. */
    deleteBill: (billId: number, adminPassword: string) =>
      ipcRenderer.invoke('admin:deleteBill', billId, adminPassword) as Promise<{ ok: boolean; error?: string; bill?: any }>,
    /** WIPES %APPDATA%\CureDesk HMS\ entirely and restarts the app. Patient data,
     *  settings, backups, localStorage — everything. Used by the Settings →
     *  System → "Reset all clinic data" button for a true fresh-install state
     *  without going through the Windows uninstaller. */
    hardResetAndRestart: () =>
      ipcRenderer.invoke('admin:hardResetAndRestart') as Promise<{ ok: boolean; error?: string }>,
    /** Testing: load ~50 fictional patients + activity so Analytics is populated. */
    loadSampleData: () =>
      ipcRenderer.invoke('admin:loadSampleData') as Promise<{ ok: boolean; error?: string; patients?: number; bills?: number; sales?: number; labOrders?: number; admissions?: number }>,
    /** How many fictional (MMC-numbered) patients are in this database. */
    sampleDataCount: () =>
      ipcRenderer.invoke('admin:sampleDataCount') as Promise<{ ok: boolean; patients?: number; error?: string }>,
    /** Delete every fictional patient and their records. Real patients untouched. */
    removeSampleData: () =>
      ipcRenderer.invoke('admin:removeSampleData') as Promise<{ ok: boolean; removed?: number; note?: string; error?: string }>,
  },
  patients: {
    search: (q: string, opts?: { window?: 'week' | 'month' | 'quarter' | 'all'; sort?: 'recent' | 'registered' | 'name' }) =>
      ipcRenderer.invoke('patients:search', q, opts || {}) as Promise<(Patient & { last_visit: string | null })[]>,
    allList: (filter?: { q?: string; sort?: string; limit?: number }) =>
      ipcRenderer.invoke('patients:allList', filter || {}) as Promise<{ rows: (Patient & { last_visit: string | null; visit_count: number })[]; total: number }>,
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
        counts: { appointments: number; consultations: number; lab_orders: number; radiology_orders?: number; ip_admissions: number };
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
  referringDoctors: {
    list: (activeOnly = true) => ipcRenderer.invoke('referringDoctors:list', activeOnly) as Promise<ReferringDoctor[]>,
    create: (d: Partial<ReferringDoctor>) => ipcRenderer.invoke('referringDoctors:create', d) as Promise<ReferringDoctor>,
    update: (id: number, d: Partial<ReferringDoctor>) => ipcRenderer.invoke('referringDoctors:update', id, d) as Promise<ReferringDoctor>,
    delete: (id: number) => ipcRenderer.invoke('referringDoctors:delete', id) as Promise<{ ok: boolean }>,
  },
  // Radiology — its own department. Every mutation resolves to { ok: true, … } or
  // { ok: false, error } where `error` is the exact, actionable message to show.
  radiology: {
    listTests: (activeOnly = true) => ipcRenderer.invoke('radiology:listTests', activeOnly) as Promise<RadiologyTest[]>,
    upsertTest: (t: Partial<RadiologyTest>) =>
      ipcRenderer.invoke('radiology:upsertTest', t) as Promise<({ ok: true; test: RadiologyTest }) | RadiologyFail>,
    bulkDeleteTests: (ids: number[]) =>
      ipcRenderer.invoke('radiology:deleteTests', ids) as Promise<({ ok: true; deleted: number; deactivated: number }) | RadiologyFail>,
    loadStandardCatalog: () =>
      ipcRenderer.invoke('radiology:loadStandardCatalog') as Promise<({ ok: true; added: number; total: number }) | RadiologyFail>,
    listOrders: (filter: { status?: string; patient_id?: number; window?: string; sort?: string; q?: string; limit?: number } = {}) =>
      ipcRenderer.invoke('radiology:listOrders', filter) as Promise<RadiologyOrderRow[]>,
    getOrder: (id: number) => ipcRenderer.invoke('radiology:getOrder', id) as Promise<RadiologyOrderDetail | null>,
    createOrder: (payload: {
      patient_id: number;
      appointment_id?: number | null;
      doctor_id?: number | null;
      referred_by?: string | null;
      clinical_info?: string | null;
      notes?: string | null;
      items: { test_id?: number | null; test_name?: string; price?: number | null }[];
    }) => ipcRenderer.invoke('radiology:createOrder', payload) as Promise<({ ok: true; order: RadiologyOrderDetail }) | RadiologyFail>,
    addItems: (orderId: number, items: { test_id?: number | null; test_name?: string; price?: number | null }[]) =>
      ipcRenderer.invoke('radiology:addItems', orderId, items) as Promise<({ ok: true; added: number; billChanged: boolean; note: string; total?: number; order: RadiologyOrderDetail }) | RadiologyFail>,
    removeItem: (orderId: number, itemId: number) =>
      ipcRenderer.invoke('radiology:removeItem', orderId, itemId) as Promise<({ ok: true; billChanged: boolean; note: string; total?: number; order: RadiologyOrderDetail }) | RadiologyFail>,
    updateStatus: (orderId: number, status: 'ordered' | 'done' | 'reported') =>
      ipcRenderer.invoke('radiology:updateStatus', orderId, status) as Promise<({ ok: true; order: RadiologyOrderDetail }) | RadiologyFail>,
    saveReport: (
      orderId: number,
      items: { id: number; findings?: string | null; impression?: string | null; is_abnormal?: number }[],
      opts: { reportedBy?: string | null; finalize?: boolean } = {},
    ) => ipcRenderer.invoke('radiology:saveReport', orderId, items, opts) as Promise<({ ok: true; order: RadiologyOrderDetail }) | RadiologyFail>,
    cancelOrder: (orderId: number, reason?: string) =>
      ipcRenderer.invoke('radiology:cancelOrder', orderId, reason) as Promise<({ ok: true; note: string; order: RadiologyOrderDetail }) | RadiologyFail>,
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
      referred_by?: string | null;
      status?: AppointmentStatus;
    }) => ipcRenderer.invoke('appointments:create', payload) as Promise<AppointmentWithJoins>,
    /**
     * Book a visit AND raise its bill as ONE all-or-nothing step: if the bill is refused (or anything else fails), no visit is left behind
     * and no token / visit number is used up. Replaces calling create() and then bills.create().
     */
    createWithBill: (payload: {
      appointment: {
        patient_id: number; doctor_id: number; appointment_date: string; appointment_time: string;
        notes?: string | null; referred_by?: string | null; status?: AppointmentStatus;
        patient_group?: string | null; procedure_tags?: string | null;
      };
      bill: {
        items: BillItem[]; discount: number; discount_type: 'flat' | 'percent'; payment_mode: PaymentMode;
        discount_reason?: string | null; is_free_followup?: number; is_relaxed_followup?: number;
        followup_parent_appt_id?: number | null; marks_registration_fee_paid?: number;
      };
    }) => ipcRenderer.invoke('appointments:createWithBill', payload) as Promise<{ appointment: AppointmentWithJoins; bill: BillWithJoins }>,
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
      /** Why a discount was given — recorded with who gave it. */
      discount_reason?: string | null;
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
    /** Delete tests: unused ones are removed, ones with order history are deactivated. */
    bulkDeleteTests: (ids: number[]) =>
      ipcRenderer.invoke('lab:bulkDeleteTests', ids) as Promise<{ ok: boolean; hardDeleted: number; softDeleted: number; results: any[] }>,
    upsertTest: (test: Partial<LabTest>) => ipcRenderer.invoke('lab:upsertTest', test) as Promise<LabTest>,
    loadStandardCatalog: () => ipcRenderer.invoke('lab:loadStandardCatalog') as Promise<{ ok: boolean; added: number; total: number }>,
    createOrder: (payload: {
      appointment_id: number | null;
      patient_id: number;
      doctor_id: number | null;
      notes?: string;
      items: { lab_test_id?: number; test_name: string }[];
    }) => ipcRenderer.invoke('lab:createOrder', payload) as Promise<LabOrder>,
    listOrders: (filter?: { status?: string; patient_id?: number; window?: 'week' | 'month' | 'quarter' | 'all'; sort?: 'recent' | 'name' | 'status' }) =>
      // test_names: the order's tests joined by char(31); see lab:listOrders.
      ipcRenderer.invoke('lab:listOrders', filter || {}) as Promise<(LabOrder & { patient_name: string; patient_uhid: string; doctor_name: string | null; test_names: string | null })[]>,
    getOrderItems: (orderId: number) => ipcRenderer.invoke('lab:getOrderItems', orderId) as Promise<LabOrderItem[]>,
    updateOrderStatus: (orderId: number, status: string) => ipcRenderer.invoke('lab:updateOrderStatus', orderId, status) as Promise<LabOrder>,
    updateResults: (orderId: number, items: { id: number; result: string; is_abnormal?: number }[]) =>
      ipcRenderer.invoke('lab:updateResults', orderId, items) as Promise<LabOrderItem[]>,
    /** Add tests to an order the doctor already sent; re-prices the linked bill. */
    addOrderItems: (orderId: number, items: { lab_test_id?: number; test_name: string }[]) =>
      ipcRenderer.invoke('lab:addOrderItems', orderId, items) as Promise<
        { ok: true; added: number; billChanged: boolean; note: string; total?: number } | { ok: false; error: string }
      >,
    /** The bill raised for a lab order (read-only) — lets the Lab screen offer "Delete bill" to the admin. */
    billOf: (orderId: number) => ipcRenderer.invoke('lab:billOf', orderId) as Promise<{ id: number; bill_number: string; total: number; amount_paid: number; status: string | null } | null>,
    /** Remove a test (refused once its result is entered); re-prices the bill. */
    removeOrderItem: (orderId: number, itemId: number) =>
      ipcRenderer.invoke('lab:removeOrderItem', orderId, itemId) as Promise<
        { ok: true; billChanged: boolean; note: string; total?: number } | { ok: false; error: string }
      >,
  },
  pharmacy: {
    // listDrugs returns DrugMaster rows joined with summed batch qty + earliest expiry.
    // Returns shape stays Drug-compatible for legacy callers (mrp/batch/expiry/stock_qty aliased).
    listDrugs: (filter?: { q?: string; activeOnly?: boolean }) =>
      ipcRenderer.invoke('pharmacy:listDrugs', filter || {}) as Promise<(DrugMaster & Drug)[]>,
    /** How many active medicines sit at each GST rate. */
    gstSummary: () => ipcRenderer.invoke('pharmacy:gstSummary') as Promise<{ total: number; by_rate: { rate: number; count: number }[] }>,
    /** Set the GST rate of many medicines at once (the ticked ones, or every medicine now at `from_rate`, or the whole list). The clinic's own decision. */
    setDrugGst: (p: { rate: number; ids?: number[] | null; from_rate?: number | null }) =>
      ipcRenderer.invoke('pharmacy:setDrugGst', p) as Promise<{ ok: boolean; error?: string; changed?: number; unchanged?: number }>,
    loadStandardCatalog: () =>
      ipcRenderer.invoke('pharmacy:loadStandardCatalog') as Promise<{ ok: boolean; added: number; corrected: number; kept: number; rescheduled: number; total: number }>,
    /** One sale + its lines (with batch/expiry) — used by the printed receipt. */
    saleDetail: (saleId: number) =>
      ipcRenderer.invoke('pharmacy:saleDetail', saleId) as Promise<any>,
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
    /** "Drugs in my clinic": the drugs the clinic holds (a batch or a purchase), with stock, next expiry, cost, price and filter flags. */
    clinicStock: () => ipcRenderer.invoke('pharmacy:clinicStock') as Promise<ClinicStockRow[]>,
    /** What "Start fresh" (ids omitted) or "Delete selected" (ids given) WOULD do — nothing is changed. */
    previewClear: (payload: { ids?: number[] | null } = {}) =>
      ipcRenderer.invoke('pharmacy:previewClear', payload) as Promise<ClearPreview>,
    /** Clear drugs, their stock and batches — admin and the pharmacy in-charge only. Without `ids` it clears everything and needs `confirm: 'START FRESH'`.
     *  A copy of the whole database is saved first (backup_path). */
    clearDrugs: (payload: { ids?: number[] | null; confirm?: string }) =>
      ipcRenderer.invoke('pharmacy:clearDrugs', payload) as Promise<
        { ok: true; mode: 'all' | 'selected'; drugs_deleted: number; drugs_kept_inactive: number; batches_deleted: number; batches_zeroed: number; units_removed: number; backup_path: string }
        | { ok: false; error: string }
      >,
    pendingRx: () => ipcRenderer.invoke('pharmacy:pendingRx') as Promise<(AppointmentWithJoins & { rx_count: number })[]>,
    getAppointmentRx: (appointmentId: number) =>
      ipcRenderer.invoke('pharmacy:getAppointmentRx', appointmentId) as Promise<PrescriptionItem[]>,
    sell: (payload: {
      /** Generated once per attempt; sending the same attempt twice returns the first sale. */
      client_ref?: string;
      patient_id?: number | null;
      /** Walk-in sales only: a name for the guest (ignored when a patient is attached). Optional. */
      customer_name?: string | null;
      appointment_id?: number | null;
      items: { drug_id?: number | null; drug_master_id?: number | null; drug_name: string; qty: number; rate: number; gst_amount?: number }[];
      discount?: number;
      payment_mode?: string;
      sold_by?: string;
      /** Medicines on credit: a registered patient takes them now and pays later. Needs the Settings switch. */
      credit?: boolean;
      /** With `credit`: what is paid now (default 0); the rest stays owing. */
      paid_now?: number;
      /** Charge the medicines to an admitted patient's in-patient bill instead of taking payment. Needs the Settings switch. */
      ipd_admission_id?: number | null;
    }) => ipcRenderer.invoke('pharmacy:sell', payload) as Promise<PharmacySale>,
    /** The stay the patient is in right now (or null) — offers "charge to the in-patient bill" at the counter. */
    patientAdmission: (patientId: number) =>
      ipcRenderer.invoke('pharmacy:patientAdmission', patientId) as Promise<
        { admission_id: number; admission_number: string; ward: string | null; bed_number: string | null; discharge_status: string } | null
      >,
    /** Take a payment against a sale that was made on credit. Refuses an amount above what is still owed. */
    payCredit: (saleId: number, payment: { amount: number; mode?: string | null; reference?: string | null; notes?: string | null; client_ref?: string | null }) =>
      ipcRenderer.invoke('pharmacy:payCredit', saleId, payment) as Promise<
        { ok: true; duplicate: boolean; sale_id: number; due: number } | { ok: false; error: string }
      >,
    /** Counter sales (never ward-dispensed ones): under a registered patient, or walk-in guests. Totals cover the whole filter. */
    counterSales: (filter?: CounterSalesFilter) =>
      ipcRenderer.invoke('pharmacy:counterSales', filter || {}) as Promise<CounterSalesResult>,
    /** How much stock carries a hand-typed cost, for the "Cost not recorded" button. */
    costSummary: () => ipcRenderer.invoke('pharmacy:costSummary') as Promise<CostNotRecordedSummary>,
    /** Clear the cost on hand-typed batches (never purchase-bill ones); optionally on past sales from them too. */
    clearManualCost: (opts?: { include_past_sales?: boolean }) =>
      ipcRenderer.invoke('pharmacy:clearManualCost', opts || {}) as Promise<{ ok: true; batches: number; register_rows: number } | { ok: false; error: string }>,
    listSales: (filter?: { from?: string; to?: string }) =>
      ipcRenderer.invoke('pharmacy:listSales', filter || {}) as Promise<(PharmacySale & { patient_name: string | null; patient_uhid: string | null })[]>,
    /** Free-form pharmacy sale (no FEFO, no inventory deduct, no register). Mirrors
     *  Services / misc:create — patient required, doctor + items + comment optional. */
  },
  wholesalers: {
    list: (filter?: { activeOnly?: boolean }) =>
      ipcRenderer.invoke('wholesalers:list', filter || {}) as Promise<Wholesaler[]>,
    upsert: (w: Partial<Wholesaler>) =>
      ipcRenderer.invoke('wholesalers:upsert', w) as Promise<Wholesaler>,
    delete: (id: number) =>
      ipcRenderer.invoke('wholesalers:delete', id) as Promise<{ ok: boolean }>,
    /** Bills, amount bought and amount owed per supplier (same "owed" rule as the Analytics supplier report). */
    summary: () => ipcRenderer.invoke('wholesalers:summary') as Promise<SupplierSummaryRow[]>,
    /** Every supplier's account in one list: billed, paid, owed now, ageing of the unpaid bills. */
    accounts: () => ipcRenderer.invoke('wholesalers:accounts') as Promise<SupplierAccounts>,
    /** The supplier's whole account as a passbook: bills (credit), payments (debit), running balance, pending bills, latest bills. */
    statement: (id: number, opts?: { from?: string | null; to?: string | null }) =>
      ipcRenderer.invoke('wholesalers:statement', id, opts || {}) as Promise<SupplierStatementResult | null>,
  },
  purchases: {
    list: (filter?: { from?: string; to?: string; wholesaler_id?: number; status?: 'paid' | 'unpaid' | 'partial' | 'outstanding' }) =>
      ipcRenderer.invoke('purchase:list', filter || {}) as Promise<(PurchaseInvoice & { wholesaler_name: string; wholesaler_license_no: string })[]>,
    get: (id: number) =>
      ipcRenderer.invoke('purchase:get', id) as Promise<PurchaseDetail | null>,
    create: (payload: PurchaseInvoiceInput) =>
      ipcRenderer.invoke('purchase:create', payload) as Promise<PurchaseResult>,
    /** Record money paid to the supplier against a bill. */
    addPayment: (invoiceId: number, payment: PurchasePaymentInput) =>
      ipcRenderer.invoke('purchase:addPayment', invoiceId, payment) as Promise<PurchaseResult>,
    /** Pay a supplier once: the amount settles their unpaid bills oldest-first (or only the bills named), never more than is owed. */
    paySupplier: (payment: {
      wholesaler_id: number; amount: number; invoice_ids?: number[] | null; mode?: string | null; paid_on?: string | null;
      reference?: string | null; notes?: string | null; client_ref?: string | null;
    }) => ipcRenderer.invoke('purchase:paySupplier', payment) as Promise<PaySupplierResult>,
  },
  // ===== Import a supplier's bill from the Excel ChatGPT made (Pharmacy → Purchases → Import bill) =====
  // Reading and checking change nothing; only `create` does, and only with the typed word IMPORT.
  purchaseImport: {
    /** The Excel to give ChatGPT as the form to fill (empty), or the same with a sample bill to try the screen — as base64 text. */
    template: (withSample: boolean, which?: string) => ipcRenderer.invoke('purchaseImport:template', withSample, which) as Promise<string>,
    /** Read the uploaded Excel (base64 text) into a draft to review — or say plainly what is wrong with the file. */
    parse: (base64: string) => ipcRenderer.invoke('purchaseImport:parse', base64) as Promise<ParseResult>,
    /** Is this supplier's invoice number already recorded? */
    checkInvoice: (supplierId: number | null, invoiceNumber: string) =>
      ipcRenderer.invoke('purchaseImport:checkInvoice', supplierId, invoiceNumber) as Promise<{ id: number; date: string } | null>,
    /** Save the reviewed draft as a purchase bill. Needs confirm === 'IMPORT'. */
    create: (payload: ImportCommit) => ipcRenderer.invoke('purchaseImport:create', payload) as Promise<ImportResult>,
    /** Bills with lines set aside, waiting to be finished. */
    waiting: () => ipcRenderer.invoke('purchaseImport:waiting') as Promise<WaitingRow[]>,
    waitingGet: (id: number) => ipcRenderer.invoke('purchaseImport:waitingGet', id) as Promise<WaitingGet>,
    deleteWaiting: (id: number) => ipcRenderer.invoke('purchaseImport:deleteWaiting', id) as Promise<{ ok: boolean }>,
    /** The photo kept with a waiting bill. */
    photo: (file: string | null) => ipcRenderer.invoke('purchaseImport:photo', file) as Promise<{ name: string; mime: string; base64: string } | null>,
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
        hsn_code: string | null; gst_rate: number; days_to_expiry: number;
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
    list: (filter?: { status?: string; q?: string; window?: string; limit?: number }) =>
      ipcRenderer.invoke('ip:list', filter || {}) as Promise<(IpAdmission & { patient_name: string; patient_uhid: string; patient_phone: string; doctor_name: string | null })[]>,
    admit: (payload: { patient_id: number; admission_doctor_id?: number; bed_number?: string; ward?: string; admission_notes?: string }) =>
      ipcRenderer.invoke('ip:admit', payload) as Promise<IpAdmission>,
  },
  // ===== Wards, beds and the IPD ward map =====
  wards: {
    list: (includeInactive?: boolean) =>
      ipcRenderer.invoke('wards:list', includeInactive) as Promise<any[]>,
    save: (input: any) =>
      ipcRenderer.invoke('wards:save', input) as Promise<{ ok: true; id: number } | { ok: false; error: string }>,
    remove: (wardId: number) =>
      ipcRenderer.invoke('wards:delete', wardId) as Promise<{ ok: boolean; error?: string }>,
  },
  printJobs: {
    create: (input: any) => ipcRenderer.invoke('printJobs:create', input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    list: (status?: string) => ipcRenderer.invoke('printJobs:list', status) as Promise<any[]>,
    pendingCount: () => ipcRenderer.invoke('printJobs:pendingCount') as Promise<number>,
    markPrinted: (id: number, by?: string) => ipcRenderer.invoke('printJobs:markPrinted', id, by) as Promise<{ ok: boolean; error?: string }>,
    cancel: (id: number) => ipcRenderer.invoke('printJobs:cancel', id) as Promise<{ ok: boolean; error?: string }>,
  },
  beds: {
    /** Every bed with its ward and current occupant — drives the colour-coded map. */
    map: () => ipcRenderer.invoke('beds:map') as Promise<any[]>,
    /** Every bed in one ward, with its live occupant — for the ward's bed list. */
    list: (wardId: number) => ipcRenderer.invoke('beds:list', wardId) as Promise<any[]>,
    save: (input: any) =>
      ipcRenderer.invoke('beds:save', input) as Promise<{ ok: true; id: number } | { ok: false; error: string }>,
    setStatus: (bedId: number, status: string) =>
      ipcRenderer.invoke('beds:setStatus', bedId, status) as Promise<{ ok: boolean; error?: string }>,
    remove: (bedId: number) =>
      ipcRenderer.invoke('beds:remove', bedId) as Promise<{ ok: boolean; error?: string; soft?: boolean }>,
  },
  chargeHeads: {
    list: (appliesTo?: 'opd' | 'ipd') =>
      ipcRenderer.invoke('chargeHeads:list', appliesTo) as Promise<any[]>,
    save: (input: any) =>
      ipcRenderer.invoke('chargeHeads:save', input) as Promise<{ ok: true; id: number } | { ok: false; error: string }>,
  },
  ipd: {
    admit: (input: any) =>
      ipcRenderer.invoke('ip:admitV2', input) as Promise<{ ok: true; id: number; admission_number: string } | { ok: false; error: string }>,
    // Admission requests (doctor raises → reception approves)
    requestAdmission: (input: any) =>
      ipcRenderer.invoke('ip:requestAdmission', input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    admissionRequests: (status?: string) =>
      ipcRenderer.invoke('ip:admissionRequests', status) as Promise<any[]>,
    rejectAdmissionRequest: (id: number, reason?: string, by?: string) =>
      ipcRenderer.invoke('ip:rejectAdmissionRequest', id, reason, by) as Promise<{ ok: boolean; error?: string }>,
    // Discharge-summary templates (department / doctor-wise)
    dischargeTemplatesList: (filter?: { department?: string; doctor_id?: number }) =>
      ipcRenderer.invoke('dischargeTemplates:list', filter || {}) as Promise<any[]>,
    dischargeTemplateSave: (input: any) =>
      ipcRenderer.invoke('dischargeTemplates:save', input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    dischargeTemplateDelete: (id: number) =>
      ipcRenderer.invoke('dischargeTemplates:delete', id) as Promise<{ ok: boolean; error?: string }>,
    transfer: (admissionId: number, toBedId: number, reason?: string, by?: string) =>
      ipcRenderer.invoke('ip:transfer', admissionId, toBedId, reason, by) as Promise<{ ok: boolean; error?: string }>,
    discharge: (admissionId: number, input: any) =>
      ipcRenderer.invoke('ip:dischargeV2', admissionId, input) as Promise<{ ok: boolean; outcome?: string; error?: string }>,
    saveDischargeSummary: (admissionId: number, payload: any) =>
      ipcRenderer.invoke('ip:saveDischargeSummary', admissionId, payload) as Promise<{ ok: boolean; error?: string }>,
    /** Step 1 of discharge: save the summary + flag for billing review (patient stays admitted). */
    requestDischarge: (admissionId: number, input: any, by?: string) =>
      ipcRenderer.invoke('ip:requestDischarge', admissionId, input, by) as Promise<{ ok: boolean; error?: string; total?: number; balanceDue?: number; advanceAvailable?: number; amountPaid?: number }>,
    cancelDischargeRequest: (admissionId: number, by?: string) =>
      ipcRenderer.invoke('ip:cancelDischargeRequest', admissionId, by) as Promise<{ ok: boolean; error?: string }>,
    /** Step 2: approve + actually discharge. Needs override_reason when a balance is due. */
    approveDischarge: (admissionId: number, input: { by?: string; override_reason?: string }) =>
      ipcRenderer.invoke('ip:approveDischarge', admissionId, input) as Promise<{ ok: boolean; error?: string; needsOverride?: boolean; balanceDue?: number; total?: number; advanceAvailable?: number; amountPaid?: number; overridden?: boolean }>,
    vitalsList: (admissionId: number) => ipcRenderer.invoke('ip:vitals:list', admissionId) as Promise<any[]>,
    vitalsAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:vitals:add', admissionId, input) as Promise<any>,
    notesList: (admissionId: number) => ipcRenderer.invoke('ip:progressNote:list', admissionId) as Promise<any[]>,
    notesAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:progressNote:add', admissionId, input) as Promise<any>,
    nursingList: (admissionId: number) => ipcRenderer.invoke('ip:nursingNote:list', admissionId) as Promise<any[]>,
    nursingAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:nursingNote:add', admissionId, input) as Promise<any>,
    ioList: (admissionId: number) => ipcRenderer.invoke('ip:intakeOutput:list', admissionId) as Promise<any[]>,
    ioAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:intakeOutput:add', admissionId, input) as Promise<any>,
    dietList: (admissionId: number) => ipcRenderer.invoke('ip:dietOrder:list', admissionId) as Promise<any[]>,
    dietAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:dietOrder:add', admissionId, input) as Promise<any>,
    // Medication orders + administration record (MAR)
    medOrders: (admissionId: number) => ipcRenderer.invoke('ip:medOrders', admissionId) as Promise<any[]>,
    medOrderAdd: (admissionId: number, input: any) => ipcRenderer.invoke('ip:medOrderAdd', admissionId, input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    medOrderStop: (orderId: number) => ipcRenderer.invoke('ip:medOrderStop', orderId) as Promise<{ ok: boolean; error?: string }>,
    medAdminList: (admissionId: number) => ipcRenderer.invoke('ip:medAdminList', admissionId) as Promise<any[]>,
    medAdminGive: (orderId: number, input: any) => ipcRenderer.invoke('ip:medAdminGive', orderId, input) as Promise<{ ok: boolean; billed?: boolean; error?: string }>,
    // Cross-consultation
    xconsults: (admissionId: number) => ipcRenderer.invoke('ip:xconsults', admissionId) as Promise<any[]>,
    xconsultAdd: (admissionId: number, doctorId: number, reason?: string) => ipcRenderer.invoke('ip:xconsultAdd', admissionId, doctorId, reason) as Promise<{ ok: boolean; error?: string }>,
    xconsultRespond: (id: number, opinion: string, by?: string) => ipcRenderer.invoke('ip:xconsultRespond', id, opinion, by) as Promise<{ ok: boolean; error?: string }>,
  },
  billing: {
    /** Running IPD bill — "what's the bill till now". */
    previewAdmission: (admissionId: number) =>
      ipcRenderer.invoke('bill:previewAdmission', admissionId) as Promise<any>,
    /** Admission bills (running + discharged) for the Billing section's IPD tab. */
    admissionList: (filter?: { status?: 'admitted' | 'discharged' | 'all'; q?: string }) =>
      ipcRenderer.invoke('bill:admissionList', filter || {}) as Promise<{
        admission_id: number; admission_number: string; status: string; ward: string | null; bed_number: string | null;
        admitted_at: string; discharged_at: string | null; discharge_status: string | null; bill_id: number | null;
        patient_name: string; patient_uhid: string; doctor_name: string | null;
        total: number; paid: number; advance: number; balance: number; days: number;
      }[]>,
    addItem: (billId: number, line: any, by?: string) =>
      ipcRenderer.invoke('bill:addItem', billId, line, by) as Promise<any>,
    removeItem: (itemId: number) =>
      ipcRenderer.invoke('bill:removeItem', itemId) as Promise<any>,
    setDiscount: (billId: number, discount: number, type: 'flat' | 'percent', role: string, reason?: string, by?: string) =>
      ipcRenderer.invoke('bill:setDiscount', billId, discount, type, role, reason, by) as Promise<any>,
    /** `ref`: one id per payment attempt — the same attempt sent twice is recorded once. */
    pay: (billId: number, amount: number, mode: string, by?: string, ref?: string) =>
      ipcRenderer.invoke('bill:pay', billId, amount, mode, by, ref) as Promise<{ ok: boolean; error?: string; duplicate?: boolean }>,
    /** Everything for ONE patient: bills + counter pharmacy sales already made, and what can still be billed or collected. */
    patientPortal: (patientId: number) =>
      ipcRenderer.invoke('billing:patientPortal', patientId) as Promise<PatientPortal>,
    /** Raise the bill for a lab/radiology order that has none. `force` confirms past the "already billed by hand?" warning. */
    createOrderBill: (kind: 'lab' | 'radiology', orderId: number, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('billing:createOrderBill', kind, orderId, opts || {}) as Promise<OrderBillResult>,
    /** Advance receipts on an admission, each with its refundable balance. */
    advancesList: (admissionId: number) =>
      ipcRenderer.invoke('advances:list', admissionId) as Promise<{ ok: boolean; error?: string; rows: any[] }>,
    refundAdvance: (advanceId: number, amount: number, reason: string, by?: string) =>
      ipcRenderer.invoke('advances:refund', advanceId, amount, reason, by) as Promise<any>,
    // TPA / insurance
    tpaInsurers: (includeInactive?: boolean) => ipcRenderer.invoke('tpa:insurers', includeInactive) as Promise<any[]>,
    tpaInsurerSave: (input: any) => ipcRenderer.invoke('tpa:insurerSave', input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    tpaClaims: (status?: string) => ipcRenderer.invoke('tpa:claims', status) as Promise<any[]>,
    tpaClaimSave: (input: any) => ipcRenderer.invoke('tpa:claimSave', input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    tpaClaimStatus: (claimId: number, status: string, amount?: number, note?: string, by?: string) =>
      ipcRenderer.invoke('tpa:claimStatus', claimId, status, amount, note, by) as Promise<{ ok: boolean; error?: string }>,
    ipdAnalytics: (from: string, to: string) =>
      ipcRenderer.invoke('analytics:ipd', from, to) as Promise<any>,
    billingAnalytics: (from: string, to: string) =>
      ipcRenderer.invoke('analytics:billing', from, to) as Promise<any>,
    // Standalone bills — OPD consult, pharmacy, lab, or a quick custom bill.
    /** Cancel a wrongly raised (non in-patient) bill; money already received is recorded as a refund. Manager / admin. */
    cancel: (billId: number, reason: string, refundMode?: string | null) =>
      ipcRenderer.invoke('bill:cancel', billId, reason, refundMode) as Promise<
        { ok: true; bill_number: string; refunded: number } | { ok: false; error: string }
      >,
    createStandalone: (input: any) =>
      ipcRenderer.invoke('bill:createStandalone', input) as Promise<{ ok: true; id: number; bill_number: string } | { ok: false; error: string }>,
    previewById: (billId: number) =>
      ipcRenderer.invoke('bill:previewById', billId) as Promise<any>,
    recent: (limit?: number) =>
      ipcRenderer.invoke('bill:recent', limit) as Promise<any[]>,
  },
  // ===== Pediatrics add-on =====
  peds: {
    growthList: (patientId: number) => ipcRenderer.invoke('peds:growthList', patientId) as Promise<any[]>,
    growthAdd: (patientId: number, input: any) => ipcRenderer.invoke('peds:growthAdd', patientId, input) as Promise<{ ok: boolean; id?: number; error?: string }>,
    growthDelete: (id: number) => ipcRenderer.invoke('peds:growthDelete', id) as Promise<{ ok: boolean; error?: string }>,
    vaccineList: (patientId: number) => ipcRenderer.invoke('peds:vaccineList', patientId) as Promise<any[]>,
    vaccineSeed: (patientId: number) => ipcRenderer.invoke('peds:vaccineSeed', patientId) as Promise<{ ok: boolean; added?: number; schedule?: string; error?: string }>,
    vaccineRecalc: (patientId: number) => ipcRenderer.invoke('peds:vaccineRecalcDueDates', patientId) as Promise<{ ok: boolean; updated?: number; error?: string }>,
    vaccineUpdate: (recordId: number, patch: any) => ipcRenderer.invoke('peds:vaccineUpdate', recordId, patch) as Promise<{ ok: boolean; error?: string }>,
    vaccineAddCustom: (patientId: number, input: any) => ipcRenderer.invoke('peds:vaccineAddCustom', patientId, input) as Promise<{ ok: boolean; id?: number; error?: string }>,
  },
  clinicalTemplates: {
    list: () => ipcRenderer.invoke('clinical-templates:list') as Promise<import('./types').ClinicalQuickTemplate[]>,
    save: (tpls: import('./types').ClinicalQuickTemplate[]) => ipcRenderer.invoke('clinical-templates:save', tpls) as Promise<import('./types').ClinicalQuickTemplate[]>,
  },
  notifications: {
    list: (status?: string) => ipcRenderer.invoke('notifications:list', status) as Promise<NotificationLog[]>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    save: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch) as Promise<Settings>,
  },
  /** First-run setup guide: where a fresh clinic stands, and remembering what was saved or skipped. */
  setup: {
    status: () => ipcRenderer.invoke('setup:status') as Promise<SetupStatus>,
    markStep: (step: string, outcome: 'done' | 'skipped') =>
      ipcRenderer.invoke('setup:markStep', step, outcome) as Promise<{ ok: true; status: SetupStatus } | { ok: false; error: string }>,
    setStatus: (status: 'pending' | 'skipped' | 'done', opts?: { stop_reminders?: boolean }) =>
      ipcRenderer.invoke('setup:setStatus', status, opts) as Promise<{ ok: true; status: SetupStatus } | { ok: false; error: string }>,
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
    /** Who sent the patients: the Referral typed on each visit, grouped (Google, Self, Family, a doctor…) with visits, new vs returning and revenue. */
    referrals: (filter: { from: string; to: string }) => ipcRenderer.invoke('analytics:referrals', filter) as Promise<{ ok: true } & ReferralStats>,
    modules: (from: string, to: string) => ipcRenderer.invoke('analytics:modules', from, to) as Promise<{
      ok: boolean;
      modules: { key: string; label: string; count: number; revenue: number; collected: number; outstanding: number }[];
      totals: { revenue: number; collected: number; outstanding: number; count: number };
    }>,
    overview: () => ipcRenderer.invoke('analytics:overview') as Promise<{
      asOf: string;
      todayVisits: number; todayDone: number; todayRevenue: number;
      monthRevenue: number; pharmacyMonthRevenue: number;
      pharmacyMonthPatientRevenue: number; pharmacyMonthGuestRevenue: number;
      /** Money still to collect across every bill. */
      outstandingTotal: number;
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
        valuation: { skus: number; units: number; at_cost: number; at_mrp: number; at_selling: number };
        expiredStock: { batches: number; value: number };
        lowStockCount: number;
        topDrugs: { name: string; units: number; revenue: number; sales: number }[];
        salesMix: { kind: string; count: number; revenue: number }[];
        /** Registered patients vs walk-in guests. */
        customerMix: { kind: 'patient' | 'guest'; count: number; revenue: number; avg_sale: number }[];
        paymentMix: { mode: string; count: number; revenue: number }[];
        /** Medicines sold on credit: this period's, and what is owed now across every credit sale. */
        creditSummary: {
          sold_count: number; credit_value: number; still_owed_from_these: number;
          owed_now: number; sales_owing: number; patients_owing: number; oldest_owed_since: string | null;
        };
        topPatients: { patient_id: number; name: string; uhid: string; sales: number; revenue: number }[];
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
    /** Profit by medicine over a date range (the clinic's local days): revenue, cost, margin, markup, rankings. */
    pharmacyProfit: (filter: { from: string; to: string }) =>
      ipcRenderer.invoke('analytics:pharmacyProfit', filter) as Promise<{ ok: true; report: ProfitReport } | { ok: false; error: string }>,
    /** Stock on hand valued at cost, MRP and selling price, with expected profit and expiry exposure. */
    pharmacyValuation: () => ipcRenderer.invoke('analytics:pharmacyValuation') as Promise<Valuation>,
    supplierReport: (filter: { from: string; to: string }) =>
      ipcRenderer.invoke('analytics:supplierReport', filter) as Promise<{ ok: true; report: SupplierReport } | { ok: false; error: string }>,
    drugPriceHistory: (drugId: number) =>
      ipcRenderer.invoke('analytics:drugPriceHistory', drugId) as Promise<PriceHistoryRow[]>,
    /** Read-only sanity checks over the pharmacy ledger. */
    pharmacyChecks: () => ipcRenderer.invoke('analytics:pharmacyChecks') as Promise<IntegrityFinding[]>,
    /** Money still to collect, by kind of bill, by patient, and by how long it has been owed. */
    receivables: (opts?: { limit?: number }) => ipcRenderer.invoke('analytics:receivables', opts || {}) as Promise<Receivables>,
    /** Discounts given in a period on bills and pharmacy sales, with the largest and who gave them. */
    discounts: (from: string, to: string, limit?: number) => ipcRenderer.invoke('analytics:discounts', from, to, limit) as Promise<DiscountsGiven>,
    /** Lab orders, scans and visits with no bill (last N days) — work that could still be charged. */
    unbilled: (opts?: { days?: number; limit?: number }) => ipcRenderer.invoke('analytics:unbilled', opts || {}) as Promise<UnbilledWork>,
    /** Hand-typed pharmacy bills (Quick Bill → Pharmacy) over a period — kept apart from stock-based pharmacy sales. */
    manualPharmacy: (from: string, to: string) => ipcRenderer.invoke('analytics:manualPharmacy', from, to) as Promise<ManualPharmacy>,
  },
  license: {
    status: () => ipcRenderer.invoke('license:status') as Promise<LicenseStatusIPC>,
    machineId: () => ipcRenderer.invoke('license:machineId') as Promise<string>,
    /** `needsConfirm` + `removed`: this code would switch off paid modules the clinic has today — ask, then call again with { confirmRemoval: true }. */
    activate: (token: string, opts?: { confirmRemoval?: boolean }) => ipcRenderer.invoke('license:activate', token, opts) as Promise<{ ok: boolean; error?: string; status?: LicenseStatusIPC; needsConfirm?: boolean; removed?: string[]; addon?: { modules: string[]; expires_at: string } }>,
    activateOnline: (code: string, opts?: { confirmRemoval?: boolean }) => ipcRenderer.invoke('license:activateOnline', code, opts) as Promise<{ ok: boolean; error?: string; status?: LicenseStatusIPC; needsConfirm?: boolean; removed?: string[]; addon?: { modules: string[]; expires_at: string } }>,
    onState: (cb: (s: LicenseStatusIPC) => void) => {
      const h = (_e: any, s: LicenseStatusIPC) => cb(s);
      ipcRenderer.on('license:state', h);
      return () => ipcRenderer.removeListener('license:state', h);
    },
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state') as Promise<{
      state: 'idle' | 'checking' | 'uptodate' | 'available' | 'error';
      appVersion: string;
      isPackaged: boolean;
      currentVersion?: string;
      latestVersion?: string;
      releaseNotes?: string;
      releaseUrl?: string;
      downloadUrl?: string;
      checkedAt?: string;
      error?: string;
    }>,
    checkNow: () => ipcRenderer.invoke('updates:checkNow') as Promise<{
      ok: boolean;
      isPackaged: boolean;
      state: 'idle' | 'checking' | 'uptodate' | 'available' | 'error';
      currentVersion?: string;
      latestVersion?: string;
      releaseNotes?: string;
      releaseUrl?: string;
      downloadUrl?: string;
      error?: string;
    }>,
    installNow: () => ipcRenderer.invoke('updates:installNow') as Promise<{ ok: boolean }>,
    /** Subscribe to live update-state pushes from the main process. Returns an
     *  unsubscribe function. Used by the top-of-window UpdateBanner so the user
     *  doesn't have to refresh to see "update available" / "downloaded". */
    onState: (cb: (s: any) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('updates:state', handler);
      return () => ipcRenderer.removeListener('updates:state', handler);
    },
    /** Fired when the user clicks the OS notification to "Install update". */
    onPromptInstall: (cb: (s: any) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('updates:promptInstall', handler);
      return () => ipcRenderer.removeListener('updates:promptInstall', handler);
    },
  },
  network: {
    status: () => ipcRenderer.invoke('network:status') as Promise<{
      mode: 'local' | 'server' | 'client';
      listenPort: number;
      serverUrl: string;
      hasSecret: boolean;
      running: boolean;
      port: number;
      clients: number;
      clientList?: { name: string; ip: string; since: number }[];
      ipcChannels: number;
      lanIp: string | null;
      selfTest: { reachable: boolean; ip: string | null; port: number; error?: string; at: number } | null;
      appVersion: string;
      client: {
        installed: boolean;
        serverUrl: string;
        state: 'idle' | 'connected' | 'degraded' | 'offline';
        lastError: string | null;
        lastSuccessAt: number | null;
        latencyMs: number | null;
        consecutiveFailures: number;
      };
    }>,
    applyMode: () => ipcRenderer.invoke('network:applyMode') as Promise<{ ok: boolean; running: boolean; port: number; clients: number; ipcChannels: number }>,
    selfTest: () => ipcRenderer.invoke('network:selfTest') as Promise<{ reachable: boolean; ip: string | null; port: number; error?: string; at: number }>,
    probe: (payload: { url: string; secret?: string }) =>
      ipcRenderer.invoke('network:probe', payload) as Promise<{ ok: true; info: any } | { ok: false; error: string }>,
    joinCode: () => ipcRenderer.invoke('network:joinCode') as Promise<{ code: string | null; expiresAt: number | null; lanIp: string | null; port: number }>,
    regenJoinCode: () => ipcRenderer.invoke('network:regenJoinCode') as Promise<{ ok: true; code: string; expiresAt: number } | { ok: false; error: string }>,
    discover: (opts?: { timeoutMs?: number }) => ipcRenderer.invoke('network:discover', opts || {}) as Promise<{ ip: string; port: number; version: string; lastSeen: number }[]>,
    pair: (payload: { url: string; code: string }) =>
      ipcRenderer.invoke('network:pair', payload) as Promise<{ ok: true; secret: string; port: number; version: string } | { ok: false; error: string }>,
    /** Every usable IPv4 adapter on this PC, wired-first. */
    interfaces: () => ipcRenderer.invoke('network:interfaces') as Promise<{
      interfaces: { name: string; address: string; netmask: string; cidr: string | null; kind: 'wired' | 'wireless' | 'other'; score: number }[];
      active: string | null;
      pinned: string;
    }>,
    /** Staged connectivity check with a plain-English fix per failing step. */
    /** Sweep the LAN for a CureDesk host so the clinic never has to run ipconfig. */
    findHosts: (port?: number) =>
      ipcRenderer.invoke('network:findHosts', port) as Promise<{ ok: boolean; hosts: { ip: string; version?: string; product?: string }[]; error?: string }>,
    diagnose: (payload?: { url?: string; secret?: string }) =>
      ipcRenderer.invoke('network:diagnose', payload || {}) as Promise<{
        ok: boolean;
        ranAt: string;
        target: string;
        steps: { id: string; label: string; ok: boolean; detail: string; hint?: string; ms?: number }[];
        interfaces: { name: string; address: string; kind: string }[];
      }>,
    /** Does this HOST sleep? Sleeping takes every other PC offline with it. */
    hostPower: () => ipcRenderer.invoke('network:hostPower') as Promise<{
      known: boolean; sleepsOnAC: boolean; sleepAfterMinutes: number; preventionActive: boolean; fixCommand: string; detail: string;
    }>,
    disableHostSleep: () => ipcRenderer.invoke('network:disableHostSleep') as Promise<{ ok: boolean; error?: string }>,
    reconnect: () => ipcRenderer.invoke('network:reconnect') as Promise<{ ok: boolean; latencyMs?: number; error?: string }>,
    forget: () => ipcRenderer.invoke('network:forget') as Promise<{ ok: boolean }>,
    /** Live connection-state pushes from the main process (client mode). */
    onState: (cb: (s: any) => void) => {
      const handler = (_e: any, info: any) => cb(info);
      ipcRenderer.on('network:state', handler);
      return () => ipcRenderer.removeListener('network:state', handler);
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
    copyText: (text: string) =>
      ipcRenderer.invoke('app:copyText', text) as Promise<{ ok: boolean; error?: string }>,
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
    now: () => ipcRenderer.invoke('backup:now') as Promise<{ path: string; bundleDir: string; totalBundles: number; documentCount: number;
      verified: boolean; integrityOk: boolean; mismatches: { table: string; live: number; backup: number | null }[];
      receipt: { label: string; count: number }[]; totalRows: number }>,
    nowTo: (targetDir: string) => ipcRenderer.invoke('backup:nowTo', targetDir) as Promise<{ ok: boolean; path?: string; documentCount?: number; error?: string;
      verified?: boolean; integrityOk?: boolean; mismatches?: { table: string; live: number; backup: number | null }[];
      receipt?: { label: string; count: number }[]; totalRows?: number }>,
    list: () => ipcRenderer.invoke('backup:list') as Promise<{ name: string; path: string; size: number; mtime: string }[]>,
    open: () => ipcRenderer.invoke('backup:open') as Promise<void>,
    status: () => ipcRenderer.invoke('backup:status') as Promise<{ lastBackupAt: string | null; lastBackupName: string | null; totalBackups: number; dir: string }>,
    detectCloudFolders: () => ipcRenderer.invoke('backup:detectCloudFolders') as Promise<{ ok: boolean; folders: { provider: string; path: string }[]; error?: string }>,
    useCloudFolder: (baseDir: string, provider?: string) => ipcRenderer.invoke('backup:useCloudFolder', baseDir, provider) as Promise<{ ok: boolean; path?: string; error?: string }>,
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
