// src/components/cisco/CiscoConfigsSection.tsx

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  Terminal,
  Plus,
  Save,
  Play,
  Eye,
  Trash2,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Loader2,
  Code2,
  Settings2,
  Network,
  Zap,
  BookOpen,
  Edit3,
  Copy,
  Hash,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { cn } from "../../utils/cn";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BASE =
  (import.meta as any).env?.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const API = `${BASE}/api/v1`;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ArgDef {
  name: string;
  label: string;
  placeholder: string;
  default: string;
}

interface SavedConfig {
  id: number;
  name: string;
  description: string;
  template: string;
  args: ArgDef[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SwitchOption {
  id: number;
  name: string;
  host: string;
  status: string;
}

interface ExecuteResult {
  success: boolean;
  output: string | null;
  error: string | null;
  protocol_used: string | null;
  execution_time_ms: number | null;
}

/* ------------------------------------------------------------------ */
/*  API helper                                                         */
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
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.detail || b?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  JWT parser                                                         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Arg substitution                                                   */
/* ------------------------------------------------------------------ */

function substituteArgs(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => values[key] ?? `{{${key}}}`,
  );
}

function extractPlaceholders(template: string): string[] {
  const matches = [...template.matchAll(/\{\{(\w+)\}\}/g)];
  const seen = new Set<string>();
  return matches
    .map((m) => m[1])
    .filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
}

/* ------------------------------------------------------------------ */
/*  Preview Modal                                                      */
/* ------------------------------------------------------------------ */

function PreviewModal({
  open,
  onClose,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  preview: string;
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
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Eye size={16} className="text-blue-400" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Command Preview
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <X size={18} className="text-slate-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <pre className="text-sm text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
            {preview || "— empty —"}
          </pre>
        </div>
        <div className="flex justify-between items-center px-6 py-3 border-t border-slate-700 bg-slate-800/50">
          <p className="text-xs text-slate-400">
            {preview.split("\n").length} lines · {preview.length} chars
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(preview);
                toast.success("Copied!");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors"
            >
              <Copy size={12} /> Copy
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Output Panel                                                       */
/* ------------------------------------------------------------------ */

function OutputPanel({
  result,
  loading,
  onClear,
}: {
  result: ExecuteResult | null;
  loading: boolean;
  onClear: () => void;
}) {
  if (!loading && !result) return null;

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 border-b",
          result?.success
            ? "bg-green-900 border-green-700"
            : result?.success === false
              ? "bg-red-900 border-red-700"
              : "bg-slate-900 border-slate-700",
        )}
      >
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 size={15} className="animate-spin text-blue-400" />
          ) : result?.success ? (
            <CheckCircle size={15} className="text-green-400" />
          ) : (
            <AlertCircle size={15} className="text-red-400" />
          )}
          <span className="text-sm font-semibold text-white">
            {loading ? "Executing…" : result?.success ? "Success" : "Failed"}
          </span>
          {result?.protocol_used && (
            <span className="text-xs text-slate-400 font-mono ml-2">
              via {result.protocol_used}
            </span>
          )}
          {result?.execution_time_ms != null && (
            <span className="flex items-center gap-1 text-xs text-slate-400 ml-2">
              <Clock size={10} /> {result.execution_time_ms}ms
            </span>
          )}
        </div>
        <button
          onClick={onClear}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      <div className="bg-slate-950 p-5 min-h-[120px] max-h-[400px] overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Sending command to switch…</span>
          </div>
        )}
        {!loading && result?.output && (
          <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
            {result.output}
          </pre>
        )}
        {!loading && result?.error && (
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap">
              {result.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save Config Modal (SUPER_ADMIN only)                               */
/* ------------------------------------------------------------------ */

function SaveConfigModal({
  open,
  onClose,
  onSave,
  initialData,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (
    data: Omit<SavedConfig, "id" | "created_by" | "created_at" | "updated_at">,
  ) => Promise<void>;
  initialData?: SavedConfig | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("");
  const [args, setArgs] = useState<ArgDef[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialData?.name ?? "");
      setDescription(initialData?.description ?? "");
      setTemplate(initialData?.template ?? "");
      setArgs(
        initialData?.args?.map((a) => ({
          name: a.name,
          label: a.label ?? a.name,
          placeholder: a.placeholder ?? "",
          default: a.default ?? "",
        })) ?? [],
      );
      setError("");
    }
  }, [open, initialData]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Auto-detect placeholders from template and sync args list
  useEffect(() => {
    const placeholders = extractPlaceholders(template);
    setArgs((prev) => {
      const kept = prev.filter((a) => placeholders.includes(a.name));
      const existing = new Set(kept.map((a) => a.name));
      const added = placeholders
        .filter((p) => !existing.has(p))
        .map(
          (p): ArgDef => ({
            name: p,
            label: p,
            placeholder: "",
            default: "",
          }),
        );
      return [...kept, ...added];
    });
  }, [template]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!template.trim()) {
      setError("Template is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        template,
        args,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateArg = (idx: number, field: keyof ArgDef, value: string) => {
    setArgs((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)),
    );
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Save size={18} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {initialData?.id ? "Edit Saved Function" : "Save New Function"}
              </h3>
              <p className="text-xs text-slate-500">
                Use {"{{arg_name}}"} in the template for arguments
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

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={15} className="shrink-0" /> {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Function Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                placeholder="e.g. Set Access VLAN"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this function do?"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Template */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Config Template <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-slate-400 mb-2">
                Use{" "}
                <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">
                  {"{{arg_name}}"}
                </code>{" "}
                for dynamic values. Arguments are auto-detected from the
                template.
              </p>
              <textarea
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setError("");
                }}
                rows={8}
                placeholder={`conf t\ninterface {{interface}}\n switchport access vlan {{vlan_id}}\nend`}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                spellCheck={false}
              />
            </div>

            {/* Auto-detected args */}
            {args.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Arguments ({args.length} detected)
                </label>
                <div className="space-y-3">
                  {args.map((arg, idx) => (
                    <div
                      key={arg.name}
                      className="grid grid-cols-3 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {/* Name (read-only — from template) */}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          Placeholder
                        </p>
                        <code className="text-xs font-mono text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                          {"{{"}
                          {arg.name}
                          {"}}"}
                        </code>
                      </div>
                      {/* Label */}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          Label
                        </p>
                        <input
                          type="text"
                          value={arg.label}
                          onChange={(e) =>
                            updateArg(idx, "label", e.target.value)
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          placeholder="e.g. VLAN ID"
                        />
                      </div>
                      {/* Placeholder hint text */}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          Hint text
                        </p>
                        <input
                          type="text"
                          value={arg.placeholder}
                          onChange={(e) =>
                            updateArg(idx, "placeholder", e.target.value)
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          placeholder="e.g. 10"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {submitting
                ? "Saving…"
                : initialData?.id
                  ? "Update Function"
                  : "Save Function"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete Confirm                                                     */
/* ------------------------------------------------------------------ */

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

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
          <div className="h-10 w-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Delete Function
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Delete <strong>"{name}"</strong>? This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Saved Function Card                                                */
/* ------------------------------------------------------------------ */

function FunctionCard({
  config,
  onLoad,
  onEdit,
  onDelete,
  isSuperAdmin,
}: {
  config: SavedConfig;
  onLoad: (c: SavedConfig) => void;
  onEdit: (c: SavedConfig) => void;
  onDelete: (c: SavedConfig) => void;
  isSuperAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all">
      <div className="flex items-start gap-3 p-4">
        <div className="shrink-0 h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Code2 size={18} className="text-indigo-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-900 truncate">
                {config.name}
              </h4>
              {config.description && (
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {config.description}
                </p>
              )}
            </div>
            {config.args.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-[10px] font-medium text-amber-700 shrink-0">
                <Hash size={9} /> {config.args.length} arg
                {config.args.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
            {config.created_by && <span>by {config.created_by}</span>}
            <span>{new Date(config.updated_at).toLocaleDateString()}</span>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
            >
              {expanded ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}
              {expanded ? "hide" : "preview"}
            </button>
          </div>

          {expanded && (
            <div className="mt-3 rounded-lg bg-slate-950 p-3 overflow-x-auto">
              <pre className="text-[11px] text-green-300 font-mono whitespace-pre">
                {config.template}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100">
        <button
          onClick={() => onLoad(config)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Zap size={12} /> Load
        </button>
        {isSuperAdmin && (
          <>
            <button
              onClick={() => onEdit(config)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Edit3 size={12} /> Edit
            </button>
            <button
              onClick={() => onDelete(config)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function CiscoConfigsSection() {
  const { accessToken } = useAuth();
  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const isSuperAdmin = jwt?.role === "SUPER_ADMIN";

  // ── Switches ──────────────────────────────────────────────────────
  const [switches, setSwitches] = useState<SwitchOption[]>([]);
  const [selectedSwitchId, setSelectedSwitchId] = useState<number | null>(null);
  const [loadingSwitches, setLoadingSwitches] = useState(true);

  // ── Editor state ──────────────────────────────────────────────────
  const [command, setCommand] = useState("");
  const [argValues, setArgValues] = useState<Record<string, string>>({});

  // ── Active function (loaded from saved) ───────────────────────────
  const [activeConfig, setActiveConfig] = useState<SavedConfig | null>(null);

  // ── Execution ─────────────────────────────────────────────────────
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  // ── Preview ───────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Saved functions ───────────────────────────────────────────────
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configSearch, setConfigSearch] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedConfig | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----------------------------------------------------------------
   * Derived
   * ---------------------------------------------------------------- */
  const placeholders = useMemo(() => extractPlaceholders(command), [command]);

  useEffect(() => {
    setArgValues((prev) => {
      const next: Record<string, string> = {};
      for (const p of placeholders) {
        next[p] = prev[p] ?? "";
      }
      return next;
    });
  }, [placeholders]);

  const preview = useMemo(
    () => substituteArgs(command, argValues),
    [command, argValues],
  );

  const unsatisfiedArgs = useMemo(
    () => placeholders.filter((p) => !argValues[p]?.trim()),
    [placeholders, argValues],
  );

  /* ----------------------------------------------------------------
   * Load switches
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!accessToken) return;
    setLoadingSwitches(true);
    apiFetch<{ switches: SwitchOption[] }>(`${API}/cisco/switches`, accessToken)
      .then((d) => {
        const list = d.switches ?? [];
        setSwitches(list);
        if (list.length > 0) setSelectedSwitchId(list[0].id);
      })
      .catch(() => toast.error("Failed to load switches"))
      .finally(() => setLoadingSwitches(false));
  }, [accessToken]);

  /* ----------------------------------------------------------------
   * Load saved configs
   * ---------------------------------------------------------------- */
  const loadConfigs = useCallback(
    async (search = "") => {
      if (!accessToken) return;
      setConfigsLoading(true);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        const data = await apiFetch<{ configs: SavedConfig[]; total: number }>(
          `${API}/cisco/configs?${params.toString()}`,
          accessToken,
        );
        setSavedConfigs(data.configs ?? []);
      } catch {
        toast.error("Failed to load saved functions");
      } finally {
        setConfigsLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleConfigSearchChange = (val: string) => {
    setConfigSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => loadConfigs(val), 350);
  };

  /* ----------------------------------------------------------------
   * Load a saved function into the editor
   * ---------------------------------------------------------------- */
  const handleLoadConfig = useCallback((cfg: SavedConfig) => {
    setActiveConfig(cfg);
    setCommand(cfg.template);
    const defaults: Record<string, string> = {};
    for (const arg of cfg.args) {
      defaults[arg.name] = arg.default ?? "";
    }
    setArgValues(defaults);
    setResult(null);
    toast.success(`Loaded: ${cfg.name}`);
  }, []);

  /* ----------------------------------------------------------------
   * Execute — no enable_mode field sent
   * ---------------------------------------------------------------- */
  const handleExecute = useCallback(async () => {
    if (!selectedSwitchId) {
      toast.error("Select a switch first.");
      return;
    }
    if (!preview.trim()) {
      toast.error("Command is empty.");
      return;
    }
    if (unsatisfiedArgs.length > 0) {
      toast.error(`Fill in all arguments: ${unsatisfiedArgs.join(", ")}`);
      return;
    }

    setExecuting(true);
    setResult(null);

    try {
      const data = await apiFetch<ExecuteResult>(
        `${API}/cisco/configs/execute`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            switch_id: selectedSwitchId,
            command: preview,
            // enable_mode removed — backend always uses enable mode
          }),
        },
      );
      setResult(data);
      if (data.success) {
        toast.success("Command executed successfully");
      } else {
        toast.error(data.error || "Command failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Execution failed");
      setResult({
        success: false,
        output: null,
        error: err.message,
        protocol_used: null,
        execution_time_ms: null,
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedSwitchId, preview, unsatisfiedArgs, accessToken]);

  /* ----------------------------------------------------------------
   * Save / Update config
   * ---------------------------------------------------------------- */
  const handleSaveConfig = useCallback(
    async (
      data: Omit<
        SavedConfig,
        "id" | "created_by" | "created_at" | "updated_at"
      >,
    ) => {
      if (editingConfig) {
        await apiFetch(
          `${API}/cisco/configs/${editingConfig.id}`,
          accessToken,
          {
            method: "PUT",
            body: JSON.stringify(data),
          },
        );
        toast.success(`"${data.name}" updated`);
      } else {
        await apiFetch(`${API}/cisco/configs`, accessToken, {
          method: "POST",
          body: JSON.stringify(data),
        });
        toast.success(`"${data.name}" saved`);
      }
      setEditingConfig(null);
      setSaveModalOpen(false);
      loadConfigs(configSearch);
    },
    [accessToken, editingConfig, configSearch, loadConfigs],
  );

  /* ----------------------------------------------------------------
   * Delete config
   * ---------------------------------------------------------------- */
  const handleDeleteConfig = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`${API}/cisco/configs/${deleteTarget.id}`, accessToken, {
        method: "DELETE",
      });
      toast.success(`"${deleteTarget.name}" deleted`);
      if (activeConfig?.id === deleteTarget.id) {
        setActiveConfig(null);
      }
      loadConfigs(configSearch);
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, accessToken, activeConfig, configSearch, loadConfigs]);

  const handleOpenSaveModal = () => {
    setEditingConfig(null);
    setSaveModalOpen(true);
  };

  /* ----------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------- */
  return (
    <div className="flex flex-col gap-6">
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Terminal className="text-indigo-600" size={28} />
            Cisco Configs
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Write, preview and execute IOS config commands against any switch.
            {isSuperAdmin && " Save reusable functions for the team."}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={handleOpenSaveModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={16} /> Save Current as Function
          </button>
        )}
      </div>

      <div className="flex gap-6 items-start">
        {/* ── LEFT: Saved Functions Sidebar ─────────────────────── */}
        <div
          className={cn(
            "shrink-0 transition-all duration-300",
            sidebarOpen ? "w-80" : "w-12",
          )}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              {sidebarOpen && (
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-indigo-600" />
                  <span className="text-sm font-bold text-slate-900">
                    Saved Functions
                  </span>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    {savedConfigs.length}
                  </span>
                </div>
              )}
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                title={sidebarOpen ? "Collapse" : "Expand saved functions"}
              >
                {sidebarOpen ? (
                  <ChevronRight size={16} className="text-slate-500" />
                ) : (
                  <BookOpen size={16} className="text-slate-500" />
                )}
              </button>
            </div>

            {sidebarOpen && (
              <>
                <div className="p-3 border-b border-slate-200">
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={configSearch}
                      onChange={(e) => handleConfigSearchChange(e.target.value)}
                      placeholder="Search functions…"
                      className="w-full pl-8 pr-8 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {configSearch && (
                      <button
                        onClick={() => {
                          setConfigSearch("");
                          loadConfigs("");
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-y-auto max-h-[calc(100vh-320px)] p-3 space-y-2">
                  {configsLoading ? (
                    <div className="flex items-center justify-center py-8 text-slate-400">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : savedConfigs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                      <Code2 size={32} className="mb-2 opacity-40" />
                      <p className="text-xs text-center">
                        {configSearch
                          ? "No functions match your search"
                          : "No saved functions yet"}
                      </p>
                      {isSuperAdmin && !configSearch && (
                        <p className="text-xs text-indigo-500 mt-1 text-center">
                          Write a command and click "Save Current as Function"
                        </p>
                      )}
                    </div>
                  ) : (
                    savedConfigs.map((cfg) => (
                      <FunctionCard
                        key={cfg.id}
                        config={cfg}
                        onLoad={handleLoadConfig}
                        onEdit={(c) => {
                          setEditingConfig(c);
                          setSaveModalOpen(true);
                        }}
                        onDelete={setDeleteTarget}
                        isSuperAdmin={isSuperAdmin}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT: Editor + Execution ─────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Switch selector */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Network size={16} className="text-slate-400 shrink-0" />
                <label className="text-sm font-semibold text-slate-700 whitespace-nowrap">
                  Target Switch:
                </label>
                {loadingSwitches ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </div>
                ) : (
                  <select
                    value={selectedSwitchId ?? ""}
                    onChange={(e) =>
                      setSelectedSwitchId(Number(e.target.value))
                    }
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {switches.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.host})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Active function badge */}
              {activeConfig && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
                  <Zap size={11} />
                  <span className="font-semibold">{activeConfig.name}</span>
                  <button
                    onClick={() => {
                      setActiveConfig(null);
                      setCommand("");
                      setArgValues({});
                      setResult(null);
                    }}
                    className="ml-1 p-0.5 rounded hover:bg-indigo-200 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {activeConfig ? activeConfig.name : "untitled.ios"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {command && (
                  <button
                    onClick={() => {
                      setCommand("");
                      setArgValues({});
                      setResult(null);
                      setActiveConfig(null);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
                  >
                    <X size={12} /> Clear
                  </button>
                )}
                <span className="text-xs text-slate-500 font-mono">
                  {command.split("\n").length}L · {command.length}c
                </span>
              </div>
            </div>

            <textarea
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setActiveConfig(null);
                setResult(null);
              }}
              rows={14}
              placeholder={`Write your IOS config here…\n\nExample:\nconf t\ninterface GigabitEthernet0/1\n switchport mode access\n switchport access vlan 10\nend\n\nUse {{variable}} for dynamic arguments.`}
              className="w-full px-5 py-4 bg-slate-950 text-green-300 font-mono text-sm focus:outline-none resize-y leading-relaxed placeholder:text-slate-600"
              spellCheck={false}
            />
          </div>

          {/* ── Arg Inputs ─────────────────────────────────────── */}
          {placeholders.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 size={16} className="text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900">
                  Arguments ({placeholders.length})
                </h3>
                {unsatisfiedArgs.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-[10px] font-medium text-amber-700">
                    <AlertTriangle size={9} /> {unsatisfiedArgs.length} required
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {placeholders.map((name) => {
                  const argDef = activeConfig?.args.find(
                    (a) => a.name === name,
                  );
                  const filled = !!argValues[name]?.trim();
                  return (
                    <div key={name}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        <span className="font-mono text-indigo-600">{`{{${name}}}`}</span>
                        {argDef?.label && argDef.label !== name && (
                          <span className="ml-1 text-slate-400 font-normal">
                            — {argDef.label}
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={argValues[name] ?? ""}
                          onChange={(e) =>
                            setArgValues((prev) => ({
                              ...prev,
                              [name]: e.target.value,
                            }))
                          }
                          placeholder={argDef?.placeholder || `Enter ${name}…`}
                          className={cn(
                            "w-full px-3 py-2 pr-8 border rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors",
                            filled
                              ? "border-green-300 bg-green-50 focus:ring-green-400"
                              : "border-amber-300 bg-amber-50/50 focus:ring-amber-400",
                          )}
                        />
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                          {filled ? (
                            <CheckCircle size={14} className="text-green-500" />
                          ) : (
                            <AlertCircle size={14} className="text-amber-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Action Bar ─────────────────────────────────────── */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!command.trim()}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <Eye size={16} /> Preview
            </button>

            <button
              onClick={() => {
                navigator.clipboard.writeText(preview);
                toast.success("Copied to clipboard!");
              }}
              disabled={!command.trim()}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <Copy size={16} /> Copy
            </button>

            {isSuperAdmin && command.trim() && (
              <button
                onClick={handleOpenSaveModal}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-300 rounded-xl hover:bg-indigo-100 transition-colors shadow-sm"
              >
                <Save size={16} /> Save as Function
              </button>
            )}

            <div className="flex-1" />

            {unsatisfiedArgs.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                <AlertTriangle size={13} />
                Fill: {unsatisfiedArgs.map((a) => `{{${a}}}`).join(", ")}
              </span>
            )}

            <button
              onClick={handleExecute}
              disabled={
                executing ||
                !command.trim() ||
                !selectedSwitchId ||
                unsatisfiedArgs.length > 0
              }
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {executing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {executing ? "Executing…" : "Execute"}
            </button>
          </div>

          {/* ── Output ─────────────────────────────────────────── */}
          <OutputPanel
            result={result}
            loading={executing}
            onClear={() => setResult(null)}
          />
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────── */}
      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
      />

      <SaveConfigModal
        open={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setEditingConfig(null);
        }}
        onSave={handleSaveConfig}
        initialData={
          editingConfig ??
          (command.trim()
            ? {
                id: 0,
                name: "",
                description: "",
                template: command,
                args: [],
                created_by: null,
                created_at: "",
                updated_at: "",
              }
            : null)
        }
      />

      {deleteTarget && (
        <DeleteConfirm
          name={deleteTarget.name}
          onConfirm={handleDeleteConfig}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
