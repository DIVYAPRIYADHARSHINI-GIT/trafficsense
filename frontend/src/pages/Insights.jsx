import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Briefcase, Cloud, CloudRain, Lightbulb, PartyPopper, Sun, Sunset } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../lib/AppContext';
import { useApi } from '../lib/useApi';
import { capitalize, fmt, fmtCompact, fmtPct, hour12, hourRange12, prettyDate } from '../lib/format';
import { DAYTYPE_COLORS, WEATHER_COLORS, useChartTheme } from '../lib/chartTheme';
import ModelPerformance from '../components/ModelPerformance';
import { Card, ChartSkeleton, ErrorState, PageHeader, RoadSelect } from '../components/ui';

const DAY_TYPE_META = {
  weekday: { label: 'Weekdays', icon: Briefcase },
  weekend: { label: 'Weekends', icon: Sunset },
  holiday: { label: 'Holidays', icon: PartyPopper },
};
const WEATHER_ICON = { sunny: Sun, cloudy: Cloud, rainy: CloudRain };

export default function Insights() {
  const { meta } = useApp();
  const location = useLocation();
  const [road, setRoad] = useState('all');
  const insights = useApi(() => api.insights(road === 'all' ? undefined : road), [road]);
  const metrics = useApi(() => api.modelMetrics(), []);

  useEffect(() => {
    if (location.hash === '#model' && metrics.data) {
      document.getElementById('model')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location.hash, metrics.data]);

  const d = insights.data;
  return (
    <>
      <PageHeader
        title="Traffic insights"
        subtitle="How the working week, weekends, holidays and the weather change traffic, and how accurate the predictions are."
        actions={<RoadSelect id="insight-road" label="" roads={meta?.roads || []} value={road} onChange={setRoad} includeAll className="w-48" />}
      />

      {insights.error ? (
        <Card><ErrorState error={insights.error} onRetry={insights.reload} /></Card>
      ) : !d ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><Card><ChartSkeleton /></Card><Card><ChartSkeleton /></Card></div>
      ) : (
        <div className={insights.loading ? 'opacity-60 transition' : 'transition'}>
          {d.findings.length > 0 && (
            <Card title="Key findings">
              <ul className="grid gap-3 md:grid-cols-2">
                {d.findings.map((f) => (
                  <li key={f} className="flex gap-3 rounded-xl bg-brand-50/60 p-3 text-sm text-slate-700 dark:bg-brand-500/5 dark:text-slate-200">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <DayTypeSection d={d} />
          <WeatherSection d={d} />
          {road === 'all' && <RoadSection d={d} />}
        </div>
      )}

      <div id="model" className="mt-6 scroll-mt-24">
        <ModelPerformance state={metrics} />
      </div>
    </>
  );
}

function DayTypeSection({ d }) {
  const theme = useChartTheme();
  const types = Object.keys(d.day_types);
  const weekday = d.day_types.weekday;
  const bars = types.map((t) => ({ type: DAY_TYPE_META[t].label, key: t, vehicles: d.day_types[t].avg_daily_vehicles }));

  return (
    <Card className="mt-6" title="Weekday vs weekend" subtitle="Average traffic per day type and how the day unfolds hour by hour.">
      <div className="grid gap-3 sm:grid-cols-3">
        {types.map((t) => {
          const s = d.day_types[t];
          const Icon = DAY_TYPE_META[t].icon;
          const diff = weekday && t !== 'weekday' ? ((s.avg_daily_vehicles / weekday.avg_daily_vehicles - 1) * 100) : null;
          return (
            <div key={t} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: DAYTYPE_COLORS[t] }}>
                <Icon className="h-4 w-4" aria-hidden /> {DAY_TYPE_META[t].label}
                <span className="ml-auto text-xs font-medium text-slate-400">{s.days} days</span>
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{fmt(s.avg_daily_vehicles)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                vehicles/day{diff !== null && <> - <span className={diff < 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtPct(diff, 0, true)} vs weekdays</span></>}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                <dt className="text-slate-500 dark:text-slate-400">Peak hour</dt><dd className="text-right font-medium">{hourRange12(s.peak_hour)}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Avg speed</dt><dd className="text-right font-medium">{s.avg_speed} km/h</dd>
                <dt className="text-slate-500 dark:text-slate-400">High congestion</dt><dd className="text-right font-medium">{s.high_congestion_pct}% of hours</dd>
              </dl>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Average vehicles per hour</h3>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.hourly_profile} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" stroke={theme.axis} tickLine={false} axisLine={false} interval={2} tickFormatter={(h) => hour12(h).replace(' ', '').toLowerCase()} tick={{ fontSize: 11 }} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
                <Tooltip {...theme.tooltip} labelFormatter={(h) => hourRange12(h)} formatter={(v, n) => [fmt(v), capitalize(n)]} />
                <Legend formatter={(v) => DAY_TYPE_META[v]?.label || v} />
                {types.map((t) => (
                  <Line key={t} type="monotone" dataKey={t} stroke={DAYTYPE_COLORS[t]} strokeWidth={t === 'holiday' ? 2 : 2.75}
                    strokeDasharray={t === 'holiday' ? '5 4' : undefined} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Vehicles per day</h3>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="type" stroke={theme.axis} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
                <Tooltip {...theme.tooltip} formatter={(v) => [fmt(v), 'Vehicles/day']} />
                <Bar dataKey="vehicles" radius={[8, 8, 0, 0]} isAnimationActive={false}>
                  {bars.map((b) => <Cell key={b.key} fill={DAYTYPE_COLORS[b.key]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {d.holidays.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Holidays in the data:</span>
          {d.holidays.map((h) => (
            <span key={h.date} className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" title={`${fmt(h.vehicles)} vehicles`}>
              {h.name} - {prettyDate(h.date, { month: 'short', day: 'numeric' })}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function WeatherSection({ d }) {
  const theme = useChartTheme();
  const weathers = d.weather.map((w) => w.weather);
  const impact = d.weather.map((w) => ({ name: capitalize(w.weather), key: w.weather, volume: w.volume_vs_sunny_pct, speed: w.speed_vs_sunny_pct }));

  return (
    <Card className="mt-6" title="Effect of weather on traffic"
      subtitle="Compared at the same road, hour and day type, so a rainy rush hour is measured against a sunny rush hour.">
      <div className="grid gap-3 sm:grid-cols-3">
        {d.weather.map((w) => {
          const Icon = WEATHER_ICON[w.weather] || Cloud;
          return (
            <div key={w.weather} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: WEATHER_COLORS[w.weather] }}>
                <Icon className="h-4 w-4" aria-hidden /> {capitalize(w.weather)}
                <span className="ml-auto text-xs font-medium text-slate-400">{w.share_pct}% of hours</span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">{fmtPct(w.volume_vs_sunny_pct, 0, true)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">traffic volume</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">{fmtPct(w.speed_vs_sunny_pct, 0, true)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">average speed</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {w.avg_speed} km/h avg - {w.high_congestion_pct}% of hours High
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Change vs sunny (%)</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={impact} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" stroke={theme.axis} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
                <Tooltip {...theme.tooltip} formatter={(v, n) => [fmtPct(v, 1, true), n]} />
                <Legend />
                <Bar dataKey="volume" name="Volume" fill="#2563eb" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="speed" name="Speed" fill="#0d9488" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Weekday vehicles per road-hour by weather</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.weather_profile} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" stroke={theme.axis} tickLine={false} axisLine={false} interval={2} tickFormatter={(h) => hour12(h).replace(' ', '').toLowerCase()} tick={{ fontSize: 11 }} />
                <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
                <Tooltip {...theme.tooltip} labelFormatter={(h) => hourRange12(h)} formatter={(v, n) => [fmt(v), capitalize(n)]} />
                <Legend formatter={capitalize} />
                {weathers.map((w) => (
                  <Line key={w} type="monotone" dataKey={w} stroke={WEATHER_COLORS[w]} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RoadSection({ d }) {
  const theme = useChartTheme();
  return (
    <Card className="mt-6" title="Road comparison" subtitle="Daily volume, speed and how often each road is heavily congested.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.roads} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke={theme.axis} tickLine={false} axisLine={false} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="road" stroke={theme.axis} tickLine={false} axisLine={false} width={124} tick={{ fontSize: 12 }} />
              <Tooltip {...theme.tooltip} formatter={(v) => [fmt(v), 'Vehicles/day']} />
              <Bar dataKey="avg_daily_vehicles" fill="#0d9488" radius={[0, 6, 6, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="py-2 pr-2 font-semibold">Road</th>
                <th className="py-2 pr-2 text-right font-semibold">Avg speed</th>
                <th className="py-2 pr-2 text-right font-semibold">% High</th>
                <th className="py-2 text-right font-semibold">Worst hour</th>
              </tr>
            </thead>
            <tbody>
              {d.roads.map((r) => (
                <tr key={r.road} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                  <td className="py-2.5 pr-2 font-medium text-slate-800 dark:text-slate-100">{r.road}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.avg_speed} km/h</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums">
                    <span className={r.high_congestion_pct >= 15 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}>
                      {r.high_congestion_pct}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-slate-600 dark:text-slate-300">{hour12(Number(r.peak_hour_label.slice(0, 2)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
