// src/components/cisco/CiscoOverviewSection.tsx

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { cn } from "../../utils/cn";
import {
  Activity,
  Server,
  AlertTriangle,
  Clock,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Cable,
  Lock,
  Network,
  ShieldCheck,
  Cpu,
  Wifi,
  WifiOff,
  Layers,
  RefreshCw,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { useAuth } from "../../context/AuthContext";

// ─── Config ──────────────────────────────────────────────────────────────────

const CISCO_BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${CISCO_BASE}/api/v1/cisco`;

// Auto-refresh every 60 s (0 = disabled)
const AUTO_REFRESH_MS = 60_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SwitchOverviewSummary {
  id: number;
  name: string;
  host: string;
  status: "active" | "inactive" | "error";
  protocol_preference: string;
  health_protocol_used: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  device_hostname: string | null;
  device_model: string | null;
  ios_version: string | null;
  serial_number: string | null;
  cache_updated_at: string | null;
  port_total: number;
  port_connected: number;
  port_locked: number;
  vlan_count: number;
  interface_count: number;
}

interface OverviewResponse {
  total_switches: number;
  active_switches: number;
  error_switches: number;
  inactive_switches: number;
  avg_response_time_ms: number | null;
  protocol_distribution: Record<string, number>;
  total_vlans: number;
  active_vlans: number;
  access_ports: number;
  trunk_ports: number;
  total_ports: number;
  connected_ports: number;
  locked_ports: number;
  switches: SwitchOverviewSummary[];
  recently_checked: SwitchOverviewSummary[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function apiFetch<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? body?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function extractError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  error: "#ef4444",
  inactive: "#94a3b8",
};

const PROTO_COLORS: Record<string, string> = {
  ssh: "#3b82f6",
  "ssh-legacy": "#8b5cf6",
  telnet: "#f59e0b",
  none: "#94a3b8",
};

// ─── Reusable small components ───────────────────────────────────────────────

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <AlertTriangle size={14} className="shrink-0" />
      {message}
    </div>
  );
}

function KVRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    inactive: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={cn(
        "text-xs font-medium px-2.5 py-1 rounded-full capitalize",
        map[status] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {status}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  trend,
  loading,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  loading?: boolean;
  trend?: { label: string; positive: boolean };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
          {loading ? (
            <div className="mt-2">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          ) : (
            <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          )}
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1 truncate">{subtitle}</p>
          )}
          {trend && !loading && (
            <div
              className={cn(
                "flex items-center gap-1 mt-2 text-xs font-medium",
                trend.positive ? "text-green-600" : "text-red-600",
              )}
            >
              {trend.positive ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowDownRight size={14} />
              )}
              {trend.label}
            </div>
          )}
        </div>
        <div className={cn("p-3 rounded-xl shrink-0 ml-3", color)}>{icon}</div>
      </div>
    </div>
  );
}

function MiniPieChart({
  data,
  height = 160,
  innerRadius = 45,
  outerRadius = 68,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-400"
        style={{ height }}
      >
        No data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            fontSize: "12px",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function LegendList({
  items,
}: {
  items: { label: string; value: number | string; color: string }[];
}) {
  return (
    <div className="space-y-2 mt-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between text-xs"
        >
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-slate-600">{item.label}</span>
          </div>
          <span className="font-semibold text-slate-900">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CiscoOverviewSection() {
  const { accessToken } = useAuth();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // ── Fetch overview from DB-backed endpoint ────────────────────────────────

  const fetchOverview = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<OverviewResponse>(
        `${PREFIX}/overview`,
        accessToken,
      );
      setOverview(data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Auto-refresh
  useEffect(() => {
    if (!AUTO_REFRESH_MS) return;
    const id = setInterval(fetchOverview, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOverview]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const statusPieData = useMemo(() => {
    if (!overview) return [];
    return [
      {
        name: "Active",
        value: overview.active_switches,
        color: STATUS_COLORS.active,
      },
      {
        name: "Error",
        value: overview.error_switches,
        color: STATUS_COLORS.error,
      },
      {
        name: "Inactive",
        value: overview.inactive_switches,
        color: STATUS_COLORS.inactive,
      },
    ].filter((d) => d.value > 0);
  }, [overview]);

  const protoPieData = useMemo(() => {
    if (!overview) return [];
    return Object.entries(overview.protocol_distribution).map(
      ([name, value]) => ({
        name: name.toUpperCase(),
        value,
        color: PROTO_COLORS[name] ?? "#64748b",
      }),
    );
  }, [overview]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Network Overview
          </h2>
          <p className="text-sm text-slate-500">
            All metrics loaded from database snapshots
            {lastRefreshed && (
              <span className="ml-2 text-slate-400">
                · last updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={fetchOverview}
          disabled={loading}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
            "border border-slate-200 bg-white hover:bg-slate-50 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && <SectionError message={error} />}

      {/* ── Top stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          loading={loading && !overview}
          title="Cisco Switches"
          value={overview?.total_switches ?? 0}
          subtitle="Total registered"
          icon={<Server size={20} className="text-blue-600" />}
          color="bg-blue-50"
          trend={
            overview
              ? {
                  label: `${overview.active_switches} active`,
                  positive: overview.active_switches > 0,
                }
              : undefined
          }
        />
        <StatCard
          loading={loading && !overview}
          title="Active Switches"
          value={overview?.active_switches ?? 0}
          subtitle={`Error: ${overview?.error_switches ?? 0} · Inactive: ${overview?.inactive_switches ?? 0}`}
          icon={<Activity size={20} className="text-green-600" />}
          color="bg-green-50"
          trend={
            overview && overview.error_switches > 0
              ? {
                  label: `${overview.error_switches} in error`,
                  positive: false,
                }
              : undefined
          }
        />
        <StatCard
          loading={loading && !overview}
          title="VLANs Configured"
          value={overview?.total_vlans ?? 0}
          subtitle={`Active: ${overview?.active_vlans ?? 0}`}
          icon={<Layers size={20} className="text-amber-600" />}
          color="bg-amber-50"
          trend={
            overview
              ? {
                  label: `${overview.access_ports} access · ${overview.trunk_ports} trunk`,
                  positive: true,
                }
              : undefined
          }
        />
        <StatCard
          loading={loading && !overview}
          title="Avg Response Time"
          value={
            overview?.avg_response_time_ms != null
              ? `${overview.avg_response_time_ms} ms`
              : "N/A"
          }
          subtitle={`Across ${overview?.active_switches ?? 0} reachable switch(es)`}
          icon={<Zap size={20} className="text-purple-600" />}
          color="bg-purple-50"
          trend={
            overview?.avg_response_time_ms != null
              ? {
                  label:
                    overview.avg_response_time_ms < 500
                      ? "Within normal range"
                      : "High latency detected",
                  positive: overview.avg_response_time_ms < 500,
                }
              : undefined
          }
        />
      </div>

      {/* ── Middle row: recent checks + status pie ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent health checks */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-900">
                Latest Health Checks
              </h3>
              <p className="text-sm text-slate-500">
                Most recently polled switches (from DB)
              </p>
            </div>
            {loading && (
              <Loader2 size={16} className="animate-spin text-slate-400" />
            )}
          </div>

          <div className="space-y-2">
            {overview?.recently_checked.map((sw) => (
              <div
                key={sw.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {sw.status === "active" ? (
                    <CheckCircle2
                      size={16}
                      className="text-green-500 shrink-0"
                    />
                  ) : sw.status === "error" ? (
                    <XCircle size={16} className="text-red-500 shrink-0" />
                  ) : (
                    <MinusCircle
                      size={16}
                      className="text-slate-400 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {sw.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {sw.host}
                      {sw.health_protocol_used
                        ? ` · ${sw.health_protocol_used.toUpperCase()}`
                        : ""}
                      {sw.device_model ? ` · ${sw.device_model}` : ""}
                    </p>
                    {sw.last_error && (
                      <p className="text-xs text-red-500 truncate max-w-xs mt-0.5">
                        {sw.last_error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={sw.status} />
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock size={10} />
                    {formatDate(sw.last_checked_at)}
                  </span>
                  {sw.last_response_time_ms != null && (
                    <span className="text-[10px] text-slate-400">
                      {sw.last_response_time_ms} ms
                    </span>
                  )}
                </div>
              </div>
            ))}

            {!loading && (overview?.recently_checked.length ?? 0) === 0 && (
              <p className="text-xs text-slate-500 py-2">
                No switches have been tested yet. Use{" "}
                <span className="font-medium">Test Connection</span> to
                populate.
              </p>
            )}

            {loading && !overview && (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-14 bg-slate-100 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status distribution pie */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-1">Switch Status</h3>
          <p className="text-sm text-slate-500 mb-3">
            Active · Error · Inactive
          </p>

          {loading && !overview ? (
            <div className="h-40 bg-slate-100 rounded-lg animate-pulse" />
          ) : (
            <>
              <MiniPieChart data={statusPieData} />
              <LegendList
                items={statusPieData.map((d) => ({
                  label: d.name,
                  value: d.value,
                  color: d.color,
                }))}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Bottom row: protocols + all switches ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Protocol distribution */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">
              Protocol Distribution
            </h3>
            <span className="text-xs text-slate-400">
              {overview?.avg_response_time_ms != null
                ? `avg ${overview.avg_response_time_ms} ms`
                : "—"}
            </span>
          </div>

          {loading && !overview ? (
            <div className="h-36 bg-slate-100 rounded-lg animate-pulse" />
          ) : (
            <>
              <MiniPieChart
                data={protoPieData}
                height={140}
                innerRadius={38}
                outerRadius={58}
              />
              <LegendList
                items={protoPieData.map((d) => ({
                  label: d.name,
                  value: d.value,
                  color: d.color,
                }))}
              />
            </>
          )}
        </div>

        {/* All switches */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                All Cisco Switches
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Total: {overview?.total_switches ?? 0} · Active:{" "}
                {overview?.active_switches ?? 0} · Error:{" "}
                {overview?.error_switches ?? 0}
              </p>
            </div>
            {loading && (
              <Loader2 size={16} className="animate-spin text-slate-400" />
            )}
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {overview?.switches.map((sw) => (
              <div
                key={sw.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {sw.status === "active" ? (
                    <Wifi size={18} className="text-green-500 shrink-0" />
                  ) : sw.status === "error" ? (
                    <WifiOff size={18} className="text-red-500 shrink-0" />
                  ) : (
                    <Server size={18} className="text-slate-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {sw.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {sw.host} · {sw.protocol_preference}
                      {sw.device_model ? ` · ${sw.device_model}` : ""}
                      {sw.ios_version ? ` · IOS ${sw.ios_version}` : ""}
                    </p>
                    {/* Per-switch snapshot counts */}
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Ports: {sw.port_connected}/{sw.port_total} up ·{" "}
                      {sw.port_locked} locked · {sw.vlan_count} VLANs ·{" "}
                      {sw.interface_count} ifaces
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={sw.status} />
                  {sw.last_response_time_ms != null && (
                    <span className="text-[10px] text-slate-400">
                      {sw.last_response_time_ms} ms
                    </span>
                  )}
                  {sw.cache_updated_at && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock size={9} />
                      {formatDate(sw.cache_updated_at)}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {!loading && !error && (overview?.switches.length ?? 0) === 0 && (
              <p className="text-xs text-slate-500">
                No Cisco switches configured yet.
              </p>
            )}

            {loading && !overview && (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-slate-100 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom summary cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* VLAN summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">VLAN Summary</h3>
            <Layers size={15} className="text-amber-500" />
          </div>
          <div className="space-y-2">
            <KVRow
              icon={<Layers size={13} className="text-amber-500" />}
              label="Total VLANs"
              value={overview?.total_vlans ?? "—"}
            />
            <KVRow
              icon={<Activity size={13} className="text-green-500" />}
              label="Active VLANs"
              value={overview?.active_vlans ?? "—"}
            />
            <KVRow
              icon={<Cable size={13} className="text-blue-500" />}
              label="Access Ports"
              value={overview?.access_ports ?? "—"}
            />
            <KVRow
              icon={<Network size={13} className="text-purple-500" />}
              label="Trunk Ports"
              value={overview?.trunk_ports ?? "—"}
            />
          </div>
        </div>

        {/* Port summary (aggregated from snapshots) */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Port Summary</h3>
            <span className="text-xs text-slate-400">All switches</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Aggregated from DB snapshots
          </p>
          <div className="space-y-2">
            <KVRow
              icon={<Server size={13} className="text-slate-500" />}
              label="Total Ports"
              value={overview?.total_ports ?? "—"}
            />
            <KVRow
              icon={<Wifi size={13} className="text-green-500" />}
              label="Connected"
              value={overview?.connected_ports ?? "—"}
            />
            <KVRow
              icon={<WifiOff size={13} className="text-slate-400" />}
              label="Not Connected"
              value={
                overview != null
                  ? overview.total_ports - overview.connected_ports
                  : "—"
              }
            />
            <KVRow
              icon={<Lock size={13} className="text-red-500" />}
              label="Locked"
              value={overview?.locked_ports ?? "—"}
            />
          </div>
        </div>

        {/* Access & security */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-blue-600" />
            <h3 className="font-semibold text-slate-900">
              Access &amp; Security
            </h3>
          </div>
          <div className="space-y-2">
            <KVRow
              icon={<Wifi size={13} className="text-green-500" />}
              label="Reachable"
              value={
                overview != null
                  ? `${overview.active_switches} / ${overview.total_switches}`
                  : "—"
              }
            />
            <KVRow
              icon={<WifiOff size={13} className="text-red-500" />}
              label="Unreachable"
              value={
                overview != null
                  ? overview.error_switches + overview.inactive_switches
                  : "—"
              }
            />
            <KVRow
              icon={<ShieldCheck size={13} className="text-blue-500" />}
              label="SSH preference"
              value={
                overview?.switches.filter(
                  (s) => s.protocol_preference === "ssh",
                ).length ?? "—"
              }
            />
            <KVRow
              icon={<AlertTriangle size={13} className="text-amber-500" />}
              label="Telnet preference"
              value={
                overview?.switches.filter(
                  (s) => s.protocol_preference === "telnet",
                ).length ?? "—"
              }
            />
            <KVRow
              icon={<Cpu size={13} className="text-purple-500" />}
              label="Auto preference"
              value={
                overview?.switches.filter(
                  (s) => s.protocol_preference === "auto",
                ).length ?? "—"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
