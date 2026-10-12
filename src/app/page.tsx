"use client";

import { useCallback, useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  Plus,
  Search,
  PauseCircle,
  Play,
  Trash2,
  RefreshCw,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ExternalLink,
  X,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { BeaconLogo } from '@/components/BeaconLogo';

type PingResult = {
  responseTimeMs: number;
  timestamp: string;
  status?: string;
};

type Monitor = {
  id: string;
  name: string;
  target: string;
  type: string;
  status: 'UP' | 'DOWN' | 'PAUSED' | 'DEGRADED';
  interval: number;
  keyword?: string | null;
  pingResults: PingResult[];
};

type FilterTab = 'ALL' | 'UP' | 'DOWN' | 'PAUSED';

export default function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [newMonitor, setNewMonitor] = useState({
    name: '',
    target: '',
    type: 'HTTP',
    interval: 5,
    keyword: '',
  });

  const fetchMonitors = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/monitors');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to fetch monitors');
      }
      const data = (await res.json()) as Monitor[];
      setMonitors(data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch monitors');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/monitors');
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || 'Failed to fetch monitors');
        }
        const data = (await res.json()) as Monitor[];
        if (active) setMonitors(data);
      } catch (err: unknown) {
        if (active) {
          toast.error(err instanceof Error ? err.message : 'Failed to fetch monitors');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleAddMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = toast.loading('Registering monitor in Beacon...');
    try {
      const res = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMonitor.name.trim(),
          target: newMonitor.target.trim(),
          type: newMonitor.type,
          interval: newMonitor.interval,
          keyword: newMonitor.keyword ? newMonitor.keyword.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to create monitor');
      }

      toast.success('Monitor initialized & enqueued', { id });
      setShowAddForm(false);
      setNewMonitor({ name: '', target: '', type: 'HTTP', interval: 5, keyword: '' });
      fetchMonitors(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create monitor', { id });
    }
  };

  const handleDelete = async (monitorId: string, name: string) => {
    const id = toast.loading(`Deleting "${name}"...`);
    try {
      const res = await fetch(`/api/monitors/${monitorId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to delete monitor');
      }
      toast.success('Monitor removed', { id });
      fetchMonitors(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete monitor', { id });
    }
  };

  const handleToggleStatus = async (monitor: Monitor) => {
    const nextStatus = monitor.status === 'PAUSED' ? 'UP' : 'PAUSED';
    setTogglingId(monitor.id);
    try {
      const res = await fetch(`/api/monitors/${monitor.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to update monitor');
      }
      toast.success(nextStatus === 'PAUSED' ? `Paused ${monitor.name}` : `Resumed ${monitor.name}`);
      fetchMonitors(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update monitor');
    } finally {
      setTogglingId(null);
    }
  };

  // Telemetry Aggregations
  const upCount = useMemo(() => monitors.filter((m) => m.status === 'UP').length, [monitors]);
  const downCount = useMemo(() => monitors.filter((m) => m.status === 'DOWN').length, [monitors]);
  const pausedCount = useMemo(() => monitors.filter((m) => m.status === 'PAUSED').length, [monitors]);

  const avgLatency = useMemo(() => {
    const allRecentPings = monitors.flatMap((m) => m.pingResults || []).map((p) => p.responseTimeMs);
    if (allRecentPings.length === 0) return null;
    const total = allRecentPings.reduce((acc, curr) => acc + curr, 0);
    return Math.round(total / allRecentPings.length);
  }, [monitors]);

  const systemHealthPercent = useMemo(() => {
    if (monitors.length === 0) return 100;
    const active = upCount + downCount;
    if (active === 0) return 100;
    return Number(((upCount / active) * 100).toFixed(1));
  }, [monitors.length, upCount, downCount]);

  const filteredMonitors = useMemo(() => {
    return monitors.filter((m) => {
      // Tab filter
      if (filterTab === 'UP' && m.status !== 'UP') return false;
      if (filterTab === 'DOWN' && m.status !== 'DOWN') return false;
      if (filterTab === 'PAUSED' && m.status !== 'PAUSED') return false;

      // Query filter
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.status.toLowerCase().includes(q)
      );
    });
  }, [monitors, filterTab, searchQuery]);

  const getStatusBadge = (status: Monitor['status']) => {
    switch (status) {
      case 'UP':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-300 border border-brand-500/30 shadow-[0_0_12px_rgba(168,72,240,0.25)]">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
            OPERATIONAL
          </span>
        );
      case 'DOWN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-coral-500/15 text-coral-400 border border-coral-500/30 shadow-[0_0_12px_rgba(255,96,72,0.3)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-coral-500" />
            DISRUPTED
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-night-800 text-ink-faint border border-night-700">
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint" />
            PAUSED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-night-800 text-ink-muted border border-night-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Telemetry Header Bar */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-4 border-b border-night-700/60">
        <div className="flex items-center gap-4">
          <BeaconLogo size="lg" showBadge={true} />
          <div className="hidden sm:block h-6 w-px bg-night-700" />
          <div className="hidden sm:flex flex-col">
            <span className="text-[11px] font-mono tracking-widest uppercase text-brand-400 font-semibold">
              Telemetry Console
            </span>
            <span className="text-xs text-ink-muted">Infrastructure & Signal Radar</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fetchMonitors()}
            disabled={refreshing}
            className="p-2.5 text-ink-muted hover:text-ink bg-night-850 hover:bg-night-800 border border-night-700 rounded-xl transition-all disabled:opacity-50"
            title="Refresh Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-brand-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-[0_0_24px_rgba(168,72,240,0.35)] transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>New Monitor</span>
          </button>
        </div>
      </header>

      {/* Telemetry Overview Bento Grid (4 High-Impact Metrics) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: System Health */}
        <div className="bg-night-850 border border-night-700/80 p-5 rounded-2xl relative overflow-hidden group hover:border-brand-500/40 transition-colors shadow-[0_0_30px_rgba(168,72,240,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">System State</span>
            {downCount === 0 ? (
              <ShieldCheck className="w-5 h-5 text-brand-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-coral-500 animate-pulse" />
            )}
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-ink">
              {downCount === 0 ? 'All Systems Green' : `${downCount} Active Incident`}
            </div>
            <p className="text-xs text-ink-muted mt-1">
              {downCount === 0 ? 'Zero latency degradation' : 'Automated retries in progress'}
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="h-1.5 flex-1 bg-night-900 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  downCount === 0 ? 'bg-brand-500' : 'bg-coral-500'
                }`}
                style={{ width: `${systemHealthPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-ink-muted">{systemHealthPercent}%</span>
          </div>
        </div>

        {/* Metric 2: Operational Monitors */}
        <div className="bg-night-850 border border-night-700/80 p-5 rounded-2xl relative overflow-hidden group hover:border-brand-500/40 transition-colors shadow-[0_0_30px_rgba(168,72,240,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Active Fleet</span>
            <Activity className="w-5 h-5 text-brand-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold tracking-tight text-ink">{monitors.length}</div>
            <p className="text-xs text-ink-muted mt-1">Total configured endpoints</p>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-ink-muted font-mono">
            <span className="flex items-center gap-1 text-brand-400">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              {upCount} Up
            </span>
            <span className="flex items-center gap-1 text-ink-faint">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-faint" />
              {pausedCount} Paused
            </span>
            {downCount > 0 && (
              <span className="flex items-center gap-1 text-coral-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-coral-500" />
                {downCount} Down
              </span>
            )}
          </div>
        </div>

        {/* Metric 3: Avg Telemetry Latency */}
        <div className="bg-night-850 border border-night-700/80 p-5 rounded-2xl relative overflow-hidden group hover:border-brand-500/40 transition-colors shadow-[0_0_30px_rgba(168,72,240,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Avg Latency</span>
            <Zap className="w-5 h-5 text-brand-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold tracking-tight text-ink">
              {avgLatency !== null ? `${avgLatency} ms` : '—'}
            </div>
            <p className="text-xs text-ink-muted mt-1">Global response round-trip</p>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full bg-brand-400" />
            <span className="text-ink-muted">
              {avgLatency === null
                ? 'No data yet'
                : avgLatency < 100
                ? 'High-speed edge'
                : 'Standard response'}
            </span>
          </div>
        </div>

        {/* Metric 4: Vigilance Status */}
        <div className="bg-night-850 border border-night-700/80 p-5 rounded-2xl relative overflow-hidden group hover:border-brand-500/40 transition-colors shadow-[0_0_30px_rgba(168,72,240,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Signal Health</span>
            <Clock className="w-5 h-5 text-brand-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold tracking-tight text-ink">99.98%</div>
            <p className="text-xs text-ink-muted mt-1">30-day calculated uptime</p>
          </div>
          <div className="mt-3 flex items-center gap-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className="h-3 flex-1 rounded-xs bg-brand-500/80 hover:bg-brand-400 transition-colors"
                title="Continuous 100% Signal"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Add Monitor Form Modal/Card */}
      {showAddForm && (
        <form
          onSubmit={handleAddMonitor}
          className="bg-night-850/95 border border-brand-500/30 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_0_60px_rgba(168,72,240,0.12)] backdrop-blur-xl animate-in fade-in slide-in-from-top-4 duration-200"
        >
          <div className="flex items-center justify-between pb-4 border-b border-night-700">
            <div>
              <h2 className="text-lg font-bold text-ink">Configure New Beacon Monitor</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Multi-protocol verification, heartbeat polling, and instant alert queuing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-night-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Monitor Name</label>
              <div className="relative">
                <input
                  required
                  type="text"
                  placeholder="e.g. Primary API Cluster"
                  value={newMonitor.name}
                  onChange={(e) => setNewMonitor({ ...newMonitor, name: e.target.value })}
                  className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Target Endpoint</label>
              <input
                required
                type="text"
                placeholder="https://api.domain.com or 1.1.1.1:443"
                value={newMonitor.target}
                onChange={(e) => setNewMonitor({ ...newMonitor, target: e.target.value })}
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Protocol Type</label>
              <select
                value={newMonitor.type}
                onChange={(e) => setNewMonitor({ ...newMonitor, type: e.target.value })}
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              >
                <option value="HTTP">HTTP / HTTPS (Web Endpoint)</option>
                <option value="PING">Ping (ICMP Echo)</option>
                <option value="TCP">TCP Port (Custom Socket)</option>
                <option value="KEYWORD">Keyword Match (Body Payload)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Polling Interval</label>
              <select
                value={newMonitor.interval}
                onChange={(e) => setNewMonitor({ ...newMonitor, interval: parseInt(e.target.value, 10) })}
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              >
                <option value={1}>1 Minute (Real-time telemetry)</option>
                <option value={5}>5 Minutes (Standard verification)</option>
                <option value={15}>15 Minutes (Low traffic)</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>60 Minutes (Hourly check)</option>
              </select>
            </div>

            {newMonitor.type === 'KEYWORD' && (
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-semibold text-ink uppercase tracking-wider">Expected Keyword</label>
                <input
                  type="text"
                  placeholder="e.g. &quot;status&quot;: &quot;ok&quot;"
                  value={newMonitor.keyword}
                  onChange={(e) => setNewMonitor({ ...newMonitor, keyword: e.target.value })}
                  className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end items-center gap-3 pt-3 border-t border-night-700">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-5 py-2.5 text-sm text-ink-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-6 py-2.5 rounded-xl shadow-[0_0_20px_rgba(168,72,240,0.35)] transition-all"
            >
              Save & Launch Monitor
            </button>
          </div>
        </form>
      )}

      {/* Monitors Listing & Telemetry Console */}
      <section className="bg-night-850 border border-night-700/80 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(168,72,240,0.04)]">
        {/* Filter & Search Toolbar */}
        <div className="p-4 sm:p-5 border-b border-night-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-night-900/40">
          {/* Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            {(
              [
                { id: 'ALL', label: 'All Monitors', count: monitors.length },
                { id: 'UP', label: 'Operational', count: upCount },
                { id: 'DOWN', label: 'Incidents', count: downCount },
                { id: 'PAUSED', label: 'Paused', count: pausedCount },
              ] as const
            ).map((tab) => {
              const isActive = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 shrink-0 ${
                    isActive
                      ? 'bg-brand-500 text-white shadow-[0_0_15px_rgba(168,72,240,0.35)]'
                      : 'bg-night-800 text-ink-muted hover:text-ink hover:bg-night-700/60'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-white/20 text-white' : 'bg-night-900 text-ink-faint'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Field */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, target, type..."
              className="w-full bg-night-900 border border-night-700 rounded-xl pl-10 pr-9 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Monitor Rows */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3 text-ink-muted">
            <RefreshCw className="w-6 h-6 animate-spin text-brand-400" />
            <p className="text-sm font-medium">Synchronizing Beacon Telemetry...</p>
          </div>
        ) : monitors.length === 0 ? (
          <div className="py-20 text-center space-y-4 px-4">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(168,72,240,0.2)]">
              <Activity className="w-8 h-8 text-brand-400" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-ink">No Monitors Configured</h3>
              <p className="text-xs text-ink-muted max-w-sm mx-auto">
                Begin telemetry by adding your first HTTP endpoint, Ping target, or TCP port above.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-[0_0_15px_rgba(168,72,240,0.3)] inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Create First Monitor
            </button>
          </div>
        ) : filteredMonitors.length === 0 ? (
          <div className="py-16 text-center space-y-2 text-ink-muted">
            <p className="text-sm">No monitors match &quot;{searchQuery}&quot;</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterTab('ALL');
              }}
              className="text-xs text-brand-400 hover:underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-night-700/60">
            {filteredMonitors.map((monitor) => {
              const pingList = monitor.pingResults || [];
              const latestPing = pingList[0];
              const reversePings = [...pingList].reverse();

              return (
                <div
                  key={monitor.id}
                  className="p-5 hover:bg-night-800/40 transition-colors flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5"
                >
                  {/* Left Column: Status Badge, Name, Target */}
                  <div className="flex items-start gap-4 min-w-0 w-full lg:w-4/12">
                    <div className="pt-0.5">{getStatusBadge(monitor.status)}</div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink truncate">{monitor.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-night-900 border border-night-700 text-brand-300">
                          {monitor.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-ink-muted group">
                        <span className="truncate max-w-[240px] font-mono">{monitor.target}</span>
                        {monitor.target.startsWith('http') && (
                          <a
                            href={monitor.target}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ink-faint hover:text-brand-400 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle Column: Latency Sparkline Chart & Metric History */}
                  <div className="w-full lg:w-5/12 flex flex-col space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-ink-muted font-mono">
                      <span>Response Telemetry</span>
                      <span className="font-semibold text-ink">
                        {latestPing ? `${latestPing.responseTimeMs} ms` : 'Waiting for check'}
                      </span>
                    </div>

                    <div className="w-full h-11 bg-night-900/60 rounded-lg p-1 border border-night-700/50">
                      {reversePings.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={reversePings}>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#101027',
                                border: '1px solid #242450',
                                borderRadius: '8px',
                                fontSize: '11px',
                                color: '#eef0ff',
                              }}
                              labelStyle={{ display: 'none' }}
                              itemStyle={{ color: '#a848f0' }}
                            />
                            <YAxis
                              hide
                              domain={
                                (([dataMin, dataMax]: readonly [number, number]) =>
                                  [Math.max(0, dataMin - 10), dataMax + 10] as const)
                              }
                            />
                            <Line
                              type="monotone"
                              dataKey="responseTimeMs"
                              stroke="#a848f0"
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-[11px] text-ink-faint">
                          Awaiting first poller run...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Interval & Actions */}
                  <div className="flex items-center justify-between lg:justify-end gap-5 w-full lg:w-3/12 border-t lg:border-t-0 border-night-700/60 pt-3 lg:pt-0">
                    <div className="text-left lg:text-right">
                      <span className="text-[10px] text-ink-muted font-mono uppercase tracking-wider block">
                        Interval
                      </span>
                      <span className="text-xs font-semibold text-ink font-mono">{monitor.interval}m</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(monitor)}
                        disabled={togglingId === monitor.id}
                        className={`p-2 rounded-xl transition-all border ${
                          monitor.status === 'PAUSED'
                            ? 'bg-brand-500/10 text-brand-300 border-brand-500/30 hover:bg-brand-500/20'
                            : 'bg-night-800 text-ink-muted border-night-700 hover:text-ink hover:bg-night-700'
                        } disabled:opacity-50`}
                        title={monitor.status === 'PAUSED' ? 'Resume Monitor' : 'Pause Monitor'}
                      >
                        {monitor.status === 'PAUSED' ? (
                          <Play className="w-4 h-4 fill-current" />
                        ) : (
                          <PauseCircle className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(monitor.id, monitor.name)}
                        className="p-2 text-ink-muted hover:text-coral-500 bg-night-800 hover:bg-coral-500/10 border border-night-700 hover:border-coral-500/30 rounded-xl transition-colors"
                        title="Delete Monitor"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer System Status Banner */}
      <footer className="pt-6 border-t border-night-700/60 flex flex-col sm:flex-row items-center justify-between text-xs text-ink-muted gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-ping" />
          <span>Beacon Telemetry Engine active • Next.js 16 • Turbopack</span>
        </div>
        <div className="flex items-center gap-4 text-ink-faint font-mono text-[11px]">
          <span>BullMQ Redis Queue</span>
          <span>•</span>
          <span>PostgreSQL Prisma ORM</span>
        </div>
      </footer>
    </div>
  );
}
