import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { cn } from "../utils/cn";
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
} from "lucide-react";
import { toast } from "sonner";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

type StatusType = "active" | "inactive" | "error";
type ProtocolPreference = "telnet" | "ssh" | "auto";
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

interface IsamInstanceListResponse {
  instances: IsamInstance[];
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

interface WanTemplateSavePayload {
  name: string;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id?: number | null;
  source_template_id?: number | null;
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

const EMPTY_CONFIRM_DIALOG: ConfirmDialogState = {
  open: false,
  action: null,
  template: null,
  loading: false,
};

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

/* ================================================================
   UI PRIMITIVES — Enterprise style (same spirit as your “B”)
   ================================================================ */

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
  const variants = {
    primary:
      "bg-slate-900 text-white hover:bg-slate-800 border-slate-900 shadow-sm",
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

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
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

function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
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
        dark
          ? "border-slate-700 bg-[#0c1222] text-slate-300"
          : "border-slate-200 bg-slate-50 text-slate-800",
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
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
        variants[variant],
      )}
    >
      {variant === "error" && (
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
      )}
      {variant === "success" && (
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
      )}
      {variant === "warning" && (
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
      )}
      {variant === "info" && (
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
      )}
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

/* ================================================================
   MAIN COMPONENT
   ================================================================ */

export default function WanTemplatesSection() {
  const { accessToken } = useAuth();

  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WanTemplate | null>(null);

  const [name, setName] = useState("");
  const [commandsTemplate, setCommandsTemplate] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );
  const [testInstanceId, setTestInstanceId] = useState<number | "">("");
  const [testPort, setTestPort] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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

  const [testState, setTestState] = useState<{
    loading: boolean;
    success: boolean;
    error: string | null;
    protocol_used: string | null;
    raw_output: string;
    rendered_commands: string[];
    message: string | null;
  }>({
    loading: false,
    success: false,
    error: null,
    protocol_used: null,
    raw_output: "",
    rendered_commands: [],
    message: null,
  });

  const [submitting, setSubmitting] = useState(false);

  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState>(EMPTY_CONFIRM_DIALOG);

  useEffect(() => {
    if (!accessToken) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const detectedVariables = useMemo(
    () => extractTemplateVariables(commandsTemplate),
    [commandsTemplate],
  );

  const customVariables = useMemo(
    () => detectedVariables.filter((v) => !isPortVariable(v)),
    [detectedVariables],
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;

    return templates.filter((t) => {
      const appliesTo =
        t.scope === "GLOBAL"
          ? "global"
          : `${t.isam_instance_id ?? ""} ${instanceNameFromList(
              instances,
              t.isam_instance_id,
            )}`;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.created_by || "").toLowerCase().includes(q) ||
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
      const [instRes, tplRes] = await Promise.all([
        authFetchJson<IsamInstanceListResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/instances`,
          accessToken,
        ),
        authFetchJson<WanTemplateListResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
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
    setCommandsTemplate("");
    setVariableValues({});
    setTestInstanceId("");
    setTestPort("");
    setFormError(null);
    resetStatesOnly();
  }

  function closeConfirmDialog() {
    if (confirmDialog.loading) return;
    setConfirmDialog(EMPTY_CONFIRM_DIALOG);
  }

  function openCreateModal() {
    resetModalState();
    setShowModal(true);
  }

  function openEditModal(template: WanTemplate) {
    resetModalState();
    setEditingTemplate(template);
    setName(template.name);
    setCommandsTemplate(template.commands_template);

    if (template.scope === "USER_INSTANCE" && template.isam_instance_id) {
      setTestInstanceId(template.isam_instance_id);
    }

    setShowModal(true);
  }

  function openDeleteDialog(template: WanTemplate) {
    setConfirmDialog({
      open: true,
      action: "delete-template",
      template,
      loading: false,
    });
  }

  function openClearTemplateContentDialog() {
    setConfirmDialog({
      open: true,
      action: "clear-template-content",
      template: null,
      loading: false,
    });
  }

  function openClearAllFormDialog() {
    setConfirmDialog({
      open: true,
      action: "clear-all-form",
      template: null,
      loading: false,
    });
  }

  async function handlePreview() {
    setFormError(null);

    if (!commandsTemplate.trim()) {
      setFormError("Commands template is required.");
      return;
    }

    if (detectedVariables.some(isPortVariable) && !testPort.trim()) {
      setFormError(
        "Test port is required for preview because the template uses [[$port]].",
      );
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
            commands_template: commandsTemplate,
            selected_port: testPort.trim() || null,
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
    } catch (err: any) {
      setPreviewState({
        loading: false,
        error: err.message || "Failed to render template.",
        rendered_script: "",
        rendered_commands: [],
      });
    }
  }

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

    if (detectedVariables.some(isPortVariable) && !testPort.trim()) {
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

    const toastId = toast.loading("Testing template on ISAM...");

    try {
      const res = await authFetchJson<TemplateTestResponse>(
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
        },
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

      if (res.success) toast.success(res.message || "Template test OK.", { id: toastId });
      else toast.error(res.message || "Template test failed.", { id: toastId });
    } catch (err: any) {
      setTestState({
        loading: false,
        success: false,
        error: err.message || "Failed to test template.",
        protocol_used: null,
        raw_output: "",
        rendered_commands: [],
        message: null,
      });

      toast.error(err.message || "Failed to test template.", { id: toastId });
    }
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!canSave) {
      setFormError("Template name and content are required.");
      return;
    }

    const isEditing = Boolean(editingTemplate);
    setSubmitting(true);

    try {
      if (editingTemplate) {
        await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${editingTemplate.id}`,
          accessToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              commands_template: commandsTemplate,
            }),
          },
        );
      } else {
        const payload: WanTemplateSavePayload = {
          name: name.trim(),
          commands_template: commandsTemplate,
          scope: "GLOBAL",
          isam_instance_id: null,
        };

        await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
      }

      await loadData();
      setShowModal(false);
      resetModalState();

      toast.success(
        isEditing ? "Template updated successfully." : "Template created successfully.",
      );
    } catch (err: any) {
      setFormError(err.message || "Failed to save template.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteTemplate(t: WanTemplate) {
    openDeleteDialog(t);
  }

  function handleClearTemplateContent() {
    if (!commandsTemplate.trim()) return;
    openClearTemplateContentDialog();
  }

  function handleClearAllForm() {
    openClearAllFormDialog();
  }

  async function handleConfirmDialog() {
    const { action, template } = confirmDialog;
    if (!action) return;

    if (action === "clear-template-content") {
      setCommandsTemplate("");
      resetStatesOnly();
      setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      toast.success("Template content has been cleared.");
      return;
    }

    if (action === "clear-all-form") {
      resetModalState();
      setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      toast.success("The form has been cleared.");
      return;
    }

    if (action === "delete-template" && template) {
      setConfirmDialog((prev) => ({ ...prev, loading: true }));
      const toastId = toast.loading("Deleting template...");

      try {
        await authFetchJson<void>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${template.id}`,
          accessToken,
          { method: "DELETE" },
        );

        await loadData();

        if (editingTemplate?.id === template.id) {
          setShowModal(false);
          resetModalState();
        }

        toast.success("Template deleted.", { id: toastId });
      } catch (err: any) {
        toast.error(err.message || "Failed to delete template.", { id: toastId });
      } finally {
        setConfirmDialog(EMPTY_CONFIRM_DIALOG);
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

  const confirmText =
    confirmDialog.action === "delete-template"
      ? "Delete"
      : confirmDialog.action === "clear-template-content"
        ? "Clear"
        : confirmDialog.action === "clear-all-form"
          ? "Reset"
          : "Confirm";

  /* ================================================================
     RENDER
     ================================================================ */

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">WAN Templates</h2>
                <Badge variant="info">Admin</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Manage templates. Preview and test are optional but recommended.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Btn variant="outline" onClick={loadData} disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
                Refresh
              </Btn>
              <Btn variant="primary" onClick={openCreateModal}>
                <Plus size={16} />
                Add Global Template
              </Btn>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50/70 p-4">
            <div className="relative max-w-md">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                type="text"
                placeholder="Search by name, creator, or applies-to..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {globalError && <AlertBanner variant="error">{globalError}</AlertBanner>}

        {/* Table */}
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
              <Loader2 size={16} className="animate-spin" />
              Loading templates...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Template
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Scope
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Applies To
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Creator
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Updated
                    </th>
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
                          <ScopeBadge scope={t.scope} />
                        </td>

                        <td className="px-5 py-4 align-top text-slate-700">
                          {t.scope === "GLOBAL"
                            ? "All ISAM"
                            : instanceNameFromList(instances, t.isam_instance_id)}
                        </td>

                        <td className="px-5 py-4 align-top text-slate-700">
                          {t.created_by || "—"}
                        </td>

                        <td className="px-5 py-4 align-top text-xs text-slate-500">
                          {new Date(t.updated_at).toLocaleString()}
                        </td>

                        <td className="px-5 py-4 align-top text-right">
                          <div className="inline-flex items-center gap-2">
                            <Btn size="sm" variant="outline" onClick={() => openEditModal(t)}>
                              <Edit size={14} />
                              Edit
                            </Btn>
                            <Btn size="sm" variant="danger" onClick={() => handleDeleteTemplate(t)}>
                              <Trash2 size={14} />
                              Delete
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTemplates.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
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

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm p-4">
            <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[92vh] overflow-y-auto">
              {/* Modal top bar */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
                <SectionTitle
                  icon={editingTemplate ? Edit : Plus}
                  title={editingTemplate ? "Edit Template" : "Create Global Template"}
                  description="Preview & Test are optional (recommended before saving)."
                  badge={
                    <ScopeBadge scope={editingTemplate?.scope ?? "GLOBAL"} />
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

              <form onSubmit={handleSaveTemplate} className="p-6 space-y-6">
                {formError && <AlertBanner variant="error">{formError}</AlertBanner>}

                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                  {/* Left: Definition */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50/70 p-4">
                      <SectionTitle
                        icon={FileText}
                        title="Template Definition"
                        description="Name + commands template."
                      />
                    </div>

                    <div className="p-5 space-y-4">
                      <div>
                        <FieldLabel required>Template Name</FieldLabel>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Example: FTTH activation"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {editingTemplate?.scope === "USER_INSTANCE" && (
                          <Badge variant="default">
                            <Server size={12} />
                            {instanceNameFromList(instances, editingTemplate.isam_instance_id)}
                          </Badge>
                        )}
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <FieldLabel required>Commands Template</FieldLabel>
                          <Btn
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={handleClearTemplateContent}
                            disabled={!commandsTemplate.trim()}
                          >
                            <Trash2 size={13} />
                            Clear
                          </Btn>
                        </div>

                        <Textarea
                          value={commandsTemplate}
                          onChange={(e) => setCommandsTemplate(e.target.value)}
                          rows={14}
                          placeholder={`configure equipment ont interface [[$port]] admin-state down
configure equipment ont no interface [[$port]]
configure equipment ont interface [[$port]] desc1 [[$desc]] sernum [[$serial_number]]
configure equipment ont interface [[$port]] admin-state up`}
                        />

                        <div className="mt-2 text-[11px] text-slate-500">
                          Variable format:{" "}
                          <span className="font-mono">[[$port]]</span>,{" "}
                          <span className="font-mono">[[$desc]]</span>,{" "}
                          <span className="font-mono">[[$serial_number]]</span>
                        </div>
                      </div>

                      {/* Detected variables */}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Detected variables
                        </div>

                        {detectedVariables.length === 0 ? (
                          <div className="text-xs text-slate-500">No variables detected.</div>
                        ) : (
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
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Preview & Test */}
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
                              setTestInstanceId(e.target.value ? Number(e.target.value) : "")
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
                          <FieldLabel required={detectedVariables.some(isPortVariable)}>
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
                                    setVariableValues((prev) => ({
                                      ...prev,
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
                            <Loader2 size={14} className="animate-spin" />
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
                          title={!testInstanceId ? "Select an ISAM to enable test" : undefined}
                        >
                          {testState.loading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          Test on ISAM
                        </Btn>
                      </div>

                      {/* Preview output */}
                      {previewState.error && (
                        <AlertBanner variant="error">{previewState.error}</AlertBanner>
                      )}

                      {previewState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="info">
                              <Eye size={12} />
                              Preview
                            </Badge>
                          </div>
                          <CodeViewer maxHeight="220px">
                            {previewState.rendered_commands.join("\n")}
                          </CodeViewer>
                        </div>
                      )}

                      {/* Test messages */}
                      {(testState.error || testState.message) && (
                        <AlertBanner variant={testState.success ? "success" : "error"}>
                          {testState.error || testState.message}
                        </AlertBanner>
                      )}

                      {/* Tested commands */}
                      {testState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={testState.success ? "success" : "warning"}>
                              <Play size={12} />
                              Tested Commands
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

                      {/* Raw output */}
                      {testState.raw_output && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="default">
                              <Terminal size={12} />
                              ISAM Output
                            </Badge>
                          </div>
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
                            Template not tested yet. You can save it, but testing is recommended.
                          </AlertBanner>
                        )}
                    </div>
                  </div>
                </div>

                {/* Modal actions */}
                <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4">
                  <div className="flex items-center gap-2">
                    <Btn
                      type="button"
                      variant="danger"
                      onClick={handleClearAllForm}
                    >
                      <RotateCcw size={16} />
                      Clear All
                    </Btn>
                  </div>

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

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmTitle}
        confirmText={confirmText}
        cancelText="Cancel"
        loading={confirmDialog.loading}
        variant="danger"
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialog.action === "delete-template" && confirmDialog.template && (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Template</span>
              <span className="font-semibold text-slate-900">
                {confirmDialog.template.name}
              </span>
            </div>

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

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Applies to</span>
              <span className="text-slate-900">
                {confirmDialog.template.scope === "GLOBAL"
                  ? "All ISAM"
                  : instanceNameFromList(
                      instances,
                      confirmDialog.template.isam_instance_id,
                    )}
              </span>
            </div>

            <AlertBanner variant="error">This action cannot be undone.</AlertBanner>
          </div>
        )}

        {confirmDialog.action === "clear-template-content" && (
          <p className="text-sm text-slate-600">
            This will remove the current commands from the editor.
          </p>
        )}

        {confirmDialog.action === "clear-all-form" && (
          <p className="text-sm text-slate-600">
            This will clear the name, template content, variables and test results.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/* ================================================================
   CONFIRM DIALOG — Enterprise style (supports loading)
   ================================================================ */

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
          <Btn variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Btn>

          <Btn
            variant={variant === "danger" ? "primary" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className={cn(variant === "danger" && "bg-red-600 hover:bg-red-700 border-red-600")}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmText}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function instanceNameFromList(
  instances: IsamInstance[],
  id: number | null | undefined,
) {
  if (!id) return "All ISAM";
  const found = instances.find((i) => i.id === id);
  return found ? `${found.name} (${found.host})` : `ISAM #${id}`;
}