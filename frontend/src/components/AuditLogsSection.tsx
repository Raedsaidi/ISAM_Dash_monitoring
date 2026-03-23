import React, { useEffect, useMemo, useState, useCallback } from "react";
import { cn } from "../utils/cn";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  RefreshCw ,
  Clock,
  User,
  Globe,
  Loader2,
  Server,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { JSX } from "react/jsx-runtime";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

/* ---------- types ---------- */

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

/* ---------- constants ---------- */

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
]);

const USER_ACTIONS = new Set<string>([
  "CREATE_TEMPLATE",
  "CREATE_TEMPLATE_USER_COPY",
  "APPLY_TEMPLATE_MY_PORT",
  "APPLY_TEMPLATE_LIVE",
]);

/* ---------- helpers ---------- */

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

/* ========== COMPONENT ========== */

export default function AuditLogsSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const role: string | null =
    jwt?.role || jwt?.user_role || jwt?.realm_access?.roles?.[0] || null;
  const isPrivileged = role === "ADMIN" || role === "SUPER_ADMIN";

  /* --- raw data from API --- */
  const [rawItems, setRawItems] = useState<ConfigHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  /* --- ISAM instances for the select --- */
  const [instances, setInstances] = useState<ISAMInstanceOption[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);

  /* --- filters --- */
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("all");

  /* --- debounce the search input (400 ms) --- */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  /* --- fetch ISAM instances on mount --- */
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

  /* --- build the instance‑name lookup map --- */
  const instanceMap = useMemo(() => {
    const map = new Map<number, string>();
    instances.forEach((i) => map.set(i.id, i.name));
    return map;
  }, [instances]);

  /* --- fetch logs (runs whenever server-side filters change) --- */
  const loadLogs = useCallback(async () => {
    if (!accessToken) return;

    /* "warning" never exists in the DB – skip fetch, show empty */
    if (resultFilter === "warning") {
      setRawItems([]);
      return;
    }

    setLoading(true);
    setGlobalError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", "200");

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
      setRawItems(res.items);
    } catch (err: any) {
      setGlobalError(err.message || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [
    accessToken,
    isPrivileged,
    debouncedSearch,
    selectedInstanceId,
    resultFilter,
  ]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /* --- map raw items → AuditLog (uses instanceMap for nice names) --- */
  const auditLogs: AuditLog[] = useMemo(() => {
    return rawItems.map((item) => {
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
  }, [rawItems, instanceMap]);

  /* --- scope filter stays client-side (admin / user action categories) --- */
  const filtered = useMemo(() => {
    if (!isPrivileged || scopeFilter === "all") return auditLogs;
    return auditLogs.filter((log) => {
      if (scopeFilter === "admin") return ADMIN_ACTIONS.has(log.action);
      if (scopeFilter === "user")
        return USER_ACTIONS.has(log.action) || !ADMIN_ACTIONS.has(log.action);
      return true;
    });
  }, [auditLogs, isPrivileged, scopeFilter]);

  /* ========== RENDER ========== */

  return (
    <div className="space-y-6">
      {/* ---- Toolbar ---- */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search (server-side, debounced) */}
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
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
            />
            {loading && debouncedSearch && (
              <Loader2
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
              />
            )}
          </div>

          {/* ISAM Instance selector (server-side) */}
          <div className="relative flex items-center gap-1.5">
            <Server size={16} className="text-slate-400 shrink-0" />
            <select
              value={selectedInstanceId}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              disabled={loadingInstances}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500
                         disabled:opacity-50 min-w-[180px]"
            >
              <option value="all">All ISAM Instances</option>
              {instances.map((inst) => (
                <option key={inst.id} value={String(inst.id)}>
                  {inst.name} ({inst.host})
                </option>
              ))}
            </select>
          </div>

          {/* Result filter (server-side) */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(["all", "success", "failure", "warning"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setResultFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                  resultFilter === f
                    ? "bg-white shadow-sm text-slate-900"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Scope filter — admin only (client-side) */}
          {isPrivileged && (
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {(["all", "admin", "user"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setScopeFilter(f)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                    scopeFilter === f
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200
                     text-slate-700 rounded-lg text-sm font-medium transition-colors"
          onClick={loadLogs}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw  size={16} />
          )}
          Reload Logs
        </button>
      </div>

      {/* ---- Global error ---- */}
      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {globalError}
        </div>
      )}

      {/* ---- Log Timeline ---- */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading logs…
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((log) => {
              const config = resultConfig[log.result];
              return (
                <div
                  key={log.id}
                  className="p-5 hover:bg-slate-50 transition-colors flex gap-4"
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

                    <p className="text-sm text-slate-700 mt-2">{log.details}</p>

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
                      <span className="text-slate-500 font-mono">
                        {log.resource}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="p-8 text-sm text-slate-500 text-center">
                No audit logs found.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Footer ---- */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Showing {filtered.length} of {rawItems.length} entries
        </p>
        <div className="flex gap-1">
          <button className="w-8 h-8 rounded-lg text-sm font-medium bg-blue-600 text-white">
            1
          </button>
        </div>
      </div>
    </div>
  );
}
