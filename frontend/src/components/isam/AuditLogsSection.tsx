import { useEffect, useMemo, useState, useCallback } from "react";
import { cn } from "../../utils/cn";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  RefreshCw,
  Clock,
  User,
  Globe,
  Loader2,
  Server,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { JSX } from "react/jsx-runtime";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

type AuditResult = "success" | "failure" | "warning";
type ScopeFilter = "all" | "admin" | "user";

interface ConfigHistoryItem {
  id: number;
  username: string;
  action: string;
  isam_instance_id: number | null;
  port_id: string | null;
  template_id: number | null;
  success: boolean;
  message: string | null;
  commands_executed: string | null;
  raw_output: string | null;
  ip_address: string | null;
  created_at: string;
}

interface ConfigHistoryListResponse {
  items: ConfigHistoryItem[];
  total?: number;
}

interface ISAMInstanceOption {
  id: number;
  name: string;
  host: string;
  status: string;
}

interface ISAMInstanceListResponse {
  instances: ISAMInstanceOption[];
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  resource: string;
  result: AuditResult;
  details: string;
  ipAddress: string;
}

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 25;

const resultConfig: Record<
  AuditResult,
  { icon: JSX.Element; color: string; bg: string }
> = {
  success: {
    icon: <CheckCircle size={16} />,
    color: "text-green-500",
    bg: "bg-green-50",
  },
  failure: {
    icon: <XCircle size={16} />,
    color: "text-red-500",
    bg: "bg-red-50",
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    color: "text-amber-500",
    bg: "bg-amber-50",
  },
};

const actionColors: Record<string, string> = {
  CREATE_INSTANCE: "bg-slate-100 text-slate-700",
  UPDATE_INSTANCE: "bg-slate-100 text-slate-700",
  DELETE_INSTANCE: "bg-slate-100 text-slate-700",
  TEST_CONNECTION: "bg-green-100 text-green-700",
  RUN_COMMAND: "bg-rose-100 text-rose-700",
  CREATE_TEMPLATE: "bg-purple-100 text-purple-700",
  CREATE_TEMPLATE_GLOBAL: "bg-purple-100 text-purple-700",
  CREATE_TEMPLATE_USER_COPY: "bg-purple-100 text-purple-700",
  UPDATE_TEMPLATE: "bg-indigo-100 text-indigo-700",
  DELETE_TEMPLATE: "bg-pink-100 text-pink-700",
  TEST_TEMPLATE: "bg-cyan-100 text-cyan-700",
  APPLY_TEMPLATE: "bg-teal-100 text-teal-700",
  APPLY_TEMPLATE_MY_PORT: "bg-teal-100 text-teal-700",
  APPLY_TEMPLATE_LIVE: "bg-teal-100 text-teal-700",
  LOCK_PORT: "bg-orange-100 text-orange-700",
  UNLOCK_PORT: "bg-lime-100 text-lime-700",
};

const ADMIN_ACTIONS = new Set<string>([
  "CREATE_INSTANCE",
  "UPDATE_INSTANCE",
  "DELETE_INSTANCE",
  "TEST_CONNECTION",
  "RUN_COMMAND",
  "UPDATE_TEMPLATE",
  "DELETE_TEMPLATE",
  "APPLY_TEMPLATE",
  "TEST_TEMPLATE",
  "LOCK_PORT",
  "UNLOCK_PORT",
]);

const USER_ACTIONS = new Set<string>([
  "CREATE_TEMPLATE",
  "CREATE_TEMPLATE_USER_COPY",
  "APPLY_TEMPLATE_MY_PORT",
  "APPLY_TEMPLATE_LIVE",
]);

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function parseJwt(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function authFetchJson<T>(
  url: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      (Array.isArray(data) && data[0]?.msg) ||
      `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function buildDetails(item: ConfigHistoryItem): string {
  const parts: string[] = [];
  switch (item.action) {
    case "CREATE_TEMPLATE":
    case "CREATE_TEMPLATE_GLOBAL":
    case "CREATE_TEMPLATE_USER_COPY":
      parts.push("Template created.");
      break;
    case "UPDATE_TEMPLATE":
      parts.push("Template updated.");
      break;
    case "DELETE_TEMPLATE":
      parts.push("Template deleted.");
      break;
    case "TEST_TEMPLATE":
      parts.push("Template tested.");
      break;
    case "APPLY_TEMPLATE":
      parts.push("Template applied on port.");
      break;
    case "APPLY_TEMPLATE_MY_PORT":
      parts.push("User applied template on own port.");
      break;
    case "APPLY_TEMPLATE_LIVE":
      parts.push("Live template applied.");
      break;
    case "CREATE_INSTANCE":
      parts.push("ISAM instance created.");
      break;
    case "UPDATE_INSTANCE":
      parts.push("ISAM instance updated.");
      break;
    case "DELETE_INSTANCE":
      parts.push("ISAM instance deleted.");
      break;
    case "TEST_CONNECTION":
      parts.push("Connection tested.");
      break;
    case "RUN_COMMAND":
      parts.push("Command executed.");
      break;
    case "LOCK_PORT":
      parts.push("Port locked.");
      break;
    case "UNLOCK_PORT":
      parts.push("Port unlocked.");
      break;
    default:
      parts.push("Action executed.");
      break;
  }
  if (item.template_id !== null)
    parts.push(`Template ID: ${item.template_id}.`);
  if (item.port_id) parts.push(`Port: ${item.port_id}.`);
  if (item.message) parts.push(`Message: ${item.message}`);
  return parts.join(" ");
}

function buildPageNumbers(current: number, total: number): (number | "dots")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "dots")[] = [];
  const siblings = 1;
  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);

  pages.push(1);
  if (left > 2) pages.push("dots");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push("dots");
  if (total > 1) pages.push(total);

  return pages;
}

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function AuditLogsSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const role: string | null =
    jwt?.role || jwt?.user_role || jwt?.realm_access?.roles?.[0] || null;
  const isPrivileged = role === "ADMIN" || role === "SUPER_ADMIN";

  /* ── State ── */
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [instances, setInstances] = useState<ISAMInstanceOption[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("all");

  const [page, setPage] = useState(1);

  /* ── Debounce search (400ms) ── */
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  /* ── Reset page when filters change ── */
  useEffect(() => {
    setPage(1);
  }, [resultFilter, selectedInstanceId, scopeFilter]);

  /* ── Load ISAM instances on mount ── */
  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      setLoadingInstances(true);
      try {
        const res = await authFetchJson<ISAMInstanceListResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/instances`,
          accessToken,
        );
        setInstances(res.instances ?? []);
      } catch (err: any) {
        console.error("Failed to load ISAM instances:", err.message);
      } finally {
        setLoadingInstances(false);
      }
    })();
  }, [accessToken]);

  /* ── Instance name lookup ── */
  const instanceMap = useMemo(() => {
    const map = new Map<number, string>();
    instances.forEach((i) => map.set(i.id, i.name));
    return map;
  }, [instances]);

  /* ── Load logs (server-side pagination) ── */
  const loadLogs = useCallback(async () => {
    if (!accessToken) return;

    if (resultFilter === "warning") {
      setLogs([]);
      setTotalCount(0);
      return;
    }

    setLoading(true);
    setGlobalError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));

      if (selectedInstanceId !== "all") {
        params.set("instance_id", selectedInstanceId);
      }
      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }
      if (resultFilter === "success") {
        params.set("success", "true");
      } else if (resultFilter === "failure") {
        params.set("success", "false");
      }

      const baseUrl = isPrivileged
        ? `${ISAM_BASE_URL}/api/v1/isam/config-history`
        : `${ISAM_BASE_URL}/api/v1/isam/my-config-history`;

      const url = `${baseUrl}?${params.toString()}`;
      const res = await authFetchJson<ConfigHistoryListResponse>(
        url,
        accessToken,
      );

      const mapped: AuditLog[] = (res.items || []).map((item) => {
        const result: AuditResult = item.success ? "success" : "failure";
        const instName =
          item.isam_instance_id != null
            ? instanceMap.get(item.isam_instance_id)
            : null;
        const resource = instName
          ? `${instName} (#${item.isam_instance_id}) / ${item.port_id || "-"}`
          : `ISAM #${item.isam_instance_id ?? "-"} / ${item.port_id || "-"}`;

        return {
          id: String(item.id),
          timestamp: new Date(item.created_at).toLocaleString(),
          action: item.action,
          user: item.username,
          resource,
          result,
          details: buildDetails(item),
          ipAddress: item.ip_address || "N/A",
        };
      });

      setLogs(mapped);

      // Safe total: use res.total if available, otherwise fallback
      const serverTotal =
        typeof res.total === "number" && !isNaN(res.total)
          ? res.total
          : mapped.length;
      setTotalCount(serverTotal);
    } catch (err: any) {
      setGlobalError(err.message || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [
    accessToken,
    isPrivileged,
    page,
    debouncedSearch,
    selectedInstanceId,
    resultFilter,
    instanceMap,
  ]);

  /* ── Auto-reload when deps change ── */
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /* ── Client-side scope filter (admin/user action split) ── */
  const displayed = useMemo(() => {
    if (!isPrivileged || scopeFilter === "all") return logs;
    return logs.filter((log) => {
      if (scopeFilter === "admin") return ADMIN_ACTIONS.has(log.action);
      if (scopeFilter === "user")
        return USER_ACTIONS.has(log.action) || !ADMIN_ACTIONS.has(log.action);
      return true;
    });
  }, [logs, isPrivileged, scopeFilter]);

  /* ── Pagination info (safe calculations) ── */
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 1;
  const startEntry = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endEntry = Math.min(page * PAGE_SIZE, totalCount);
  const hasFilters =
    debouncedSearch !== "" ||
    selectedInstanceId !== "all" ||
    resultFilter !== "all";

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6">
      {/* ─── Toolbar ─── */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search logs…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-100
                         focus:border-blue-400 w-72 text-slate-700
                         placeholder:text-slate-400 transition-all duration-150"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2
                           text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={14} />
              </button>
            )}
            {loading && debouncedSearch && (
              <Loader2
                size={14}
                className="absolute right-8 top-1/2 -translate-y-1/2
                           text-slate-400 animate-spin"
              />
            )}
          </div>

          {/* ISAM Instance selector */}
          <div className="relative flex items-center gap-1.5">
            <Server size={16} className="text-slate-400 shrink-0" />
            <select
              value={selectedInstanceId}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              disabled={loadingInstances}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-blue-100
                         focus:border-blue-400 disabled:opacity-50 min-w-[180px]
                         text-slate-700 transition-all duration-150"
            >
              <option value="all">All ISAM Instances</option>
              {instances.map((inst) => (
                <option key={inst.id} value={String(inst.id)}>
                  {inst.name} ({inst.host})
                </option>
              ))}
            </select>
          </div>

          {/* Result filter */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(["all", "success", "failure", "warning"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setResultFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 capitalize",
                  resultFilter === f
                    ? "bg-white shadow-sm text-slate-700"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Scope filter (admin only) */}
          {isPrivileged && (
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {(["all", "admin", "user"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setScopeFilter(f)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 capitalize",
                    scopeFilter === f
                      ? "bg-white shadow-sm text-slate-700"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reload */}
        <button
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700
                     text-white rounded-lg text-sm font-medium transition-all
                     duration-150 shadow-sm disabled:opacity-50"
          onClick={() => {
            setPage(1);
            loadLogs();
          }}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Reload
        </button>
      </div>

      {/* ─── Active filters indicator ─── */}
      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400">Filters:</span>
          {debouncedSearch && (
            <span className="bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              "{debouncedSearch}"
              <button onClick={() => setSearchTerm("")}>
                <X size={12} />
              </button>
            </span>
          )}
          {selectedInstanceId !== "all" && (
            <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              ISAM:{" "}
              {instances.find((i) => String(i.id) === selectedInstanceId)
                ?.name || selectedInstanceId}
              <button onClick={() => setSelectedInstanceId("all")}>
                <X size={12} />
              </button>
            </span>
          )}
          {resultFilter !== "all" && (
            <span
              className={cn(
                "px-2 py-0.5 rounded-full flex items-center gap-1 border",
                resultFilter === "success"
                  ? "bg-green-50 text-green-600 border-green-200"
                  : resultFilter === "failure"
                    ? "bg-red-50 text-red-600 border-red-200"
                    : "bg-amber-50 text-amber-600 border-amber-200",
              )}
            >
              {resultFilter}
              <button onClick={() => setResultFilter("all")}>
                <X size={12} />
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSearchTerm("");
              setSelectedInstanceId("all");
              setResultFilter("all");
              setScopeFilter("all");
            }}
            className="text-slate-400 hover:text-slate-600 underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ─── Global error ─── */}
      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span>{globalError}</span>
          <button
            onClick={() => setGlobalError(null)}
            className="text-red-400 hover:text-red-600"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ─── Log Timeline ─── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-sm text-slate-400 flex flex-col items-center justify-center gap-3">
            <Loader2 size={22} className="animate-spin text-blue-500" />
            <span>Loading audit logs…</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center gap-2">
            <FileText size={28} className="text-slate-200" />
            <span className="text-sm font-medium text-slate-400">
              No audit logs found
            </span>
            <span className="text-xs text-slate-300">
              Try adjusting your search or filters
            </span>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {displayed.map((log) => {
              const config = resultConfig[log.result];
              return (
                <div
                  key={log.id}
                  className="p-5 hover:bg-slate-50/60 transition-colors duration-100 flex gap-4"
                >
                  <div className={cn("mt-1 shrink-0", config.color)}>
                    {config.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className={cn(
                          "text-xs font-medium px-2.5 py-1 rounded-full",
                          actionColors[log.action] ||
                            "bg-slate-100 text-slate-700",
                        )}
                      >
                        {log.action}
                      </span>

                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          log.result === "success"
                            ? "bg-green-100 text-green-700"
                            : log.result === "failure"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {log.result}
                      </span>
                    </div>

                    <p className="text-sm text-slate-600 mt-2">{log.details}</p>

                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {log.timestamp}
                      </span>
                      <span className="flex items-center gap-1">
                        <User size={12} /> {log.user}
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe size={12} /> {log.ipAddress}
                      </span>
                      <span className="text-slate-500 font-mono text-[11px]">
                        {log.resource}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Pagination ─── */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing{" "}
            <span className="font-medium text-slate-600">
              {startEntry}–{endEntry}
            </span>{" "}
            of <span className="font-medium text-slate-600">{totalCount}</span>{" "}
            entries
          </p>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              {/* Previous */}
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all duration-150",
                  page <= 1
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <ChevronLeft size={16} />
              </button>

              {/* Page numbers */}
              {buildPageNumbers(page, totalPages).map((item, idx) =>
                item === "dots" ? (
                  <span
                    key={`dots-${idx}`}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 text-xs"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={cn(
                      "w-8 h-8 rounded-lg text-sm font-medium transition-all duration-150",
                      page === item
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {item}
                  </button>
                ),
              )}

              {/* Next */}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all duration-150",
                  page >= totalPages
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {totalCount === 0 && !loading && (
        <p className="text-sm text-slate-400">No entries</p>
      )}
    </div>
  );
}
