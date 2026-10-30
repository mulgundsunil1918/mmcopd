/**
 * What a backup must carry, and the checks between "a file somebody picked" and "the clinic's data is replaced".
 *
 * THE RULE (the owner's, 2026-10-26): whatever the clinic has done in CureDesk must come back exactly as it was when it restores from a backup — every module, the
 * pharmacy, anything added later — and nothing may fail on the way. Two things keep that true without anybody having to remember:
 *
 *   1. The backup is a whole-database copy (SQLite's own online backup), so every table — present or future — is in it by construction. What can still be forgotten
 *      is a FILE kept outside the database. Every entry of the app's data folder is therefore listed in DATA_LAYOUT below: either a backup carries it, or the reason
 *      it does not is written next to it. tests/e2e/backup-restore.test.ts fails the build when the app writes anything that is not listed (a file or a folder found
 *      in a fully used data folder, or a name in the source code), so a new feature cannot ship without somebody deciding "is this backed up?".
 *   2. A restore never trusts the file it is given: inspectBackupDb() looks inside first (is it a CureDesk database, is it sound, is it from a NEWER CureDesk than
 *      this one), and the restore itself (ipc.ts) puts the clinic's own data back if the restored database cannot be opened.
 */
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../db/schema';

export interface DataEntry {
  /** File or folder name inside the app's data folder. */
  path: string;
  /** Does a backup carry it? */
  backed_up: boolean;
  what: string;
  /** Required when `backed_up` is false: why a copy of it would not be right. */
  why_not?: string;
}

/** Everything the app keeps in its data folder. Add a line here the day a feature writes a new file — and decide whether the backup must carry it. */
export const DATA_LAYOUT: DataEntry[] = [
  { path: 'caredesk.sqlite', backed_up: true, what: 'the database: every table — patients, visits, prescriptions, bills, payments, the pharmacy (drugs, batches, purchases, sales, the Schedule H register), lab and radiology, in-patients, referrals, settings (the pharmacy’s own GST, the letterhead, templates), users and the audit trail' },
  { path: 'documents', backed_up: true, what: 'files that belong to the data: patient documents (documents/<patient id>/…) and the pictures of imported supplier bills (documents/purchase-scans/…)' },
  { path: 'license.dat', backed_up: false, what: 'this PC’s licence', why_not: 'a licence is issued for one PC; a restored copy would not be valid on another. The vendor re-issues it (and the clinic keeps its own file when it restores on the same PC)' },
  { path: 'license-addons.dat', backed_up: false, what: 'this PC’s module codes (Lab, Pharmacy, In-patient, WhatsApp)', why_not: 'same as the licence: tied to the PC it was issued for' },
  { path: '.license_meta', backed_up: false, what: 'licence bookkeeping (first-run date, last seen clock)', why_not: 'belongs to this PC’s licence' },
  { path: '.used_licenses', backed_up: false, what: 'the list of licence codes already used on this PC', why_not: 'belongs to this PC’s licence' },
  { path: 'backups', backed_up: false, what: 'safety copies the app makes by itself (before an upgrade, before a restore, before clearing stock)', why_not: 'they ARE backups; copying them into a backup would only make it grow' },
  { path: 'report-pdfs', backed_up: false, what: 'PDF copies of lab / radiology reports made for sending on WhatsApp', why_not: 'only copies: a report is made again from the clinic data (which IS backed up) whenever it is needed; old copies are cleared after 30 days' },
  { path: 'DO-NOT-DELETE — CureDesk clinic data.txt', backed_up: false, what: 'a note that tells a person not to delete this folder', why_not: 'not clinic data' },
];

/** Entries of the data folder that are never clinic data: SQLite's own working files and the browser engine's caches and per-PC preferences. */
const WORKING_ENTRIES = [
  /^caredesk\.sqlite-(wal|shm|journal)$/,                                     // SQLite's working files for the open database
  /^(Local Storage|Session Storage|IndexedDB|Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Network|Partitions|Shared Dictionary|SharedStorage|Service Worker|blob_storage|Dictionaries|WebStorage|Trust Tokens|VideoDecodeStats|logs|Crashpad|component_crx_cache|extensions_crx_cache)$/,
  /^(Preferences|Cookies|Cookies-journal|Local State|SingletonLock|SingletonCookie|SingletonSocket|DIPS|DIPS-wal|Network Persistent State|TransportSecurity|Visited Links|lockfile|\.org\.chromium\.Chromium\..*|config\.json)$/,
  /^reset-marker.*$/,                                                         // the hard-reset marker (removed on the next start)
  /^(documents\.restoring|documents\.before-restore|caredesk\.sqlite\.restoring)$/,   // a restore in progress (gone when it finishes; put back from the safety copy if it fails)
];

/** Is this entry of the data folder accounted for — listed in DATA_LAYOUT, or one of the engine's own working files? */
export function isKnownDataEntry(name: string): boolean {
  return DATA_LAYOUT.some((e) => e.path === name) || WORKING_ENTRIES.some((re) => re.test(name));
}

export type BackupInspection =
  | { ok: true; schemaVersion: number; tables: number; rows: number }
  | { ok: false; error: string };

/** Tables every CureDesk database has had since its first release (the very first had no users table): if they are missing it is some other SQLite file. */
const MUST_HAVE = ['patients', 'settings'];

/**
 * Look inside a file offered as a backup BEFORE anything is replaced: is it an SQLite database at all, is it sound (SQLite's own integrity check),
 * is it a CureDesk database, and was it made by a NEWER CureDesk than this one (its tables could hold things this version would silently drop).
 * Older backups are fine — opening them brings them up to date.
 */
export function inspectBackupDb(sqlitePath: string, appSchemaVersion: number = SCHEMA_VERSION): BackupInspection {
  let db: Database.Database;
  try { db = new Database(sqlitePath, { readonly: true, fileMustExist: true }); }
  catch (e: any) { return { ok: false, error: `That file cannot be opened as a database (${e?.message || e}). Pick a CureDesk backup — the caredesk.sqlite inside a backup folder.` }; }
  try {
    let integrity = '';
    try { integrity = String((db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string })?.integrity_check ?? ''); }
    catch (e: any) { return { ok: false, error: `That file is damaged and cannot be read (${e?.message || e}). Nothing was changed — try another backup.` }; }
    if (integrity.toLowerCase() !== 'ok') return { ok: false, error: `That backup file is damaged (${integrity.slice(0, 120)}). Nothing was changed — try another backup.` };

    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
    const missing = MUST_HAVE.filter((t) => !names.has(t));
    if (missing.length) return { ok: false, error: 'That file is a database, but not a CureDesk backup (it has no ' + missing.join(' / ') + ' table). Nothing was changed.' };

    let version = 0;
    try {
      const row = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as { value: string } | undefined;
      version = row ? parseInt(row.value, 10) || 0 : 0;
    } catch { version = 0; }                                                     // a very old backup has no version row: it is older, which is fine
    if (version > appSchemaVersion) {
      return { ok: false, error: `That backup was made by a NEWER CureDesk (database version ${version}; this one understands up to ${appSchemaVersion}). Install the newest CureDesk first, then restore it. Nothing was changed.` };
    }
    let rows = 0;
    for (const t of names) { if (t.startsWith('sqlite_')) continue; try { rows += (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c; } catch { /* a table that cannot be counted does not stop a restore */ } }
    return { ok: true, schemaVersion: version, tables: [...names].filter((t) => !t.startsWith('sqlite_')).length, rows };
  } finally { db.close(); }
}
