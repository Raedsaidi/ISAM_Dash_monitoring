import React, { useEffect, useMemo, useState, useCallback } from "react";
import { cn } from "../utils/cn";
import { useAuth } from "../context/AuthContext";
import {
  X,
  Search,
  FileText,
  Globe,
  User,
  Edit3,
  Eye,
  Play,
  Save,
  Loader2,
  Trash2,
  RotateCcw,
  Cable,
  Clock,
  AlertCircle,
  CheckCircle2,
  Zap,
  Terminal,
  Network,
} from "lucide-react";
import { toast } from "sonner";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;

type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";
type TemplateScope = "GLOBAL" | "USER_INSTANCE";
type ProtocolPreference = "telnet" | "ssh" | "auto";
type StatusType = "active" | "inactive" | "error";
type ConfirmActionType = "clear-content" | "clear-all";

type TemplateOwnerFilter = "ALL" | "MINE";

interface IsamInstance {
  id: number;
  name: string;
  host: string;
  telnet_port: number;
  ssh_port: number;
  protocol_preference: ProtocolPreference;
  username: string;
  status: StatusType;
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
  created_at: string;
  updated_at: string;
}

interface WanTemplateListResponse {
  templates: WanTemplate[];
}

interface TemplateRenderResponse {
  variables_detected: string[];
  rendered_script: string;
  rendered_commands: string[];
}

interface ApplyWanTemplateResponse {
  success: boolean;
  protocol_used: string | null;
  commands_executed: string[];
  raw_output: string;
  message: string;
}

interface UserPort {
  id: number;
  label?: string | null;
  value: string;
}

interface MeResponse {
  id: number;
  username: string;
  role: UserRole;
  port_label?: string | null;
  port_value?: string | null;
  ports?: UserPort[];
}

interface CachedPortsResponse {
  success: boolean;
  protocol_used: string | null;
  port_count: number;
  ports: Array<{ port_id: string }>;
  raw_output: string;
  message: string;
  cached_at: string | null;
  last_refresh_at: string | null;
  last_refresh_success: boolean;
  last_refresh_error: string | null;
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
    // no json
  }

  if (!res.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      (Array.isArray(data) && data[0]?.msg) ||
      "Unknown error";
    throw new Error(detail);
  }

  return data as T;
}

function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let match: RegExpExecArray | null = null;
  const regex = /\[\[\$(.+?)\]\]/g;

  while ((match = regex.exec(template)) !== null) {
    const variable = match[1]?.trim();
    if (variable && !seen.has(variable)) {
      seen.add(variable);
      result.push(variable);
    }
  }

  return result;
}

function isPortVariable(name: string) {
  const v = name.trim().toLowerCase();
  return v === "port" || v === "port_id";
}

/** USER name auto => "username/baseName" */
function buildUserTemplateName(
  username: string | null | undefined,
  baseName: string,
) {
  const u = (username || "user").trim();
  const b = (baseName || "").trim();

  if (!b) return u;
  if (!u) return b;
  if (b.startsWith(`${u}/`)) return b;

  return `${u}/${b}`;
}

/* ================= UI Primitives ================= */

function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "info" | "success" | "warning" | "danger" | "purple";
  className?: string;
}) {
  const variants = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    purple: "bg-violet-50 text-violet-700 border-violet-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

function StatusDot({ status }: { status: StatusType }) {
  const colors = {
    active: "bg-emerald-500",
    inactive: "bg-amber-400",
    error: "bg-red-500",
  };

  return (
    <span className="relative flex h-2 w-2">
      <span
        className={cn(
          "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
          status === "active" ? colors[status] : "bg-transparent",
        )}
      />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", colors[status])} />
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
    <div className="flex items-center gap-3">
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
        {description && <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>}
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
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 border-slate-900 shadow-sm",
    outline: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    subtle: "bg-slate-100 text-slate-700 hover:bg-slate-200 border-transparent",
    danger: "bg-white text-red-600 hover:bg-red-50 border-red-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
  };

  const sizes = {
    sm: "px-2.5 py-1.5 text-xs gap-1.5",
    md: "px-3.5 py-2 text-sm gap-2",
  };

  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300",
        className,
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
        className,
      )}
    >
      {children}
    </select>
  );
}

function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[12px] leading-6 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300 font-mono",
        className,
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
        dark ? "border-slate-700 bg-[#0c1222] text-slate-300" : "border-slate-200 bg-slate-50 text-slate-800",
        className,
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
  const variants = {
    info: "border-sky-200 bg-sky-50 text-sky-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs", variants[variant])}>
      {variant === "error" && <AlertCircle size={14} className="mt-0.5 shrink-0" />}
      {variant === "success" && <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
      {variant === "warning" && <AlertCircle size={14} className="mt-0.5 shrink-0" />}
      {variant === "info" && <AlertCircle size={14} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
      {required && <span className="text-red-500">*</span>}
    </label>
  );
}

function MetadataChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">{value}</span>
    </div>
  );
}

/* ================= MAIN ================= */

export default function TemplateWorkspaceOverlay({
  instance,
  onClose,
}: {
  instance: IsamInstance;
  onClose: () => void;
}) {
  const { accessToken, user } = useAuth();
  const currentRole = (user?.role ?? "USER") as UserRole;
  const isUser = currentRole === "USER";
  const isAdmin = currentRole === "ADMIN" || currentRole === "SUPER_ADMIN";

  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [templateSearch, setTemplateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<TemplateOwnerFilter>("ALL");

  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [portsError, setPortsError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [commands, setCommands] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedPort, setSelectedPort] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const [previewState, setPreviewState] = useState<{
    loading: boolean;
    error: string | null;
    rendered_script: string;
    rendered_commands: string[];
  }>({
    loading: false,
    error: null,
    rendered_script: "",
    rendered_commands: [],
  });

  const [applyState, setApplyState] = useState<{
    loading: boolean;
    error: string | null;
    successMessage: string | null;
    protocol_used: string | null;
    commands_executed: string[];
    raw_output: string;
  }>({
    loading: false,
    error: null,
    successMessage: null,
    protocol_used: null,
    commands_executed: [],
    raw_output: "",
  });

  const [saving, setSaving] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: ConfirmActionType | null;
    title: string;
    description: string;
    confirmText: string;
  }>({
    open: false,
    action: null,
    title: "",
    description: "",
    confirmText: "Confirm",
  });

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const detectedVariables = useMemo(() => extractTemplateVariables(commands), [commands]);
  const customVariables = useMemo(() => detectedVariables.filter((v) => !isPortVariable(v)), [detectedVariables]);

  const currentPreviewFingerprint = useMemo(
    () => JSON.stringify({ commands, selectedPort, variableValues }),
    [commands, selectedPort, variableValues],
  );
  const [lastPreviewFingerprint, setLastPreviewFingerprint] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(templateSearch), 400);
    return () => clearTimeout(timer);
  }, [templateSearch]);

  const loadTemplates = useCallback(async () => {
    if (!accessToken) return;
    setLoadingTemplates(true);
    setTemplatesError(null);

    try {
      const params = new URLSearchParams();
      params.set("instance_id", String(instance.id));
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (ownerFilter === "MINE") params.set("mine", "true");

      const res = await authFetchJson<WanTemplateListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates?${params.toString()}`,
        accessToken,
      );
      setTemplates(res.templates || []);
    } catch (err: any) {
      setTemplatesError(err.message || "Failed to load templates.");
    } finally {
      setLoadingTemplates(false);
    }
  }, [accessToken, instance.id, debouncedSearch, ownerFilter]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    loadPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    if (selectedTemplateId === null) {
      setSelectedTemplateId(templates[0].id);
      return;
    }
    if (!templates.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate) return;

    const autoNameForUser = buildUserTemplateName(user?.username, selectedTemplate.name);
    setName(isUser ? autoNameForUser : selectedTemplate.name);

    setCommands(selectedTemplate.commands_template);
    setEditMode(false);
    resetExecutionStates();
    setLastPreviewFingerprint("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate, isUser, user?.username]);

  useEffect(() => {
    setVariableValues((prev) => {
      const next: Record<string, string> = {};
      customVariables.forEach((v) => (next[v] = prev[v] ?? ""));
      return next;
    });
  }, [customVariables]);

  function resetExecutionStates() {
    setPreviewState({ loading: false, error: null, rendered_script: "", rendered_commands: [] });
    setApplyState({ loading: false, error: null, successMessage: null, protocol_used: null, commands_executed: [], raw_output: "" });
  }

  function closeConfirmDialog() {
    setConfirmDialog({ open: false, action: null, title: "", description: "", confirmText: "Confirm" });
  }

  function openConfirmDialog(action: ConfirmActionType, title: string, description: string, confirmText: string) {
    setConfirmDialog({ open: true, action, title, description, confirmText });
  }

  function handleConfirmAction() {
    const action = confirmDialog.action;
    closeConfirmDialog();

    if (action === "clear-content") {
      setCommands("");
      resetExecutionStates();
      setLastPreviewFingerprint("");
      toast.success("Template content cleared.");
      return;
    }

    if (action === "clear-all") {
      if (selectedTemplate) {
        const autoNameForUser = buildUserTemplateName(user?.username, selectedTemplate.name);
        setName(isUser ? autoNameForUser : selectedTemplate.name);
        setCommands(selectedTemplate.commands_template);
        setEditMode(false);
      } else {
        setName("");
        setCommands("");
      }
      setSelectedPort(availablePorts[0] || "");
      setVariableValues({});
      resetExecutionStates();
      setLastPreviewFingerprint("");
      toast.success("Workspace reset.");
    }
  }

  async function loadPorts() {
    setLoadingPorts(true);
    setPortsError(null);

    try {
      if (isUser) {
        const me = await authFetchJson<MeResponse>(`${AUTH_BASE_URL}/api/v1/auth/me`, accessToken);
        let ports: string[] = (me.ports || []).map((p) => p.value).filter(Boolean);
        if (ports.length === 0 && me.port_value) ports = [me.port_value];
        setAvailablePorts(ports);
        if (ports.length > 0) setSelectedPort(ports[0]);
      } else {
        const res = await authFetchJson<CachedPortsResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/instances/${instance.id}/cached-ports`,
          accessToken,
        );
        const ports = (res.ports || []).map((p) => p.port_id).filter(Boolean);
        setAvailablePorts(ports);
        if (ports.length > 0) setSelectedPort(ports[0]);
      }
    } catch (err: any) {
      setPortsError(err.message || "Failed to load ports.");
    } finally {
      setLoadingPorts(false);
    }
  }

  async function handlePreview() {
    if (!selectedTemplate) {
      setPreviewState((s) => ({ ...s, error: "Please select a template first." }));
      return;
    }
    if (detectedVariables.some(isPortVariable) && !selectedPort) {
      setPreviewState((s) => ({ ...s, error: "Please select a port." }));
      return;
    }

    setPreviewState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await authFetchJson<TemplateRenderResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/render`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commands_template: commands,
            selected_port: selectedPort || null,
            variables: variableValues,
          }),
        },
      );

      setPreviewState({
        loading: false,
        error: null,
        rendered_script: res.rendered_script,
        rendered_commands: res.rendered_commands,
      });
      setLastPreviewFingerprint(currentPreviewFingerprint);
    } catch (err: any) {
      setPreviewState({
        loading: false,
        error: err.message || "Failed to render template.",
        rendered_script: "",
        rendered_commands: [],
      });
    }
  }

  async function handleApply() {
    if (!selectedTemplate) return;
    if (detectedVariables.some(isPortVariable) && !selectedPort) {
      setApplyState((s) => ({ ...s, error: "Please select a port." }));
      return;
    }
    if (lastPreviewFingerprint !== currentPreviewFingerprint) {
      setApplyState((s) => ({ ...s, error: "Please preview the current template version before applying." }));
      return;
    }

    setApplyState({ loading: true, error: null, successMessage: null, protocol_used: null, commands_executed: [], raw_output: "" });

    try {
      const res = await authFetchJson<ApplyWanTemplateResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/apply-live`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instance_id: instance.id,
            template_id: selectedTemplate.id,
            commands_template: commands,
            selected_port: selectedPort || null,
            variables: variableValues,
          }),
        },
      );

      setApplyState({
        loading: false,
        error: res.success ? null : res.message,
        successMessage: res.success ? res.message || "Applied successfully." : null,
        protocol_used: res.protocol_used,
        commands_executed: res.commands_executed || [],
        raw_output: res.raw_output || "",
      });

      if (res.success) toast.success(res.message || "Template applied.");
      else toast.error(res.message || "Template application failed.");
    } catch (err: any) {
      setApplyState({ loading: false, error: err.message, successMessage: null, protocol_used: null, commands_executed: [], raw_output: "" });
      toast.error(err.message || "Failed to apply template.");
    }
  }

  async function handleSave() {
    if (!selectedTemplate) return;
    if (!editMode) {
      toast.info('Click "Enable editing" first to modify.');
      return;
    }
    if (!commands.trim()) {
      toast.error("Template content is required.");
      return;
    }

    const finalName = isUser
      ? buildUserTemplateName(user?.username, selectedTemplate.name)
      : name.trim();

    if (!finalName) {
      toast.error("Template name is required.");
      return;
    }

    setSaving(true);

    try {
      let saved: WanTemplate;
      const isOwn =
        selectedTemplate.scope === "USER_INSTANCE" &&
        selectedTemplate.created_by === user?.username;

      if (isOwn || isAdmin) {
        saved = await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${selectedTemplate.id}`,
          accessToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: finalName, commands_template: commands }),
          },
        );
      } else {
        saved = await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: finalName,
              commands_template: commands,
              scope: "USER_INSTANCE",
              isam_instance_id: instance.id,
              source_template_id: selectedTemplate.id,
            }),
          },
        );
      }

      await loadTemplates();
      setSelectedTemplateId(saved.id);
      setEditMode(false);

      toast.success(isOwn || isAdmin ? "Template updated." : "Personal copy created.");
    } catch (err: any) {
      toast.error(err.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleClearContent() {
    if (!commands.trim()) return;
    openConfirmDialog("clear-content", "Clear template content?", "This will remove the current commands from the editor.", "Clear");
  }

  function handleClearAll() {
    openConfirmDialog("clear-all", "Reset workspace?", "This will reset editor, port, variables, preview and execution results.", "Reset");
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm p-3 sm:p-5">
        <div className="mx-auto flex h-[96vh] max-w-[1700px] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-3">
            <div className="flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white">
                <Network size={17} className="text-slate-600" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold tracking-tight text-slate-900">
                    Template Configuration
                  </h1>
                  <Badge variant="info">Workspace</Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <MetadataChip label="Instance" value={instance.name} />
                  <MetadataChip label="Host" value={instance.host} />
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={instance.status} />
                    <span className="text-[11px] text-slate-600 capitalize">{instance.status}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={isUser ? "info" : "purple"}>{currentRole.replace("_", " ")}</Badge>
              <div className="h-6 w-px bg-slate-200" />
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="flex flex-1 min-h-0">
            <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Templates</h2>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    {templates.length}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search..."
                      className="pl-9 pr-8 py-1.5 text-xs"
                    />
                    {loadingTemplates && debouncedSearch && (
                      <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                    )}
                  </div>

                  <Select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value as TemplateOwnerFilter)}
                    className="py-1.5 text-xs"
                  >
                    <option value="ALL">All templates</option>
                    <option value="MINE">My templates</option>
                  </Select>

                  <div className="text-[10px] text-slate-500">
                    {ownerFilter === "MINE"
                      ? "Showing only templates created by you."
                      : "Showing global + personal templates (depending on permissions)."}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loadingTemplates && templates.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-500">
                    <Loader2 size={13} className="animate-spin" />
                    Loading...
                  </div>
                )}

                {templatesError && (
                  <div className="mx-3 mt-3">
                    <AlertBanner variant="error">{templatesError}</AlertBanner>
                  </div>
                )}

                {!loadingTemplates &&
                  templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={cn(
                        "group flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left transition-colors",
                        selectedTemplateId === tpl.id
                          ? "bg-sky-50/80 border-l-2 border-l-sky-500"
                          : "hover:bg-slate-50 border-l-2 border-l-transparent",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px] font-semibold",
                            selectedTemplateId === tpl.id ? "text-sky-900" : "text-slate-800",
                          )}
                        >
                          {tpl.name}
                        </span>

                        {tpl.scope === "GLOBAL" ? (
                          <Globe size={12} className="shrink-0 text-violet-500" />
                        ) : (
                          <User size={12} className="shrink-0 text-sky-500" />
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>{tpl.created_by || "system"}</span>
                        <span>·</span>
                        <span>{new Date(tpl.updated_at).toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))}

                {!loadingTemplates && templates.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">
                    {debouncedSearch
                      ? `No match for "${debouncedSearch}".`
                      : ownerFilter === "MINE"
                        ? "No personal templates found."
                        : "No templates found."}
                  </div>
                )}
              </div>
            </aside>

            <main className="flex flex-1 flex-col min-w-0">
              {!selectedTemplate ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                  <FileText size={36} strokeWidth={1.2} />
                  <p className="text-sm">Select a template from the sidebar.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 xl:divide-x xl:divide-slate-200 min-h-full">
                    <div className="space-y-0 divide-y divide-slate-200">
                      <div className="p-5">
                        <SectionTitle
                          icon={FileText}
                          title={selectedTemplate.name}
                          description={`Scope: ${selectedTemplate.scope} · By ${selectedTemplate.created_by || "system"} · Updated ${new Date(selectedTemplate.updated_at).toLocaleString()}`}
                          badge={
                            <Badge variant={selectedTemplate.scope === "GLOBAL" ? "purple" : "info"}>
                              {selectedTemplate.scope === "GLOBAL" ? (
                                <>
                                  <Globe size={10} /> Global
                                </>
                              ) : (
                                <>
                                  <User size={10} /> Personal
                                </>
                              )}
                            </Badge>
                          }
                        />

                        <div className="mt-3">
                          <Btn
                            size="sm"
                            variant={editMode ? "subtle" : "outline"}
                            onClick={() => setEditMode(true)}
                            disabled={editMode}
                          >
                            <Edit3 size={13} />
                            {editMode ? "Editing enabled" : "Enable editing"}
                          </Btn>
                        </div>
                      </div>

                      {/* NAME disabled for USER */}
                      <div className="p-5">
                        <FieldLabel>Template Name</FieldLabel>
                        <Input
                          value={name}
                          onChange={(e) => {
                            if (!isUser) setName(e.target.value);
                          }}
                          disabled={!editMode || isUser}
                          className={cn((!editMode || isUser) && "cursor-not-allowed bg-slate-50 text-slate-500")}
                        />
                        {isUser && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            Name is generated automatically as:{" "}
                            <span className="font-mono text-slate-700">{name}</span>
                          </div>
                        )}
                      </div>

                      <div className="p-5">
                        <div className="flex items-center justify-between mb-1.5">
                          <FieldLabel required>Commands Template</FieldLabel>
                          <Btn size="sm" variant="danger" onClick={handleClearContent} disabled={!editMode || !commands.trim()}>
                            <Trash2 size={12} />
                            Clear
                          </Btn>
                        </div>

                        <Textarea
                          value={commands}
                          onChange={(e) => setCommands(e.target.value)}
                          disabled={!editMode}
                          rows={14}
                          className={cn(!editMode && "cursor-not-allowed bg-slate-50 text-slate-500")}
                        />

                        {detectedVariables.length > 0 && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                              Detected Variables
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {detectedVariables.map((v) => (
                                <span
                                  key={v}
                                  className={cn(
                                    "rounded border px-2 py-0.5 font-mono text-[11px]",
                                    isPortVariable(v)
                                      ? "border-sky-200 bg-sky-50 text-sky-700"
                                      : "border-slate-200 bg-white text-slate-600",
                                  )}
                                >
                                  {isPortVariable(v) && <Cable size={10} className="mr-1 inline" />}
                                  [[${v}]]
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-5 space-y-4">
                        <SectionTitle
                          icon={Cable}
                          title="Input Variables"
                          description="Select the target port and fill custom placeholders."
                        />

                        <div>
                          <FieldLabel required>Select Port</FieldLabel>
                          <Select
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            disabled={loadingPorts || availablePorts.length === 0}
                          >
                            <option value="">— Select port —</option>
                            {availablePorts.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </Select>

                          {loadingPorts && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <Loader2 size={11} className="animate-spin" /> Loading ports...
                            </div>
                          )}
                          {portsError && (
                            <div className="mt-1.5">
                              <AlertBanner variant="error">{portsError}</AlertBanner>
                            </div>
                          )}
                        </div>

                        {customVariables.length > 0 && (
                          <div>
                            <FieldLabel>Custom Variables</FieldLabel>
                            <div className="grid grid-cols-2 gap-3">
                              {customVariables.map((v) => (
                                <div key={v}>
                                  <label className="mb-1 block text-[11px] font-medium text-slate-600">{v}</label>
                                  <Input
                                    value={variableValues[v] ?? ""}
                                    onChange={(e) =>
                                      setVariableValues((prev) => ({ ...prev, [v]: e.target.value }))
                                    }
                                    className="py-1.5 text-xs"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-2">
                          <Btn onClick={handlePreview} disabled={previewState.loading}>
                            {previewState.loading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                            Preview
                          </Btn>

                          <Btn variant="primary" onClick={handleApply} disabled={applyState.loading}>
                            {applyState.loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            Apply to Port
                          </Btn>

                          <Btn onClick={handleSave} disabled={saving || !editMode}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {selectedTemplate.scope === "USER_INSTANCE" && selectedTemplate.created_by === user?.username
                              ? "Save"
                              : isAdmin
                                ? "Save"
                                : "Save Copy"}
                          </Btn>

                          <div className="flex-1" />

                          <Btn variant="danger" size="sm" onClick={handleClearAll}>
                            <RotateCcw size={13} />
                            Reset
                          </Btn>
                        </div>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 bg-slate-50/40">
                      <div className="p-5">
                        <SectionTitle icon={Eye} title="Rendered Preview" description="Preview commands before execution." />
                        <div className="mt-3">
                          {previewState.error && (
                            <div className="mb-3">
                              <AlertBanner variant="error">{previewState.error}</AlertBanner>
                            </div>
                          )}
                          {previewState.rendered_commands.length > 0 ? (
                            <CodeViewer maxHeight="400px">{previewState.rendered_commands.join("\n")}</CodeViewer>
                          ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center">
                              <Eye size={24} strokeWidth={1.2} className="text-slate-300 mb-2" />
                              <p className="text-xs text-slate-500">
                                Fill variables, then click <strong>Preview</strong>.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-5">
                        <SectionTitle icon={Terminal} title="Execution Result" description="Live device response and command trace." />
                        <div className="mt-3 space-y-3">
                          {applyState.error && <AlertBanner variant="error">{applyState.error}</AlertBanner>}
                          {applyState.successMessage && <AlertBanner variant="success">{applyState.successMessage}</AlertBanner>}

                          {applyState.protocol_used && (
                            <div className="flex items-center gap-2">
                              <Badge variant="success">
                                <Zap size={10} />
                                {applyState.protocol_used.toUpperCase()}
                              </Badge>
                            </div>
                          )}

                          {applyState.commands_executed.length > 0 && (
                            <div>
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Commands Executed
                              </div>
                              <CodeViewer dark maxHeight="160px">
                                {applyState.commands_executed.join("\n")}
                              </CodeViewer>
                            </div>
                          )}

                          {applyState.raw_output ? (
                            <div>
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Raw Output
                              </div>
                              <CodeViewer dark maxHeight="260px">{applyState.raw_output}</CodeViewer>
                            </div>
                          ) : (
                            !applyState.error &&
                            !applyState.successMessage && (
                              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white py-10 text-center">
                                <Terminal size={24} strokeWidth={1.2} className="text-slate-300 mb-2" />
                                <p className="text-xs text-slate-500">No execution yet.</p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </div>

          <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-5 py-2.5">
            <div className="flex items-center gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <Clock size={11} />
                {templates.length} template{templates.length !== 1 ? "s" : ""}
              </span>
              <span>·</span>
              <span>
                {availablePorts.length} port{availablePorts.length !== 1 ? "s" : ""} available
              </span>
            </div>

            <div className="text-[11px] text-slate-400">ISAM Template Manager v1.0</div>
          </footer>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText="Cancel"
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmAction}
      />
    </>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
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

        <div className="px-6 py-4">
          <p className="text-sm text-slate-600">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 rounded-b-xl">
          <Btn variant="outline" size="sm" onClick={onCancel}>
            {cancelText}
          </Btn>
          <Btn variant="primary" size="sm" onClick={onConfirm}>
            {confirmText}
          </Btn>
        </div>
      </div>
    </div>
  );
}