import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { cn } from "../../utils/cn";
import { useAuth } from "../../context/AuthContext";
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
  Zap,
  Terminal,
  Network,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;

type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";
type TemplateScope = "GLOBAL" | "USER_INSTANCE";
type ProtocolPreference = "telnet" | "ssh" | "auto";
type StatusType = "active" | "inactive" | "error";
type ConfirmActionType = "clear-content" | "clear-all";
type TemplateOwnerFilter = "ALL" | "MINE" | "GLOBAL";
type SaveOrigin = "manual-edit" | "apply-success";

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

interface SavedParameters {
  selected_port?: string | null;
  manual_port?: string | null;
  effective_port?: string | null;
  variables?: Record<string, string>;
  saved_from?: SaveOrigin | null;
  applied_at?: string | null;
}

interface WanTemplate {
  id: number;
  name: string;
  project: string | null;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id: number | null;
  created_by: string | null;
  source_template_id: number | null;
  saved_parameters?: SavedParameters | null;
  created_at: string;
  updated_at: string;
}

interface WanTemplateListResponse {
  templates: WanTemplate[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface TemplateProject {
  id: number;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TemplateProjectListResponse {
  projects: TemplateProject[];
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

interface FilteredUserPortsResponse {
  wan_model?: string | null;
  ports: UserPort[];
}

interface WanModelRead {
  id: number;
  name: string;
  description?: string | null;
}

interface WanModelListResponse {
  models: WanModelRead[];
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

interface SuccessfulApplySnapshot {
  selectedPort: string;
  manualPort: string;
  effectivePort: string;
  variableValues: Record<string, string>;
  appliedAt: string;
}

interface TemplateStatus {
  configured: boolean;
  last_template_name?: string | null;
  last_applied_by?: string | null;
  last_project?: string | null;
  last_applied_at?: string | null;
  apply_count?: number;
}

interface ParsedTemplateErrorBlock {
  command: string;
  pointer?: string;
  message: string;
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();

    if (!message) return "An unexpected error occurred.";

    if (
      message.toLowerCase() === "failed to fetch" ||
      message.toLowerCase().includes("networkerror") ||
      message.toLowerCase().includes("load failed")
    ) {
      return "Unable to reach the server. Please check your network connection, CORS configuration, or backend availability.";
    }

    return message;
  }

  return "An unexpected error occurred.";
}

async function authFetchJson<T>(
  url: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  } catch (error) {
    throw new Error(getReadableErrorMessage(error));
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail
              .map((d: any) => d?.msg || d?.message)
              .filter(Boolean)
              .join(", ")
          : typeof data?.message === "string"
            ? data.message
            : Array.isArray(data)
              ? data
                  .map((d: any) => d?.msg || d?.message)
                  .filter(Boolean)
                  .join(", ")
              : null;

    throw new Error(detail || `Request failed with status ${res.status}.`);
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

function extractWanModelFromTemplateName(
  templateName: string,
  wanModels: WanModelRead[],
): string | null {
  const raw = (templateName || "").trim();
  if (!raw || !wanModels.length) return null;

  const tokens = raw
    .toUpperCase()
    .split(/[_\-\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const modelsByUpper = new Map(
    wanModels
      .map((wm) => [wm.name.trim().toUpperCase(), wm.name.trim()] as const)
      .filter(([name]) => !!name),
  );

  for (const token of tokens) {
    const matched = modelsByUpper.get(token);
    if (matched) return matched;
  }

  return null;
}

function isPortVariable(name: string) {
  const v = name.trim().toLowerCase();
  return v === "port" || v === "port_id";
}

function getMissingRequiredVariables(
  variables: string[],
  values: Record<string, string>,
) {
  return variables.filter((v) => !isPortVariable(v) && !values[v]?.trim());
}

function getEffectivePort(selectedPort: string, manualPort: string) {
  return (manualPort || "").trim() || selectedPort || "";
}

function getBaseTemplateNameForUser(
  fullName: string,
  username: string | null | undefined,
): string {
  const u = (username || "").trim();
  if (!fullName) return "";
  if (!u) return fullName;

  const prefix = `${u}_`;
  if (!fullName.startsWith(prefix)) {
    return fullName;
  }

  const withoutUser = fullName.slice(prefix.length).trim();
  const match = withoutUser.match(/^(.*)\s([0-9]+(?:[\/_-][0-9]+)+)$/);

  if (match?.[1]) {
    return match[1].trim();
  }

  return withoutUser;
}

function buildUserTemplateName(
  username: string | null | undefined,
  baseName: string,
  port?: string | null,
) {
  const u = (username || "user").trim();
  let b = (baseName || "template").trim().replace(/_+$/, "");
  const p = (port || "").trim();
  const baseWithUnderscore = `${b}_`;
  const namePart = `${u}_${baseWithUnderscore}`;

  if (!p) return namePart;
  return `${namePart} ${p}`;
}

function buildPreviewFingerprint(params: {
  commands: string;
  selectedPort: string;
  manualPort: string;
  variableValues: Record<string, string>;
}) {
  const sortedVariables = Object.fromEntries(
    Object.entries(params.variableValues).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );

  return JSON.stringify({
    commands: params.commands,
    selectedPort: params.selectedPort,
    manualPort: params.manualPort,
    variableValues: sortedVariables,
  });
}

function analyzeRawOutput(rawOutput: string): {
  level: "none" | "warning" | "error";
  matches: string[];
  message: string | null;
  hasTemplateErrors: boolean;
  errorBlocks: ParsedTemplateErrorBlock[];
  invalidTokenCount: number;
  explicitErrorCount: number;
} {
  const text = rawOutput || "";
  const lines = text.split(/\r?\n/);

  const errorBlocks: ParsedTemplateErrorBlock[] = [];
  const detectedMatches = new Set<string>();

  let invalidTokenCount = 0;
  let explicitErrorCount = 0;

  const invalidTokenRegex = /\binvalid\s+token\b/i;
  const infraErrorRegex =
    /\b(failed|failure|timeout|timed out|unable to connect|connection refused|networkerror|load failed)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i] || "";
    const trimmedCurrent = currentLine.trim();

    const nextLine = lines[i + 1] || "";
    const nextNextLine = lines[i + 2] || "";
    const trimmedNextNext = nextNextLine.trim();

    const isPointerLine = /^\s*\^\s*$/.test(nextLine);
    const isInvalidToken = invalidTokenRegex.test(trimmedNextNext);

    if (isPointerLine && isInvalidToken) {
      invalidTokenCount += 1;
      detectedMatches.add("invalid token");
      detectedMatches.add("^");

      errorBlocks.push({
        command: currentLine,
        pointer: nextLine,
        message: nextNextLine,
      });

      i += 2;
      continue;
    }

    if (/^error\s*:/i.test(trimmedCurrent)) {
      explicitErrorCount += 1;
      detectedMatches.add("error");

      let previousCommand = "Unknown command";
      for (let j = i - 1; j >= 0; j--) {
        const candidate = (lines[j] || "").trim();
        if (candidate) {
          previousCommand = lines[j];
          break;
        }
      }

      errorBlocks.push({
        command: previousCommand,
        message: currentLine,
      });

      continue;
    }
  }

  const isAcceptableSingleInvalidToken =
    invalidTokenCount === 1 && explicitErrorCount === 0;

  if (isAcceptableSingleInvalidToken) {
    return {
      level: "none",
      matches: [],
      message: null,
      hasTemplateErrors: false,
      errorBlocks: [],
      invalidTokenCount,
      explicitErrorCount,
    };
  }

  if (errorBlocks.length > 0) {
    return {
      level: "warning",
      matches: [...detectedMatches],
      message:
        "Template execution contains blocking command errors. Please review the highlighted command blocks below.",
      hasTemplateErrors: true,
      errorBlocks,
      invalidTokenCount,
      explicitErrorCount,
    };
  }

  if (infraErrorRegex.test(text)) {
    const infraMatches =
      text.match(
        /\b(failed|failure|timeout|timed out|unable to connect|connection refused|networkerror|load failed)\b/gi
      ) || [];

    return {
      level: "error",
      matches: [...new Set(infraMatches.map((m) => m.toLowerCase()))],
      message:
        "Raw output contains infrastructure or connection error indicators.",
      hasTemplateErrors: false,
      errorBlocks: [],
      invalidTokenCount,
      explicitErrorCount,
    };
  }

  return {
    level: "none",
    matches: [],
    message: null,
    hasTemplateErrors: false,
    errorBlocks: [],
    invalidTokenCount,
    explicitErrorCount,
  };
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 30) return `${diffD}d ago`;
  return date.toLocaleDateString();
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
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          colors[status],
        )}
      />
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
    subtle:
      "bg-slate-100 text-slate-700 hover:bg-slate-200 border-transparent",
    danger: "bg-white text-red-600 hover:bg-red-50 border-red-200",
    ghost:
      "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
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
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-[12px] leading-6 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-300",
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
      <div className="whitespace-pre-wrap p-4">{children}</div>
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
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
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

function MetadataChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
        {value}
      </span>
    </div>
  );
}

function PortTemplateStatusCard({
  loading,
  error,
  status,
  effectivePort,
}: {
  loading: boolean;
  error: string | null;
  status: TemplateStatus | null;
  effectivePort: string;
}) {
  const isConfigured = status?.configured === true;

  if (!effectivePort) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        Select or enter a port to view its configuration status.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Loader2 size={12} className="animate-spin" />
          Checking port configuration status...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3">
        <AlertBanner variant="error">{error}</AlertBanner>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Port Template Status
          </div>
          <div className="mt-1 font-mono text-xs text-slate-700">
            {effectivePort}
          </div>
        </div>

        {isConfigured ? (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] font-semibold text-emerald-700 shadow-sm">
            <CheckCircle2 size={11} className="shrink-0" />
            Configured
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-full text-[10px] font-semibold text-slate-500 shadow-sm">
            Not configured
          </div>
        )}
      </div>

      {isConfigured && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {status.last_template_name && (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-mono font-semibold text-slate-700">
              {status.last_template_name}
            </span>
          )}

          {status.last_project && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-semibold text-violet-700">
              {status.last_project}
            </span>
          )}

          {status.last_applied_by && (
            <span className="text-[10px] text-slate-400">
              by{" "}
              <span className="font-semibold text-slate-500">
                {status.last_applied_by}
              </span>
            </span>
          )}

          {status.last_applied_at && (
            <span className="text-[10px] text-slate-300">
              · {formatRelativeTime(status.last_applied_at)}
            </span>
          )}

          {(status.apply_count ?? 0) > 1 && (
            <span className="text-[10px] text-slate-300">
              · {status.apply_count}× applied
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= MAIN ================= */

const PAGE_SIZE = 10;
const PROJECT_NONE = "__NONE__";

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
  const isSuperAdmin = currentRole === "SUPER_ADMIN";

  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [totalTemplates, setTotalTemplates] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [templateSearch, setTemplateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<TemplateOwnerFilter>("ALL");

  const [projects, setProjects] = useState<string[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>("ALL");

  const [wanModels, setWanModels] = useState<WanModelRead[]>([]);
  const [loadingWanModels, setLoadingWanModels] = useState(false);

  const [availablePorts, setAvailablePorts] = useState<
    Array<{ value: string; label?: string | null }>
  >([]);

  const [loadingPorts, setLoadingPorts] = useState(false);
  const [portsError, setPortsError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [name, setName] = useState("");
  const [commands, setCommands] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedPort, setSelectedPort] = useState("");
  const [manualPort, setManualPort] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );

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
    warningMessage: string | null;
    protocol_used: string | null;
    commands_executed: string[];
    raw_output: string;
    executionHasTemplateErrors: boolean;
    errorBlocks: ParsedTemplateErrorBlock[];
  }>({
    loading: false,
    error: null,
    successMessage: null,
    warningMessage: null,
    protocol_used: null,
    commands_executed: [],
    raw_output: "",
    executionHasTemplateErrors: false,
    errorBlocks: [],
  });

  const [saving, setSaving] = useState(false);

  const [lastSuccessfulApplySnapshot, setLastSuccessfulApplySnapshot] =
    useState<SuccessfulApplySnapshot | null>(null);

  const [portTemplateStatus, setPortTemplateStatus] = useState<{
    loading: boolean;
    error: string | null;
    data: TemplateStatus | null;
  }>({
    loading: false,
    error: null,
    data: null,
  });

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

  const templatesRequestIdRef = useRef(0);
  const portsRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const applyRequestIdRef = useRef(0);
  const projectsRequestIdRef = useRef(0);
  const portTemplateStatusRequestIdRef = useRef(0);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const detectedWanModel = useMemo(() => {
    if (!selectedTemplate?.name) return null;
    return extractWanModelFromTemplateName(selectedTemplate.name, wanModels);
  }, [selectedTemplate?.name, wanModels]);

  const detectedVariables = useMemo(
    () => extractTemplateVariables(commands),
    [commands],
  );

  const customVariables = useMemo(
    () => detectedVariables.filter((v) => !isPortVariable(v)),
    [detectedVariables],
  );

  const missingRequiredVariables = useMemo(
    () => getMissingRequiredVariables(detectedVariables, variableValues),
    [detectedVariables, variableValues],
  );

  const currentPreviewFingerprint = useMemo(
    () =>
      buildPreviewFingerprint({
        commands,
        selectedPort,
        manualPort,
        variableValues,
      }),
    [commands, selectedPort, manualPort, variableValues],
  );

  const rawOutputAnalysis = useMemo(
    () => analyzeRawOutput(applyState.raw_output),
    [applyState.raw_output],
  );

  const effectivePort = useMemo(
    () => getEffectivePort(selectedPort, manualPort).trim(),
    [selectedPort, manualPort],
  );

  const [lastPreviewFingerprint, setLastPreviewFingerprint] = useState("");

  const portIsRequired = useMemo(
    () => detectedVariables.some(isPortVariable) || isUser,
    [detectedVariables, isUser],
  );

  const isPreviewStale = useMemo(
    () =>
      previewState.rendered_commands.length > 0 &&
      lastPreviewFingerprint !== "" &&
      lastPreviewFingerprint !== currentPreviewFingerprint,
    [
      previewState.rendered_commands.length,
      lastPreviewFingerprint,
      currentPreviewFingerprint,
    ],
  );

  const inheritedProject = useMemo(
    () => selectedTemplate?.project ?? null,
    [selectedTemplate],
  );

  const canSaveCopy = useMemo(() => {
    return editMode || !!lastSuccessfulApplySnapshot;
  }, [editMode, lastSuccessfulApplySnapshot]);

  const hasBlockingTemplateExecutionError = useMemo(
    () => applyState.executionHasTemplateErrors,
    [applyState.executionHasTemplateErrors],
  );

  const pageRange = useMemo(() => {
    if (!totalTemplates) return { start: 0, end: 0 };
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalTemplates);
    return { start, end };
  }, [page, totalTemplates]);

  const resetExecutionStates = useCallback(() => {
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
      warningMessage: null,
      protocol_used: null,
      commands_executed: [],
      raw_output: "",
      executionHasTemplateErrors: false,
      errorBlocks: [],
    });
  }, []);

  const clearSuccessfulApplySnapshot = useCallback(() => {
    setLastSuccessfulApplySnapshot(null);
  }, []);

  const buildSavedParametersPayload = useCallback(
    (
      origin: SaveOrigin,
      snapshot?: SuccessfulApplySnapshot | null,
    ): SavedParameters => {
      if (origin === "apply-success" && snapshot) {
        return {
          selected_port: snapshot.selectedPort || null,
          manual_port: snapshot.manualPort || null,
          effective_port: snapshot.effectivePort || null,
          variables: snapshot.variableValues || {},
          saved_from: "apply-success",
          applied_at: snapshot.appliedAt || null,
        };
      }

      const effectivePortInner = getEffectivePort(selectedPort, manualPort);

      return {
        selected_port: selectedPort || null,
        manual_port: manualPort || null,
        effective_port: effectivePortInner || null,
        variables: variableValues || {},
        saved_from: "manual-edit",
        applied_at: null,
      };
    },
    [selectedPort, manualPort, variableValues],
  );

  const validateWorkspace = useCallback(
    (mode: "preview" | "apply" | "save") => {
      if (!selectedTemplate) {
        return "Please select a template first.";
      }

      if (!commands.trim()) {
        return "Template content is required.";
      }

      const effectivePortInner = getEffectivePort(selectedPort, manualPort);

      if (portIsRequired && !effectivePortInner) {
        return "Please select a port from the list or enter one manually.";
      }

      if (missingRequiredVariables.length > 0) {
        return `Please fill in all required variables: ${missingRequiredVariables.join(", ")}.`;
      }

      if (
        mode === "apply" &&
        lastPreviewFingerprint !== currentPreviewFingerprint
      ) {
        return "Please preview the current template version before applying.";
      }

      if (mode === "save" && hasBlockingTemplateExecutionError) {
        return "Saving is disabled because the last execution detected invalid template commands.";
      }

      return null;
    },
    [
      selectedTemplate,
      commands,
      selectedPort,
      manualPort,
      portIsRequired,
      missingRequiredVariables,
      lastPreviewFingerprint,
      currentPreviewFingerprint,
      hasBlockingTemplateExecutionError,
    ],
  );

  const loadProjects = useCallback(async () => {
    const requestId = ++projectsRequestIdRef.current;

    if (!accessToken) {
      setProjects([]);
      setLoadingProjects(false);
      return;
    }

    setLoadingProjects(true);
    try {
      const res = await authFetchJson<TemplateProjectListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/template-projects`,
        accessToken,
      );

      if (requestId !== projectsRequestIdRef.current) return;

      const names = (res.projects || [])
        .map((p) => (p?.name || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      setProjects(names);
    } catch {
      if (requestId !== projectsRequestIdRef.current) return;
      setProjects([]);
    } finally {
      if (requestId === projectsRequestIdRef.current) {
        setLoadingProjects(false);
      }
    }
  }, [accessToken]);

  const loadWanModels = useCallback(async () => {
    if (!accessToken) {
      setWanModels([]);
      setLoadingWanModels(false);
      return;
    }

    setLoadingWanModels(true);

    try {
      const res = await authFetchJson<WanModelListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-models`,
        accessToken,
      );
      setWanModels(res.models || []);
    } catch (err) {
      setWanModels([]);
      toast.error(getReadableErrorMessage(err) || "Failed to load WAN modes.");
    } finally {
      setLoadingWanModels(false);
    }
  }, [accessToken]);

  const loadTemplates = useCallback(async () => {
    const requestId = ++templatesRequestIdRef.current;

    if (!accessToken) {
      setTemplates([]);
      setSelectedTemplateId(null);
      setTemplatesError(null);
      setLoadingTemplates(false);
      setTotalTemplates(0);
      setTotalPages(1);
      return;
    }

    setLoadingTemplates(true);
    setTemplatesError(null);

    try {
      const params = new URLSearchParams();
      params.set("instance_id", String(instance.id));
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));

      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }

      if (ownerFilter === "MINE") {
        params.set("mine", "true");
      } else if (ownerFilter === "GLOBAL") {
        params.set("scope", "GLOBAL");
      }

      if (projectFilter !== "ALL") {
        params.set("project", projectFilter);
      }

      const res = await authFetchJson<WanTemplateListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates?${params.toString()}`,
        accessToken,
      );

      if (requestId !== templatesRequestIdRef.current) return;

      setTemplates(res.templates || []);
      setTotalTemplates(typeof res.total === "number" ? res.total : 0);
      setTotalPages(
        typeof res.total_pages === "number" ? res.total_pages : 1,
      );
    } catch (err) {
      if (requestId !== templatesRequestIdRef.current) return;

      setTemplates([]);
      setSelectedTemplateId(null);
      setTemplatesError(
        getReadableErrorMessage(err) || "Failed to load templates.",
      );
      setTotalTemplates(0);
      setTotalPages(1);
    } finally {
      if (requestId === templatesRequestIdRef.current) {
        setLoadingTemplates(false);
      }
    }
  }, [
    accessToken,
    instance.id,
    debouncedSearch,
    ownerFilter,
    projectFilter,
    page,
  ]);

  const loadPorts = useCallback(async () => {
    const requestId = ++portsRequestIdRef.current;

    if (!accessToken || !user?.role || isSuperAdmin) {
      setAvailablePorts([]);
      setSelectedPort("");
      setPortsError(null);
      setLoadingPorts(false);
      return;
    }

    setLoadingPorts(true);
    setPortsError(null);

    try {
      if (isUser || currentRole === "ADMIN") {
        const params = new URLSearchParams();

        if (detectedWanModel?.trim()) {
          params.set("wan_model", detectedWanModel.trim());
        }

        const res = await authFetchJson<FilteredUserPortsResponse>(
          `${AUTH_BASE_URL}/api/v1/auth/my-ports${
            params.toString() ? `?${params.toString()}` : ""
          }`,
          accessToken,
        );

        if (requestId !== portsRequestIdRef.current) return;

        const ports = (res.ports || [])
          .filter((p) => p.value)
          .map((p) => ({
            value: p.value,
            label: p.label ?? null,
          }));

        setAvailablePorts(ports);
        setSelectedPort((prev) =>
          prev && ports.some((p) => p.value === prev)
            ? prev
            : ports[0]?.value || "",
        );
      } else {
        const res = await authFetchJson<CachedPortsResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/instances/${instance.id}/cached-ports`,
          accessToken,
        );

        if (requestId !== portsRequestIdRef.current) return;

        const ports = (res.ports || [])
          .filter((p) => p.port_id)
          .map((p) => ({
            value: p.port_id,
            label: null,
          }));

        setAvailablePorts(ports);
        setSelectedPort((prev) =>
          prev && ports.some((p) => p.value === prev)
            ? prev
            : ports[0]?.value || "",
        );
      }
    } catch (err) {
      if (requestId !== portsRequestIdRef.current) return;

      setAvailablePorts([]);
      setSelectedPort("");
      setPortsError(getReadableErrorMessage(err) || "Failed to load ports.");
    } finally {
      if (requestId === portsRequestIdRef.current) {
        setLoadingPorts(false);
      }
    }
  }, [
    accessToken,
    user?.role,
    isUser,
    isSuperAdmin,
    currentRole,
    instance.id,
    detectedWanModel,
  ]);

  const loadPortTemplateStatus = useCallback(async () => {
    const requestId = ++portTemplateStatusRequestIdRef.current;

    if (!accessToken || !instance?.id || !effectivePort) {
      setPortTemplateStatus({
        loading: false,
        error: null,
        data: null,
      });
      return;
    }

    setPortTemplateStatus((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const encodedPortId = encodeURIComponent(effectivePort);

      const res = await authFetchJson<TemplateStatus>(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instance.id}/ports/${encodedPortId}/template-status`,
        accessToken,
      );

      if (requestId !== portTemplateStatusRequestIdRef.current) return;

      setPortTemplateStatus({
        loading: false,
        error: null,
        data: res,
      });
    } catch (err) {
      if (requestId !== portTemplateStatusRequestIdRef.current) return;

      setPortTemplateStatus({
        loading: false,
        error: getReadableErrorMessage(err) || "Failed to load port status.",
        data: null,
      });
    }
  }, [accessToken, instance?.id, effectivePort]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(templateSearch);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [templateSearch]);

  useEffect(() => {
    setTemplates([]);
    setSelectedTemplateId(null);
    setTemplatesError(null);

    setPage(1);
    setTotalTemplates(0);
    setTotalPages(1);

    setProjectFilter("ALL");

    setAvailablePorts([]);
    setSelectedPort("");
    setManualPort("");
    setPortsError(null);

    setName("");
    setCommands("");
    setVariableValues({});
    setEditMode(false);

    resetExecutionStates();
    setLastPreviewFingerprint("");
    clearSuccessfulApplySnapshot();
    setPortTemplateStatus({
      loading: false,
      error: null,
      data: null,
    });
  }, [instance.id, resetExecutionStates, clearSuccessfulApplySnapshot]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadWanModels();
  }, [loadWanModels]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    loadPorts();
  }, [loadPorts]);

  useEffect(() => {
    loadPortTemplateStatus();
  }, [loadPortTemplateStatus]);

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

    setCommands(selectedTemplate.commands_template);
    setEditMode(false);
    resetExecutionStates();
    setLastPreviewFingerprint("");
    clearSuccessfulApplySnapshot();

    const savedParams = selectedTemplate.saved_parameters || null;

    if (savedParams) {
      const restoredSelectedPort = (savedParams.selected_port || "").trim();
      const restoredManualPort = (savedParams.manual_port || "").trim();
      const restoredVariables = savedParams.variables || {};

      setSelectedPort(restoredManualPort ? "" : restoredSelectedPort);
      setManualPort(restoredManualPort);
      setVariableValues(restoredVariables);

      toast.info("Saved parameters restored from template copy.");
    } else {
      setVariableValues({});
      setManualPort("");
    }
  }, [
    selectedTemplate,
    resetExecutionStates,
    clearSuccessfulApplySnapshot,
  ]);

  useEffect(() => {
    if (!selectedTemplate || !isUser) {
      if (selectedTemplate && !isUser) {
        setName(selectedTemplate.name);
      }
      return;
    }

    const baseName = getBaseTemplateNameForUser(
      selectedTemplate.name,
      user?.username,
    );

    const autoName = buildUserTemplateName(
      user?.username,
      baseName,
      effectivePort || "",
    );

    setName(autoName);
  }, [selectedTemplate, isUser, user?.username, effectivePort]);

  useEffect(() => {
    if (!selectedTemplate || isUser) return;
    setName(selectedTemplate.name);
  }, [selectedTemplate, isUser]);

  useEffect(() => {
    setVariableValues((prev) => {
      const next: Record<string, string> = {};
      customVariables.forEach((v) => {
        next[v] = prev[v] ?? "";
      });
      return next;
    });
  }, [customVariables]);

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
      clearSuccessfulApplySnapshot();
      toast.success("Template content cleared.");
      return;
    }

    if (action === "clear-all") {
      if (selectedTemplate) {
        setCommands(selectedTemplate.commands_template);
        setEditMode(false);

        const savedParams = selectedTemplate.saved_parameters || null;
        if (savedParams) {
          const restoredSelectedPort = (savedParams.selected_port || "").trim();
          const restoredManualPort = (savedParams.manual_port || "").trim();
          const restoredVariables = savedParams.variables || {};

          setSelectedPort(restoredManualPort ? "" : restoredSelectedPort);
          setManualPort(restoredManualPort);
          setVariableValues(restoredVariables);
        } else {
          const defaultPort = availablePorts[0]?.value || "";
          setSelectedPort(defaultPort);
          setManualPort("");
          setVariableValues({});
        }
      } else {
        setCommands("");
        setSelectedPort(availablePorts[0]?.value || "");
        setManualPort("");
        setVariableValues({});
      }

      if (!isUser) {
        setName(selectedTemplate ? selectedTemplate.name : "");
      }

      resetExecutionStates();
      setLastPreviewFingerprint("");
      clearSuccessfulApplySnapshot();
      toast.success("Workspace reset.");
    }
  }

  async function handlePreview() {
    const requestId = ++previewRequestIdRef.current;

    const validationError = validateWorkspace("preview");
    if (validationError) {
      setPreviewState((s) => ({
        ...s,
        loading: false,
        error: validationError,
        rendered_script: "",
        rendered_commands: [],
      }));
      toast.error(validationError);
      return;
    }

    const effectivePortInner = getEffectivePort(selectedPort, manualPort);

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
            selected_port: effectivePortInner || null,
            variables: variableValues,
          }),
        },
      );

      if (requestId !== previewRequestIdRef.current) return;

      setPreviewState({
        loading: false,
        error: null,
        rendered_script: res.rendered_script,
        rendered_commands: res.rendered_commands,
      });
      setLastPreviewFingerprint(currentPreviewFingerprint);
    } catch (err) {
      if (requestId !== previewRequestIdRef.current) return;

      const message =
        getReadableErrorMessage(err) || "Failed to render template.";
      setPreviewState({
        loading: false,
        error: message,
        rendered_script: "",
        rendered_commands: [],
      });
      toast.error(message);
    }
  }

  async function handleApply() {
  const requestId = ++applyRequestIdRef.current;

  const validationError = validateWorkspace("apply");
  if (validationError) {
    setApplyState((s) => ({
      ...s,
      loading: false,
      error: validationError,
    }));
    toast.error(validationError);
    return;
  }

  if (!selectedTemplate) return;

  const effectivePortInner = getEffectivePort(selectedPort, manualPort);

  // 🔹 Nouveau : toast loader pendant l'opération
  const applyToastId = toast.loading("Applying template...");

  setApplyState({
    loading: true,
    error: null,
    successMessage: null,
    warningMessage: null,
    protocol_used: null,
    commands_executed: [],
    raw_output: "",
    executionHasTemplateErrors: false,
    errorBlocks: [],
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
          selected_port: effectivePortInner || null,
          variables: variableValues,
        }),
      },
    );

    if (requestId !== applyRequestIdRef.current) {
      // Requête obsolète → on supprime juste le loader
      toast.dismiss(applyToastId);
      return;
    }

    const outputAnalysis = analyzeRawOutput(res.raw_output || "");
    const hasTemplateErrors = outputAnalysis.hasTemplateErrors;

    setApplyState({
      loading: false,
      error: res.success ? null : res.message,
      successMessage:
        res.success && !hasTemplateErrors
          ? res.message || "Applied successfully."
          : null,
      warningMessage:
        res.success && hasTemplateErrors
          ? "Template executed, but invalid or unsupported commands were detected in device output."
          : null,
      protocol_used: res.protocol_used,
      commands_executed: res.commands_executed || [],
      raw_output: res.raw_output || "",
      executionHasTemplateErrors: hasTemplateErrors,
      errorBlocks: outputAnalysis.errorBlocks,
    });

    if (res.success && !hasTemplateErrors) {
      setLastSuccessfulApplySnapshot({
        selectedPort,
        manualPort,
        effectivePort: effectivePortInner,
        variableValues: { ...variableValues },
        appliedAt: new Date().toISOString(),
      });

      toast.success(/*res.message || */ "Template applied.", {
        id: applyToastId,
      });

      loadPortTemplateStatus();
    } else if (res.success && hasTemplateErrors) {
      clearSuccessfulApplySnapshot();

      toast.warning(
        "Template contains invalid or unsupported commands. Saving is disabled until the template is fixed.",
        { id: applyToastId },
      );
    } else {
      clearSuccessfulApplySnapshot();

      toast.error(
        "Failed to connect to the ISAM instance or apply the template.",
        { id: applyToastId },
      );
      return;
    }
  } catch (err) {
    if (requestId !== applyRequestIdRef.current) {
      toast.dismiss(applyToastId);
      return;
    }

    const message =
      getReadableErrorMessage(err) || "Failed to apply template.";
    setApplyState({
      loading: false,
      error: message,
      successMessage: null,
      warningMessage: null,
      protocol_used: null,
      commands_executed: [],
      raw_output: "",
      executionHasTemplateErrors: false,
      errorBlocks: [],
    });
    clearSuccessfulApplySnapshot();

    // 🔹 On transforme le loader en toast d’erreur
    toast.error(message, { id: applyToastId });
  }
}

  async function findExistingUserCopy(sourceTemplateId: number) {
    try {
      const copy = await authFetchJson<WanTemplate>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/my-existing-copy?source_template_id=${sourceTemplateId}`,
        accessToken,
      );
      return copy;
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      if (msg.includes("404") || msg.includes("no existing copy found")) {
        return null;
      }
      throw err;
    }
  }

  async function handleSave(mode: "update" | "copy" = "update") {
    if (!selectedTemplate) return;

    const isCopyAction = isUser || mode === "copy";

    if (!isCopyAction && !editMode) {
      toast.info('Click "Enable editing" first to modify.');
      return;
    }

    if (isCopyAction && !editMode && !lastSuccessfulApplySnapshot) {
      toast.info(
        'To save a copy, either use "Edit" mode or do a successful "Apply" first.',
      );
      return;
    }

    if (hasBlockingTemplateExecutionError) {
      toast.warning(
        "Saving is disabled because the last execution detected invalid template commands.",
      );
      return;
    }

    const validationError =
      editMode || !lastSuccessfulApplySnapshot
        ? validateWorkspace("save")
        : null;

    if (validationError) {
      toast.error(validationError);
      return;
    }

    let saveSelectedPort = selectedPort;
    let saveManualPort = manualPort;
    let saveVariableValues = variableValues;
    let saveOrigin: SaveOrigin = "manual-edit";

    if (isCopyAction && !editMode && lastSuccessfulApplySnapshot) {
      saveSelectedPort = lastSuccessfulApplySnapshot.selectedPort;
      saveManualPort = lastSuccessfulApplySnapshot.manualPort;
      saveVariableValues = lastSuccessfulApplySnapshot.variableValues;
      saveOrigin = "apply-success";
    }

const effectivePortInner = getEffectivePort(saveSelectedPort, saveManualPort);

if (isUser && !effectivePortInner) {
  toast.error(
    "Please select a port or enter one manually; it will be included in the template name.",
  );
  return;
}

const username = (user?.username || "").trim();
const originalTemplateName = (selectedTemplate.name || "").trim();
let finalName: string;

if (isCopyAction) {
  // ====== CAS SAVE COPY ======
  if (isUser) {
    // Comportement existant pour USER : baseName + port
    const baseName = getBaseTemplateNameForUser(
      selectedTemplate.name,
      user?.username,
    );

    finalName = buildUserTemplateName(
      user?.username,
      baseName,
      effectivePortInner,
    );
  } else {

    const baseOriginalName =
      originalTemplateName || name.trim() || "template";

    if (username && effectivePortInner) {
      finalName = `${username}_${baseOriginalName}_${effectivePortInner}`;
    } else if (username) {
      finalName = `${username}_${baseOriginalName}`;
    } else if (effectivePortInner) {
      finalName = `${baseOriginalName}_${effectivePortInner}`;
    } else {
      finalName = baseOriginalName;
    }
  }
} else {
  // ====== CAS SAVE (update simple) – on NE change rien ======
  if (isUser) {
    const baseName = getBaseTemplateNameForUser(
      selectedTemplate.name,
      user?.username,
    );

    finalName = buildUserTemplateName(
      user?.username,
      baseName,
      effectivePortInner,
    );
  } else {
    finalName = name.trim();
  }
}

  if (!finalName) {
    toast.error("Template name is required.");
    return;
  }

    setSaving(true);

    try {
      let saved: WanTemplate;

      if (isCopyAction) {
        const scopeForNew: TemplateScope = isUser
          ? "USER_INSTANCE"
          : selectedTemplate.scope;

        const instanceIdForNew =
          scopeForNew === "GLOBAL"
            ? null
            : selectedTemplate.isam_instance_id ?? instance.id;

        const savedParametersPayload =
          saveOrigin === "apply-success"
            ? buildSavedParametersPayload(
                "apply-success",
                lastSuccessfulApplySnapshot,
              )
            : {
                selected_port: saveSelectedPort || null,
                manual_port: saveManualPort || null,
                effective_port: effectivePortInner || null,
                variables: saveVariableValues || {},
                saved_from: "manual-edit" as const,
                applied_at: null,
              };

        const rootSourceTemplateId =
          selectedTemplate.source_template_id ?? selectedTemplate.id;

        const existingUserCopy = await findExistingUserCopy(rootSourceTemplateId);

        if (existingUserCopy) {
          saved = await authFetchJson<WanTemplate>(
            `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${existingUserCopy.id}`,
            accessToken,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: finalName,
                commands_template: commands,
                project: inheritedProject,
                saved_parameters: savedParametersPayload,
              }),
            },
          );

          toast.success("Template copy updated.");
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
                scope: scopeForNew,
                isam_instance_id: instanceIdForNew,
                source_template_id: rootSourceTemplateId,
                project: inheritedProject,
                saved_parameters: savedParametersPayload,
              }),
            },
          );

          toast.success("Template copy created with saved parameters.");
        }
      } else {
        saved = await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${selectedTemplate.id}`,
          accessToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: finalName,
              commands_template: commands,
              saved_parameters: buildSavedParametersPayload("manual-edit"),
            }),
          },
        );

        toast.success("Template updated.");
      }

      await loadTemplates();
      setSelectedTemplateId(saved.id);
      setEditMode(false);
      resetExecutionStates();
      setLastPreviewFingerprint("");
      clearSuccessfulApplySnapshot();
    } catch (err) {
      toast.error(getReadableErrorMessage(err) || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function handleClearContent() {
    if (!commands.trim()) return;

    openConfirmDialog(
      "clear-content",
      "Clear template content?",
      "This will remove the current commands from the editor.",
      "Clear",
    );
  }

  function handleClearAll() {
    openConfirmDialog(
      "clear-all",
      "Reset workspace?",
      "This will reset editor, port, variables, preview and execution results.",
      "Reset",
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 p-3 backdrop-blur-sm sm:p-5">
        <div className="mx-auto flex h-[96vh] max-w-[1700px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
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
                    <span className="text-[11px] capitalize text-slate-600">
                      {instance.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={isUser ? "info" : "purple"}>
                {currentRole.replace("_", " ")}
              </Badge>
              <div className="h-6 w-px bg-slate-200" />
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <aside className="flex w-[320px] shrink-0 flex-col border-r border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Templates
                  </h2>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    {totalTemplates}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search..."
                      className="py-1.5 pl-9 pr-8 text-xs"
                    />
                    {loadingTemplates && debouncedSearch && (
                      <Loader2
                        size={12}
                        className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                      />
                    )}
                  </div>

                  <Select
                    value={ownerFilter}
                    onChange={(e) => {
                      setOwnerFilter(e.target.value as TemplateOwnerFilter);
                      setPage(1);
                    }}
                    className="py-1.5 text-xs"
                  >
                    <option value="ALL">All visible templates</option>
                    <option value="MINE">My personal templates</option>
                    <option value="GLOBAL">Global templates only</option>
                  </Select>

                  <Select
                    value={projectFilter}
                    onChange={(e) => {
                      setProjectFilter(e.target.value);
                      setPage(1);
                    }}
                    className="py-1.5 text-xs"
                    disabled={loadingProjects}
                  >
                    <option value="ALL">All projects</option>
                    <option value={PROJECT_NONE}>No project</option>
                    {projects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>

                  <div className="text-[10px] text-slate-500">
                    {pageRange.start > 0 ? (
                      <>
                        Showing <strong>{pageRange.start}</strong>–
                        <strong>{pageRange.end}</strong> of{" "}
                        <strong>{totalTemplates}</strong>
                      </>
                    ) : (
                      "No templates to show."
                    )}
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
                          ? "border-l-2 border-l-sky-500 bg-sky-50/80"
                          : "border-l-2 border-l-transparent hover:bg-slate-50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px] font-semibold",
                            selectedTemplateId === tpl.id
                              ? "text-sky-900"
                              : "text-slate-800",
                          )}
                        >
                          {tpl.name}
                        </span>

                        {tpl.scope === "GLOBAL" ? (
                          <Globe
                            size={12}
                            className="shrink-0 text-violet-500"
                          />
                        ) : (
                          <User size={12} className="shrink-0 text-sky-500" />
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>{tpl.created_by || "system"}</span>
                        {tpl.project && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5">
                              <FolderOpen size={9} />
                              {tpl.project}
                            </span>
                          </>
                        )}
                        {tpl.saved_parameters?.saved_from && (
                          <>
                            <span>·</span>
                            <span>
                              {tpl.saved_parameters.saved_from ===
                              "apply-success"
                                ? "saved from apply"
                                : "saved from edit"}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>
                          {new Date(tpl.updated_at).toLocaleDateString()}
                        </span>
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

              <div className="border-t border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={loadingTemplates || page <= 1}
                  >
                    <ChevronLeft size={14} />
                    Prev
                  </Btn>

                  <div className="text-[11px] text-slate-600">
                    Page <strong>{page}</strong> /{" "}
                    <strong>{Math.max(1, totalPages)}</strong>
                  </div>

                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPage((p) => Math.min(Math.max(1, totalPages), p + 1))
                    }
                    disabled={
                      loadingTemplates || page >= Math.max(1, totalPages)
                    }
                  >
                    Next
                    <ChevronRight size={14} />
                  </Btn>
                </div>
              </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
              {!selectedTemplate ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                  <FileText size={36} strokeWidth={1.2} />
                  <p className="text-sm">
                    Select a template from the sidebar.
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid min-h-full grid-cols-1 gap-0 xl:grid-cols-2 xl:divide-x xl:divide-slate-200">
                    <div className="space-y-0 divide-y divide-slate-200">
                      <div className="p-5">
                        <div className="flex items-start gap-3">
                          {!editMode && (
                            <div className="mt-1 shrink-0">
                              <Btn
                                size="sm"
                                variant="outline"
                                onClick={() => setEditMode(true)}
                                className="h-8 w-8 rounded-lg border-slate-200 p-0 hover:bg-white"
                              >
                                <Edit3 size={14} />
                              </Btn>
                            </div>
                          )}

                          <div className="flex-1">
                            <SectionTitle
                              icon={FileText}
                              title={
                                editMode && !isUser
                                  ? name || selectedTemplate.name
                                  : selectedTemplate.name
                              }
                              description={`Scope: ${selectedTemplate.scope} · By ${
                                selectedTemplate.created_by || "system"
                              } · Updated ${new Date(
                                selectedTemplate.updated_at,
                              ).toLocaleString()}`}
                              badge={
                                <Badge
                                  variant={
                                    selectedTemplate.scope === "GLOBAL"
                                      ? "purple"
                                      : "info"
                                  }
                                >
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
                          </div>
                        </div>
                      </div>

                      <div className="p-5">
                        <FieldLabel>Template Name</FieldLabel>
                        <Input
                          value={name}
                          onChange={(e) => {
                            if (!isUser) setName(e.target.value);
                          }}
                          disabled={!editMode || isUser}
                          className={cn(
                            (!editMode || isUser) &&
                              "cursor-not-allowed bg-slate-50 text-slate-500",
                          )}
                        />
                        {isUser && (
                          <div className="mt-1 text-[11px] text-slate-500">
                            Name is generated automatically as:{" "}
                            <span className="font-mono text-slate-700">
                              {buildUserTemplateName(
                                user?.username,
                                getBaseTemplateNameForUser(
                                  selectedTemplate.name,
                                  user?.username,
                                ),
                                manualPort || selectedPort || "PORT",
                              )}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-5">
                        <FieldLabel>Project</FieldLabel>
                        <Input
                          value={inheritedProject || ""}
                          disabled
                          placeholder="No project assigned"
                          className="cursor-not-allowed bg-slate-50 text-slate-500"
                        />
                      </div>

                      <div className="p-5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <FieldLabel required>Commands Template</FieldLabel>
                          <Btn
                            size="sm"
                            variant="danger"
                            onClick={handleClearContent}
                            disabled={!editMode || !commands.trim()}
                          >
                            <Trash2 size={12} />
                            Clear
                          </Btn>
                        </div>

                        <Textarea
                          value={commands}
                          onChange={(e) => {
                            setCommands(e.target.value);
                            clearSuccessfulApplySnapshot();
                            setApplyState((prev) => ({
                              ...prev,
                              warningMessage: null,
                              executionHasTemplateErrors: false,
                              errorBlocks: [],
                              successMessage: null,
                            }));
                          }}
                          disabled={!editMode}
                          rows={14}
                          className={cn(
                            !editMode &&
                              "cursor-not-allowed bg-slate-50 text-slate-500",
                          )}
                        />

                        {detectedVariables.length > 0 && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
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
                                  {isPortVariable(v) && (
                                    <Cable size={10} className="mr-1 inline" />
                                  )}
                                  [[${v}]]
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {missingRequiredVariables.length > 0 && (
                          <div className="mt-3">
                            <AlertBanner variant="warning">
                              Missing required variables:{" "}
                              <strong>
                                {missingRequiredVariables.join(", ")}
                              </strong>
                            </AlertBanner>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4 p-5">
                        <SectionTitle
                          icon={Cable}
                          title="Input Variables"
                          description="Select or enter the target port and fill custom placeholders."
                        />

                        <div>
                          <FieldLabel required={portIsRequired}>Port</FieldLabel>

                          {!isSuperAdmin && (
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-slate-600">
                                From list
                              </label>
                              <Select
                                value={selectedPort}
                                onChange={(e) => {
                                  setSelectedPort(e.target.value);
                                  if (e.target.value) {
                                    setManualPort("");
                                  }
                                  clearSuccessfulApplySnapshot();
                                  setApplyState((prev) => ({
                                    ...prev,
                                    warningMessage: null,
                                    executionHasTemplateErrors: false,
                                    errorBlocks: [],
                                    successMessage: null,
                                  }));
                                }}
                                disabled={
                                  loadingPorts ||
                                  availablePorts.length === 0 ||
                                  manualPort.trim().length > 0
                                }
                                className={cn(
                                  manualPort.trim().length > 0 &&
                                    "cursor-not-allowed bg-slate-100 text-slate-400 opacity-60",
                                )}
                              >
                                <option value="">— Select port —</option>
                                {availablePorts.map((p) => (
                                  <option key={p.value} value={p.value}>
                                    {p.label ? `${p.value} (${p.label})` : p.value}
                                  </option>
                                ))}
                              </Select>

                              {manualPort.trim().length > 0 && (
                                <p className="mt-1 text-[10px] text-amber-600">
                                  Disabled — clear manual port to use this list.
                                </p>
                              )}
                            </div>
                          )}

                          <div className="mt-2">
                            <label className="mb-1 block text-[11px] font-medium text-slate-600">
                              {isSuperAdmin
                                ? "Port (manual entry)"
                                : "Manual entry"}
                            </label>
                            <Input
                              value={manualPort}
                              onChange={(e) => {
                                setManualPort(e.target.value);
                                if (e.target.value.trim()) {
                                  setSelectedPort("");
                                }
                                clearSuccessfulApplySnapshot();
                                setApplyState((prev) => ({
                                  ...prev,
                                  warningMessage: null,
                                  executionHasTemplateErrors: false,
                                  errorBlocks: [],
                                  successMessage: null,
                                }));
                              }}
                              placeholder="e.g. 1/1/5/3"
                              disabled={!isSuperAdmin && selectedPort.length > 0}
                              className={cn(
                                "py-1.5 text-xs",
                                !isSuperAdmin &&
                                  selectedPort.length > 0 &&
                                  "cursor-not-allowed bg-slate-100 text-slate-400 opacity-60",
                              )}
                            />

                            {!isSuperAdmin && selectedPort.length > 0 && (
                              <p className="mt-1 text-[10px] text-amber-600">
                                Disabled — deselect list port to type manually.
                              </p>
                            )}
                          </div>

                          <div className="mt-1.5 text-[11px] text-slate-500">
                            {isSuperAdmin
                              ? "As Super Admin, enter the target port manually."
                              : manualPort.trim()
                                ? "Manual port will be used. Clear it to pick from the list instead."
                                : selectedPort
                                  ? "List port selected. Deselect it to type manually."
                                  : "Choose a port from the list OR type one manually."}
                          </div>

                          {detectedWanModel && (
                            <div className="mt-1.5 text-[11px] text-slate-500">
                              WAN mode detected:{" "}
                              <span className="font-semibold text-slate-700">
                                {detectedWanModel}
                              </span>
                            </div>
                          )}

                          {selectedTemplate?.name &&
                            !detectedWanModel &&
                            !loadingWanModels && (
                              <div className="mt-1.5">
                                <AlertBanner variant="warning">
                                  No WAN mode was detected from the template
                                  name.
                                </AlertBanner>
                              </div>
                            )}

                          {!isSuperAdmin && loadingPorts && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <Loader2 size={11} className="animate-spin" />{" "}
                              Loading ports...
                            </div>
                          )}

                          {!isSuperAdmin && portsError && (
                            <div className="mt-1.5">
                              <AlertBanner variant="error">
                                {portsError}
                              </AlertBanner>
                            </div>
                          )}

                          <PortTemplateStatusCard
                            loading={portTemplateStatus.loading}
                            error={portTemplateStatus.error}
                            status={portTemplateStatus.data}
                            effectivePort={effectivePort}
                          />
                        </div>

                        {customVariables.length > 0 && (
                          <div>
                            <FieldLabel>Custom Variables</FieldLabel>
                            <div className="grid grid-cols-2 gap-3">
                              {customVariables.map((v) => (
                                <div key={v}>
                                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                                    {v}
                                  </label>
                                  <Input
                                    value={variableValues[v] ?? ""}
                                    onChange={(e) => {
                                      setVariableValues((prev) => ({
                                        ...prev,
                                        [v]: e.target.value,
                                      }));
                                      clearSuccessfulApplySnapshot();
                                      setApplyState((prev) => ({
                                        ...prev,
                                        warningMessage: null,
                                        executionHasTemplateErrors: false,
                                        errorBlocks: [],
                                        successMessage: null,
                                      }));
                                    }}
                                    className={cn(
                                      "py-1.5 text-xs",
                                      !variableValues[v]?.trim() &&
                                        "border-amber-300 focus:border-amber-400 focus:ring-amber-200",
                                    )}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {lastSuccessfulApplySnapshot && (
                          <AlertBanner variant="success">
                            Last successful apply is available. You can now save
                            a reusable copy with the exact applied parameters.
                          </AlertBanner>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-2">
                          <Btn
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
                            variant="primary"
                            onClick={handleApply}
                            disabled={applyState.loading}
                          >
                            {applyState.loading ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                            Apply to Port
                          </Btn>

                          {isAdmin ? (
                            <>
                              <Btn
                                onClick={() => handleSave("update")}
                                disabled={
                                  saving ||
                                  !editMode ||
                                  hasBlockingTemplateExecutionError
                                }
                              >
                                {saving ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Save size={14} />
                                )}
                                Save
                              </Btn>

                              <Btn
                                onClick={() => handleSave("copy")}
                                disabled={
                                  saving ||
                                  !canSaveCopy ||
                                  hasBlockingTemplateExecutionError
                                }
                                variant="subtle"
                                size="sm"
                              >
                                {saving ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Save size={12} />
                                )}
                                Save Copy
                              </Btn>
                            </>
                          ) : (
                            <Btn
                              onClick={() => handleSave("copy")}
                              disabled={
                                saving ||
                                !canSaveCopy ||
                                hasBlockingTemplateExecutionError
                              }
                            >
                              {saving ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Save size={14} />
                              )}
                              Save Copy
                            </Btn>
                          )}

                          <div className="flex-1" />

                          <Btn
                            variant="danger"
                            size="sm"
                            onClick={handleClearAll}
                          >
                            <RotateCcw size={13} />
                            Reset
                          </Btn>
                        </div>

                        {hasBlockingTemplateExecutionError && (
                          <div className="text-[11px] text-amber-600">
                            Saving is disabled because the last execution
                            detected invalid template commands.
                          </div>
                        )}

                        {!editMode && !lastSuccessfulApplySnapshot && !hasBlockingTemplateExecutionError && (
                          <div className="text-[11px] text-slate-500">
                            Save Copy becomes available after either entering
                            Edit mode or completing a successful Apply.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 bg-slate-50/40">
                      <div className="p-5">
                        <SectionTitle
                          icon={Eye}
                          title="Rendered Preview"
                          description="Preview commands before execution."
                        />
                        <div className="mt-3">
                          {previewState.error && (
                            <div className="mb-3">
                              <AlertBanner variant="error">
                                {previewState.error}
                              </AlertBanner>
                            </div>
                          )}

                          {isPreviewStale && (
                            <div className="mb-3">
                              <AlertBanner variant="warning">
                                Preview is outdated. Click <strong>Preview</strong>{" "}
                                again before applying.
                              </AlertBanner>
                            </div>
                          )}

                          {previewState.rendered_commands.length > 0 ? (
                            <CodeViewer maxHeight="400px">
                              {previewState.rendered_commands.join("\n")}
                            </CodeViewer>
                          ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center">
                              <Eye
                                size={24}
                                strokeWidth={1.2}
                                className="mb-2 text-slate-300"
                              />
                              <p className="text-xs text-slate-500">
                                Fill variables, then click <strong>Preview</strong>.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-5">
                        <SectionTitle
                          icon={Terminal}
                          title="Execution Result"
                          description="Live device response and command trace."
                        />
                        <div className="mt-3 space-y-3">
                          {applyState.error && (
                            <AlertBanner variant="error">
                              {applyState.error}
                            </AlertBanner>
                          )}

                          {applyState.successMessage && (
                            <AlertBanner variant="success">
                              {applyState.successMessage}
                            </AlertBanner>
                          )}

                          {applyState.warningMessage && (
                            <AlertBanner variant="warning">
                              {applyState.warningMessage}
                            </AlertBanner>
                          )}

                          {!applyState.error &&
                            rawOutputAnalysis.level === "warning" &&
                            rawOutputAnalysis.message && (
                              <AlertBanner variant="warning">
                                <div>
                                  <div>{rawOutputAnalysis.message}</div>
                                  {rawOutputAnalysis.matches.length > 0 && (
                                    <div className="mt-1 text-[11px] opacity-80">
                                      Detected keyword
                                      {rawOutputAnalysis.matches.length > 1
                                        ? "s"
                                        : ""}
                                      :{" "}
                                      <strong>
                                        {rawOutputAnalysis.matches.join(", ")}
                                      </strong>
                                    </div>
                                  )}
                                </div>
                              </AlertBanner>
                            )}

                          {!applyState.error &&
                            rawOutputAnalysis.level === "error" &&
                            rawOutputAnalysis.message && (
                              <AlertBanner variant="error">
                                <div>
                                  <div>{rawOutputAnalysis.message}</div>
                                  {rawOutputAnalysis.matches.length > 0 && (
                                    <div className="mt-1 text-[11px] opacity-80">
                                      Detected keyword
                                      {rawOutputAnalysis.matches.length > 1
                                        ? "s"
                                        : ""}
                                      :{" "}
                                      <strong>
                                        {rawOutputAnalysis.matches.join(", ")}
                                      </strong>
                                    </div>
                                  )}
                                </div>
                              </AlertBanner>
                            )}

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

                          {applyState.errorBlocks.length > 0 && (
                            <div>
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Detected Template Issues
                              </div>

                              <div className="space-y-2">
                                {applyState.errorBlocks.map((block, idx) => (
                                  <div
                                    key={`${block.command}-${idx}`}
                                    className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                                  >
                                    <div className="mb-1 text-[11px] font-semibold text-amber-800">
                                      Command with issue
                                    </div>
                                    <CodeViewer
                                      maxHeight="140px"
                                      className="border-amber-200 bg-white"
                                    >
                                      {block.command}
                                      {block.pointer ? `\n${block.pointer}` : ""}
                                      {`\n${block.message}`}
                                    </CodeViewer>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {applyState.raw_output ? (
                            <div>
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Raw Output
                              </div>
                              <CodeViewer dark maxHeight="260px">
                                {applyState.raw_output}
                              </CodeViewer>
                            </div>
                          ) : (
                            !applyState.error &&
                            !applyState.successMessage &&
                            !applyState.warningMessage && (
                              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white py-10 text-center">
                                <Terminal
                                  size={24}
                                  strokeWidth={1.2}
                                  className="mb-2 text-slate-300"
                                />
                                <p className="text-xs text-slate-500">
                                  No execution yet.
                                </p>
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
                {totalTemplates} template{totalTemplates !== 1 ? "s" : ""}
              </span>
              <span>·</span>
              <span>
                {availablePorts.length} port
                {availablePorts.length !== 1 ? "s" : ""} in list
              </span>
            </div>

            <div className="text-[11px] text-slate-400">
              ISAM Template Manager
            </div>
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
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
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

        <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-3">
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