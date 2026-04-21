import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Heart, Users2, Syringe, FileUp, Trash2, ExternalLink, Plus } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { cn, fmtDate } from '../lib/utils';

type Section = 'allergies' | 'conditions' | 'family' | 'immunizations' | 'documents';

export function MedicalRecord({ patientId }: { patientId: number }) {
  const [section, setSection] = useState<Section>('allergies');

  const tabs: { key: Section; label: string; icon: any; color: string }[] = [
    { key: 'allergies', label: 'Allergies', icon: AlertTriangle, color: 'text-red-500' },
    { key: 'conditions', label: 'Chronic Conditions', icon: Heart, color: 'text-pink-500' },
    { key: 'family', label: 'Family History', icon: Users2, color: 'text-purple-500' },
    { key: 'immunizations', label: 'Immunizations', icon: Syringe, color: 'text-emerald-500' },
    { key: 'documents', label: 'Documents', icon: FileUp, color: 'text-blue-500' },
  ];

  return (
    <div className="card p-0 overflow-hidden">
      <div className="border-b border-gray-200 dark:border-slate-700 flex overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon, color }) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 whitespace-nowrap',
              section === key
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100'
            )}
          >
            <Icon className={cn('w-4 h-4', color)} /> {label}
          </button>
        ))}
      </div>
      <div className="p-5">
        {section === 'allergies' && <Allergies patientId={patientId} />}
        {section === 'conditions' && <Conditions patientId={patientId} />}
        {section === 'family' && <Family patientId={patientId} />}
        {section === 'immunizations' && <Immunizations patientId={patientId} />}
        {section === 'documents' && <Documents patientId={patientId} />}
      </div>
    </div>
  );
}

function Allergies({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: list = [] } = useQuery({ queryKey: ['emr-allergies', patientId], queryFn: () => window.electronAPI.emr.allergies(patientId) });
  const [allergen, setAllergen] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState('');

  const add = useMutation({
    mutationFn: () => window.electronAPI.emr.addAllergy({ patient_id: patientId, allergen, reaction, severity }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emr-allergies', patientId] }); setAllergen(''); setReaction(''); setSeverity(''); toast('Allergy added'); },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.emr.deleteAllergy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr-allergies', patientId] }),
  });

  return (
    <div>
      <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2 mb-4">
        <input className="input" placeholder="Allergen (e.g. Penicillin, Peanuts)" value={allergen} onChange={(e) => setAllergen(e.target.value)} />
        <input className="input" placeholder="Reaction (rash, anaphylaxis)" value={reaction} onChange={(e) => setReaction(e.target.value)} />
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Severity</option>
          <option>Mild</option><option>Moderate</option><option>Severe</option>
        </select>
        <button className="btn-primary" onClick={() => allergen && add.mutate()} disabled={!allergen || add.isPending}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {list.length === 0 ? <Empty text="No known allergies." /> : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {list.map((a: any) => (
            <li key={a.id} className="py-2 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{a.allergen} {a.severity && <span className="badge bg-red-100 text-red-700 ml-2">{a.severity}</span>}</div>
                {a.reaction && <div className="text-[11px] text-gray-500 dark:text-slate-400">Reaction: {a.reaction}</div>}
              </div>
              <DelBtn onClick={() => del.mutate(a.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Conditions({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ['emr-conditions', patientId], queryFn: () => window.electronAPI.emr.conditions(patientId) });
  const [condition, setCondition] = useState('');
  const [since, setSince] = useState('');
  const [notes, setNotes] = useState('');

  const add = useMutation({
    mutationFn: () => window.electronAPI.emr.addCondition({ patient_id: patientId, condition, since, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emr-conditions', patientId] }); setCondition(''); setSince(''); setNotes(''); },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.emr.deleteCondition(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr-conditions', patientId] }),
  });

  return (
    <div>
      <div className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 mb-4">
        <input className="input" placeholder="Condition (e.g. Hypertension, Diabetes)" value={condition} onChange={(e) => setCondition(e.target.value)} />
        <input className="input" placeholder="Since (2019)" value={since} onChange={(e) => setSince(e.target.value)} />
        <input className="input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn-primary" onClick={() => condition && add.mutate()} disabled={!condition}><Plus className="w-4 h-4" /> Add</button>
      </div>
      {list.length === 0 ? <Empty text="No chronic conditions recorded." /> : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {list.map((c: any) => (
            <li key={c.id} className="py-2 flex items-center justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{c.condition}{c.since && <span className="text-[11px] text-gray-500 dark:text-slate-400 ml-2">· since {c.since}</span>}</div>
                {c.notes && <div className="text-[11px] text-gray-600 dark:text-slate-300">{c.notes}</div>}
              </div>
              <DelBtn onClick={() => del.mutate(c.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Family({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ['emr-family', patientId], queryFn: () => window.electronAPI.emr.family(patientId) });
  const [relation, setRelation] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const add = useMutation({
    mutationFn: () => window.electronAPI.emr.addFamily({ patient_id: patientId, relation, condition, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emr-family', patientId] }); setRelation(''); setCondition(''); setNotes(''); },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.emr.deleteFamily(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr-family', patientId] }),
  });
  return (
    <div>
      <div className="grid grid-cols-[1fr_2fr_2fr_auto] gap-2 mb-4">
        <select className="input" value={relation} onChange={(e) => setRelation(e.target.value)}>
          <option value="">Relation</option>
          {['Father','Mother','Brother','Sister','Grandfather','Grandmother','Son','Daughter','Uncle','Aunt','Cousin','Spouse'].map((r) => <option key={r}>{r}</option>)}
        </select>
        <input className="input" placeholder="Condition (Diabetes, CAD)" value={condition} onChange={(e) => setCondition(e.target.value)} />
        <input className="input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn-primary" onClick={() => relation && condition && add.mutate()} disabled={!relation || !condition}><Plus className="w-4 h-4" /> Add</button>
      </div>
      {list.length === 0 ? <Empty text="No family history on record." /> : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {list.map((f: any) => (
            <li key={f.id} className="py-2 flex items-center justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm"><span className="font-medium">{f.relation}</span>: {f.condition}</div>
                {f.notes && <div className="text-[11px] text-gray-500 dark:text-slate-400">{f.notes}</div>}
              </div>
              <DelBtn onClick={() => del.mutate(f.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Immunizations({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ['emr-imm', patientId], queryFn: () => window.electronAPI.emr.immunizations(patientId) });
  const [vaccine, setVaccine] = useState('');
  const [givenAt, setGivenAt] = useState('');
  const [dose, setDose] = useState('');
  const add = useMutation({
    mutationFn: () => window.electronAPI.emr.addImmunization({ patient_id: patientId, vaccine, given_at: givenAt, dose }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emr-imm', patientId] }); setVaccine(''); setGivenAt(''); setDose(''); },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.emr.deleteImmunization(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr-imm', patientId] }),
  });
  return (
    <div>
      <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 mb-4">
        <input className="input" placeholder="Vaccine (e.g. Tetanus, COVID-19, MMR)" value={vaccine} onChange={(e) => setVaccine(e.target.value)} />
        <input type="date" className="input" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
        <input className="input" placeholder="Dose" value={dose} onChange={(e) => setDose(e.target.value)} />
        <button className="btn-primary" onClick={() => vaccine && add.mutate()} disabled={!vaccine}><Plus className="w-4 h-4" /> Add</button>
      </div>
      {list.length === 0 ? <Empty text="No immunization records." /> : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {list.map((v: any) => (
            <li key={v.id} className="py-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{v.vaccine} {v.dose && <span className="text-[11px] text-gray-500 dark:text-slate-400">· {v.dose}</span>}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{v.given_at ? fmtDate(v.given_at) : 'Date not set'}</div>
              </div>
              <DelBtn onClick={() => del.mutate(v.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Documents({ patientId }: { patientId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: list = [] } = useQuery({ queryKey: ['emr-docs', patientId], queryFn: () => window.electronAPI.emr.documents(patientId) });

  const add = useMutation({
    mutationFn: (args: { file_name: string; file_type: string; data_base64: string; note?: string }) =>
      window.electronAPI.emr.addDocument({ patient_id: patientId, ...args }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emr-docs', patientId] }); toast('Uploaded'); },
  });
  const del = useMutation({
    mutationFn: (id: number) => window.electronAPI.emr.deleteDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr-docs', patientId] }),
  });

  const onFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast('Max 10 MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      add.mutate({
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        data_base64: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button className="btn-primary" onClick={() => inputRef.current?.click()} disabled={add.isPending}>
          <FileUp className="w-4 h-4" /> {add.isPending ? 'Uploading…' : 'Upload Document'}
        </button>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">PDF, JPG, PNG — max 10 MB each. Stored locally in userData/documents/{patientId}/.</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
      </div>
      {list.length === 0 ? <Empty text="No documents uploaded yet." /> : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {list.map((d: any) => (
            <li key={d.id} className="py-2 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{d.file_name}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{fmtDate(d.uploaded_at)} · {Math.round(d.size_bytes / 1024)} KB · {d.file_type}</div>
              </div>
              <div className="flex gap-1">
                <button className="btn-ghost text-xs" onClick={() => window.electronAPI.emr.openDocument(d.id)}>
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </button>
                <DelBtn onClick={() => del.mutate(d.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-xs text-gray-500 dark:text-slate-400 py-6">{text}</div>;
}
function DelBtn({ onClick }: { onClick: () => void }) {
  return <button className="p-1 text-red-500 hover:text-red-700" onClick={onClick} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>;
}
