// src/components/cisco/CiscoOverviewSection.tsx
import React from "react";
import { cn } from "../../utils/cn";
import {
  Activity,
  Server,
  AlertTriangle,
  Users,
  Shield,
} from "lucide-react";

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div className="p-3 rounded-xl bg-red-50 text-red-800">{icon}</div>
      </div>
    </div>
  );
}

export default function CiscoOverviewSection() {
  return (
    <div className="space-y-6">
      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Cisco Devices"
          value={12}
          subtitle="Total registered Cisco devices"
          icon={<Server size={20} />}
        />
        <StatCard
          title="Active Devices"
          value={10}
          subtitle="Devices currently reachable"
          icon={<Activity size={20} />}
        />
        <StatCard
          title="Critical Alerts"
          value={2}
          subtitle="Devices with critical issues"
          icon={<AlertTriangle size={20} />}
        />
        <StatCard
          title="Network Admins"
          value={4}
          subtitle="Users managing Cisco infrastructure"
          icon={<Users size={20} />}
        />
      </div>

      {/* Placeholder content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">
              Recent Cisco Activity
            </h3>
            <span className="text-xs text-slate-400">Coming soon</span>
          </div>
          <p className="text-sm text-slate-500">
            This area will display recent configuration changes and operational
            events from your Cisco devices. You can later plug your Cisco API
            calls here.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-red-700" />
            <h3 className="font-semibold text-slate-900">
              Security Overview
            </h3>
          </div>
          <p className="text-sm text-slate-500 mb-3">
            Summary of security posture for your Cisco environment.
          </p>
          <ul className="text-xs text-slate-600 space-y-1">
            <li>• Role-based access control for Cisco admins</li>
            <li>• Centralized authentication via auth-service</li>
            <li>• Audit logs (to be integrated with Cisco events)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}