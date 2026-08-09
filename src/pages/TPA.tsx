import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldPlus, Plus, Building2, FileText, Loader2, X, Search } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { cn, fmtDate } from '../lib/utils';

/**
 * TPA / insurance (cashless) — insurer master and the claim lifecycle.
 * Gated on tpa_enabled; the sidebar hides it otherwise.
 */
type Tab = 'claims' | 'insurers';

const STATUS_FLOW = ['draft', 'preauth_sent', 'preauth_approved', 'submitted', 'queried', 'approved', 'settled', 'rejected', 'closed'];
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', preauth_sent: 'bg-blue-100 text-blue-700', preauth_approved: 'bg-indigo-100 text-indigo-700',
  submitted: 'bg-violet-100 text-violet-700', queried: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700',
  settled: 'bg-emerald-200 text-emerald-800', rejected: 'bg-red-100 text-red-700', closed: 'bg-gray-200 text-gray-600',
};
const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN');

export function TPA() {
  const [tab, setTab] = useState<Tab>('claims');
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <ShieldPlus className="w-5 h-5 text-teal-500" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Insurance / TPA</h1>
      </div>
      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 w-fit">
        <button onClick={() => setTab('claims')} className={cn('px-3 py-1.5 rounded-md text-[12px] font-semibold', tab === 'claims' ? 'bg-white dark:bg-slate-900 text-teal-700 shadow-sm' : 'text-gray-600')}><FileText className="w-3.5 h-3.5 inline mr-1" />Claims</button>
        <button onClick={() => setTab('insurers')} className={cn('px-3 py-1.5 rounded-md text-[12px] font-semibold', tab === 'insurers' ? 'bg-white dark:bg-slate-900 text-teal-700 shadow-sm' : 'text-gray-600')}><Building2 className="w-3.5 h-3.5 inline mr-1" />Insurers</button>
      </div>
      {tab === 'claims' ? <ClaimsTab /> : <InsurersTab />}
    </div>
  );
}

function InsurersTab() {
  const toast = useToast(); const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const { data: insurers = [] } = useQuery({ queryKey: ['tpa-insurers'], queryFn: () => window.electronAPI.billing.tpaInsurers(true) });

  const save = async () => {
    const r = await window.electronAPI.billing.tpaInsurerSave(editing);
    if (r.ok) { toast('Insurer saved', 'success'); setEditing(null); qc.invalidateQueries({ queryKey: ['tpa-insurers'] }); }
    else toast(r.error || 'Could not save', 'error');
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Insurers / TPAs</div>
        <button className="btn-primary text-xs" onClick={() => setEditing({ name: '' })}><Plus className="w-3.5 h-3.5" /> Add insurer</button>
      </div>
      {editing && (
        <div className="rounded-lg border-2 border-teal-300 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/20 p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input" placeholder="Insurer / TPA name *" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input className="input" placeholder="Code" value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
          <input className="input" placeholder="Contact person" value={editing.contact_person || ''} onChange={(e) => setEditing({ ...editing, contact_person: e.target.value })} />
          <input className="input" placeholder="Phone" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          <div className="md:col-span-2 flex gap-2">
            <button className="btn-primary text-xs" disabled={!editing.name?.trim()} onClick={save}>Save</button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {insurers.length === 0 && !editing ? <div className="text-[12px] text-gray-400 text-center py-4">No insurers yet.</div> :
        insurers.map((t: any) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-slate-700 p-2.5">
            <div><div className="text-[13px] font-semibold">{t.name}</div><div className="text-[11px] text-gray-500">{t.code || ''}{t.phone ? ` · ${t.phone}` : ''}</div></div>
            <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>Edit</button>
          </div>
        ))}
    </div>
  );
}

function ClaimsTab() {
  const toast = useToast(); const qc = useQueryClient(); const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data: claims = [] } = useQuery({ queryKey: ['tpa-claims'], queryFn: () => window.electronAPI.billing.tpaClaims() });

  const advance = async (c: any, status: string) => {
    let amount: number | undefined;
    if (status === 'approved' || status === 'settled') {
      const v = window.prompt(`${status === 'approved' ? 'Approved' : 'Settled'} amount (₹)?`, String(c.claimed_amount || ''));
      if (v === null) return; amount = Number(v) || 0;
    }
    const r = await window.electronAPI.billing.tpaClaimStatus(c.id, status, amount, undefined, user?.username);
    if (r.ok) { toast(`Claim → ${status}`, 'success'); qc.invalidateQueries({ queryKey: ['tpa-claims'] }); }
    else toast(r.error || 'Could not update', 'error');
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-primary text-xs" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> New claim</button></div>
      {creating && <ClaimForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['tpa-claims'] }); }} />}
      {claims.length === 0 ? <div className="card p-6 text-center text-[12px] text-gray-400">No claims yet.</div> :
        claims.map((c: any) => {
          const nextIdx = STATUS_FLOW.indexOf(c.status) + 1;
          const next = nextIdx < STATUS_FLOW.length ? STATUS_FLOW[nextIdx] : null;
          return (
            <div key={c.id} className="card p-3">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{c.patient_name} <span className="text-[11px] text-gray-500">{c.patient_uhid}</span></div>
                  <div className="text-[11px] text-gray-500">{c.insurer_name_master} · policy {c.policy_no || '—'}{c.admission_number ? ` · ${c.admission_number}` : ''}</div>
                  <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5">
                    Claimed {inr(c.claimed_amount)}{c.approved_amount ? ` · Approved ${inr(c.approved_amount)}` : ''}{c.settled_amount ? ` · Settled ${inr(c.settled_amount)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('px-2 py-0.5 rounded text-[10px] font-semibold', STATUS_CLS[c.status])}>{c.status.replace('_', ' ')}</span>
                  {next && next !== 'rejected' && next !== 'closed' && (
                    <button className="btn-ghost text-xs" onClick={() => advance(c, next)}>→ {next.replace('_', ' ')}</button>
                  )}
                  {c.status !== 'settled' && c.status !== 'rejected' && c.status !== 'closed' && (
                    <button className="btn-ghost text-xs text-red-600" onClick={() => advance(c, 'rejected')}>Reject</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}

function ClaimForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const [patient, setPatient] = useState<any | null>(null);
  const [tpaId, setTpaId] = useState<number | ''>(''); const [policy, setPolicy] = useState(''); const [claimed, setClaimed] = useState('');
  const { data: insurers = [] } = useQuery({ queryKey: ['tpa-insurers'], queryFn: () => window.electronAPI.billing.tpaInsurers() });
  const { data: results = [] } = useQuery({ queryKey: ['tpa-patient', q], queryFn: () => window.electronAPI.patients.search(q), enabled: q.trim().length >= 2 && !patient });

  const save = async () => {
    if (!patient || !tpaId) { toast('Pick a patient and an insurer', 'error'); return; }
    const r = await window.electronAPI.billing.tpaClaimSave({ patient_id: patient.id, tpa_id: Number(tpaId), policy_no: policy, claimed_amount: Number(claimed) || 0 });
    if (r.ok) { toast('Claim created', 'success'); onSaved(); }
    else toast(r.error || 'Could not create', 'error');
  };

  return (
    <div className="card p-4 border-2 border-teal-300 dark:border-teal-800 space-y-3">
      <div className="flex items-center justify-between"><div className="text-[13px] font-bold">New claim</div><button className="btn-ghost text-xs" onClick={onClose}><X className="w-3.5 h-3.5" /></button></div>
      {patient ? (
        <div className="flex items-center justify-between rounded border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/20 p-2">
          <span className="text-[13px] font-semibold">{patient.first_name} {patient.last_name} <span className="text-[11px] text-gray-500">{patient.uhid}</span></span>
          <button className="btn-ghost text-xs" onClick={() => setPatient(null)}>Change</button>
        </div>
      ) : (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
          <input className="input pl-9" placeholder="Find patient" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && results.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-slate-700">
              {results.map((p: any) => <button key={p.id} className="w-full text-left px-3 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-[12px] border-b last:border-0 border-gray-100 dark:border-slate-800" onClick={() => setPatient(p)}>{p.first_name} {p.last_name} · {p.uhid}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select className="input" value={tpaId} onChange={(e) => setTpaId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">— insurer —</option>
          {insurers.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input className="input" placeholder="Policy number" value={policy} onChange={(e) => setPolicy(e.target.value)} />
        <input className="input" type="number" placeholder="Claimed amount ₹" value={claimed} onChange={(e) => setClaimed(e.target.value)} />
      </div>
      <button className="btn-primary text-xs" onClick={save}>Create claim</button>
    </div>
  );
}
