import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Plus, Key, Shield, KeyRound, AlertTriangle, Trash2, Search } from 'lucide-react';
import { Modal } from '../components/Modal';
import { AdminGate } from '../components/AdminGate';
import { useToast } from '../hooks/useToast';
import { cn, fmtDateTime } from '../lib/utils';
import type { Role } from '../hooks/useAuth';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  staff: 'Staff (Reception + Doctor)',
  manager: 'Manager',
  receptionist: 'Receptionist',
  doctor: 'Doctor',
  nurse: 'Nurse',
  ward_incharge: 'Ward In-charge',
  lab_tech: 'Lab Tech',
  pharmacist: 'Pharmacist',
};

/** What each role is for — shown under the picker so clinics assign correctly. */
const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access including settings, users, billing and danger-zone actions.',
  manager: 'Runs the business side — billing, accounts, analytics, insurance and the IPD bill. Sees money everywhere, but not Settings, Users or the danger zone.',
  staff: 'Default combined reception + doctor access. Not assignable to a real account.',
  receptionist: 'Register patients, book appointments, admit to a ward, take payments and raise bills.',
  doctor: 'Consultations, prescriptions, ward rounds, progress notes and discharge summaries.',
  nurse: 'Record vitals, give medicines, intake/output and nursing notes for admitted patients.',
  ward_incharge: 'Everything a nurse can do, plus countersign entries, correct errors and authorise bed transfers.',
  lab_tech: 'Accept lab orders and enter results.',
  pharmacist: 'Dispense medicines, manage stock, batches and purchase invoices.',
};

/**
 * Roles that can actually be assigned to a real account. 'staff' is a
 * renderer-only pseudo-role for the default unauthenticated session — the
 * backend's Role type has no such value — so it must not be offered when
 * creating a user, even though ROLE_LABELS still renders it for display.
 */
type CreatableRole = Exclude<Role, 'staff'>;
const CREATABLE_ROLES = (Object.keys(ROLE_LABELS) as Role[])
  .filter((r): r is CreatableRole => r !== 'staff');

/** Colour per role for the badge — helps scan the user list at a glance. */
const ROLE_COLOR: Record<Role, string> = {
  admin: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  manager: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  staff: 'bg-gray-100 text-gray-600',
  receptionist: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  doctor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  nurse: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  ward_incharge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  lab_tech: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  pharmacist: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
};

/** What each role can open — shown in the access reference so admins assign correctly. */
const ROLE_ACCESS: { role: CreatableRole; screens: string }[] = [
  { role: 'admin', screens: 'Everything — all modules, Settings, Users, Billing, Danger Zone.' },
  { role: 'manager', screens: 'Billing, Accounts, Analytics, TPA, Services, IPD (including the bill), Patient Log. No Settings or Users.' },
  { role: 'receptionist', screens: 'Reception, Appointments, Billing, Accounts, IPD admit, Patient Log, Analytics.' },
  { role: 'doctor', screens: 'Appointments, Doctor console, IPD ward care, Lab orders, Pediatrics.' },
  { role: 'nurse', screens: 'IPD ward care (vitals, medications, I/O, nursing notes), Pediatrics.' },
  { role: 'ward_incharge', screens: 'Everything a nurse sees, plus countersign and authorise transfers.' },
  { role: 'lab_tech', screens: 'Laboratory — accept orders, enter results.' },
  { role: 'pharmacist', screens: 'Pharmacy — dispense, stock, batches, purchase invoices.' },
];

export function UsersPage() {
  return (
    <AdminGate title="Users & Access — Administrator area">
      <UsersInner />
    </AdminGate>
  );
}

function UsersInner() {
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [pwUser, setPwUser] = useState<any | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [adminPwOpen, setAdminPwOpen] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => window.electronAPI.auth.listUsers(),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const loginsOn = settings?.require_login === true;

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => window.electronAPI.auth.updateUser(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast('Saved'); },
    // The backend refuses to strand a clinic without an admin — surface that verbatim.
    onError: (e: any) => toast(e?.message || 'Could not update this user', 'error'),
  });

  const turnOnLogins = useMutation({
    mutationFn: () => window.electronAPI.settings.save({ require_login: true } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Staff sign-in is ON — each person now signs in with their own account', 'success');
    },
    onError: (e: any) => toast(e?.message || 'Could not turn on sign-in', 'error'),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Users & Access</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Manage staff accounts, roles, audit trail, and destructive admin actions.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => setAdminPwOpen(true)}><KeyRound className="w-4 h-4" /> Admin Password</button>
          <button className="btn-secondary" onClick={() => setAuditOpen(true)}><Shield className="w-4 h-4" /> Audit Log</button>
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Add User</button>
        </div>
      </div>

      {/* Where accounts live, so a multi-PC clinic isn't surprised. */}
      {settings?.network_mode === 'client' && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 text-[12px] text-blue-900 dark:text-blue-200">
          Staff accounts come from the <b>main computer</b>, so you create each person once and they can
          sign in at any station. If the main computer is unreachable, an account created on
          <b> this</b> PC still works as an emergency sign-in so you can reach Settings and fix the connection.
        </div>
      )}

      {/* Roles do nothing until staff sign-in is switched on. Without this notice a
          clinic creates a pharmacist, marks them Active, and correctly observes
          that nothing changed — the single most confusing thing in the app. */}
      {settings && !loginsOn && (
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3 flex-wrap">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[260px]">
            <div className="text-[13px] font-bold text-amber-900 dark:text-amber-100">Staff sign-in is OFF — these accounts are not in use yet</div>
            <p className="text-[12px] text-amber-800 dark:text-amber-200 mt-0.5 leading-relaxed">
              Everyone on this computer currently shares one session and can reach everything.
              The roles below only take effect once each person signs in as themselves.
            </p>
          </div>
          <button className="btn-primary text-xs shrink-0" disabled={turnOnLogins.isPending}
            onClick={() => {
              if (!window.confirm('Turn on staff sign-in?\n\nEveryone will need their own username and password from now on. Make sure you know the admin password before continuing.')) return;
              turnOnLogins.mutate();
            }}>
            {turnOnLogins.isPending ? 'Turning on…' : 'Turn on staff sign-in'}
          </button>
        </div>
      )}

      <section className="card p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2">Username</th>
              <th className="py-2">Display Name</th>
              <th className="py-2">Role</th>
              <th className="py-2">Last Login</th>
              <th className="py-2">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs">
                  {u.username}
                  {u.must_change_password ? <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700" title="Will be asked to set a new password at next login">reset pending</span> : null}
                </td>
                <td className="py-2 text-gray-700 dark:text-slate-200">{u.display_name || '—'}</td>
                <td className="py-2">
                  <select
                    className={cn('rounded-md text-xs font-semibold px-2 py-1 border-0 cursor-pointer', ROLE_COLOR[u.role as Role] || 'bg-gray-100 text-gray-600')}
                    value={CREATABLE_ROLES.includes(u.role) ? u.role : 'receptionist'}
                    onChange={(e) => updateMut.mutate({ id: u.id, patch: { role: e.target.value } })}
                    title="Change role"
                  >
                    {CREATABLE_ROLES.map((v) => <option key={v} value={v}>{ROLE_LABELS[v]}</option>)}
                  </select>
                </td>
                <td className="py-2 text-[11px] text-gray-500 dark:text-slate-400">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}</td>
                <td className="py-2">
                  <button
                    onClick={() => {
                      if (u.is_active && !window.confirm(`Deactivate ${u.username}?\n\nThey will not be able to sign in until you switch this back on.`)) return;
                      updateMut.mutate({ id: u.id, patch: { is_active: u.is_active ? 0 : 1 } });
                    }}
                    className={u.is_active ? 'badge bg-green-100 text-green-700' : 'badge bg-gray-200 text-gray-600'}
                    title={u.is_active ? 'This person may sign in — click to block sign-in' : 'Blocked from signing in — click to allow'}
                  >
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setEditUser(u)}>Edit</button>
                  <button className="btn-ghost text-xs" onClick={() => setPwUser(u)}>
                    <Key className="w-3.5 h-3.5" /> Password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Role access reference — what each role can open */}
      <section className="card p-5">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">What each role can access</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
          Roles control which screens a user sees. Assign the closest fit; an admin can always do everything.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ROLE_ACCESS.map((r) => (
            <div key={r.role} className="flex items-start gap-2 rounded-lg border border-gray-200 dark:border-slate-700 p-2.5">
              <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded', ROLE_COLOR[r.role])}>{ROLE_LABELS[r.role]}</span>
              <span className="text-[11px] text-gray-600 dark:text-slate-400">{r.screens}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="card p-5" style={{ borderColor: '#fca5a5' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-red-700 dark:text-red-300">Danger Zone</h2>
          </div>
          <button className="btn-danger" onClick={() => setDangerOpen(true)}>Open Danger Zone</button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-slate-400">
          Irreversible actions — reset audit log, reset notification log, delete patient and their history. Each requires typing <code className="font-mono bg-gray-100 dark:bg-slate-700 px-1 rounded">iknowwhatiamdoing</code> to confirm.
        </p>
      </section>

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['users'] }); setCreating(false); toast('User created'); }} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null); toast('User updated'); }} />}
      {pwUser && <PasswordModal user={pwUser} onClose={() => setPwUser(null)} />}
      {auditOpen && <AuditModal onClose={() => setAuditOpen(false)} />}
      {adminPwOpen && <AdminPasswordModal onClose={() => setAdminPwOpen(false)} />}
      {dangerOpen && <DangerZoneModal onClose={() => setDangerOpen(false)} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreatableRole>('receptionist');
  const [displayName, setDisplayName] = useState('');
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => window.electronAPI.auth.createUser({
      username, password, role, display_name: displayName || undefined,
      doctor_id: role === 'doctor' && doctorId !== '' ? Number(doctorId) : undefined,
    }),
    onSuccess: onCreated,
    // Usernames are UNIQUE and stored lowercase. Without this, a duplicate made
    // the Create button look simply dead.
    onError: (e: any) => {
      const msg = String(e?.message || '');
      setErr(/UNIQUE|constraint/i.test(msg)
        ? `The username "${username.trim().toLowerCase()}" is already taken — pick another.`
        : (msg || 'Could not create this user.'));
    },
  });

  return (
    <Modal open onClose={onClose} title="Add User" size="md">
      <div className="space-y-3">
        <Row label="Username *"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Row>
        <Row label="Temporary Password *"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Row>
        <Row label="Display Name"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Row>
        <Row label="Role *">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as CreatableRole)}>
            {CREATABLE_ROLES.map((v) => <option key={v} value={v}>{ROLE_LABELS[v]}</option>)}
          </select>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">{ROLE_HELP[role]}</div>
        </Row>
        {role === 'doctor' && (
          <Row label="Link to Doctor">
            <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Row>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {err && <div className="text-[12px] text-red-600 dark:text-red-400 flex-1 self-center">{err}</div>}
          <button className="btn-primary" onClick={() => { setErr(null); create.mutate(); }} disabled={!username || !password || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Edit an existing user: display name, doctor link, role, and force-reset. */
function EditUserModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [role, setRole] = useState<CreatableRole>(CREATABLE_ROLES.includes(user.role) ? user.role : 'receptionist');
  const [doctorId, setDoctorId] = useState<number | ''>(user.doctor_id ?? '');
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });

  const save = useMutation({
    mutationFn: () => window.electronAPI.auth.updateUser(user.id, {
      display_name: displayName || null,
      role,
      doctor_id: role === 'doctor' ? (doctorId === '' ? null : Number(doctorId)) : null,
    }),
    onSuccess: onSaved,
    onError: (e: any) => toast(e?.message || 'Could not update', 'error'),
  });

  const forceReset = useMutation({
    mutationFn: () => window.electronAPI.auth.updateUser(user.id, { must_change_password: 1 } as any),
    onSuccess: () => { toast(`${user.username} will be asked to set a new password at next login`, 'success'); onSaved(); },
    onError: (e: any) => toast(e?.message || 'Could not update', 'error'),
  });

  return (
    <Modal open onClose={onClose} title={`Edit — ${user.username}`} size="md">
      <div className="space-y-3">
        <Row label="Display Name"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Dr. Sunil / Reception 1" /></Row>
        <Row label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as CreatableRole)}>
            {CREATABLE_ROLES.map((v) => <option key={v} value={v}>{ROLE_LABELS[v]}</option>)}
          </select>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">{ROLE_HELP[role]}</div>
        </Row>
        {role === 'doctor' && (
          <Row label="Link to Doctor">
            <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="text-[11px] text-gray-500 mt-1">Links this login to a doctor record so their appointments and consultations are attributed correctly.</div>
          </Row>
        )}
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-3">
          <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">Force password reset</div>
          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 mb-2">The user keeps their current password but must set a new one the next time they log in.</div>
          <button className="btn-secondary text-xs" disabled={forceReset.isPending} onClick={() => forceReset.mutate()}>
            {forceReset.isPending ? 'Applying…' : 'Require reset at next login'}
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: any; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const toast = useToast();
  const change = useMutation({
    mutationFn: () => window.electronAPI.auth.changePassword(user.id, pw),
    onSuccess: () => { toast('Password updated'); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={`Change Password · ${user.username}`}>
      <div className="space-y-3">
        <Row label="New Password"><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></Row>
        <Row label="Confirm"><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Row>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => { if (pw && pw === pw2) change.mutate(); else toast('Passwords must match', 'error'); }} disabled={change.isPending}>
            {change.isPending ? 'Updating…' : 'Update'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AdminPasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: () => window.electronAPI.admin.changePassword(current, next),
    onSuccess: (r) => {
      if (r.ok) {
        toast('Admin password updated — the default 1234 will no longer work.');
        // Refresh the gate's "is default password?" cache so the next unlock
        // screen drops the "default is 1234" hint immediately.
        qc.invalidateQueries({ queryKey: ['is-default-admin-password'] });
        onClose();
      } else {
        toast(r.error || 'Failed', 'error');
      }
    },
  });
  return (
    <Modal open onClose={onClose} title="Change Admin Password">
      <div className="space-y-3">
        <div className="text-[11px] p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
          This password unlocks Settings, Users & Access, and all destructive admin actions clinic-wide.
        </div>
        <Row label="Current Password"><input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} /></Row>
        <Row label="New Password (min 4 chars)"><input type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} /></Row>
        <Row label="Confirm New Password"><input type="password" className="input" value={next2} onChange={(e) => setNext2(e.target.value)} /></Row>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={change.isPending || !current || !next || next !== next2}
            onClick={() => change.mutate()}
          >
            {change.isPending ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AuditModal({ onClose }: { onClose: () => void }) {
  const { data: entries = [] } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => window.electronAPI.audit.list(500),
  });
  return (
    <Modal open onClose={onClose} title="Audit Log (last 500)" size="xl">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="py-2">Time</th>
            <th className="py-2">User</th>
            <th className="py-2">Role</th>
            <th className="py-2">Action</th>
            <th className="py-2">Entity</th>
            <th className="py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e: any) => (
            <tr key={e.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-1.5 text-gray-500 dark:text-slate-400">{fmtDateTime(e.at)}</td>
              <td className="py-1.5 font-mono">{e.username || '—'}</td>
              <td className="py-1.5">{e.role || '—'}</td>
              <td className="py-1.5 font-medium text-gray-900 dark:text-slate-100">{e.action}</td>
              <td className="py-1.5">{e.entity || '—'}{e.entity_id ? ` #${e.entity_id}` : ''}</td>
              <td className="py-1.5 text-gray-600 dark:text-slate-300 max-w-md truncate">{e.details || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function DangerZoneModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  return (
    <Modal open onClose={onClose} title="⚠ Danger Zone" size="xl">
      <div className="space-y-5">
        <ConfirmBlock
          title="Reset entire audit log"
          desc="Permanently deletes every audit entry (logins, mutations, etc.). Fresh log starts from this action."
          requireAdminPass
          action={async (phrase, adminPass) => {
            const r = await window.electronAPI.admin.resetAuditLog(phrase, adminPass ?? '');
            if (r.ok) { toast(`Deleted ${r.deleted} audit entries`); qc.invalidateQueries({ queryKey: ['audit-log'] }); return true; }
            toast(r.error || 'Failed', 'error'); return false;
          }}
        />
        <ConfirmBlock
          title="Reset notification log"
          desc="Permanently deletes every notification entry (SMS, WhatsApp logs). Does not affect future messages."
          action={async (phrase) => {
            const r = await window.electronAPI.admin.resetNotificationLog(phrase);
            if (r.ok) { toast(`Deleted ${r.deleted} notification entries`); qc.invalidateQueries({ queryKey: ['notifications'] }); return true; }
            toast(r.error || 'Failed', 'error'); return false;
          }}
        />
        <DeletePatientBlock />
      </div>
    </Modal>
  );
}

function ConfirmBlock({
  title, desc, action, requireAdminPass = false,
}: {
  title: string;
  desc: string;
  action: (phrase: string, adminPass?: string) => Promise<boolean>;
  requireAdminPass?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setOpen(false); setPhrase(''); setAdminPass(''); };
  const canConfirm = phrase === 'iknowwhatiamdoing' && (!requireAdminPass || adminPass.length > 0);

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border-red-800 p-4 bg-red-50/50 dark:bg-red-900/20">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">{title}</div>
          <div className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">{desc}</div>
        </div>
        {!open ? (
          <button className="btn-danger text-xs" onClick={() => setOpen(true)}>Proceed</button>
        ) : (
          <button className="btn-ghost text-xs" onClick={reset}>Cancel</button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {requireAdminPass && (
            <input
              className="input w-full"
              type="password"
              placeholder="Admin password"
              value={adminPass}
              onChange={(e) => setAdminPass(e.target.value)}
            />
          )}
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 font-mono"
              placeholder="Type iknowwhatiamdoing to confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
            <button
              className="btn-danger"
              disabled={busy || !canConfirm}
              onClick={async () => {
                setBusy(true);
                const ok = await action(phrase, requireAdminPass ? adminPass : undefined);
                setBusy(false);
                if (ok) reset();
              }}
            >
              {busy ? 'Deleting…' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: race an IPC promise with a timeout so the UI never hangs forever.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s — main process may be stale. Close the app and run npm start again.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function DeletePatientBlock() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [confirming, setConfirming] = useState<any | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: results = [] } = useQuery({
    queryKey: ['patients-delete-search', q],
    queryFn: () => window.electronAPI.patients.search(q),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['patients'] });
    qc.invalidateQueries({ queryKey: ['patients-delete-search'] });
    qc.invalidateQueries({ queryKey: ['patient-log'] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allChecked = results.length > 0 && results.every((p: any) => selected.has(p.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(results.map((p: any) => p.id)));
  };

  const doDelete = async (p: any) => {
    setBusy(true);
    try {
      const r = await withTimeout(window.electronAPI.admin.deletePatient(p.id), 15_000, 'Delete patient');
      if (r.ok) {
        toast(`Deleted patient ${r.patient.uhid}`);
        refreshAll();
        setConfirming(null);
      } else if (r.error === 'Confirmation phrase required') {
        toast('Old main process — close the app and run npm start to load the new delete handler.', 'error');
      } else {
        toast(r.error || 'Failed', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doBulkDelete = async () => {
    setBusy(true);
    try {
      const ids = Array.from(selected);
      const r = await withTimeout(window.electronAPI.admin.deletePatients(ids), 30_000, 'Bulk delete');
      if (r.ok) {
        toast(`Deleted ${r.deleted} patient${r.deleted === 1 ? '' : 's'}`);
        refreshAll();
        setBulkConfirm(false);
        setSelected(new Set());
      } else {
        toast(r.error || 'Bulk delete failed', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border-red-800 p-4 bg-red-50/50 dark:bg-red-900/20">
      <div className="text-sm font-semibold text-red-800 dark:text-red-200 flex items-center gap-2">
        <Trash2 className="w-4 h-4" /> Delete patients (and all their history)
      </div>
      <div className="text-[11px] text-red-700 dark:text-red-300 mt-0.5 mb-3">
        Cascades: appointments, consultations, Rx, lab orders, EMR. Bills are orphaned but kept for audit. Tick rows to select multiple, or click the row's Delete for one.
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" placeholder="Search patient by name / UHID / phone (blank = show all)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {selected.size > 0 && (
          <button
            className="btn-danger"
            onClick={() => setBulkConfirm(true)}
            disabled={busy}
          >
            <Trash2 className="w-4 h-4" /> Delete {selected.size} selected
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-slate-400 mb-1">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span>{allChecked ? 'Unselect all' : 'Select all visible'}</span>
        </label>
        <span>{results.length} patient{results.length === 1 ? '' : 's'}{q ? ' matching' : ' total (showing most recent 50)'} · {selected.size} selected</span>
      </div>

      <ul className="max-h-[420px] overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
        {results.map((p: any) => {
          const checked = selected.has(p.id);
          return (
            <li key={p.id} className={`px-3 py-2 flex items-center justify-between gap-2 ${checked ? 'bg-red-100 dark:bg-red-900/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700'}`}>
              <label className="flex items-center gap-3 min-w-0 cursor-pointer flex-1">
                <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} />
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-slate-100">{p.first_name} {p.last_name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{p.uhid} · {p.phone}</div>
                </div>
              </label>
              <button className="btn-danger text-xs" onClick={() => setConfirming(p)} disabled={busy}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="px-3 py-6 text-xs text-gray-400 text-center">No patients</li>}
      </ul>

      {confirming && (
        <Modal open onClose={() => setConfirming(null)} title="Delete patient?">
          <div className="space-y-3">
            <div className="text-sm text-gray-900 dark:text-slate-100">
              Permanently delete <span className="font-bold">{confirming.first_name} {confirming.last_name}</span> ({confirming.uhid}) and all their linked history?
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirming)} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete permanently'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bulkConfirm && (
        <Modal open onClose={() => setBulkConfirm(false)} title={`Delete ${selected.size} patients?`}>
          <div className="space-y-3">
            <div className="text-sm text-gray-900 dark:text-slate-100">
              Permanently delete <span className="font-bold">{selected.size} patient{selected.size === 1 ? '' : 's'}</span> and all their linked history?
            </div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">
              This is a single transaction — all-or-nothing. Cannot be undone.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setBulkConfirm(false)} disabled={busy}>Cancel</button>
              <button className="btn-danger" onClick={doBulkDelete} disabled={busy}>
                {busy ? 'Deleting…' : `Yes, delete all ${selected.size}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
