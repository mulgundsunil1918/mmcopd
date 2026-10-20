import Database from 'better-sqlite3';
import { format } from 'date-fns';
import { runMigrations } from '../../src/db/migrations';
import { fmtDateTime, parseDbDate } from '../../src/lib/utils';

const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
// exactly what patients:create does — created_at is left to the column default
const id = Number(db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone) VALUES ('PT-T-1','Reg','Time','1990-01-01','M','9000000001')").run().lastInsertRowid);
const row = db.prepare('SELECT created_at FROM patients WHERE id=?').get(id) as any;
const parsed = parseDbDate(row.created_at)!;
const driftSec = Math.abs(Date.now() - parsed.getTime()) / 1000;
const shown = fmtDateTime(row.created_at);
const clock = format(new Date(), 'do MMMM yyyy · hh:mm a');
const ok = driftSec < 5 && shown === clock;
console.log(`${(process.env.TZ || '').padEnd(22)} stored(UTC)=${row.created_at}  screen shows "${shown}"  PC clock "${clock}"  drift=${driftSec.toFixed(1)}s  ${ok ? '✓ MATCH' : '✗ MISMATCH'}`);
process.exit(ok ? 0 : 1);
