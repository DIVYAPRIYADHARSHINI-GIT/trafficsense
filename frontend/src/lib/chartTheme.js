import { useApp } from './AppContext';

// Brand palette for series (blue / teal first, then accessible complements).
export const SERIES = ['#0d9488', '#2563eb', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b'];

export const CONGESTION = {
  Low: { color: '#16a34a', soft: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30', label: 'Low', dot: 'bg-emerald-500' },
  Medium: { color: '#eab308', soft: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30', label: 'Medium', dot: 'bg-amber-400' },
  High: { color: '#dc2626', soft: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30', label: 'High', dot: 'bg-red-500' },
};

export const WEATHER_COLORS = { sunny: '#f59e0b', cloudy: '#64748b', rainy: '#2563eb' };
export const DAYTYPE_COLORS = { weekday: '#2563eb', weekend: '#0d9488', holiday: '#f59e0b' };

export function useChartTheme() {
  const { isDark } = useApp();
  return {
    isDark,
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    tooltip: {
      contentStyle: {
        background: isDark ? '#0f172a' : '#ffffff',
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 12,
        boxShadow: '0 10px 30px -12px rgba(15,23,42,.35)',
        color: isDark ? '#e2e8f0' : '#0f172a',
        fontSize: 13,
      },
      labelStyle: { color: isDark ? '#f8fafc' : '#0f172a', fontWeight: 600, marginBottom: 4 },
      itemStyle: { padding: 0 },
      cursor: { stroke: isDark ? '#475569' : '#cbd5e1', strokeWidth: 1, fill: isDark ? 'rgba(148,163,184,.08)' : 'rgba(100,116,139,.08)' },
    },
  };
}
