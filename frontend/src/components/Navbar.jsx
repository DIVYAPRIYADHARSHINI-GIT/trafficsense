import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Gauge, Info, Menu, Moon, Navigation, Sun, X } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { OfflineBadge } from './ConnectionStatus';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/predict', label: 'Predict', icon: Gauge },
  { to: '/insights', label: 'Insights', icon: Navigation },
  { to: '/about', label: 'About', icon: Info },
];

export function Logo({ className = 'h-9 w-9' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="ts-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#ts-logo)" />
      <path d="M10 42 L22 42 L28 22 L36 48 L42 32 L54 32" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeToggle() {
  const { isDark, toggleTheme } = useApp();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

const linkClass = ({ isActive }) =>
  `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-950/80">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8" aria-label="Main">
        <NavLink to="/" className="flex min-w-0 items-center gap-3" aria-label="TrafficSense home">
          <Logo />
          <div className="min-w-0 leading-tight">
            <p className="bg-gradient-to-r from-brand-600 to-blue-600 bg-clip-text text-lg font-extrabold tracking-tight text-transparent dark:from-brand-300 dark:to-blue-400">
              TrafficSense
            </p>
            <p className="hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">Predict the jam before you're in it.</p>
          </div>
        </NavLink>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <OfflineBadge />
          <ThemeToggle />
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 md:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-nav" className="border-t border-slate-200 bg-white px-4 py-3 md:hidden dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-1">
            {LINKS.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={linkClass}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
