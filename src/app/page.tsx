"use client";

import { useCallback, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Activity,
  Plus,
  Search,
  PauseCircle,
  Play,
  Trash2,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ExternalLink,
  X,
  LogOut,
  Building,
  HeartPulse,
  Zap,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { BeaconLogo } from '@/components/BeaconLogo';

type PingResult = {
  responseTimeMs: number;
  timestamp: string;
  status?: 'UP' | 'DOWN';
  errorMessage?: string | null;
};

type Monitor = {
  id: string;
  orgId: string;
  name: string;
  target: string;
  type: 'HTTP' | 'PING' | 'TCP' | 'KEYWORD' | 'HEARTBEAT';
  status: 'UP' | 'DOWN' | 'PAUSED' | 'DEGRADED';
  interval: number;
  timeoutMs: number;
  keyword?: string | null;
  lastHeartbeatAt?: string | null;
  pingResults: PingResult[];
};

type UserOrg = {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string } | null;
};

type FilterTab = 'ALL' | 'UP' | 'DOWN' | 'PAUSED';

export default function Dashboard() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [userOrg, setUserOrg] = useState<UserOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [newMonitor, setNewMonitor] = useState({
    name: '',
    target: '',
    type: 'HTTP' as Monitor['type'],
    interval: 5,
    timeoutMs: 30000,
    keyword: '',
  });

  // Centralized fetch with global 401 handling
  const fetchMonitors = useCallback(async () => {
    try {
      const res = await fetch('/api/monitors');
      if (res.status === 401) {
        toast.error('Session expired. Please sign in.');
        router.push('/login');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to fetch monitors');
      }
      const data = (await res.json()) as Monitor[];
      setMonitors(data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  // BUG-014: Single unified mount effect (no duplicate fetch logic)
  // BUG-017: Background polling every 25s with document.hidden guard and cleanup
  useEffect(() => {
    let active = true;

    fetch('/api/monitors')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        if (!res.ok) throw new Error('Failed to fetch monitors');
        return res.json();
      })
      .then((data: Monitor[] | null) => {
        if (active && data) {
          setMonitors(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          toast.error(err instanceof Error ? err.message : 'Failed to fetch telemetry');
          setLoading(false);
        }
      });

    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UserOrg | null) => {
        if (active && data) setUserOrg(data);
      })
      .catch(() => {});

    const intervalId = setInterval(() => {
      if (!document.hidden && active) {
        void fetchMonitors();
      }
    }, 25000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [fetchMonitors, router]);

  const handleSignOut = async () => {
    const id = toast.loading('Terminating session...');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      toast.success('Logged out successfully', { id });
      router.push('/login');
    } catch {
      toast.error('Sign out failed', { id });
    }
  };

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
          interval: Number(newMonitor.interval),
          timeoutMs: Number(newMonitor.timeoutMs),
          keyword: newMonitor.type === 'KEYWORD' ? newMonitor.keyword.trim() : undefined,
        }),
      });

      if (res.status === 401) {
        toast.error('Session expired', { id });
        router.push('/login');
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to create monitor');
      }

      toast.success('Monitor initialized & enqueued', { id });
      setShowAddForm(false);
      setNewMonitor({
        name: '',
        target: '',
        type: 'HTTP',
        interval: 5,
        timeoutMs: 30000,
        keyword: '',
      });
      void fetchMonitors();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create monitor', { id });
    }
  };

  // BUG-015: Delete confirmation execution
  const executeDelete = async (monitorId: string, name: string) => {
    const id = toast.loading(`Deleting "${name}"...`);
    try {
      const res = await fetch(`/api/monitors/${monitorId}`, { method: 'DELETE' });
      if (res.status === 401) {
        toast.error('Session expired', { id });
        router.push('/login');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to delete monitor');
      }
      toast.success('Monitor removed', { id });
      setConfirmDelete(null);
      void fetchMonitors();
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
      if (res.status === 401) {
        toast.error('Session expired');
        router.push('/login');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to update monitor');
      }
      toast.success(nextStatus === 'PAUSED' ? `Paused ${monitor.name}` : `Resumed ${monitor.name}`);
      void fetchMonitors();
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

  // BUG-016: Real calculated uptime percentage and bar status from actual PingResults
  const calculatedUptime = useMemo(() => {
    const allPings = monitors.flatMap((m) => m.pingResults || []);
    if (allPings.length === 0) {
      return { percentage: '100.0%', isAvailable: false, bars: Array(18).fill('NEUTRAL') };
    }
    const upPings = allPings.filter((p) => p.status === 'UP').length;
    const percent = ((upPings / allPings.length) * 100).toFixed(2);

    // Group recent pings into 18 segments
    const bars: ('UP' | 'DOWN' | 'NEUTRAL')[] = [];
    const segmentSize = Math.max(1, Math.floor(allPings.length / 18));
    for (let i = 0; i < 18; i++) {
      const slice = allPings.slice(i * segmentSize, (i + 1) * segmentSize);
      if (slice.length === 0) {
        bars.push('NEUTRAL');
      } else {
        const hasDown = slice.some((p) => p.status === 'DOWN');
        bars.push(hasDown ? 'DOWN' : 'UP');
      }
    }

    return { percentage: `${percent}%`, isAvailable: true, bars };
  }, [monitors]);

  const filteredMonitors = useMemo(() => {
    return monitors.filter((m) => {
      if (filterTab === 'UP' && m.status !== 'UP') return false;
      if (filterTab === 'DOWN' && m.status !== 'DOWN') return false;
      if (filterTab === 'PAUSED' && m.status !== 'PAUSED') return false;

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

        {/* Tenant Scope & Action Controls */}
        <div className="flex items-center flex-wrap gap-3">
          {userOrg?.organization && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-night-850 border border-night-700 text-xs text-ink-muted font-mono">
              <Building className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-ink font-semibold">{userOrg.organization.name}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              void fetchMonitors();
            }}
            disabled={refreshing}
            className="p-2.5 text-ink-muted hover:text-ink bg-night-850 hover:bg-night-800 border border-night-700 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
            title="Refresh Telemetry"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-brand-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-linear-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-[0_0_24px_rgba(168,72,240,0.35)] transition-all active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Monitor</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="p-2.5 text-ink-muted hover:text-coral-400 bg-night-850 hover:bg-night-800 border border-night-700 rounded-xl transition-all cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
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
            <div className="text-3xl font-extrabold tracking-tight text-ink font-mono">
              {avgLatency !== null ? `${avgLatency} ms` : '—'}
            </div>
            <p className="text-xs text-ink-muted mt-1">Live telemetry roundtrip</p>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono">
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

        {/* Metric 4: Real Calculated Telemetry Signal Health (BUG-016 Fixed) */}
        <div className="bg-night-850 border border-night-700/80 p-5 rounded-2xl relative overflow-hidden group hover:border-brand-500/40 transition-colors shadow-[0_0_30px_rgba(168,72,240,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Signal Health</span>
            <Clock className="w-5 h-5 text-brand-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold tracking-tight text-ink">
              {calculatedUptime.percentage}
            </div>
            <p className="text-xs text-ink-muted mt-1">
              {calculatedUptime.isAvailable ? 'Measured probe uptime' : 'Calibrating fleet telemetry'}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-1">
            {calculatedUptime.bars.map((barStatus, i) => (
              <span
                key={i}
                className={`h-3 flex-1 rounded-xs transition-colors ${
                  barStatus === 'UP'
                    ? 'bg-brand-500/80 hover:bg-brand-400'
                    : barStatus === 'DOWN'
                    ? 'bg-coral-500 hover:bg-coral-400'
                    : 'bg-night-800'
                }`}
                title={barStatus === 'UP' ? '100% Signal UP' : barStatus === 'DOWN' ? 'Disruption recorded' : 'Awaiting data'}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Delete Confirmation Modal (BUG-015 Fixed) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-night-850 border border-coral-500/40 p-6 rounded-2xl max-w-md w-full shadow-[0_0_50px_rgba(255,96,72,0.2)] space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-coral-500/15 text-coral-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink">Delete Monitor?</h3>
                <p className="text-xs text-ink-muted mt-1">
                  Are you sure you want to delete <span className="text-ink font-semibold">&quot;{confirmDelete.name}&quot;</span>? All historical telemetry pings and incident logs will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-night-700/80">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-ink-muted hover:text-ink hover:bg-night-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeDelete(confirmDelete.id, confirmDelete.name)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-coral-500 hover:bg-coral-600 text-white shadow-[0_0_20px_rgba(255,96,72,0.4)] transition-all cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
              className="p-1.5 text-ink-muted hover:text-ink hover:bg-night-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Monitor Name</label>
              <input
                required
                type="text"
                value={newMonitor.name}
                onChange={(e) => setNewMonitor({ ...newMonitor, name: e.target.value })}
                placeholder="Production API Gateway"
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors font-sans"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Monitor Protocol</label>
              <select
                value={newMonitor.type}
                onChange={(e) =>
                  setNewMonitor({ ...newMonitor, type: e.target.value as Monitor['type'] })
                }
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              >
                <option value="HTTP">HTTP(s) Status Check</option>
                <option value="KEYWORD">Keyword Body Inspection</option>
                <option value="PING">ICMP Ping Probe</option>
                <option value="TCP">TCP Port Socket</option>
                <option value="HEARTBEAT">Inbound Heartbeat Push</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">
                {newMonitor.type === 'TCP'
                  ? 'Target Host & Port (hostname:port)'
                  : newMonitor.type === 'PING'
                  ? 'Target Hostname or Public IP'
                  : newMonitor.type === 'HEARTBEAT'
                  ? 'Heartbeat Identifier Slug (e.g. cron-billing-worker)'
                  : 'Target Endpoint URL (http:// or https://)'}
              </label>
              <input
                required
                type="text"
                value={newMonitor.target}
                onChange={(e) => setNewMonitor({ ...newMonitor, target: e.target.value })}
                placeholder={
                  newMonitor.type === 'TCP'
                    ? 'api.example.com:443'
                    : newMonitor.type === 'PING'
                    ? '1.1.1.1'
                    : newMonitor.type === 'HEARTBEAT'
                    ? 'nightly-data-sync'
                    : 'https://api.company.com/health'
                }
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors font-mono"
              />
              {newMonitor.type === 'HEARTBEAT' && (
                <p className="text-[11px] text-brand-300 font-mono mt-1">
                  💡 Inbound trigger URL: /api/heartbeat/{newMonitor.target || ':slug'}
                </p>
              )}
            </div>

            {newMonitor.type === 'KEYWORD' && (
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-semibold text-ink uppercase tracking-wider">
                  Required Response Keyword
                </label>
                <input
                  required
                  type="text"
                  value={newMonitor.keyword}
                  onChange={(e) => setNewMonitor({ ...newMonitor, keyword: e.target.value })}
                  placeholder='"status":"healthy"'
                  className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors font-mono"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">Check Interval</label>
              <select
                value={newMonitor.interval}
                onChange={(e) => setNewMonitor({ ...newMonitor, interval: Number(e.target.value) })}
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              >
                <option value={1}>Every 1 minute</option>
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every 60 minutes</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink uppercase tracking-wider">
                Timeout Threshold
              </label>
              <select
                value={newMonitor.timeoutMs}
                onChange={(e) => setNewMonitor({ ...newMonitor, timeoutMs: Number(e.target.value) })}
                className="w-full bg-night-900 border border-night-700 rounded-xl px-4 py-2.5 text-sm text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
              >
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
                <option value={30000}>30 seconds (standard)</option>
                <option value={60000}>60 seconds (extended)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-night-700">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2.5 text-sm text-ink-muted hover:text-ink transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-xl shadow-[0_0_20px_rgba(168,72,240,0.4)] transition-all cursor-pointer"
            >
              Deploy Monitor
            </button>
          </div>
        </form>
      )}

      {/* Main Stream Controls: Filter Pills & Live Search */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          {/* Status Filter Tab Pills */}
          <div className="flex items-center gap-1.5 p-1 bg-night-850 border border-night-700 rounded-xl">
            {(['ALL', 'UP', 'DOWN', 'PAUSED'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filterTab === tab
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/40 shadow-[0_0_12px_rgba(168,72,240,0.2)]'
                    : 'text-ink-muted hover:text-ink hover:bg-night-800'
                }`}
              >
                {tab === 'ALL' && `All (${monitors.length})`}
                {tab === 'UP' && `Operational (${upCount})`}
                {tab === 'DOWN' && `Disrupted (${downCount})`}
                {tab === 'PAUSED' && `Paused (${pausedCount})`}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search monitors or targets..."
              className="w-full bg-night-850 border border-night-700 rounded-xl pl-9 pr-4 py-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors"
            />
          </div>
        </div>

        {/* Telemetry Stream List Card */}
        {loading ? (
          <div className="bg-night-850 border border-night-700/80 rounded-2xl p-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-brand-400 animate-spin mx-auto" />
            <p className="text-sm text-ink-muted font-medium">Connecting to Beacon Telemetry Engine...</p>
          </div>
        ) : filteredMonitors.length === 0 ? (
          <div className="bg-night-850 border border-night-700/80 rounded-2xl p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-night-800 flex items-center justify-center mx-auto text-ink-muted">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-ink">No telemetry streams found</h3>
              <p className="text-xs text-ink-muted mt-1 max-w-sm mx-auto">
                {searchQuery || filterTab !== 'ALL'
                  ? 'No monitors matched your search or status filter parameters.'
                  : 'Get started by creating your first endpoint check or heartbeat monitor.'}
              </p>
            </div>
            {!searchQuery && filterTab === 'ALL' && (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2 rounded-xl text-xs transition-all shadow-[0_0_20px_rgba(168,72,240,0.3)] cursor-pointer"
              >
                Configure First Monitor
              </button>
            )}
          </div>
        ) : (
          <div className="bg-night-850 border border-night-700/80 rounded-2xl divide-y divide-night-700/60 overflow-hidden shadow-[0_0_40px_rgba(168,72,240,0.03)]">
            {filteredMonitors.map((monitor) => {
              const latestPing = monitor.pingResults?.[0];
              const reversePings = [...(monitor.pingResults || [])].reverse();

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
                        <span className="truncate max-w-60 font-mono">{monitor.target}</span>
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
                      {monitor.type === 'HEARTBEAT' && (
                        <div className="flex items-center gap-1 text-[11px] text-brand-300 font-mono">
                          <HeartPulse className="w-3 h-3" />
                          <span>
                            {monitor.lastHeartbeatAt
                              ? `Last ping: ${new Date(monitor.lastHeartbeatAt).toLocaleTimeString()}`
                              : 'No heartbeats received yet'}
                          </span>
                        </div>
                      )}
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
                                backgroundColor: '#080e1e',
                                border: '1px solid #1e293b',
                                borderRadius: '8px',
                                fontSize: '11px',
                                color: '#f8fafc',
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
                        onClick={() => void handleToggleStatus(monitor)}
                        disabled={togglingId === monitor.id}
                        className={`p-2 rounded-xl transition-all border cursor-pointer ${
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

                      {/* BUG-015: Delete with confirmation modal */}
                      <button
                        type="button"
                        onClick={() => setConfirmDelete({ id: monitor.id, name: monitor.name })}
                        className="p-2 text-ink-muted hover:text-coral-500 bg-night-800 hover:bg-coral-500/10 border border-night-700 hover:border-coral-500/30 rounded-xl transition-colors cursor-pointer"
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
          <span>Beacon Telemetry Engine • Next.js 16 • Turbopack</span>
        </div>
        <div className="flex items-center gap-4 text-ink-faint font-mono text-[11px]">
          <span>Serverless Cron Engine</span>
          <span>•</span>
          <span>PostgreSQL Prisma ORM</span>
        </div>
      </footer>
    </div>
  );
}
