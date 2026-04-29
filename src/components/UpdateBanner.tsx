import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Sparkles, RefreshCw, X } from 'lucide-react';
import { useToast } from '../hooks/useToast';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdateBanner() {
  const toast = useToast();
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<{ version?: string; releaseNotes?: string; error?: string }>({});
  const [dismissed, setDismissed] = useState(false);

  const { data: initial } = useQuery({
    queryKey: ['updates-state'],
    queryFn: () => window.electronAPI.updates.state(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (initial) {
      setState(initial.state as UpdateState);
      setInfo({ version: initial.version, releaseNotes: initial.releaseNotes, error: initial.error });
    }
  }, [initial]);

  useEffect(() => {
    const off1 = window.electronAPI.updates.onState((s) => {
      setState(s.state as UpdateState);
      setInfo({ version: s.version, releaseNotes: s.releaseNotes, error: s.error });
      if (s.state === 'downloaded') setDismissed(false);
    });
    const off2 = window.electronAPI.updates.onPromptInstall(() => setDismissed(false));
    return () => { off1?.(); off2?.(); };
  }, []);

  const installMut = useMutation({
    mutationFn: () => window.electronAPI.updates.installNow(),
    onSuccess: () => toast('Restarting to install update…', 'info'),
  });

  if (state !== 'downloaded' || dismissed) return null;

  return (
    <div className="no-print fixed bottom-6 right-6 z-40 max-w-sm rounded-xl shadow-2xl border-2 border-emerald-400 bg-white dark:bg-slate-800">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}>
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
              Update ready{info.version ? ` — v${info.version}` : ''}
            </div>
            <div className="text-[11px] text-gray-600 dark:text-slate-300 mt-0.5">
              A new version of CureDesk HMS is downloaded and ready to install. Restart now to apply. Your data is safe.
            </div>
            {info.releaseNotes && (
              <details className="mt-2">
                <summary className="text-[10px] text-blue-600 dark:text-blue-400 cursor-pointer">What's new</summary>
                <pre className="text-[10px] text-gray-600 dark:text-slate-400 mt-1 whitespace-pre-wrap max-h-32 overflow-auto">{info.releaseNotes}</pre>
              </details>
            )}
            <div className="flex gap-2 mt-3">
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                onClick={() => installMut.mutate()}
                disabled={installMut.isPending}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Restart & install
              </button>
              <button className="text-xs text-gray-600 dark:text-slate-300 hover:underline" onClick={() => setDismissed(true)}>
                Later
              </button>
            </div>
          </div>
          <button onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
