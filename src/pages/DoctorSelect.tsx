import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowRight } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';

export function DoctorSelect() {
  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => window.electronAPI.doctors.list(true),
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">Doctors</h1>
        <p className="text-xs text-gray-500">Click a doctor to open their dashboard.</p>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500">Loading…</div>
      ) : doctors.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No doctors yet" description="Add doctors from the Settings page." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {doctors.map((d) => (
            <Link
              key={d.id}
              to={`/doctor/${d.id}`}
              className="card p-5 hover:border-blue-400 hover:shadow-md transition group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Stethoscope className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{d.name}</div>
                  <div className="text-xs text-gray-500">{d.specialty}</div>
                  {d.room_number && <div className="text-[11px] text-gray-400 mt-1">Room {d.room_number}</div>}
                </div>
                <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
