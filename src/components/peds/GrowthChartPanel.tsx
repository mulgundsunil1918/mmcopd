import { useState, useEffect } from 'react';
import { Printer, Send } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';
import type { GrowthChart, Sex } from '../../lib/peds/growth';
import { GrowthChart as GrowthChartPlot } from './GrowthChart';
import { IapGrowthChart } from './IapGrowthChart';
import { GrowthChartPrint } from './GrowthChartPrint';
import { iapMetricForWhoChart } from '../../lib/peds/iap';

/**
 * The growth-chart viewer: a WHO/IAP standard toggle and a chart selector that
 * defaults to "All charts" — every chart for the chosen standard on one sheet
 * (weight, height, head-circ, BMI for WHO; weight, height, BMI for IAP) — or a
 * single chart. Print on letterhead or push to reception's Print Jobs.
 *
 * Extracted so both the Pediatrics page (full history) and the in-consultation
 * growth field (a single measurement) render the exact same chart. `history` is
 * a list of measurement rows: { age_days, weight_kg, height_cm, head_circ_cm, bmi }.
 */
const CHART_SHORT: Record<GrowthChart, string> = {
  wfa: 'Weight-for-age', lhfa: 'Height-for-age', hcfa: 'Head circ.', bfa: 'BMI-for-age',
};

type ChartSel = GrowthChart | 'all';

export function GrowthChartPanel({ history, sex, patient, initialStandard = 'who' }: {
  history: any[];
  sex: Sex;
  patient?: any;
  /** Which reference to open on — the caller picks this from the child's age. */
  initialStandard?: 'who' | 'iap';
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [standard, setStandard] = useState<'who' | 'iap'>(initialStandard);
  const [chart, setChart] = useState<ChartSel>('all');
  const [printing, setPrinting] = useState(false);

  // If the caller's age-based default changes (e.g. patient switched), follow it.
  useEffect(() => { setStandard(initialStandard); }, [initialStandard]);

  // Head circumference exists only on WHO; IAP shows weight / height / BMI.
  const chartsForStd: GrowthChart[] = standard === 'who' ? ['wfa', 'lhfa', 'hcfa', 'bfa'] : ['wfa', 'lhfa', 'bfa'];
  const isAll = chart === 'all';
  const activeChart: GrowthChart = (!isAll && chartsForStd.includes(chart)) ? chart : 'wfa';

  const field: Record<GrowthChart, string> = { wfa: 'weight_kg', lhfa: 'height_cm', hcfa: 'head_circ_cm', bfa: 'bmi' };
  const pointsFor = (c: GrowthChart) => history
    .filter((m) => m.age_days != null && m[field[c]] != null)
    .map((m) => ({ ageDays: m.age_days, value: Number(m[field[c]]) }));

  const renderChart = (c: GrowthChart) => {
    const pts = pointsFor(c);
    const im = iapMetricForWhoChart(c);
    if (pts.length === 0) return <div key={c} className="card p-4 text-center text-[12px] text-gray-400">No {CHART_SHORT[c]} measurements yet.</div>;
    return (standard === 'iap' && im)
      ? <IapGrowthChart key={c} metric={im} sex={sex} points={pts} />
      : <GrowthChartPlot key={c} chart={c} sex={sex} points={pts} />;
  };

  // The chart body: every chart for this standard on one sheet, or a single one.
  const chartEl = isAll
    ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{chartsForStd.map(renderChart)}</div>
    : renderChart(activeChart);

  const anyPoints = chartsForStd.some((c) => pointsFor(c).length > 0);

  // Single-chart note: does the child's dot fall inside this chart's age window?
  const singlePts = pointsFor(activeChart);
  const inWindow = singlePts.filter((p) => standard === 'who'
    ? p.ageDays <= 5 * 365.25 + 30
    : p.ageDays >= 5 * 365.25 - 30 && p.ageDays <= 18 * 365.25 + 30);
  const outOfRange = !isAll && singlePts.length > 0 && inWindow.length === 0;

  const subtitle = isAll
    ? `All charts · ${sex === 'M' ? 'Boys' : 'Girls'} · ${standard === 'who' ? 'WHO 0–5y' : 'IAP 2015 · 5–18y'}`
    : `${CHART_SHORT[activeChart]} · ${sex === 'M' ? 'Boys' : 'Girls'} · ${standard === 'who' ? 'WHO 0–5y' : 'IAP 2015 · 5–18y'}`;

  const patientName = patient ? `${patient.first_name ?? patient.name ?? ''} ${patient.last_name ?? ''}`.trim() : '';

  const sendToReception = async () => {
    const r = await window.electronAPI.printJobs.create({
      kind: 'growth',
      title: `Growth chart — ${subtitle}`,
      patient_id: patient?.id ?? null,
      patient_name: patientName,
      created_by: user?.username,
      payload: {
        patient: { name: patientName, uhid: patient?.uhid, dob: patient?.dob, gender: patient?.gender },
        subtitle, standard,
        ...(isAll
          ? { mode: 'all', charts: chartsForStd.map((c) => ({ chart: c, iapMetric: iapMetricForWhoChart(c), points: pointsFor(c) })) }
          : { chart: activeChart, iapMetric: iapMetricForWhoChart(activeChart), points: pointsFor(activeChart) }),
      },
    });
    if (r.ok) toast('Sent to reception to print', 'success');
    else toast(r.error || 'Could not send', 'error');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Standard: WHO vs IAP */}
        <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 w-fit">
          <button onClick={() => setStandard('who')}
            className={cn('px-2.5 py-1 rounded-md text-[11px] font-bold transition',
              standard === 'who' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
            WHO · 0–5y
          </button>
          <button onClick={() => setStandard('iap')}
            className={cn('px-2.5 py-1 rounded-md text-[11px] font-bold transition',
              standard === 'iap' ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
            IAP · 5–18y
          </button>
        </div>
        {/* Chart type — "All charts" first, then each single chart */}
        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 w-fit">
          <button onClick={() => setChart('all')}
            className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
              isAll ? 'bg-white dark:bg-slate-900 text-pink-700 dark:text-pink-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
            All charts
          </button>
          {chartsForStd.map((c) => (
            <button key={c} onClick={() => setChart(c)}
              className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold transition',
                !isAll && activeChart === c ? 'bg-white dark:bg-slate-900 text-pink-700 dark:text-pink-300 shadow-sm' : 'text-gray-600 dark:text-slate-400')}>
              {CHART_SHORT[c]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {anyPoints && (
          <>
            <button onClick={sendToReception} className="btn-secondary text-xs"><Send className="w-3.5 h-3.5" /> Send to reception</button>
            <button onClick={() => setPrinting(true)} className="btn-secondary text-xs"><Printer className="w-3.5 h-3.5" /> Print chart</button>
          </>
        )}
      </div>

      {chartEl}

      {outOfRange && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2.5 py-1.5">
          This patient’s measurements fall outside this chart’s age range, so the “this child” dot isn’t plotted.
          {standard === 'who' ? ' Try the IAP · 5–18y chart for older children.' : ' Try the WHO · 0–5y chart for younger children.'}
        </div>
      )}

      <div className="text-[10px] text-gray-400 px-1">
        {standard === 'who'
          ? 'WHO Child Growth Standards — best for 0–5 years. Points beyond 5y sit off the top of these charts.'
          : 'IAP 2015 reference — for 5–18 years. Younger points fall before the chart start; use WHO for under-5s.'}
      </div>

      {printing && (
        <GrowthChartPrint
          patient={{ name: patientName, uhid: patient?.uhid, dob: patient?.dob, gender: patient?.gender }}
          subtitle={subtitle}
          onClose={() => setPrinting(false)}
        >
          {chartEl}
        </GrowthChartPrint>
      )}
    </div>
  );
}
