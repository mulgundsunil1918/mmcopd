import { useMemo } from 'react';
import { referenceCurves, chartLabel, type GrowthChart as ChartType, type Sex } from '../../lib/peds/growth';

/**
 * WHO growth chart: the OFFICIAL WHO percentile curves with the child's
 * measurements plotted on top. Pure SVG, no charting library.
 *
 * The WHO Child Growth Standards printed charts draw the 3rd, 15th, 50th, 85th
 * and 97th percentile lines (NOT the CDC 3/10/25/50/75/90 set) — so those are
 * exactly the lines drawn here, matching the percentile bands the assessment
 * text reports. Each percentile is converted to its z-score (probit) and fed
 * through the same LMS reference machinery, so the curves come straight from the
 * official WHO LMS tables.
 *
 * X axis: age in months (0–60). Y axis: the measured quantity (kg / cm).
 */
const PCTS: { pct: number; z: number; colour: string; label: string; dash?: string }[] = [
  { pct: 3,  z: -1.88079, colour: '#ef4444', label: '3rd',  dash: '3 3' },
  { pct: 15, z: -1.03643, colour: '#f59e0b', label: '15th' },
  { pct: 50, z: 0,        colour: '#2563eb', label: '50th' },
  { pct: 85, z: 1.03643,  colour: '#f59e0b', label: '85th' },
  { pct: 97, z: 1.88079,  colour: '#ef4444', label: '97th', dash: '3 3' },
];
const Z_LINES = PCTS.map((p) => p.z);

const UNIT: Record<ChartType, string> = { wfa: 'kg', lhfa: 'cm', hcfa: 'cm', bfa: 'kg/m²' };

export function GrowthChart({ chart, sex, points }: {
  chart: ChartType; sex: Sex;
  points: { ageDays: number; value: number }[];   // the child's measurements
}) {
  const W = 640, H = 380, padL = 44, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const curves = useMemo(() => referenceCurves(chart, sex, Z_LINES), [chart, sex]);

  const { maxAgeM, yMin, yMax } = useMemo(() => {
    let yMinV = Infinity, yMaxV = -Infinity;
    for (const c of curves) for (const v of c.values) { if (v < yMinV) yMinV = v; if (v > yMaxV) yMaxV = v; }
    for (const p of points) { if (p.value < yMinV) yMinV = p.value; if (p.value > yMaxV) yMaxV = p.value; }
    if (!Number.isFinite(yMinV)) { yMinV = 0; yMaxV = 1; }
    const pad = (yMaxV - yMinV) * 0.05 || 1;
    return { maxAgeM: 60, yMin: Math.max(0, yMinV - pad), yMax: yMaxV + pad };
  }, [curves, points]);

  const xOf = (ageM: number) => padL + (ageM / maxAgeM) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Build each percentile line's path across the age range (days → months).
  const linePaths = PCTS.map((pc, zi) => {
    const d = curves
      .filter((c) => c.day <= maxAgeM * 30.44)
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zi]).toFixed(1)}`)
      .join(' ');
    return { ...pc, d };
  });

  // Shaded normal band between the 3rd and 97th percentiles (the WHO normal range).
  const bandPath = (() => {
    const zLo = 0, zHi = PCTS.length - 1; // 3rd … 97th
    const pts = curves.filter((c) => c.day <= maxAgeM * 30.44);
    if (pts.length === 0) return '';
    const top = pts.map((c, i) => `${i === 0 ? 'M' : 'L'} ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zHi]).toFixed(1)}`).join(' ');
    const bot = [...pts].reverse().map((c) => `L ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zLo]).toFixed(1)}`).join(' ');
    return `${top} ${bot} Z`;
  })();

  const yTicks = 6, xTicks = 6;

  return (
    <div className="card p-3">
      <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 mb-1">
        {chartLabel(chart)} · {sex === 'M' ? 'Boys' : 'Girls'} · WHO 0–5y
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} className="text-gray-400">
        {/* grid + axes */}
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
          const m = (i / xTicks) * maxAgeM;
          const x = xOf(m);
          return (
            <g key={`x${i}`}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="currentColor" strokeOpacity={0.08} />
              <text x={x} y={H - padB + 14} textAnchor="middle" fontSize={9} fill="currentColor">{Math.round(m)}m</text>
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="currentColor">Age (months)</text>
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize={9} fill="currentColor" transform={`rotate(-90 12 ${padT + plotH / 2})`}>{UNIT[chart]}</text>

        {/* normal band */}
        {bandPath && <path d={bandPath} fill="#3b82f6" fillOpacity={0.06} stroke="none" />}

        {/* percentile reference lines */}
        {linePaths.map((pl) => (
          <path key={pl.pct} d={pl.d} fill="none" stroke={pl.colour} strokeWidth={pl.pct === 50 ? 1.8 : 1} strokeDasharray={pl.dash} strokeOpacity={0.85} />
        ))}

        {/* child's measurements — line + points */}
        {points.length > 0 && (
          <>
            <path
              d={points.filter((p) => p.ageDays <= maxAgeM * 30.44).sort((a, b) => a.ageDays - b.ageDays)
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.ageDays / 30.44).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ')}
              fill="none" stroke="var(--chart-ink)" strokeWidth={1.6} />
            {points.filter((p) => p.ageDays <= maxAgeM * 30.44).map((p, i) => (
              <g key={i}><circle cx={xOf(p.ageDays / 30.44)} cy={yOf(p.value)} r={5} fill="#ffffff" /><circle cx={xOf(p.ageDays / 30.44)} cy={yOf(p.value)} r={3.6} fill="#0f172a" stroke="#ffffff" strokeWidth={1} /></g>
            ))}
          </>
        )}
      </svg>
      {/* legend */}
      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-gray-500">
        {PCTS.map((pc) => (
          <span key={pc.pct} className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: pc.colour }} /> {pc.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--chart-ink)' }} /> This child</span>
      </div>
    </div>
  );
}
