// src/components/cisco/CiscoVlanManagementSection.tsx

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  AlertCircle,
  Cable,
  Wifi,
  WifiOff,
  Hash,
  Loader2,
  Clock,
  Layers,
  Monitor,
  Network,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Power,
  PowerOff,
  Terminal,
  AlertTriangle,
  CheckCircle,
  Activity,
  Info,
  Ban,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useAuth } from "../../context/AuthContext";
import { fetchSwitches } from "../../services/ciscoVlanApi";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SwitchOption {
  id: number;
  name: string;
}

interface InterfaceInfo {
  name: string;
  status: string;
  protocol: string;
  ip_address: string | null;
}

interface VlanInfo {
  id: number;
  name: string;
  status: string;
  ports: string[];
}

interface InterfacesPageResponse {
  success: boolean;
  switch_id: number;
  interfaces: InterfaceInfo[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  cached_at: string | null;
  protocol_used: string | null;
  error?: string;
}

interface VlansPageResponse {
  success: boolean;
  switch_id: number;
  vlans: VlanInfo[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  cached_at: string | null;
  protocol_used: string | null;
  error?: string;
}

interface VlanMgmtItem {
  id: number;
  vlan_id: number;
  name: string;
  status: string;
  port_count: number;
  created_at: string;
  updated_at: string;
}

interface InterfaceActionResult {
  success: boolean;
  output?: string;
  error?: string;
  protocol_used?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CISCO_BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${CISCO_BASE}/api/v1/cisco`;

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  API Helpers                                                        */
/* ------------------------------------------------------------------ */

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
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail || body?.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Countdown hook                                                     */
/* ------------------------------------------------------------------ */

function useCountdown(targetMs: number | null): string {
  const [display, setDisplay] = useState("—");
  useEffect(() => {
    if (targetMs === null) return;
    const tick = () => {
      const remaining = targetMs - Date.now();
      if (remaining <= 0) {
        setDisplay("syncing…");
        return;
      }
      const m = Math.floor(remaining / 60_000);
      const s = Math.floor((remaining % 60_000) / 1000);
      setDisplay(`${m}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return display;
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                         */
/* ------------------------------------------------------------------ */

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const safeTotalPages = Math.max(1, totalPages);
  return (
    <div className="flex items-center justify-between px-1 mt-4">
      <p className="text-xs text-slate-500">
        Page {page} of {safeTotalPages} · {total} total
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={15} className="text-slate-600" />
        </button>
        {Array.from({ length: Math.min(safeTotalPages, 5) }, (_, i) => {
          let p: number;
          if (safeTotalPages <= 5) p = i + 1;
          else if (page <= 3) p = i + 1;
          else if (page >= safeTotalPages - 2) p = safeTotalPages - 4 + i;
          else p = page - 2 + i;
          return (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors border ${
                p === page
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= safeTotalPages}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={15} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm Dialog                                                     */
/* ------------------------------------------------------------------ */

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmColor = "red",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: "red" | "green" | "blue";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onCancel]);

  if (!open) return null;

  const colorMap = {
    red: "bg-red-600 hover:bg-red-700",
    green: "bg-green-600 hover:bg-green-700",
    blue: "bg-blue-600 hover:bg-blue-700",
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-5">
          <div
            className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
              confirmColor === "red"
                ? "bg-red-100"
                : confirmColor === "green"
                  ? "bg-green-100"
                  : "bg-blue-100",
            )}
          >
            <AlertTriangle
              size={20}
              className={
                confirmColor === "red"
                  ? "text-red-600"
                  : confirmColor === "green"
                    ? "text-green-600"
                    : "text-blue-600"
              }
            />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{message}</p>
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
            className={cn(
              "px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors",
              colorMap[confirmColor],
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Interface Output Modal                                             */
/* ------------------------------------------------------------------ */

function InterfaceOutputModal({
  open,
  onClose,
  title,
  output,
  error,
  loading,
  success,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  output: string | null;
  error: string | null;
  loading: boolean;
  success: boolean | null;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center",
                loading
                  ? "bg-blue-500/20"
                  : success === false
                    ? "bg-red-500/20"
                    : "bg-green-500/20",
              )}
            >
              {loading ? (
                <Loader2 size={16} className="text-blue-400 animate-spin" />
              ) : success === false ? (
                <AlertCircle size={16} className="text-red-400" />
              ) : (
                <Terminal size={16} className="text-green-400" />
              )}
            </div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
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
              <Loader2 size={28} className="animate-spin mb-3 text-blue-400" />
              <p className="text-sm font-mono text-slate-300">
                Entering config mode on switch…
              </p>
              <p className="text-xs text-slate-500 mt-2 font-mono">
                connect → enable → conf t → interface → shutdown/no shutdown →
                end
              </p>
            </div>
          )}

          {error && !loading && (
            <>
              <div className="flex items-start gap-3 p-4 bg-red-900/30 border border-red-700/50 rounded-lg mb-4">
                <AlertCircle
                  size={18}
                  className="text-red-400 shrink-0 mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold text-red-300 mb-1">
                    Command failed — buttons have been disabled for this
                    interface
                  </p>
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              </div>
              <div className="mt-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
                <p className="text-xs text-amber-400 font-mono">
                  ⚠ The interface buttons are now locked. Click "Refresh" to
                  re-sync from the switch and re-enable them.
                </p>
              </div>
            </>
          )}

          {output && !loading && (
            <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
              {output}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end px-6 py-3 border-t border-slate-200 bg-slate-50">
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

/* ------------------------------------------------------------------ */
/*  Add VLAN Modal                                                     */
/* ------------------------------------------------------------------ */

function AddVlanModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (data: { vlan_id: number; name: string }) => Promise<void>;
}) {
  const [vlanId, setVlanId] = useState("");
  const [vlanName, setVlanName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setVlanId("");
      setVlanName("");
      setError("");
    }
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseInt(vlanId, 10);
    if (isNaN(id) || id < 2 || id > 4094) {
      setError("VLAN ID must be between 2 and 4094.");
      return;
    }
    if (!vlanName.trim()) {
      setError("VLAN name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({ vlan_id: id, name: vlanName.trim() });
    } catch (err: any) {
      setError(err.message || "Failed to create VLAN.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Plus size={16} className="text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              Add New VLAN
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0" /> {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              VLAN ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={vlanId}
              onChange={(e) => {
                setVlanId(e.target.value);
                setError("");
              }}
              placeholder="2 – 4094"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Enter a value between 2 and 4094.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              VLAN Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={32}
              value={vlanName}
              onChange={(e) => {
                setVlanName(e.target.value);
                setError("");
              }}
              placeholder="e.g. Engineering"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
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
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create VLAN"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CiscoVlanManagementSection() {
  const { accessToken } = useAuth();

  const [switches, setSwitches] = useState<SwitchOption[]>([]);
  const [selectedSwitchId, setSelectedSwitchId] = useState<number | null>(null);
  const [loadingSwitches, setLoadingSwitches] = useState(false);

  // ── Interfaces state ──────────────────────────────────────────────
  const [interfacesData, setInterfacesData] =
    useState<InterfacesPageResponse | null>(null);
  const [interfacesPage, setInterfacesPage] = useState(1);
  const [interfacesSearch, setInterfacesSearch] = useState("");
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [interfacesError, setInterfacesError] = useState<string | null>(null);
  const [syncingInterfaces, setSyncingInterfaces] = useState(false);

  // ── Interface action state ────────────────────────────────────────
  // Tracks which interfaces are currently having an action applied
  const [actioningInterfaces, setActioningInterfaces] = useState<Set<string>>(
    new Set(),
  );
  // Optimistic local override: name → "up" | "down"
  const [localStatusOverride, setLocalStatusOverride] = useState<
    Record<string, "up" | "down">
  >({});

  // Interfaces that failed their last action — buttons stay disabled until refresh
  const [failedInterfaces, setFailedInterfaces] = useState<Set<string>>(
    new Set(),
  );

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    ifaceName: string;
    action: "up" | "down";
  }>({ open: false, ifaceName: "", action: "up" });

  // Output modal state
  const [outputModal, setOutputModal] = useState<{
    open: boolean;
    title: string;
    output: string | null;
    error: string | null;
    loading: boolean;
    success: boolean | null;
  }>({
    open: false,
    title: "",
    output: null,
    error: null,
    loading: false,
    success: null,
  });

  // ── Switch VLANs snapshot state ───────────────────────────────────
  const [vlansData, setVlansData] = useState<VlansPageResponse | null>(null);
  const [vlansPage, setVlansPage] = useState(1);
  const [vlansSearch, setVlansSearch] = useState("");
  const [loadingVlans, setLoadingVlans] = useState(false);
  const [vlansError, setVlansError] = useState<string | null>(null);
  const [syncingVlans, setSyncingVlans] = useState(false);

  // ── Add VLAN modal ────────────────────────────────────────────────
  const [addVlanOpen, setAddVlanOpen] = useState(false);

  // ── Auto-sync ─────────────────────────────────────────────────────
  const [nextSyncAt, setNextSyncAt] = useState<number | null>(null);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ifaceSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vlanSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown = useCountdown(nextSyncAt);

  /* ----------------------------------------------------------------
   * DB-read helpers
   * ---------------------------------------------------------------- */

  const loadInterfacesFromDb = useCallback(
    async (switchId: number, page: number, search: string) => {
      setLoadingInterfaces(true);
      setInterfacesError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "20",
        });
        if (search.trim()) params.set("search", search.trim());
        const data = await apiFetch<InterfacesPageResponse>(
          `${PREFIX}/switches/${switchId}/interfaces-db?${params.toString()}`,
          accessToken,
        );
        setInterfacesData(data);
      } catch (err: any) {
        setInterfacesError(err.message || "Failed to load interfaces.");
      } finally {
        setLoadingInterfaces(false);
      }
    },
    [accessToken],
  );

  const loadVlansFromDb = useCallback(
    async (switchId: number, page: number, search: string) => {
      setLoadingVlans(true);
      setVlansError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "20",
        });
        if (search.trim()) params.set("search", search.trim());
        const data = await apiFetch<VlansPageResponse>(
          `${PREFIX}/switches/${switchId}/vlans-db?${params.toString()}`,
          accessToken,
        );
        setVlansData(data);
      } catch (err: any) {
        setVlansError(err.message || "Failed to load VLANs.");
      } finally {
        setLoadingVlans(false);
      }
    },
    [accessToken],
  );

  /* ----------------------------------------------------------------
   * Sync helpers
   * ---------------------------------------------------------------- */

  const syncAndLoadInterfaces = useCallback(
    async (switchId: number, page: number, search: string) => {
      setSyncingInterfaces(true);
      try {
        await apiFetch(
          `${PREFIX}/switches/${switchId}/sync-interfaces`,
          accessToken,
          { method: "POST" },
        );
      } catch (err: any) {
        console.warn("sync-interfaces failed:", err.message);
      } finally {
        setSyncingInterfaces(false);
      }
      await loadInterfacesFromDb(switchId, page, search);
    },
    [accessToken, loadInterfacesFromDb],
  );

  const syncAndLoadVlans = useCallback(
    async (switchId: number, page: number, search: string) => {
      setSyncingVlans(true);
      try {
        await apiFetch(
          `${PREFIX}/switches/${switchId}/sync-vlans`,
          accessToken,
          { method: "POST" },
        );
      } catch (err: any) {
        console.warn("sync-vlans failed:", err.message);
      } finally {
        setSyncingVlans(false);
      }
      await loadVlansFromDb(switchId, page, search);
    },
    [accessToken, loadVlansFromDb],
  );

  /* ----------------------------------------------------------------
   * Interface Up / Down action
   * ---------------------------------------------------------------- */

  const applyInterfaceAction = useCallback(
    async (ifaceName: string, action: "up" | "down") => {
      if (!selectedSwitchId) return;

      // Mark as actioning
      setActioningInterfaces((prev) => new Set([...prev, ifaceName]));

      // Show output modal in loading state
      setOutputModal({
        open: true,
        title: `${action === "up" ? "Enabling" : "Disabling"} ${ifaceName}`,
        output: null,
        error: null,
        loading: true,
        success: null,
      });

      const shutdownCmd = action === "down" ? "shutdown" : "no shutdown";
      // Send multiline command — backend detects the interface+shutdown pattern
      // and automatically routes through conf t via _ssh_config_commands
      const command = `interface ${ifaceName}\n${shutdownCmd}\nend`;

      try {
        const result = await apiFetch<InterfaceActionResult>(
          `${PREFIX}/switches/${selectedSwitchId}/execute`,
          accessToken,
          {
            method: "POST",
            body: JSON.stringify({
              command,
              enable_mode: true,
            }),
          },
        );

        if (result.success) {
          // Clear any previous failure for this interface
          setFailedInterfaces((prev) => {
            const next = new Set(prev);
            next.delete(ifaceName);
            return next;
          });

          // Optimistic update
          setLocalStatusOverride((prev) => ({ ...prev, [ifaceName]: action }));

          toast.success(
            `Interface ${ifaceName} ${action === "up" ? "enabled" : "disabled"} successfully`,
          );

          setOutputModal({
            open: true,
            title: `✓ ${action === "up" ? "Enabled" : "Disabled"} — ${ifaceName}`,
            output:
              result.output ||
              `Session flow:\n  connect → enable → conf t → interface ${ifaceName} → ${shutdownCmd} → end\n\nCommand applied successfully.`,
            error: null,
            loading: false,
            success: true,
          });

          // Re-sync interfaces from switch after a short delay
          setTimeout(async () => {
            if (selectedSwitchId) {
              await syncAndLoadInterfaces(
                selectedSwitchId,
                interfacesPage,
                interfacesSearch,
              );
              // Clear the optimistic override once DB is refreshed
              setLocalStatusOverride((prev) => {
                const next = { ...prev };
                delete next[ifaceName];
                return next;
              });
            }
          }, 2500);
        } else {
          // Mark interface as failed — disable its buttons
          setFailedInterfaces((prev) => new Set([...prev, ifaceName]));

          toast.error(
            `Failed to ${action === "up" ? "enable" : "disable"} ${ifaceName} — buttons disabled, click Refresh to re-enable`,
          );
          setOutputModal({
            open: true,
            title: `✗ Failed — ${ifaceName}`,
            output: result.output || null,
            error: result.error || "Unknown error from switch",
            loading: false,
            success: false,
          });
        }
      } catch (err: any) {
        // Network / API error — also disable buttons
        setFailedInterfaces((prev) => new Set([...prev, ifaceName]));

        toast.error(
          err.message
            ? `${err.message} — buttons disabled, click Refresh to re-enable`
            : "Command failed — buttons disabled, click Refresh to re-enable",
        );
        setOutputModal({
          open: true,
          title: `✗ Error — ${ifaceName}`,
          output: null,
          error: err.message || "Unknown error",
          loading: false,
          success: false,
        });
      } finally {
        setActioningInterfaces((prev) => {
          const next = new Set(prev);
          next.delete(ifaceName);
          return next;
        });
      }
    },
    [
      selectedSwitchId,
      accessToken,
      interfacesPage,
      interfacesSearch,
      syncAndLoadInterfaces,
    ],
  );

  // Called when user clicks Up/Down button — shows confirm dialog first
  const requestInterfaceAction = useCallback(
    (ifaceName: string, action: "up" | "down") => {
      setConfirmState({ open: true, ifaceName, action });
    },
    [],
  );

  const handleConfirmAction = useCallback(() => {
    const { ifaceName, action } = confirmState;
    setConfirmState({ open: false, ifaceName: "", action: "up" });
    applyInterfaceAction(ifaceName, action);
  }, [confirmState, applyInterfaceAction]);

  /* ----------------------------------------------------------------
   * Auto-sync scheduler
   * ---------------------------------------------------------------- */

  const scheduleAutoSync = useCallback(
    (switchId: number) => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      const fireAt = Date.now() + AUTO_SYNC_INTERVAL_MS;
      setNextSyncAt(fireAt);
      autoSyncTimerRef.current = setTimeout(async () => {
        await Promise.all([
          syncAndLoadInterfaces(switchId, 1, ""),
          syncAndLoadVlans(switchId, 1, ""),
        ]);
        setInterfacesPage(1);
        setVlansPage(1);
        setInterfacesSearch("");
        setVlansSearch("");
        toast.info("Auto-sync complete — data refreshed from switch.");
        scheduleAutoSync(switchId);
      }, AUTO_SYNC_INTERVAL_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncAndLoadInterfaces, syncAndLoadVlans],
  );

  useEffect(() => {
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, []);

  /* ----------------------------------------------------------------
   * Load switches
   * ---------------------------------------------------------------- */

  useEffect(() => {
    loadSwitchesFn();
  }, []); // eslint-disable-line

  async function loadSwitchesFn() {
    setLoadingSwitches(true);
    try {
      const data = await fetchSwitches();
      const list: SwitchOption[] = (data.switches ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
      }));
      setSwitches(list);
      if (list.length > 0) setSelectedSwitchId(list[0].id);
    } catch (err: any) {
      console.error("Failed to load switches:", err);
      toast.error("Failed to load switches");
    } finally {
      setLoadingSwitches(false);
    }
  }

  /* ----------------------------------------------------------------
   * When selected switch changes
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!selectedSwitchId) return;
    setInterfacesPage(1);
    setVlansPage(1);
    setInterfacesSearch("");
    setVlansSearch("");
    setInterfacesData(null);
    setVlansData(null);
    setLocalStatusOverride({});
    // Clear failures when switching to a different switch
    setFailedInterfaces(new Set());
    loadInterfacesFromDb(selectedSwitchId, 1, "");
    loadVlansFromDb(selectedSwitchId, 1, "");
    scheduleAutoSync(selectedSwitchId);
  }, [selectedSwitchId]); // eslint-disable-line

  /* ----------------------------------------------------------------
   * Manual Refresh — clears failed interfaces so buttons re-enable
   * ---------------------------------------------------------------- */

  const handleRefresh = useCallback(async () => {
    if (!selectedSwitchId) return;
    setLocalStatusOverride({});
    setFailedInterfaces(new Set()); // re-enable all buttons
    await Promise.all([
      syncAndLoadInterfaces(selectedSwitchId, interfacesPage, interfacesSearch),
      syncAndLoadVlans(selectedSwitchId, vlansPage, vlansSearch),
    ]);
    scheduleAutoSync(selectedSwitchId);
  }, [
    selectedSwitchId,
    interfacesPage,
    interfacesSearch,
    vlansPage,
    vlansSearch,
    syncAndLoadInterfaces,
    syncAndLoadVlans,
    scheduleAutoSync,
  ]);

  /* ----------------------------------------------------------------
   * Add VLAN
   * ---------------------------------------------------------------- */

  const handleAddVlan = useCallback(
    async (data: { vlan_id: number; name: string }) => {
      await apiFetch<VlanMgmtItem>(
        `${PREFIX}/vlan-management/vlans`,
        accessToken,
        { method: "POST", body: JSON.stringify(data) },
      );
      toast.success(`VLAN ${data.vlan_id} (${data.name}) created successfully`);
      setAddVlanOpen(false);
      if (selectedSwitchId) {
        setVlansSearch("");
        setVlansPage(1);
        await loadVlansFromDb(selectedSwitchId, 1, "");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, selectedSwitchId],
  );

  /* ----------------------------------------------------------------
   * Search handlers
   * ---------------------------------------------------------------- */

  const handleInterfaceSearchChange = (val: string) => {
    setInterfacesSearch(val);
    setInterfacesPage(1);
    if (ifaceSearchTimer.current) clearTimeout(ifaceSearchTimer.current);
    ifaceSearchTimer.current = setTimeout(() => {
      if (selectedSwitchId) loadInterfacesFromDb(selectedSwitchId, 1, val);
    }, 350);
  };

  const handleVlanSearchChange = (val: string) => {
    setVlansSearch(val);
    setVlansPage(1);
    if (vlanSearchTimer.current) clearTimeout(vlanSearchTimer.current);
    vlanSearchTimer.current = setTimeout(() => {
      if (selectedSwitchId) loadVlansFromDb(selectedSwitchId, 1, val);
    }, 350);
  };

  const handleInterfacesPageChange = (p: number) => {
    setInterfacesPage(p);
    if (selectedSwitchId)
      loadInterfacesFromDb(selectedSwitchId, p, interfacesSearch);
  };

  const handleVlansPageChange = (p: number) => {
    setVlansPage(p);
    if (selectedSwitchId) loadVlansFromDb(selectedSwitchId, p, vlansSearch);
  };

  /* ----------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------- */

  const getEffectiveStatus = (
    iface: InterfaceInfo,
  ): "up" | "down" | "admin-down" => {
    const override = localStatusOverride[iface.name];
    if (override) return override;
    const s = iface.status.toLowerCase();
    const p = iface.protocol.toLowerCase();
    if (s.includes("up") && p.includes("up")) return "up";
    if (s.includes("admin") || s.includes("administratively"))
      return "admin-down";
    return "down";
  };

  const isSyncing = syncingInterfaces || syncingVlans;
  const isBusy = isSyncing || loadingInterfaces || loadingVlans;

  /* ----------------------------------------------------------------
   * Guard renders
   * ---------------------------------------------------------------- */

  if (loadingSwitches) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Loader2 size={48} className="animate-spin mb-4" />
        <p className="text-sm">Loading switches…</p>
      </div>
    );
  }

  if (switches.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12">
        <div className="text-center text-slate-400">
          <Network size={64} className="mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            No Switches Available
          </h3>
          <p className="text-sm">
            Add a Cisco switch in the Switch Management section.
          </p>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* ── Header bar ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-1">
              <Layers size={24} className="text-blue-600" />
              Switch Interfaces & VLANs
            </h2>
            <p className="text-sm text-slate-500">
              Manage interfaces (up/down) · auto-syncs every 30 min
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {nextSyncAt !== null && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500">
                <Clock size={12} className="shrink-0" />
                <span>
                  Next sync:{" "}
                  <span className="font-mono font-medium text-slate-700">
                    {countdown}
                  </span>
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                Switch:
              </label>
              <select
                value={selectedSwitchId || ""}
                onChange={(e) => setSelectedSwitchId(Number(e.target.value))}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              >
                {switches.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setAddVlanOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Plus size={16} /> Add VLAN
            </button>

            <button
              onClick={handleRefresh}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw
                size={16}
                className={cn(isSyncing && "animate-spin")}
              />
              {isSyncing ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Failed interfaces warning banner */}
        {failedInterfaces.size > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Ban size={13} className="shrink-0 text-amber-600" />
            <span>
              <span className="font-semibold">{failedInterfaces.size}</span>{" "}
              interface{failedInterfaces.size > 1 ? "s" : ""} had a failed
              action and {failedInterfaces.size > 1 ? "their" : "its"} buttons
              are disabled. Click <span className="font-semibold">Refresh</span>{" "}
              to re-sync from the switch and re-enable them.
            </span>
          </div>
        )}

        {isSyncing && (
          <div className="mt-3 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <Loader2 size={13} className="animate-spin shrink-0" />
            {syncingInterfaces && syncingVlans
              ? "Syncing interfaces and VLANs from switch to database…"
              : syncingInterfaces
                ? "Syncing interfaces…"
                : "Syncing VLANs…"}
          </div>
        )}
      </div>

      {/* ── Interfaces + VLANs grid ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ══ Interfaces Card ══════════════════════════════════════ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Card header */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100/50 border-b border-blue-200 p-5">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-3">
                <div className="bg-blue-600 p-2.5 rounded-lg shadow-sm">
                  <Cable size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">
                    Interfaces
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click <Power size={10} className="inline" /> /
                    <PowerOff size={10} className="inline mx-0.5" /> to enable
                    or disable
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                    <Clock size={12} />
                    <span>
                      {interfacesData?.cached_at
                        ? new Date(interfacesData.cached_at).toLocaleString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "Not synced yet"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {interfacesData?.total ?? 0}
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  {interfacesSearch ? "Matched" : "Total"}
                </div>
              </div>
            </div>

            {/* Interface status summary */}
            {interfacesData && interfacesData.total > 0 && (
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-blue-200/60">
                <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  {
                    interfacesData.interfaces.filter(
                      (i) =>
                        i.status.toLowerCase().includes("up") &&
                        i.protocol.toLowerCase().includes("up"),
                    ).length
                  }{" "}
                  up
                </div>
                <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {
                    interfacesData.interfaces.filter((i) =>
                      i.status.toLowerCase().includes("admin"),
                    ).length
                  }{" "}
                  admin-down
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  {
                    interfacesData.interfaces.filter(
                      (i) =>
                        !i.status.toLowerCase().includes("up") &&
                        !i.status.toLowerCase().includes("admin"),
                    ).length
                  }{" "}
                  down
                </div>
                {failedInterfaces.size > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                    <Ban size={10} />
                    {failedInterfaces.size} locked
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="p-4 border-b border-slate-200 bg-white">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search by name, IP, status, protocol…"
                value={interfacesSearch}
                onChange={(e) => handleInterfaceSearchChange(e.target.value)}
                className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {loadingInterfaces && (
                <Loader2
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
                />
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto max-h-[560px] bg-slate-50">
            {loadingInterfaces ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">Loading interfaces…</span>
              </div>
            ) : interfacesError ? (
              <div className="m-5">
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold mb-1">
                      Error Loading Interfaces
                    </p>
                    <p>{interfacesError}</p>
                  </div>
                </div>
              </div>
            ) : interfacesData && interfacesData.interfaces.length > 0 ? (
              <div className="p-4 space-y-2">
                {interfacesData.interfaces.map((iface, idx) => {
                  const effectiveStatus = getEffectiveStatus(iface);
                  const isUp = effectiveStatus === "up";
                  const isAdminDown = effectiveStatus === "admin-down";
                  const isActioning = actioningInterfaces.has(iface.name);
                  const isFailed = failedInterfaces.has(iface.name);
                  // Buttons are disabled if: currently actioning, already in target state, or previously failed
                  const upDisabled = isActioning || isUp || isFailed;
                  const downDisabled = isActioning || isAdminDown || isFailed;

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-xl border transition-all",
                        isFailed
                          ? "bg-amber-50/60 border-amber-200"
                          : isUp
                            ? "bg-white border-green-200 hover:border-green-300 hover:shadow-sm"
                            : isAdminDown
                              ? "bg-red-50/50 border-red-200 hover:border-red-300"
                              : "bg-slate-50 border-slate-200 hover:border-slate-300",
                      )}
                    >
                      {/* Main row */}
                      <div className="flex items-center gap-3 p-3">
                        {/* Status icon */}
                        <div
                          className={cn(
                            "shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
                            isFailed
                              ? "bg-amber-100"
                              : isUp
                                ? "bg-green-100"
                                : isAdminDown
                                  ? "bg-red-100"
                                  : "bg-slate-100",
                          )}
                        >
                          {isActioning ? (
                            <Loader2
                              size={18}
                              className="animate-spin text-blue-500"
                            />
                          ) : isFailed ? (
                            <Ban size={18} className="text-amber-500" />
                          ) : isUp ? (
                            <Wifi size={18} className="text-green-600" />
                          ) : (
                            <WifiOff
                              size={18}
                              className={
                                isAdminDown ? "text-red-500" : "text-slate-400"
                              }
                            />
                          )}
                        </div>

                        {/* Interface info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-slate-800 text-sm truncate">
                              {iface.name}
                            </span>
                            {/* Status badge */}
                            {!isFailed && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                                  isUp
                                    ? "bg-green-100 text-green-700"
                                    : isAdminDown
                                      ? "bg-red-100 text-red-700"
                                      : "bg-slate-100 text-slate-500",
                                )}
                              >
                                <span
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    isUp
                                      ? "bg-green-500"
                                      : isAdminDown
                                        ? "bg-red-500"
                                        : "bg-slate-400",
                                  )}
                                />
                                {isUp
                                  ? "UP"
                                  : isAdminDown
                                    ? "Admin Down"
                                    : "DOWN"}
                              </span>
                            )}
                            {/* Failed badge */}
                            {isFailed && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase tracking-wide">
                                <Ban size={9} /> Action failed
                              </span>
                            )}
                            {/* Optimistic override indicator */}
                            {localStatusOverride[iface.name] && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] text-blue-600">
                                <Activity size={9} /> pending sync
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                            <span>
                              Status:{" "}
                              <span className="font-mono">{iface.status}</span>
                            </span>
                            <span>·</span>
                            <span>
                              Protocol:{" "}
                              <span className="font-mono">
                                {iface.protocol}
                              </span>
                            </span>
                            {iface.ip_address && (
                              <>
                                <span>·</span>
                                <span className="font-mono text-blue-600">
                                  {iface.ip_address}
                                </span>
                              </>
                            )}
                          </div>
                          {isFailed && (
                            <p className="text-[10px] text-amber-600 mt-0.5 font-medium">
                              Buttons disabled — click Refresh to re-enable
                            </p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="shrink-0 flex items-center gap-1.5">
                          {/* Bring UP */}
                          <button
                            type="button"
                            disabled={upDisabled}
                            onClick={() =>
                              requestInterfaceAction(iface.name, "up")
                            }
                            title={
                              isFailed
                                ? "Action failed — click Refresh to re-enable"
                                : isUp
                                  ? "Interface is already up"
                                  : `Bring ${iface.name} up (no shutdown via conf t)`
                            }
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                              "focus:outline-none focus:ring-2 focus:ring-offset-1",
                              upDisabled
                                ? "bg-slate-100 text-slate-300 cursor-not-allowed opacity-50"
                                : "bg-green-100 text-green-700 hover:bg-green-200 focus:ring-green-500 hover:shadow-sm",
                            )}
                          >
                            {isActioning ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : isFailed ? (
                              <Ban size={12} />
                            ) : (
                              <Power size={12} />
                            )}
                            Up
                          </button>

                          {/* Bring DOWN */}
                          <button
                            type="button"
                            disabled={downDisabled}
                            onClick={() =>
                              requestInterfaceAction(iface.name, "down")
                            }
                            title={
                              isFailed
                                ? "Action failed — click Refresh to re-enable"
                                : isAdminDown
                                  ? "Interface is already admin-down"
                                  : `Shut down ${iface.name} (shutdown via conf t)`
                            }
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                              "focus:outline-none focus:ring-2 focus:ring-offset-1",
                              downDisabled
                                ? "bg-slate-100 text-slate-300 cursor-not-allowed opacity-50"
                                : "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-500 hover:shadow-sm",
                            )}
                          >
                            {isActioning ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : isFailed ? (
                              <Ban size={12} />
                            ) : (
                              <PowerOff size={12} />
                            )}
                            Down
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <Pagination
                  page={interfacesPage}
                  totalPages={interfacesData.total_pages}
                  total={interfacesData.total}
                  pageSize={20}
                  onChange={handleInterfacesPageChange}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Monitor size={48} className="mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-500">
                  No interface data available
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {interfacesSearch
                    ? "No results match your search"
                    : "Click Refresh to sync from switch"}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {interfacesData && interfacesData.interfaces.length > 0 && (
            <div className="bg-slate-100 border-t border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <Info size={11} className="text-slate-400" />
                  <span>Buttons send commands via conf t on the switch</span>
                </div>
                <span>{interfacesData.total} interfaces</span>
              </div>
            </div>
          )}
        </div>

        {/* ══ Switch VLANs Card ════════════════════════════════════ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-gradient-to-r from-purple-50 to-purple-100/50 border-b border-purple-200 p-5">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 p-2.5 rounded-lg shadow-sm">
                  <Layers size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">
                    Switch VLANs
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    DB snapshot + manually added VLANs
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                    <Clock size={12} />
                    <span>
                      {vlansData?.cached_at
                        ? new Date(vlansData.cached_at).toLocaleString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "Not synced yet"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-purple-600">
                  {vlansData?.total ?? 0}
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  {vlansSearch ? "Matched" : "Total"}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-slate-200 bg-white">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search VLANs by ID, name, or status…"
                value={vlansSearch}
                onChange={(e) => handleVlanSearchChange(e.target.value)}
                className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {loadingVlans && (
                <Loader2
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
                />
              )}
            </div>
          </div>

          <div className="p-5 flex-1 overflow-y-auto max-h-[560px] bg-slate-50">
            {loadingVlans ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">Loading VLANs…</span>
              </div>
            ) : vlansError ? (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Error Loading VLANs</p>
                  <p>{vlansError}</p>
                </div>
              </div>
            ) : vlansData && vlansData.vlans.length > 0 ? (
              <>
                <div className="space-y-3">
                  {vlansData.vlans.map((vlan) => (
                    <div
                      key={vlan.id}
                      className="p-4 bg-white rounded-lg border border-slate-200 hover:border-purple-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Hash size={16} className="text-purple-500" />
                          <span className="font-mono font-bold text-slate-800 text-base">
                            VLAN {vlan.id}
                          </span>
                          <span className="text-slate-600 font-medium">
                            — {vlan.name}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                            vlan.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700",
                          )}
                        >
                          {vlan.status}
                        </span>
                      </div>
                      {vlan.ports.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            Ports ({vlan.ports.length})
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {vlan.ports.map((port, idx) => (
                              <span
                                key={idx}
                                className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-md font-mono font-medium"
                              >
                                {port}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic">
                          No ports assigned
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Pagination
                  page={vlansPage}
                  totalPages={vlansData.total_pages}
                  total={vlansData.total}
                  pageSize={20}
                  onChange={handleVlansPageChange}
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Layers size={48} className="mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-500">
                  No VLAN data available
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {vlansSearch
                    ? "No results match your search"
                    : "Click Refresh to sync from switch, or Add VLAN to create one"}
                </p>
              </div>
            )}
          </div>

          {vlansData && vlansData.vlans.length > 0 && (
            <div className="bg-slate-100 border-t border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  <span className="font-semibold text-green-700">
                    {
                      vlansData.vlans.filter((v) => v.status === "active")
                        .length
                    }
                  </span>{" "}
                  active ·{" "}
                  <span className="font-semibold text-amber-600">
                    {
                      vlansData.vlans.filter((v) => v.status !== "active")
                        .length
                    }
                  </span>{" "}
                  inactive (this page)
                </span>
                <span>{vlansData.total} VLANs matched</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmState.open}
        title={
          confirmState.action === "up"
            ? `Enable Interface`
            : `Disable Interface`
        }
        message={
          confirmState.action === "up"
            ? `Send "no shutdown" to ${confirmState.ifaceName}? The session will enter conf t first, then apply the command.`
            : `Send "shutdown" to ${confirmState.ifaceName}? The session will enter conf t first, then apply the command.`
        }
        confirmLabel={
          confirmState.action === "up"
            ? "Enable (no shutdown)"
            : "Disable (shutdown)"
        }
        confirmColor={confirmState.action === "up" ? "green" : "red"}
        onConfirm={handleConfirmAction}
        onCancel={() =>
          setConfirmState({ open: false, ifaceName: "", action: "up" })
        }
      />

      {/* Output modal */}
      <InterfaceOutputModal
        open={outputModal.open}
        onClose={() => setOutputModal((p) => ({ ...p, open: false }))}
        title={outputModal.title}
        output={outputModal.output}
        error={outputModal.error}
        loading={outputModal.loading}
        success={outputModal.success}
      />

      {/* Add VLAN Modal */}
      <AddVlanModal
        open={addVlanOpen}
        onClose={() => setAddVlanOpen(false)}
        onAdd={handleAddVlan}
      />
    </div>
  );
}
