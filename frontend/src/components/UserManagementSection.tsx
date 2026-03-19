import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../context/AuthContext";
import { cn } from "../utils/cn";
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
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

const AUTH_BASE_URL = "http://127.0.0.1:9000";

type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER";
type RoleFilter = "ALL" | UserRole;
type ConfirmActionType = "change-role" | "delete-user";

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

interface AdminUserCreatePayload {
  username: string;
  email: string;
  full_name: string;
  password: string;
  role: UserRole;
  ports: PortForm[];
}

interface ConfirmDialogState {
  open: boolean;
  type: ConfirmActionType | null;
  target: UserAdminRead | null;
  newRole: UserRole | null;
  loading: boolean;
}

const EMPTY_CONFIRM_DIALOG: ConfirmDialogState = {
  open: false,
  type: null,
  target: null,
  newRole: null,
  loading: false,
};

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

function roleToBadgeVariant(role: UserRole): BadgeProps["variant"] {
  if (role === "SUPER_ADMIN") return "danger";
  if (role === "ADMIN") return "warning";
  return "success";
}

/* ================================================================
   UI Primitives — Enterprise (same style as your “B”)
   ================================================================ */

type BadgeProps = {
  children: React.ReactNode;
  variant?: "default" | "info" | "success" | "warning" | "danger" | "purple";
  className?: string;
};

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
      <div>{children}</div>
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

function AvatarCircle({
  name,
  username,
}: {
  name: string;
  username: string;
}) {
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

function RoleSelector({
  currentRole,
  busy,
  onChange,
}: {
  currentRole: UserRole;
  busy: boolean;
  onChange: (newRole: UserRole) => void;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={currentRole}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as UserRole)}
        className={cn(
          "appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800",
          "outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-400",
          "disabled:opacity-50 disabled:cursor-wait",
        )}
      >
        <option value="ADMIN">ADMIN</option>
        <option value="USER">USER</option>
      </select>

      {busy ? (
        <Loader2
          size={14}
          className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-500"
        />
      ) : (
        <ChevronDown
          size={14}
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500"
        />
      )}
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
    <div className={cn("rounded-xl border border-slate-200 shadow-sm", tones[tone])}>
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

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AdminUserCreatePayload>({
    username: "",
    email: "",
    full_name: "",
    password: "",
    role: "USER",
    ports: [{ label: "", value: "" }],
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [changingRoleFor, setChangingRoleFor] = useState<number | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState>(EMPTY_CONFIRM_DIALOG);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isAdmin = user?.role === "ADMIN";

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function authFetchJson<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> {
    const res = await authFetch(url, options);

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

  function closeConfirmDialog() {
    if (confirmDialog.loading) return;
    setConfirmDialog(EMPTY_CONFIRM_DIALOG);
  }

  function openRoleChangeDialog(target: UserAdminRead, newRole: UserRole) {
    setConfirmDialog({
      open: true,
      type: "change-role",
      target,
      newRole,
      loading: false,
    });
  }

  function openDeleteDialog(target: UserAdminRead) {
    setConfirmDialog({
      open: true,
      type: "delete-user",
      target,
      newRole: null,
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
        if (
          err.message !== "Session expired" &&
          err.message !== "No access token"
        ) {
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

  function handleChangeRole(target: UserAdminRead, newRole: UserRole) {
    if (newRole === target.role) return;

    if (!isSuperAdmin) {
      toast.error("Only SUPER_ADMIN can change user roles.");
      return;
    }

    if (target.role === "SUPER_ADMIN") {
      toast.error("Cannot change the role of a SUPER_ADMIN user.");
      return;
    }

    openRoleChangeDialog(target, newRole);
  }

  function validateForm(): boolean {
    const e: Record<string, string> = {};

    if (!form.username.trim()) e.username = "Username is required.";
    else if (form.username.length < 3 || form.username.length > 32)
      e.username = "Username must be between 3 and 32 characters.";

    if (!form.email.trim()) e.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Invalid email format.";

    if (!form.full_name.trim()) e.full_name = "Full name is required.";
    else if (form.full_name.length < 3)
      e.full_name = "Full name must be at least 3 characters.";

    if (!form.password) e.password = "Password is required.";
    else if (form.password.length < 8)
      e.password = "Password must be at least 8 characters.";

    if (!form.ports || form.ports.length === 0) {
      e.ports = "At least one port is required.";
    } else {
      form.ports.forEach((p, index) => {
        if (!p.value.trim()) e[`ports.${index}.value`] = "Port value is required.";
      });
    }

    setFormErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormErrors({});
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      await authFetchJson(`${AUTH_BASE_URL}/api/v1/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      setShowAdd(false);
      setForm({
        username: "",
        email: "",
        full_name: "",
        password: "",
        role: "USER",
        ports: [{ label: "", value: "" }],
      });

      await loadUsers(searchTerm, roleFilter);
      toast.success("User created successfully.");
    } catch (err: any) {
      setFormErrors({ general: err.message || "Failed to create user." });
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

    openDeleteDialog(target);
  }

  async function handleConfirmDialog() {
    const { type, target, newRole } = confirmDialog;
    if (!type || !target) return;

    setConfirmDialog((prev) => ({ ...prev, loading: true }));

    if (type === "change-role" && newRole) {
      setChangingRoleFor(target.id);
      const toastId = toast.loading("Updating role...");

      try {
        await authFetchJson(`${AUTH_BASE_URL}/api/v1/auth/users/${target.id}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        });

        await loadUsers(searchTerm, roleFilter);
        toast.success(`${target.username} is now ${newRole}.`, { id: toastId });
      } catch (err: any) {
        try {
          await loadUsers(searchTerm, roleFilter);
        } catch {
          // ignore
        }
        toast.error(err.message || "Failed to change user role.", { id: toastId });
      } finally {
        setChangingRoleFor(null);
        setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      }
      return;
    }

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

  function updatePortRow(
    index: number,
    field: "label" | "value",
    value: string,
  ) {
    setForm((f) => {
      const copy = [...f.ports];
      copy[index] = { ...copy[index], [field]: value };
      return { ...f, ports: copy };
    });
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

  const confirmTitle =
    confirmDialog.type === "change-role"
      ? "Change role?"
      : confirmDialog.type === "delete-user"
        ? `Delete ${confirmDialog.target?.username ?? "user"}?`
        : "";

  const confirmText =
    confirmDialog.type === "change-role"
      ? "Change role"
      : confirmDialog.type === "delete-user"
        ? "Delete"
        : "Confirm";

  const confirmVariant =
    confirmDialog.type === "delete-user" ? "danger" : "primary";

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
              <Btn variant="outline" onClick={() => loadUsers(searchTerm, roleFilter)} disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                Refresh
              </Btn>

              <Btn variant="primary" onClick={() => setShowAdd(true)}>
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
                    Role changes enabled
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

                    const isChangingRole = changingRoleFor === u.id;
                    const isDeleting = deletingUserId === u.id;

                    const canChangeRole =
                      isSuperAdmin && !isCurrentUser && u.role !== "SUPER_ADMIN";

                    const canDelete =
                      !isCurrentUser &&
                      u.role !== "SUPER_ADMIN" &&
                      !(isAdmin && u.role === "ADMIN");

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        {/* User */}
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <AvatarCircle name={u.full_name} username={u.username} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 font-mono">
                                  {u.username}
                                </span>
                                {isCurrentUser && (
                                  <Badge variant="info">You</Badge>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                {u.full_name}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-2 text-slate-700">
                            <Mail size={14} className="mt-0.5 text-slate-400" />
                            <span className="break-all">{u.email}</span>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-5 py-4 align-top">
                          {canChangeRole ? (
                            <RoleSelector
                              currentRole={u.role}
                              busy={isChangingRole}
                              onChange={(newRole) => handleChangeRole(u, newRole)}
                            />
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <RoleBadge role={u.role} />
                              {u.role === "SUPER_ADMIN" && !isCurrentUser && (
                                <span className="text-[10px] text-slate-400 italic">
                                  protected
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4 align-top">
                          <StatusBadge active={u.is_active} />
                        </td>

                        {/* Ports */}
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
                                  <Badge variant="info">
                                    +{ports.length - 4} more
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              No ports
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 align-top text-right">
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

        {/* Add User Modal */}
        {showAdd && (
          <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm p-4">
            <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4">
                <SectionTitle
                  icon={Plus}
                  title="Add User"
                  description="Create a new user and assign one or more ports."
                  badge={<Badge variant="info">Create</Badge>}
                />
                <button
                  onClick={() => setShowAdd(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-6">
                {formErrors.general && (
                  <AlertBanner variant="error">{formErrors.general}</AlertBanner>
                )}

                <form onSubmit={handleCreateUser} className="mt-4 space-y-5">
                  {/* Identity */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel required>Username</FieldLabel>
                      <Input
                        value={form.username}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, username: e.target.value }))
                        }
                        className={cn(formErrors.username && "border-red-400 focus:ring-red-300 focus:border-red-400")}
                      />
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
                        className={cn(formErrors.email && "border-red-400 focus:ring-red-300 focus:border-red-400")}
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
                      className={cn(formErrors.full_name && "border-red-400 focus:ring-red-300 focus:border-red-400")}
                    />
                    {formErrors.full_name && (
                      <div className="mt-1 text-xs text-red-600">
                        {formErrors.full_name}
                      </div>
                    )}
                  </div>

                  {/* Password / Role */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel required>Password</FieldLabel>
                      <Input
                        type="password"
                        value={form.password}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, password: e.target.value }))
                        }
                        className={cn(formErrors.password && "border-red-400 focus:ring-red-300 focus:border-red-400")}
                      />
                      {formErrors.password && (
                        <div className="mt-1 text-xs text-red-600">
                          {formErrors.password}
                        </div>
                      )}
                    </div>

                    <div>
                      <FieldLabel>Role</FieldLabel>
                      <Select
                        value={form.role}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            role: e.target.value as UserRole,
                          }))
                        }
                      >
                        {isSuperAdmin && (
                          <>
                            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                            <option value="ADMIN">ADMIN</option>
                          </>
                        )}
                        <option value="USER">USER</option>
                      </Select>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {isSuperAdmin
                          ? "SUPER_ADMIN can create admins and super admins."
                          : "Admins typically create standard users."}
                      </div>
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
                          Add one or more ports for this user.
                        </div>
                      </div>

                      <Btn type="button" size="sm" variant="outline" onClick={addPortRow}>
                        <Plus size={14} />
                        Add port
                      </Btn>
                    </div>

                    <div className="p-4 space-y-3">
                      {formErrors.ports && (
                        <AlertBanner variant="error">{formErrors.ports}</AlertBanner>
                      )}

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
                            <FieldLabel required>Port value</FieldLabel>
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

                  {/* Actions */}
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                    <Btn type="button" variant="outline" onClick={() => setShowAdd(false)}>
                      Cancel
                    </Btn>
                    <Btn type="submit" variant="primary" disabled={submitting}>
                      {submitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus size={16} />
                          Create user
                        </>
                      )}
                    </Btn>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmTitle}
        confirmText={confirmText}
        cancelText="Cancel"
        loading={confirmDialog.loading}
        variant={confirmVariant}
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialog.type === "change-role" &&
          confirmDialog.target &&
          confirmDialog.newRole && (
            <div className="space-y-3 text-sm text-slate-600">
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <span className="text-slate-500">User</span>
                <span className="font-semibold text-slate-900">
                  {confirmDialog.target.username}
                </span>
              </div>

              <div className="grid grid-cols-[90px_1fr] gap-3">
                <span className="text-slate-500">Current</span>
                <span className="font-semibold text-slate-700">
                  {confirmDialog.target.role}
                </span>
              </div>

              <div className="grid grid-cols-[90px_1fr] gap-3">
                <span className="text-slate-500">New role</span>
                <span className="font-semibold text-slate-900">
                  <RoleBadge role={confirmDialog.newRole} />
                </span>
              </div>

              <AlertBanner variant="warning">
                This change is immediate and impacts user permissions.
              </AlertBanner>
            </div>
          )}

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

            <AlertBanner variant="error">
              This action is irreversible.
            </AlertBanner>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

/* ================================================================
   Confirm Dialog — Enterprise (with loading + Btn)
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
              variant === "danger" && "bg-red-600 hover:bg-red-700 border-red-600",
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