// src/components/PlatformSwitcher.tsx
import React, { useState, useRef, useEffect } from "react";
import { ArrowLeftRight, Shield } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import CiscoLogo from "../assets/cisco-logo.svg";

export default function PlatformSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const isIsam = location.pathname.startsWith("/isam");
  const isCisco = location.pathname.startsWith("/cisco");

  const currentPlatform = isIsam ? "ISAM" : isCisco ? "Cisco" : "Select";

  // Fermer le dropdown au clic extérieur
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const platforms = [
    {
      key: "isam",
      label: "ISAM",
      description: "Identity & Access",
      icon: (
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <Shield size={16} />
        </div>
      ),
      path: "/isam/overview",
      active: isIsam,
      accentColor: "blue",
    },
    {
      key: "cisco",
      label: "Cisco",
      description: "Network Management",
      icon: (
        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
          <img src={CiscoLogo} alt="Cisco" className="h-4 w-auto" />
        </div>
      ),
      path: "/cisco/overview",
      active: isCisco,
      accentColor: "red",
    },
  ];

  return (
    <div ref={ref} className="relative">
      {/* Bouton déclencheur */}
      <button
        onClick={() => setOpen(!open)}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200
          ${open
            ? "border-slate-300 bg-slate-50 shadow-sm"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          }
        `}
      >
        {/* Icône de la plateforme active */}
        {isIsam && (
          <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center">
            <Shield size={13} />
          </div>
        )}
        {isCisco && (
          <div className="w-6 h-6 rounded-md bg-red-100 flex items-center justify-center">
            <img src={CiscoLogo} alt="Cisco" className="h-3 w-auto" />
          </div>
        )}

        <span className="text-sm font-medium text-slate-700">
          {currentPlatform}
        </span>

        <ArrowLeftRight
          size={14}
          className={`text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header du dropdown */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Switch platform
            </p>
          </div>

          {/* Options */}
          <div className="p-2">
            {platforms.map((platform) => (
              <button
                key={platform.key}
                onClick={() => {
                  if (!platform.active) {
                    navigate(platform.path);
                  }
                  setOpen(false);
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150
                  ${platform.active
                    ? platform.accentColor === "blue"
                      ? "bg-blue-50 border border-blue-200"
                      : "bg-red-50 border border-red-200"
                    : "hover:bg-slate-50 border border-transparent"
                  }
                `}
              >
                {platform.icon}
                <div className="text-left flex-1">
                  <div className="text-sm font-medium text-slate-900">
                    {platform.label}
                  </div>
                  <div className="text-xs text-slate-500">
                    {platform.description}
                  </div>
                </div>
                {platform.active && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      platform.accentColor === "blue"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Footer : retour à la sélection */}
          <div className="px-2 pb-2">
            <button
              onClick={() => {
                navigate("/");
                setOpen(false);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600 py-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
              ← Back to platform selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}