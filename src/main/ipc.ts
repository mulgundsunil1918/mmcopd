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
      `INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, email, address, blood_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uhid,
      input.first_name.trim(),
      input.last_name.trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(info.lastInsertRowid);
  });

  ipcMain.handle('patients:update', (_e, id: number, input: PatientInput) => {
    const db = getDb();
    db.prepare(
      `UPDATE patients SET first_name=?, last_name=?, dob=?, gender=?, phone=?, email=?, address=?, blood_group=? WHERE id=?`
    ).run(
      input.first_name.trim(),
      input.last_name.trim(),
      input.dob,
      input.gender,
      input.phone.trim(),
      input.email ?? null,
      input.address ?? null,
      input.blood_group ?? null,
      id
    );
    return db.prepare('SELECT * FROM patients WHERE id=?').get(id);
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

  ipcMain.handle('appointments:create', (_e, payload: Omit<Appointment, 'id' | 'created_at' | 'token_number' | 'status'> & { status?: AppointmentStatus }) => {
    const db = getDb();
    const tokenRow = db
      .prepare(
        "SELECT COALESCE(MAX(token_number), 0) as mx FROM appointments WHERE doctor_id=? AND appointment_date=?"
      )
      .get(payload.doctor_id, payload.appointment_date) as { mx: number };
    const token = tokenRow.mx + 1;
    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.patient_id,
        payload.doctor_id,
        payload.appointment_date,
        payload.appointment_time,
        token,
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
