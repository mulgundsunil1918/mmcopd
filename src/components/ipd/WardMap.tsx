import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * Colour-coded bed map — the screen the ward station lives on.
 *
 * Bed colour is by STATUS so the ward reads at a glance:
 *   free      → green
 *   occupied  → the ward's own colour (from Settings)
 *   reserved  → blue
 *   cleaning  → amber
 *   blocked   → grey
 */
const STATUS_UI: Record<string, { label: string; ring: string; chip: string }> = {
  free:     { label: 'Free',     ring: 'border-emerald-300 dark:border-emerald-800', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  occupied: { label: 'Occupied', ring: 'border-slate-300 dark:border-slate-600',      chip: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
  reserved: { label: 'Reserved', ring: 'border-blue-300 dark:border-blue-800',         chip: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  cleaning: { label: 'Cleaning', ring: 'border-amber-300 dark:border-amber-800',        chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  blocked:  { label: 'Blocked',  ring: 'border-gray-300 dark:border-slate-700',         chip: 'bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-400' },
};

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(1, Math.floor((Date.now() - then) / 86_400_000) + 1);
}

export function WardMap({
  onAdmit, onOpenAdmission,
}: {
  onAdmit: (bed: any) => void;
  onOpenAdmission: (admissionId: number) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busyBed, setBusyBed] = useState<number | null>(null);

  const { data: beds = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['beds-map'],
    queryFn: () => window.electronAPI.beds.map(),
    refetchInterval: 20_000, // ward changes happen on other stations
  });

  // Group beds by ward, preserving the server's sort order.
  const wards = useMemo(() => {
    const byWard = new Map<number, { name: string; colour: string; type: string; beds: any[] }>();
    for (const b of beds) {
      if (!byWard.has(b.ward_id)) byWard.set(b.ward_id, { name: b.ward_name, colour: b.ward_colour, type: b.ward_type, beds: [] });
      byWard.get(b.ward_id)!.beds.push(b);
    }
    return [...byWard.values()];
  }, [beds]);

  const counts = useMemo(() => {
    const total = beds.length;
    const occupied = beds.filter((b: any) => b.status === 'occupied').length;
    const free = beds.filter((b: any) => b.status === 'free').length;
    return { total, occupied, free, pct: total ? Math.round((occupied / total) * 100) : 0 };
  }, [beds]);

  const setStatus = async (bedId: number, status: string) => {
    setBusyBed(bedId);
    try {
      const r = await window.electronAPI.beds.setStatus(bedId, status);
      if (!r.ok) alert(r.error);  // surfaced verbatim from backend
      await refetch();
    } finally { setBusyBed(null); }
  };

  if (isLoading) {
    return <div className="card p-8 text-center text-sm text-gray-500">Loading ward map…</div>;
  }

  if (beds.length === 0) {
    return (
      <div className="card p-8 text-center">
        <BedDouble className="w-8 h-8 mx-auto text-gray-400 mb-3" />
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">No beds set up yet</div>
        <div className="text-[12px] text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          Add your wards and beds first, then patients can be admitted here.
        </div>
        <button className="btn-primary text-xs mt-4" onClick={() => navigate('/settings')}>
          <SettingsIcon className="w-3.5 h-3.5" /> Go to Settings → Billing &amp; IPD
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Occupancy summary */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-2xl font-extrabold text-gray-900 dark:text-slate-100 tabular-nums">{counts.pct}%</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Occupancy</div>
          </div>
          <div className="text-[12px] text-gray-600 dark:text-slate-400">
            <b>{counts.occupied}</b> occupied · <b className="text-emerald-600">{counts.free}</b> free · {counts.total} total beds
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="hidden md:flex items-center gap-2 text-[10px]">
            {Object.entries(STATUS_UI).map(([k, v]) => (
              <span key={k} className={cn('px-2 py-0.5 rounded-full', v.chip)}>{v.label}</span>
            ))}
          </div>
          <button className="btn-ghost text-xs" onClick={() => refetch()}>
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Wards */}
      {wards.map((ward) => (
        <div key={ward.name} className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 rounded-sm" style={{ background: ward.colour || '#94a3b8' }} />
            <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100">{ward.name}</div>
            <div className="text-[11px] text-gray-500">
              {ward.beds.filter((b) => b.status === 'occupied').length}/{ward.beds.length} occupied
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {ward.beds.map((b: any) => {
              const ui = STATUS_UI[b.status] || STATUS_UI.blocked;
              const occupied = b.status === 'occupied' && b.admission_id;
              return (
                <div key={b.id}
                  className={cn('rounded-lg border-2 p-2.5 min-h-[84px] flex flex-col transition', ui.ring,
                    occupied ? 'cursor-pointer hover:shadow-md' : '')}
                  style={occupied ? { background: (ward.colour || '#2563eb') + '12' } : undefined}
                  onClick={() => occupied && onOpenAdmission(b.admission_id)}>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-gray-900 dark:text-slate-100">{b.bed_number}</span>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full', ui.chip)}>{ui.label}</span>
                  </div>

                  {occupied ? (
                    <div className="mt-1 flex-1">
                      <div className="text-[11px] font-semibold text-gray-900 dark:text-slate-100 truncate">{b.patient_name}</div>
                      <div className="text-[9px] text-gray-500 truncate">{b.doctor_name || 'No doctor'}</div>
                      <div className="text-[9px] text-gray-500">Day {daysSince(b.admitted_at)}</div>
                    </div>
                  ) : (
                    <div className="mt-auto">
                      {b.status === 'free' && (
                        <button className="w-full text-[11px] font-semibold rounded-md py-1 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={(e) => { e.stopPropagation(); onAdmit(b); }}>
                          Admit
                        </button>
                      )}
                      {b.status === 'cleaning' && (
                        <button className="w-full text-[10px] rounded-md py-1 border border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                          disabled={busyBed === b.id}
                          onClick={(e) => { e.stopPropagation(); setStatus(b.id, 'free'); }}>
                          Mark clean
                        </button>
                      )}
                      {(b.status === 'reserved' || b.status === 'blocked') && (
                        <button className="w-full text-[10px] rounded-md py-1 border border-gray-400 text-gray-600 hover:bg-gray-50"
                          disabled={busyBed === b.id}
                          onClick={(e) => { e.stopPropagation(); setStatus(b.id, 'free'); }}>
                          Free up
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
