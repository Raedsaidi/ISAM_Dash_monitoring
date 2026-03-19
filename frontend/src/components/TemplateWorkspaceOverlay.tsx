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
} from "lucide-react";
import { toast } from "sonner";

const ISAM_BASE_URL = "http://127.0.0.1:8001";
const AUTH_BASE_URL = "http://127.0.0.1:9000";

type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";
type TemplateScope = "GLOBAL" | "USER_INSTANCE";
type ProtocolPreference = "telnet" | "ssh" | "auto";
type StatusType = "active" | "inactive" | "error";
type ConfirmActionType = "clear-content" | "clear-all";

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

function ScopeBadge({ scope }: { scope: TemplateScope }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        scope === "GLOBAL"
          ? "bg-violet-100 text-violet-700"
          : "bg-blue-100 text-blue-700",
      )}
    >
      {scope === "GLOBAL" ? <Globe size={12} /> : <User size={12} />}
      {scope === "GLOBAL" ? "Global" : "My template"}
    </span>
  );
}

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

  /* ---------- templates ---------- */
  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  /* ---------- search (server-side with debounce) ---------- */
  const [templateSearch, setTemplateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  /* ---------- ports ---------- */
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);
  const [portsError, setPortsError] = useState<string | null>(null);

  /* ---------- editor state ---------- */
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [name, setName] = useState("");
  const [commands, setCommands] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedPort, setSelectedPort] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );

  /* ---------- preview / apply ---------- */
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

  /* ---------- confirm dialog ---------- */
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

  /* ---------- derived ---------- */

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const detectedVariables = useMemo(
    () => extractTemplateVariables(commands),
    [commands],
  );

  const customVariables = useMemo(
    () => detectedVariables.filter((v) => !isPortVariable(v)),
    [detectedVariables],
  );

  const currentPreviewFingerprint = useMemo(
    () => JSON.stringify({ commands, selectedPort, variableValues }),
    [commands, selectedPort, variableValues],
  );

  const [lastPreviewFingerprint, setLastPreviewFingerprint] = useState("");

  /* ---------- debounce search (400ms) ---------- */

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(templateSearch), 400);
    return () => clearTimeout(timer);
  }, [templateSearch]);

  /* ---------- load templates (re-fires when search changes) ---------- */

  const loadTemplates = useCallback(async () => {
    if (!accessToken) return;

    setLoadingTemplates(true);
    setTemplatesError(null);

    try {
      const params = new URLSearchParams();
      params.set("instance_id", String(instance.id));

      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }

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
  }, [accessToken, instance.id, debouncedSearch]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  /* ---------- load ports on mount ---------- */

  useEffect(() => {
    loadPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  /* ---------- auto-select first template ---------- */

  useEffect(() => {
    if (templates.length > 0 && selectedTemplateId === null) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  /* ---------- sync editor with selected template ---------- */

  useEffect(() => {
    if (!selectedTemplate) return;

    setName(selectedTemplate.name);
    setCommands(selectedTemplate.commands_template);
    setEditMode(false);
    resetExecutionStates();
    setLastPreviewFingerprint("");
  }, [selectedTemplate]);

  /* ---------- sync variable fields ---------- */

  useEffect(() => {
    setVariableValues((prev) => {
      const next: Record<string, string> = {};
      customVariables.forEach((v) => {
        next[v] = prev[v] ?? "";
      });
      return next;
    });
  }, [customVariables]);

  /* ---------- helpers ---------- */

  function resetExecutionStates() {
    setPreviewState({
      loading: false,
      error: null,
      rendered_script: "",
      rendered_commands: [],
    });

    setApplyState({
      loading: false,
      error: null,
      successMessage: null,
      protocol_used: null,
      commands_executed: [],
      raw_output: "",
    });
  }

  function closeConfirmDialog() {
    setConfirmDialog({
      open: false,
      action: null,
      title: "",
      description: "",
      confirmText: "Confirm",
    });
  }

  function openConfirmDialog(
    action: ConfirmActionType,
    title: string,
    description: string,
    confirmText: string,
  ) {
    setConfirmDialog({
      open: true,
      action,
      title,
      description,
      confirmText,
    });
  }

  function handleConfirmAction() {
    const action = confirmDialog.action;
    closeConfirmDialog();

    if (action === "clear-content") {
      setCommands("");
      resetExecutionStates();
      setLastPreviewFingerprint("");
      toast.success("Template content has been cleared.");
      return;
    }

    if (action === "clear-all") {
      if (selectedTemplate) {
        setName(selectedTemplate.name);
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

      toast.success("The current workspace has been reset.");
    }
  }

  async function loadPorts() {
    setLoadingPorts(true);
    setPortsError(null);

    try {
      if (isUser) {
        const me = await authFetchJson<MeResponse>(
          `${AUTH_BASE_URL}/api/v1/auth/me`,
          accessToken,
        );

        let ports: string[] = (me.ports || [])
          .map((p) => p.value)
          .filter(Boolean);

        if (ports.length === 0 && me.port_value) {
          ports = [me.port_value];
        }

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

  /* ---------- preview ---------- */

  async function handlePreview() {
    if (!selectedTemplate) {
      setPreviewState((s) => ({
        ...s,
        error: "Please select a template first.",
      }));
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

  /* ---------- apply ---------- */

  async function handleApply() {
    if (!selectedTemplate) return;

    if (detectedVariables.some(isPortVariable) && !selectedPort) {
      setApplyState((s) => ({ ...s, error: "Please select a port." }));
      return;
    }

    if (lastPreviewFingerprint !== currentPreviewFingerprint) {
      setApplyState((s) => ({
        ...s,
        error: "Please preview the current template version before applying.",
      }));
      return;
    }

    setApplyState({
      loading: true,
      error: null,
      successMessage: null,
      protocol_used: null,
      commands_executed: [],
      raw_output: "",
    });

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
        successMessage: res.success
          ? res.message || "Applied successfully."
          : null,
        protocol_used: res.protocol_used,
        commands_executed: res.commands_executed || [],
        raw_output: res.raw_output || "",
      });

      if (res.success) {
        toast.success(res.message || "Template applied successfully.");
      } else {
        toast.error(res.message || "Template application failed.");
      }
    } catch (err: any) {
      setApplyState({
        loading: false,
        error: err.message || "Failed to apply template.",
        successMessage: null,
        protocol_used: null,
        commands_executed: [],
        raw_output: "",
      });

      toast.error(err.message || "Failed to apply template.");
    }
  }

  /* ---------- save ---------- */

  async function handleSave() {
    if (!selectedTemplate) return;

    if (!editMode) {
      toast.info('Click "Modify" first to enable editing.');
      return;
    }

    if (!name.trim() || !commands.trim()) {
      toast.error("Template name and content are required.");
      return;
    }

    setSaving(true);

    try {
      let saved: WanTemplate;

      const isOwnTemplate =
        selectedTemplate.scope === "USER_INSTANCE" &&
        selectedTemplate.created_by === user?.username;

      if (isOwnTemplate || isAdmin) {
        saved = await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${selectedTemplate.id}`,
          accessToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              commands_template: commands,
            }),
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
              name: name.trim(),
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

      toast.success(
        isOwnTemplate || isAdmin
          ? "The template has been updated."
          : "A personal copy has been created for this ISAM.",
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------- clear / reset ---------- */

  function handleClearContent() {
    if (!commands.trim()) return;

    openConfirmDialog(
      "clear-content",
      "Clear template content?",
      "This will remove the current commands from the editor.",
      "Yes, clear",
    );
  }

  function handleClearAll() {
    openConfirmDialog(
      "clear-all",
      "Reset current workspace?",
      "This will clear the editor, selected port, variables, preview and execution result.",
      "Yes, reset",
    );
  }

  /* ========== RENDER ========== */

  return (
    <>
      <div className="fixed inset-0 bg-slate-950/30 backdrop-blur-[2px] z-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl h-[92vh] max-w-7xl mx-auto overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] h-full">
            {/* ---- Sidebar ---- */}
            <div className="border-r border-slate-200 bg-slate-50/70 flex flex-col">
              <div className="p-4 border-b border-slate-200">
                <div className="mb-3">
                  <h3 className="font-semibold text-slate-900">Templates</h3>
                  <p className="text-xs text-slate-500">
                    Available for {instance.name}
                  </p>
                </div>

                <div className="relative">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search template..."
                    className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  {loadingTemplates && debouncedSearch && (
                    <Loader2
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin"
                    />
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-3 space-y-2">
                {loadingTemplates && templates.length === 0 && (
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading templates...
                  </div>
                )}

                {templatesError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {templatesError}
                  </div>
                )}

                {!loadingTemplates &&
                  templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={cn(
                        "w-full text-left rounded-2xl border p-3 transition-all",
                        selectedTemplateId === tpl.id
                          ? "border-blue-500 bg-blue-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {tpl.name}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {tpl.created_by || "—"}
                          </div>
                        </div>

                        <ScopeBadge scope={tpl.scope} />
                      </div>

                      <div className="mt-2 text-[11px] text-slate-400">
                        {new Date(tpl.updated_at).toLocaleString()}
                      </div>
                    </button>
                  ))}

                {!loadingTemplates && templates.length === 0 && (
                  <div className="text-xs text-slate-500 text-center py-4">
                    {debouncedSearch
                      ? `No templates matching "${debouncedSearch}".`
                      : "No templates found."}
                  </div>
                )}
              </div>
            </div>

            {/* ---- Main ---- */}
            <div className="flex flex-col min-h-0">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Template Configuration Workspace
                  </h2>
                  <p className="text-sm text-slate-500">
                    Instance: {instance.name} ({instance.host})
                  </p>
                </div>

                <button
                  onClick={onClose}
                  className="h-10 w-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                >
                  <X size={16} />
                </button>
              </div>

              {!selectedTemplate ? (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                  Select a template from the left panel.
                </div>
              ) : (
                <div className="flex-1 overflow-auto p-6 space-y-6">
                  <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                    {/* Editor */}
                    <div className="space-y-5">
                      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <FileText size={18} className="text-blue-600" />
                              <h3 className="font-semibold text-slate-900">
                                Template Editor
                              </h3>
                            </div>
                            <p className="text-xs text-slate-500">
                              Click Modify to enable editing.
                            </p>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <ScopeBadge scope={selectedTemplate.scope} />
                            <button
                              type="button"
                              onClick={() => setEditMode(true)}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
                            >
                              <Edit3 size={14} />
                              Modify
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            Template Name
                          </label>
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={!editMode}
                            className={cn(
                              "w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2",
                              editMode
                                ? "border-slate-300 focus:ring-blue-500 bg-white"
                                : "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed",
                            )}
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                            <label className="block text-sm font-medium text-slate-700">
                              Commands Template
                            </label>
                            <button
                              type="button"
                              onClick={handleClearContent}
                              disabled={!editMode || !commands.trim()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Trash2 size={13} />
                              Clear
                            </button>
                          </div>

                          <textarea
                            value={commands}
                            onChange={(e) => setCommands(e.target.value)}
                            disabled={!editMode}
                            rows={16}
                            className={cn(
                              "w-full border rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 whitespace-pre-wrap",
                              editMode
                                ? "border-slate-300 focus:ring-blue-500 bg-white"
                                : "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed",
                            )}
                          />
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                        <div className="flex items-center gap-2">
                          <Cable size={18} className="text-emerald-600" />
                          <h3 className="font-semibold text-slate-900">
                            Input Variables
                          </h3>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            Select Port
                          </label>
                          <select
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={loadingPorts || availablePorts.length === 0}
                          >
                            <option value="">Choose a port...</option>
                            {availablePorts.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>

                          {loadingPorts && (
                            <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                              <Loader2 size={12} className="animate-spin" />
                              Loading ports...
                            </div>
                          )}

                          {portsError && (
                            <div className="text-xs text-red-600 mt-2">
                              {portsError}
                            </div>
                          )}
                        </div>

                        {customVariables.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {customVariables.map((v) => (
                              <div key={v}>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                  {v}
                                </label>
                                <input
                                  value={variableValues[v] ?? ""}
                                  onChange={(e) =>
                                    setVariableValues((prev) => ({
                                      ...prev,
                                      [v]: e.target.value,
                                    }))
                                  }
                                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-slate-500">
                            No extra variables detected in this template.
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            type="button"
                            onClick={handlePreview}
                            disabled={previewState.loading}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                          >
                            {previewState.loading ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Eye size={16} />
                            )}
                            Show Preview
                          </button>

                          <button
                            type="button"
                            onClick={handleApply}
                            disabled={applyState.loading}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:opacity-60"
                          >
                            {applyState.loading ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Play size={16} />
                            )}
                            Apply
                          </button>

                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving || !editMode}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium disabled:opacity-60"
                          >
                            {saving ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Save size={16} />
                            )}
                            {selectedTemplate.scope === "USER_INSTANCE" &&
                            selectedTemplate.created_by === user?.username
                              ? "Save Changes"
                              : isAdmin
                                ? "Save Changes"
                                : "Save as My Template"}
                          </button>

                          <button
                            type="button"
                            onClick={handleClearAll}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium"
                          >
                            <RotateCcw size={16} />
                            Clear All
                          </button>
                        </div>

                        {!editMode && (
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            Editing is disabled. Click <strong>Modify</strong> to
                            enable changes.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Preview / Output */}
                    <div className="space-y-5">
                      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="font-semibold text-slate-900 mb-3">
                          Rendered Preview
                        </h3>

                        {previewState.error && (
                          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
                            {previewState.error}
                          </div>
                        )}

                        {previewState.rendered_commands.length > 0 ? (
                          <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono max-h-[360px] overflow-auto whitespace-pre-wrap">
                            {previewState.rendered_commands.join("\n")}
                          </pre>
                        ) : (
                          <div className="text-sm text-slate-500">
                            Fill values, then click <strong>Show Preview</strong>.
                          </div>
                        )}
                      </div>

                      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="font-semibold text-slate-900 mb-3">
                          Execution Result
                        </h3>

                        {applyState.error && (
                          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
                            {applyState.error}
                          </div>
                        )}

                        {applyState.successMessage && (
                          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">
                            {applyState.successMessage}
                          </div>
                        )}

                        {applyState.protocol_used && (
                          <div className="text-xs text-slate-500 mb-3">
                            Protocol used:{" "}
                            <span className="font-mono">
                              {applyState.protocol_used}
                            </span>
                          </div>
                        )}

                        {applyState.commands_executed.length > 0 && (
                          <div className="mb-4">
                            <div className="text-xs font-semibold text-slate-700 mb-1.5">
                              Commands executed
                            </div>
                            <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono max-h-40 overflow-auto whitespace-pre-wrap">
                              {applyState.commands_executed.join("\n")}
                            </pre>
                          </div>
                        )}

                        {applyState.raw_output && (
                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-1.5">
                              Raw output
                            </div>
                            <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap">
                              {applyState.raw_output}
                            </pre>
                          </div>
                        )}

                        {!applyState.error &&
                          !applyState.successMessage &&
                          !applyState.raw_output && (
                            <div className="text-sm text-slate-500">
                              No execution yet.
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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

/* ---------- Confirm Dialog ---------- */

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
      className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{description}</p>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              {cancelText}
            </button>

            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}