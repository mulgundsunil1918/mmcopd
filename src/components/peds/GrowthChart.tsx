import { useMemo } from 'react';
import { referenceCurves, chartLabel, type GrowthChart as ChartType, type Sex } from '../../lib/peds/growth';

/**
 * WHO growth chart: reference SD/centile curves with the child's measurements
 * plotted on top. Pure SVG (theme-aware via currentColor and explicit strokes),
 * no charting library.
 *
 * X axis: age in months (0–60). Y axis: the measured quantity (kg / cm).
 * Reference lines shown: −3, −2, median, +2, +3 SD, shaded normal band ±2.
 */
const Z_LINES = [-3, -2, 0, 2, 3];
const Z_STYLE: Record<number, { colour: string; label: string; dash?: string }> = {
  [-3]: { colour: '#ef4444', label: '-3 SD', dash: '3 3' },
  [-2]: { colour: '#f59e0b', label: '-2 SD' },
  [0]: { colour: '#2563eb', label: 'Median' },
  [2]: { colour: '#f59e0b', label: '+2 SD' },
  [3]: { colour: '#ef4444', label: '+3 SD', dash: '3 3' },
};

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

  // Build each reference line's path across the age range (days → months).
  const linePaths = Z_LINES.map((z, zi) => {
    const d = curves
      .filter((c) => c.day <= maxAgeM * 30.44)
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zi]).toFixed(1)}`)
      .join(' ');
    return { z, d };
  });

  // Shaded normal band between -2 and +2.
  const bandPath = (() => {
    const zLo = Z_LINES.indexOf(-2), zHi = Z_LINES.indexOf(2);
    const pts = curves.filter((c) => c.day <= maxAgeM * 30.44);
    if (pts.length === 0) return '';
    const top = pts.map((c, i) => `${i === 0 ? 'M' : 'L'} ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zHi]).toFixed(1)}`).join(' ');
    const bot = [...pts].reverse().map((c) => `L ${xOf(c.day / 30.44).toFixed(1)} ${yOf(c.values[zLo]).toFixed(1)}`).join(' ');
    return `${top} ${bot} Z`;
  })();

  const yTicks = 6, xTicks = 6;

  return (
    <div className="card p-3 overflow-x-auto">
      <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 mb-1">
        {chartLabel(chart)} · {sex === 'M' ? 'Boys' : 'Girls'} · WHO 0–5y
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 480 }} className="text-gray-400">
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

        {/* reference lines */}
        {linePaths.map(({ z, d }) => (
          <path key={z} d={d} fill="none" stroke={Z_STYLE[z].colour} strokeWidth={z === 0 ? 1.8 : 1} strokeDasharray={Z_STYLE[z].dash} strokeOpacity={0.85} />
        ))}

        {/* child's measurements — line + points */}
        {points.length > 0 && (
          <>
            <path
              d={points.filter((p) => p.ageDays <= maxAgeM * 30.44).sort((a, b) => a.ageDays - b.ageDays)
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.ageDays / 30.44).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ')}
              fill="none" stroke="var(--chart-ink)" strokeWidth={1.6} />
            {points.filter((p) => p.ageDays <= maxAgeM * 30.44).map((p, i) => (
              <circle key={i} cx={xOf(p.ageDays / 30.44)} cy={yOf(p.value)} r={3.2} fill="var(--chart-ink)" stroke="var(--chart-paper)" strokeWidth={1} />
            ))}
          </>
        )}
      </svg>
      {/* legend */}
      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-gray-500">
        {Z_LINES.map((z) => (
          <span key={z} className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5" style={{ background: Z_STYLE[z].colour }} /> {Z_STYLE[z].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--chart-ink)' }} /> This child</span>
      </div>
    </div>
  );
}
