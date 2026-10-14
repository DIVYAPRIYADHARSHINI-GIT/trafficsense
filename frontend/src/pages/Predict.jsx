import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Car, Cloud, CloudRain, Gauge, Loader2, PartyPopper, Shuffle, Sun, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../lib/AppContext';
import { useApi } from '../lib/useApi';
import { addDays, capitalize, fmt, fmtPct, HOURS, hour12, hourRange12, isoDate, prettyDate } from '../lib/format';
import { CONGESTION } from '../lib/chartTheme';
import BestTime from '../components/BestTime';
import { Card, ChartSkeleton, CongestionBadge, ErrorState, PageHeader, RoadSelect, Select, Spinner } from '../components/ui';

const WEATHER_OPTIONS = [
  { value: 'sunny', label: 'Sunny', icon: Sun },
  { value: 'cloudy', label: 'Cloudy', icon: Cloud },
  { value: 'rainy', label: 'Rainy', icon: CloudRain },
  { value: 'auto', label: 'Not sure', icon: Shuffle },
];

const RESULT_STYLE = {
  Low: { panel: 'from-emerald-500 to-green-600', text: 'Light traffic - a good time to go.' },
  Medium: { panel: 'from-amber-400 to-yellow-500', text: 'Moderate traffic - expect some slowdowns.' },
  High: { panel: 'from-red-500 to-rose-600', text: 'Heavy traffic - consider another time.' },
};

export default function Predict() {
  const { meta } = useApp();
  const roads = useMemo(() => meta?.roads || [], [meta]);
  const [form, setForm] = useState({ road: '', date: isoDate(addDays(new Date(), 1)), hour: 8, weather: 'sunny' });
  const [windowRange, setWindowRange] = useState({ start: 6, end: 22 });
  const [prediction, setPrediction] = useState(null);
  const [predictError, setPredictError] = useState(null);
  const [predicting, setPredicting] = useState(false);

  useEffect(() => {
    if (roads.length && !roads.includes(form.road)) setForm((f) => ({ ...f, road: roads[0] }));
  }, [roads, form.road]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const runPredict = async (override = {}) => {
    const payload = { ...form, ...override };
    if (!payload.road || !payload.date) return;
    setPredicting(true);
    setPredictError(null);
    try {
      setPrediction(await api.predict({ road: payload.road, date: payload.date, time: `${String(payload.hour).padStart(2, '0')}:00`, weather: payload.weather }));
    } catch (err) {
      setPredictError(err);
    } finally {
      setPredicting(false);
    }
  };

  const best = useApi(
    () => (form.road && form.date
      ? api.bestTime({ road: form.road, date: form.date, weather: form.weather, start_hour: windowRange.start, end_hour: windowRange.end })
      : Promise.resolve(null)),
    [form.road, form.date, form.weather, windowRange.start, windowRange.end],
  );

  const pickHour = (hour) => {
    setForm((f) => ({ ...f, hour }));
    runPredict({ hour });
    document.getElementById('prediction-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    runPredict();
  };

  return (
    <>
      <PageHeader
        title="Predict traffic"
        subtitle="Pick a road, date, time and the expected weather. TrafficSense estimates the vehicle count, congestion and speed for that hour."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Your trip">
          <form onSubmit={onSubmit} className="space-y-4">
            <RoadSelect roads={roads} value={form.road} onChange={set('road')} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="date" className="label">Date</label>
                <input id="date" type="date" className="input" value={form.date} required min={meta?.start_date}
                  onChange={(e) => set('date')(e.target.value)} />
              </div>
              <Select id="time" label="Time" value={form.hour} onChange={(v) => set('hour')(Number(v))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{hour12(h)} ({String(h).padStart(2, '0')}:00)</option>
                ))}
              </Select>
            </div>
            <fieldset>
              <legend className="label">Weather</legend>
              <div className="grid grid-cols-4 gap-2">
                {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" onClick={() => set('weather')(value)} aria-pressed={form.weather === value}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${
                      form.weather === value
                        ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}>
                    <Icon className="h-5 w-5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
              {form.weather === 'auto' && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Blends sunny, cloudy and rainy by how often each occurred in this month historically.</p>
              )}
            </fieldset>
            <button type="submit" className="btn-primary w-full py-3 text-base" disabled={predicting || !form.road}>
              {predicting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Zap className="h-5 w-5" aria-hidden />}
              {predicting ? 'Predicting...' : 'Predict'}
            </button>
            {meta && (
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                Model: {meta.model_type === 'random_forest' ? 'Random Forest' : 'Historical-average fallback'} trained on {fmt(meta.rows)} records -{' '}
                <Link to="/insights#model" className="font-medium text-brand-700 hover:underline dark:text-brand-300">see accuracy</Link>
              </p>
            )}
          </form>
        </Card>

        <div id="prediction-result" className="lg:col-span-3 scroll-mt-24">
          <PredictionResult prediction={prediction} error={predictError} loading={predicting} onRetry={() => runPredict()} />
        </div>
      </div>

      <Card
        className="mt-6"
        title={`Best time to travel${form.road ? ` on ${form.road}` : ''}`}
        subtitle={`Predicted traffic for every hour of ${prettyDate(form.date, { weekday: 'long', month: 'long', day: 'numeric' })}${form.weather === 'auto' ? ' (typical weather)' : `, ${form.weather}`}.`}
        actions={
          <div className="flex items-end gap-2">
            <Select id="win-start" label="Earliest" value={windowRange.start} className="w-32"
              onChange={(v) => setWindowRange((w) => ({ start: Number(v), end: Math.max(Number(v), w.end) }))}>
              {HOURS.map((h) => <option key={h} value={h}>{hour12(h)}</option>)}
            </Select>
            <Select id="win-end" label="Latest" value={windowRange.end} className="w-32"
              onChange={(v) => setWindowRange((w) => ({ start: Math.min(Number(v), w.start), end: Number(v) }))}>
              {HOURS.map((h) => <option key={h} value={h}>{hour12(h)}</option>)}
            </Select>
          </div>
        }
      >
        {best.error ? (
          <ErrorState error={best.error} onRetry={best.reload} compact />
        ) : best.data ? (
          <div className={best.loading ? 'opacity-60 transition' : 'transition'}>
            <BestTime data={best.data} onPickHour={pickHour} selectedHour={prediction?.road === form.road && prediction?.date === form.date ? prediction.hour : null} />
          </div>
        ) : (
          <ChartSkeleton height={280} />
        )}
      </Card>
    </>
  );
}

function PredictionResult({ prediction: p, error, loading, onRetry }) {
  if (error) return <Card className="h-full"><ErrorState error={error} onRetry={onRetry} /></Card>;
  if (!p) {
    return (
      <Card className="h-full" bodyClassName="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
        {loading ? <Spinner label="Running the model..." /> : (
          <>
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Gauge className="h-7 w-7" aria-hidden />
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Ready when you are</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Fill in your trip and press <span className="font-semibold">Predict</span> to see the expected vehicle count, congestion level and speed.
            </p>
          </>
        )}
      </Card>
    );
  }

  const style = RESULT_STYLE[p.congestion_level];
  const vsTypical = p.vs_typical_pct;
  return (
    <Card className={`h-full ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Prediction for</p>
          <p className="text-lg font-bold text-slate-900 dark:text-white">{p.road}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {prettyDate(p.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} - {hourRange12(p.hour)} - {p.weather === 'auto' ? 'typical weather' : capitalize(p.weather)}
          </p>
        </div>
        {p.is_holiday && (
          <span className="chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300">
            <PartyPopper className="h-3.5 w-3.5" aria-hidden /> {p.holiday_name || 'Holiday'}
          </span>
        )}
      </div>

      <div className={`mt-4 rounded-2xl bg-gradient-to-br p-5 text-white shadow-lg ${style.panel}`} role="status" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/85">Congestion level</p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight">{p.congestion_level}</p>
        <p className="mt-1 text-sm text-white/90">{style.text}</p>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/25" aria-hidden>
          {['Low', 'Medium', 'High'].map((lvl) => (
            <div key={lvl} style={{ width: `${p.congestion_probabilities[lvl] * 100}%` }}
              className={lvl === p.congestion_level ? 'bg-white' : 'bg-white/45'} />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-white/85">
          Confidence: Low {Math.round(p.congestion_probabilities.Low * 100)}% - Medium {Math.round(p.congestion_probabilities.Medium * 100)}% - High {Math.round(p.congestion_probabilities.High * 100)}%
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Metric icon={Car} label="Predicted vehicles" value={`${fmt(p.vehicle_count)}`} unit="vehicles / hour"
          detail={`Likely range ${fmt(p.vehicle_count_range[0])} - ${fmt(p.vehicle_count_range[1])}`} />
        <Metric icon={Gauge} label="Expected average speed" value={p.average_speed.toFixed(0)} unit="km/h"
          detail={p.free_flow_speed ? `Free-flow ${Math.round(p.free_flow_speed)} km/h - ${Math.round(p.delay_pct)}% slower` : null} />
      </div>

      <div className="mt-4 space-y-2 text-sm">
        {vsTypical !== null && vsTypical !== undefined && (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            {vsTypical >= 0 ? <TrendingUp className="h-4 w-4 text-red-500" aria-hidden /> : <TrendingDown className="h-4 w-4 text-emerald-500" aria-hidden />}
            {fmtPct(vsTypical, 0, true)} vs. the typical {p.is_holiday ? 'holiday' : p.day_of_week === 'Saturday' || p.day_of_week === 'Sunday' ? 'weekend' : 'weekday'} at this hour ({fmt(p.typical_vehicle_count)} vehicles).
          </p>
        )}
        {p.actual && (
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden />
            Recorded in the data: {fmt(p.actual.vehicle_count)} vehicles, {p.actual.average_speed} km/h, <CongestionBadge level={p.actual.congestion_level} /> ({p.actual.weather}).
          </p>
        )}
        {p.warnings?.map((w) => (
          <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{w}</p>
        ))}
      </div>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, unit, detail }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {label}
      </p>
      <p className="mt-1.5 text-3xl font-bold text-slate-900 dark:text-white">
        {value} <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{unit}</span>
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
  );
}

export { CONGESTION };
