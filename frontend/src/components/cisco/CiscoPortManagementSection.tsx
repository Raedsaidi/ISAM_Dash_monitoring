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
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import {
  fetchCiscoSwitches,
  fetchPortStatus,
  togglePortLock,
  bulkLockPorts,
  bulkUnlockPorts,
  type CiscoSwitch,
  type CiscoPortInfo,
} from "../../services/ciscoApi";

// ─── Types ──────────────────────────────────────────────

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

interface PortCache {
  ports: Port[];
  loading: boolean;
  error: string | null;
}

// ─── Helpers ────────────────────────────────────────────

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

// ─── Constants ──────────────────────────────────────────

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

// ─── Small Sub-components ───────────────────────────────

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
      <Lock size={11} />
      Locked
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
      <Unlock size={11} />
      Open
    </span>
  );
}

// ─── Confirm Dialog ─────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
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

// ─── Port Grid ──────────────────────────────────────────

function PortGrid({
  ports,
  onToggle,
}: {
  ports: Port[];
  onToggle: (label: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-24 gap-1.5">
      {ports.map((p) => {
        const d = STATUS_CFG[p.status];
        return (
          <button
            key={p.id}
            onClick={() => onToggle(p.label)}
            title={`Port ${p.number} — ${p.status}${p.locked ? " (Locked)" : ""}\nClick to toggle lock`}
            className={`relative w-full aspect-square rounded-lg border-2 flex flex-col items-center justify-center text-xs font-medium transition-all duration-150 hover:scale-110 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 ${
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

// ─── Port Table ─────────────────────────────────────────

function PortTable({
  ports,
  onToggle,
  isAdmin,
}: {
  ports: Port[];
  onToggle: (label: string) => void;
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
              ...(isAdmin ? ["Action"] : []),
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
                {isAdmin && (
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => onToggle(p.label)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
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
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Switch Detail View ─────────────────────────────────

function SwitchPortDetail({
  sw,
  ports,
  portsLoading,
  portsError,
  isAdmin,
  accessToken,
  onBack,
  onRefresh,
  onToggle,
  onBulkLock,
  onBulkUnlock,
}: {
  sw: CiscoSwitch;
  ports: Port[];
  portsLoading: boolean;
  portsError: string | null;
  isAdmin: boolean;
  accessToken: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onToggle: (label: string) => void;
  onBulkLock: () => void;
  onBulkUnlock: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PortFilter>("all");
  const [view, setView] = useState<"grid" | "table">("table");

  const filtered = useMemo(() => {
    let r = ports;
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
  }, [ports, filter, search]);

  const stats = useMemo(() => {
    const s = { active: 0, inactive: 0, error: 0, locked: 0, unlocked: 0 };
    for (const p of ports) {
      s[p.status]++;
      p.locked ? s.locked++ : s.unlocked++;
    }
    return s;
  }, [ports]);

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
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-medium"
            >
              <RefreshCw
                size={14}
                className={portsLoading ? "animate-spin" : ""}
              />{" "}
              Refresh
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          {
            label: "Total Ports",
            value: ports.length,
            color: "text-slate-900",
          },
          { label: "Active", value: stats.active, color: "text-green-700" },
          { label: "Inactive", value: stats.inactive, color: "text-slate-500" },
          { label: "Locked", value: stats.locked, color: "text-red-700" },
          { label: "Unlocked", value: stats.unlocked, color: "text-green-700" },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm"
          >
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-lg font-bold ${s.color} mt-0.5`}>
              {portsLoading ? "…" : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Error */}
      {portsError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} />
          {portsError}
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
              className={`px-3 py-2 text-xs font-medium transition-colors ${view === v ? "bg-red-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Port View */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {portsLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">Connecting to switch and fetching ports…</p>
          </div>
        ) : view === "grid" ? (
          <div className="p-4">
            <PortGrid ports={filtered} onToggle={onToggle} />
            {filtered.length === 0 && (
              <p className="text-center py-8 text-slate-400 text-sm">
                No ports match the current filter
              </p>
            )}
          </div>
        ) : (
          <PortTable ports={filtered} onToggle={onToggle} isAdmin={isAdmin} />
        )}
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
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export default function CiscoPortManagementSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const isAdmin = jwt?.role === "ADMIN" || jwt?.role === "SUPER_ADMIN";

  const [switches, setSwitches] = useState<CiscoSwitch[]>([]);
  const [switchesLoading, setSwitchesLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [portCache, setPortCache] = useState<Record<number, PortCache>>({});
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  // ── Load switches ──
  useEffect(() => {
    if (!accessToken) return;
    setSwitchesLoading(true);
    fetchCiscoSwitches(accessToken)
      .then(setSwitches)
      .catch(() => toast.error("Failed to load switches"))
      .finally(() => setSwitchesLoading(false));
  }, [accessToken]);

  // ── Load ports for a switch ──
  const loadPorts = useCallback(
    async (switchId: number, force = false) => {
      if (!force && portCache[switchId]?.ports.length > 0) return;

      setPortCache((prev) => ({
        ...prev,
        [switchId]: { ports: [], loading: true, error: null },
      }));

      try {
        const res = await fetchPortStatus(switchId, accessToken);
        if (res.success) {
          const mapped = res.ports.map((p) => apiPortToPort(p, switchId));
          setPortCache((prev) => ({
            ...prev,
            [switchId]: { ports: mapped, loading: false, error: null },
          }));
        } else {
          setPortCache((prev) => ({
            ...prev,
            [switchId]: {
              ports: [],
              loading: false,
              error: res.error || "Failed to fetch ports",
            },
          }));
        }
      } catch (err: any) {
        setPortCache((prev) => ({
          ...prev,
          [switchId]: { ports: [], loading: false, error: err.message },
        }));
      }
    },
    [accessToken, portCache],
  );

  // ── Select switch → load ports ──
  const selectSwitch = useCallback(
    (id: number) => {
      setSelectedId(id);
      loadPorts(id);
    },
    [loadPorts],
  );

  // ── Expand → load ports ──
  const toggleExpand = useCallback(
    (id: number) => {
      const next = expandedId === id ? null : id;
      setExpandedId(next);
      if (next !== null) loadPorts(next);
    },
    [expandedId, loadPorts],
  );

  // ── Toggle lock ──
  const handleToggle = useCallback(
    (switchId: number, portLabel: string) => {
      const cache = portCache[switchId];
      const port = cache?.ports.find((p) => p.label === portLabel);
      if (!port) return;

      const action = port.locked ? "unlock" : "lock";
      const sw = switches.find((s) => s.id === switchId);

      setConfirmAction({
        title: `${action === "lock" ? "Lock" : "Unlock"} Port ${port.number}`,
        message: `${action === "lock" ? "Lock" : "Unlock"} port ${port.label} on ${sw?.name || "switch"}? ${
          action === "lock"
            ? "This will block changes on this port."
            : "This will allow changes on this port."
        }`,
        confirmLabel: action === "lock" ? "Lock Port" : "Unlock Port",
        action: async () => {
          setConfirmAction(null);
          try {
            const res = await togglePortLock(switchId, portLabel, accessToken);
            if (res.success) {
              // Update cache locally
              setPortCache((prev) => ({
                ...prev,
                [switchId]: {
                  ...prev[switchId],
                  ports: prev[switchId].ports.map((p) =>
                    p.label === portLabel ? { ...p, locked: res.locked } : p,
                  ),
                },
              }));
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
    [portCache, switches, accessToken],
  );

  // ── Bulk lock/unlock ──
  const handleBulkLock = useCallback(
    (switchId: number) => {
      const sw = switches.find((s) => s.id === switchId);
      setConfirmAction({
        title: "Lock All Ports",
        message: `Lock ALL ports on ${sw?.name}? This blocks changes on every port.`,
        confirmLabel: "Lock All",
        action: async () => {
          setConfirmAction(null);
          const tid = toast.loading("Locking all ports…");
          try {
            const res = await bulkLockPorts(switchId, accessToken);
            toast.success(res.message, { id: tid });
            loadPorts(switchId, true);
          } catch (err: any) {
            toast.error(err.message, { id: tid });
          }
        },
      });
    },
    [switches, accessToken, loadPorts],
  );

  const handleBulkUnlock = useCallback(
    (switchId: number) => {
      const sw = switches.find((s) => s.id === switchId);
      setConfirmAction({
        title: "Unlock All Ports",
        message: `Unlock ALL ports on ${sw?.name}?`,
        confirmLabel: "Unlock All",
        action: async () => {
          setConfirmAction(null);
          const tid = toast.loading("Unlocking all ports…");
          try {
            const res = await bulkUnlockPorts(switchId, accessToken);
            toast.success(res.message, { id: tid });
            loadPorts(switchId, true);
          } catch (err: any) {
            toast.error(err.message, { id: tid });
          }
        },
      });
    },
    [switches, accessToken, loadPorts],
  );

  // ── Selected switch detail ──
  const selectedSwitch =
    selectedId !== null ? switches.find((s) => s.id === selectedId) : null;
  const selectedCache = selectedId !== null ? portCache[selectedId] : null;

  if (selectedSwitch && selectedCache) {
    return (
      <>
        <SwitchPortDetail
          sw={selectedSwitch}
          ports={selectedCache.ports}
          portsLoading={selectedCache.loading}
          portsError={selectedCache.error}
          isAdmin={isAdmin}
          accessToken={accessToken}
          onBack={() => setSelectedId(null)}
          onRefresh={() => loadPorts(selectedSwitch.id, true)}
          onToggle={(label) => handleToggle(selectedSwitch.id, label)}
          onBulkLock={() => handleBulkLock(selectedSwitch.id)}
          onBulkUnlock={() => handleBulkUnlock(selectedSwitch.id)}
        />
        {confirmAction && (
          <ConfirmDialog
            {...confirmAction}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </>
    );
  }

  // ── List view ──
  const totalPorts = Object.values(portCache).reduce(
    (s, c) => s + c.ports.length,
    0,
  );
  const totalLocked = Object.values(portCache).reduce(
    (s, c) => s + c.ports.filter((p) => p.locked).length,
    0,
  );
  const totalActive = Object.values(portCache).reduce(
    (s, c) => s + c.ports.filter((p) => p.status === "active").length,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Cable className="text-red-700" size={28} /> Port Management
        </h1>
        <p className="text-slate-500 mt-1">
          View and control individual switch ports — lock or unlock ports to
          manage network access
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

      {/* Loading */}
      {switchesLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={28} className="animate-spin mr-2" /> Loading switches…
        </div>
      )}

      {/* Switch list */}
      <div className="space-y-3">
        {switches.map((sw) => {
          const cache = portCache[sw.id];
          const isExp = expandedId === sw.id;
          const lockedCount = cache?.ports.filter((p) => p.locked).length ?? 0;
          const activeCount =
            cache?.ports.filter((p) => p.status === "active").length ?? 0;

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
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-4">
                  {cache && !cache.loading && (
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                      <span>{cache.ports.length} ports</span>
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

              {/* Expanded preview */}
              {isExp && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                  {cache?.loading ? (
                    <div className="flex items-center justify-center py-6 text-slate-400">
                      <Loader2 size={20} className="animate-spin mr-2" />{" "}
                      Fetching ports…
                    </div>
                  ) : cache?.error ? (
                    <div className="text-sm text-red-600 flex items-center gap-2">
                      <AlertTriangle size={16} />
                      {cache.error}
                    </div>
                  ) : cache?.ports.length ? (
                    <>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
                        Port Overview (click a port to toggle lock)
                      </p>
                      <PortGrid
                        ports={cache.ports}
                        onToggle={(label) => handleToggle(sw.id, label)}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 text-center py-4">
                      No port data available
                    </p>
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
        />
      )}
    </div>
  );
}
