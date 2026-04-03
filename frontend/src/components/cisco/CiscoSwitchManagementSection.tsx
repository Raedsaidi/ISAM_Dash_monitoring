// src/components/cisco/CiscoSwitchManagementSection.tsx

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "../../utils/cn";
import {
  Network,
  CheckCircle,
  XCircle,
  Activity,
  Plus,
  Search,
  Loader2,
  RefreshCw,
  Trash2,
  Lock,
  Unlock,
  Settings2,
  Cable,
  Layers,
  HardDrive,
  Clock,
  AlertCircle,
  Server,
  Cpu,
  Wifi,
  WifiOff,
  Monitor,
  Hash,
  Globe,
  Shield,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import {
  fetchCiscoSwitches,
  createCiscoSwitch,
  deleteCiscoSwitch,
  testCiscoConnection,
  getCiscoDeviceInfo,
  getCiscoInterfaces,
  getCiscoVlans,
  type CiscoSwitch,
  type CreateSwitchPayload,
  type TestConnectionResponse,
  type InterfaceInfo,
  type VlanInfo,
} from "../../services/ciscoApi";

// ─── Types ──────────────────────────────────────────────

type StatusType = "active" | "inactive" | "error";
type ProtocolPreference = "ssh" | "telnet" | "auto";
type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";

function parseJwt(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ─── Main Component ────────────────────────────────────

export default function CiscoSwitchManagementSection() {
  const { accessToken, user } = useAuth();

  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const currentRole = (user?.role ?? jwt?.role ?? null) as UserRole | null;
  const isAdmin = currentRole === "ADMIN" || currentRole === "SUPER_ADMIN";

  const [switches, setSwitches] = useState<CiscoSwitch[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "error">(
    "all",
  );
  const [searchTerm, setSearchTerm] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSwitchId, setSelectedSwitchId] = useState<number | null>(null);

  const [form, setForm] = useState<CreateSwitchPayload>({
    name: "",
    host: "",
    telnet_port: 23,
    ssh_port: 22,
    protocol_preference: "auto",
    username: "",
    password: "",
    enable_password: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitAdding, setSubmitAdding] = useState(false);

  // ── Load on mount ──
  useEffect(() => {
    if (!accessToken) return;
    loadSwitches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── API Calls ──

  async function loadSwitches(nextSelectedId?: number | null) {
    setLoading(true);
    setGlobalError(null);
    try {
      const data = await fetchCiscoSwitches(accessToken);
      setSwitches(data);

      const desiredId =
        nextSelectedId === undefined ? selectedSwitchId : nextSelectedId;
      if (data.length === 0) {
        setSelectedSwitchId(null);
      } else if (desiredId !== null && data.some((sw) => sw.id === desiredId)) {
        setSelectedSwitchId(desiredId);
      } else {
        setSelectedSwitchId(data[0].id);
      }
    } catch (err: any) {
      setGlobalError(err.message || "Failed to load Cisco switches.");
    } finally {
      setLoading(false);
    }
  }

  function validateForm(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    else if (form.name.length < 2)
      e.name = "Name must be at least 2 characters.";
    if (!form.host.trim()) e.host = "Host is required.";
    if (!form.username.trim()) e.username = "Username is required.";
    if (!form.password) e.password = "Password is required.";
    if (!form.telnet_port || form.telnet_port < 1 || form.telnet_port > 65535)
      e.telnet_port = "Telnet port must be between 1 and 65535.";
    if (!form.ssh_port || form.ssh_port < 1 || form.ssh_port > 65535)
      e.ssh_port = "SSH port must be between 1 and 65535.";
    setFormErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleAddSwitch(e: React.FormEvent) {
    e.preventDefault();
    setFormErrors({});
    if (!validateForm()) return;
    setSubmitAdding(true);

    try {
      const payload: CreateSwitchPayload = {
        ...form,
        enable_password: form.enable_password || undefined,
      };
      await createCiscoSwitch(payload, accessToken);
      setShowAddModal(false);
      setForm({
        name: "",
        host: "",
        telnet_port: 23,
        ssh_port: 22,
        protocol_preference: "auto",
        username: "",
        password: "",
        enable_password: "",
      });
      await loadSwitches();
      toast.success("Cisco switch has been added successfully.");
    } catch (err: any) {
      setFormErrors({ general: err.message || "Failed to add switch." });
    } finally {
      setSubmitAdding(false);
    }
  }

  async function handleTestConnection(id: number) {
    const toastId = toast.loading("Testing connection...");
    try {
      const res = await testCiscoConnection(id, accessToken);
      setSwitches((prev) =>
        prev.map((sw) =>
          sw.id === id
            ? {
                ...sw,
                status: res.status,
                health_protocol_used: res.protocol_used,
                last_response_time_ms: res.response_time_ms,
                last_error: res.last_error,
                last_checked_at: new Date().toISOString(),
                device_hostname:
                  res.device_info?.hostname ?? sw.device_hostname,
                device_model: res.device_info?.model ?? sw.device_model,
                ios_version: res.device_info?.ios_version ?? sw.ios_version,
                serial_number:
                  res.device_info?.serial_number ?? sw.serial_number,
              }
            : sw,
        ),
      );
      if (res.success) {
        toast.success(res.message || "Connection successful!", { id: toastId });
      } else {
        toast.error(res.message || "Connection failed.", { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to test connection.", { id: toastId });
    }
  }

  async function handleDeleteSwitch(id: number): Promise<boolean> {
    const toastId = toast.loading("Deleting switch...");
    try {
      await deleteCiscoSwitch(id, accessToken);
      await loadSwitches(null);
      toast.success("Cisco switch has been deleted.", { id: toastId });
      return true;
    } catch (err: any) {
      toast.error(err.message || "Failed to delete switch.", { id: toastId });
      return false;
    }
  }

  // ── Filtering ──

  const filtered = switches.filter((sw) => {
    if (filter !== "all" && sw.status !== filter) return false;
    if (
      searchTerm &&
      !sw.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !sw.host.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const selectedSwitch =
    filtered.find((s) => s.id === selectedSwitchId) ||
    switches.find((s) => s.id === selectedSwitchId) ||
    null;

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* ══════════ Toolbar ══════════ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search switches..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-64"
            />
          </div>

          {/* Filter pills */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(["all", "active", "inactive", "error"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                  filter === f
                    ? "bg-white shadow-sm text-slate-900"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          )}

          <button
            onClick={() => loadSwitches()}
            className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw size={14} /> Refresh
          </button>

          {isAdmin && (
            <button
              onClick={() => {
                setFormErrors({});
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Add Switch
            </button>
          )}
        </div>
      </div>

      {/* ══════════ Global error ══════════ */}
      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {globalError}
        </div>
      )}

      {/* ══════════ Switch Cards ══════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {filtered.map((sw) => (
          <div
            key={sw.id}
            className={cn(
              "bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer",
              selectedSwitch && selectedSwitch.id === sw.id
                ? "ring-2 ring-red-500"
                : "",
            )}
            onClick={() => setSelectedSwitchId(sw.id)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Network
                  size={18}
                  className={cn(
                    sw.status === "active"
                      ? "text-green-500"
                      : sw.status === "error"
                        ? "text-red-500"
                        : "text-slate-400",
                  )}
                />
                <h3 className="font-semibold text-slate-900 font-mono text-sm">
                  {sw.name}
                </h3>
              </div>
              <StatusBadge status={sw.status as StatusType} />
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Host</span>
                <span className="font-mono text-slate-700 text-right break-all text-xs">
                  {sw.host}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Protocol</span>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium uppercase",
                    sw.protocol_preference === "ssh"
                      ? "bg-green-100 text-green-700"
                      : sw.protocol_preference === "telnet"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-slate-100 text-slate-700",
                  )}
                >
                  {sw.protocol_preference}
                </span>
              </div>

              {sw.device_model && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Model</span>
                  <span className="font-mono text-slate-700 text-xs">
                    {sw.device_model}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-slate-500">Health</span>
                {sw.status === "active" ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <XCircle size={16} className="text-slate-400" />
                )}
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Response</span>
                <span
                  className={cn(
                    "font-mono font-medium text-xs",
                    !sw.last_response_time_ms || sw.last_response_time_ms === 0
                      ? "text-red-500"
                      : sw.last_response_time_ms > 100
                        ? "text-amber-500"
                        : "text-green-600",
                  )}
                >
                  {!sw.last_response_time_ms || sw.last_response_time_ms === 0
                    ? "N/A"
                    : `${sw.last_response_time_ms}ms`}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between items-center gap-2">
              <span className="min-w-0 truncate">
                Checked:{" "}
                {sw.last_checked_at
                  ? new Date(sw.last_checked_at).toLocaleString()
                  : "Never"}
              </span>

              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestConnection(sw.id);
                  }}
                  className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 shrink-0 font-medium"
                >
                  <Activity size={14} />
                  Test
                </button>
              )}
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-400">
            <Network size={48} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No switches found</p>
          </div>
        )}
      </div>

      {/* ══════════ Configuration + Details Panels ══════════ */}
      {selectedSwitch && (
        <div className="space-y-4">
          <SwitchConfigurationPanel
            sw={selectedSwitch}
            isAdmin={isAdmin}
            accessToken={accessToken}
          />

          {isAdmin && (
            <SwitchDetailsPanel
              sw={selectedSwitch}
              accessToken={accessToken}
              onDeleteSwitch={handleDeleteSwitch}
            />
          )}
        </div>
      )}

      {/* ══════════ Add Switch Modal ══════════ */}
      {showAddModal && isAdmin && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Plus size={20} className="text-red-700" />
              Add Cisco Switch
            </h2>

            {formErrors.general && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {formErrors.general}
              </div>
            )}

            <form onSubmit={handleAddSwitch} className="space-y-3 text-sm">
              {/* Name + Host */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. Core-Switch-1"
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.name
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.name && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.name}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Host <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={form.host}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, host: e.target.value }))
                    }
                    placeholder="e.g. 192.168.1.1"
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.host
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.host && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.host}
                    </div>
                  )}
                </div>
              </div>

              {/* Telnet + SSH ports */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Telnet Port
                  </label>
                  <input
                    type="number"
                    value={form.telnet_port}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telnet_port: Number(e.target.value),
                      }))
                    }
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.telnet_port
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.telnet_port && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.telnet_port}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    SSH Port
                  </label>
                  <input
                    type="number"
                    value={form.ssh_port}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ssh_port: Number(e.target.value),
                      }))
                    }
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.ssh_port
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.ssh_port && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.ssh_port}
                    </div>
                  )}
                </div>
              </div>

              {/* Protocol preference */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Protocol Preference
                </label>
                <select
                  value={form.protocol_preference}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      protocol_preference: e.target.value as ProtocolPreference,
                    }))
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="auto">Auto (SSH then Telnet)</option>
                  <option value="ssh">SSH only</option>
                  <option value="telnet">Telnet only</option>
                </select>
              </div>

              {/* Username + Password */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Username <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={form.username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.username
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.username && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.username}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    className={cn(
                      "w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2",
                      formErrors.password
                        ? "border-red-400 focus:ring-red-500"
                        : "border-slate-300 focus:ring-red-500",
                    )}
                  />
                  {formErrors.password && (
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.password}
                    </div>
                  )}
                </div>
              </div>

              {/* Enable Password */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Enable Password{" "}
                  <span className="text-slate-400 text-xs">(optional)</span>
                </label>
                <input
                  type="password"
                  value={form.enable_password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, enable_password: e.target.value }))
                  }
                  placeholder="Leave empty to use login password"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitAdding}
                  className="px-4 py-2 text-sm font-semibold bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitAdding && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {submitAdding ? "Adding..." : "Add Switch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────

function StatusBadge({ status }: { status: StatusType }) {
  return (
    <span
      className={cn(
        "text-xs font-medium px-2.5 py-1 rounded-full capitalize",
        status === "active"
          ? "bg-green-100 text-green-700"
          : status === "error"
            ? "bg-red-100 text-red-700"
            : "bg-slate-100 text-slate-600",
      )}
    >
      {status}
    </span>
  );
}

// ─── Config Row ─────────────────────────────────────────

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-medium text-slate-900 text-right break-all max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

// ─── Switch Configuration Panel ─────────────────────────

function SwitchConfigurationPanel({
  sw,
  isAdmin,
  accessToken,
}: {
  sw: CiscoSwitch;
  isAdmin: boolean;
  accessToken: string | null;
}) {
  const responseTime =
    !sw.last_response_time_ms || sw.last_response_time_ms === 0
      ? "N/A"
      : `${sw.last_response_time_ms} ms`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900 text-lg flex items-center gap-2">
            <Monitor size={20} className="text-red-600" />
            {sw.name} — Configuration
          </h3>
          <p className="text-sm text-slate-500">
            {sw.host} (SSH:{sw.ssh_port} / Telnet:{sw.telnet_port})
          </p>
        </div>
        <StatusBadge status={sw.status as StatusType} />
      </div>

      {/* Config grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5">
        {/* General */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
            <Settings2 size={14} />
            General Settings
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Switch Name" value={sw.name} />
            <ConfigRow label="Host" value={sw.host} />
            <ConfigRow label="SSH Port" value={String(sw.ssh_port)} />
            <ConfigRow label="Telnet Port" value={String(sw.telnet_port)} />
            <ConfigRow label="Username" value={sw.username} />
            <ConfigRow label="Response Time" value={responseTime} />
            <ConfigRow
              label="Last Checked"
              value={
                sw.last_checked_at
                  ? new Date(sw.last_checked_at).toLocaleString()
                  : "Never"
              }
            />
          </div>
        </div>

        {/* Protocol & Health */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
            <Shield size={14} />
            Protocol & Health
          </h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-green-500" />
                <span className="text-sm text-slate-700">
                  Preferred Protocol
                </span>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 uppercase">
                {sw.protocol_preference}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Unlock
                  size={16}
                  className={
                    sw.health_protocol_used === "telnet"
                      ? "text-amber-500"
                      : "text-slate-400"
                  }
                />
                <span className="text-sm text-slate-700">Protocol Used</span>
              </div>
              <span className="text-xs text-slate-600">
                {sw.health_protocol_used?.toUpperCase() || "N/A"}
              </span>
            </div>

            <ConfigRow label="Status" value={sw.status.toUpperCase()} />
            <ConfigRow label="Last Error" value={sw.last_error || "None"} />
          </div>
        </div>

        {/* Device Info */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
            <Cpu size={14} />
            Device Information
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Hostname" value={sw.device_hostname || "N/A"} />
            <ConfigRow label="Model" value={sw.device_model || "N/A"} />
            <ConfigRow label="IOS Version" value={sw.ios_version || "N/A"} />
            <ConfigRow
              label="Serial Number"
              value={sw.serial_number || "N/A"}
            />
          </div>
        </div>

        {/* Timestamps */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
            <Clock size={14} />
            Timestamps
          </h4>
          <div className="space-y-3">
            <ConfigRow
              label="Created"
              value={new Date(sw.created_at).toLocaleString()}
            />
            <ConfigRow
              label="Updated"
              value={new Date(sw.updated_at).toLocaleString()}
            />
            <ConfigRow
              label="Cache Updated"
              value={
                sw.cache_updated_at
                  ? new Date(sw.cache_updated_at).toLocaleString()
                  : "Never"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Switch Details Panel (Admin) ───────────────────────

function SwitchDetailsPanel({
  sw,
  accessToken,
  onDeleteSwitch,
}: {
  sw: CiscoSwitch;
  accessToken: string | null;
  onDeleteSwitch: (id: number) => Promise<boolean>;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Interfaces state
  const [interfaces, setInterfaces] = useState<{
    loading: boolean;
    error: string | null;
    data: InterfaceInfo[];
    protocol_used: string | null;
    cached_at: string | null;
  }>({
    loading: false,
    error: null,
    data: [],
    protocol_used: null,
    cached_at: null,
  });

  // VLANs state
  const [vlans, setVlans] = useState<{
    loading: boolean;
    error: string | null;
    data: VlanInfo[];
    protocol_used: string | null;
    cached_at: string | null;
  }>({
    loading: false,
    error: null,
    data: [],
    protocol_used: null,
    cached_at: null,
  });

  useEffect(() => {
    loadInterfaces();
    loadVlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sw.id]);

  async function loadInterfaces() {
    setInterfaces((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await getCiscoInterfaces(sw.id, accessToken);
      setInterfaces({
        loading: false,
        error: res.success ? null : res.error || "Failed to load interfaces.",
        data: res.interfaces || [],
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
      });
    } catch (err: any) {
      setInterfaces((s) => ({
        ...s,
        loading: false,
        error: err.message || "Failed to load interfaces.",
      }));
    }
  }

  async function loadVlans() {
    setVlans((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await getCiscoVlans(sw.id, accessToken);
      setVlans({
        loading: false,
        error: res.success ? null : res.error || "Failed to load VLANs.",
        data: res.vlans || [],
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
      });
    } catch (err: any) {
      setVlans((s) => ({
        ...s,
        loading: false,
        error: err.message || "Failed to load VLANs.",
      }));
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const deleted = await onDeleteSwitch(sw.id);
    setDeleting(false);
    if (deleted) {
      setShowDeleteDialog(false);
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900 text-lg flex items-center gap-2">
              <HardDrive size={20} className="text-red-600" />
              Interfaces & VLANs
            </h3>
            <p className="text-sm text-slate-500">Live data from the switch.</p>
          </div>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-2 text-sm font-medium text-red-600 hover:text-white bg-red-50 hover:bg-red-600 border border-red-200 hover:border-red-600 px-4 py-2 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
            Delete Switch
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* ── Interfaces Card ── */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="bg-white p-4 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Cable size={18} className="text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">Interfaces</h4>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={12} />
                    {interfaces.cached_at
                      ? new Date(interfaces.cached_at).toLocaleString()
                      : "N/A"}
                    {interfaces.protocol_used && (
                      <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] uppercase font-mono">
                        {interfaces.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-700">
                  {interfaces.data.length}
                </span>
                <span className="text-xs text-slate-500 block uppercase tracking-wider">
                  Total
                </span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
              {interfaces.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Loader2 size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Fetching interfaces...</span>
                </div>
              ) : interfaces.error ? (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{interfaces.error}</p>
                </div>
              ) : interfaces.data.length > 0 ? (
                <div className="space-y-2">
                  {interfaces.data.map((iface, idx) => {
                    const isUp =
                      iface.status.toLowerCase().includes("up") &&
                      iface.protocol.toLowerCase().includes("up");
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100"
                      >
                        <div className="flex items-center gap-3">
                          {isUp ? (
                            <Wifi size={16} className="text-green-500" />
                          ) : (
                            <WifiOff size={16} className="text-slate-400" />
                          )}
                          <div>
                            <span className="font-mono text-sm font-medium text-slate-800">
                              {iface.name}
                            </span>
                            {iface.ip_address && (
                              <span className="ml-2 text-xs text-slate-500">
                                {iface.ip_address}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase",
                              isUp
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {iface.status}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase",
                              iface.protocol.toLowerCase() === "up"
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {iface.protocol}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-slate-500">
                  No interface data available. Test connection first.
                </div>
              )}
            </div>
          </div>

          {/* ── VLANs Card ── */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="bg-white p-4 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <Layers size={18} className="text-purple-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">VLANs</h4>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={12} />
                    {vlans.cached_at
                      ? new Date(vlans.cached_at).toLocaleString()
                      : "N/A"}
                    {vlans.protocol_used && (
                      <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] uppercase font-mono">
                        {vlans.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-700">
                  {vlans.data.length}
                </span>
                <span className="text-xs text-slate-500 block uppercase tracking-wider">
                  VLANs
                </span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto max-h-[400px]">
              {vlans.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Loader2 size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Fetching VLANs...</span>
                </div>
              ) : vlans.error ? (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{vlans.error}</p>
                </div>
              ) : vlans.data.length > 0 ? (
                <div className="space-y-3">
                  {vlans.data.map((vlan) => (
                    <div
                      key={vlan.id}
                      className="p-3 bg-white rounded-lg border border-slate-100"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Hash size={14} className="text-purple-500" />
                          <span className="font-mono font-semibold text-slate-800 text-sm">
                            VLAN {vlan.id}
                          </span>
                          <span className="text-slate-600 text-sm">
                            — {vlan.name}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase",
                            vlan.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700",
                          )}
                        >
                          {vlan.status}
                        </span>
                      </div>
                      {vlan.ports.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {vlan.ports.map((port, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono"
                            >
                              {port}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-slate-500">
                  No VLAN data available. Test connection first.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={24} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Delete Switch
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Are you sure you want to delete <strong>{sw.name}</strong> (
                  {sw.host})? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
