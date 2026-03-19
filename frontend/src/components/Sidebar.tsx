import React from 'react';
import { cn } from '../utils/cn';
import { NavSection } from '../types/isam';
import {
  LayoutDashboard,
  Shield,
  Network,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  User,
  Globe2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({
  activeSection,
  onNavigate,
  collapsed,
  onToggle,
}: SidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // On construit le tableau étape par étape pour éviter les problèmes de type
  const navItems: { section: NavSection; label: string; icon: React.ReactNode }[] = [
    { section: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  ];
    navItems.push(
    {
      section: 'junctions',
      label: 'ISAM',
      icon: <Network size={20} />},
  );

  // On ajoute 'junctions' uniquement pour les admins
  if (isAdmin) {
    navItems.push(
    { section: 'wan-templates', label: 'WAN Templates', icon: <Globe2 size={20} /> },
    { section: 'user-management',label: 'User Management', icon: <User size={20} /> 
    },
    
  );
  }
      navItems.push(
    { section: 'audit-logs', label: 'Audit Logs', icon: <ScrollText size={20} /> },
  );





  return (
    <aside
      className={cn(
        'h-screen bg-slate-900 text-white flex flex-col transition-all duration-300 fixed left-0 top-0 z-50',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Shield className="text-blue-400" size={24} />
            <span className="font-bold text-lg tracking-tight">ISAM</span>
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
        {navItems.map((item) => (
          <button
            key={item.section}
            onClick={() => onNavigate(item.section)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all.duration-200',
              activeSection === item.section
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            )}
            title={collapsed ? item.label : undefined}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className={cn('p-4 border-t border-slate-700', collapsed && 'px-2')}>
        {!collapsed ? (
          <div className="bg-slate-800 rounded-lg p-3">
            <p className="text-xs text-slate-400">Environment</p>
            <p className="text-sm font-medium text-green-400">DEV</p>
            <p className="text-xs text-slate-500 mt-1">v10.0.6.0</p>
          </div>
        ) : (
          <div className="w-3 h-3 rounded-full bg-green-400 mx-auto" title="Production" />
        )}
      </div>
    </aside>
  );
}