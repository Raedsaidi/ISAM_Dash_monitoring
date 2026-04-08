// src/components/cisco/CiscoVlanManagementSection.tsx

import React, { useState, useEffect } from "react";
import {
  RefreshCw,
  AlertCircle,
  Cable,
  Wifi,
  WifiOff,
  Hash,
  Loader2,
  Clock,
  Layers,
  Monitor,
  Network,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { useAuth } from "../../context/AuthContext";
import { fetchSwitches } from "../../services/ciscoVlanApi";
import {
  getCiscoInterfaces,
  getCiscoVlans,
  type InterfaceInfo,
  type VlanInfo,
} from "../../services/ciscoApi";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SwitchOption {
  id: number;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CiscoVlanManagementSection() {
  const { accessToken } = useAuth();

  const [switches, setSwitches] = useState<SwitchOption[]>([]);
  const [selectedSwitchId, setSelectedSwitchId] = useState<number | null>(null);
  const [loadingSwitches, setLoadingSwitches] = useState(false);

  const [interfaces, setInterfaces] = useState<{
    loading: boolean;
    error: string | null;
    data: InterfaceInfo[];
    protocol_used: string | null;
    cached_at: string | null;
  }>({
    loading: false,
    error: null,
    data: [],
    protocol_used: null,
    cached_at: null,
  });

  const [vlans, setVlans] = useState<{
    loading: boolean;
    error: string | null;
    data: VlanInfo[];
    protocol_used: string | null;
    cached_at: string | null;
  }>({
    loading: false,
    error: null,
    data: [],
    protocol_used: null,
    cached_at: null,
  });

  // Load switches on mount
  useEffect(() => {
    loadSwitches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load interfaces and VLANs when switch changes
  useEffect(() => {
    if (selectedSwitchId) {
      loadInterfaces();
      loadVlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSwitchId]);

  async function loadSwitches() {
    setLoadingSwitches(true);
    try {
      const data = await fetchSwitches();
      const switchList = (data.switches ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
      }));
      setSwitches(switchList);
      if (switchList.length > 0 && !selectedSwitchId) {
        setSelectedSwitchId(switchList[0].id);
      }
    } catch (err: any) {
      console.error("Failed to load switches:", err);
    } finally {
      setLoadingSwitches(false);
    }
  }

  async function loadInterfaces() {
    if (!selectedSwitchId) return;
    setInterfaces((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await getCiscoInterfaces(selectedSwitchId, accessToken);
      setInterfaces({
        loading: false,
        error: res.success ? null : res.error || "Failed to load interfaces.",
        data: res.interfaces || [],
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
      });
    } catch (err: any) {
      setInterfaces((s) => ({
        ...s,
        loading: false,
        error: err.message || "Failed to load interfaces.",
      }));
    }
  }

  async function loadVlans() {
    if (!selectedSwitchId) return;
    setVlans((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await getCiscoVlans(selectedSwitchId, accessToken);
      setVlans({
        loading: false,
        error: res.success ? null : res.error || "Failed to load VLANs.",
        data: res.vlans || [],
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
      });
    } catch (err: any) {
      setVlans((s) => ({
        ...s,
        loading: false,
        error: err.message || "Failed to load VLANs.",
      }));
    }
  }

  const handleRefresh = () => {
    loadInterfaces();
    loadVlans();
  };

  if (loadingSwitches) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Loader2 size={48} className="animate-spin mb-4" />
        <p className="text-sm">Loading switches...</p>
      </div>
    );
  }

  if (switches.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12">
        <div className="text-center text-slate-400">
          <Network size={64} className="mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            No Switches Available
          </h3>
          <p className="text-sm">
            Add a Cisco switch in the Switch Management section to view
            interfaces and VLANs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Switch Selector */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-1">
              <Layers size={24} className="text-blue-600" />
              Switch Interfaces & VLANs
            </h2>
            <p className="text-sm text-slate-500">
              View real-time interface status and VLAN configuration from your
              Cisco switches
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                Switch:
              </label>
              <select
                value={selectedSwitchId || ""}
                onChange={(e) => setSelectedSwitchId(Number(e.target.value))}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              >
                {switches.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleRefresh}
              disabled={interfaces.loading || vlans.loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw
                size={16}
                className={cn(
                  (interfaces.loading || vlans.loading) && "animate-spin",
                )}
              />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Interfaces & VLANs Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ══════════ Interfaces Card ══════════ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-50 to-blue-100/50 border-b border-blue-200 p-5">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-3">
                <div className="bg-blue-600 p-2.5 rounded-lg shadow-sm">
                  <Cable size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">
                    Interfaces
                  </h3>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                    <Clock size={12} />
                    <span>
                      {interfaces.cached_at
                        ? new Date(interfaces.cached_at).toLocaleString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "Not fetched"}
                    </span>
                    {interfaces.protocol_used && (
                      <span className="px-2 py-0.5 bg-blue-200 text-blue-800 rounded-full text-[10px] font-semibold uppercase">
                        {interfaces.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {interfaces.data.length}
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  Total
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 flex-1 overflow-y-auto max-h-[500px] bg-slate-50">
            {interfaces.loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">
                  Fetching interfaces...
                </span>
              </div>
            ) : interfaces.error ? (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Error Loading Interfaces</p>
                  <p>{interfaces.error}</p>
                </div>
              </div>
            ) : interfaces.data.length > 0 ? (
              <div className="space-y-2">
                {interfaces.data.map((iface, idx) => {
                  const isUp =
                    iface.status.toLowerCase().includes("up") &&
                    iface.protocol.toLowerCase().includes("up");
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-4 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="shrink-0">
                          {isUp ? (
                            <Wifi size={20} className="text-green-500" />
                          ) : (
                            <WifiOff size={20} className="text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono font-semibold text-slate-800 truncate">
                            {iface.name}
                          </div>
                          {iface.ip_address && (
                            <div className="text-xs text-slate-500 font-mono mt-0.5">
                              {iface.ip_address}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                            isUp
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {iface.status}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                            iface.protocol.toLowerCase() === "up"
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {iface.protocol}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Monitor size={48} className="mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-500">
                  No interface data available
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Test the connection in Switch Management
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {interfaces.data.length > 0 && (
            <div className="bg-slate-100 border-t border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  <span className="font-semibold">
                    {
                      interfaces.data.filter((i) =>
                        i.status.toLowerCase().includes("up"),
                      ).length
                    }
                  </span>{" "}
                  up ·{" "}
                  <span className="font-semibold">
                    {
                      interfaces.data.filter(
                        (i) => !i.status.toLowerCase().includes("up"),
                      ).length
                    }
                  </span>{" "}
                  down
                </span>
                <span className="text-slate-500">
                  Total: {interfaces.data.length} interfaces
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ══════════ VLANs Card ══════════ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-50 to-purple-100/50 border-b border-purple-200 p-5">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 p-2.5 rounded-lg shadow-sm">
                  <Layers size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">VLANs</h3>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                    <Clock size={12} />
                    <span>
                      {vlans.cached_at
                        ? new Date(vlans.cached_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Not fetched"}
                    </span>
                    {vlans.protocol_used && (
                      <span className="px-2 py-0.5 bg-purple-200 text-purple-800 rounded-full text-[10px] font-semibold uppercase">
                        {vlans.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-purple-600">
                  {vlans.data.length}
                </div>
                <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  VLANs
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 flex-1 overflow-y-auto max-h-[500px] bg-slate-50">
            {vlans.loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-sm font-medium">Fetching VLANs...</span>
              </div>
            ) : vlans.error ? (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Error Loading VLANs</p>
                  <p>{vlans.error}</p>
                </div>
              </div>
            ) : vlans.data.length > 0 ? (
              <div className="space-y-3">
                {vlans.data.map((vlan) => (
                  <div
                    key={vlan.id}
                    className="p-4 bg-white rounded-lg border border-slate-200 hover:border-purple-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Hash size={16} className="text-purple-500" />
                        <span className="font-mono font-bold text-slate-800 text-base">
                          VLAN {vlan.id}
                        </span>
                        <span className="text-slate-600 font-medium">
                          — {vlan.name}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                          vlan.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {vlan.status}
                      </span>
                    </div>

                    {vlan.ports.length > 0 ? (
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                          Ports ({vlan.ports.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {vlan.ports.map((port, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-md font-mono font-medium"
                            >
                              {port}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">
                        No ports assigned
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Layers size={48} className="mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-500">
                  No VLAN data available
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Test the connection in Switch Management
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {vlans.data.length > 0 && (
            <div className="bg-slate-100 border-t border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  <span className="font-semibold">
                    {vlans.data.filter((v) => v.status === "active").length}
                  </span>{" "}
                  active ·{" "}
                  <span className="font-semibold">
                    {vlans.data.filter((v) => v.status !== "active").length}
                  </span>{" "}
                  inactive
                </span>
                <span className="text-slate-500">
                  Total: {vlans.data.length} VLANs
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
