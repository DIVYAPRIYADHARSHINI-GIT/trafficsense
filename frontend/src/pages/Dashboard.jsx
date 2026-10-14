import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Car, Clock, Route } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../lib/AppContext';
import { useApi } from '../lib/useApi';
import { fmt, fmtPct, hourRange12, prettyDate } from '../lib/format';
import { CONGESTION } from '../lib/chartTheme';
import DataUpload from '../components/DataUpload';
import Heatmap from '../components/Heatmap';
import TrendChart from '../components/TrendChart';
import { Card, ChartSkeleton, ErrorState, PageHeader, RoadSelect, Segmented, StatCard } from '../components/ui';

export default function Dashboard() {
  const { meta } = useApp();
  const summary = useApi(() => api.summary(), []);
  const [granularity, setGranularity] = useState('daily');
  const [trendRoad, setTrendRoad] = useState('all');
  const trends = useApi(() => api.trends(granularity, trendRoad === 'all' ? undefined : trendRoad), [granularity, trendRoad]);
  const [heatRoad, setHeatRoad] = useState('all');
  const [heatMetric, setHeatMetric] = useState('vehicle_count');
  const heatmap = useApi(() => api.heatmap(heatRoad === 'all' ? undefined : heatRoad, heatMetric), [heatRoad, heatMetric]);

  const s = summary.data;
  const roads = meta?.roads || [];

  return (
    <>
      <PageHeader
        title="Traffic dashboard"
        subtitle={
          s
            ? `${fmt(s.dataset.rows)} hourly records across ${s.dataset.roads.length} roads, ${prettyDate(s.dataset.start_date)} to ${prettyDate(s.dataset.end_date)}.`
            : 'Six months of hourly traffic at a glance.'
        }
        actions={
          <Link to="/predict" className="btn-primary">
            Plan a trip <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      {summary.error ? (
        <Card><ErrorState error={summary.error} onRetry={summary.reload} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Car} accent="teal" label="Avg daily traffic" loading={!s}
            value={s && `${fmt(s.avg_daily_traffic)}`}
            detail={s && `vehicles/day across all roads - avg ${s.avg_speed} km/h`} />
          <StatCard icon={Route} accent="blue" label="Busiest road" loading={!s}
            value={s?.busiest_road.name}
            detail={s && `${fmt(s.busiest_road.avg_daily_vehicles)} vehicles/day (${s.busiest_road.share_pct}% of all)`} />
          <StatCard icon={Clock} accent="sky" label="Peak hour" loading={!s}
            value={s && hourRange12(s.peak_hour.hour)}
            detail={s && `${fmt(s.peak_hour.avg_vehicles)} vehicles/h - quietest daytime ${hourRange12(s.quietest_daytime_hour.hour)}`} />
          <StatCard icon={CalendarDays} accent="indigo" label="Busiest day" loading={!s}
            value={s?.busiest_day.day}
            detail={s && `${fmt(s.busiest_day.avg_daily_vehicles)} vehicles/day (${fmtPct(s.busiest_day.vs_average_pct, 0, true)} vs avg)`} />
        </div>
      )}

      {s && (
        <div className="mt-4 card flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Share of road-hours by congestion level</p>
          <div className="flex flex-1 items-center gap-3 sm:max-w-xl">
            <div className="flex h-3 flex-1 overflow-hidden rounded-full" role="img"
              aria-label={`Low ${s.congestion_share.Low}%, Medium ${s.congestion_share.Medium}%, High ${s.congestion_share.High}%`}>
              {['Low', 'Medium', 'High'].map((lvl) => (
                <div key={lvl} style={{ width: `${s.congestion_share[lvl]}%`, background: CONGESTION[lvl].color }} />
              ))}
            </div>
            <div className="flex shrink-0 gap-3 text-xs text-slate-600 dark:text-slate-300">
              {['Low', 'Medium', 'High'].map((lvl) => (
                <span key={lvl} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${CONGESTION[lvl].dot}`} />{lvl} {Math.round(s.congestion_share[lvl])}%
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card
        className="mt-6"
        title="Traffic trend over 6 months"
        subtitle="Total vehicles counted per day. Dips are weekends; spikes are holidays and rainy days."
        actions={
          <>
            <RoadSelect id="trend-road" label="" roads={roads} value={trendRoad} onChange={setTrendRoad} includeAll className="w-44" />
            <Segmented label="Granularity" value={granularity} onChange={setGranularity}
              options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
          </>
        }
      >
        {trends.error ? (
          <ErrorState error={trends.error} onRetry={trends.reload} compact />
        ) : trends.data ? (
          <TrendChart data={trends.data} granularity={granularity} />
        ) : (
          <ChartSkeleton height={360} />
        )}
      </Card>

      <Card
        className="mt-6"
        title="Peak hours heatmap"
        subtitle="Average traffic for every hour of the week (public holidays excluded). Darker = busier."
        actions={
          <>
            <RoadSelect id="heat-road" label="" roads={roads} value={heatRoad} onChange={setHeatRoad} includeAll className="w-44" />
            <Segmented label="Heatmap metric" value={heatMetric} onChange={setHeatMetric}
              options={[
                { value: 'vehicle_count', label: 'Volume' },
                { value: 'average_speed', label: 'Speed' },
                { value: 'high_congestion', label: '% High' },
              ]} />
          </>
        }
      >
        {heatmap.error ? (
          <ErrorState error={heatmap.error} onRetry={heatmap.reload} compact />
        ) : heatmap.data ? (
          <>
            <Heatmap data={heatmap.data} metric={heatMetric} />
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {heatMetric === 'average_speed' ? 'Slowest slots:' : 'Worst slots:'}
              </span>
              {heatmap.data.worst_slots.map((slot) => (
                <span key={slot.label} className="chip bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                  {slot.day.slice(0, 3)} {hourRange12(slot.hour)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <ChartSkeleton height={260} />
        )}
      </Card>

      <div className="mt-6">
        <DataUpload />
      </div>
    </>
  );
}
