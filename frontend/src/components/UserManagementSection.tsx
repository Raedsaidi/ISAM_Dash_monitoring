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

/* ---------- helpers ---------- */

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

/* ---------- role style map ---------- */

const ROLE_STYLES: Record<
  UserRole,
  { bg: string; text: string; ring: string }
> = {
  SUPER_ADMIN: {
    bg: "bg-red-100",
    text: "text-red-700",
    ring: "focus:ring-red-400",
  },
  ADMIN: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    ring: "focus:ring-amber-400",
  },
  USER: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    ring: "focus:ring-emerald-400",
  },
};

/* ---------- small components ---------- */

function RoleBadge({ role }: { role: UserRole }) {
  const s = ROLE_STYLES[role] ?? ROLE_STYLES.USER;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        s.bg,
        s.text,
      )}
    >
      {role}
    </span>
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
  const s = ROLE_STYLES[currentRole] ?? ROLE_STYLES.USER;

  return (
    <div className="relative inline-flex items-center">
      <select
        value={currentRole}
        disabled={busy}
        onChange={(e) => onChange(e.target.value as UserRole)}
        className={cn(
          "appearance-none rounded-full pl-2.5 pr-7 py-1 text-[11px] font-semibold uppercase tracking-wide",
          "cursor-pointer border-0 focus:outline-none focus:ring-2",
          "disabled:opacity-50 disabled:cursor-wait",
          s.bg,
          s.text,
          s.ring,
        )}
      >
        <option value="ADMIN">ADMIN</option>
        <option value="USER">USER</option>
      </select>
      {busy ? (
        <Loader2
          size={10}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 animate-spin",
            s.text,
          )}
        />
      ) : (
        <ChevronDown
          size={10}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none",
            s.text,
          )}
        />
      )}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
        active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600",
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </div>
        <div className={cn("p-3 rounded-xl", color)}>{icon}</div>
      </div>
    </div>
  );
}

/* ========== MAIN COMPONENT ========== */

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

  /* ---------- authFetchJson using authFetch from context ---------- */

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

  /* ---------- dialog helpers ---------- */

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

  /* ---------- load users from backend ---------- */

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

  /* Initial load */
  useEffect(() => {
    loadUsers("", "ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  /* ---------- debounced search ---------- */

  function handleSearchChange(value: string) {
    setSearchTerm(value);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    searchTimerRef.current = setTimeout(() => {
      loadUsers(value, roleFilter);
    }, 400);
  }

  /* ---------- role filter change ---------- */

  function handleRoleFilterChange(role: RoleFilter) {
    setRoleFilter(role);
    loadUsers(searchTerm, role);
  }

  /* ---------- change role ---------- */

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

  /* ---------- create user ---------- */

  function validateForm(): boolean {
    const e: Record<string, string> = {};

    if (!form.username.trim()) {
      e.username = "Username is required.";
    } else if (form.username.length < 3 || form.username.length > 32) {
      e.username = "Username must be between 3 and 32 characters.";
    }

    if (!form.email.trim()) {
      e.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = "Invalid email format.";
    }

    if (!form.full_name.trim()) {
      e.full_name = "Full name is required.";
    } else if (form.full_name.length < 3) {
      e.full_name = "Full name must be at least 3 characters.";
    }

    if (!form.password) {
      e.password = "Password is required.";
    } else if (form.password.length < 8) {
      e.password = "Password must be at least 8 characters.";
    }

    if (!form.ports || form.ports.length === 0) {
      e.ports = "At least one port is required.";
    } else {
      form.ports.forEach((p, index) => {
        if (!p.value.trim()) {
          e[`ports.${index}.value`] = "Port value is required.";
        }
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

      toast.success("The user has been created successfully.");
    } catch (err: any) {
      setFormErrors({ general: err.message || "Failed to create user." });
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- delete user ---------- */

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

  /* ---------- confirm dialog action ---------- */

  async function handleConfirmDialog() {
    const { type, target, newRole } = confirmDialog;

    if (!type || !target) return;

    setConfirmDialog((prev) => ({ ...prev, loading: true }));

    if (type === "change-role" && newRole) {
      setChangingRoleFor(target.id);
      const toastId = toast.loading("Updating role...");

      try {
        await authFetchJson(
          `${AUTH_BASE_URL}/api/v1/auth/users/${target.id}/role`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole }),
          },
        );

        await loadUsers(searchTerm, roleFilter);

        toast.success(`${target.username} is now ${newRole}.`, {
          id: toastId,
        });
      } catch (err: any) {
        try {
          await loadUsers(searchTerm, roleFilter);
        } catch {
          // ignore reload error here
        }

        toast.error(err.message || "Failed to change user role.", {
          id: toastId,
        });
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

        toast.success("The user has been deleted successfully.", {
          id: toastId,
        });
      } catch (err: any) {
        toast.error(err.message || "Failed to delete user.", {
          id: toastId,
        });
      } finally {
        setDeletingUserId(null);
        setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      }
    }
  }

  /* ---------- port rows ---------- */

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

  /* ---------- stats ---------- */

  const stats = useMemo(() => {
    const totalUsers = users.length;
    const totalAdmins = users.filter(
      (u) => u.role === "ADMIN" || u.role === "SUPER_ADMIN",
    ).length;
    const totalStandardUsers = users.filter((u) => u.role === "USER").length;
    const totalPorts = users.reduce(
      (acc, u) => acc + getUserPorts(u).length,
      0,
    );
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
      ? "Yes, change role"
      : confirmDialog.type === "delete-user"
        ? "Yes, delete"
        : "Confirm";

  const confirmVariant =
    confirmDialog.type === "delete-user" ? "danger" : "primary";

  /* ========== RENDER ========== */

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              User Management
            </h2>
            <p className="text-sm text-slate-500">
              Create and manage users, roles and assigned ports.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add User
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            title="Total Users"
            value={stats.totalUsers}
            subtitle="All registered accounts"
            icon={<Users size={20} className="text-blue-600" />}
            color="bg-blue-50"
          />
          <StatCard
            title="Admins"
            value={stats.totalAdmins}
            subtitle="ADMIN + SUPER_ADMIN"
            icon={<ShieldCheck size={20} className="text-amber-600" />}
            color="bg-amber-50"
          />
          <StatCard
            title="Standard Users"
            value={stats.totalStandardUsers}
            subtitle="Users with USER role"
            icon={<UserCog size={20} className="text-emerald-600" />}
            color="bg-emerald-50"
          />
          <StatCard
            title="Assigned Ports"
            value={stats.totalPorts}
            subtitle="Ports linked to all users"
            icon={<Cable size={20} className="text-purple-600" />}
            color="bg-purple-50"
          />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search by username, email or full name..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(["ALL", "SUPER_ADMIN", "ADMIN", "USER"] as RoleFilter[]).map(
                (role) => (
                  <button
                    key={role}
                    onClick={() => handleRoleFilterChange(role)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-full transition-colors",
                      roleFilter === role
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {role === "ALL" ? "All roles" : role}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {globalError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {globalError}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading users...
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Users List
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {users.length} user(s) displayed
                  </p>
                </div>
                {isSuperAdmin && (
                  <p className="text-[11px] text-slate-400 italic">
                    Use the role dropdown to change a user's role
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Ports
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
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
                      <tr
                        key={u.id}
                        className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                              {getInitials(u.full_name || u.username)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold text-slate-900 font-mono">
                                  {u.username}
                                </div>
                                {isCurrentUser && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
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
                          {canChangeRole ? (
                            <RoleSelector
                              currentRole={u.role}
                              busy={isChangingRole}
                              onChange={(newRole) => handleChangeRole(u, newRole)}
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <RoleBadge role={u.role} />
                              {isCurrentUser && (isSuperAdmin || isAdmin) && (
                                <span className="text-[10px] text-slate-400 italic">
                                  (you)
                                </span>
                              )}
                              {!isCurrentUser && u.role === "SUPER_ADMIN" && (
                                <span className="text-[10px] text-slate-400 italic">
                                  (protected)
                                </span>
                              )}
                            </div>
                          )}
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
                              <div className="flex flex-wrap gap-1.5 max-w-[360px]">
                                {ports.slice(0, 4).map((p, index) => (
                                  <span
                                    key={`${p.id}-${index}-${p.value}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700"
                                  >
                                    {p.label ? <span>{p.label}</span> : null}
                                    <span className="font-mono">{p.value}</span>
                                  </span>
                                ))}
                                {ports.length > 4 && (
                                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700">
                                    +{ports.length - 4} more
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              No ports
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4 align-top text-right">
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {users.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm text-slate-500"
                      >
                        No users found for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---- Add User Modal ---- */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Add User
                  </h3>
                  <p className="text-sm text-slate-500">
                    Create a new user and assign one or more ports.
                  </p>
                </div>
                <button
                  onClick={() => setShowAdd(false)}
                  className="h-9 w-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-6">
                {formErrors.general && (
                  <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {formErrors.general}
                  </div>
                )}

                <form onSubmit={handleCreateUser} className="space-y-5 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1.5">
                        Username
                      </label>
                      <input
                        value={form.username}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, username: e.target.value }))
                        }
                        className={cn(
                          "w-full border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2",
                          formErrors.username
                            ? "border-red-400 focus:ring-red-500"
                            : "border-slate-300 focus:ring-blue-500",
                        )}
                      />
                      {formErrors.username && (
                        <div className="text-xs text-red-500 mt-1">
                          {formErrors.username}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 mb-1.5">
                        Email
                      </label>
                      <input
                        value={form.email}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, email: e.target.value }))
                        }
                        className={cn(
                          "w-full border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2",
                          formErrors.email
                            ? "border-red-400 focus:ring-red-500"
                            : "border-slate-300 focus:ring-blue-500",
                        )}
                      />
                      {formErrors.email && (
                        <div className="text-xs text-red-500 mt-1">
                          {formErrors.email}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">
                      Full name
                    </label>
                    <input
                      value={form.full_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, full_name: e.target.value }))
                      }
                      className={cn(
                        "w-full border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2",
                        formErrors.full_name
                          ? "border-red-400 focus:ring-red-500"
                          : "border-slate-300 focus:ring-blue-500",
                      )}
                    />
                    {formErrors.full_name && (
                      <div className="text-xs text-red-500 mt-1">
                        {formErrors.full_name}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1.5">
                        Password
                      </label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, password: e.target.value }))
                        }
                        className={cn(
                          "w-full border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2",
                          formErrors.password
                            ? "border-red-400 focus:ring-red-500"
                            : "border-slate-300 focus:ring-blue-500",
                        )}
                      />
                      {formErrors.password && (
                        <div className="text-xs text-red-500 mt-1">
                          {formErrors.password}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block font-medium text-slate-700 mb-1.5">
                        Role
                      </label>
                      <select
                        value={form.role}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            role: e.target.value as UserRole,
                          }))
                        }
                        className="w-full border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {isSuperAdmin && (
                          <>
                            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                            <option value="ADMIN">ADMIN</option>
                          </>
                        )}
                        <option value="USER">USER</option>
                      </select>
                    </div>
                  </div>

                  {/* Ports */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <label className="block font-medium text-slate-800">
                          Assigned Ports
                        </label>
                        <p className="text-xs text-slate-500">
                          Add one or more ports for this user.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addPortRow}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        <Plus size={13} />
                        Add port
                      </button>
                    </div>

                    {formErrors.ports && (
                      <div className="text-xs text-red-500 mb-2">
                        {formErrors.ports}
                      </div>
                    )}

                    <div className="space-y-3">
                      {form.ports.map((p, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start bg-white border border-slate-200 rounded-xl p-3"
                        >
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">
                              Label
                            </label>
                            <input
                              value={p.label}
                              onChange={(e) =>
                                updatePortRow(index, "label", e.target.value)
                              }
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="ex: Client A"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-slate-500 mb-1">
                              Port value
                            </label>
                            <input
                              value={p.value}
                              onChange={(e) =>
                                updatePortRow(index, "value", e.target.value)
                              }
                              className={cn(
                                "w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2",
                                formErrors[`ports.${index}.value`]
                                  ? "border-red-400 focus:ring-red-500"
                                  : "border-slate-300 focus:ring-blue-500",
                              )}
                              placeholder="ex: 1/1/7/3/95"
                            />
                            {formErrors[`ports.${index}.value`] && (
                              <div className="text-xs text-red-500 mt-1">
                                {formErrors[`ports.${index}.value`]}
                              </div>
                            )}
                          </div>

                          <div className="md:pt-6">
                            <button
                              type="button"
                              onClick={() => removePortRow(index)}
                              disabled={form.ports.length === 1}
                              className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-300 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Remove this port"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAdd(false)}
                      className="px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting ? "Creating..." : "Create user"}
                    </button>
                  </div>
                </form>
              </div>
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
                <span className="font-semibold text-blue-700">
                  {confirmDialog.newRole}
                </span>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This will immediately change the user's permissions.
              </div>
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

            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              This action is irreversible.
            </div>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

/* ---------- Confirm Dialog ---------- */

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
      className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>

          <div className="mt-3">{children}</div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            >
              {cancelText}
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={cn(
                "px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2",
                variant === "danger"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-blue-600 hover:bg-blue-700",
              )}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}