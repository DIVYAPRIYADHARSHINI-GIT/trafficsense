import { useMemo, useState } from 'react';
import { fmt, hour12, hourRange12 } from '../lib/format';
import { useApp } from '../lib/AppContext';

// Peak-hours heatmap (hour of day x day of week) rendered as a CSS grid so it stays
// crisp, accessible and responsive. Colour ramps from teal-pale (quiet) to deep blue
// (busy); for the speed metric the ramp is reversed so "bad" is always darker.
const LIGHT_RAMP = ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#1e40af', '#1e3a8a'];
const DARK_RAMP = ['#0b1f24', '#0f3b3c', '#115e59', '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#38bdf8', '#3b82f6', '#6366f1'];

function rampColor(t, ramp) {
  const x = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = ramp[i];
  const b = ramp[Math.min(i + 1, ramp.length - 1)];
  const mix = (ca, cb) => Math.round(parseInt(ca, 16) * (1 - f) + parseInt(cb, 16) * f);
  const r = mix(a.slice(1, 3), b.slice(1, 3));
  const g = mix(a.slice(3, 5), b.slice(3, 5));
  const bl = mix(a.slice(5, 7), b.slice(5, 7));
  return `rgb(${r}, ${g}, ${bl})`;
}

export default function Heatmap({ data, metric = 'vehicle_count' }) {
  const { isDark } = useApp();
  const [hover, setHover] = useState(null);
  const ramp = isDark ? DARK_RAMP : LIGHT_RAMP;
  const invert = metric === 'average_speed';

  const grid = useMemo(() => {
    const map = new Map();
    data.cells.forEach((c) => map.set(`${c.day_index}-${c.hour}`, c));
    return map;
  }, [data]);

  const span = data.max - data.min || 1;
  const norm = (v) => {
    const t = (v - data.min) / span;
    return invert ? 1 - t : t;
  };
  const unitSuffix = metric === 'average_speed' ? ' km/h' : metric === 'high_congestion' ? '%' : ' veh/h';
  const display = (v) => (metric === 'vehicle_count' ? fmt(v) : v.toFixed(metric === 'average_speed' ? 1 : 0));

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[640px]">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: '44px repeat(24, minmax(0, 1fr))' }}>
            <div />
            {data.hours.map((h) => (
              <div key={h} className="pb-1 text-center text-[10px] font-medium text-slate-500 dark:text-slate-400">
                {h % 3 === 0 ? hour12(h).replace(' ', '') : ''}
              </div>
            ))}
            {data.days.map((day, d) => (
              <Row key={day} day={day} d={d} hours={data.hours} grid={grid} norm={norm} ramp={ramp}
                setHover={setHover} display={display} unitSuffix={unitSuffix} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-[20px] text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
          {hover ? (
            <>
              <span className="font-semibold">{hover.day} {hourRange12(hover.hour)}</span>: {display(hover.value)}
              {unitSuffix}
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">Hover or tap a cell for details</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{invert ? 'Fast' : 'Quiet'}</span>
          <div className="h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${ramp.join(',')})` }} aria-hidden />
          <span>{invert ? 'Slow' : 'Busy'}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ day, d, hours, grid, norm, ramp, setHover, display, unitSuffix }) {
  return (
    <>
      <div className="flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300">{day}</div>
      {hours.map((h) => {
        const cell = grid.get(`${d}-${h}`);
        if (!cell) return <div key={h} className="aspect-square rounded-[4px] bg-slate-100 dark:bg-slate-800" />;
        const t = norm(cell.value);
        return (
          <button
            key={h}
            type="button"
            className="aspect-square min-h-[18px] rounded-[4px] outline-none ring-offset-1 transition hover:scale-110 hover:ring-2 hover:ring-slate-900/40 focus-visible:ring-2 focus-visible:ring-brand-500 dark:ring-offset-slate-900 dark:hover:ring-white/60"
            style={{ background: rampColor(t, ramp) }}
            onMouseEnter={() => setHover(cell)}
            onFocus={() => setHover(cell)}
            onClick={() => setHover(cell)}
            onMouseLeave={() => setHover(null)}
            aria-label={`${day} ${hour12(h)}: ${display(cell.value)}${unitSuffix}`}
            title={`${day} ${hourRange12(h)}: ${display(cell.value)}${unitSuffix}`}
          />
        );
      })}
    </>
  );
}
