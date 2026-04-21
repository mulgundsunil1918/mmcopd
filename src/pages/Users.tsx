import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Plus, Key, Shield } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDateTime } from '../lib/utils';
import type { Role } from '../hooks/useAuth';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  receptionist: 'Receptionist',
  doctor: 'Doctor',
  lab_tech: 'Lab Tech',
  pharmacist: 'Pharmacist',
};

export function UsersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [pwUser, setPwUser] = useState<any | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  if (user?.role !== 'admin') {
    return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Only administrators can manage users.</div>;
  }

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
          <p className="text-xs text-gray-500 dark:text-slate-400">Manage staff accounts, roles, and audit trail.</p>
        </div>
        <div className="flex gap-2">
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

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['users'] }); setCreating(false); toast('User created'); }} />}
      {pwUser && <PasswordModal user={pwUser} onClose={() => setPwUser(null)} />}
      {auditOpen && <AuditModal onClose={() => setAuditOpen(false)} />}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
