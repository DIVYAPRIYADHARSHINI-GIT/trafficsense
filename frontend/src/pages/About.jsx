import { Link } from 'react-router-dom';
import { BarChart3, Brain, CalendarClock, CloudRain, Database, Gauge, Layers, Server, Upload } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { fmt, prettyDate } from '../lib/format';
import { Logo } from '../components/Navbar';
import { Card, PageHeader } from '../components/ui';

const FEATURES = [
  { icon: BarChart3, title: 'Dashboard', text: 'Average daily traffic, busiest road, peak hour, busiest day, a 6-month trend line and a peak-hours heatmap.' },
  { icon: Gauge, title: 'Predict', text: 'Choose a road, date, time and weather to get the expected vehicle count, congestion level and average speed.' },
  { icon: CalendarClock, title: 'Best time to travel', text: 'See every hour of a chosen day ranked so you can pick the lightest slot inside your own travel window.' },
  { icon: CloudRain, title: 'Insights', text: 'Weekday vs weekend vs holiday patterns, the measured effect of rain and clouds, and a road-by-road comparison.' },
  { icon: Brain, title: 'Model performance', text: 'MAE, RMSE and R\u00b2 on a held-out period, actual vs predicted charts, and feature importance.' },
  { icon: Upload, title: 'Bring your own data', text: 'Upload a CSV in the same format; it is stored in SQLite and the model retrains on it immediately.' },
];

const STACK = [
  { icon: Layers, title: 'Frontend', items: ['React 18 + React Router', 'Tailwind CSS (light & dark)', 'Recharts', 'Vite'] },
  { icon: Server, title: 'Backend', items: ['Python + FastAPI', 'Pandas', 'scikit-learn Random Forest', 'joblib model persistence'] },
  { icon: Database, title: 'Data', items: ['SQLite store', '6-month hourly sample', 'CSV upload & retrain', 'Statistical fallback model'] },
];

export default function About() {
  const { meta } = useApp();
  return (
    <>
      <PageHeader title="About TrafficSense" subtitle="Know the traffic before you leave so you can choose the best time to travel." />

      <section className="card relative overflow-hidden">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-brand-400/30 to-blue-500/30 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Logo className="h-16 w-16 shrink-0" />
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-brand-600 to-blue-600 bg-clip-text text-transparent dark:from-brand-300 dark:to-blue-400">TrafficSense</span>
            </h2>
            <p className="text-lg font-medium text-slate-700 dark:text-slate-200">Predict the jam before you're in it.</p>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              TrafficSense analyses the last six months of hourly traffic on your roads, learns how volume and speed depend on the hour,
              the day of the week, holidays and the weather, and forecasts future conditions so you can plan trips around the rush.
            </p>
            {meta && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Currently using {meta.source === 'upload' ? `your upload "${meta.filename}"` : 'the built-in sample dataset'}: {fmt(meta.rows)} records,{' '}
                {meta.roads.length} roads, {prettyDate(meta.start_date)} - {prettyDate(meta.end_date)}.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{text}</p>
          </div>
        ))}
      </div>

      <Card className="mt-6" title="How the prediction works">
        <ol className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <Step n={1} title="Learn from history">
            Every hourly record is turned into features: <b>hour of day</b>, <b>day of week</b>, <b>weekend</b> flag, <b>holiday</b> flag,
            <b> road</b> and <b>weather</b> (road and weather are one-hot encoded).
          </Step>
          <Step n={2} title="Train Random Forests">
            On startup and after each upload the backend trains three scikit-learn forests: a <b>RandomForestRegressor</b> for vehicle count,
            another for average speed, and a <b>RandomForestClassifier</b> for the Low / Medium / High congestion level. The models are saved with joblib.
          </Step>
          <Step n={3} title="Test honestly">
            Accuracy is measured on the most recent ~20% of days, which the evaluation model never sees, so the metrics reflect forecasting the future and
            not memorising the past. The served model is then refit on all data.
          </Step>
          <Step n={4} title="Fallback when ML is unavailable">
            If scikit-learn is missing or training fails, TrafficSense switches to a statistical model: the historical average for the same road, weekday,
            hour and weather, backing off to broader groups (and weather / day-type ratios) when a combination is rare.
          </Step>
          <Step n={5} title="Holidays & unknown weather">
            Future holidays are recognised automatically from the public-holiday calendar. If you don't know the weather, "Not sure" blends the three outcomes
            by how often each occurred in that month.
          </Step>
        </ol>
        <p className="mt-5 text-sm">
          <Link to="/insights#model" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">See the current model's accuracy &rarr;</Link>
        </p>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {STACK.map(({ icon: Icon, title, items }) => (
          <div key={title} className="card">
            <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {title}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
              {items.map((i) => <li key={i}>- {i}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
        The bundled data is synthetic and generated for demonstration. Upload real counts for real-world predictions.
      </p>
    </>
  );
}

function Step({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blue-600 text-xs font-bold text-white">{n}</span>
      <div>
        <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </li>
  );
}
