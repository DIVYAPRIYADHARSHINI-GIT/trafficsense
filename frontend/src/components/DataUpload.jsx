import { useRef, useState } from 'react';
import { CheckCircle2, Database, Download, FileUp, Loader2, RotateCcw, UploadCloud } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../lib/AppContext';
import { fmt, prettyDate } from '../lib/format';
import { Card, Segmented } from './ui';

const COLUMNS = ['date', 'time', 'day_of_week', 'road_name', 'vehicle_count', 'average_speed', 'weather', 'is_holiday', 'congestion_level'];

// Upload a CSV in the TrafficSense format -> POST /api/upload stores it in SQLite and
// retrains the model; every page then refetches via the dataVersion bump.
export default function DataUpload() {
  const { meta, notifyDataChanged, isOffline } = useApp();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('replace');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const pick = (f) => {
    setResult(null);
    setError(null);
    if (f && !/\.(csv|txt)$/i.test(f.name)) {
      setError('Please choose a .csv file.');
      return;
    }
    setFile(f || null);
  };

  const run = async (action) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = action === 'reset' ? await api.reset() : await api.upload(file, mode);
      setResult(res);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      notifyDataChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Data source"
      subtitle="Analyse your own traffic counts: upload a CSV in the same format and the model retrains automatically. On the free hosted server, uploads are temporary and reset when it restarts or sleeps."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-2">
          <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/50">
            <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
              <Database className="h-4 w-4 text-brand-600" aria-hidden /> Active dataset
            </div>
            {isOffline && (
              <p className="mt-2 rounded-lg bg-amber-100/70 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                Offline mode: showing the bundled sample. Downloads and uploads need the live server.
              </p>
            )}
            {meta ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-slate-600 dark:text-slate-300">
                <dt className="text-slate-500 dark:text-slate-400">Source</dt>
                <dd className="truncate font-medium" title={meta.filename || ''}>
                  {meta.source === 'upload' ? `Upload: ${meta.filename}` : 'Built-in 6-month sample'}
                </dd>
                <dt className="text-slate-500 dark:text-slate-400">Records</dt>
                <dd className="font-medium">{fmt(meta.rows)} hourly rows</dd>
                <dt className="text-slate-500 dark:text-slate-400">Coverage</dt>
                <dd className="font-medium">{prettyDate(meta.start_date, { month: 'short', day: 'numeric', year: 'numeric' })} - {prettyDate(meta.end_date, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Roads</dt>
                <dd className="font-medium">{meta.roads.length}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Model</dt>
                <dd className="font-medium">{meta.model_type === 'random_forest' ? 'Random Forest' : 'Statistical fallback'}</dd>
              </dl>
            ) : (
              <p className="mt-3 text-slate-500">Loading...</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn-ghost px-3 py-2 text-xs" href={api.templateUrl()} download>
                <Download className="h-3.5 w-3.5" aria-hidden /> CSV template
              </a>
              <a className="btn-ghost px-3 py-2 text-xs" href={api.datasetUrl()} download>
                <Download className="h-3.5 w-3.5" aria-hidden /> Current data
              </a>
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-3">
          <label
            htmlFor="csv-upload"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
              dragging ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40'
            }`}
          >
            <UploadCloud className="h-8 w-8 text-brand-600" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {file ? file.name : 'Drop a CSV here or click to browse'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {file ? `${(file.size / 1024).toFixed(0)} KB ready to upload` : 'Hourly rows, up to 50 MB'}
            </p>
            <input id="csv-upload" ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>

          <div className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5">Columns:</span>
              {COLUMNS.map((c) => (
                <code key={c} className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">{c}</code>
              ))}
            </div>
            <p className="mt-1.5">
              weather = sunny / cloudy / rainy - congestion_level = Low / Medium / High - is_holiday = 0 / 1. day_of_week is recomputed from date.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Segmented label="Upload mode" value={mode} onChange={setMode}
              options={[{ value: 'replace', label: 'Replace data' }, { value: 'append', label: 'Append data' }]} />
            <button type="button" className="btn-primary" disabled={!file || busy || isOffline} onClick={() => run('upload')}
              title={isOffline ? 'Uploading needs the live server' : undefined}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
              {busy ? 'Training model...' : 'Upload & retrain'}
            </button>
            {meta?.source === 'upload' && (
              <button type="button" className="btn-ghost" disabled={busy || isOffline} onClick={() => run('reset')}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Restore sample
              </button>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {result.message}
              </p>
              {result.report && (
                <p className="mt-1 text-xs">
                  {fmt(result.report.rows_received)} rows received - {fmt(result.report.rows_rejected)} rejected
                  {result.report.duplicates_removed ? ` - ${fmt(result.report.duplicates_removed)} duplicates removed` : ''}
                  {Object.keys(result.report.rejection_reasons || {}).length > 0 &&
                    ` (${Object.entries(result.report.rejection_reasons).map(([k, v]) => `${k}: ${v}`).join(', ')})`}
                  {result.metrics && ` - new R\u00b2 ${result.metrics.model.vehicle_count.r2.toFixed(3)}`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
