import { Link, Route, Routes } from 'react-router-dom';
import { ServerCrash } from 'lucide-react';
import { ConnectionBanner } from './components/ConnectionStatus';
import Navbar from './components/Navbar';
import { useApp } from './lib/AppContext';
import Dashboard from './pages/Dashboard';
import Predict from './pages/Predict';
import Insights from './pages/Insights';
import About from './pages/About';

function BackendBanner() {
  // Only for real failures; cold starts and offline mode are handled by ConnectionBanner.
  const { metaError, retryMeta, connection } = useApp();
  if (!metaError || connection.status === 'waking') return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert">
      <p className="flex items-center gap-2">
        <ServerCrash className="h-5 w-5 shrink-0" aria-hidden />
        {metaError.message}
      </p>
      <button type="button" className="btn-ghost shrink-0" onClick={retryMeta}>Retry</button>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card py-16 text-center">
      <p className="text-5xl font-extrabold text-brand-600">404</p>
      <p className="mt-2 text-slate-600 dark:text-slate-300">This road doesn't exist (yet).</p>
      <Link to="/" className="btn-primary mt-6">Back to the dashboard</Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <ConnectionBanner />
        <BackendBanner />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-300">TrafficSense</span> - Predict the jam before you're in it.
      </footer>
    </div>
  );
}
