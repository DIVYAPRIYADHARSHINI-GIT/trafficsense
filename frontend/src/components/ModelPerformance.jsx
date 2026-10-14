import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Activity, Brain, Info, Target } from 'lucide-react';
import { fmt, fmtCompact, prettyDate } from '../lib/format';
import { SERIES, useChartTheme } from '../lib/chartTheme';
import { Card, ChartSkeleton, ErrorState, Segmented, Select } from './ui';

const R2 = 'R\u00b2';

// Model performance: MAE / RMSE / R^2 on a chronological hold-out (the most recent
// ~20% of days, never seen during training) plus actual-vs-predicted charts.
export default function ModelPerformance({ state }) {
  const { data, error, reload } = state;
  if (error) return <Card title="Model performance"><ErrorState error={error} onRetry={reload} compact /></Card>;
  if (!data) return <Card title="Model performance"><ChartSkeleton height={380} /></Card>;
  return <Body m={data} />;
}

function Body({ m }) {
  const theme = useChartTheme();
  const [view, setView] = useState('hourly');
  const roads = Object.keys(m.actual_vs_predicted.hourly);
  const [road, setRoad] = useState(roads[0]);
  const vc = m.model.vehicle_count;
  const sp = m.model.average_speed;
  const base = m.baseline.vehicle_count;
  const isRF = m.model_type === 'random_forest';

  const hourly = useMemo(
    () => (m.actual_vs_predicted.hourly[road] || []).map((p) => ({ ...p, label: p.timestamp.replace('T', ' ') })),
    [m, road],
  );
  const maxScatter = useMemo(() => Math.max(...m.actual_vs_predicted.scatter.map((p) => Math.max(p.actual, p.predicted)), 1), [m]);

  return (
    <Card
      title="Model performance"
      subtitle={`${isRF ? 'Random Forest Regressor' : 'Statistical fallback'} evaluated on the ${m.split.test_rows.toLocaleString()} most recent records (${prettyDate(m.split.test_start, { month: 'short', day: 'numeric' })} - ${prettyDate(m.split.test_end, { month: 'short', day: 'numeric' })}), which the model never saw during training.`}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile icon={Target} label="MAE" value={fmt(vc.mae)} unit="vehicles/h" hint="Mean absolute error: average miss per hourly prediction." />
        <MetricTile icon={Activity} label="RMSE" value={fmt(vc.rmse)} unit="vehicles/h" hint="Root mean squared error: penalises big misses more." />
        <MetricTile icon={Brain} label={`${R2} score`} value={vc.r2.toFixed(3)} unit={`${(vc.r2 * 100).toFixed(1)}% variance explained`} hint="1.0 = perfect, 0 = no better than the mean." />
        <MetricTile icon={Target} label="Accuracy" value={`${(vc.accuracy * 100).toFixed(1)}%`} unit={`congestion class ${(m.model.congestion_accuracy * 100).toFixed(1)}%`} hint="Volume accuracy = 1 - WAPE (weighted absolute % error)." />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
        <p>Speed model: MAE {sp.mae.toFixed(1)} km/h - RMSE {sp.rmse.toFixed(1)} km/h - {R2} {sp.r2.toFixed(3)}</p>
        <p className="sm:text-right">
          Historical-average baseline: MAE {fmt(base.mae)} - {R2} {base.r2.toFixed(3)} - trained in {m.training_seconds}s on {m.split.train_rows.toLocaleString()} rows
        </p>
      </div>
      {m.fallback_reason && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <Info className="h-4 w-4" aria-hidden /> Using the statistical fallback: {m.fallback_reason}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Actual vs predicted</h3>
        <div className="flex flex-wrap items-end gap-2">
          {view === 'hourly' && (
            <Select id="avp-road" value={road} onChange={setRoad} className="w-48">
              {roads.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          )}
          <Segmented label="Comparison view" value={view} onChange={setView}
            options={[{ value: 'hourly', label: 'Last 7 days' }, { value: 'daily', label: 'Daily totals' }, { value: 'scatter', label: 'Scatter' }]} />
        </div>
      </div>

      <div className="mt-3 h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          {view === 'hourly' ? (
            <LineChart data={hourly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke={theme.axis} tickLine={false} axisLine={false} minTickGap={40} tick={{ fontSize: 11 }}
                tickFormatter={(v) => prettyDate(v.slice(0, 10), { weekday: 'short', day: 'numeric' })} />
              <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={44} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
              <Tooltip {...theme.tooltip} formatter={(v, n) => [fmt(v), n]} />
              <Legend />
              <Line type="monotone" dataKey="actual" name="Actual" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="predicted" name="Predicted" stroke={SERIES[0]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            </LineChart>
          ) : view === 'daily' ? (
            <BarChart data={m.actual_vs_predicted.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke={theme.axis} tickLine={false} axisLine={false} minTickGap={24} tick={{ fontSize: 11 }}
                tickFormatter={(v) => prettyDate(v, { month: 'short', day: 'numeric' })} />
              <YAxis stroke={theme.axis} tickLine={false} axisLine={false} width={48} tickFormatter={fmtCompact} tick={{ fontSize: 12 }} />
              <Tooltip {...theme.tooltip} labelFormatter={(v) => prettyDate(v)} formatter={(v, n) => [fmt(v), n]} />
              <Legend />
              <Bar dataKey="actual" name="Actual" fill={SERIES[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="predicted" name="Predicted" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          ) : (
            <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="actual" name="Actual" stroke={theme.axis} tickFormatter={fmtCompact} domain={[0, maxScatter]} tick={{ fontSize: 12 }}
                label={{ value: 'Actual vehicles/h', position: 'insideBottom', offset: -4, fill: theme.axis, fontSize: 12 }} />
              <YAxis type="number" dataKey="predicted" name="Predicted" stroke={theme.axis} tickFormatter={fmtCompact} domain={[0, maxScatter]} width={48} tick={{ fontSize: 12 }} />
              <ZAxis range={[18, 18]} />
              <Tooltip {...theme.tooltip} formatter={(v, n) => [fmt(v), n]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxScatter, y: maxScatter }]} stroke={theme.axis} strokeDasharray="4 4" ifOverflow="extendDomain" />
              <Scatter data={m.actual_vs_predicted.scatter} fill={SERIES[0]} fillOpacity={0.55} isAnimationActive={false} />
            </ScatterChart>
          )}
        </ResponsiveContainer>
      </div>
      {view === 'scatter' && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">600 random test hours. Points on the dashed diagonal are perfect predictions.</p>}

      {m.feature_importance?.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">What drives the prediction</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Random Forest feature importance for vehicle count.</p>
          <div className="mt-3 space-y-2">
            {m.feature_importance.map((f) => (
              <div key={f.feature} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-slate-600 dark:text-slate-300">{f.label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-blue-500" style={{ width: `${Math.max(1, f.importance * 100)}%` }} />
                </div>
                <span className="w-12 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{(f.importance * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function MetricTile({ icon: Icon, label, value, unit, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800" title={hint}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{unit}</p>
    </div>
  );
}
