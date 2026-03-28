import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { cn } from "../../utils/cn";
import {
  Trash2,
  Plus,
  Loader2,
  X,
  Search,
  Users,
  ShieldCheck,
  Cable,
  UserCog,
  Mail,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCcw,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

const AUTH_BASE_URL = "http://127.0.0.1:9000";

type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";
type RoleFilter = "ALL" | UserRole;

type ConfirmActionType = "delete-user";
type UserModalMode = "create" | "edit";

interface UserPort {
  id: number;
  label?: string | null;
  value: string;
}

interface UserAdminRead {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  port_label?: string | null;
  port_value?: string | null;
  ports: UserPort[];
}

interface UserListResponse {
  users: UserAdminRead[];
}

interface PortForm {
  label: string;
  value: string;
}

interface UserFormState {
  username: string; // readonly en edit, mais utile pour affichage
  email: string;
  full_name: string;
  password: string; // obligatoire en create, optionnel en edit
  role: UserRole; // modifiable uniquement si SUPER_ADMIN
  is_active: boolean; // modifiable en edit
  ports: PortForm[];
}

interface AdminUserCreatePayload {
  username: string;
  email: string;
  full_name: string;
  password: string;
  role: UserRole;
  ports?: PortForm[]; // MODIF: optionnel
}

interface AdminUserUpdatePayload {
  email?: string;
  full_name?: string;
  password?: string;
  role?: UserRole;
  is_active?: boolean;
  ports?: PortForm[]; // déjà optionnel
}

interface ConfirmDialogState {
  open: boolean;
  type: ConfirmActionType | null;
  target: UserAdminRead | null;
  loading: boolean;
}

const EMPTY_CONFIRM_DIALOG: ConfirmDialogState = {
  open: false,
  type: null,
  target: null,
  loading: false,
};

/* ================================================================
   FIX: parse FastAPI/Pydantic errors (avoid [object Object])
   ================================================================ */

class ApiError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.fieldErrors = fieldErrors;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

function cleanMsg(msg: string) {
  return msg.replace(/^Value error,\s*/i, "");
}

function locToKey(loc: any): string {
  if (!Array.isArray(loc)) return "general";
  const cleaned = loc.filter(
    (p) => !["body", "query", "path", "header"].includes(String(p)),
  );
  return cleaned.map(String).join(".") || "general";
}

function parseFastApiError(data: any, fallback = "Unknown error") {
  if (Array.isArray(data?.detail)) {
    const fieldErrors: Record<string, string> = {};
    const messages: string[] = [];

    for (const err of data.detail) {
      const key = locToKey(err?.loc);
      const raw = typeof err?.msg === "string" ? err.msg : fallback;
      const msg = cleanMsg(raw);

      if (!fieldErrors[key]) fieldErrors[key] = msg;
      messages.push(msg);
    }

    return {
      message: messages.join("\n"),
      fieldErrors,
    };
  }

  if (typeof data?.detail === "string") return { message: data.detail as string };
  if (typeof data?.message === "string")
    return { message: data.message as string };

  return { message: fallback };
}

/* ================================================================
   Helpers
   ================================================================ */

function getUserPorts(u: UserAdminRead): UserPort[] {
  if (u.ports && u.ports.length > 0) return u.ports;
  if (u.port_value) {
    return [{ id: -1, label: u.port_label ?? "Primary", value: u.port_value }];
  }
  return [];
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePasswordStrict(pwd: string): string | null {
  if (pwd.length < 8 || pwd.length > 72) return "Password must be 8–72 characters.";
  if (/\s/.test(pwd)) return "Password must not contain spaces.";
  if (!/[a-z]/.test(pwd)) return "Password must contain a lowercase letter.";
  if (!/[A-Z]/.test(pwd)) return "Password must contain an uppercase letter.";
  if (!/[0-9]/.test(pwd)) return "Password must contain a digit.";
  if (!/[^A-Za-z0-9]/.test(pwd)) return "Password must contain a special character.";
  return null;
}

function normalizePortsForPayload(ports: PortForm[]): PortForm[] {
  return (ports || [])
    .map((p) => ({
      label: (p.label ?? "").trim(),
      value: (p.value ?? "").trim(),
    }))
    .filter((p) => p.value.length > 0);
}

type BadgeProps = {
  children: React.ReactNode;
  variant?: "default" | "info" | "success" | "warning" | "danger" | "purple";
  className?: string;
};

function roleToBadgeVariant(role: UserRole): BadgeProps["variant"] {
  if (role === "SUPER_ADMIN") return "danger";
  if (role === "ADMIN") return "warning";
  return "success";
}

/* ================================================================
   UI Primitives
   ================================================================ */

function Badge({ children, variant = "default", className }: BadgeProps) {
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
      <div style={{ whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

/* ================================================================
   Small UI parts
   ================================================================ */

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "success" : "default"}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return <Badge variant={roleToBadgeVariant(role)}>{role}</Badge>;
}

function AvatarCircle({ name, username }: { name: string; username: string }) {
  const initials = getInitials(name || username || "U");
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">
      {initials || "U"}
    </div>
  );
}

function SegmentedFilter({
  value,
  onChange,
  items,
}: {
  value: RoleFilter;
  onChange: (v: RoleFilter) => void;
  items: RoleFilter[];
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      {items.map((it) => {
        const active = it === value;
        return (
          <button
            key={it}
            onClick={() => onChange(it)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border",
              active
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
            )}
          >
            {it === "ALL" ? "All roles" : it}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  tone?: "default" | "info" | "warning" | "success" | "purple";
}) {
  const tones = {
    default: "bg-white",
    info: "bg-sky-50/60",
    warning: "bg-amber-50/60",
    success: "bg-emerald-50/60",
    purple: "bg-violet-50/60",
  };

  return (
    <div
      className={cn("rounded-xl border border-slate-200 shadow-sm", tones[tone])}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {title}
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700">
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MAIN COMPONENT
   ================================================================ */

export default function UserManagementSection() {
  const { user, authFetch } = useAuth();

  const [users, setUsers] = useState<UserAdminRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");

  // Modal create/edit
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalMode, setUserModalMode] = useState<UserModalMode>("create");
  const [editTarget, setEditTarget] = useState<UserAdminRead | null>(null);

  const [form, setForm] = useState<UserFormState>({
    username: "",
    email: "",
    full_name: "",
    password: "",
    role: "USER",
    is_active: true,
    ports: [{ label: "", value: "" }],
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState>(EMPTY_CONFIRM_DIALOG);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isAdmin = user?.role === "ADMIN";

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function authFetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
    const res = await authFetch(url, options);

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // no json
    }

    if (!res.ok) {
      const parsed = parseFastApiError(data, `Request failed (HTTP ${res.status})`);
      throw new ApiError(parsed.message, parsed.fieldErrors);
    }

    return data as T;
  }

  function closeConfirmDialog() {
    if (confirmDialog.loading) return;
    setConfirmDialog(EMPTY_CONFIRM_DIALOG);
  }

  function openDeleteDialog(target: UserAdminRead) {
    setConfirmDialog({
      open: true,
      type: "delete-user",
      target,
      loading: false,
    });
  }

  const loadUsers = useCallback(
    async (search?: string, role?: RoleFilter) => {
      setLoading(true);
      setGlobalError(null);

      try {
        const params = new URLSearchParams();
        const q = (search ?? searchTerm).trim();
        if (q) params.set("search", q);
        const r = role ?? roleFilter;
        if (r !== "ALL") params.set("role", r);

        const qs = params.toString();
        const url = `${AUTH_BASE_URL}/api/v1/auth/users${qs ? `?${qs}` : ""}`;

        const data = await authFetchJson<UserListResponse>(url);
        setUsers(data.users);
      } catch (err: any) {
        if (err.message !== "Session expired" && err.message !== "No access token") {
          setGlobalError(err.message || "Failed to load users.");
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authFetch, searchTerm, roleFilter],
  );

  useEffect(() => {
    loadUsers("", "ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  function handleSearchChange(value: string) {
    setSearchTerm(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(() => {
      loadUsers(value, roleFilter);
    }, 400);
  }

  function handleRoleFilterChange(role: RoleFilter) {
    setRoleFilter(role);
    loadUsers(searchTerm, role);
  }

  function addPortRow() {
    setForm((f) => ({ ...f, ports: [...f.ports, { label: "", value: "" }] }));
  }

  function removePortRow(index: number) {
    setForm((f) => {
      if (f.ports.length === 1) return f;
      const copy = [...f.ports];
      copy.splice(index, 1);
      return { ...f, ports: copy };
    });
  }

  function updatePortRow(index: number, field: "label" | "value", value: string) {
    setForm((f) => {
      const copy = [...f.ports];
      copy[index] = { ...copy[index], [field]: value };
      return { ...f, ports: copy };
    });
  }

  function openCreateModal() {
    setUserModalMode("create");
    setEditTarget(null);
    setFormErrors({});
    setForm({
      username: "",
      email: "",
      full_name: "",
      password: "",
      role: "USER",
      is_active: true,
      ports: [{ label: "", value: "" }],
    });
    setUserModalOpen(true);
  }

  function openEditModal(target: UserAdminRead) {
    setUserModalMode("edit");
    setEditTarget(target);
    setFormErrors({});

    const existingPorts = getUserPorts(target);

    setForm({
      username: target.username,
      email: target.email,
      full_name: target.full_name,
      password: "", // optionnel
      role: target.role,
      is_active: target.is_active,
      // si aucun port => on garde 1 ligne vide (mais elle ne sera pas envoyée)
      ports:
        existingPorts.length > 0
          ? existingPorts.map((p) => ({ label: p.label ?? "", value: p.value }))
          : [{ label: "", value: "" }],
    });

    setUserModalOpen(true);
  }

  function closeUserModal() {
    if (submitting) return;
    setUserModalOpen(false);
  }

  function validateUserForm(mode: UserModalMode): boolean {
    const e: Record<string, string> = {};

    if (mode === "create") {
      if (!form.username.trim()) e.username = "Username is required.";
      else if (form.username.length < 3 || form.username.length > 32)
        e.username = "Username must be between 3 and 32 characters.";
      else {
        const compact = form.username.replace(/\s+/g, "");
        if (compact && /^\d+$/.test(compact)) {
          e.username = "Username cannot be only digits.";
        }
      }
    }

    if (!form.email.trim()) e.email = "Email is required.";
    else if (!isValidEmail(form.email.trim())) e.email = "Invalid email format.";

    if (!form.full_name.trim()) e.full_name = "Full name is required.";
    else if (form.full_name.trim().length < 2)
      e.full_name = "Full name must be at least 2 characters.";
    else if (!/^[A-Za-zÀ-ÿ]+(?: [A-Za-zÀ-ÿ]+)*$/.test(form.full_name.trim()))
      e.full_name = "Full name must contain only letters and spaces.";

    if (mode === "create") {
      if (!form.password) e.password = "Password is required.";
      else {
        const pwdErr = validatePasswordStrict(form.password);
        if (pwdErr) e.password = pwdErr;
      }
    } else {
      if (form.password.trim()) {
        const pwdErr = validatePasswordStrict(form.password);
        if (pwdErr) e.password = pwdErr;
      }
    }

    // MODIF: Ports obligatoires seulement pour USER.
    const portsAreRequired = form.role === "USER";
    const seenValues = new Set<string>();
    let hasAtLeastOnePortValue = false;

    form.ports.forEach((p, index) => {
      const v = (p.value || "").trim();

      if (!v) {
        if (portsAreRequired) {
          e[`ports.${index}.value`] = "Port value is required.";
        }
        return; // si non requis, on ignore la ligne vide
      }

      hasAtLeastOnePortValue = true;

      if (/\s/.test(v)) e[`ports.${index}.value`] = "Port value must not contain spaces.";
      else if (!/^\d+(\/\d+)*$/.test(v))
        e[`ports.${index}.value`] = "Invalid format. Example: 1/1/7/3";

      if (seenValues.has(v)) {
        e[`ports.${index}.value`] = "Duplicate port value is not allowed.";
      }
      seenValues.add(v);
    });

    if (portsAreRequired && !hasAtLeastOnePortValue) {
      e.ports = "At least one port is required for USER role.";
    }

    setFormErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmitUserForm(e?: any) {
    e?.preventDefault?.();
    setFormErrors({});

    if (!validateUserForm(userModalMode)) return;

    setSubmitting(true);

    try {
      const portsPayload = normalizePortsForPayload(form.ports);

      if (userModalMode === "create") {
        const payload: AdminUserCreatePayload = {
          username: form.username,
          email: form.email,
          full_name: form.full_name,
          password: form.password,
          role: form.role,
        };

        // MODIF: n'envoyer ports que si on en a vraiment
        // (USER => validation garantit >= 1)
        if (portsPayload.length > 0) payload.ports = portsPayload;

        await authFetchJson(`${AUTH_BASE_URL}/api/v1/auth/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        toast.success("User created successfully.");
      } else {
        if (!editTarget) throw new Error("No user selected.");

        const payload: AdminUserUpdatePayload = {
          email: form.email,
          full_name: form.full_name,
          is_active: form.is_active,
        };

        // role au même endroit (uniquement SUPER_ADMIN)
        if (isSuperAdmin) payload.role = form.role;

        // password optionnel
        if (form.password.trim()) payload.password = form.password;

        // MODIF: n'envoyer ports que si l'admin a saisi au moins un port
        // (sinon on ne touche pas aux ports côté backend)
        if (portsPayload.length > 0) payload.ports = portsPayload;

        await authFetchJson(`${AUTH_BASE_URL}/api/v1/auth/users/${editTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        toast.success("User updated successfully.");
      }

      setUserModalOpen(false);
      setEditTarget(null);
      await loadUsers(searchTerm, roleFilter);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
          setFormErrors(err.fieldErrors);
        } else {
          setFormErrors({ general: err.message || "Request failed." });
        }
      } else {
        setFormErrors({ general: err?.message || "Request failed." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteUser(target: UserAdminRead) {
    if (target.role === "SUPER_ADMIN") {
      toast.error("SUPER_ADMIN users cannot be deleted.");
      return;
    }

    if (isAdmin && target.role === "ADMIN") {
      toast.error("ADMIN users cannot delete other ADMIN users.");
      return;
    }

    if (user?.username === target.username) {
      toast.error("You cannot delete your own account here.");
      return;
    }

    openDeleteDialog(target);
  }

  async function handleConfirmDialog() {
    const { type, target } = confirmDialog;
    if (!type || !target) return;

    setConfirmDialog((prev) => ({ ...prev, loading: true }));

    if (type === "delete-user") {
      setDeletingUserId(target.id);
      const toastId = toast.loading("Deleting user...");

      try {
        await authFetchJson(`${AUTH_BASE_URL}/api/v1/auth/users/${target.id}`, {
          method: "DELETE",
        });

        await loadUsers(searchTerm, roleFilter);
        toast.success("User deleted successfully.", { id: toastId });
      } catch (err: any) {
        toast.error(err.message || "Failed to delete user.", { id: toastId });
      } finally {
        setDeletingUserId(null);
        setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      }
    }
  }

  const stats = useMemo(() => {
    const totalUsers = users.length;
    const totalAdmins = users.filter(
      (u) => u.role === "ADMIN" || u.role === "SUPER_ADMIN",
    ).length;
    const totalStandardUsers = users.filter((u) => u.role === "USER").length;
    const totalPorts = users.reduce((acc, u) => acc + getUserPorts(u).length, 0);
    return { totalUsers, totalAdmins, totalStandardUsers, totalPorts };
  }, [users]);

  // Permissions UI pour edit role
  const editingSelf = userModalMode === "edit" && editTarget && user?.username === editTarget.username;
  const editingSuperAdminTarget = userModalMode === "edit" && editTarget?.role === "SUPER_ADMIN";
  const canEditRoleField = isSuperAdmin && !editingSelf && !editingSuperAdminTarget;

  const confirmTitle =
    confirmDialog.type === "delete-user"
      ? `Delete ${confirmDialog.target?.username ?? "user"}?`
      : "";

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  User Management
                </h2>
                <Badge variant="info">Admin Console</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Create and manage users, roles and assigned ports.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="outline"
                onClick={() => loadUsers(searchTerm, roleFilter)}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCcw size={14} />
                )}
                Refresh
              </Btn>

              <Btn variant="primary" onClick={openCreateModal}>
                <Plus size={16} />
                Add User
              </Btn>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <Input
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by username, email, full name..."
                  className="pl-9"
                />
              </div>

              <SegmentedFilter
                value={roleFilter}
                onChange={handleRoleFilterChange}
                items={["ALL", "SUPER_ADMIN", "ADMIN", "USER"]}
              />
            </div>
          </div>
        </div>

        {globalError && <AlertBanner variant="error">{globalError}</AlertBanner>}

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Users"
            value={stats.totalUsers}
            subtitle="All accounts"
            icon={<Users size={18} />}
            tone="info"
          />
          <StatCard
            title="Admins"
            value={stats.totalAdmins}
            subtitle="ADMIN + SUPER_ADMIN"
            icon={<ShieldCheck size={18} />}
            tone="warning"
          />
          <StatCard
            title="Standard Users"
            value={stats.totalStandardUsers}
            subtitle="Role USER"
            icon={<UserCog size={18} />}
            tone="success"
          />
          <StatCard
            title="Assigned Ports"
            value={stats.totalPorts}
            subtitle="Sum of all user ports"
            icon={<Cable size={18} />}
            tone="purple"
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-3">
            <SectionTitle
              icon={Users}
              title="Users"
              description={`${users.length} user(s) displayed`}
              badge={
                isSuperAdmin ? (
                  <Badge variant="info">
                    <ShieldCheck size={12} />
                    Full edit enabled
                  </Badge>
                ) : (
                  <Badge variant="default">Read / Limited actions</Badge>
                )
              }
            />

            <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
              <Clock size={12} />
              Live data
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading users...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      User
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Contact
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Role
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Ports
                    </th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => {
                    const ports = getUserPorts(u);
                    const isCurrentUser = user?.username === u.username;

                    const isDeleting = deletingUserId === u.id;

                    const canDelete =
                      !isCurrentUser &&
                      u.role !== "SUPER_ADMIN" &&
                      !(isAdmin && u.role === "ADMIN");

                    const canEdit =
                      !(isAdmin && u.role !== "USER"); // admin: only edit USER

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <AvatarCircle name={u.full_name} username={u.username} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 font-mono">
                                  {u.username}
                                </span>
                                {isCurrentUser && <Badge variant="info">You</Badge>}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                {u.full_name}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-2 text-slate-700">
                            <Mail size={14} className="mt-0.5 text-slate-400" />
                            <span className="break-all">{u.email}</span>
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <RoleBadge role={u.role} />
                            {u.role === "SUPER_ADMIN" && !isCurrentUser && (
                              <span className="text-[10px] text-slate-400 italic">
                                protected
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top">
                          <StatusBadge active={u.is_active} />
                        </td>

                        <td className="px-5 py-4 align-top">
                          {ports.length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs text-slate-500">
                                {ports.length} port(s)
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-w-[420px]">
                                {ports.slice(0, 4).map((p, index) => (
                                  <span
                                    key={`${p.id}-${index}-${p.value}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                                  >
                                    {p.label ? (
                                      <span className="text-slate-500">
                                        {p.label}:
                                      </span>
                                    ) : null}
                                    <span className="font-mono">{p.value}</span>
                                  </span>
                                ))}
                                {ports.length > 4 && (
                                  <Badge variant="info">+{ports.length - 4} more</Badge>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No ports</span>
                          )}
                        </td>

                        <td className="px-5 py-4 align-top text-right">
                          <div className="inline-flex items-center gap-2">
                            <Btn
                              variant="outline"
                              size="sm"
                              onClick={() => openEditModal(u)}
                              disabled={!canEdit}
                              title={
                                !canEdit
                                  ? "You do not have permission to edit this user."
                                  : "Edit user"
                              }
                            >
                              <Pencil size={14} />
                              Edit
                            </Btn>

                            <Btn
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteUser(u)}
                              disabled={!canDelete || isDeleting}
                              title={
                                isCurrentUser
                                  ? "You cannot delete your own account here."
                                  : u.role === "SUPER_ADMIN"
                                    ? "SUPER_ADMIN users cannot be deleted."
                                    : isAdmin && u.role === "ADMIN"
                                      ? "ADMIN users cannot delete other ADMINs."
                                      : "Delete user"
                              }
                            >
                              {isDeleting ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                              Delete
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {users.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-sm text-slate-500"
                      >
                        No users found for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create/Edit User Modal */}
        {userModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm p-4 flex items-center justify-center overflow-y-auto">
            <div className="mx-auto my-8 w-full max-w-3xl">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
                  <SectionTitle
                    icon={userModalMode === "create" ? Plus : Pencil}
                    title={userModalMode === "create" ? "Add User" : "Edit User"}
                    description={
                      userModalMode === "create"
                        ? "Create a new user and assign one or more ports."
                        : "Update user information (username cannot be changed)."
                    }
                    badge={
                      <Badge variant="info">
                        {userModalMode === "create" ? "Create" : "Edit"}
                      </Badge>
                    }
                  />
                  <button
                    onClick={closeUserModal}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    disabled={submitting}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
                  <div className="p-6">
                    {formErrors.general && (
                      <AlertBanner variant="error">{formErrors.general}</AlertBanner>
                    )}

                    <form onSubmit={handleSubmitUserForm} className="mt-4 space-y-5">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <FieldLabel required={userModalMode === "create"}>
                            Username
                          </FieldLabel>
                          <Input
                            value={form.username}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, username: e.target.value }))
                            }
                            disabled={userModalMode === "edit"}
                            className={cn(
                              userModalMode === "edit" && "bg-slate-100",
                              formErrors.username &&
                                "border-red-400 focus:ring-red-300 focus:border-red-400",
                            )}
                          />
                          {userModalMode === "edit" && (
                            <div className="mt-1 text-[11px] text-slate-500">
                              Username cannot be changed.
                            </div>
                          )}
                          {formErrors.username && (
                            <div className="mt-1 text-xs text-red-600">
                              {formErrors.username}
                            </div>
                          )}
                        </div>

                        <div>
                          <FieldLabel required>Email</FieldLabel>
                          <Input
                            value={form.email}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, email: e.target.value }))
                            }
                            className={cn(
                              formErrors.email &&
                                "border-red-400 focus:ring-red-300 focus:border-red-400",
                            )}
                          />
                          {formErrors.email && (
                            <div className="mt-1 text-xs text-red-600">
                              {formErrors.email}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <FieldLabel required>Full name</FieldLabel>
                        <Input
                          value={form.full_name}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, full_name: e.target.value }))
                          }
                          className={cn(
                            formErrors.full_name &&
                              "border-red-400 focus:ring-red-300 focus:border-red-400",
                          )}
                        />
                        {formErrors.full_name && (
                          <div className="mt-1 text-xs text-red-600">
                            {formErrors.full_name}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="md:col-span-1">
                          <FieldLabel required={userModalMode === "create"}>
                            Password
                          </FieldLabel>
                          <Input
                            type="password"
                            value={form.password}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, password: e.target.value }))
                            }
                            placeholder={userModalMode === "edit" ? "Leave blank to keep" : ""}
                            className={cn(
                              formErrors.password &&
                                "border-red-400 focus:ring-red-300 focus:border-red-400",
                            )}
                          />
                          {formErrors.password && (
                            <div className="mt-1 text-xs text-red-600">
                              {formErrors.password}
                            </div>
                          )}
                        </div>

                        <div className="md:col-span-1">
                          <FieldLabel>Role</FieldLabel>
                          <Select
                            value={form.role}
                            disabled={userModalMode === "edit" ? !canEditRoleField : !isSuperAdmin}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, role: e.target.value as UserRole }))
                            }
                            className={cn(
                              userModalMode === "edit" && !canEditRoleField && "bg-slate-100",
                              userModalMode === "create" && !isSuperAdmin && "bg-slate-100",
                            )}
                          >
                            {isSuperAdmin && <option value="SUPER_ADMIN">SUPER_ADMIN</option>}
                            {(isSuperAdmin || userModalMode === "edit") && (
                              <option value="ADMIN">ADMIN</option>
                            )}
                            <option value="USER">USER</option>
                          </Select>
                        </div>

                        <div className="md:col-span-1">
                          <FieldLabel>Status</FieldLabel>
                          <Select
                            value={form.is_active ? "ACTIVE" : "INACTIVE"}
                            disabled={userModalMode === "create"}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, is_active: e.target.value === "ACTIVE" }))
                            }
                            className={cn(userModalMode === "create" && "bg-slate-100")}
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </Select>
                        </div>
                      </div>

                      {/* Ports */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50/60">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              Assigned Ports
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              Ports are required only for USER role. (ADMIN/SUPER_ADMIN can be created without ports)
                            </div>
                          </div>

                          <Btn
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={addPortRow}
                          >
                            <Plus size={14} />
                            Add port
                          </Btn>
                        </div>

                        <div className="p-4 space-y-3">
                          {formErrors.ports && (
                            <AlertBanner variant="error">{formErrors.ports}</AlertBanner>
                          )}

                          <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2">
                            {form.ports.map((p, index) => (
                              <div
                                key={index}
                                className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-[1fr_1fr_auto]"
                              >
                                <div>
                                  <FieldLabel>Label</FieldLabel>
                                  <Input
                                    value={p.label}
                                    onChange={(e) =>
                                      updatePortRow(index, "label", e.target.value)
                                    }
                                    placeholder="ex: Client A"
                                  />
                                </div>

                                <div>
                                  <FieldLabel required={form.role === "USER"}>
                                    Port value
                                  </FieldLabel>
                                  <Input
                                    value={p.value}
                                    onChange={(e) =>
                                      updatePortRow(index, "value", e.target.value)
                                    }
                                    placeholder="ex: 1/1/7/3/95"
                                    className={cn(
                                      formErrors[`ports.${index}.value`] &&
                                        "border-red-400 focus:ring-red-300 focus:border-red-400",
                                      "font-mono",
                                    )}
                                  />
                                  {formErrors[`ports.${index}.value`] && (
                                    <div className="mt-1 text-xs text-red-600">
                                      {formErrors[`ports.${index}.value`]}
                                    </div>
                                  )}
                                </div>

                                <div className="md:pt-7">
                                  <Btn
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removePortRow(index)}
                                    disabled={form.ports.length === 1}
                                    title="Remove this port"
                                    className="border border-slate-200"
                                  >
                                    <X size={14} />
                                  </Btn>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <Btn type="button" variant="outline" onClick={closeUserModal}>
                          Cancel
                        </Btn>

                        <Btn type="submit" variant="primary" disabled={submitting}>
                          {submitting ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              Saving...
                            </>
                          ) : userModalMode === "create" ? (
                            <>
                              <Plus size={16} />
                              Create user
                            </>
                          ) : (
                            <>
                              <Pencil size={16} />
                              Save changes
                            </>
                          )}
                        </Btn>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmTitle}
        confirmText="Delete"
        cancelText="Cancel"
        loading={confirmDialog.loading}
        variant="danger"
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialog.type === "delete-user" && confirmDialog.target && (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">User</span>
              <span className="font-semibold text-slate-900">
                {confirmDialog.target.username}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Role</span>
              <span className="font-semibold text-slate-700">
                {confirmDialog.target.role}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Email</span>
              <span className="break-all text-slate-900">
                {confirmDialog.target.email}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Assigned ports</span>
              <span className="font-semibold text-slate-900">
                {getUserPorts(confirmDialog.target).length}
              </span>
            </div>

            <AlertBanner variant="error">This action is irreversible.</AlertBanner>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

/* ================================================================
   Confirm Dialog
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
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              variant === "danger" &&
                "bg-red-600 hover:bg-red-700 border-red-600",
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