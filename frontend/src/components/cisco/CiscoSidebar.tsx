// src/components/cisco/CiscoSidebar.tsx

import React from "react";
import { cn } from "../../utils/cn";
import { NavSection } from "../../types/isam";
import {
  LayoutDashboard,
  Users,
  Network,
  Cable,
  Layers,
  Terminal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import CiscoLogo from "../../assets/cisco-logo.svg";
import { useAuth } from "../../context/AuthContext";

interface CiscoSidebarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export default function CiscoSidebar({
  activeSection,
  onNavigate,
  collapsed,
  onToggle,
}: CiscoSidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const navItems: {
    section: NavSection;
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
    superAdminBadge?: boolean; // shows a small star badge for super-admin features
    dividerBefore?: boolean; // renders a visual separator before this item
  }[] = [
    {
      section: "overview",
      label: "Overview",
      icon: <LayoutDashboard size={20} />,
    },
    {
      section: "user-management",
      label: "User Management",
      icon: <Users size={20} />,
      adminOnly: true,
    },
    {
      dividerBefore: true,
      section: "switch-management",
      label: "Switch Management",
      icon: <Network size={20} />,
    },
    {
      section: "port-management",
      label: "Port Management",
      icon: <Cable size={20} />,
    },
    {
      section: "vlan-management",
      label: "VLAN Management",
      icon: <Layers size={20} />,
    },
    {
      dividerBefore: true,
      section: "cisco-configs",
      label: "Cisco Configs",
      icon: <Terminal size={20} />,
      superAdminBadge: true,
    },
  ];

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={cn(
        "h-screen bg-slate-900 text-white flex flex-col transition-all duration-300 fixed left-0 top-0 z-50",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="h-7 w-auto flex items-center justify-center">
              <img src={CiscoLogo} alt="Cisco" className="h-6 w-auto" />
            </div>
            <span className="font-bold text-lg tracking-tight">Cisco</span>
          </div>
        )}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
        {visibleNavItems.map((item, idx) => (
          <React.Fragment key={item.section}>
            {/* Divider */}
            {item.dividerBefore && (
              <div
                className={cn(
                  "border-t border-slate-700/60",
                  collapsed ? "mx-1 my-2" : "mx-2 my-2",
                )}
              />
            )}

            <button
              onClick={() => onNavigate(item.section)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative",
                activeSection === item.section
                  ? "bg-red-800 text-white shadow-lg shadow-red-800/20"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0 relative">
                {item.icon}
                {/* Super-admin star badge on the icon */}
                {item.superAdminBadge && isSuperAdmin && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border border-slate-900" />
                )}
              </span>

              {!collapsed && (
                <span className="flex-1 text-left">{item.label}</span>
              )}

              {/* "SA" pill shown when sidebar is expanded + user is super admin */}
              {!collapsed && item.superAdminBadge && isSuperAdmin && (
                <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 uppercase tracking-wide">
                  SA
                </span>
              )}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {/* Bottom user info */}
      {!collapsed && (
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-slate-300 uppercase">
                {user?.username?.[0] ?? "?"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {user?.username ?? "Unknown"}
              </p>
              <p
                className={cn(
                  "text-[10px] font-medium truncate",
                  isSuperAdmin
                    ? "text-amber-400"
                    : isAdmin
                      ? "text-blue-400"
                      : "text-slate-400",
                )}
              >
                {user?.role ?? "—"}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
