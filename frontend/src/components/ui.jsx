import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { CONGESTION } from '../lib/chartTheme';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400 sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClassName = '' }) {
  return (
    <section className={`card animate-fade-in ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const ACCENTS = {
  teal: 'from-brand-500 to-brand-600 shadow-brand-500/30',
  blue: 'from-blue-500 to-blue-600 shadow-blue-500/30',
  sky: 'from-sky-400 to-sky-600 shadow-sky-500/30',
  indigo: 'from-indigo-500 to-violet-600 shadow-indigo-500/30',
};

export function StatCard({ icon: Icon, label, value, detail, accent = 'teal', loading }) {
  return (
    <div className="card flex items-start gap-4 animate-fade-in">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg ${ACCENTS[accent]}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {loading ? (
          <div className="mt-2 space-y-2">
            <div className="h-6 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-36 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
          </div>
        ) : (
          <>
            <p className="mt-1 truncate text-xl font-bold text-slate-900 dark:text-white sm:text-2xl" title={typeof value === 'string' ? value : undefined}>
              {value}
            </p>
            {detail && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{detail}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function CongestionBadge({ level, size = 'sm' }) {
  const style = CONGESTION[level] || CONGESTION.Low;
  const sizes = size === 'lg' ? 'px-3.5 py-1.5 text-base' : 'px-2.5 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${style.soft} ${sizes}`}>
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  );
}

export function Spinner({ label = 'Loading...', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400 ${className}`} role="status">
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function ChartSkeleton({ height = 300 }) {
  return <div className="w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" style={{ height }} aria-hidden />;
}

export function ErrorState({ error, onRetry, compact }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? 'py-6' : 'py-12'}`} role="alert">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <p className="font-semibold text-slate-900 dark:text-white">Something went wrong</p>
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{error?.message || String(error)}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((opt) => (
        <button key={opt.value} type="button" aria-pressed={value === opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ label, id, value, onChange, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <select id={id} className="input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")" }}
        value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

export function RoadSelect({ roads = [], value, onChange, includeAll = false, id = 'road', label = 'Road', className }) {
  return (
    <Select id={id} label={label} value={value} onChange={onChange} className={className}>
      {includeAll && <option value="all">All roads</option>}
      {roads.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </Select>
  );
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}
