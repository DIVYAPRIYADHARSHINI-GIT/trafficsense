import { useMemo, useState } from 'react';
import {
  Brush, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmt, fmtCompact, prettyDate } from '../lib/format';
import { SERIES, useChartTheme } from '../lib/chartTheme';
import { Segmented } from './ui';

// 6-month traffic trend. "Total" shows all-road daily volume + 7-day rolling average;
// "By road" splits the line per road. Weekly granularity smooths day-of-week noise.
export default function TrendChart({ data, granularity }) {
  const theme = useChartTheme();
  const [view, setView] = useState('total');
  const roads = data.roads;

  const points = useMemo(
    () =>
      data.points.map((p) => ({
        ...p,
        value: granularity === 'weekly' ? p.avg_daily : p.total,
        ...Object.fromEntries(Object.entries(p.by_road || {}).map(([r, v]) => [`road:${r}`, v])),
      })),
    [data, granularity],
  );

  const tooltipLabel = (_, payload) => {
    const p = payload?.[0]?.payload;
    if (!p) return '';
    if (granularity === 'weekly') return `${p.label}${p.partial ? ` (${p.days} days)` : ''}`;
    return `${prettyDate(p.date)}${p.is_holiday ? ' - Holiday' : ''}${p.rain_hours >= 6 ? ` - ${p.rain_hours}h rain` : ''}`;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {granularity === 'weekly' ? 'Average vehicles per day, by week' : 'Vehicles per day (all hours)'} - drag the brush below to zoom
        </p>
        {roads.length > 1 && (
          <Segmented
            label="Trend view"
            value={view}
            onChange={setView}
            options={[{ value: 'total', label: 'Total' }, { value: 'roads', label: 'By road' }]}
          />
        )}
      </div>
      <div className="h-[320px] sm:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={theme.axis} tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 12 }} />
            <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={48} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
            <Tooltip {...theme.tooltip} labelFormatter={tooltipLabel} formatter={(v, name) => [fmt(v), name]} />
            <Legend wrapperStyle={{ paddingTop: 8 }} />
            {view === 'total' || roads.length <= 1 ? (
              <>
                <Line type="monotone" dataKey="value" name={granularity === 'weekly' ? 'Avg vehicles/day' : 'Vehicles/day'}
                  stroke={SERIES[1]} strokeWidth={granularity === 'weekly' ? 2.5 : 1.25} strokeOpacity={granularity === 'weekly' ? 1 : 0.55}
                  dot={granularity === 'weekly' ? { r: 2.5 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
                {granularity === 'daily' && (
                  <Line type="monotone" dataKey="rolling_avg" name="7-day average" stroke={SERIES[0]} strokeWidth={2.75}
                    dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                )}
              </>
            ) : (
              roads.map((road, i) => (
                <Line key={road} type="monotone" dataKey={`road:${road}`} name={road} stroke={SERIES[i % SERIES.length]}
                  strokeWidth={granularity === 'weekly' ? 2.25 : 1.5} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />
              ))
            )}
            {points.length > 20 && (
              <Brush dataKey="label" height={24} travellerWidth={8} stroke={SERIES[0]}
                fill={theme.isDark ? '#0f172a' : '#f8fafc'} tickFormatter={() => ''} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
