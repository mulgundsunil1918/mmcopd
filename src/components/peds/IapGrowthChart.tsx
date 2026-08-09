import { useMemo } from 'react';
import { iapCurves, IAP_LABELS, IAP_UNIT, IAP_METRIC_LABEL, IAP_RANGE_Y, type IapMetric } from '../../lib/peds/iap';
import type { Sex } from '../../lib/peds/growth';

/**
 * IAP 2015 growth chart, 5–18 years. Pure SVG, same visual language as the WHO
 * chart but the reference lines are published percentiles (3rd…97th), and the
 * x-axis is age in years. For BMI the top two lines are the IAP overweight (≡23)
 * and obesity (≡27) cut-offs, drawn in amber/red.
 */
const YEAR_TO_DAYS = 365.25;

// Per-column styling, indexed to the metric's label array.
const HTWT_STYLE = [
  { colour: '#ef4444', dash: '4 3', w: 1 },   // 3rd
  { colour: '#f97316', dash: '3 2', w: 1 },   // 10th
  { colour: '#d4b800', dash: '3 2', w: 1 },   // 25th
  { colour: '#16a34a', dash: '', w: 2 },      // 50th (median, bold)
  { colour: '#2563eb', dash: '3 2', w: 1 },   // 75th
  { colour: '#8b5cf6', dash: '3 2', w: 1 },   // 90th
  { colour: '#334155', dash: '4 3', w: 1 },   // 97th
];
const BMI_STYLE = [
  { colour: '#2563eb', dash: '4 3', w: 1 },   // 3rd
  { colour: '#16a34a', dash: '3 2', w: 1 },   // 5th
  { colour: '#d4b800', dash: '3 2', w: 1 },   // 10th
  { colour: '#f97316', dash: '3 2', w: 1 },   // 25th
  { colour: '#334155', dash: '', w: 2 },      // 50th (bold)
  { colour: '#f59e0b', dash: '6 3', w: 2 },   // overweight ≡23
  { colour: '#ef4444', dash: '6 3', w: 2.4 }, // obesity ≡27
];

export function IapGrowthChart({ metric, sex, points }: {
  metric: IapMetric; sex: Sex;
  points: { ageDays: number; value: number }[];
}) {
  const W = 640, H = 380, padL = 44, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const { min: minY, max: maxY } = IAP_RANGE_Y;

  const curves = useMemo(() => iapCurves(metric, sex), [metric, sex]);
  const labels = IAP_LABELS[metric];
  const style = metric === 'bmi' ? BMI_STYLE : HTWT_STYLE;

  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const c of curves) for (const v of c.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const p of points) {
      const ay = p.ageDays / YEAR_TO_DAYS;
      if (ay >= minY && ay <= maxY) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.05 || 1;
    return { yMin: Math.max(0, lo - pad), yMax: hi + pad };
  }, [curves, points, minY, maxY]);

  const xOf = (ageY: number) => padL + ((ageY - minY) / (maxY - minY)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const linePaths = labels.map((_, li) => ({
    li,
    d: curves.map((c, i) => `${i === 0 ? 'M' : 'L'} ${xOf(c.ageY).toFixed(1)} ${yOf(c.values[li]).toFixed(1)}`).join(' '),
  }));

  const childPts = points
    .map((p) => ({ ageY: p.ageDays / YEAR_TO_DAYS, value: p.value }))
    .filter((p) => p.ageY >= minY && p.ageY <= maxY)
    .sort((a, b) => a.ageY - b.ageY);

  const yTicks = 6, xTicks = maxY - minY; // one tick per year

  return (
    <div className="card p-3 overflow-x-auto">
      <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 mb-1">
        {IAP_METRIC_LABEL[metric]} · {sex === 'M' ? 'Boys' : 'Girls'} · IAP 2015 · 5–18y
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 480 }} className="text-gray-400">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = yMin + (i / yTicks) * (yMax - yMin);
          const y = yOf(v);
          return (
            <g key={`y${i}`}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="currentColor" strokeOpacity={0.12} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor">{v.toFixed(v > 20 ? 0 : 1)}</text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const yr = minY + i;
          const x = xOf(yr);
          return (
            <g key={`x${i}`}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="currentColor" strokeOpacity={0.08} />
              <text x={x} y={H - padB + 14} textAnchor="middle" fontSize={9} fill="currentColor">{yr}</text>
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="currentColor">Age (years)</text>
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize={9} fill="currentColor" transform={`rotate(-90 12 ${padT + plotH / 2})`}>{IAP_UNIT[metric]}</text>

        {/* percentile lines */}
        {linePaths.map(({ li, d }) => (
          <path key={li} d={d} fill="none" stroke={style[li].colour} strokeWidth={style[li].w} strokeDasharray={style[li].dash} strokeOpacity={0.85} />
        ))}

        {/* child's measurements */}
        {childPts.length > 0 && (
          <>
            <path d={childPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.ageY).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ')}
              fill="none" stroke="#0f172a" strokeWidth={1.6} className="dark:stroke-white" />
            {childPts.map((p, i) => (
              <circle key={i} cx={xOf(p.ageY)} cy={yOf(p.value)} r={3.2} fill="#0f172a" className="dark:fill-white" stroke="#fff" strokeWidth={1} />
            ))}
          </>
        )}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-gray-500">
        {labels.map((lbl, li) => (
          <span key={li} className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: style[li].colour }} /> {lbl.replace('OW23', 'Overweight').replace('Ob27', 'Obese')}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-900 dark:bg-white" /> This child</span>
      </div>
    </div>
  );
}
