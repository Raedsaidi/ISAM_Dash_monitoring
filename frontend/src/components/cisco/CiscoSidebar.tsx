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

  const navItems: {
    section: NavSection;
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
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
  ];

  // Filter out admin-only items if user is not admin
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={cn(
        "h-screen bg-slate-900 text-white flex flex-col transition-all duration-300 fixed left-0 top-0 z-50",
        collapsed ? "w-16" : "w-64",
      )}
    >
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

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {visibleNavItems.map((item) => (
          <button
            key={item.section}
            onClick={() => onNavigate(item.section)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              activeSection === item.section
                ? "bg-red-800 text-white shadow-lg shadow-red-800/20"
                : "text-slate-300 hover:bg-slate-800 hover:text-white",
            )}
            title={collapsed ? item.label : undefined}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}
