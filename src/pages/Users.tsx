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
  receptionist: 'Receptionist',
  doctor: 'Doctor',
  lab_tech: 'Lab Tech',
  pharmacist: 'Pharmacist',
};

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
  const [auditOpen, setAuditOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [adminPwOpen, setAdminPwOpen] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => window.electronAPI.auth.listUsers(),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => window.electronAPI.auth.updateUser(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast('Saved'); },
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
                <td className="py-2 font-mono text-xs">{u.username}</td>
                <td className="py-2 text-gray-700 dark:text-slate-200">{u.display_name || '—'}</td>
                <td className="py-2">
                  <select
                    className="input w-auto text-xs"
                    value={u.role}
                    onChange={(e) => updateMut.mutate({ id: u.id, patch: { role: e.target.value } })}
                  >
                    {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td className="py-2 text-[11px] text-gray-500 dark:text-slate-400">{u.last_login_at ? fmtDateTime(u.last_login_at) : '—'}</td>
                <td className="py-2">
                  <button
                    onClick={() => updateMut.mutate({ id: u.id, patch: { is_active: u.is_active ? 0 : 1 } })}
                    className={u.is_active ? 'badge bg-green-100 text-green-700' : 'badge bg-gray-200 text-gray-600'}
                  >
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="py-2 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setPwUser(u)}>
                    <Key className="w-3.5 h-3.5" /> Set Password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [role, setRole] = useState<Role>('receptionist');
  const [displayName, setDisplayName] = useState('');
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  const [doctorId, setDoctorId] = useState<number | ''>('');

  const create = useMutation({
    mutationFn: () => window.electronAPI.auth.createUser({
      username, password, role, display_name: displayName || undefined,
      doctor_id: role === 'doctor' && doctorId !== '' ? Number(doctorId) : undefined,
    }),
    onSuccess: onCreated,
  });

  return (
    <Modal open onClose={onClose} title="Add User" size="md">
      <div className="space-y-3">
        <Row label="Username *"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Row>
        <Row label="Temporary Password *"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Row>
        <Row label="Display Name"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Row>
        <Row label="Role *">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
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
          <button className="btn-primary" onClick={() => create.mutate()} disabled={!username || !password || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create User'}
          </button>
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
        toast('Admin password updated — the default 1918 will no longer work.');
        // Refresh the gate's "is default password?" cache so the next unlock
        // screen drops the "default is 1918" hint immediately.
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
          action={async (phrase) => {
            const r = await window.electronAPI.admin.resetAuditLog(phrase);
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

function ConfirmBlock({ title, desc, action }: { title: string; desc: string; action: (phrase: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);

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
          <button className="btn-ghost text-xs" onClick={() => { setOpen(false); setPhrase(''); }}>Cancel</button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex items-center gap-2">
          <input
            className="input flex-1 font-mono"
            placeholder="Type iknowwhatiamdoing to confirm"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />
          <button
            className="btn-danger"
            disabled={busy || phrase !== 'iknowwhatiamdoing'}
            onClick={async () => {
              setBusy(true);
              const ok = await action(phrase);
              setBusy(false);
              if (ok) { setOpen(false); setPhrase(''); }
            }}
          >
            {busy ? 'Deleting…' : 'Confirm Delete'}
          </button>
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
