// src/components/cisco/CiscoPortManagementSection.tsx
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Cable,
  Search,
  Lock,
  Unlock,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Filter,
  AlertTriangle,
  Network,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Settings2,
  Monitor,
  ArrowRightLeft,
  X,
  AlertCircle,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import {
  fetchCiscoSwitches,
  togglePortLock,
  bulkLockPorts,
  bulkUnlockPorts,
  type CiscoSwitch,
  type CiscoPortInfo,
} from "../../services/ciscoApi";
import { fetchVlans } from "../../services/ciscoVlanApi";
import { cn } from "../../utils/cn";

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${BASE}/api/v1/cisco`;
const PAGE_SIZE = 48;

// ─── Types ──────────────────────────────────────────────────────────────────

type PortStatus = "active" | "inactive" | "error";
type PortFilter = "all" | "locked" | "unlocked" | "active" | "inactive";

interface Port {
  id: string;
  number: number;
  label: string;
  status: PortStatus;
  locked: boolean;
  speed: string;
  vlan: string;
  macAddress: string | null;
  description: string;
}

interface PortPageCache {
  pages: Record<number, Port[]>;
  totalPages: number;
  totalCount: number;
  loading: boolean;
  error: string | null;
  syncing: boolean;
}

interface VlanOption {
  id: number;
  vlan_id: number;
  name: string;
  status: string;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function apiFetch<T>(
  url: string,
  token: string | null,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { ...authHeaders(token), ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.detail || b?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapCiscoStatus(raw: string): PortStatus {
  const s = raw.toLowerCase();
  if (s === "connected" || s === "up") return "active";
  if (s.includes("err") || s.includes("disabled")) return "error";
  return "inactive";
}

function apiPortToPort(p: CiscoPortInfo, switchId: number): Port {
  return {
    id: `${switchId}-${p.port_label}`,
    number: p.port_number,
    label: p.port_label,
    status: mapCiscoStatus(p.status),
    locked: p.locked,
    speed: p.speed || "—",
    vlan: p.vlan || "—",
    macAddress: p.mac_address,
    description: p.description || "",
  };
}

function parseJwt(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

function emptyPageCache(): PortPageCache {
  return {
    pages: {},
    totalPages: 1,
    totalCount: 0,
    loading: false,
    error: null,
    syncing: false,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<
  PortStatus,
  { icon: React.ReactNode; label: string; cls: string; dot: string }
> = {
  active: {
    icon: <CheckCircle size={12} />,
    label: "Active",
    cls: "bg-green-50 text-green-700 border border-green-200",
    dot: "bg-green-500",
  },
  inactive: {
    icon: <XCircle size={12} />,
    label: "Inactive",
    cls: "bg-slate-50 text-slate-500 border border-slate-200",
    dot: "bg-slate-400",
  },
  error: {
    icon: <AlertTriangle size={12} />,
    label: "Error",
    cls: "bg-red-50 text-red-700 border border-red-200",
    dot: "bg-red-500",
  },
};

const FILTERS: { value: PortFilter; label: string }[] = [
  { value: "all", label: "All Ports" },
  { value: "locked", label: "Locked" },
  { value: "unlocked", label: "Unlocked" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function PortStatusBadge({ status }: { status: PortStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.cls}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function LockBadge({ locked }: { locked: boolean }) {
  return locked ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
      <Lock size={11} /> Locked
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
      <Unlock size={11} /> Open
    </span>
  );
}

// ─── Running Config Modal ─────────────────────────────────────────────────────

function RunningConfigModal({
  open,
  onClose,
  port,
  switchId,
  switchName,
  token,
}: {
  open: boolean;
  onClose: () => void;
  port: Port | null;
  switchId: number;
  switchName: string;
  token: string | null;
}) {
  const [config, setConfig] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !port) return;
    setConfig(null);
    setError(null);
    setLoading(true);

    const encodedLabel = encodeURIComponent(port.label);
    apiFetch<{ success: boolean; config?: string; error?: string }>(
      `${PREFIX}/switches/${switchId}/port-config?port_label=${encodedLabel}`,
      token,
    )
      .then((data) => {
        if (data.success && data.config) {
          setConfig(data.config);
        } else {
          setError(data.error || "No config returned");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, port, switchId, token]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  if (!open || !port) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Terminal size={16} className="text-green-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Running Config
              </h3>
              <p className="text-xs text-slate-400">
                {switchName} — {port.label}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-950 p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 size={28} className="animate-spin mb-3 text-green-400" />
              <p className="text-sm">Fetching running config from switch…</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-3 p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
              <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  Failed to fetch config
                </p>
                <p className="text-xs text-red-400 mt-1">{error}</p>
              </div>
            </div>
          )}

          {config && !loading && (
            <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
              {config}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <p className="text-xs text-slate-400">
            Live data from switch — not cached
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  onConfigure,
  showConfigure = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  onConfigure?: () => void;
  showConfigure?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
      role="alertdialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={24} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            ref={ref}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 rounded-lg"
          >
            Cancel
          </button>
          {showConfigure && onConfigure && (
            <button
              onClick={onConfigure}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-1.5"
            >
              <Settings2 size={14} />
              Configure
            </button>
          )}
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-lg"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Configure Port Modal ─────────────────────────────────────────────────────

function ConfigurePortModal({
  open,
  onClose,
  port,
  switchId,
  switchName,
  vlans,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  port: Port | null;
  switchId: number;
  switchName: string;
  vlans: VlanOption[];
  onSave: (
    portLabel: string,
    data: {
      mode: "access" | "trunk";
      access_vlan?: number;
      trunk_allowed_vlans?: number[];
      trunk_native_vlan?: number;
      description?: string;
    },
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"access" | "trunk">("access");
  const [accessVlan, setAccessVlan] = useState(1);
  const [trunkNative, setTrunkNative] = useState(1);
  const [trunkAllowed, setTrunkAllowed] = useState<Set<number>>(new Set());
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && port) {
      setMode("access");
      setAccessVlan(1);
      setTrunkNative(1);
      setTrunkAllowed(new Set());
      setDescription(port.description || "");
      setError("");
    }
  }, [open, port]);

  if (!open || !port) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "trunk" && trunkAllowed.size === 0) {
      setError("Select at least one VLAN for the trunk.");
      return;
    }
    setSubmitting(true);
    try {
      await onSave(port.label, {
        mode,
        access_vlan: mode === "access" ? accessVlan : undefined,
        trunk_allowed_vlans:
          mode === "trunk"
            ? Array.from(trunkAllowed).sort((a, b) => a - b)
            : undefined,
        trunk_native_vlan: mode === "trunk" ? trunkNative : undefined,
        description,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to configure port.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleVlan = (vid: number) =>
    setTrunkAllowed((prev) => {
      const next = new Set(prev);
      next.has(vid) ? next.delete(vid) : next.add(vid);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Settings2 size={16} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Configure Port
              </h3>
              <p className="text-xs text-slate-500">
                {switchName} — {port.label}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto flex-1"
        >
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Engineering Lab uplink"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Port Mode
            </label>
            <div className="flex gap-2">
              {(["access", "trunk"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                    mode === m
                      ? m === "access"
                        ? "bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-200"
                        : "bg-purple-50 border-purple-300 text-purple-700 ring-2 ring-purple-200"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {m === "access" ? (
                    <Monitor size={16} />
                  ) : (
                    <ArrowRightLeft size={16} />
                  )}
                  {m === "access" ? "Access" : "Trunk"}
                </button>
              ))}
            </div>
          </div>

          {mode === "access" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Access VLAN
              </label>
              <select
                value={accessVlan}
                onChange={(e) => setAccessVlan(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {vlans.map((v) => (
                  <option key={v.vlan_id} value={v.vlan_id}>
                    VLAN {v.vlan_id} — {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "trunk" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Native VLAN
                </label>
                <select
                  value={trunkNative}
                  onChange={(e) => setTrunkNative(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {vlans.map((v) => (
                    <option key={v.vlan_id} value={v.vlan_id}>
                      VLAN {v.vlan_id} — {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Allowed VLANs
                </label>
                <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {vlans.map((v) => (
                    <label
                      key={v.vlan_id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={trunkAllowed.has(v.vlan_id)}
                        onChange={() => toggleVlan(v.vlan_id)}
                        className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-slate-700">
                        <span className="font-mono font-medium">
                          {v.vlan_id}
                        </span>{" "}
                        — {v.name}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {trunkAllowed.size} VLAN{trunkAllowed.size !== 1 ? "s" : ""}{" "}
                  selected
                </p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Applying…" : "Apply Configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Port Grid ────────────────────────────────────────────────────────────────
// NOTE: Grid appearance is UNCHANGED. Locked ports only have their click
// handler blocked — they still look exactly the same as before.

function PortGrid({
  ports,
  onToggle,
  isAdmin,
}: {
  ports: Port[];
  onToggle: (label: string) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-24 gap-1.5">
      {ports.map((p) => {
        const d = STATUS_CFG[p.status];
        // A locked port can never be clicked regardless of admin status.
        // The visual appearance is identical to the original — no change.
        const clickable = isAdmin && !p.locked;

        return (
          <button
            key={p.id}
            onClick={() => clickable && onToggle(p.label)}
            disabled={!clickable}
            title={`Port ${p.number} — ${p.status}${p.locked ? " (Locked)" : ""}${clickable ? "\nClick to toggle lock" : p.locked ? "\nPort is locked" : ""}`}
            className={`relative w-full aspect-square rounded-lg border-2 flex flex-col items-center justify-center text-xs font-medium transition-all duration-150 ${
              clickable
                ? "hover:scale-110 hover:shadow-md cursor-pointer"
                : "cursor-not-allowed opacity-75"
            } focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 ${
              p.locked
                ? "border-red-300 bg-red-50"
                : p.status === "active"
                  ? "border-green-300 bg-green-50"
                  : p.status === "error"
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-slate-50"
            }`}
          >
            <span className={`w-2 h-2 rounded-full mb-0.5 ${d.dot}`} />
            <span className="text-[10px] text-slate-700">{p.number}</span>
            {p.locked && (
              <Lock
                size={8}
                className="absolute top-0.5 right-0.5 text-red-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Port Table ───────────────────────────────────────────────────────────────

function PortTable({
  ports,
  onToggle,
  onConfigure,
  onViewConfig,
  isAdmin,
}: {
  ports: Port[];
  onToggle: (label: string) => void;
  onConfigure: (port: Port) => void;
  onViewConfig: (port: Port) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {[
              "Port",
              "Label",
              "Status",
              "Access",
              "Speed",
              "VLAN",
              "MAC Address",
              "Description",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                className="text-left px-3 py-2.5 font-semibold text-slate-600 text-xs uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ports.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-center py-8 text-slate-400">
                No ports match the current filter
              </td>
            </tr>
          ) : (
            ports.map((p) => (
              <tr
                key={p.id}
                className={`hover:bg-slate-50 transition-colors ${p.locked ? "bg-red-50/30" : ""}`}
              >
                <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                  {p.number}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                  {p.label}
                </td>
                <td className="px-3 py-2.5">
                  <PortStatusBadge status={p.status} />
                </td>
                <td className="px-3 py-2.5">
                  <LockBadge locked={p.locked} />
                </td>
                <td className="px-3 py-2.5 text-slate-600">{p.speed}</td>
                <td className="px-3 py-2.5 text-slate-600">{p.vlan}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                  {p.macAddress ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-500">
                  {p.description || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {/* Lock / Unlock — admin only */}
                    {isAdmin && (
                      <button
                        onClick={() => onToggle(p.label)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                          p.locked
                            ? "bg-green-100 text-green-700 hover:bg-green-200 focus:ring-green-500"
                            : "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-500"
                        }`}
                      >
                        {p.locked ? (
                          <>
                            <Unlock size={12} /> Unlock
                          </>
                        ) : (
                          <>
                            <Lock size={12} /> Lock
                          </>
                        )}
                      </button>
                    )}

                    {/* Configure — disabled when port is locked */}
                    <button
                      onClick={() => !p.locked && onConfigure(p)}
                      disabled={p.locked}
                      title={
                        p.locked
                          ? "Port is locked — unlock before configuring"
                          : "Configure port VLAN"
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                        p.locked
                          ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                          : "bg-blue-100 text-blue-700 hover:bg-blue-200",
                      )}
                    >
                      <Settings2 size={12} /> Configure
                    </button>

                    {/* Running Config — disabled when port is locked */}
                    <button
                      onClick={() => !p.locked && onViewConfig(p)}
                      disabled={p.locked}
                      title={
                        p.locked
                          ? "Port is locked — unlock to view config"
                          : "View running config"
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1",
                        p.locked
                          ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                          : "bg-slate-800 text-slate-100 hover:bg-slate-900",
                      )}
                    >
                      <Terminal size={12} /> Config
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages} · {PAGE_SIZE} ports per page
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} className="text-slate-600" />
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let p: number;
          if (totalPages <= 7) p = i + 1;
          else if (page <= 4) p = i + 1;
          else if (page >= totalPages - 3) p = totalPages - 6 + i;
          else p = page - 3 + i;
          return (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors border ${
                p === page
                  ? "bg-red-700 text-white border-red-700"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRightIcon size={16} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
}

// ─── Switch Detail View ───────────────────────────────────────────────────────

function SwitchPortDetail({
  sw,
  pageCache,
  currentPage,
  isAdmin,
  vlans,
  token,
  onBack,
  onSync,
  onPageChange,
  onToggle,
  onConfigure,
  onBulkLock,
  onBulkUnlock,
}: {
  sw: CiscoSwitch;
  pageCache: PortPageCache;
  currentPage: number;
  isAdmin: boolean;
  vlans: VlanOption[];
  token: string | null;
  onBack: () => void;
  onSync: () => void;
  onPageChange: (p: number) => void;
  onToggle: (label: string) => void;
  onConfigure: (port: Port) => void;
  onBulkLock: () => void;
  onBulkUnlock: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PortFilter>("all");
  const [view, setView] = useState<"grid" | "table">("table");
  const [runningConfigPort, setRunningConfigPort] = useState<Port | null>(null);

  const currentPorts = pageCache.pages[currentPage] ?? [];

  const filtered = useMemo(() => {
    let r = currentPorts;
    if (filter === "locked") r = r.filter((p) => p.locked);
    else if (filter === "unlocked") r = r.filter((p) => !p.locked);
    else if (filter === "active") r = r.filter((p) => p.status === "active");
    else if (filter === "inactive")
      r = r.filter((p) => p.status === "inactive");
    const q = search.toLowerCase().trim();
    if (q)
      r = r.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          String(p.number).includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.macAddress && p.macAddress.toLowerCase().includes(q)),
      );
    return r;
  }, [currentPorts, filter, search]);

  const allLoadedPorts = useMemo(
    () => Object.values(pageCache.pages).flat(),
    [pageCache.pages],
  );

  const stats = useMemo(() => {
    const s = { active: 0, inactive: 0, error: 0, locked: 0, unlocked: 0 };
    for (const p of allLoadedPorts) {
      s[p.status]++;
      p.locked ? s.locked++ : s.unlocked++;
    }
    return s;
  }, [allLoadedPorts]);

  const loadingPage = pageCache.loading;

  // Only show running config for unlocked ports
  const handleViewConfig = useCallback((port: Port) => {
    if (port.locked) return;
    setRunningConfigPort(port);
  }, []);

  return (
    <div className="space-y-6">
      {/* Back + Title */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3 rounded-lg px-2 py-1"
        >
          <ArrowLeft size={16} /> Back to all switches
        </button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Network className="text-red-700" size={24} />
              {sw.name}
            </h2>
            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
              <span className="font-mono">{sw.host}</span>
              <span>•</span>
              <span>{sw.device_model || "Unknown"}</span>
              {pageCache.totalCount > 0 && (
                <>
                  <span>•</span>
                  <span>{pageCache.totalCount} ports in DB</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onSync}
              disabled={pageCache.syncing}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-medium disabled:opacity-60"
            >
              <RefreshCw
                size={14}
                className={pageCache.syncing ? "animate-spin" : ""}
              />
              {pageCache.syncing ? "Syncing…" : "Sync from Switch"}
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={onBulkUnlock}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-xs font-medium"
                >
                  <Unlock size={14} /> Unlock All
                </button>
                <button
                  onClick={onBulkLock}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-medium"
                >
                  <Lock size={14} /> Lock All
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          {
            label: "Total Ports",
            value: pageCache.totalCount,
            color: "text-slate-900",
          },
          { label: "Active", value: stats.active, color: "text-green-700" },
          { label: "Inactive", value: stats.inactive, color: "text-slate-500" },
          { label: "Locked", value: stats.locked, color: "text-red-700" },
          { label: "Unlocked", value: stats.unlocked, color: "text-green-700" },
          {
            label: "Page",
            value: `${currentPage}/${pageCache.totalPages}`,
            color: "text-blue-700",
          },
          {
            label: "Loaded",
            value: allLoadedPorts.length,
            color: "text-purple-700",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm"
          >
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-0.5`}>
              {loadingPage && s.label === "Total Ports" ? "…" : s.value}
            </p>
          </div>
        ))}
      </div>

      {pageCache.syncing && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3 text-sm text-blue-700">
          <Loader2 size={16} className="animate-spin shrink-0" />
          Fetching live port data from switch and saving to database…
        </div>
      )}

      {pageCache.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} />
          {pageCache.error}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search by port, label, MAC, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as PortFilter)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden">
          {(["table", "grid"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-red-700 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Port View */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loadingPage ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">
              Loading page {currentPage} ({PAGE_SIZE} ports)…
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="p-4">
            <PortGrid ports={filtered} onToggle={onToggle} isAdmin={isAdmin} />
            {filtered.length === 0 && (
              <p className="text-center py-8 text-slate-400 text-sm">
                No ports match the current filter
              </p>
            )}
          </div>
        ) : (
          <PortTable
            ports={filtered}
            onToggle={onToggle}
            onConfigure={onConfigure}
            onViewConfig={handleViewConfig}
            isAdmin={isAdmin}
          />
        )}

        <Pagination
          page={currentPage}
          totalPages={pageCache.totalPages}
          onChange={onPageChange}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="font-medium text-slate-700">Legend:</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Active
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Inactive
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Error
        </span>
        <span className="flex items-center gap-1">
          <Lock size={10} className="text-red-500" /> Locked
        </span>
      </div>

      {/* Running Config Modal — only opens for unlocked ports */}
      <RunningConfigModal
        open={!!runningConfigPort}
        onClose={() => setRunningConfigPort(null)}
        port={runningConfigPort}
        switchId={sw.id}
        switchName={sw.name}
        token={token}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CiscoPortManagementSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const isAdmin = jwt?.role === "ADMIN" || jwt?.role === "SUPER_ADMIN";

  const [switches, setSwitches] = useState<CiscoSwitch[]>([]);
  const [switchesLoading, setSwitchesLoading] = useState(true);

  const cacheMapRef = useRef<Record<number, PortPageCache>>({});
  const [cacheMap, _setCacheMap] = useState<Record<number, PortPageCache>>({});

  const setCacheMap = useCallback(
    (
      updater: (
        prev: Record<number, PortPageCache>,
      ) => Record<number, PortPageCache>,
    ) => {
      const next = updater(cacheMapRef.current);
      cacheMapRef.current = next;
      _setCacheMap(next);
    },
    [],
  );

  const [pageMap, setPageMap] = useState<Record<number, number>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
    port?: Port;
  } | null>(null);

  const [configurePort, setConfigurePort] = useState<{
    port: Port;
    switchId: number;
  } | null>(null);
  const [vlans, setVlans] = useState<VlanOption[]>([]);

  // ── Load switches ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    setSwitchesLoading(true);
    apiFetch<{ switches: CiscoSwitch[] }>(`${PREFIX}/switches`, accessToken)
      .then((d) => setSwitches(d.switches ?? []))
      .catch(() => toast.error("Failed to load switches"))
      .finally(() => setSwitchesLoading(false));
  }, [accessToken]);

  // ── Load VLANs ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    fetchVlans("")
      .then((d) => setVlans(d.vlans ?? []))
      .catch(() => {});
  }, [accessToken]);

  // ── Load a DB page ─────────────────────────────────────────────────────────

  const loadDbPage = useCallback(
    async (switchId: number, page: number) => {
      const existing = cacheMapRef.current[switchId];
      if (existing?.pages[page] && !existing.loading) {
        setPageMap((prev) => ({ ...prev, [switchId]: page }));
        return;
      }

      setCacheMap((prev) => ({
        ...prev,
        [switchId]: {
          ...(prev[switchId] ?? emptyPageCache()),
          loading: true,
          error: null,
        },
      }));

      try {
        const data = await apiFetch<{
          success: boolean;
          port_count: number;
          ports: CiscoPortInfo[];
          page: number;
          page_size: number;
          total_pages: number;
          error?: string;
        }>(
          `${PREFIX}/switches/${switchId}/ports-db?page=${page}&page_size=${PAGE_SIZE}`,
          accessToken,
        );

        if (!data.success) throw new Error(data.error ?? "Failed");

        const mapped = data.ports.map((p) => apiPortToPort(p, switchId));

        setCacheMap((prev) => ({
          ...prev,
          [switchId]: {
            ...(prev[switchId] ?? emptyPageCache()),
            pages: { ...(prev[switchId]?.pages ?? {}), [page]: mapped },
            totalCount: data.port_count,
            totalPages: data.total_pages,
            loading: false,
            error: null,
            syncing: false,
          },
        }));
        setPageMap((prev) => ({ ...prev, [switchId]: page }));
      } catch (err: any) {
        setCacheMap((prev) => ({
          ...prev,
          [switchId]: {
            ...(prev[switchId] ?? emptyPageCache()),
            loading: false,
            error: err.message,
          },
        }));
      }
    },
    [accessToken, setCacheMap],
  );

  // ── Sync ports ─────────────────────────────────────────────────────────────

  const syncPorts = useCallback(
    async (switchId: number) => {
      setCacheMap((prev) => ({
        ...prev,
        [switchId]: {
          ...(prev[switchId] ?? emptyPageCache()),
          syncing: true,
          error: null,
        },
      }));

      try {
        await apiFetch(
          `${PREFIX}/switches/${switchId}/sync-ports`,
          accessToken,
          { method: "POST" },
        );
        setCacheMap((prev) => ({
          ...prev,
          [switchId]: { ...emptyPageCache(), syncing: false },
        }));
        setPageMap((prev) => ({ ...prev, [switchId]: 1 }));
        setTimeout(() => loadDbPage(switchId, 1), 0);
        toast.success("Ports synced and saved to database.");
      } catch (err: any) {
        setCacheMap((prev) => ({
          ...prev,
          [switchId]: {
            ...(prev[switchId] ?? emptyPageCache()),
            syncing: false,
            error: err.message,
          },
        }));
        toast.error(err.message || "Sync failed");
      }
    },
    [accessToken, loadDbPage, setCacheMap],
  );

  // ── Select switch ──────────────────────────────────────────────────────────

  const selectSwitch = useCallback(
    (id: number) => {
      setSelectedId(id);
      const page = pageMap[id] ?? 1;
      loadDbPage(id, page);
    },
    [loadDbPage, pageMap],
  );

  const toggleExpand = useCallback(
    (id: number) => {
      const next = expandedId === id ? null : id;
      setExpandedId(next);
      if (next !== null) loadDbPage(next, pageMap[next] ?? 1);
    },
    [expandedId, loadDbPage, pageMap],
  );

  // ── Toggle lock ────────────────────────────────────────────────────────────

  const handleToggle = useCallback(
    (switchId: number, portLabel: string) => {
      if (!isAdmin) {
        toast.error("Only administrators can lock/unlock ports.");
        return;
      }

      const cache = cacheMapRef.current[switchId];
      const page = pageMap[switchId] ?? 1;
      const port = cache?.pages[page]?.find((p) => p.label === portLabel);
      if (!port) return;

      const action = port.locked ? "unlock" : "lock";
      const sw = switches.find((s) => s.id === switchId);

      setConfirmAction({
        title: `${action === "lock" ? "Lock" : "Unlock"} Port ${port.number}`,
        message: `${action === "lock" ? "Lock" : "Unlock"} port ${port.label} on ${sw?.name || "switch"}?`,
        confirmLabel: action === "lock" ? "Lock Port" : "Unlock Port",
        port: port,
        action: async () => {
          setConfirmAction(null);
          try {
            const encodedLabel = encodeURIComponent(portLabel);
            const res = await apiFetch<{
              success: boolean;
              locked: boolean;
              message: string;
            }>(
              `${PREFIX}/switches/${switchId}/ports/${encodedLabel}/toggle-lock`,
              accessToken,
              { method: "POST" },
            );
            if (res.success) {
              setCacheMap((prev) => {
                const swCache = prev[switchId];
                if (!swCache) return prev;
                const updatedPages = { ...swCache.pages };
                for (const pg in updatedPages) {
                  updatedPages[pg] = updatedPages[pg].map((p) =>
                    p.label === portLabel ? { ...p, locked: res.locked } : p,
                  );
                }
                return {
                  ...prev,
                  [switchId]: { ...swCache, pages: updatedPages },
                };
              });
              toast.success(res.message);
            } else {
              toast.error("Failed to toggle lock");
            }
          } catch (err: any) {
            toast.error(err.message || "Failed to toggle lock");
          }
        },
      });
    },
    [pageMap, switches, accessToken, isAdmin, setCacheMap],
  );

  // ── Bulk lock / unlock ─────────────────────────────────────────────────────

  const handleBulkLock = useCallback(
    (switchId: number) => {
      if (!isAdmin) {
        toast.error("Only administrators can lock/unlock ports.");
        return;
      }
      const sw = switches.find((s) => s.id === switchId);
      setConfirmAction({
        title: "Lock All Ports",
        message: `Lock ALL ports on ${sw?.name}?`,
        confirmLabel: "Lock All",
        action: async () => {
          setConfirmAction(null);
          const tid = toast.loading("Locking all ports…");
          try {
            const res = await apiFetch<{ success: boolean; message: string }>(
              `${PREFIX}/switches/${switchId}/bulk-lock`,
              accessToken,
              { method: "POST" },
            );
            toast.success(res.message, { id: tid });
            setCacheMap((prev) => ({
              ...prev,
              [switchId]: emptyPageCache(),
            }));
            loadDbPage(switchId, 1);
          } catch (err: any) {
            toast.error(err.message, { id: tid });
          }
        },
      });
    },
    [switches, accessToken, loadDbPage, isAdmin, setCacheMap],
  );

  const handleBulkUnlock = useCallback(
    (switchId: number) => {
      if (!isAdmin) {
        toast.error("Only administrators can lock/unlock ports.");
        return;
      }
      const sw = switches.find((s) => s.id === switchId);
      setConfirmAction({
        title: "Unlock All Ports",
        message: `Unlock ALL ports on ${sw?.name}?`,
        confirmLabel: "Unlock All",
        action: async () => {
          setConfirmAction(null);
          const tid = toast.loading("Unlocking all ports…");
          try {
            const res = await apiFetch<{ success: boolean; message: string }>(
              `${PREFIX}/switches/${switchId}/bulk-unlock`,
              accessToken,
              { method: "POST" },
            );
            toast.success(res.message, { id: tid });
            setCacheMap((prev) => ({
              ...prev,
              [switchId]: emptyPageCache(),
            }));
            loadDbPage(switchId, 1);
          } catch (err: any) {
            toast.error(err.message, { id: tid });
          }
        },
      });
    },
    [switches, accessToken, loadDbPage, isAdmin, setCacheMap],
  );

  // ── Configure port ─────────────────────────────────────────────────────────

  const handleConfigure = useCallback(
    async (
      portLabel: string,
      switchId: number,
      data: {
        mode: "access" | "trunk";
        access_vlan?: number;
        trunk_allowed_vlans?: number[];
        trunk_native_vlan?: number;
        description?: string;
      },
    ) => {
      const newVlan =
        data.mode === "trunk"
          ? (data.trunk_allowed_vlans ?? []).join(",")
          : String(data.access_vlan ?? 1);

      await apiFetch(
        `${PREFIX}/switches/${switchId}/change-vlan`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            port_label: portLabel,
            new_vlan: newVlan,
            vlan_type: data.mode === "trunk" ? "trunk" : "Access",
            description: data.description ?? "",
          }),
        },
      );
      toast.success(
        `Port ${portLabel} configured as ${data.mode} on VLAN ${newVlan}`,
      );
      const page = pageMap[switchId] ?? 1;
      setCacheMap((prev) => {
        const swCache = prev[switchId];
        if (!swCache) return prev;
        const updatedPages = { ...swCache.pages };
        delete updatedPages[page];
        return { ...prev, [switchId]: { ...swCache, pages: updatedPages } };
      });
      loadDbPage(switchId, page);
    },
    [accessToken, pageMap, loadDbPage, setCacheMap],
  );

  // ── Handle configure — guard against locked ports ──────────────────────────

  const handleConfigureRequest = useCallback((port: Port, switchId: number) => {
    if (port.locked) {
      toast.error(`Port ${port.label} is locked. Unlock it first.`);
      return;
    }
    setConfigurePort({ port, switchId });
  }, []);

  // ── Selected switch view ────────────────────────────────────────────────────

  const selectedSwitch =
    selectedId !== null ? switches.find((s) => s.id === selectedId) : null;
  const selectedCache =
    selectedId !== null ? (cacheMap[selectedId] ?? emptyPageCache()) : null;
  const selectedPage = selectedId !== null ? (pageMap[selectedId] ?? 1) : 1;

  if (selectedSwitch && selectedCache) {
    return (
      <>
        <SwitchPortDetail
          sw={selectedSwitch}
          pageCache={selectedCache}
          currentPage={selectedPage}
          isAdmin={isAdmin}
          vlans={vlans}
          token={accessToken}
          onBack={() => setSelectedId(null)}
          onSync={() => syncPorts(selectedSwitch.id)}
          onPageChange={(p) => loadDbPage(selectedSwitch.id, p)}
          onToggle={(label) => handleToggle(selectedSwitch.id, label)}
          onConfigure={(port) =>
            handleConfigureRequest(port, selectedSwitch.id)
          }
          onBulkLock={() => handleBulkLock(selectedSwitch.id)}
          onBulkUnlock={() => handleBulkUnlock(selectedSwitch.id)}
        />
        {confirmAction && (
          <ConfirmDialog
            {...confirmAction}
            onCancel={() => setConfirmAction(null)}
            // "Configure" shortcut in confirm dialog only shown for unlocked ports
            showConfigure={!!confirmAction.port && !confirmAction.port.locked}
            onConfigure={
              confirmAction.port && !confirmAction.port.locked
                ? () => {
                    setConfirmAction(null);
                    setConfigurePort({
                      port: confirmAction.port!,
                      switchId: selectedSwitch.id,
                    });
                  }
                : undefined
            }
          />
        )}
        <ConfigurePortModal
          open={!!configurePort && configurePort.switchId === selectedSwitch.id}
          onClose={() => setConfigurePort(null)}
          port={configurePort?.port ?? null}
          switchId={selectedSwitch.id}
          switchName={selectedSwitch.name}
          vlans={vlans}
          onSave={(label, data) =>
            handleConfigure(label, selectedSwitch.id, data)
          }
        />
      </>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────

  const allPorts = Object.values(cacheMap).flatMap((c) =>
    Object.values(c.pages).flat(),
  );
  const totalPortsLoaded = allPorts.length;
  const totalLocked = allPorts.filter((p) => p.locked).length;
  const totalActive = allPorts.filter((p) => p.status === "active").length;
  const totalTrunk = allPorts.filter(
    (p) => p.vlan.toLowerCase().includes("trunk") || p.vlan.includes(","),
  ).length;
  const totalAccess = totalPortsLoaded - totalTrunk;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Cable className="text-red-700" size={28} />
          Port Management
        </h1>
        <p className="text-slate-500 mt-1">
          View and control individual switch ports — sync from device,
          {isAdmin ? " lock/unlock and" : ""} configure VLANs
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <p className="text-sm text-slate-500">Total Switches</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {switches.length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm">
          <p className="text-sm text-green-600">Active Ports</p>
          <p className="text-2xl font-bold text-green-700 mt-1">
            {totalActive || "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4 shadow-sm">
          <p className="text-sm text-red-600">Locked Ports</p>
          <p className="text-2xl font-bold text-red-700 mt-1">
            {totalLocked || "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-blue-200 p-4 shadow-sm">
          <p className="text-sm text-blue-600">Access Ports</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">
            {totalPortsLoaded > 0 ? totalAccess : "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-sm">
          <p className="text-sm text-purple-600">Trunk Ports</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">
            {totalPortsLoaded > 0 ? totalTrunk : "—"}
          </p>
        </div>
      </div>

      {switchesLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={28} className="animate-spin mr-2" /> Loading switches…
        </div>
      )}

      {/* Switch list */}
      <div className="space-y-3">
        {switches.map((sw) => {
          const cache = cacheMap[sw.id];
          const isExp = expandedId === sw.id;
          const page1 = cache?.pages[1] ?? [];
          const lockedCount = page1.filter((p) => p.locked).length;
          const activeCount = page1.filter((p) => p.status === "active").length;

          return (
            <div
              key={sw.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="flex items-center justify-between p-4">
                <button
                  onClick={() => toggleExpand(sw.id)}
                  className="flex items-center gap-3 flex-1 text-left focus:outline-none"
                >
                  <span className="text-slate-400">
                    {isExp ? (
                      <ChevronDown size={18} />
                    ) : (
                      <ChevronRight size={18} />
                    )}
                  </span>
                  <Network size={20} className="text-red-700" />
                  <div>
                    <h3 className="font-semibold text-slate-900">{sw.name}</h3>
                    <p className="text-xs text-slate-500">
                      {sw.host} • {sw.device_model || "Unknown"}
                      {cache &&
                        cache.totalCount > 0 &&
                        ` • ${cache.totalCount} ports`}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-4">
                  {cache && !cache.loading && page1.length > 0 && (
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                      <span>{cache.totalCount} total</span>
                      <span className="text-green-600">
                        {activeCount} active
                      </span>
                      <span className="text-red-600">{lockedCount} locked</span>
                    </div>
                  )}
                  <button
                    onClick={() => selectSwitch(sw.id)}
                    className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    Manage Ports
                  </button>
                </div>
              </div>

              {isExp && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                  {cache?.loading ? (
                    <div className="flex items-center justify-center py-6 text-slate-400">
                      <Loader2 size={20} className="animate-spin mr-2" />
                      Loading page 1…
                    </div>
                  ) : cache?.error ? (
                    <div className="text-sm text-red-600 flex items-center gap-2">
                      <AlertTriangle size={16} />
                      {cache.error}
                      <button
                        onClick={() => syncPorts(sw.id)}
                        className="ml-2 text-xs underline text-blue-600 hover:text-blue-800"
                      >
                        Sync from switch
                      </button>
                    </div>
                  ) : page1.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                          Port Overview — Page 1 of {cache.totalPages}
                          {isAdmin && " (click to toggle lock)"}
                        </p>
                        {cache.totalPages > 1 && (
                          <span className="text-xs text-slate-400">
                            {cache.totalCount} ports total
                          </span>
                        )}
                      </div>
                      <PortGrid
                        ports={page1}
                        onToggle={(label) => handleToggle(sw.id, label)}
                        isAdmin={isAdmin}
                      />
                    </>
                  ) : (
                    <div className="text-center py-6">
                      <p className="text-sm text-slate-400 mb-3">
                        No port data in DB for this switch.
                      </p>
                      <button
                        onClick={() => syncPorts(sw.id)}
                        disabled={cache?.syncing}
                        className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                      >
                        <RefreshCw
                          size={14}
                          className={cache?.syncing ? "animate-spin" : ""}
                        />
                        {cache?.syncing ? "Syncing…" : "Sync from Switch"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!switchesLoading && switches.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Network size={48} className="mx-auto mb-3 opacity-40" />
            <p>
              No switches found. Add switches in the Switch Management section.
            </p>
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmDialog
          {...confirmAction}
          onCancel={() => setConfirmAction(null)}
          showConfigure={!!confirmAction.port && !confirmAction.port.locked}
          onConfigure={
            confirmAction.port && !confirmAction.port.locked && selectedId
              ? () => {
                  setConfirmAction(null);
                  setConfigurePort({
                    port: confirmAction.port!,
                    switchId: selectedId,
                  });
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
