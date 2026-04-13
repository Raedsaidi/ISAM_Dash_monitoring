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

interface VlanMgmtListResponse {
  success: boolean;
  vlans: VlanMgmtItem[];
  total: number;
}

/* ------------------------------------------------------------------ */
/*  API Helpers                                                        */
/* ------------------------------------------------------------------ */

const CISCO_BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${CISCO_BASE}/api/v1/cisco`;

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
/*  Pagination Component — always visible                             */
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
  return (
    <div className="flex items-center justify-between px-1 mt-4">
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={15} className="text-slate-600" />
        </button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let p: number;
          if (totalPages <= 5) p = i + 1;
          else if (page <= 3) p = i + 1;
          else if (page >= totalPages - 2) p = totalPages - 4 + i;
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
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={15} className="text-slate-600" />
        </button>
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
              <AlertCircle size={16} className="shrink-0" />
              {error}
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

  // ── VLANs snapshot state ──────────────────────────────────────────
  const [vlansData, setVlansData] = useState<VlansPageResponse | null>(null);
  const [vlansPage, setVlansPage] = useState(1);
  const [vlansSearch, setVlansSearch] = useState("");
  const [loadingVlans, setLoadingVlans] = useState(false);
  const [vlansError, setVlansError] = useState<string | null>(null);
  const [syncingVlans, setSyncingVlans] = useState(false);

  // ── Managed VLANs state ───────────────────────────────────────────
  const [managedVlans, setManagedVlans] = useState<VlanMgmtItem[]>([]);
  const [managedVlansTotal, setManagedVlansTotal] = useState(0);
  const [managedVlansAllTotal, setManagedVlansAllTotal] = useState(0);
  const [managedVlansPage, setManagedVlansPage] = useState(1);
  const [managedVlansSearch, setManagedVlansSearch] = useState("");
  const [loadingManagedVlans, setLoadingManagedVlans] = useState(false);
  const managedVlansPageSize = 20;

  // ── Add VLAN modal ────────────────────────────────────────────────
  const [addVlanOpen, setAddVlanOpen] = useState(false);

  // Debounce refs
  const ifaceSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vlanSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mvSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load switches on mount ────────────────────────────────────────
  useEffect(() => {
    loadSwitchesFn();
    loadManagedVlans(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── When switch changes → sync + load ────────────────────────────
  useEffect(() => {
    if (!selectedSwitchId) return;
    setInterfacesPage(1);
    setVlansPage(1);
    setInterfacesSearch("");
    setVlansSearch("");
    syncAndLoadInterfaces(selectedSwitchId, 1, "");
    syncAndLoadVlans(selectedSwitchId, 1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSwitchId]);

  // ── Helpers ───────────────────────────────────────────────────────

  async function loadSwitchesFn() {
    setLoadingSwitches(true);
    try {
      const data = await fetchSwitches();
      const list: SwitchOption[] = (data.switches ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
      }));
      setSwitches(list);
      if (list.length > 0) {
        setSelectedSwitchId(list[0].id);
      }
    } catch (err: any) {
      console.error("Failed to load switches:", err);
      toast.error("Failed to load switches");
    } finally {
      setLoadingSwitches(false);
    }
  }

  // ── Sync interfaces from switch → DB, then load from DB ──────────
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
    [accessToken],
  );

  // ── Load interfaces from DB — server-side search ──────────────────
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

  // ── Sync VLANs from switch → DB, then load from DB ───────────────
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
    [accessToken],
  );

  // ── Load VLANs from DB — server-side search ───────────────────────
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

  // ── Load managed VLANs — server-side search via backend ──────────
  const loadManagedVlans = useCallback(
    async (page: number, search: string) => {
      setLoadingManagedVlans(true);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());

        const data = await apiFetch<VlanMgmtListResponse>(
          `${PREFIX}/vlan-management/vlans?${params.toString()}`,
          accessToken,
        );

        const all = data.vlans ?? [];
        // Track total matching (for header count)
        setManagedVlansTotal(all.length);

        // Track grand total (without search) only when no search
        if (!search.trim()) {
          setManagedVlansAllTotal(all.length);
        }

        // Client-side pagination on the already-searched list
        const start = (page - 1) * managedVlansPageSize;
        setManagedVlans(all.slice(start, start + managedVlansPageSize));
      } catch (err: any) {
        console.error("Failed to load managed VLANs:", err.message);
        toast.error("Failed to load managed VLANs");
      } finally {
        setLoadingManagedVlans(false);
      }
    },
    [accessToken],
  );

  // ── Debounced search handlers ─────────────────────────────────────

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

  const handleManagedVlanSearchChange = (val: string) => {
    setManagedVlansSearch(val);
    setManagedVlansPage(1);
    if (mvSearchTimer.current) clearTimeout(mvSearchTimer.current);
    mvSearchTimer.current = setTimeout(() => {
      loadManagedVlans(1, val);
    }, 350);
  };

  // ── Page change handlers ──────────────────────────────────────────

  const handleInterfacesPageChange = (p: number) => {
    setInterfacesPage(p);
    if (selectedSwitchId)
      loadInterfacesFromDb(selectedSwitchId, p, interfacesSearch);
  };

  const handleVlansPageChange = (p: number) => {
    setVlansPage(p);
    if (selectedSwitchId) loadVlansFromDb(selectedSwitchId, p, vlansSearch);
  };

  const handleManagedVlansPageChange = (p: number) => {
    setManagedVlansPage(p);
    loadManagedVlans(p, managedVlansSearch);
  };

  // ── Refresh ───────────────────────────────────────────────────────
  const handleRefresh = () => {
    if (!selectedSwitchId) return;
    syncAndLoadInterfaces(selectedSwitchId, interfacesPage, interfacesSearch);
    syncAndLoadVlans(selectedSwitchId, vlansPage, vlansSearch);
    loadManagedVlans(managedVlansPage, managedVlansSearch);
  };

  // ── Create VLAN → stored in cisco_vlans table ─────────────────────
  const handleAddVlan = useCallback(
    async (data: { vlan_id: number; name: string }) => {
      await apiFetch<VlanMgmtItem>(
        `${PREFIX}/vlan-management/vlans`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      );
      toast.success(`VLAN ${data.vlan_id} (${data.name}) created successfully`);
      setAddVlanOpen(false);
      // Reset search and reload managed VLANs so new one appears at top
      setManagedVlansSearch("");
      setManagedVlansPage(1);
      loadManagedVlans(1, "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken],
  );

  // ── Derived values ────────────────────────────────────────────────
  const isBusy =
    syncingInterfaces ||
    syncingVlans ||
    loadingInterfaces ||
    loadingVlans ||
    loadingManagedVlans;

  const managedVlansTotalPages = Math.max(
    1,
    Math.ceil(managedVlansTotal / managedVlansPageSize),
  );

  // ── Loading / empty states ────────────────────────────────────────
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
            Add a Cisco switch in the Switch Management section to view
            interfaces and VLANs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-1">
              <Layers size={24} className="text-blue-600" />
              Switch Interfaces & VLANs
            </h2>
            <p className="text-sm text-slate-500">
              Data stored in DB · server-side search · synced from live switch
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
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
              <Plus size={16} />
              Add VLAN
            </button>

            <button
              onClick={handleRefresh}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} className={cn(isBusy && "animate-spin")} />
              {syncingInterfaces || syncingVlans ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Sync status banner */}
        {(syncingInterfaces || syncingVlans) && (
          <div className="mt-3 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <Loader2 size={13} className="animate-spin shrink-0" />
            {syncingInterfaces && syncingVlans
              ? "Syncing interfaces and VLANs from switch to database…"
              : syncingInterfaces
                ? "Syncing interfaces from switch to database…"
                : "Syncing VLANs from switch to database…"}
          </div>
        )}
      </div>

      {/* ── Interfaces & Switch VLANs Grid ───────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ══ Interfaces Card ══ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Header */}
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
                    From DB · synced on load
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
          <div className="p-5 flex-1 overflow-y-auto max-h-[500px] bg-slate-50">
            {loadingInterfaces ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">
                  Fetching interfaces…
                </span>
              </div>
            ) : interfacesError ? (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Error Loading Interfaces</p>
                  <p>{interfacesError}</p>
                </div>
              </div>
            ) : interfacesData && interfacesData.interfaces.length > 0 ? (
              <>
                <div className="space-y-2">
                  {interfacesData.interfaces.map((iface, idx) => {
                    const isUp =
                      iface.status.toLowerCase().includes("up") &&
                      iface.protocol.toLowerCase().includes("up");
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="shrink-0">
                            {isUp ? (
                              <Wifi size={20} className="text-green-500" />
                            ) : (
                              <WifiOff size={20} className="text-slate-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-slate-800 truncate">
                              {iface.name}
                            </div>
                            {iface.ip_address && (
                              <div className="text-xs text-slate-500 font-mono mt-0.5">
                                {iface.ip_address}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span
                            className={cn(
                              "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                              isUp
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {iface.status}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
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

                {/* Pagination — always shown */}
                <Pagination
                  page={interfacesPage}
                  totalPages={interfacesData.total_pages}
                  total={interfacesData.total}
                  pageSize={20}
                  onChange={handleInterfacesPageChange}
                />
              </>
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
                <span>
                  <span className="font-semibold text-green-700">
                    {
                      interfacesData.interfaces.filter((i) =>
                        i.status.toLowerCase().includes("up"),
                      ).length
                    }
                  </span>{" "}
                  up ·{" "}
                  <span className="font-semibold text-slate-500">
                    {
                      interfacesData.interfaces.filter(
                        (i) => !i.status.toLowerCase().includes("up"),
                      ).length
                    }
                  </span>{" "}
                  down (this page)
                </span>
                <span>
                  {interfacesData.total} interface
                  {interfacesData.total !== 1 ? "s" : ""} matched
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ══ Switch VLANs Card ══ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Header */}
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
                    Live snapshot · stored in DB
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

          {/* Search */}
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

          {/* Content */}
          <div className="p-5 flex-1 overflow-y-auto max-h-[500px] bg-slate-50">
            {loadingVlans ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">Fetching VLANs…</span>
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

                {/* Pagination — always shown */}
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
                    : "Click Refresh to sync from switch"}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
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

      {/* ── Managed VLANs Table ────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/50 border-b border-emerald-200 p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              <div className="bg-emerald-600 p-2.5 rounded-lg shadow-sm">
                <Hash size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg">
                  Managed VLANs
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Stored in{" "}
                  <code className="font-mono bg-slate-100 px-1 rounded">
                    cisco_vlans
                  </code>{" "}
                  · server-side search · used by Port Configuration
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-3xl font-bold text-emerald-600">
                  {managedVlansSearch
                    ? managedVlansTotal
                    : managedVlansAllTotal}
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  {managedVlansSearch ? "Matched" : "Total"}
                </div>
              </div>
              <button
                onClick={() => setAddVlanOpen(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Plus size={15} />
                Add VLAN
              </button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="relative max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search managed VLANs by ID or name…"
              value={managedVlansSearch}
              onChange={(e) => handleManagedVlanSearchChange(e.target.value)}
              className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {loadingManagedVlans && (
              <Loader2
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
              />
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loadingManagedVlans ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 size={32} className="animate-spin mb-3" />
              <span className="text-sm">Loading managed VLANs…</span>
            </div>
          ) : managedVlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Hash size={48} className="mb-3 opacity-40" />
              <p className="text-sm font-medium text-slate-500">
                No managed VLANs found
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {managedVlansSearch
                  ? "No results match your search"
                  : 'Click "Add VLAN" to create your first VLAN'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["VLAN ID", "Name", "Status", "Port Count", "Created"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {managedVlans.map((vlan) => (
                  <tr
                    key={vlan.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {vlan.vlan_id}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">
                      {vlan.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                          vlan.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700",
                        )}
                      >
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            vlan.status === "active"
                              ? "bg-green-500"
                              : "bg-amber-500",
                          )}
                        />
                        {vlan.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {vlan.port_count}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {new Date(vlan.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination — always shown */}
        <div className="border-t border-slate-200 px-5 py-3 bg-slate-50">
          <Pagination
            page={managedVlansPage}
            totalPages={managedVlansTotalPages}
            total={managedVlansTotal}
            pageSize={managedVlansPageSize}
            onChange={handleManagedVlansPageChange}
          />
        </div>

        {/* Footer */}
        {managedVlans.length > 0 && (
          <div className="bg-slate-100 border-t border-slate-200 px-5 py-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                <span className="font-semibold text-green-700">
                  {managedVlans.filter((v) => v.status === "active").length}
                </span>{" "}
                active ·{" "}
                <span className="font-semibold text-amber-600">
                  {managedVlans.filter((v) => v.status !== "active").length}
                </span>{" "}
                inactive (this page)
              </span>
              <span>
                Showing{" "}
                {Math.min(
                  (managedVlansPage - 1) * managedVlansPageSize + 1,
                  managedVlansTotal,
                )}
                –
                {Math.min(
                  managedVlansPage * managedVlansPageSize,
                  managedVlansTotal,
                )}{" "}
                of {managedVlansTotal}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Add VLAN Modal */}
      <AddVlanModal
        open={addVlanOpen}
        onClose={() => setAddVlanOpen(false)}
        onAdd={handleAddVlan}
      />
    </div>
  );
}
