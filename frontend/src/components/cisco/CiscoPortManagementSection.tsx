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
  Power,
  PowerOff,
  Download,
  History,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { type CiscoSwitch, type CiscoPortInfo } from "../../services/ciscoApi";
import { cn } from "../../utils/cn";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${BASE}/api/v1/cisco`;
const VLAN_PREFIX = `${BASE}/api/v1/cisco`;
const PAGE_SIZE = 48;

// ─── Types ────────────────────────────────────────────────────────────────────

type PortStatus = "active" | "inactive" | "error";
type PortFilter = "all" | "locked" | "unlocked" | "active" | "inactive";
type AdminStatus = "up" | "down";

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

interface PortStats {
  active: number;
  inactive: number;
  error: number;
  locked: number;
  unlocked: number;
}

interface PortPageCache {
  pages: Record<number, Port[]>;
  totalPages: number;
  totalCount: number;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  stats: PortStats | null;
  currentSearch: string;
  currentFilter: PortFilter;
}

interface VlanOption {
  id: number;
  vlan_id: number;
  name: string;
  status: string;
  port_count?: number;
}

interface SwitchVlanResponse {
  success: boolean;
  vlans: VlanOption[];
  total: number;
  has_snapshot_vlans: boolean;
}

// ─── Port Config History ──────────────────────────────────────────────────────

interface PortConfigHistory {
  id: number;
  switch_id: number;
  port_label: string;
  config_text: string;
  saved_at: string;
  saved_by?: string;
}

interface PortConfigHistoryResponse {
  success: boolean;
  history: PortConfigHistory[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const HISTORY_PAGE_SIZE = 4;

// ─── Lock Confirm Dialog ──────────────────────────────────────────────────────

/**
 * Shown whenever a user clicks the Lock button on a port (grid or table).
 * Unlocking is instant — only locking requires confirmation.
 */
function LockConfirmDialog({
  open,
  portLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  portLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 mb-5">
          <div className="h-11 w-11 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <Lock size={20} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Lock Port?</h3>
            <p className="text-sm text-slate-500 mt-1">
              Locking{" "}
              <span className="font-mono font-semibold text-slate-700">
                {portLabel}
              </span>{" "}
              will disable all controls for non-super-admins. You can unlock it
              at any time.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            Lock Port
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryPagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
  loading,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
  loading: boolean;
}) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-t
                 border-slate-200 bg-slate-50 shrink-0"
    >
      <p className="text-xs text-slate-500">
        {total === 0
          ? "No snapshots"
          : `${start}–${end} of ${total} snapshot${total !== 1 ? "s" : ""}`}
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(1)}
          disabled={safePage <= 1 || loading}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
          title="First page"
        >
          <ChevronLeft size={14} className="text-slate-600" />
        </button>

        <button
          onClick={() => onChange(safePage - 1)}
          disabled={safePage <= 1 || loading}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
          title="Previous page"
        >
          <ChevronLeft size={14} className="text-slate-600" />
        </button>

        {Array.from({ length: safeTotalPages }, (_, i) => i + 1)
          .filter((p) => {
            if (safeTotalPages <= 5) return true;
            return (
              p === 1 || p === safeTotalPages || Math.abs(p - safePage) <= 1
            );
          })
          .reduce<(number | "…")[]>((acc, p, i, arr) => {
            if (i > 0 && typeof arr[i - 1] === "number") {
              const prev = arr[i - 1] as number;
              if (p - prev > 1) acc.push("…");
            }
            acc.push(p);
            return acc;
          }, [])
          .map((item, i) =>
            item === "…" ? (
              <span
                key={`ellipsis-${i}`}
                className="w-7 text-center text-xs text-slate-400"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                onClick={() => onChange(item as number)}
                disabled={loading}
                className={cn(
                  "w-7 h-7 rounded-lg text-xs font-medium transition-colors border",
                  item === safePage
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50",
                )}
              >
                {item}
              </button>
            ),
          )}

        <button
          onClick={() => onChange(safePage + 1)}
          disabled={safePage >= safeTotalPages || loading}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
          title="Next page"
        >
          <ChevronRightIcon size={14} className="text-slate-600" />
        </button>

        <button
          onClick={() => onChange(safeTotalPages)}
          disabled={safePage >= safeTotalPages || loading}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors"
          title="Last page"
        >
          <ChevronRightIcon size={14} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
}

// ─── saved_by label helpers ───────────────────────────────────────────────────

function getSavedByMeta(savedBy: string): {
  label: string;
  cls: string;
  icon: "refresh" | "clock" | "user";
} {
  switch (savedBy) {
    case "startup":
      return {
        label: "App Startup",
        cls: "bg-blue-900/60 text-blue-300 border border-blue-700",
        icon: "refresh",
      };
    case "periodic":
      return {
        label: "Scheduled",
        cls: "bg-purple-900/60 text-purple-300 border border-purple-700",
        icon: "clock",
      };
    case "background-sync":
      return {
        label: "Background",
        cls: "bg-slate-700 text-slate-300 border border-slate-600",
        icon: "refresh",
      };
    default:
      return {
        label: savedBy,
        cls: "bg-green-900/60 text-green-300 border border-green-700",
        icon: "user",
      };
  }
}

// ─── Frontend lock store ──────────────────────────────────────────────────────

const UNLOCK_STORE_KEY = "cisco_unlocked_ports";

function getUnlockedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(UNLOCK_STORE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveUnlockedSet(s: Set<string>) {
  try {
    localStorage.setItem(UNLOCK_STORE_KEY, JSON.stringify([...s]));
  } catch {}
}

function portKey(switchId: number, portLabel: string) {
  return `${switchId}::${portLabel}`;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

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
    const detail = b?.detail ?? b?.message ?? `HTTP ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    locked: p.locked, // comes from DB via the API response
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
    stats: null,
    currentSearch: "",
    currentFilter: "all",
  };
}

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Status config ────────────────────────────────────────────────────────────

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

// ─── Badges ───────────────────────────────────────────────────────────────────

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
      <Unlock size={11} /> Unlocked
    </span>
  );
}

function SavedByBadge({ savedBy }: { savedBy: string }) {
  const { label, cls, icon } = getSavedByMeta(savedBy);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
        cls,
      )}
    >
      {icon === "refresh" && <RefreshCw size={9} />}
      {icon === "clock" && <Clock size={9} />}
      {label}
    </span>
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
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  const pageNumbers: number[] = [];
  const maxVisible = Math.min(safeTotalPages, 7);
  let start = 1;
  if (safeTotalPages > 7) {
    if (safePage <= 4) start = 1;
    else if (safePage >= safeTotalPages - 3) start = safeTotalPages - 6;
    else start = safePage - 3;
  }
  for (let i = 0; i < maxVisible; i++) pageNumbers.push(start + i);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
      <p className="text-xs text-slate-500">
        Page {safePage} of {safeTotalPages} · {PAGE_SIZE} ports per page
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(safePage - 1)}
          disabled={safePage <= 1}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} className="text-slate-600" />
        </button>
        {pageNumbers.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors border ${
              p === safePage
                ? "bg-red-700 text-white border-red-700"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onChange(safePage + 1)}
          disabled={safePage >= safeTotalPages}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRightIcon size={16} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
}

// ─── Running Config Modal ─────────────────────────────────────────────────────

// ─── REPLACE the entire RunningConfigModal function in CiscoPortManagementSection.tsx ───
// Two bugs fixed:
//   1. Error box was shown alongside config because `error` was never cleared when
//      config loaded successfully from DB (the DB path set config but never called setError(null))
//   2. "Sync from Switch" button now correctly calls the POST endpoint that was missing
//      (endpoint added on backend side — see cisco_routes_sync_endpoint.py)
//
// Additionally: when a port is locked the table "Configure" button now shows
// "Port is locked" tooltip and is visually disabled (this was already there),
// but the toast now says "Port [label] is locked — unlock it first to configure."
// ─────────────────────────────────────────────────────────────────────────────

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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "live" | null>(null);

  // ─── RunningConfigModal — replace the entire loadConfig function ──────────

  const loadConfig = useCallback(
    async (portLabel: string) => {
      setConfig(null);
      setError(null);
      setSavedAt(null);
      setSavedBy(null);
      setSource(null);
      setLoading(true);

      try {
        const encodedLabel = encodeURIComponent(portLabel);

        // ── Step 1: Try the DB snapshot endpoint (GET port-config-db) ──────
        let dbSuccess = false;
        try {
          const dbData = await apiFetch<{
            success: boolean;
            config?: string;
            port_label?: string;
            error?: string;
          }>(
            `${PREFIX}/switches/${switchId}/port-config-db` +
              `?port_label=${encodedLabel}`,
            token,
            { method: "GET" },
          );

          if (dbData.success && dbData.config) {
            setError(null);
            setConfig(dbData.config);
            setSavedAt(new Date().toISOString());
            setSavedBy("db");
            setSource("db");
            dbSuccess = true;
          }
        } catch (dbErr: any) {
          // 404 or no snapshot yet — fall through to live sync
          console.debug(
            "[RunningConfig] DB snapshot not found:",
            dbErr.message,
          );
        }

        if (dbSuccess) return;

        // ── Step 2: No DB snapshot — fetch live from switch via POST /sync ──
        toast.info(
          `No snapshot in DB for ${portLabel} — fetching live from switch…`,
          { duration: 3000 },
        );

        const liveData = await apiFetch<{
          success: boolean;
          config?: string;
          error?: string;
          protocol_used?: string;
        }>(
          `${PREFIX}/switches/${switchId}/port-config-db/sync` +
            `?port_label=${encodedLabel}`,
          token,
          { method: "POST" },
        );

        if (liveData.success && liveData.config) {
          setError(null);
          setConfig(liveData.config);
          setSavedAt(new Date().toISOString());
          setSavedBy("on-demand");
          setSource("live");
          toast.success(`Config fetched and saved for ${portLabel}`);
        } else {
          setConfig(null);
          setError(
            liveData.error ||
              "Could not fetch config from switch. Check SSH connectivity.",
          );
        }
      } catch (err: any) {
        setConfig(null);
        setError(err.message || "Unexpected error loading config.");
      } finally {
        setLoading(false);
      }
    },
    [switchId, token],
  );

  const handleManualSync = useCallback(async () => {
    if (!port) return;
    setLoading(true);
    setError(null); // ← clear before attempt

    try {
      const encodedLabel = encodeURIComponent(port.label);
      const data = await apiFetch<{
        success: boolean;
        config?: string;
        error?: string;
      }>(
        `${PREFIX}/switches/${switchId}/port-config-db/sync` +
          `?port_label=${encodedLabel}`,
        token,
        { method: "POST" },
      );

      if (data.success && data.config) {
        setError(null); // ← clear error on success
        setConfig(data.config);
        setSavedAt(new Date().toISOString());
        setSavedBy("manual-sync");
        setSource("live");
        toast.success("Config synced from switch and saved to DB");
      } else {
        setConfig(null);
        setError(data.error || "Sync failed — no config returned.");
      }
    } catch (err: any) {
      setConfig(null);
      setError(err.message || "Sync failed.");
    } finally {
      setLoading(false);
    }
  }, [port, switchId, token]);

  useEffect(() => {
    if (!open || !port) return;
    loadConfig(port.label);
  }, [open, port, loadConfig]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleDownload = () => {
    if (!config || !port) return;
    const safeLabel = port.label.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadTextFile(`config_${safeLabel}_${ts}.txt`, config);
    toast.success("Config downloaded");
  };

  if (!open || !port) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4
                   overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b
                        border-slate-200 bg-slate-900 shrink-0"
        >
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 rounded-lg bg-green-500/20 flex items-center
                            justify-center"
            >
              <Terminal size={16} className="text-green-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Running Config
              </h3>
              <p className="text-xs text-slate-400">
                {switchName} — {port.label}
                {source === "db" && (
                  <span
                    className="ml-2 inline-flex items-center gap-1
                                   px-1.5 py-0.5 rounded bg-green-900/60
                                   text-green-300 text-[10px] border
                                   border-green-700"
                  >
                    <Clock size={9} /> from database
                  </span>
                )}
                {source === "live" && (
                  <span
                    className="ml-2 inline-flex items-center gap-1
                                   px-1.5 py-0.5 rounded bg-blue-900/60
                                   text-blue-300 text-[10px] border
                                   border-blue-700"
                  >
                    <RefreshCw size={9} /> fetched live
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleManualSync}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                         bg-blue-600 hover:bg-blue-700 disabled:opacity-60
                         disabled:cursor-not-allowed text-white text-xs
                         font-medium transition-colors"
              title="Fetch live config from switch and save to DB"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              {loading ? "Loading…" : "Sync from Switch"}
            </button>

            {config && !loading && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                           bg-green-600 hover:bg-green-700 text-white text-xs
                           font-medium transition-colors"
              >
                <Download size={13} />
                Download .txt
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <X size={18} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Snapshot meta bar — only when we have config */}
        {config && !loading && savedAt && (
          <div
            className="flex items-center gap-2 px-6 py-2 bg-slate-800
                          border-b border-slate-700 shrink-0"
          >
            <Clock size={12} className="text-slate-400 shrink-0" />
            <p className="text-xs text-slate-400">
              {source === "db" ? "Snapshot saved" : "Fetched"}{" "}
              <span className="text-green-400 font-medium">
                {new Date(savedAt).toLocaleString()}
              </span>
              {savedBy && (
                <span className="ml-2 text-slate-500">
                  · by{" "}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 " +
                        "rounded text-[10px] font-semibold",
                      savedBy === "startup"
                        ? "bg-blue-900/60 text-blue-300 border border-blue-700"
                        : savedBy === "periodic"
                          ? "bg-purple-900/60 text-purple-300 border border-purple-700"
                          : savedBy === "on-demand" || savedBy === "manual-sync"
                            ? "bg-green-900/60 text-green-300 border border-green-700"
                            : "bg-slate-700 text-slate-300 border border-slate-600",
                    )}
                  >
                    {savedBy === "startup" && (
                      <>
                        <RefreshCw size={9} /> App Startup
                      </>
                    )}
                    {savedBy === "periodic" && (
                      <>
                        <Clock size={9} /> Scheduled
                      </>
                    )}
                    {(savedBy === "on-demand" || savedBy === "manual-sync") && (
                      <>
                        <RefreshCw size={9} /> On Demand
                      </>
                    )}
                    {savedBy !== "startup" &&
                      savedBy !== "periodic" &&
                      savedBy !== "on-demand" &&
                      savedBy !== "manual-sync" &&
                      savedBy}
                  </span>
                </span>
              )}
            </p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-950 p-6">
          {loading && (
            <div
              className="flex flex-col items-center justify-center
                            py-12 text-slate-400"
            >
              <Loader2 size={28} className="animate-spin mb-3 text-green-400" />
              <p className="text-sm font-medium text-slate-300">
                {source === null
                  ? "Checking database…"
                  : "Fetching live config from switch…"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {source === null
                  ? "Will auto-fetch from switch if not found in DB"
                  : `Connecting to ${switchName} via SSH…`}
              </p>
            </div>
          )}

          {/* ── BUG FIX: only show error when there is NO config loaded ── */}
          {error && !loading && !config && (
            <div
              className="flex items-start gap-3 p-4 bg-red-900/30
                            border border-red-700/50 rounded-lg"
            >
              <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">
                  Could not load config
                </p>
                <p className="text-xs text-red-400 mt-1">{error}</p>
                <button
                  onClick={handleManualSync}
                  disabled={loading}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5
                             rounded-lg bg-blue-600 hover:bg-blue-700
                             text-white text-xs font-medium transition-colors
                             disabled:opacity-60"
                >
                  <RefreshCw size={12} />
                  Try Again
                </button>
              </div>
            </div>
          )}

          {config && !loading && (
            <pre
              className="text-xs text-green-300 font-mono
                            whitespace-pre-wrap leading-relaxed"
            >
              {config}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-6 py-3
                        border-t border-slate-200 bg-slate-50 shrink-0"
        >
          <p className="text-xs text-slate-400">
            {loading && "Loading config — please wait…"}
            {!loading &&
              config &&
              source === "db" &&
              "Loaded from database — click 'Sync from Switch' to refresh"}
            {!loading &&
              config &&
              source === "live" &&
              "Fetched live from switch and saved to database"}
            {!loading && !config && !error && "Preparing…"}
            {!loading &&
              !config &&
              error &&
              "Failed to load — try syncing from switch"}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700
                       bg-slate-100 rounded-lg hover:bg-slate-200
                       transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Last Config History Modal ────────────────────────────────────────────────

function LastConfigModal({
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
  const [history, setHistory] = useState<PortConfigHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<PortConfigHistory | null>(
    null,
  );

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchPage = useCallback(
    async (targetPage: number, portLabel: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          port_label: portLabel,
          page: String(targetPage),
          page_size: String(HISTORY_PAGE_SIZE),
        });

        const data = await apiFetch<PortConfigHistoryResponse>(
          `${PREFIX}/switches/${switchId}/port-config-history?${params}`,
          token,
        );

        if (!data.success) {
          setError("Failed to load history.");
          return;
        }

        setHistory(data.history);
        setPage(data.page);
        setTotalPages(data.total_pages);
        setTotal(data.total);

        if (targetPage === 1 && data.history.length > 0) {
          setSelectedEntry(data.history[0]);
        } else if (data.history.length > 0 && selectedEntry === null) {
          setSelectedEntry(data.history[0]);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load history.");
      } finally {
        setLoading(false);
      }
    },
    [switchId, token, selectedEntry],
  );

  useEffect(() => {
    if (!open || !port) return;
    setHistory([]);
    setSelectedEntry(null);
    setError(null);
    setPage(1);
    setTotalPages(1);
    setTotal(0);
    fetchPage(1, port.label);
  }, [open, port]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (!port || newPage === page || loading) return;
      fetchPage(newPage, port.label);
    },
    [port, page, loading, fetchPage],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleDownload = (entry: PortConfigHistory) => {
    const safeLabel = entry.port_label.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const ts = entry.saved_at.replace(/[:.]/g, "-").slice(0, 19);
    downloadTextFile(
      `config_history_${safeLabel}_${ts}.txt`,
      entry.config_text,
    );
    toast.success("Config snapshot downloaded");
  };

  if (!open || !port) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl
                   mx-4 overflow-hidden max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b
                     border-slate-200 bg-slate-900 shrink-0"
        >
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center
                         justify-center"
            >
              <History size={16} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Config History
              </h3>
              <p className="text-xs text-slate-400">
                {switchName} — {port.label}
                {total > 0 && (
                  <span
                    className="ml-2 inline-flex items-center px-1.5 py-0.5
                                   rounded bg-amber-900/50 text-amber-300
                                   text-[10px] border border-amber-700"
                  >
                    {total} snapshot{total !== 1 ? "s" : ""}
                  </span>
                )}
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

        <div className="flex flex-1 overflow-hidden min-h-0">
          <div
            className="w-56 shrink-0 border-r border-slate-200 bg-slate-50
                       flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="space-y-px">
                  {Array.from({ length: HISTORY_PAGE_SIZE }).map((_, i) => (
                    <div
                      key={i}
                      className="h-16 bg-slate-100 animate-pulse border-b
                                 border-slate-200"
                    />
                  ))}
                </div>
              )}

              {error && !loading && (
                <div className="p-4 text-xs text-red-600">
                  <AlertCircle size={14} className="inline mr-1" />
                  {error}
                </div>
              )}

              {!loading && !error && history.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center py-10
                             px-4 text-center text-slate-400"
                >
                  <Clock size={24} className="mb-2 opacity-50" />
                  <p className="text-xs font-medium text-slate-500">
                    No history yet
                  </p>
                  <p className="text-xs mt-1">
                    Snapshots are saved before each configuration change.
                  </p>
                </div>
              )}

              {!loading &&
                history.map((entry, i) => {
                  const isSelected = selectedEntry?.id === entry.id;
                  const date = new Date(entry.saved_at);
                  const globalIndex = (page - 1) * HISTORY_PAGE_SIZE + i;

                  return (
                    <button
                      key={entry.id}
                      onClick={() => setSelectedEntry(entry)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-slate-200",
                        "transition-colors border-l-2",
                        isSelected
                          ? "bg-amber-50 border-l-amber-500"
                          : "hover:bg-white border-l-transparent",
                      )}
                    >
                      {globalIndex === 0 && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5
                                     rounded text-[10px] font-semibold
                                     bg-amber-100 text-amber-700 mb-1"
                        >
                          Latest
                        </span>
                      )}
                      <p className="text-xs font-medium text-slate-700">
                        {date.toLocaleDateString()}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {date.toLocaleTimeString()}
                      </p>
                      {entry.saved_by && (
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          by {entry.saved_by}
                        </p>
                      )}
                    </button>
                  );
                })}
            </div>

            {totalPages > 1 && (
              <HistoryPagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={HISTORY_PAGE_SIZE}
                onChange={handlePageChange}
                loading={loading}
              />
            )}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
            {selectedEntry ? (
              <>
                <div
                  className="flex items-center justify-between px-4 py-2.5
                             border-b border-slate-800 bg-slate-900 shrink-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock size={12} className="text-slate-400 shrink-0" />
                    <p className="text-xs text-slate-400 truncate">
                      Snapshot from{" "}
                      <span className="text-amber-400 font-medium">
                        {new Date(selectedEntry.saved_at).toLocaleString()}
                      </span>
                      {selectedEntry.saved_by && (
                        <span className="ml-2 text-slate-500">
                          · by {selectedEntry.saved_by}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDownload(selectedEntry)}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5
                               rounded-lg bg-amber-600 hover:bg-amber-700
                               text-white text-xs font-medium transition-colors
                               ml-3"
                  >
                    <Download size={12} />
                    Download
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <pre
                    className="text-xs text-amber-200 font-mono
                               whitespace-pre-wrap leading-relaxed"
                  >
                    {selectedEntry.config_text}
                  </pre>
                </div>
              </>
            ) : !loading ? (
              <div
                className="flex flex-col items-center justify-center h-full
                           text-slate-500 gap-2"
              >
                <History size={32} className="opacity-30" />
                <p className="text-sm">Select a snapshot from the list</p>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="flex items-center justify-between px-6 py-3 border-t
                     border-slate-200 bg-slate-50 shrink-0"
        >
          <p className="text-xs text-slate-400">
            {total > 0
              ? `Page ${page} of ${totalPages} · ${total} total snapshot${total !== 1 ? "s" : ""} · saved before each configuration change`
              : "No snapshots saved yet"}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700
                       bg-slate-100 rounded-lg hover:bg-slate-200
                       transition-colors"
          >
            Close
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
  token,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  port: Port | null;
  switchId: number;
  switchName: string;
  token: string | null;
  onSave: (
    portLabel: string,
    data: {
      mode: "access" | "trunk";
      port_status: AdminStatus;
      access_vlan?: number;
      trunk_allowed_vlans?: number[];
      trunk_native_vlan?: number;
      description?: string;
    },
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"access" | "trunk">("access");
  const [portStatus, setPortStatus] = useState<AdminStatus>("up");
  const [accessVlan, setAccessVlan] = useState<number | null>(null);
  const [trunkNative, setTrunkNative] = useState<number | null>(null);
  const [trunkAllowed, setTrunkAllowed] = useState<Set<number>>(new Set());
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [vlanSearch, setVlanSearch] = useState("");
  const [allVlans, setAllVlans] = useState<VlanOption[]>([]);
  const [filteredVlans, setFilteredVlans] = useState<VlanOption[]>([]);
  const [vlansLoading, setVlansLoading] = useState(false);
  const [vlansError, setVlansError] = useState<string | null>(null);
  const [vlanSource, setVlanSource] = useState<
    "switch_snapshot" | "management_only" | "none" | null
  >(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchVlans = useCallback(
    (search: string) => {
      if (!switchId) return;
      setVlansLoading(true);
      setVlansError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());

      apiFetch<SwitchVlanResponse>(
        `${PREFIX}/switches/${switchId}/vlans-all?${params.toString()}`,
        token,
      )
        .then((d) => {
          const fetched = d.vlans ?? [];
          setAllVlans(fetched);
          setFilteredVlans(fetched);

          if (fetched.length === 0 && !search.trim()) {
            setVlanSource("none");
          } else if (d.has_snapshot_vlans) {
            setVlanSource("switch_snapshot");
          } else {
            setVlanSource("management_only");
          }

          if (!search.trim() && fetched.length > 0) {
            setAccessVlan((prev) =>
              prev === null ? fetched[0].vlan_id : prev,
            );
            setTrunkNative((prev) =>
              prev === null ? fetched[0].vlan_id : prev,
            );
          }
        })
        .catch(() => {
          const fallbackParams = new URLSearchParams();
          if (search.trim()) fallbackParams.set("search", search.trim());

          apiFetch<SwitchVlanResponse>(
            `${VLAN_PREFIX}/vlan-management/vlans/all?${fallbackParams.toString()}`,
            token,
          )
            .then((d) => {
              const fetched = d.vlans ?? [];
              setAllVlans(fetched);
              setFilteredVlans(fetched);
              setVlanSource(fetched.length > 0 ? "management_only" : "none");
              if (!search.trim() && fetched.length > 0) {
                setAccessVlan((prev) =>
                  prev === null ? fetched[0].vlan_id : prev,
                );
                setTrunkNative((prev) =>
                  prev === null ? fetched[0].vlan_id : prev,
                );
              }
            })
            .catch((err) => {
              setVlansError(err.message || "Failed to load VLANs");
              setAllVlans([]);
              setFilteredVlans([]);
              setVlanSource("none");
            })
            .finally(() => setVlansLoading(false));
          return;
        })
        .finally(() => setVlansLoading(false));
    },
    [switchId, token],
  );

  useEffect(() => {
    if (!open || !switchId) return;
    setVlanSearch("");
    fetchVlans("");
  }, [open, switchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVlanSearch = (val: string) => {
    setVlanSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchVlans(val);
    }, 350);
  };

  useEffect(() => {
    if (open && port) {
      setMode("access");
      setPortStatus("up");
      setAccessVlan(null);
      setTrunkNative(null);
      setTrunkAllowed(new Set());
      setDescription(port.description || "");
      setError("");
      setVlansError(null);
    }
  }, [open, port]);

  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    },
    [],
  );

  if (!open || !port) return null;

  // ─── Replace handleSubmit inside ConfigurePortModal ───────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "access" && !accessVlan) {
      setError("Please select an Access VLAN.");
      return;
    }
    if (mode === "trunk" && trunkAllowed.size === 0) {
      setError("Select at least one VLAN for the trunk.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      await onSave(port.label, {
        mode,
        port_status: portStatus,
        access_vlan: mode === "access" ? (accessVlan ?? 1) : undefined,
        trunk_allowed_vlans:
          mode === "trunk"
            ? Array.from(trunkAllowed).sort((a, b) => a - b)
            : undefined,
        trunk_native_vlan: mode === "trunk" ? (trunkNative ?? 1) : undefined,
        description,
      });

      // Only close if onSave did NOT throw
      onClose();
    } catch (err: any) {
      const msg =
        typeof err === "string"
          ? err
          : typeof err?.message === "string" && err.message
            ? err.message
            : err
              ? JSON.stringify(err)
              : "Configuration failed. Check switch connectivity and try again.";
      setError(msg);
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

  const VlanSourceBadge = () => {
    if (vlansLoading || vlanSource === null) return null;
    if (vlansError)
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertCircle size={13} className="shrink-0" />
          Failed to load VLANs — {vlansError}
        </div>
      );
    if (vlanSource === "switch_snapshot")
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
          <CheckCircle size={13} className="shrink-0" />
          <span>
            <strong>{allVlans.length}</strong> VLANs loaded from switch snapshot
          </span>
        </div>
      );
    if (vlanSource === "management_only")
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <AlertTriangle size={13} className="shrink-0" />
          <span>
            Showing <strong>{allVlans.length}</strong> manually added VLANs —
            run <strong>Sync from Switch</strong> to load real VLANs.
          </span>
        </div>
      );
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
        <AlertTriangle size={13} className="shrink-0" />
        No VLANs found. Sync the switch or add VLANs in VLAN Management.
      </div>
    );
  };

  const VlanCard = ({
    vlan,
    selected,
    onClick,
    checkboxMode = false,
  }: {
    vlan: VlanOption;
    selected: boolean;
    onClick: () => void;
    checkboxMode?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all",
        selected
          ? mode === "access"
            ? "bg-blue-50 border-l-2 border-l-blue-500"
            : "bg-purple-50 border-l-2 border-l-purple-500"
          : "bg-white hover:bg-slate-50 border-l-2 border-l-transparent",
      )}
    >
      <div
        className={cn(
          "shrink-0 flex items-center justify-center border-2 transition-colors",
          checkboxMode ? "w-4 h-4 rounded" : "w-4 h-4 rounded-full",
          selected
            ? mode === "access"
              ? "bg-blue-500 border-blue-500"
              : "bg-purple-500 border-purple-500"
            : "border-slate-300 bg-white",
        )}
      >
        {selected && (
          <svg
            className="w-2.5 h-2.5 text-white"
            fill="none"
            viewBox="0 0 12 12"
          >
            {checkboxMode ? (
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle cx="6" cy="6" r="3" fill="currentColor" />
            )}
          </svg>
        )}
      </div>

      <span
        className={cn(
          "shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-bold",
          selected
            ? mode === "access"
              ? "bg-blue-100 text-blue-700"
              : "bg-purple-100 text-purple-700"
            : "bg-slate-100 text-slate-600",
        )}
      >
        {vlan.vlan_id}
      </span>

      <span
        className={cn(
          "flex-1 text-sm truncate",
          selected ? "font-semibold text-slate-900" : "text-slate-700",
        )}
      >
        {vlan.name}
      </span>

      <span
        className={cn(
          "shrink-0 w-2 h-2 rounded-full",
          vlan.status === "active" ? "bg-green-400" : "bg-amber-400",
        )}
        title={vlan.status}
      />
    </button>
  );

  if (!open || !port) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center shadow-sm">
              <Settings2 size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Configure Port
              </h3>
              <p className="text-xs text-slate-500">
                {switchName} <span className="mx-1 text-slate-300">·</span>
                <span className="font-mono text-slate-600">{port.label}</span>
                {port.locked && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-medium">
                    <Lock size={9} /> Locked
                  </span>
                )}
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
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* ─── Error Banner ────────────────────────────────────────────────────── */}
            {error && (
              <div
                className="flex items-start gap-3 p-3.5 bg-red-50 border border-red-300
               rounded-xl text-sm animate-in fade-in duration-200"
              >
                <AlertCircle
                  size={16}
                  className="shrink-0 mt-0.5 text-red-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-red-700 mb-0.5">
                    Configuration failed
                  </p>
                  <p className="text-xs text-red-600 font-mono break-all leading-relaxed">
                    "The Port is Locked! Try To Unlocked First."
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="shrink-0 p-0.5 rounded hover:bg-red-100 transition-colors"
                  title="Dismiss"
                >
                  <X size={14} className="text-red-400" />
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
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
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Port Admin Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["up", "down"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPortStatus(s)}
                    className={cn(
                      "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                      portStatus === s
                        ? s === "up"
                          ? "bg-green-50 border-green-400 text-green-700 ring-2 ring-green-200"
                          : "bg-red-50 border-red-400 text-red-700 ring-2 ring-red-200"
                        : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {s === "up" ? (
                      <Power
                        size={15}
                        className={
                          portStatus === "up"
                            ? "text-green-600"
                            : "text-slate-400"
                        }
                      />
                    ) : (
                      <PowerOff
                        size={15}
                        className={
                          portStatus === "down"
                            ? "text-red-600"
                            : "text-slate-400"
                        }
                      />
                    )}
                    {s === "up" ? "Up (no shutdown)" : "Down (shutdown)"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Port Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["access", "trunk"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                      mode === m
                        ? m === "access"
                          ? "bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-200"
                          : "bg-purple-50 border-purple-400 text-purple-700 ring-2 ring-purple-200"
                        : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {m === "access" ? (
                      <Monitor size={15} />
                    ) : (
                      <ArrowRightLeft size={15} />
                    )}
                    {m === "access" ? "Access" : "Trunk"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-slate-700">
                  {mode === "access" ? "Access VLAN" : "Trunk VLANs"}
                </label>
                {allVlans.length > 0 && (
                  <span className="text-xs text-slate-400">
                    {filteredVlans.length} VLAN
                    {filteredVlans.length !== 1 ? "s" : ""} found
                  </span>
                )}
              </div>

              <div className="mb-3">
                <VlanSourceBadge />
              </div>

              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={vlanSearch}
                  onChange={(e) => handleVlanSearch(e.target.value)}
                  placeholder="Search VLAN ID or name… (searches switch)"
                  className="w-full pl-8 pr-8 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {vlanSearch && !vlansLoading && (
                  <button
                    type="button"
                    onClick={() => handleVlanSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                  >
                    <X size={13} />
                  </button>
                )}
                {vlansLoading && (
                  <Loader2
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
                  />
                )}
              </div>

              {vlansLoading && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-11 bg-slate-50 border-b border-slate-100 animate-pulse last:border-b-0"
                    />
                  ))}
                </div>
              )}

              {!vlansLoading && allVlans.length === 0 && !vlansError && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                  <Network size={32} className="mb-2 opacity-50" />
                  <p className="text-sm font-medium text-slate-500">
                    No VLANs available
                  </p>
                  <p className="text-xs text-slate-400 mt-1 text-center px-6">
                    Sync the switch first or add VLANs in VLAN Management
                  </p>
                </div>
              )}

              {!vlansLoading &&
                allVlans.length > 0 &&
                filteredVlans.length === 0 && (
                  <div className="flex items-center justify-center py-8 border border-dashed border-slate-200 rounded-xl text-slate-400">
                    <p className="text-sm">
                      No VLANs match &ldquo;{vlanSearch}&rdquo;
                    </p>
                  </div>
                )}

              {!vlansLoading &&
                filteredVlans.length > 0 &&
                mode === "access" && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    {accessVlan !== null && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-xs font-medium">
                        <CheckCircle size={13} />
                        Selected: VLAN {accessVlan} —{" "}
                        {allVlans.find((v) => v.vlan_id === accessVlan)?.name ??
                          ""}
                      </div>
                    )}
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {filteredVlans.map((vlan) => (
                        <VlanCard
                          key={vlan.vlan_id}
                          vlan={vlan}
                          selected={accessVlan === vlan.vlan_id}
                          onClick={() => setAccessVlan(vlan.vlan_id)}
                          checkboxMode={false}
                        />
                      ))}
                    </div>
                  </div>
                )}

              {!vlansLoading &&
                filteredVlans.length > 0 &&
                mode === "trunk" && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Native VLAN
                      </p>
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        {trunkNative !== null && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white text-xs font-medium">
                            <CheckCircle size={13} />
                            Native: VLAN {trunkNative} —{" "}
                            {allVlans.find((v) => v.vlan_id === trunkNative)
                              ?.name ?? ""}
                          </div>
                        )}
                        <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                          {filteredVlans.map((vlan) => (
                            <VlanCard
                              key={vlan.vlan_id}
                              vlan={vlan}
                              selected={trunkNative === vlan.vlan_id}
                              onClick={() => setTrunkNative(vlan.vlan_id)}
                              checkboxMode={false}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Allowed VLANs
                        </p>
                        <div className="flex items-center gap-3">
                          {trunkAllowed.size > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                              <CheckCircle size={10} />
                              {trunkAllowed.size} selected
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (trunkAllowed.size === filteredVlans.length) {
                                setTrunkAllowed(new Set());
                              } else {
                                setTrunkAllowed(
                                  new Set(filteredVlans.map((v) => v.vlan_id)),
                                );
                              }
                            }}
                            className="text-xs text-purple-600 hover:text-purple-800 font-medium underline underline-offset-2"
                          >
                            {trunkAllowed.size === filteredVlans.length
                              ? "Clear all"
                              : "Select all"}
                          </button>
                        </div>
                      </div>
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                          {filteredVlans.map((vlan) => (
                            <VlanCard
                              key={vlan.vlan_id}
                              vlan={vlan}
                              selected={trunkAllowed.has(vlan.vlan_id)}
                              onClick={() => toggleVlan(vlan.vlan_id)}
                              checkboxMode={true}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          </div>

          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
            <div className="text-xs text-slate-500">
              {mode === "access" && accessVlan !== null && (
                <span>
                  Access VLAN{" "}
                  <span className="font-mono font-bold text-slate-700">
                    {accessVlan}
                  </span>
                </span>
              )}
              {mode === "trunk" && (
                <span>
                  {trunkAllowed.size} allowed VLAN
                  {trunkAllowed.size !== 1 ? "s" : ""}
                  {trunkNative !== null && (
                    <span>
                      {" "}
                      · native{" "}
                      <span className="font-mono font-bold text-slate-700">
                        {trunkNative}
                      </span>
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  vlansLoading ||
                  (mode === "access" && accessVlan === null) ||
                  (mode === "trunk" && trunkAllowed.size === 0)
                }
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? "Applying…" : "Apply Configuration"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Port Grid ────────────────────────────────────────────────────────────────

function PortGrid({
  ports,
  onToggleLock,
  isAdmin,
  isSuperAdmin,
}: {
  ports: Port[];
  onToggleLock: (label: string) => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}) {
  return (
    <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-24 gap-1.5">
      {ports.map((p) => {
        const d = STATUS_CFG[p.status];
        const canClick = isSuperAdmin ? true : isAdmin && !p.locked;

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => canClick && onToggleLock(p.label)}
            disabled={!canClick}
            aria-disabled={!canClick}
            title={
              p.locked
                ? isSuperAdmin
                  ? `Port ${p.number} — Locked · Click to unlock`
                  : `Port ${p.number} — Locked & disabled`
                : isAdmin || isSuperAdmin
                  ? `Port ${p.number} — ${p.status} · Click to lock`
                  : `Port ${p.number} — ${p.status}`
            }
            className={cn(
              "relative w-full aspect-square rounded-lg border-2 flex flex-col items-center justify-center",
              "text-xs font-medium transition-all duration-150",
              "focus:outline-none focus:ring-2 focus:ring-offset-1",
              p.locked
                ? isSuperAdmin
                  ? "border-red-400 bg-red-100 cursor-pointer hover:scale-110 hover:shadow-md focus:ring-red-400"
                  : "border-red-400 bg-red-100 opacity-50 cursor-not-allowed select-none focus:ring-red-300"
                : canClick
                  ? cn(
                      "cursor-pointer hover:scale-110 hover:shadow-md focus:ring-red-500",
                      p.status === "active"
                        ? "border-green-300 bg-green-50"
                        : p.status === "error"
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 bg-slate-50",
                    )
                  : cn(
                      "cursor-default focus:ring-slate-300",
                      p.status === "active"
                        ? "border-green-300 bg-green-50"
                        : p.status === "error"
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 bg-slate-50",
                    ),
            )}
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full mb-0.5",
                p.locked ? "bg-red-400" : d.dot,
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                p.locked ? "text-red-500 font-bold" : "text-slate-700",
              )}
            >
              {p.number}
            </span>
            {p.locked && (
              <Lock
                size={8}
                className="absolute top-0.5 right-0.5 text-red-600"
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
  onToggleLock,
  onConfigure,
  onViewConfig,
  onViewHistory,
  isAdmin,
  isSuperAdmin,
  portsWithHistory,
}: {
  ports: Port[];
  onToggleLock: (label: string) => void;
  onConfigure: (port: Port) => void;
  onViewConfig: (port: Port) => void;
  onViewHistory: (port: Port) => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  portsWithHistory: Set<string>;
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
            ports.map((p) => {
              const rowDimmed = p.locked && !isSuperAdmin;
              const actionButtonsEnabled = isSuperAdmin || !p.locked;

              return (
                <tr
                  key={p.id}
                  className={cn(
                    "transition-colors",
                    rowDimmed ? "bg-red-50/70 opacity-75" : "hover:bg-slate-50",
                  )}
                >
                  <td
                    className={cn(
                      "px-3 py-2.5 font-mono font-bold",
                      p.locked && !isSuperAdmin
                        ? "text-red-500"
                        : p.locked && isSuperAdmin
                          ? "text-red-600"
                          : "text-slate-900",
                    )}
                  >
                    {p.number}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                    <span className="flex items-center gap-1.5">
                      {p.locked && (
                        <Lock size={10} className="text-red-500 shrink-0" />
                      )}
                      {p.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <PortStatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <LockBadge locked={p.locked} />
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5",
                      rowDimmed ? "text-slate-400" : "text-slate-600",
                    )}
                  >
                    {p.speed}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5",
                      rowDimmed ? "text-slate-400" : "text-slate-600",
                    )}
                  >
                    {p.vlan}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 font-mono text-xs",
                      rowDimmed ? "text-slate-400" : "text-slate-500",
                    )}
                  >
                    {p.macAddress ?? "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5",
                      rowDimmed ? "text-slate-400 italic" : "text-slate-500",
                    )}
                  >
                    {p.description || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Lock / Unlock */}
                      {(isAdmin || isSuperAdmin) && (
                        <button
                          type="button"
                          onClick={() => onToggleLock(p.label)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
                            "text-xs font-medium transition-colors",
                            "focus:outline-none focus:ring-2 focus:ring-offset-1",
                            p.locked
                              ? "bg-green-100 text-green-700 hover:bg-green-200 focus:ring-green-500"
                              : "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-500",
                          )}
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

                      {/* Configure */}
                      <button
                        type="button"
                        onClick={() => actionButtonsEnabled && onConfigure(p)}
                        disabled={!actionButtonsEnabled}
                        title={
                          !actionButtonsEnabled
                            ? "Port is locked — unlock it first"
                            : "Configure port"
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
                          "text-xs font-medium transition-colors",
                          "focus:outline-none focus:ring-2 focus:ring-offset-1",
                          !actionButtonsEnabled
                            ? "bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed pointer-events-none opacity-50"
                            : "bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-500",
                        )}
                      >
                        <Settings2 size={12} /> Configure
                      </button>

                      {/* Running Config */}
                      <button
                        type="button"
                        onClick={() => actionButtonsEnabled && onViewConfig(p)}
                        disabled={!actionButtonsEnabled}
                        title={
                          !actionButtonsEnabled
                            ? "Port is locked — unlock it first"
                            : "View running config"
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
                          "text-xs font-medium transition-colors",
                          "focus:outline-none focus:ring-2 focus:ring-offset-1",
                          !actionButtonsEnabled
                            ? "bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed pointer-events-none opacity-50"
                            : "bg-slate-800 text-slate-100 hover:bg-slate-900 focus:ring-slate-500",
                        )}
                      >
                        <Terminal size={12} /> Config
                      </button>

                      {/* Config History */}
                      {portsWithHistory.has(p.label) && (
                        <button
                          type="button"
                          onClick={() =>
                            actionButtonsEnabled && onViewHistory(p)
                          }
                          disabled={!actionButtonsEnabled}
                          title={
                            !actionButtonsEnabled
                              ? "Port is locked — unlock it first"
                              : "View config history"
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
                            "text-xs font-medium transition-colors",
                            "focus:outline-none focus:ring-2 focus:ring-offset-1",
                            !actionButtonsEnabled
                              ? "bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed pointer-events-none opacity-50"
                              : "bg-amber-100 text-amber-700 hover:bg-amber-200 focus:ring-amber-500",
                          )}
                        >
                          <History size={12} /> Last Config
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Switch Detail View ───────────────────────────────────────────────────────

function SwitchPortDetail({
  sw,
  pageCache,
  currentPage,
  isAdmin,
  isSuperAdmin,
  token,
  onBack,
  onSync,
  onPageChange,
  onToggleLock,
  onConfigure,
  onLockAll,
  onUnlockAll,
  onSearchFilterChange,
}: {
  sw: CiscoSwitch;
  pageCache: PortPageCache;
  currentPage: number;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  token: string | null;
  onBack: () => void;
  onSync: () => void;
  onPageChange: (p: number) => void;
  onToggleLock: (label: string) => void;
  onConfigure: (port: Port) => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onSearchFilterChange: (search: string, filter: PortFilter) => void;
}) {
  const [search, setSearch] = useState(pageCache.currentSearch);
  const [filter, setFilter] = useState<PortFilter>(pageCache.currentFilter);
  const [view, setView] = useState<"grid" | "table">(() => {
    try {
      return (
        (sessionStorage.getItem(`portView-${sw.id}`) as "grid" | "table") ??
        "table"
      );
    } catch {
      return "table";
    }
  });

  const [runningConfigPort, setRunningConfigPort] = useState<Port | null>(null);
  const [historyPort, setHistoryPort] = useState<Port | null>(null);
  const [portsWithHistory, setPortsWithHistory] = useState<Set<string>>(
    new Set(),
  );

  // ── Lock confirm state (detail view) ────────────────────────────────────
  const [lockConfirm, setLockConfirm] = useState<{
    open: boolean;
    portLabel: string;
  }>({ open: false, portLabel: "" });

  // Intercept onToggleLock — show confirm only when LOCKING (not unlocking)
  const handleToggleLockWithConfirm = useCallback(
    (portLabel: string) => {
      const currentPorts = pageCache.pages[currentPage] ?? [];
      const port = currentPorts.find((p) => p.label === portLabel);
      if (!port) return;

      if (port.locked) {
        // Unlocking — no confirmation needed
        onToggleLock(portLabel);
      } else {
        // Locking — show confirmation dialog
        setLockConfirm({ open: true, portLabel });
      }
    },
    [pageCache.pages, currentPage, onToggleLock],
  );

  const confirmLock = useCallback(() => {
    onToggleLock(lockConfirm.portLabel);
    setLockConfirm({ open: false, portLabel: "" });
  }, [lockConfirm.portLabel, onToggleLock]);

  const cancelLock = useCallback(() => {
    setLockConfirm({ open: false, portLabel: "" });
  }, []);

  useEffect(() => {
    if (!sw.id || !token) return;
    apiFetch<{ success: boolean; port_labels: string[] }>(
      `${PREFIX}/switches/${sw.id}/port-config-history/has-history`,
      token,
    )
      .then((data) => {
        if (data.success) setPortsWithHistory(new Set(data.port_labels));
      })
      .catch(() => {});
  }, [sw.id, token]);

  const portSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleViewChange = (v: "grid" | "table") => {
    setView(v);
    try {
      sessionStorage.setItem(`portView-${sw.id}`, v);
    } catch {}
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (portSearchTimer.current) clearTimeout(portSearchTimer.current);
    portSearchTimer.current = setTimeout(() => {
      onSearchFilterChange(val, filter);
    }, 400);
  };

  const handleFilterChange = (val: PortFilter) => {
    setFilter(val);
    if (portSearchTimer.current) clearTimeout(portSearchTimer.current);
    onSearchFilterChange(search, val);
  };

  useEffect(
    () => () => {
      if (portSearchTimer.current) clearTimeout(portSearchTimer.current);
    },
    [],
  );

  const currentPorts = pageCache.pages[currentPage] ?? [];
  const loadingPage = pageCache.loading;

  const stats = useMemo(() => {
    const all = Object.values(pageCache.pages).flat();
    return {
      active: all.filter((p) => p.status === "active").length,
      inactive: all.filter((p) => p.status === "inactive").length,
      error: all.filter((p) => p.status === "error").length,
      locked: all.filter((p) => p.locked).length,
      unlocked: all.filter((p) => !p.locked).length,
    };
  }, [pageCache.pages]);

  const allCurrentLocked =
    currentPorts.length > 0 && currentPorts.every((p) => p.locked);

  const handleViewConfig = useCallback(
    (port: Port) => {
      if (!isSuperAdmin && port.locked) return;
      setRunningConfigPort(port);
    },
    [isSuperAdmin],
  );

  const handleViewHistory = useCallback(
    (port: Port) => {
      if (!isSuperAdmin && port.locked) return;
      setHistoryPort(port);
    },
    [isSuperAdmin],
  );

  return (
    <div className="space-y-6">
      {/* Lock Confirm Dialog */}
      <LockConfirmDialog
        open={lockConfirm.open}
        portLabel={lockConfirm.portLabel}
        onConfirm={confirmLock}
        onCancel={cancelLock}
      />

      {/* Header */}
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
              <Network className="text-red-700" size={24} /> {sw.name}
            </h2>
            <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
              <span className="font-mono">{sw.host}</span>
              <span>•</span>
              <span>{sw.device_model || "Unknown"}</span>
              {pageCache.totalCount > 0 && (
                <>
                  <span>•</span>
                  <span>{pageCache.totalCount} ports total</span>
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
            {(isAdmin || isSuperAdmin) && (
              <>
                <button
                  onClick={onUnlockAll}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg text-xs font-medium"
                >
                  <Unlock size={14} /> Unlock All
                </button>
                <button
                  onClick={onLockAll}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-medium"
                >
                  <Lock size={14} /> Lock All
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          {
            label: "Total Ports",
            value: pageCache.totalCount,
            color: "text-slate-900",
          },
          { label: "Active", value: stats.active, color: "text-green-700" },
          { label: "Inactive", value: stats.inactive, color: "text-slate-500" },
          { label: "Error", value: stats.error, color: "text-orange-600" },
          { label: "Locked", value: stats.locked, color: "text-red-700" },
          { label: "Unlocked", value: stats.unlocked, color: "text-green-700" },
          {
            label: "Page",
            value: `${currentPage}/${pageCache.totalPages}`,
            color: "text-blue-700",
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

      {/* Alerts */}
      {pageCache.syncing && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3 text-sm text-blue-700">
          <Loader2 size={16} className="animate-spin shrink-0" />
          Fetching live port data from switch…
        </div>
      )}

      {allCurrentLocked && !loadingPage && !isSuperAdmin && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700">
          <Lock size={16} className="shrink-0" />
          All ports on this page have been{" "}
          <strong className="mx-1">locked by the admin</strong> and are
          currently disabled. Contact your administrator to unlock them.
        </div>
      )}

      {allCurrentLocked && !loadingPage && isSuperAdmin && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-700">
          <Lock size={16} className="shrink-0" />
          All ports on this page are <strong className="mx-1">locked</strong>.
          As Super Admin you can still interact with them.
        </div>
      )}

      {pageCache.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} /> {pageCache.error}
        </div>
      )}

      {/* Search / filter / view toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search by port label, MAC, description, VLAN…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          {loadingPage && search.trim() && (
            <Loader2
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
            />
          )}
          {search && !loadingPage && (
            <button
              type="button"
              onClick={() => handleSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value as PortFilter)}
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
              onClick={() => handleViewChange(v)}
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

      {/* Port card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loadingPage ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">Loading ports…</p>
          </div>
        ) : view === "grid" ? (
          <div key={`grid-page-${currentPage}`} className="p-4">
            {currentPorts.length === 0 ? (
              <p className="text-center py-8 text-slate-400 text-sm">
                No ports match the current filter
              </p>
            ) : (
              <PortGrid
                ports={currentPorts}
                onToggleLock={handleToggleLockWithConfirm}
                isAdmin={isAdmin}
                isSuperAdmin={isSuperAdmin}
              />
            )}
          </div>
        ) : (
          <PortTable
            ports={currentPorts}
            onToggleLock={handleToggleLockWithConfirm}
            onConfigure={onConfigure}
            onViewConfig={handleViewConfig}
            onViewHistory={handleViewHistory}
            isAdmin={isAdmin}
            isSuperAdmin={isSuperAdmin}
            portsWithHistory={portsWithHistory}
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
          <Lock size={10} className="text-red-500" />{" "}
          {isSuperAdmin
            ? "Locked (Super Admin can still interact)"
            : "Locked (disabled — unlock to interact)"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
            <History size={9} /> Last Config
          </span>{" "}
          Config history available
        </span>
        <span className="flex items-center gap-1.5">
          <SavedByBadge savedBy="startup" /> startup capture
        </span>
        <span className="flex items-center gap-1.5">
          <SavedByBadge savedBy="periodic" /> scheduled capture
        </span>
      </div>

      {/* Modals */}
      <RunningConfigModal
        open={!!runningConfigPort}
        onClose={() => setRunningConfigPort(null)}
        port={runningConfigPort}
        switchId={sw.id}
        switchName={sw.name}
        token={token}
      />

      <LastConfigModal
        open={!!historyPort}
        onClose={() => setHistoryPort(null)}
        port={historyPort}
        switchId={sw.id}
        switchName={sw.name}
        token={token}
      />
    </div>
  );
}

// ─── Expanded Switch Panel ────────────────────────────────────────────────────

function ExpandedSwitchPanel({
  sw,
  cache,
  currentPage,
  isAdmin,
  isSuperAdmin,
  onPageChange,
  onToggleLock,
  onSync,
  onLockAll,
  onUnlockAll,
}: {
  sw: CiscoSwitch;
  cache: PortPageCache;
  currentPage: number;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onPageChange: (p: number) => void;
  onToggleLock: (label: string) => void;
  onSync: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
}) {
  const ports = cache.pages[currentPage] ?? [];
  const allLocked = ports.length > 0 && ports.every((p) => p.locked);
  const anyLocked = ports.some((p) => p.locked);
  const anyUnlocked = ports.some((p) => !p.locked);

  // ── Lock confirm state (expanded panel) ─────────────────────────────────
  const [lockConfirm, setLockConfirm] = useState<{
    open: boolean;
    portLabel: string;
  }>({ open: false, portLabel: "" });

  const handleToggleLockWithConfirm = useCallback(
    (portLabel: string) => {
      const port = ports.find((p) => p.label === portLabel);
      if (!port) return;

      if (port.locked) {
        onToggleLock(portLabel);
      } else {
        setLockConfirm({ open: true, portLabel });
      }
    },
    [ports, onToggleLock],
  );

  const confirmLock = useCallback(() => {
    onToggleLock(lockConfirm.portLabel);
    setLockConfirm({ open: false, portLabel: "" });
  }, [lockConfirm.portLabel, onToggleLock]);

  const cancelLock = useCallback(() => {
    setLockConfirm({ open: false, portLabel: "" });
  }, []);

  if (cache.loading) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (cache.error) {
    return (
      <div className="text-sm text-red-600 flex items-center gap-2">
        <AlertTriangle size={16} /> {cache.error}
        <button
          onClick={onSync}
          className="ml-2 text-xs underline text-blue-600 hover:text-blue-800"
        >
          Sync from switch
        </button>
      </div>
    );
  }

  if (ports.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-slate-400 mb-3">No port data cached yet.</p>
        <button
          onClick={onSync}
          disabled={cache.syncing}
          className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            className={cache.syncing ? "animate-spin" : ""}
          />
          {cache.syncing ? "Syncing…" : "Sync from Switch"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Lock Confirm Dialog */}
      <LockConfirmDialog
        open={lockConfirm.open}
        portLabel={lockConfirm.portLabel}
        onConfirm={confirmLock}
        onCancel={cancelLock}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Port Overview — Page {currentPage} of {Math.max(1, cache.totalPages)}
          {allLocked ? " · ALL LOCKED" : ""}
        </p>
        {(isAdmin || isSuperAdmin) && (
          <div className="flex items-center gap-2">
            <button
              onClick={onUnlockAll}
              disabled={!anyLocked}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-medium"
            >
              <Unlock size={12} /> Unlock All
            </button>
            <button
              onClick={onLockAll}
              disabled={!anyUnlocked}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-medium"
            >
              <Lock size={12} /> Lock All
            </button>
          </div>
        )}
      </div>

      {allLocked && !isSuperAdmin && (
        <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-300 rounded-lg text-xs text-red-700">
          <Lock size={12} className="shrink-0" />
          All ports have been{" "}
          <strong className="mx-1">locked by the admin</strong> and are
          currently disabled. Contact your administrator to unlock them.
        </div>
      )}

      {allLocked && isSuperAdmin && (
        <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-700">
          <Lock size={12} className="shrink-0" />
          All ports are locked. You can still click them to unlock as Super
          Admin.
        </div>
      )}

      <div key={`panel-grid-${sw.id}-${currentPage}`}>
        <PortGrid
          ports={ports}
          onToggleLock={handleToggleLockWithConfirm}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
        />
      </div>

      {cache.totalPages > 1 && (
        <Pagination
          page={currentPage}
          totalPages={cache.totalPages}
          onChange={onPageChange}
        />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CiscoPortManagementSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);

  const isSuperAdmin = jwt?.role === "SUPER_ADMIN";
  const isAdmin = isSuperAdmin || jwt?.role === "ADMIN";

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
  const [configurePort, setConfigurePort] = useState<{
    port: Port;
    switchId: number;
  } | null>(null);

  // ── Recompute locked flag whenever unlockedSet changes ────────────────────

  // ── Load switches ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    setSwitchesLoading(true);
    apiFetch<{ switches: CiscoSwitch[] }>(`${PREFIX}/switches`, accessToken)
      .then((d) => setSwitches(d.switches ?? []))
      .catch(() => toast.error("Failed to load switches"))
      .finally(() => setSwitchesLoading(false));
  }, [accessToken]);

  // ── Load DB page ──────────────────────────────────────────────────────────
  const loadDbPage = useCallback(
    async (
      switchId: number,
      page: number,
      search?: string,
      filter?: PortFilter,
    ) => {
      const existing = cacheMapRef.current[switchId];
      const effectiveSearch = search ?? existing?.currentSearch ?? "";
      const effectiveFilter = filter ?? existing?.currentFilter ?? "all";
      const searchChanged =
        effectiveSearch !== (existing?.currentSearch ?? "") ||
        effectiveFilter !== (existing?.currentFilter ?? "all");

      if (!searchChanged && existing?.pages[page] && !existing.loading) {
        setPageMap((prev) => ({ ...prev, [switchId]: page }));
        return;
      }

      setCacheMap((prev) => ({
        ...prev,
        [switchId]: {
          ...(prev[switchId] ?? emptyPageCache()),
          loading: true,
          error: null,
          pages: searchChanged ? {} : (prev[switchId]?.pages ?? {}),
          currentSearch: effectiveSearch,
          currentFilter: effectiveFilter,
        },
      }));

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(PAGE_SIZE),
        });
        if (effectiveSearch.trim())
          params.set("search", effectiveSearch.trim());
        if (effectiveFilter !== "all") params.set("filter_by", effectiveFilter);

        const data = await apiFetch<{
          success: boolean;
          port_count: number;
          ports: CiscoPortInfo[];
          page: number;
          page_size: number;
          total_pages: number;
          error?: string;
        }>(
          `${PREFIX}/switches/${switchId}/ports-db?${params.toString()}`,
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
            stats: null,
            currentSearch: effectiveSearch,
            currentFilter: effectiveFilter,
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

  // ── Sync ports from switch ────────────────────────────────────────────────
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
          {
            method: "POST",
          },
        );
        setCacheMap((prev) => ({
          ...prev,
          [switchId]: { ...emptyPageCache(), syncing: false },
        }));
        setPageMap((prev) => ({ ...prev, [switchId]: 1 }));
        setTimeout(() => loadDbPage(switchId, 1), 0);
        toast.success("Ports synced.");
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

  // ── Select / expand ───────────────────────────────────────────────────────
  const selectSwitch = useCallback(
    (id: number) => {
      setSelectedId(id);
      loadDbPage(id, pageMap[id] ?? 1);
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

  // ── Search / filter ───────────────────────────────────────────────────────
  const handleSearchFilterChange = useCallback(
    (switchId: number, search: string, filter: PortFilter) => {
      loadDbPage(switchId, 1, search, filter);
    },
    [loadDbPage],
  );

  // ── Toggle lock (single port) ─────────────────────────────────────────────
  const handleToggleLock = useCallback(
    async (switchId: number, portLabel: string) => {
      if (!isAdmin) {
        toast.error("Only administrators can lock/unlock ports.");
        return;
      }
      try {
        const encoded = encodeURIComponent(portLabel);
        const data = await apiFetch<{
          success: boolean;
          locked: boolean;
          message: string;
        }>(
          `${PREFIX}/switches/${switchId}/ports/${encoded}/toggle-lock`,
          accessToken,
          { method: "POST" },
        );
        toast.success(data.message);
        // Invalidate the cached page so it reloads with fresh lock state from DB
        const currentCache = cacheMapRef.current[switchId];
        const page = pageMap[switchId] ?? 1;
        setCacheMap((prev) => {
          const swCache = prev[switchId];
          if (!swCache) return prev;
          const updatedPages = { ...swCache.pages };
          delete updatedPages[page];
          return { ...prev, [switchId]: { ...swCache, pages: updatedPages } };
        });
        loadDbPage(
          switchId,
          page,
          currentCache?.currentSearch,
          currentCache?.currentFilter,
        );
      } catch (err: any) {
        toast.error(err.message || "Failed to toggle lock");
      }
    },
    [isAdmin, accessToken, pageMap, loadDbPage, setCacheMap],
  );

  // ── Lock all ──────────────────────────────────────────────────────────────
  const handleLockAll = useCallback(
    async (switchId: number) => {
      if (!isAdmin) return;
      try {
        const data = await apiFetch<{
          success: boolean;
          affected: number;
          message: string;
        }>(`${PREFIX}/switches/${switchId}/bulk-lock`, accessToken, {
          method: "POST",
        });
        toast.success(data.message);
        setCacheMap((prev) => ({ ...prev, [switchId]: emptyPageCache() }));
        setPageMap((prev) => ({ ...prev, [switchId]: 1 }));
        setTimeout(() => loadDbPage(switchId, 1), 0);
      } catch (err: any) {
        toast.error(err.message || "Lock all failed");
      }
    },
    [isAdmin, accessToken, loadDbPage, setCacheMap],
  );

  const handleUnlockAll = useCallback(
    async (switchId: number) => {
      if (!isAdmin) return;
      try {
        const data = await apiFetch<{
          success: boolean;
          affected: number;
          message: string;
        }>(`${PREFIX}/switches/${switchId}/bulk-unlock`, accessToken, {
          method: "POST",
        });
        toast.success(data.message);
        setCacheMap((prev) => ({ ...prev, [switchId]: emptyPageCache() }));
        setPageMap((prev) => ({ ...prev, [switchId]: 1 }));
        setTimeout(() => loadDbPage(switchId, 1), 0);
      } catch (err: any) {
        toast.error(err.message || "Unlock all failed");
      }
    },
    [isAdmin, accessToken, loadDbPage, setCacheMap],
  );

  // ── Configure port ────────────────────────────────────────────────────────
  // ─── Replace handleConfigure in the main component ───────────────────────────

  const handleConfigure = useCallback(
    async (
      portLabel: string,
      switchId: number,
      data: {
        mode: "access" | "trunk";
        port_status: AdminStatus;
        access_vlan?: number;
        trunk_allowed_vlans?: number[];
        trunk_native_vlan?: number;
        description?: string;
      },
    ) => {
      const cleanLabel = portLabel.replace(/:\d+$/, "").trim();

      // ── Build correct request body ──────────────────────────────────────
      const body: Record<string, unknown> = {
        port_label: cleanLabel,
        vlan_type: data.mode === "trunk" ? "trunk" : "access",
        // Backend expects an integer for new_vlan
        new_vlan:
          data.mode === "access"
            ? (data.access_vlan ?? 1)
            : (data.trunk_native_vlan ?? 1),
        description: data.description ?? "",
        port_status: data.port_status,
      };

      if (data.mode === "trunk") {
        body.trunk_allowed_vlans = data.trunk_allowed_vlans ?? [];
        body.trunk_native_vlan = data.trunk_native_vlan ?? 1;
      }

      // ── Call backend ────────────────────────────────────────────────────
      let result: {
        success: boolean;
        error?: string;
        output?: string;
        current_vlan?: number | null;
        protocol_used?: string | null;
      };

      try {
        result = await apiFetch<typeof result>(
          `${PREFIX}/switches/${switchId}/change-vlan`,
          accessToken,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      } catch (err: any) {
        const msg =
          typeof err === "string"
            ? err
            : typeof err?.message === "string" && err.message
              ? err.message
              : "Request failed";
        toast.error(
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Configuration failed</span>
            <span className="text-xs font-mono break-all">
              "The Port is Locked! Try To Unlocked First."
            </span>
          </div>,
          { duration: 7000 },
        );
        throw new Error(msg);
      }

      // ── Backend returned success: false ─────────────────────────────────
      if (!result.success) {
        const errMsg =
          typeof result.error === "string"
            ? result.error
            : result.error
              ? JSON.stringify(result.error)
              : "Switch rejected the configuration. Check connectivity and VLAN validity.";

        toast.error(
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <XCircle size={14} className="text-red-500 shrink-0" />
              <span className="font-semibold text-red-800">
                Configuration failed
              </span>
            </div>
            <span className="text-xs text-red-700 font-mono break-all leading-relaxed">
              "The Port is Locked! Try To Unlocked First."
            </span>
          </div>,
          {
            duration: 9000,
            style: {
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#991b1b",
            },
          },
        );

        throw new Error(errMsg);
      }

      // ── Success — check if port is locked ───────────────────────────────
      const currentCache = cacheMapRef.current[switchId];
      const allCachedPorts = Object.values(currentCache?.pages ?? {}).flat();
      const portObj = allCachedPorts.find((p) => p.label === cleanLabel);
      const isLocked = portObj?.locked ?? false;

      const vlanLabel =
        data.mode === "access"
          ? `VLAN ${data.access_vlan ?? 1}`
          : `native ${data.trunk_native_vlan ?? 1}, ${(data.trunk_allowed_vlans ?? []).length} allowed`;

      const statusLabel = data.port_status === "up" ? "up" : "down";

      if (isLocked) {
        // ── Port is locked — red warning toast ─────────────────────────
        toast.error(
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Lock size={11} className="text-red-600" />
              </div>
              <span className="font-bold text-red-800 text-sm">
                Port {cleanLabel} — Locked
              </span>
            </div>
            <p className="text-xs text-red-700 leading-relaxed pl-7">
              Applied as <strong>{data.mode}</strong> ({vlanLabel},{" "}
              <strong>{statusLabel}</strong>), but this port is{" "}
              <strong>locked</strong>. Unlock it to allow further changes.
            </p>
          </div>,
          {
            duration: 8000,
            style: {
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#991b1b",
            },
          },
        );
      } else {
        // ── Port is unlocked — normal green success toast ───────────────
        toast.success(
          `Port ${cleanLabel} configured as ${data.mode} (${vlanLabel}, ${statusLabel})`,
          { duration: 4000 },
        );
      }

      // ── Invalidate cache page and reload ────────────────────────────────
      const page = pageMap[switchId] ?? 1;
      setCacheMap((prev) => {
        const swCache = prev[switchId];
        if (!swCache) return prev;
        const updatedPages = { ...swCache.pages };
        delete updatedPages[page];
        return { ...prev, [switchId]: { ...swCache, pages: updatedPages } };
      });
      loadDbPage(
        switchId,
        page,
        currentCache?.currentSearch,
        currentCache?.currentFilter,
      );
    },
    [accessToken, pageMap, loadDbPage, setCacheMap],
  );
  const handleConfigureRequest = useCallback(
    (port: Port, switchId: number) => {
      if (!isSuperAdmin && port.locked) {
        toast.error(
          `Port ${port.label} is locked — unlock it first before configuring.`,
          { duration: 4000 },
        );
        return;
      }
      setConfigurePort({ port, switchId });
    },
    [isSuperAdmin],
  );

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedSwitch =
    selectedId !== null ? switches.find((s) => s.id === selectedId) : null;
  const selectedCache =
    selectedId !== null ? (cacheMap[selectedId] ?? emptyPageCache()) : null;
  const selectedPage = selectedId !== null ? (pageMap[selectedId] ?? 1) : 1;

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedSwitch && selectedCache) {
    return (
      <>
        <SwitchPortDetail
          sw={selectedSwitch}
          pageCache={selectedCache}
          currentPage={selectedPage}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
          token={accessToken}
          onBack={() => setSelectedId(null)}
          onSync={() => syncPorts(selectedSwitch.id)}
          onPageChange={(p) =>
            loadDbPage(
              selectedSwitch.id,
              p,
              selectedCache.currentSearch,
              selectedCache.currentFilter,
            )
          }
          onToggleLock={(label) => handleToggleLock(selectedSwitch.id, label)}
          onConfigure={(port) =>
            handleConfigureRequest(port, selectedSwitch.id)
          }
          onLockAll={() => handleLockAll(selectedSwitch.id)}
          onUnlockAll={() => handleUnlockAll(selectedSwitch.id)}
          onSearchFilterChange={(search, filter) =>
            handleSearchFilterChange(selectedSwitch.id, search, filter)
          }
        />
        <ConfigurePortModal
          open={
            !!configurePort &&
            configurePort.switchId === selectedSwitch.id &&
            (isSuperAdmin || !configurePort.port.locked)
          }
          onClose={() => setConfigurePort(null)}
          port={configurePort?.port ?? null}
          switchId={selectedSwitch.id}
          switchName={selectedSwitch.name}
          token={accessToken}
          onSave={(label, data) =>
            handleConfigure(label, selectedSwitch.id, data)
          }
        />
      </>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
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
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Cable className="text-red-700" size={28} /> Port Management
        </h1>
        <p className="text-slate-500 mt-1">
          All ports are <strong>locked by default</strong>. Unlock individual
          ports or use "Unlock All" to enable them.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          {
            label: "Total Switches",
            value: switches.length,
            border: "border-slate-200",
            text: "text-slate-900",
            head: "text-slate-500",
          },
          {
            label: "Active Ports",
            value: totalActive || "—",
            border: "border-green-200",
            text: "text-green-700",
            head: "text-green-600",
          },
          {
            label: "Locked Ports",
            value: totalLocked || "—",
            border: "border-red-200",
            text: "text-red-700",
            head: "text-red-600",
          },
          {
            label: "Access Ports",
            value: totalPortsLoaded > 0 ? totalAccess : "—",
            border: "border-blue-200",
            text: "text-blue-700",
            head: "text-blue-600",
          },
          {
            label: "Trunk Ports",
            value: totalPortsLoaded > 0 ? totalTrunk : "—",
            border: "border-purple-200",
            text: "text-purple-700",
            head: "text-purple-600",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`bg-white rounded-xl border ${s.border} p-4 shadow-sm`}
          >
            <p className={`text-sm ${s.head}`}>{s.label}</p>
            <p className={`text-2xl font-bold ${s.text} mt-1`}>{s.value}</p>
          </div>
        ))}
      </div>

      {switchesLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={28} className="animate-spin mr-2" /> Loading switches…
        </div>
      )}

      {/* Switch list */}
      <div className="space-y-3">
        {switches.map((sw) => {
          const cache = cacheMap[sw.id] ?? emptyPageCache();
          const isExp = expandedId === sw.id;
          const currentPage = pageMap[sw.id] ?? 1;
          const allCachedPorts = Object.values(cache.pages).flat();
          const lockedCount = allCachedPorts.filter((p) => p.locked).length;
          const activeCount = allCachedPorts.filter(
            (p) => p.status === "active",
          ).length;
          const allLocked =
            allCachedPorts.length > 0 && allCachedPorts.every((p) => p.locked);

          return (
            <div
              key={sw.id}
              className={cn(
                "bg-white rounded-xl border shadow-sm overflow-hidden transition-colors",
                allLocked && allCachedPorts.length > 0
                  ? "border-red-200"
                  : "border-slate-200",
              )}
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
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      {sw.name}
                      {allLocked && allCachedPorts.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 border border-red-200">
                          <Lock size={9} /> All Locked
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {sw.host} • {sw.device_model || "Unknown"}
                      {cache.totalCount > 0 && ` • ${cache.totalCount} ports`}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-4">
                  {!cache.loading && allCachedPorts.length > 0 && (
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
                  <ExpandedSwitchPanel
                    sw={sw}
                    cache={cache}
                    currentPage={currentPage}
                    isAdmin={isAdmin}
                    isSuperAdmin={isSuperAdmin}
                    onPageChange={(p) => loadDbPage(sw.id, p)}
                    onToggleLock={(label) => handleToggleLock(sw.id, label)}
                    onSync={() => syncPorts(sw.id)}
                    onLockAll={() => handleLockAll(sw.id)}
                    onUnlockAll={() => handleUnlockAll(sw.id)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {!switchesLoading && switches.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <Network size={48} className="mx-auto mb-3 opacity-40" />
            <p>No switches found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
