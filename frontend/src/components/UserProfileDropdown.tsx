// src/components/UserProfileDropdown.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  User,
  Mail,
  Shield,
  Clock,
  Cable,
  ChevronDown,
  Activity,
  Hash,
  Calendar,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;

interface UserPort {
  id: number;
  label?: string | null;
  value: string;
}

interface MeResponse {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  port_label?: string | null;
  port_value?: string | null;
  ports?: UserPort[];
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface UserProfileDropdownProps {
  accentColor?: "blue" | "red";
}

export default function UserProfileDropdown({
  accentColor = "blue",
}: UserProfileDropdownProps) {
  const { user, accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fermer au clic extérieur
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fermer avec Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [open]);

  // Charger le profil au premier ouverture
  useEffect(() => {
    if (!open || !accessToken || profile) return;

    setLoading(true);
    setError(null);

    fetch(`${AUTH_BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load profile");
        return res.json();
      })
      .then((data: MeResponse) => {
        setProfile(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load profile");
        setLoading(false);
      });
  }, [open, accessToken, profile]);

  // Reset si user change
  useEffect(() => {
    setProfile(null);
  }, [user?.id]);

  const accent = {
    blue: {
      avatar: "bg-blue-600",
      avatarRing: "ring-blue-100",
      headerBg: "bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950",
      roleBg: "bg-blue-500/20 text-blue-300 border-blue-400/30",
    },
    red: {
      avatar: "bg-red-700",
      avatarRing: "ring-red-100",
      headerBg: "bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950",
      roleBg: "bg-red-500/20 text-red-300 border-red-400/30",
    },
  }[accentColor];

  const roleBadgeColors: Record<string, string> = {
    SUPER_ADMIN: "bg-violet-500/15 text-violet-300 border-violet-400/30",
    ADMIN: "bg-amber-500/15 text-amber-300 border-amber-400/30",
    USER: accent.roleBg,
  };

  function formatDate(dateStr: string | null | undefined) {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  function getInitials(fullName?: string, username?: string) {
    const name = fullName || username || "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  const userRole = profile?.role || user?.role || "USER";

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen(!open)}
        className={`
          flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-all duration-150
          ${open ? "bg-slate-100" : "hover:bg-slate-50"}
        `}
      >
        <div
          className={`
            w-8 h-8 ${accent.avatar} rounded-full flex items-center justify-center
            ring-2 ${accent.avatarRing} transition-shadow
          `}
        >
          {profile?.full_name ? (
            <span className="text-white text-[11px] font-bold leading-none">
              {getInitials(profile.full_name, user?.username)}
            </span>
          ) : (
            <User size={14} className="text-white" />
          )}
        </div>

        <div className="text-left hidden sm:block">
          <div className="text-sm font-medium text-slate-800 leading-tight">
            {user?.username || "Guest"}
          </div>
          {user && (
            <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-tight">
              {user.role.replace("_", " ")}
            </div>
          )}
        </div>

        <ChevronDown
          size={13}
          className={`text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* ── Dropdown Panel ── */}
      {open && (
        <div
          className="
            absolute top-full right-0 mt-2 w-[340px] bg-white rounded-xl
            border border-slate-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)]
            z-50 overflow-hidden
          "
        >
          {/* ── Dark header section ── */}
          <div className={`${accent.headerBg} px-5 pt-5 pb-4 relative`}>
            {/* Close button */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X size={14} />
            </button>

            {loading ? (
              <div className="flex items-center gap-3 py-2">
                <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                  <Loader2
                    size={18}
                    className="animate-spin text-slate-400"
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-28 bg-slate-700 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-slate-800 rounded animate-pulse" />
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 py-2 text-red-400 text-xs">
                <AlertCircle size={14} />
                {error}
              </div>
            ) : (
              <div className="flex items-start gap-3.5">
                {/* Avatar */}
                <div
                  className={`
                    w-12 h-12 ${accent.avatar} rounded-full flex items-center justify-center
                    ring-2 ring-white/10 shrink-0
                  `}
                >
                  <span className="text-white text-base font-bold">
                    {getInitials(
                      profile?.full_name,
                      profile?.username || user?.username,
                    )}
                  </span>
                </div>

                {/* Name + role + username */}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white truncate">
                    {profile?.full_name || user?.username || "User"}
                  </h3>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    @{profile?.username || user?.username}
                  </p>
                  <div className="mt-2">
                    <span
                      className={`
                        inline-flex items-center gap-1 rounded-full border px-2 py-0.5
                        text-[10px] font-semibold uppercase tracking-wider
                        ${roleBadgeColors[userRole] || roleBadgeColors.USER}
                      `}
                    >
                      <Shield size={9} />
                      {userRole.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Info rows ── */}
          {!loading && !error && profile && (
            <div className="divide-y divide-slate-100">
              {/* Email */}
              <InfoRow
                icon={Mail}
                label="Email"
                value={profile.email}
                truncate
              />

              {/* Status */}
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                  <Activity size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 leading-none mb-1">
                    Status
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${
                          profile.is_active
                            ? "bg-emerald-400 animate-ping"
                            : "bg-red-400"
                        }`}
                      />
                      <span
                        className={`relative inline-flex h-2 w-2 rounded-full ${
                          profile.is_active
                            ? "bg-emerald-500"
                            : "bg-red-500"
                        }`}
                      />
                    </span>
                    <span className="text-xs font-medium text-slate-700">
                      {profile.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Last Login */}
              <InfoRow
                icon={Clock}
                label="Last Login"
                value={formatDate(profile.last_login_at)}
              />

              {/* Member Since */}
              <InfoRow
                icon={Calendar}
                label="Member Since"
                value={formatDate(profile.created_at)}
              />

              {/* Ports assignés */}
              {profile.ports && profile.ports.length > 0 && (
                <div className="px-5 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                      <Cable size={14} />
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 leading-none mb-0.5">
                        Assigned Ports
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {profile.ports.length} port
                        {profile.ports.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="ml-11 flex flex-wrap gap-1.5">
                    {profile.ports.map((port) => (
                      <span
                        key={port.id}
                        className="
                          inline-flex items-center gap-1 rounded-md
                          border border-slate-200 bg-slate-50
                          px-2 py-1 font-mono text-[11px] text-slate-700
                          hover:bg-slate-100 transition-colors
                        "
                        title={port.label || undefined}
                      >
                        {port.value}
                        {port.label && (
                          <span className="text-slate-400 font-sans text-[10px]">
                            · {port.label}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Port legacy fallback */}
              {(!profile.ports || profile.ports.length === 0) &&
                profile.port_value && (
                  <div className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                        <Cable size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 leading-none mb-1">
                          Assigned Port
                        </p>
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700">
                          {profile.port_value}
                          {profile.port_label && (
                            <span className="text-slate-400 font-sans text-[10px]">
                              · {profile.port_label}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Reusable info row ── */

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
  truncate: shouldTruncate,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 leading-none mb-1">
          {label}
        </p>
        <p
          className={`text-xs text-slate-700 ${
            mono ? "font-mono" : ""
          } ${shouldTruncate ? "truncate" : ""}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}