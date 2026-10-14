import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock3, Sparkles, ThumbsDown } from 'lucide-react';
import { fmt, fmtCompact, hour12, hourRange12, prettyDate } from '../lib/format';
import { CONGESTION, useChartTheme } from '../lib/chartTheme';
import { CongestionBadge } from './ui';

// "Best time to travel": 24 predicted hours for one road/date, coloured by congestion,
// with the lowest-traffic hours inside the chosen travel window highlighted.
export default function BestTime({ data, onPickHour, selectedHour }) {
  const theme = useChartTheme();
  const bestSet = new Set(data.best_hours.map((h) => h.hour));
  const points = data.hourly.map((h) => ({ ...h, short: hour12(h.hour).replace(' ', '').toLowerCase() }));
  const top = data.best_hours[0];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={(e) => e?.activePayload?.[0] && onPickHour?.(e.activePayload[0].payload.hour)}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="short" stroke={theme.axis} tickLine={false} axisLine={false} interval={2} tick={{ fontSize: 11 }} />
              <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
              <Tooltip
                {...theme.tooltip}
                labelFormatter={(_, p) => (p?.[0] ? hourRange12(p[0].payload.hour) : '')}
                formatter={(v, _n, item) => [
                  `${fmt(v)} vehicles - ${item.payload.average_speed} km/h - ${item.payload.congestion_level}`,
                  bestSet.has(item.payload.hour) ? 'Recommended' : 'Predicted',
                ]}
              />
              {selectedHour !== undefined && selectedHour !== null && (
                <ReferenceLine x={hour12(selectedHour).replace(' ', '').toLowerCase()} stroke={theme.axis} strokeDasharray="4 4" />
              )}
              <Bar dataKey="vehicle_count" radius={[6, 6, 0, 0]} cursor="pointer" isAnimationActive={false}>
                {points.map((p) => (
                  <Cell
                    key={p.hour}
                    fill={CONGESTION[p.congestion_level].color}
                    fillOpacity={!p.in_window ? 0.18 : bestSet.has(p.hour) ? 1 : 0.5}
                    stroke={bestSet.has(p.hour) ? (theme.isDark ? '#f8fafc' : '#0f172a') : 'none'}
                    strokeWidth={bestSet.has(p.hour) ? 1.5 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Bars are coloured by predicted congestion (<span className="font-semibold text-emerald-600">green</span> low,{' '}
          <span className="font-semibold text-amber-500">yellow</span> medium, <span className="font-semibold text-red-600">red</span> high).
          Outlined bars are the recommended hours; faded bars fall outside your travel window. Click a bar to predict that hour.
        </p>
      </div>

      <div className="space-y-4">
        {top && (
          <div className="rounded-xl bg-gradient-to-br from-brand-600 to-blue-600 p-4 text-white shadow-lg shadow-brand-600/20">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/80">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Best time on {prettyDate(data.date, { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <p className="mt-1 text-2xl font-bold">{hourRange12(top.hour)}</p>
            <p className="mt-0.5 text-sm text-white/90">
              ~{fmt(top.vehicle_count)} vehicles - {top.average_speed} km/h
              {top.savings_vs_peak_pct > 0 && ` - ${Math.round(top.savings_vs_peak_pct)}% lighter than the worst hour`}
            </p>
            {data.best_block && (
              <p className="mt-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs">
                Best 2-hour window: <span className="font-semibold">{hour12(data.best_block.start_hour)} - {hour12(data.best_block.end_hour)}</span>
              </p>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Clock3 className="h-4 w-4 text-brand-600" aria-hidden /> Lowest-traffic hours
          </p>
          <ol className="space-y-1.5">
            {data.best_hours.map((h, i) => (
              <li key={h.hour}>
                <button type="button" onClick={() => onPickHour?.(h.hour)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-slate-800 dark:hover:bg-brand-500/5">
                  <span className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{i + 1}</span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{hourRange12(h.hour)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {fmt(h.vehicle_count)} <CongestionBadge level={h.congestion_level} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {data.worst_hours?.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ThumbsDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
            Avoid {data.worst_hours.map((h) => hour12(h.hour)).join(', ')} - up to {fmt(data.worst_hours[0].vehicle_count)} vehicles/h.
          </p>
        )}
      </div>
    </div>
  );
}
