import React from "react";
import { Shield } from "lucide-react";
import CiscoLogo from "../assets/cisco-logo.svg"; 

interface ProductSelectionProps {
  onSelectIsam: () => void;
  onSelectCisco: () => void;
}

export default function ProductSelection({
  onSelectIsam,
  onSelectCisco,
}: ProductSelectionProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-3xl w-full">
        <h1 className="text-2xl font-semibold text-slate-900 text-center mb-2">
          Choose a platform
        </h1>
        <p className="text-slate-500 text-center mb-8">
          Select the domain you want to work with.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ISAM tile */}
          <button
            onClick={onSelectIsam}
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left
                       hover:border-blue-600 hover:shadow-lg transition-all duration-200"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-blue-50 text-blue-600 p-3">
                <Shield size={24} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  ISAM
                </h2>
                <p className="text-sm text-slate-500">
                  Manage ISAM instances, templates, and audit logs.
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm font-medium text-blue-600 group-hover:underline">
              Go to ISAM dashboard →
            </div>
          </button>

          {/* CISCO tile */}
          <button
            onClick={onSelectCisco}
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left
                       hover:border-red-800 hover:shadow-lg transition-all duration-200"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-red-100 text-red-800 p-3 flex items-center justify-center">
                <img
                  src={CiscoLogo}
                  alt="Cisco logo"
                  className="h-6 w-auto"
                />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Cisco
                </h2>
                <p className="text-sm text-slate-500">
                  Manage CISCO instances, templates, and audit logs.
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm font-medium text-red-800 group-hover:underline">
              Go to Cisco area →
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}