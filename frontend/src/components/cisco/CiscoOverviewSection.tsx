// src/components/cisco/CiscoOverviewSection.tsx

import React, { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { useAuth } from "../../context/AuthContext";

const CISCO_BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${CISCO_BASE}/api/v1/cisco`;

// ─── Types ───────────────────────────────────────────────────────────────────

type SwitchStatus = "active" | "inactive" | "error";

interface CiscoSwitch {
  id: number;
  name: string;
  host: string;
  ssh_port: number;
  telnet_port: number;
  protocol_preference: string;
  username: string;
  status: SwitchStatus;
  health_protocol_used: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  device_hostname: string | null;
  device_model: string | null;
  ios_version: string | null;
  serial_number: string | null;
  cache_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SwitchListResponse {
  switches: CiscoSwitch[];
  total: number;
}

interface VlanMgmtStatsResponse {
  total_vlans: number;
  active_vlans: number;
  access_ports: number;
  trunk_ports: number;
}

interface PortStatusResponse {
  success: boolean;
  switch_id: number;
  port_count: number;
  ports: PortInfo[];
  protocol_used: string | null;
  error: string | null;
}

interface PortInfo {
  port_label: string;
  port_number: number;
  description: string;
  status: string;
  vlan: string;
  duplex: string;
  speed: string;
  port_type: string;
  mac_address: string | null;
  locked: boolean;
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
    throw new Error(body?.detail || body?.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function extractErrorMessage(err: any): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err?.message === "string") return err.message;
  return "";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: { value: string; positive: boolean };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
          )}
          {trend && (
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
              {trend.value}
            </div>
          )}
        </div>
        <div className={cn("p-3 rounded-xl", color)}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CiscoOverviewSection() {
  const { accessToken } = useAuth();

  // Switches
  const [switches, setSwitches] = useState<CiscoSwitch[]>([]);
  const [loadingSwitches, setLoadingSwitches] = useState(false);
  const [switchesError, setSwitchesError] = useState<string | null>(null);

  // VLAN stats
  const [vlanStats, setVlanStats] = useState<VlanMgmtStatsResponse | null>(
    null,
  );
  const [loadingVlanStats, setLoadingVlanStats] = useState(false);
  const [vlanStatsError, setVlanStatsError] = useState<string | null>(null);

  // Port status for the first active switch (best-effort summary)
  const [portSummary, setPortSummary] = useState<{
    total: number;
    connected: number;
    locked: number;
  } | null>(null);
  const [loadingPorts, setLoadingPorts] = useState(false);

  // ── Fetch on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    loadSwitches();
    loadVlanStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function loadSwitches() {
    setLoadingSwitches(true);
    setSwitchesError(null);
    try {
      const data = await apiFetch<SwitchListResponse>(
        `${PREFIX}/switches`,
        accessToken,
      );
      setSwitches(data.switches ?? []);
    } catch (err) {
      setSwitchesError(
        extractErrorMessage(err) || "Failed to load Cisco switches.",
      );
    } finally {
      setLoadingSwitches(false);
    }
  }

  async function loadVlanStats() {
    setLoadingVlanStats(true);
    setVlanStatsError(null);
    try {
      const data = await apiFetch<VlanMgmtStatsResponse>(
        `${PREFIX}/vlan-management/stats`,
        accessToken,
      );
      setVlanStats(data);
    } catch (err) {
      setVlanStatsError(
        extractErrorMessage(err) || "Failed to load VLAN stats.",
      );
    } finally {
      setLoadingVlanStats(false);
    }
  }

  // Once we have switches, fetch port status from first active switch
  useEffect(() => {
    if (!accessToken) return;
    const activeSwitch = switches.find((s) => s.status === "active");
    if (!activeSwitch) return;
    loadPortSummary(activeSwitch.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switches, accessToken]);

  async function loadPortSummary(switchId: number) {
    setLoadingPorts(true);
    try {
      const data = await apiFetch<PortStatusResponse>(
        `${PREFIX}/switches/${switchId}/port-status`,
        accessToken,
      );
      if (data.success) {
        const connected = data.ports.filter((p) =>
          p.status.toLowerCase().includes("connect"),
        ).length;
        const locked = data.ports.filter((p) => p.locked).length;
        setPortSummary({ total: data.port_count, connected, locked });
      }
    } catch {
      // best-effort — silently ignore
    } finally {
      setLoadingPorts(false);
    }
  }

  // ── Derived stats ────────────────────────────────────────────────────────────

  const totalSwitches = switches.length;
  const activeSwitches = switches.filter((s) => s.status === "active").length;
  const errorSwitches = switches.filter((s) => s.status === "error").length;
  const inactiveSwitches = switches.filter(
    (s) => s.status === "inactive",
  ).length;

  const responseTimes = switches
    .map((s) => s.last_response_time_ms ?? 0)
    .filter((v) => v > 0);
  const avgResponseTime =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
        )
      : 0;

  const protocolGroups = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sw of switches) {
      const proto = sw.health_protocol_used ?? "none";
      counts[proto] = (counts[proto] ?? 0) + 1;
    }
    const COLORS: Record<string, string> = {
      ssh: "#3b82f6",
      "ssh-legacy": "#8b5cf6",
      telnet: "#f59e0b",
      none: "#94a3b8",
    };
    return Object.entries(counts).map(([name, value]) => ({
      name: name.toUpperCase(),
      value,
      color: COLORS[name] ?? "#64748b",
    }));
  }, [switches]);

  const statusPieData = [
    { name: "Active", value: activeSwitches, color: "#22c55e" },
    { name: "Error", value: errorSwitches, color: "#ef4444" },
    { name: "Inactive", value: inactiveSwitches, color: "#94a3b8" },
  ].filter((d) => d.value > 0);

  const recentlyChecked = useMemo(
    () =>
      [...switches]
        .filter((s) => s.last_checked_at)
        .sort(
          (a, b) =>
            new Date(b.last_checked_at!).getTime() -
            new Date(a.last_checked_at!).getTime(),
        )
        .slice(0, 5),
    [switches],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Top stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Cisco Switches"
          value={totalSwitches}
          subtitle="Total registered switches"
          icon={<Server size={20} className="text-blue-600" />}
          color="bg-blue-50"
          trend={
            totalSwitches > 0
              ? { value: `${activeSwitches} active`, positive: true }
              : undefined
          }
        />
        <StatCard
          title="Active Switches"
          value={activeSwitches}
          subtitle={`Error: ${errorSwitches} · Inactive: ${inactiveSwitches}`}
          icon={<Activity size={20} className="text-green-600" />}
          color="bg-green-50"
          trend={
            errorSwitches > 0
              ? { value: `${errorSwitches} in error`, positive: false }
              : undefined
          }
        />
        <StatCard
          title="VLANs Configured"
          value={vlanStats?.total_vlans ?? "-"}
          subtitle={`Active: ${vlanStats?.active_vlans ?? "-"}`}
          icon={<Layers size={20} className="text-amber-600" />}
          color="bg-amber-50"
          trend={
            vlanStats
              ? {
                  value: `${vlanStats.access_ports} access · ${vlanStats.trunk_ports} trunk`,
                  positive: true,
                }
              : undefined
          }
        />
        <StatCard
          title="Avg Response Time"
          value={avgResponseTime > 0 ? `${avgResponseTime} ms` : "N/A"}
          subtitle={`Across ${responseTimes.length} reachable switch(es)`}
          icon={<Zap size={20} className="text-purple-600" />}
          color="bg-purple-50"
          trend={
            avgResponseTime > 0
              ? {
                  value:
                    avgResponseTime < 500
                      ? "Within normal range"
                      : "High latency",
                  positive: avgResponseTime < 500,
                }
              : undefined
          }
        />
      </div>

      {/* ── Middle row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent health-check activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-900">
                Latest Health Checks
              </h3>
              <p className="text-sm text-slate-500">
                Most recently polled Cisco switches
              </p>
            </div>
            {loadingSwitches && (
              <Loader2 size={16} className="animate-spin text-slate-500" />
            )}
          </div>

          {switchesError && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              {switchesError}
            </div>
          )}

          <div className="space-y-2 text-xs">
            {recentlyChecked.map((sw) => (
              <div
                key={sw.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-slate-900">{sw.name}</span>
                  <span className="text-slate-500">
                    {sw.host} · {sw.health_protocol_used?.toUpperCase() ?? "—"}{" "}
                    · {sw.device_model ?? "Unknown model"}
                  </span>
                  {sw.last_error && (
                    <span className="text-red-500 truncate max-w-xs">
                      {sw.last_error}
                    </span>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      "text-xs font-medium px-2.5 py-1 rounded-full capitalize",
                      sw.status === "active"
                        ? "bg-green-100 text-green-700"
                        : sw.status === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {sw.status}
                  </span>
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

            {recentlyChecked.length === 0 && !loadingSwitches && (
              <div className="text-xs text-slate-500">
                No switches checked yet.
              </div>
            )}
          </div>
        </div>

        {/* Status pie chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-1">
            Switch Status Distribution
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Active vs Error vs Inactive
          </p>

          {loadingSwitches ? (
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="space-y-2 mt-2 text-sm">
                {statusPieData.length === 0 && (
                  <span className="text-xs text-slate-500">
                    No switches registered.
                  </span>
                )}
                {statusPieData.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-slate-600">{item.name}</span>
                    </div>
                    <span className="font-medium text-slate-900">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Response time / protocol overview */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">
              Protocol Distribution
            </h3>
            <span className="text-xs text-slate-400">
              Avg: {avgResponseTime > 0 ? `${avgResponseTime} ms` : "N/A"}
            </span>
          </div>

          {protocolGroups.length === 0 ? (
            <p className="text-xs text-slate-500">
              No switches have been tested yet.
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={protocolGroups}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={62}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {protocolGroups.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {protocolGroups.map((pg) => (
                  <div
                    key={pg.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: pg.color }}
                      />
                      <span className="text-slate-600">{pg.name}</span>
                    </div>
                    <span className="font-medium text-slate-900">
                      {pg.value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* All switches status list */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-900">All Cisco Switches</h3>
            {loadingSwitches && (
              <Loader2 size={16} className="animate-spin text-slate-500" />
            )}
          </div>

          {switchesError && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              {switchesError}
            </div>
          )}

          <div className="text-xs text-slate-500 mb-3">
            Total: {totalSwitches} · Active: {activeSwitches} · Error:{" "}
            {errorSwitches}
          </div>

          <div className="space-y-3">
            {switches.map((sw) => (
              <div
                key={sw.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {sw.status === "active" ? (
                    <Wifi size={18} className="text-green-500" />
                  ) : sw.status === "error" ? (
                    <WifiOff size={18} className="text-red-500" />
                  ) : (
                    <Server size={18} className="text-slate-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {sw.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {sw.host} · {sw.protocol_preference}
                      {sw.device_model ? ` · ${sw.device_model}` : ""}
                      {sw.ios_version ? ` · IOS ${sw.ios_version}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      "text-xs font-medium px-2.5 py-1 rounded-full capitalize",
                      sw.status === "active"
                        ? "bg-green-100 text-green-700"
                        : sw.status === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {sw.status}
                  </span>
                  {sw.last_response_time_ms != null && (
                    <span className="text-[10px] text-slate-400">
                      {sw.last_response_time_ms} ms
                    </span>
                  )}
                </div>
              </div>
            ))}

            {switches.length === 0 && !loadingSwitches && !switchesError && (
              <div className="text-xs text-slate-500">
                No Cisco switches configured yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── VLAN & Port summary row ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* VLAN summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">VLAN Summary</h3>
            {loadingVlanStats && (
              <Loader2 size={16} className="animate-spin text-slate-500" />
            )}
          </div>
          {vlanStatsError && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              {vlanStatsError}
            </div>
          )}
          <div className="space-y-3">
            {(
              [
                {
                  label: "Total VLANs",
                  value: vlanStats?.total_vlans ?? "-",
                  icon: <Layers size={14} className="text-amber-500" />,
                },
                {
                  label: "Active VLANs",
                  value: vlanStats?.active_vlans ?? "-",
                  icon: <Activity size={14} className="text-green-500" />,
                },
                {
                  label: "Access Ports",
                  value: vlanStats?.access_ports ?? "-",
                  icon: <Cable size={14} className="text-blue-500" />,
                },
                {
                  label: "Trunk Ports",
                  value: vlanStats?.trunk_ports ?? "-",
                  icon: <Network size={14} className="text-purple-500" />,
                },
              ] as const
            ).map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
              >
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {item.icon}
                  {item.label}
                </div>
                <span className="text-sm font-semibold text-slate-900">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Port summary (best-effort from first active switch) */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Port Summary</h3>
            {loadingPorts && (
              <Loader2 size={16} className="animate-spin text-slate-500" />
            )}
          </div>
          <p className="text-xs text-slate-400 mb-3">
            From first active switch
          </p>
          {portSummary ? (
            <div className="space-y-3">
              {(
                [
                  {
                    label: "Total Ports",
                    value: portSummary.total,
                    icon: <Server size={14} className="text-slate-500" />,
                  },
                  {
                    label: "Connected",
                    value: portSummary.connected,
                    icon: <Wifi size={14} className="text-green-500" />,
                  },
                  {
                    label: "Locked",
                    value: portSummary.locked,
                    icon: <Lock size={14} className="text-red-500" />,
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {item.icon}
                    {item.label}
                  </div>
                  <span className="text-sm font-semibold text-slate-900">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {activeSwitches === 0
                ? "No active switches available."
                : loadingPorts
                  ? "Loading port data…"
                  : "Port data unavailable."}
            </p>
          )}
        </div>

        {/* Security / access overview */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-blue-600" />
            <h3 className="font-semibold text-slate-900">Access & Security</h3>
          </div>
          <div className="space-y-3">
            {(
              [
                {
                  label: "Reachable",
                  value: `${activeSwitches} / ${totalSwitches}`,
                  icon: <Wifi size={14} className="text-green-500" />,
                },
                {
                  label: "Unreachable",
                  value: `${errorSwitches + inactiveSwitches}`,
                  icon: <WifiOff size={14} className="text-red-500" />,
                },
                {
                  label: "SSH switches",
                  value: switches.filter((s) => s.protocol_preference === "ssh")
                    .length,
                  icon: <ShieldCheck size={14} className="text-blue-500" />,
                },
                {
                  label: "Telnet switches",
                  value: switches.filter(
                    (s) => s.protocol_preference === "telnet",
                  ).length,
                  icon: <AlertTriangle size={14} className="text-amber-500" />,
                },
                {
                  label: "Auto switches",
                  value: switches.filter(
                    (s) => s.protocol_preference === "auto",
                  ).length,
                  icon: <Cpu size={14} className="text-purple-500" />,
                },
              ] as const
            ).map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
              >
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {item.icon}
                  {item.label}
                </div>
                <span className="text-sm font-semibold text-slate-900">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
