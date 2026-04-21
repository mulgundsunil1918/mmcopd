import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { getAllSettings, saveSettings } from '../db/settings';
import { NotificationService } from '../services/notifications';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentWithJoins,
  Bill,
  BillItem,
  BillWithJoins,
  Doctor,
  NotificationLog,
  Patient,
  PatientInput,
  PaymentMode,
  Settings,
} from '../types';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

function generateUHID(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM patients WHERE uhid LIKE ?"
  ).get(`PT-${ymd}-%`) as { c: number };
  return `PT-${ymd}-${pad(row.c + 1, 4)}`;
}

function generateVisitId(firstName: string, phone: string, dateISO: string): string {
  const name = (firstName || '').replace(/[^A-Za-z]/g, '').toUpperCase().padEnd(3, 'X').slice(0, 3);
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const phonePrefix = phoneDigits.slice(0, 2).padEnd(2, '0');
  const day = (dateISO || '').slice(8, 10) || '00';
  return `${name}${phonePrefix}${day}`;
}

function generateBillNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM bills WHERE bill_number LIKE ?"
  ).get(`INV-${ymd}-%`) as { c: number };
  return `INV-${ymd}-${pad(row.c + 1, 4)}`;
}

export function registerIpc() {
  // ===== Patients =====
  ipcMain.handle('patients:search', (_e, q: string) => {
    const db = getDb();
    const like = `%${q.trim()}%`;
    if (!q.trim()) {
      return db
        .prepare(
          'SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit FROM patients p ORDER BY created_at DESC LIMIT 50'
        )
        .all();
    }
    return db
      .prepare(
        `SELECT p.*, (SELECT MAX(appointment_date) FROM appointments WHERE patient_id=p.id) as last_visit
         FROM patients p
         WHERE p.uhid LIKE ? OR p.phone LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ?
         ORDER BY created_at DESC LIMIT 50`
      )
      .all(like, like, like);
  });

  ipcMain.handle('patients:get', (_e, id: number) => {
    return getDb().prepare('SELECT * FROM patients WHERE id=?').get(id);
  });

  ipcMain.handle('patients:create', (_e, input: PatientInput) => {
    const db = getDb();
    const uhid = generateUHID();
    const stmt = db.prepare(
      `INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, email, address, blood_group, place, district, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uhid,
      input.first_name.trim(),
      (input.last_name || '').trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      input.place?.trim() || null,
      input.district?.trim() || null,
      input.state?.trim() || null
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('patients:update', (_e, id: number, input: PatientInput) => {
    const db = getDb();
    db.prepare(
      `UPDATE patients SET first_name=?, last_name=?, dob=?, gender=?, phone=?, email=?, address=?, blood_group=?, place=?, district=?, state=? WHERE id=?`
    ).run(
      input.first_name.trim(),
      (input.last_name || '').trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      input.place?.trim() || null,
      input.district?.trim() || null,
      input.state?.trim() || null,
      id
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  });

  // Distinct places/districts for autocomplete
  ipcMain.handle('patients:knownPlaces', () => {
    const db = getDb();
    const places = db
      .prepare("SELECT DISTINCT place FROM patients WHERE place IS NOT NULL AND place <> '' ORDER BY place")
      .all() as { place: string }[];
    const districts = db
      .prepare("SELECT DISTINCT district FROM patients WHERE district IS NOT NULL AND district <> '' ORDER BY district")
      .all() as { district: string }[];
    return {
      places: places.map((r) => r.place),
      districts: districts.map((r) => r.district),
    };
  });

  ipcMain.handle('patients:recentAppointments', (_e, patientId: number, limit = 5) => {
    return getDb()
      .prepare(
        `SELECT a.*, d.name as doctor_name, d.specialty as doctor_specialty
         FROM appointments a JOIN doctors d ON d.id=a.doctor_id
         WHERE a.patient_id=? ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ?`
      )
      .all(patientId, limit);
  });

  // ===== Doctors =====
  ipcMain.handle('doctors:list', (_e, activeOnly = true) => {
    const db = getDb();
    return activeOnly
      ? db.prepare('SELECT * FROM doctors WHERE is_active=1 ORDER BY name').all()
      : db.prepare('SELECT * FROM doctors ORDER BY is_active DESC, name').all();
  });

  ipcMain.handle('doctors:get', (_e, id: number) => {
    return getDb().prepare('SELECT * FROM doctors WHERE id=?').get(id);
  });

  ipcMain.handle('doctors:create', (_e, d: Partial<Doctor>) => {
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO doctors (name, specialty, phone, email, room_number, is_active, default_fee, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null, d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null);
    return db.prepare('SELECT * FROM doctors WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('doctors:update', (_e, id: number, d: Partial<Doctor>) => {
    const db = getDb();
    db.prepare(
      'UPDATE doctors SET name=?, specialty=?, phone=?, email=?, room_number=?, is_active=?, default_fee=?, signature=? WHERE id=?'
    ).run(d.name ?? '', d.specialty ?? '', d.phone ?? null, d.email ?? null, d.room_number ?? null, d.is_active ?? 1, d.default_fee ?? 500, d.signature ?? null, id);
    return db.prepare('SELECT * FROM doctors WHERE id=?').get(id);
  });

  // ===== Appointments =====
  ipcMain.handle(
    'appointments:bookedSlots',
    (_e, doctorId: number, date: string) => {
      return getDb()
        .prepare(
          "SELECT appointment_time FROM appointments WHERE doctor_id=? AND appointment_date=? AND status <> 'Cancelled'"
        )
        .all(doctorId, date);
    }
  );

  ipcMain.handle('appointments:create', (_e, payload: Omit<Appointment, 'id' | 'created_at' | 'token_number' | 'consultation_token' | 'status'> & { status?: AppointmentStatus }) => {
    const db = getDb();
    // Clinic-wide token: serial number of this patient across ALL doctors for the day.
    const tokenRow = db
      .prepare(
        "SELECT COALESCE(MAX(token_number), 0) as mx FROM appointments WHERE appointment_date=?"
      )
      .get(payload.appointment_date) as { mx: number };
    const token = tokenRow.mx + 1;

    // 7-char Visit ID: first 3 of firstname + last 2 of phone + day of month
    const patient = db.prepare('SELECT first_name, phone FROM patients WHERE id=?').get(payload.patient_id) as { first_name: string; phone: string } | undefined;
    const visitId = patient ? generateVisitId(patient.first_name, patient.phone, payload.appointment_date) : '';

    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, consultation_token, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.patient_id,
        payload.doctor_id,
        payload.appointment_date,
        payload.appointment_time,
        token,
        visitId,
        payload.status ?? (getAllSettings(db).queue_flow_enabled ? 'Waiting' : 'Done'),
        payload.notes ?? null
      );

    const created = db
      .prepare(
        `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
      )
      .get(info.lastInsertRowid) as AppointmentWithJoins;

    // Trigger notifications
    const notif = new NotificationService(db);
    const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(payload.patient_id) as Patient;
    const doctor = db.prepare('SELECT * FROM doctors WHERE id=?').get(payload.doctor_id) as Doctor;
    const settings = getAllSettings(db);
    notif.sendAppointmentConfirmation(patient, created, doctor, settings.clinic_name);
    notif.sendDoctorAlert(doctor, created, patient);

    return created;
  });

  ipcMain.handle(
    'appointments:list',
    (_e, filter: { date?: string; doctor_id?: number; status?: AppointmentStatus }) => {
      const db = getDb();
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (filter?.date) {
        conditions.push('a.appointment_date = ?');
        params.push(filter.date);
      }
      if (filter?.doctor_id) {
        conditions.push('a.doctor_id = ?');
        params.push(filter.doctor_id);
      }
      if (filter?.status) {
        conditions.push('a.status = ?');
        params.push(filter.status);
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      return db
        .prepare(
          `SELECT a.*,
            (p.first_name || ' ' || p.last_name) as patient_name,
            p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
            p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
            d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
          FROM appointments a
          JOIN patients p ON p.id=a.patient_id
          JOIN doctors d ON d.id=a.doctor_id
          ${where}
          ORDER BY a.token_number ASC`
        )
        .all(...params);
    }
  );

  ipcMain.handle('appointments:updateStatus', (_e, id: number, status: AppointmentStatus) => {
    const db = getDb();
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, id);
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  });

  ipcMain.handle('appointments:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT a.*,
          (p.first_name || ' ' || p.last_name) as patient_name,
          p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
          p.phone as patient_phone, p.blood_group as patient_blood_group, p.created_at as patient_created_at,
          d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room
        FROM appointments a
        JOIN patients p ON p.id=a.patient_id
        JOIN doctors d ON d.id=a.doctor_id
        WHERE a.id=?`
      )
      .get(id);
  });

  // ===== Bills =====
  ipcMain.handle(
    'bills:create',
    (
      _e,
      payload: {
        appointment_id: number | null;
        patient_id: number;
        items: BillItem[];
        discount: number;
        discount_type: 'flat' | 'percent';
        payment_mode: PaymentMode;
      }
    ) => {
      const db = getDb();
      const subtotal = payload.items.reduce((s, it) => s + Number(it.amount || 0), 0);
      const discountValue =
        payload.discount_type === 'percent'
          ? (subtotal * payload.discount) / 100
          : payload.discount;
      const total = Math.max(0, subtotal - discountValue);
      const billNumber = generateBillNumber();
      const info = db
        .prepare(
          `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, discount_type, total, payment_mode, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNumber,
          payload.appointment_id,
          payload.patient_id,
          JSON.stringify(payload.items),
          subtotal,
          payload.discount,
          payload.discount_type,
          total,
          payload.payment_mode,
          new Date().toISOString()
        );

      if (payload.appointment_id) {
        db.prepare("UPDATE appointments SET status='Done' WHERE id=?").run(payload.appointment_id);
      }

      return db
        .prepare(
          `SELECT b.*,
             (p.first_name || ' ' || p.last_name) as patient_name,
             p.uhid as patient_uhid,
             d.name as doctor_name
           FROM bills b
           JOIN patients p ON p.id=b.patient_id
           LEFT JOIN appointments a ON a.id=b.appointment_id
           LEFT JOIN doctors d ON d.id=a.doctor_id
           WHERE b.id=?`
        )
        .get(info.lastInsertRowid);
    }
  );

  ipcMain.handle('bills:list', (_e, filter: { q?: string; from?: string; to?: string }) => {
    const db = getDb();
    const conditions: string[] = [];
    const params: string[] = [];
    if (filter?.q) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR b.bill_number LIKE ?)");
      const like = `%${filter.q}%`;
      params.push(like, like);
    }
    if (filter?.from) {
      conditions.push('date(b.created_at) >= ?');
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push('date(b.created_at) <= ?');
      params.push(filter.to);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return db
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN appointments a ON a.id=b.appointment_id
         LEFT JOIN doctors d ON d.id=a.doctor_id
         ${where}
         ORDER BY b.created_at DESC LIMIT 200`
      )
      .all(...params);
  });

  ipcMain.handle('bills:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT b.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid,
           d.name as doctor_name
         FROM bills b
         JOIN patients p ON p.id=b.patient_id
         LEFT JOIN appointments a ON a.id=b.appointment_id
         LEFT JOIN doctors d ON d.id=a.doctor_id
         WHERE b.id=?`
      )
      .get(id);
  });

  // ===== Consultations =====
  ipcMain.handle('consultations:getByAppointment', (_e, appointmentId: number) => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM consultations WHERE appointment_id=?')
      .get(appointmentId) as any;
    if (!row) return null;
    return {
      ...row,
      vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
    };
  });

  ipcMain.handle(
    'consultations:save',
    (
      _e,
      payload: {
        appointment_id: number;
        patient_id: number;
        doctor_id: number;
        history?: string;
        vitals?: Record<string, string>;
        examination?: string;
        impression?: string;
        advice?: string;
        follow_up_date?: string | null;
      }
    ) => {
      const db = getDb();
      const vitalsJson = payload.vitals ? JSON.stringify(payload.vitals) : null;
      const existing = db
        .prepare('SELECT id FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id) as { id: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE consultations SET history=?, vitals_json=?, examination=?, impression=?, advice=?, follow_up_date=?, updated_at=datetime('now') WHERE id=?`
        ).run(
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO consultations (appointment_id, patient_id, doctor_id, history, vitals_json, examination, impression, advice, follow_up_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          payload.appointment_id,
          payload.patient_id,
          payload.doctor_id,
          payload.history ?? null,
          vitalsJson,
          payload.examination ?? null,
          payload.impression ?? null,
          payload.advice ?? null,
          payload.follow_up_date ?? null
        );
      }
      const row = db
        .prepare('SELECT * FROM consultations WHERE appointment_id=?')
        .get(payload.appointment_id) as any;
      return {
        ...row,
        vitals: row.vitals_json ? JSON.parse(row.vitals_json) : null,
      };
    }
  );

  // ===== Prescriptions =====
  ipcMain.handle('rx:getByAppointment', (_e, appointmentId: number) => {
    return getDb()
      .prepare('SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id')
      .all(appointmentId);
  });

  ipcMain.handle(
    'rx:saveAll',
    (
      _e,
      appointmentId: number,
      items: { drug_name: string; dosage?: string; frequency?: string; duration?: string; instructions?: string }[]
    ) => {
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM prescription_items WHERE appointment_id=?').run(appointmentId);
        const ins = db.prepare(
          'INSERT INTO prescription_items (appointment_id, drug_name, dosage, frequency, duration, instructions, order_idx) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        items.forEach((it, idx) => {
          if (!it.drug_name?.trim()) return;
          ins.run(appointmentId, it.drug_name.trim(), it.dosage ?? null, it.frequency ?? null, it.duration ?? null, it.instructions ?? null, idx);
        });
      });
      tx();
      return db
        .prepare('SELECT * FROM prescription_items WHERE appointment_id=? ORDER BY order_idx, id')
        .all(appointmentId);
    }
  );

  // ===== Lab =====
  ipcMain.handle('lab:listTests', (_e, activeOnly = true) => {
    const db = getDb();
    return activeOnly
      ? db.prepare('SELECT * FROM lab_tests WHERE is_active=1 ORDER BY name').all()
      : db.prepare('SELECT * FROM lab_tests ORDER BY is_active DESC, name').all();
  });

  ipcMain.handle('lab:upsertTest', (_e, test: any) => {
    const db = getDb();
    if (test.id) {
      db.prepare(
        'UPDATE lab_tests SET name=?, price=?, sample_type=?, ref_range=?, unit=?, is_active=? WHERE id=?'
      ).run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1, test.id);
      return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(test.id);
    }
    const info = db
      .prepare('INSERT INTO lab_tests (name, price, sample_type, ref_range, unit, is_active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(test.name, test.price ?? 0, test.sample_type ?? null, test.ref_range ?? null, test.unit ?? null, test.is_active ?? 1);
    return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle(
    'lab:createOrder',
    (
      _e,
      payload: { appointment_id: number | null; patient_id: number; doctor_id: number | null; notes?: string; items: { lab_test_id?: number; test_name: string }[] }
    ) => {
      const db = getDb();
      const d = new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const row = db.prepare("SELECT COUNT(*) as c FROM lab_orders WHERE order_number LIKE ?").get(`LAB-${ymd}-%`) as { c: number };
      const orderNumber = `LAB-${ymd}-${pad(row.c + 1, 4)}`;
      const tx = db.transaction(() => {
        const info = db
          .prepare(
            'INSERT INTO lab_orders (order_number, appointment_id, patient_id, doctor_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(orderNumber, payload.appointment_id, payload.patient_id, payload.doctor_id, 'ordered', payload.notes ?? null);
        const orderId = Number(info.lastInsertRowid);
        const insItem = db.prepare(
          'INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, ref_range, unit) VALUES (?, ?, ?, ?, ?)'
        );
        for (const it of payload.items) {
          let range: string | null = null;
          let unit: string | null = null;
          if (it.lab_test_id) {
            const t = db.prepare('SELECT ref_range, unit FROM lab_tests WHERE id=?').get(it.lab_test_id) as any;
            range = t?.ref_range ?? null; unit = t?.unit ?? null;
          }
          insItem.run(orderId, it.lab_test_id ?? null, it.test_name, range, unit);
        }
        return orderId;
      });
      const id = tx();
      return db.prepare('SELECT * FROM lab_orders WHERE id=?').get(id);
    }
  );

  ipcMain.handle('lab:listOrders', (_e, filter: { status?: string; patient_id?: number } = {}) => {
    const db = getDb();
    const conds: string[] = [];
    const params: any[] = [];
    if (filter.status) { conds.push('o.status=?'); params.push(filter.status); }
    if (filter.patient_id) { conds.push('o.patient_id=?'); params.push(filter.patient_id); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    return db
      .prepare(
        `SELECT o.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, d.name as doctor_name
         FROM lab_orders o
         JOIN patients p ON p.id=o.patient_id
         LEFT JOIN doctors d ON d.id=o.doctor_id
         ${where}
         ORDER BY o.ordered_at DESC LIMIT 200`
      )
      .all(...params);
  });

  ipcMain.handle('lab:getOrderItems', (_e, orderId: number) => {
    return getDb().prepare('SELECT * FROM lab_order_items WHERE lab_order_id=?').all(orderId);
  });

  ipcMain.handle('lab:updateOrderStatus', (_e, orderId: number, status: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    const fields: Record<string, any> = { status };
    if (status === 'sample_collected') fields.collected_at = now;
    if (status === 'reported') fields.reported_at = now;
    const cols = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    db.prepare(`UPDATE lab_orders SET ${cols} WHERE id=?`).run(...Object.values(fields), orderId);
    return db.prepare('SELECT * FROM lab_orders WHERE id=?').get(orderId);
  });

  ipcMain.handle('lab:updateResults', (_e, orderId: number, items: { id: number; result: string; is_abnormal?: number }[]) => {
    const db = getDb();
    const upd = db.prepare('UPDATE lab_order_items SET result=?, is_abnormal=? WHERE id=?');
    const tx = db.transaction(() => {
      for (const it of items) upd.run(it.result, it.is_abnormal ?? 0, it.id);
    });
    tx();
    return db.prepare('SELECT * FROM lab_order_items WHERE lab_order_id=?').all(orderId);
  });

  // ===== IP Admissions =====
  ipcMain.handle('ip:list', (_e, filter: { status?: string } = {}) => {
    const db = getDb();
    const where = filter.status ? 'WHERE a.status=?' : '';
    const params = filter.status ? [filter.status] : [];
    return db
      .prepare(
        `SELECT a.*, (p.first_name || ' ' || p.last_name) as patient_name, p.uhid as patient_uhid, p.phone as patient_phone, d.name as doctor_name
         FROM ip_admissions a
         JOIN patients p ON p.id=a.patient_id
         LEFT JOIN doctors d ON d.id=a.admission_doctor_id
         ${where}
         ORDER BY a.admitted_at DESC`
      )
      .all(...params);
  });

  ipcMain.handle('ip:admit', (_e, payload: { patient_id: number; admission_doctor_id?: number; bed_number?: string; ward?: string; admission_notes?: string }) => {
    const db = getDb();
    const d = new Date();
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
    const row = db.prepare("SELECT COUNT(*) as c FROM ip_admissions WHERE admission_number LIKE ?").get(`IP-${ymd}-%`) as { c: number };
    const num = `IP-${ymd}-${pad(row.c + 1, 4)}`;
    const info = db
      .prepare(
        'INSERT INTO ip_admissions (admission_number, patient_id, admission_doctor_id, bed_number, ward, admission_notes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(num, payload.patient_id, payload.admission_doctor_id ?? null, payload.bed_number ?? null, payload.ward ?? null, payload.admission_notes ?? null);
    return db.prepare('SELECT * FROM ip_admissions WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('ip:discharge', (_e, id: number, summary: string) => {
    const db = getDb();
    db.prepare(
      "UPDATE ip_admissions SET status='discharged', discharged_at=?, discharge_summary=? WHERE id=?"
    ).run(new Date().toISOString(), summary, id);
    return db.prepare('SELECT * FROM ip_admissions WHERE id=?').get(id);
  });

  // ===== Notifications =====
  ipcMain.handle('notifications:list', (_e, status?: string) => {
    const db = getDb();
    const where = status ? 'WHERE n.status = ?' : '';
    const params = status ? [status] : [];
    return db
      .prepare(
        `SELECT n.*,
           (p.first_name || ' ' || p.last_name) as patient_name
         FROM notification_log n
         LEFT JOIN patients p ON p.id=n.patient_id
         ${where}
         ORDER BY n.created_at DESC LIMIT 500`
      )
      .all(...params);
  });

  // ===== Settings =====
  ipcMain.handle('settings:get', () => getAllSettings(getDb()));
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    saveSettings(getDb(), patch);
    return getAllSettings(getDb());
  });

  // ===== Patient Log =====
  ipcMain.handle('patients:log', (_e, filter: { from: string; to: string; q?: string; doctor_id?: number }) => {
    const db = getDb();
    const conditions: string[] = ['a.appointment_date >= ?', 'a.appointment_date <= ?'];
    const params: (string | number)[] = [filter.from, filter.to];
    if (filter.doctor_id) {
      conditions.push('a.doctor_id = ?');
      params.push(filter.doctor_id);
    }
    if (filter.q && filter.q.trim()) {
      conditions.push("((p.first_name || ' ' || p.last_name) LIKE ? OR p.uhid LIKE ? OR p.phone LIKE ?)");
      const like = `%${filter.q.trim()}%`;
      params.push(like, like, like);
    }
    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = db
      .prepare(
        `SELECT a.*,
           (p.first_name || ' ' || p.last_name) as patient_name,
           p.uhid as patient_uhid, p.dob as patient_dob, p.gender as patient_gender,
           p.phone as patient_phone, p.blood_group as patient_blood_group,
           p.created_at as patient_created_at,
           d.name as doctor_name, d.specialty as doctor_specialty, d.room_number as doctor_room,
           b.total as bill_total, b.payment_mode as bill_payment_mode, b.bill_number
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN bills b ON b.appointment_id = a.id
         ${where}
         ORDER BY a.appointment_date DESC, a.appointment_time ASC`
      )
      .all(...params) as any[];

    // Additional intel
    const uniquePatients = new Set(rows.map((r) => r.patient_id)).size;
    const revenue = rows.reduce((s, r) => s + Number(r.bill_total || 0), 0);
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.appointment_date, (byDate.get(r.appointment_date) || 0) + 1);
    const peakDay = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const daysCovered = byDate.size || 1;
    const avgPerDay = Math.round((rows.length / daysCovered) * 10) / 10;

    const byDoctor = new Map<string, { doctor: string; specialty: string; count: number }>();
    for (const r of rows) {
      const key = r.doctor_name;
      const cur = byDoctor.get(key) || { doctor: r.doctor_name, specialty: r.doctor_specialty, count: 0 };
      cur.count += 1;
      byDoctor.set(key, cur);
    }

    const byStatus = new Map<string, number>();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);

    // First-time vs repeat (among this range)
    const patientFirstSeen = new Map<number, string>();
    for (const r of rows) {
      const prev = patientFirstSeen.get(r.patient_id);
      if (!prev || r.appointment_date < prev) patientFirstSeen.set(r.patient_id, r.appointment_date);
    }

    return {
      rows,
      intel: {
        totalVisits: rows.length,
        uniquePatients,
        repeatVisits: rows.length - uniquePatients,
        revenue,
        daysCovered,
        avgPerDay,
        peakDay: peakDay ? { date: peakDay[0], count: peakDay[1] } : null,
        byDoctor: [...byDoctor.values()].sort((a, b) => b.count - a.count),
        byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      },
    };
  });

  // ===== Patient Origin (place stats) =====
  ipcMain.handle('origin:summary', (_e, filter: { from: string; to: string }) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.patient_id,
                p.place, p.district, p.state,
                a.appointment_date
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.appointment_date >= ? AND a.appointment_date <= ?
           AND a.status <> 'Cancelled'`
      )
      .all(filter.from, filter.to) as { patient_id: number; place: string | null; district: string | null; state: string | null; appointment_date: string }[];

    const norm = (s?: string | null) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const title = (s: string) => s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

    const byPlace = new Map<string, { display: string; visits: number; patients: Set<number> }>();
    const byDistrict = new Map<string, { display: string; visits: number; patients: Set<number> }>();
    const byState = new Map<string, { display: string; visits: number; patients: Set<number> }>();

    for (const r of rows) {
      const placeKey = norm(r.place) || '__unknown__';
      const districtKey = norm(r.district) || '__unknown__';
      const stateKey = norm(r.state) || '__unknown__';
      const placeDisp = r.place ? title(norm(r.place)) : 'Unknown';
      const districtDisp = r.district ? title(norm(r.district)) : 'Unknown';
      const stateDisp = r.state ? title(norm(r.state)) : 'Unknown';

      const p = byPlace.get(placeKey) || { display: placeDisp, visits: 0, patients: new Set<number>() };
      p.visits += 1; p.patients.add(r.patient_id); byPlace.set(placeKey, p);

      const d = byDistrict.get(districtKey) || { display: districtDisp, visits: 0, patients: new Set<number>() };
      d.visits += 1; d.patients.add(r.patient_id); byDistrict.set(districtKey, d);

      const s = byState.get(stateKey) || { display: stateDisp, visits: 0, patients: new Set<number>() };
      s.visits += 1; s.patients.add(r.patient_id); byState.set(stateKey, s);
    }

    const serialize = (m: Map<string, { display: string; visits: number; patients: Set<number> }>) =>
      [...m.values()]
        .map((v) => ({ name: v.display, visits: v.visits, patients: v.patients.size }))
        .sort((a, b) => b.visits - a.visits);

    return {
      totalVisits: rows.length,
      uniquePatients: new Set(rows.map((r) => r.patient_id)).size,
      missingPlace: rows.filter((r) => !r.place).length,
      byPlace: serialize(byPlace),
      byDistrict: serialize(byDistrict),
      byState: serialize(byState),
    };
  });

  // ===== Finance =====
  ipcMain.handle('finance:summary', () => {
    const db = getDb();
    const today = todayISO();
    const row = (sql: string, params: any[] = []) => db.prepare(sql).get(...params) as any;
    const all = (sql: string, params: any[] = []) => db.prepare(sql).all(...params) as any[];

    const todayTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at)=?", [today]);
    const weekTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE date(created_at) >= date(?, '-6 days')", [today]);
    const monthTotal = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', ?)", [today]);
    const allTime = row("SELECT COALESCE(SUM(total),0) as t, COUNT(*) as c FROM bills");

    const byDay = all(
      `SELECT date(created_at) as day, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-29 days')
       GROUP BY date(created_at) ORDER BY day DESC`,
      [today]
    );
    const byWeek = all(
      `SELECT strftime('%Y-W%W', created_at) as week, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at) >= date(?, '-56 days')
       GROUP BY week ORDER BY week DESC`,
      [today]
    );
    const byMonth = all(
      `SELECT strftime('%Y-%m', created_at) as month, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills
       GROUP BY month ORDER BY month DESC LIMIT 12`
    );
    const byMode = all(
      `SELECT payment_mode, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills GROUP BY payment_mode ORDER BY total DESC`
    );
    const byDoctor = all(
      `SELECT d.name as doctor, d.specialty, COALESCE(SUM(b.total),0) as total, COUNT(b.id) as count
       FROM bills b
       LEFT JOIN appointments a ON a.id=b.appointment_id
       LEFT JOIN doctors d ON d.id=a.doctor_id
       WHERE d.id IS NOT NULL
       GROUP BY d.id ORDER BY total DESC`
    );
    const todayByMode = all(
      `SELECT payment_mode, COALESCE(SUM(total),0) as total, COUNT(*) as count
       FROM bills WHERE date(created_at)=?
       GROUP BY payment_mode`,
      [today]
    );

    return {
      today: { total: todayTotal.t, count: todayTotal.c, byMode: todayByMode },
      week: { total: weekTotal.t, count: weekTotal.c },
      month: { total: monthTotal.t, count: monthTotal.c },
      allTime: { total: allTime.t, count: allTime.c },
      byDay, byWeek, byMonth, byMode, byDoctor,
    };
  });

  // ===== Stats =====
  ipcMain.handle('stats:today', () => {
    const db = getDb();
    const date = todayISO();
    const total = db.prepare('SELECT COUNT(*) as c FROM appointments WHERE appointment_date=?').get(date) as { c: number };
    const waiting = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Waiting'").get(date) as { c: number };
    const inprog = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='In Progress'").get(date) as { c: number };
    const done = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE appointment_date=? AND status='Done'").get(date) as { c: number };
    return { date, total: total.c, waiting: waiting.c, inprogress: inprog.c, done: done.c };
  });
}
