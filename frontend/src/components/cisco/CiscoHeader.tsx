// src/components/cisco/CiscoHeader.tsx
import React from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import PlatformSwitcher from "../PlatformSwitcher";
import UserProfileDropdown from "../UserProfileDropdown";

interface CiscoHeaderProps {
  title: string;
  subtitle?: string;
}

export default function CiscoHeader({ title, subtitle }: CiscoHeaderProps) {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <PlatformSwitcher />

        <div className="h-6 w-px bg-slate-200" />

        <UserProfileDropdown accentColor="red" />

        {user && (
          <button
            onClick={logout}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        )}
      </div>
    </header>
  );
}