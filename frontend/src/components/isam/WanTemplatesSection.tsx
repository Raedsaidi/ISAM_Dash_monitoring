// WanTemplatesSection.tsx

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { cn } from "../../utils/cn";
import {
  Plus,
  Trash2,
  Loader2,
  Edit,
  Search,
  Globe,
  User,
  Play,
  Eye,
  FileText,
  Server,
  Sparkles,
  X,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Clock,
  Layers,
  Info,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

const ISAM_BASE_URL = "http://127.0.0.1:8001";

// ── Types ──

type TemplateScope = "GLOBAL" | "USER_INSTANCE";
type ConfirmActionType =
  | "delete-template"
  | "clear-template-content"
  | "clear-all-form";

interface IsamInstance {
  id: number;
  name: string;
  host: string;
  telnet_port: number;
  ssh_port: number;
  protocol_preference: string;
  username: string;
  status: string;
  health_protocol_used: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface WanTemplate {
  id: number;
  name: string;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id: number | null;
  created_by: string | null;
  source_template_id: number | null;
  project: string | null;
  created_at: string;
  updated_at: string;
}

interface WanModel {
  id: number;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateRenderResponse {
  variables_detected: string[];
  rendered_script: string;
  rendered_commands: string[];
}

interface TemplateTestResponse {
  success: boolean;
  protocol_used: string | null;
  rendered_commands: string[];
  raw_output: string;
  message: string;
}

interface ConfirmDialogState {
  open: boolean;
  action: ConfirmActionType | null;
  template: WanTemplate | null;
  loading: boolean;
}

const EMPTY_CONFIRM: ConfirmDialogState = {
  open: false,
  action: null,
  template: null,
  loading: false,
};

// ── Helpers ──

async function authFetch<T>(
  url: string,
  token: string | null,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  }
  return data as T;
}

function extractVars(tpl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const rx = /\[\[\$(.+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(tpl)) !== null) {
    const v = m[1]?.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      result.push(v);
    }
  }
  return result;
}

function isPortVar(n: string) {
  const v = n.trim().toLowerCase();
  return v === "port" || v === "port_id";
}

function instName(instances: IsamInstance[], id: number | null | undefined) {
  if (!id) return "All ISAM";
  const f = instances.find((i) => i.id === id);
  return f ? `${f.name} (${f.host})` : `ISAM #${id}`;
}

/**
 * Construit le nom final : templateName_projectName
 * Si pas de projet, retourne juste le templateName
 */
function buildFinalName(baseName: string, projectName: string): string {
  const n = baseName.trim();
  const p = projectName.trim();
  if (!n) return "";
  return p ? `${n}_${p}` : n;
}

/**
 * Sépare un nom sauvegardé au format "templateName_projectName"
 * en { baseName, project } en se basant sur le champ project connu.
 */
function splitSavedName(
  savedName: string,
  knownProject: string | null
): { baseName: string; project: string } {
  if (knownProject && savedName.endsWith(`_${knownProject}`)) {
    return {
      baseName: savedName.slice(0, savedName.length - knownProject.length - 1),
      project: knownProject,
    };
  }
  return { baseName: savedName, project: knownProject || "" };
}

// ── UI Primitives ──

function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?:
    | "default"
    | "info"
    | "success"
    | "warning"
    | "danger"
    | "purple"
    | "orange";
  className?: string;
}) {
  const v: Record<string, string> = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    purple: "bg-violet-50 text-violet-700 border-violet-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        v[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-1">
      {Icon && (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600">
          <Icon size={16} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {badge}
        </div>
        {description && (
          <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
        )}
      </div>
    </div>
  );
}

function Btn({
  children,
  className,
  variant = "outline",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "subtle" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const vars: Record<string, string> = {
    primary:
      "bg-slate-900 text-white hover:bg-slate-800 border-slate-900 shadow-sm",
    outline: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    subtle: "bg-slate-100 text-slate-700 hover:bg-slate-200 border-transparent",
    danger: "bg-white text-red-600 hover:bg-red-50 border-red-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
  };
  const sizes: Record<string, string> = {
    sm: "px-2.5 py-1.5 text-xs gap-1.5",
    md: "px-3.5 py-2 text-sm gap-2",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        vars[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </button>
  );
}

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300",
        className
      )}
    />
  );
}

function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  children: React.ReactNode;
}) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300",
        className
      )}
    >
      {children}
    </select>
  );
}

function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[12px] leading-6 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300 font-mono",
        className
      )}
    />
  );
}

function CodeViewer({
  children,
  dark = false,
  className,
  maxHeight = "300px",
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border font-mono text-[11px] leading-6",
        dark
          ? "border-slate-700 bg-[#0c1222] text-slate-300"
          : "border-slate-200 bg-slate-50 text-slate-800",
        className
      )}
      style={{ maxHeight }}
    >
      <div className="p-4 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function AlertBanner({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: "info" | "warning" | "error" | "success";
}) {
  const v: Record<string, string> = {
    info: "border-sky-200 bg-sky-50 text-sky-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  const icons: Record<string, React.ElementType> = {
    error: AlertCircle,
    success: CheckCircle2,
    warning: AlertCircle,
    info: Info,
  };
  const Ic = icons[variant];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
        v[variant]
      )}
    >
      <Ic size={14} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
      {required && <span className="text-red-500">*</span>}
    </label>
  );
}

function ScopeBadge({ scope }: { scope: TemplateScope }) {
  return (
    <Badge variant={scope === "GLOBAL" ? "purple" : "info"}>
      {scope === "GLOBAL" ? <Globe size={12} /> : <User size={12} />}
      {scope === "GLOBAL" ? "Global" : "User / Instance"}
    </Badge>
  );
}

// ── Scope Switch ──

function ScopeSwitch({
  value,
  onChange,
}: {
  value: "ALL" | "GLOBAL" | "USER_INSTANCE";
  onChange: (v: "ALL" | "GLOBAL" | "USER_INSTANCE") => void;
}) {
  const opts: {
    key: "ALL" | "GLOBAL" | "USER_INSTANCE";
    label: string;
    icon: React.ReactNode;
  }[] = [
    { key: "ALL", label: "All", icon: <Layers size={12} /> },
    { key: "GLOBAL", label: "Global", icon: <Globe size={12} /> },
    { key: "USER_INSTANCE", label: "User", icon: <User size={12} /> },
  ];
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            value === o.key
              ? "bg-white text-slate-900 shadow-sm border border-slate-200"
              : "text-slate-500 hover:text-slate-700 border border-transparent"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Template Name Hint ──

function TemplateNameHint() {
  return (
    <div className="mt-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
      <div className="flex items-start gap-2">
        <Info size={13} className="mt-0.5 shrink-0 text-sky-600" />
        <div className="text-[11px] text-sky-700 leading-relaxed">
          <span className="font-semibold">Naming Convention :</span>{" "}
          Please use a descriptive name like{" "}
          <span className="font-mono font-semibold bg-sky-100 px-1 rounded">
            GPON-DHCP
          </span>{" "}
          or{" "}
          <span className="font-mono font-semibold bg-sky-100 px-1 rounded">
            ETHERNET
          </span>
        </div>
      </div>
    </div>
  );
}


// ── Final Name Preview ──

function FinalNamePreview({
  baseName,
  project,
}: {
  baseName: string;
  project: string;
}) {
  const finalName = buildFinalName(baseName, project);
  if (!finalName) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
        Final saved name
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold text-slate-900">
          {finalName}
        </span>
        {project.trim() && (
          <Badge variant="orange" className="text-[9px]">
            <FolderOpen size={10} />
            {project.trim()}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ================================================================
// ========  WAN MODELS MODAL  ====================================
// ================================================================

function WanModelsModal({
  open,
  onClose,
  accessToken,
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string | null;
}) {
  const [models, setModels] = useState<WanModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (open) loadModels();
  }, [open]);

  async function loadModels() {
    setLoading(true);
    try {
      const res = await authFetch<{ models: WanModel[] }>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-models`,
        accessToken
      );
      setModels(res.models || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load WAN models.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await authFetch<WanModel>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-models`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            description: newDesc.trim() || null,
          }),
        }
      );
      setNewName("");
      setNewDesc("");
      await loadModels();
      toast.success("WAN model created.");
    } catch (err: any) {
      toast.error(err.message || "Failed to create model.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(id: number) {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await authFetch<WanModel>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-models/${id}`,
        accessToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editName.trim(),
            description: editDesc.trim() || null,
          }),
        }
      );
      setEditingId(null);
      await loadModels();
      toast.success("WAN model updated.");
    } catch (err: any) {
      toast.error(err.message || "Failed to update model.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await authFetch<void>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-models/${id}`,
        accessToken,
        { method: "DELETE" }
      );
      await loadModels();
      toast.success("WAN model deleted.");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete model.");
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(m: WanModel) {
    setEditingId(m.id);
    setEditName(m.name);
    setEditDesc(m.description || "");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4 shrink-0">
          <SectionTitle
            icon={Layers}
            title="WAN Models"
            description="Manage WAN model types (GPON, SAFRAN, ETHERNET...)"
          />
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Create form */}
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Add New Model
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required>Name</FieldLabel>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. GPON"
                />
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <Input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </div>
            <Btn
              type="submit"
              variant="primary"
              size="sm"
              disabled={creating || !newName.trim()}
            >
              {creating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Add Model
            </Btn>
          </form>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading...
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              No WAN models yet.
            </div>
          ) : (
            <div className="space-y-2">
              {models.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-3"
                >
                  {editingId === m.id ? (
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <Input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Description"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm">
                        {m.name}
                      </div>
                      {m.description && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {m.description}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">
                        by {m.created_by || "—"} ·{" "}
                        {new Date(m.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 shrink-0">
                    {editingId === m.id ? (
                      <>
                        <Btn
                          size="sm"
                          variant="primary"
                          onClick={() => handleSaveEdit(m.id)}
                          disabled={saving || !editName.trim()}
                        >
                          {saving ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Btn>
                        <Btn
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          Cancel
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(m)}
                        >
                          <Edit size={12} />
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(m.id)}
                          disabled={deletingId === m.id}
                        >
                          {deletingId === m.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// ========  MAIN COMPONENT  ======================================
// ================================================================

export default function WanTemplatesSection() {
  const { accessToken } = useAuth();

  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<
    "ALL" | "GLOBAL" | "USER_INSTANCE"
  >("ALL");

  const [showWanModelsModal, setShowWanModelsModal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WanTemplate | null>(
    null
  );

  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [commandsTemplate, setCommandsTemplate] = useState("");
  const [variableValues, setVariableValues] = useState<
    Record<string, string>
  >({});
  const [testInstanceId, setTestInstanceId] = useState<number | "">("");
  const [testPort, setTestPort] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [previewState, setPreviewState] = useState({
    loading: false,
    error: null as string | null,
    rendered_script: "",
    rendered_commands: [] as string[],
  });

  const [testState, setTestState] = useState({
    loading: false,
    success: false,
    error: null as string | null,
    protocol_used: null as string | null,
    raw_output: "",
    rendered_commands: [] as string[],
    message: null as string | null,
  });

  const [submitting, setSubmitting] = useState(false);
  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState>(EMPTY_CONFIRM);

  // ── Nom final calculé en temps réel ──
  const finalName = useMemo(
    () => buildFinalName(name, project),
    [name, project]
  );

  // ── Load data when scope filter or token changes ──
  useEffect(() => {
    if (!accessToken) return;
    loadData();
  }, [accessToken, scopeFilter]);

  const detectedVariables = useMemo(
    () => extractVars(commandsTemplate),
    [commandsTemplate]
  );
  const customVariables = useMemo(
    () => detectedVariables.filter((v) => !isPortVar(v)),
    [detectedVariables]
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const appliesTo =
        t.scope === "GLOBAL"
          ? "global"
          : `${t.isam_instance_id ?? ""} ${instName(
              instances,
              t.isam_instance_id
            )}`;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.created_by || "").toLowerCase().includes(q) ||
        (t.project || "").toLowerCase().includes(q) ||
        appliesTo.toLowerCase().includes(q)
      );
    });
  }, [templates, search, instances]);

  const canSave = Boolean(name.trim() && commandsTemplate.trim());

  useEffect(() => {
    setVariableValues((prev) => {
      const next: Record<string, string> = {};
      customVariables.forEach((v) => {
        next[v] = prev[v] ?? "";
      });
      return next;
    });
  }, [customVariables]);

  async function loadData() {
    setLoading(true);
    setGlobalError(null);
    try {
      const scopeParam =
        scopeFilter !== "ALL" ? `&scope=${scopeFilter}` : "";
      const [instRes, tplRes] = await Promise.all([
        authFetch<{ instances: IsamInstance[] }>(
          `${ISAM_BASE_URL}/api/v1/isam/instances`,
          accessToken
        ),
        authFetch<{ templates: WanTemplate[] }>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates?_=${Date.now()}${scopeParam}`,
          accessToken
        ),
      ]);
      setInstances(instRes.instances || []);
      setTemplates(tplRes.templates || []);
    } catch (err: any) {
      setGlobalError(err.message || "Failed to load WAN templates.");
    } finally {
      setLoading(false);
    }
  }

  function resetStatesOnly() {
    setPreviewState({
      loading: false,
      error: null,
      rendered_script: "",
      rendered_commands: [],
    });
    setTestState({
      loading: false,
      success: false,
      error: null,
      protocol_used: null,
      raw_output: "",
      rendered_commands: [],
      message: null,
    });
  }

  function resetModalState() {
    setEditingTemplate(null);
    setName("");
    setProject("");
    setCommandsTemplate("");
    setVariableValues({});
    setTestInstanceId("");
    setTestPort("");
    setFormError(null);
    resetStatesOnly();
  }

  function closeConfirmDialog() {
    if (confirmDialog.loading) return;
    setConfirmDialog(EMPTY_CONFIRM);
  }

  function openCreateModal() {
    resetModalState();
    setShowModal(true);
  }

  function openEditModal(t: WanTemplate) {
    resetModalState();
    setEditingTemplate(t);

    // ── Séparer le nom sauvegardé pour l'édition ──
    const { baseName, project: proj } = splitSavedName(t.name, t.project);
    setName(baseName);
    setProject(proj);

    setCommandsTemplate(t.commands_template);
    if (t.scope === "USER_INSTANCE" && t.isam_instance_id)
      setTestInstanceId(t.isam_instance_id);
    setShowModal(true);
  }

  // ── Preview ──
  async function handlePreview() {
    setFormError(null);
    if (!commandsTemplate.trim()) {
      setFormError("Commands template is required.");
      return;
    }
    if (detectedVariables.some(isPortVar) && !testPort.trim()) {
      setFormError(
        "Test port is required for preview because the template uses [[$port]]."
      );
      return;
    }
    setPreviewState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await authFetch<TemplateRenderResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/render`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commands_template: commandsTemplate,
            selected_port: testPort.trim() || null,
            variables: variableValues,
          }),
        }
      );
      setPreviewState({
        loading: false,
        error: null,
        rendered_script: res.rendered_script,
        rendered_commands: res.rendered_commands,
      });
    } catch (err: any) {
      setPreviewState({
        loading: false,
        error: err.message,
        rendered_script: "",
        rendered_commands: [],
      });
    }
  }

  // ── Test ──
  async function handleTestTemplate() {
    setFormError(null);
    if (!commandsTemplate.trim()) {
      setFormError("Commands template is required.");
      return;
    }
    if (!testInstanceId) {
      setFormError("Please choose an ISAM for testing.");
      return;
    }
    if (detectedVariables.some(isPortVar) && !testPort.trim()) {
      setFormError("Please enter a test port.");
      return;
    }
    setTestState((s) => ({
      ...s,
      loading: true,
      error: null,
      success: false,
      message: null,
    }));
    const tid = toast.loading("Testing template on ISAM...");
    try {
      const res = await authFetch<TemplateTestResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/test`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instance_id: Number(testInstanceId),
            commands_template: commandsTemplate,
            selected_port: testPort.trim() || null,
            variables: variableValues,
          }),
        }
      );
      setTestState({
        loading: false,
        success: res.success,
        error: res.success ? null : res.message,
        protocol_used: res.protocol_used,
        raw_output: res.raw_output,
        rendered_commands: res.rendered_commands,
        message: res.message,
      });
      if (res.success)
        toast.success(res.message || "Template test OK.", { id: tid });
      else toast.error(res.message || "Template test failed.", { id: tid });
    } catch (err: any) {
      setTestState({
        loading: false,
        success: false,
        error: err.message,
        protocol_used: null,
        raw_output: "",
        rendered_commands: [],
        message: null,
      });
      toast.error(err.message, { id: tid });
    }
  }

  // ── Save ──
  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!canSave) {
      setFormError("Template name and content are required.");
      return;
    }

    // ── Construire le nom final : templateName_projectName ──
    const saveName = finalName;
    const saveProject = project.trim() || null;

    const isEditing = Boolean(editingTemplate);
    setSubmitting(true);
    try {
      if (editingTemplate) {
        await authFetch<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${editingTemplate.id}`,
          accessToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: saveName,
              commands_template: commandsTemplate,
              project: saveProject,
            }),
          }
        );
      } else {
        await authFetch<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: saveName,
              commands_template: commandsTemplate,
              scope: "GLOBAL",
              isam_instance_id: null,
              project: saveProject,
            }),
          }
        );
      }
      await loadData();
      setShowModal(false);
      resetModalState();
      toast.success(
        isEditing
          ? "Template updated successfully."
          : "Template created successfully."
      );
    } catch (err: any) {
      setFormError(err.message || "Failed to save template.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirm dialog ──
  async function handleConfirmDialog() {
    const { action, template } = confirmDialog;
    if (!action) return;

    if (action === "clear-template-content") {
      setCommandsTemplate("");
      resetStatesOnly();
      setConfirmDialog(EMPTY_CONFIRM);
      toast.success("Template content cleared.");
      return;
    }
    if (action === "clear-all-form") {
      resetModalState();
      setConfirmDialog(EMPTY_CONFIRM);
      toast.success("Form cleared.");
      return;
    }
    if (action === "delete-template" && template) {
      setConfirmDialog((p) => ({ ...p, loading: true }));
      const tid = toast.loading("Deleting template...");
      try {
        await authFetch<void>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${template.id}`,
          accessToken,
          { method: "DELETE" }
        );
        await loadData();
        if (editingTemplate?.id === template.id) {
          setShowModal(false);
          resetModalState();
        }
        toast.success("Template deleted.", { id: tid });
      } catch (err: any) {
        toast.error(err.message, { id: tid });
      } finally {
        setConfirmDialog(EMPTY_CONFIRM);
      }
    }
  }

  const confirmTitle =
    confirmDialog.action === "delete-template"
      ? `Delete "${confirmDialog.template?.name ?? ""}"?`
      : confirmDialog.action === "clear-template-content"
        ? "Clear template content?"
        : confirmDialog.action === "clear-all-form"
          ? "Reset the whole form?"
          : "";

  const confirmBtnText =
    confirmDialog.action === "delete-template"
      ? "Delete"
      : confirmDialog.action === "clear-template-content"
        ? "Clear"
        : confirmDialog.action === "clear-all-form"
          ? "Reset"
          : "Confirm";

  // ── RENDER ──

  return (
    <>
      <div className="space-y-5">
        {/* ── Header ── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  WAN Templates
                </h2>
                <Badge variant="info">Admin</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Manage templates. Preview and test are optional but
                recommended.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Btn variant="outline" onClick={loadData} disabled={loading}>
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Clock size={14} />
                )}
                Refresh
              </Btn>
              <Btn
                variant="outline"
                onClick={() => setShowWanModelsModal(true)}
              >
                <Layers size={16} />
                WAN Models
              </Btn>
              <Btn variant="primary" onClick={openCreateModal}>
                <Plus size={16} />
                Add Global Template
              </Btn>
            </div>
          </div>

          {/* Search + Scope Switch */}
          <div className="border-t border-slate-200 bg-slate-50/70 p-4 flex items-center gap-4 flex-wrap">
            <div className="relative max-w-md flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                type="text"
                placeholder="Search by name, creator, project..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScopeSwitch value={scopeFilter} onChange={setScopeFilter} />
          </div>
        </div>

        {globalError && (
          <AlertBanner variant="error">{globalError}</AlertBanner>
        )}

        {/* ── Table ── */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-3">
            <SectionTitle
              icon={FileText}
              title="Templates"
              description={`${filteredTemplates.length} template(s)`}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading
              templates...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {[
                      "Template",
                      "Project",
                      "Scope",
                      "Applies To",
                      "Creator",
                      "Updated",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTemplates.map((t) => {
                    const lines = t.commands_template
                      .split("\n")
                      .filter(Boolean).length;
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-1">
                            <div className="font-semibold text-slate-900">
                              {t.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {lines} line(s)
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          {t.project ? (
                            <Badge variant="orange">
                              <FolderOpen size={11} />
                              {t.project}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <ScopeBadge scope={t.scope} />
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          {t.scope === "GLOBAL"
                            ? "All ISAM"
                            : instName(instances, t.isam_instance_id)}
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          {t.created_by || "—"}
                        </td>
                        <td className="px-5 py-4 align-top text-xs text-slate-500">
                          {new Date(t.updated_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-4 align-top text-right">
                          <div className="inline-flex items-center gap-2">
                            <Btn
                              size="sm"
                              variant="outline"
                              onClick={() => openEditModal(t)}
                            >
                              <Edit size={14} /> Edit
                            </Btn>
                            <Btn
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setConfirmDialog({
                                  open: true,
                                  action: "delete-template",
                                  template: t,
                                  loading: false,
                                })
                              }
                            >
                              <Trash2 size={14} /> Delete
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTemplates.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-12 text-center text-sm text-slate-500"
                      >
                        No templates found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Create / Edit Modal ── */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm p-4">
            <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[92vh] overflow-y-auto">
              {/* Top bar */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
                <SectionTitle
                  icon={editingTemplate ? Edit : Plus}
                  title={
                    editingTemplate
                      ? "Edit Template"
                      : "Create Global Template"
                  }
                  description="Preview & Test are optional (recommended before saving)."
                  badge={
                    <ScopeBadge
                      scope={editingTemplate?.scope ?? "GLOBAL"}
                    />
                  }
                />
                <button
                  onClick={() => {
                    setShowModal(false);
                    resetModalState();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={16} />
                </button>
              </div>

              <form
                onSubmit={handleSaveTemplate}
                className="p-6 space-y-6"
              >
                {formError && (
                  <AlertBanner variant="error">{formError}</AlertBanner>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                  {/* ── Left: Definition ── */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
                      <SectionTitle
                        icon={FileText}
                        title="Template Definition"
                        description="Name, project & commands template."
                      />
                    </div>
                    <div className="p-5 space-y-4">
                      {/* Name */}
                      <div>
                        <FieldLabel required>Template Name</FieldLabel>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Example: GPON-DHCP"
                        />
                        <TemplateNameHint />
                      </div>

                      {/* Project */}
                      <div>
                        <FieldLabel>Project</FieldLabel>
                        <Input
                          value={project}
                          onChange={(e) => setProject(e.target.value)}
                          placeholder="Example: Orange"
                        />
                      </div>

                      {/* ── Final Name Preview ── */}
                      <FinalNamePreview baseName={name} project={project} />

                      {editingTemplate?.scope === "USER_INSTANCE" && (
                        <Badge variant="default">
                          <Server size={12} />
                          {instName(
                            instances,
                            editingTemplate.isam_instance_id
                          )}
                        </Badge>
                      )}

                      {/* Commands */}
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <FieldLabel required>Commands Template</FieldLabel>
                          <Btn
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              if (commandsTemplate.trim())
                                setConfirmDialog({
                                  open: true,
                                  action: "clear-template-content",
                                  template: null,
                                  loading: false,
                                });
                            }}
                            disabled={!commandsTemplate.trim()}
                          >
                            <Trash2 size={13} /> Clear
                          </Btn>
                        </div>
                        <Textarea
                          value={commandsTemplate}
                          onChange={(e) =>
                            setCommandsTemplate(e.target.value)
                          }
                          rows={14}
                          placeholder={`configure equipment ont interface [[$port]] admin-state down\nconfigure equipment ont no interface [[$port]]\nconfigure equipment ont interface [[$port]] desc1 [[$desc]] sernum [[$serial_number]]\nconfigure equipment ont interface [[$port]] admin-state up`}
                        />
                        <div className="mt-2 text-[11px] text-slate-500">
                          Variable format:{" "}
                          <span className="font-mono">[[$port]]</span>,{" "}
                          <span className="font-mono">[[$desc]]</span>,{" "}
                          <span className="font-mono">
                            [[$serial_number]]
                          </span>
                        </div>
                      </div>

                      {/* Detected variables */}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Detected variables
                        </div>
                        {detectedVariables.length === 0 ? (
                          <div className="text-xs text-slate-500">
                            No variables detected.
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {detectedVariables.map((v) => (
                              <span
                                key={v}
                                className={cn(
                                  "rounded border px-2 py-0.5 font-mono text-[11px]",
                                  isPortVar(v)
                                    ? "border-sky-200 bg-sky-50 text-sky-700"
                                    : "border-slate-200 bg-white text-slate-600"
                                )}
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Right: Preview & Test ── */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
                      <SectionTitle
                        icon={Sparkles}
                        title="Preview & Test"
                        description="Render commands and (optionally) run on ISAM."
                      />
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <FieldLabel>Test ISAM</FieldLabel>
                          <Select
                            value={testInstanceId}
                            onChange={(e) =>
                              setTestInstanceId(
                                e.target.value
                                  ? Number(e.target.value)
                                  : ""
                              )
                            }
                          >
                            <option value="">— Choose ISAM —</option>
                            {instances.map((inst) => (
                              <option key={inst.id} value={inst.id}>
                                {inst.name} ({inst.host})
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <FieldLabel
                            required={detectedVariables.some(isPortVar)}
                          >
                            Test Port
                          </FieldLabel>
                          <Input
                            value={testPort}
                            onChange={(e) => setTestPort(e.target.value)}
                            placeholder="1/1/7/3/95"
                            className="font-mono"
                          />
                        </div>
                      </div>

                      {customVariables.length > 0 && (
                        <div>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Custom variables
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {customVariables.map((v) => (
                              <div key={v}>
                                <FieldLabel>{v}</FieldLabel>
                                <Input
                                  value={variableValues[v] ?? ""}
                                  onChange={(e) =>
                                    setVariableValues((p) => ({
                                      ...p,
                                      [v]: e.target.value,
                                    }))
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <Btn
                          type="button"
                          onClick={handlePreview}
                          disabled={previewState.loading}
                        >
                          {previewState.loading ? (
                            <Loader2
                              size={14}
                              className="animate-spin"
                            />
                          ) : (
                            <Eye size={14} />
                          )}
                          Preview
                        </Btn>
                        <Btn
                          type="button"
                          variant="primary"
                          onClick={handleTestTemplate}
                          disabled={testState.loading || !testInstanceId}
                          title={
                            !testInstanceId
                              ? "Select an ISAM to enable test"
                              : undefined
                          }
                        >
                          {testState.loading ? (
                            <Loader2
                              size={14}
                              className="animate-spin"
                            />
                          ) : (
                            <Play size={14} />
                          )}
                          Test on ISAM
                        </Btn>
                      </div>

                      {previewState.error && (
                        <AlertBanner variant="error">
                          {previewState.error}
                        </AlertBanner>
                      )}
                      {previewState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <Badge variant="info">
                            <Eye size={12} /> Preview
                          </Badge>
                          <CodeViewer maxHeight="220px">
                            {previewState.rendered_commands.join("\n")}
                          </CodeViewer>
                        </div>
                      )}

                      {(testState.error || testState.message) && (
                        <AlertBanner
                          variant={
                            testState.success ? "success" : "error"
                          }
                        >
                          {testState.error || testState.message}
                        </AlertBanner>
                      )}
                      {testState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                testState.success ? "success" : "warning"
                              }
                            >
                              <Play size={12} /> Tested Commands
                            </Badge>
                            {testState.protocol_used && (
                              <Badge variant="default">
                                {testState.protocol_used.toUpperCase()}
                              </Badge>
                            )}
                          </div>
                          <CodeViewer maxHeight="160px">
                            {testState.rendered_commands.join("\n")}
                          </CodeViewer>
                        </div>
                      )}
                      {testState.raw_output && (
                        <div className="space-y-2">
                          <Badge variant="default">
                            <Terminal size={12} /> ISAM Output
                          </Badge>
                          <CodeViewer dark maxHeight="220px">
                            {testState.raw_output}
                          </CodeViewer>
                        </div>
                      )}

                      {!testState.loading &&
                        !testState.success &&
                        !testState.error &&
                        !testState.message && (
                          <AlertBanner variant="warning">
                            Template not tested yet. You can save it, but
                            testing is recommended.
                          </AlertBanner>
                        )}
                    </div>
                  </div>
                </div>

                {/* Modal footer */}
                <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4">
                  <Btn
                    type="button"
                    variant="danger"
                    onClick={() =>
                      setConfirmDialog({
                        open: true,
                        action: "clear-all-form",
                        template: null,
                        loading: false,
                      })
                    }
                  >
                    <RotateCcw size={16} /> Clear All
                  </Btn>
                  <div className="flex items-center gap-2">
                    <Btn
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowModal(false);
                        resetModalState();
                      }}
                    >
                      Cancel
                    </Btn>
                    <Btn
                      type="submit"
                      variant="primary"
                      disabled={submitting || !canSave}
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {editingTemplate ? "Saving..." : "Creating..."}
                        </>
                      ) : editingTemplate ? (
                        "Save Changes"
                      ) : (
                        "Save Template"
                      )}
                    </Btn>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* WAN Models Modal */}
      <WanModelsModal
        open={showWanModelsModal}
        onClose={() => setShowWanModelsModal(false)}
        accessToken={accessToken}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmTitle}
        confirmText={confirmBtnText}
        cancelText="Cancel"
        loading={confirmDialog.loading}
        variant="danger"
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialog.action === "delete-template" &&
          confirmDialog.template && (
            <div className="space-y-3 text-sm text-slate-600">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <span className="text-slate-500">Template</span>
                <span className="font-semibold text-slate-900">
                  {confirmDialog.template.name}
                </span>
              </div>
              {confirmDialog.template.project && (
                <div className="grid grid-cols-[110px_1fr] gap-3">
                  <span className="text-slate-500">Project</span>
                  <span className="font-semibold text-slate-700">
                    {confirmDialog.template.project}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <span className="text-slate-500">Scope</span>
                <span className="font-semibold text-slate-700">
                  {confirmDialog.template.scope}
                </span>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <span className="text-slate-500">Created by</span>
                <span className="text-slate-900">
                  {confirmDialog.template.created_by || "—"}
                </span>
              </div>
              <AlertBanner variant="error">
                This action cannot be undone.
              </AlertBanner>
            </div>
          )}
        {confirmDialog.action === "clear-template-content" && (
          <p className="text-sm text-slate-600">
            This will remove the current commands from the editor.
          </p>
        )}
        {confirmDialog.action === "clear-all-form" && (
          <p className="text-sm text-slate-600">
            This will clear the name, project, template content, variables
            and test results.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

// ── Confirm Dialog ──

function ConfirmDialog({
  open,
  title,
  children,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading = false,
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  variant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        </div>
        <div className="px-6 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 rounded-b-xl">
          <Btn
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              variant === "danger" &&
                "bg-red-600 hover:bg-red-700 border-red-600"
            )}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmText}
          </Btn>
        </div>
      </div>
    </div>
  );
}