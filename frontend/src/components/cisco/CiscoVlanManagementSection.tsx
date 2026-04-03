// src/components/cisco/CiscoVlanManagementSection.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Trash2,
  Search,
  Layers,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Edit3,
  Monitor,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import {
  fetchVlanStats,
  fetchVlans,
  createVlan as apiCreateVlan,
  deleteVlan as apiDeleteVlan,
  fetchPorts,
  createPort as apiCreatePort,
  updatePort as apiUpdatePort,
  fetchSwitches,
} from "../../services/ciscoVlanApi";

/* ------------------------------------------------------------------ */
/*  Types (match backend schemas)                                      */
/* ------------------------------------------------------------------ */

interface Vlan {
  id: number;
  vlan_id: number;
  name: string;
  status: string;
  port_count: number;
  created_at: string;
  updated_at: string;
}

interface SwitchPort {
  id: number;
  switch_id: number;
  port_id: string;
  switch_name: string;
  mode: "access" | "trunk";
  access_vlan: number;
  trunk_allowed_vlans: number[];
  trunk_native_vlan: number;
  status: "up" | "down";
  description: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total_vlans: number;
  active_vlans: number;
  access_ports: number;
  trunk_ports: number;
}

interface SwitchOption {
  id: number;
  name: string;
}

type TabKey = "vlans" | "port-assignment";

/* ------------------------------------------------------------------ */
/*  StatCard                                                           */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
      <div
        className={cn(
          "h-11 w-11 rounded-lg flex items-center justify-center shrink-0",
          color,
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add VLAN Modal                                                     */
/* ------------------------------------------------------------------ */

function AddVlanModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (data: { vlan_id: number; name: string }) => void;
}) {
  const [vlanId, setVlanId] = useState("");
  const [vlanName, setVlanName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setVlanId("");
      setVlanName("");
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseInt(vlanId, 10);
    if (isNaN(id) || id < 2 || id > 4094) {
      setError("VLAN ID must be between 2 and 4094.");
      return;
    }
    if (!vlanName.trim()) {
      setError("VLAN name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({ vlan_id: id, name: vlanName.trim() });
    } catch (err: any) {
      setError(err.message || "Failed to create VLAN.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Plus size={16} className="text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              Add New VLAN
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              VLAN ID <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={2}
              max={4094}
              value={vlanId}
              onChange={(e) => {
                setVlanId(e.target.value);
                setError("");
              }}
              placeholder="2 – 4094"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              VLAN Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              maxLength={32}
              value={vlanName}
              onChange={(e) => {
                setVlanName(e.target.value);
                setError("");
              }}
              placeholder="e.g. Engineering"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create VLAN"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Port Modal                                                     */
/* ------------------------------------------------------------------ */

function AddPortModal({
  open,
  onClose,
  onAdd,
  switches,
  vlans,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (data: any) => void;
  switches: SwitchOption[];
  vlans: Vlan[];
}) {
  const [switchId, setSwitchId] = useState<number>(switches[0]?.id ?? 0);
  const [portId, setPortId] = useState("");
  const [mode, setMode] = useState<"access" | "trunk">("access");
  const [accessVlan, setAccessVlan] = useState(1);
  const [trunkNative, setTrunkNative] = useState(1);
  const [trunkAllowed, setTrunkAllowed] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("up");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSwitchId(switches[0]?.id ?? 0);
      setPortId("");
      setMode("access");
      setAccessVlan(1);
      setTrunkNative(1);
      setTrunkAllowed(new Set());
      setStatus("up");
      setDescription("");
      setError("");
    }
  }, [open, switches]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!switchId) {
      setError("Select a switch.");
      return;
    }
    if (!portId.trim()) {
      setError("Port ID is required (e.g. Gi0/1).");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({
        switch_id: switchId,
        port_id: portId.trim(),
        mode,
        access_vlan: mode === "access" ? accessVlan : 1,
        trunk_allowed_vlans: mode === "trunk" ? Array.from(trunkAllowed) : [],
        trunk_native_vlan: mode === "trunk" ? trunkNative : 1,
        status,
        description: description.trim(),
      });
    } catch (err: any) {
      setError(err.message || "Failed to create port.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTrunkVlan = (vid: number) =>
    setTrunkAllowed((prev) => {
      const next = new Set(prev);
      next.has(vid) ? next.delete(vid) : next.add(vid);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Plus size={16} className="text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              Add Port Assignment
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto flex-1"
        >
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Switch */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Switch <span className="text-red-500">*</span>
            </label>
            <select
              value={switchId}
              onChange={(e) => setSwitchId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {switches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Port ID */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Port ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={portId}
              onChange={(e) => {
                setPortId(e.target.value);
                setError("");
              }}
              placeholder="e.g. Gi0/1"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Engineering Lab"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Port Mode
            </label>
            <div className="flex gap-2">
              {(["access", "trunk"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                    mode === m
                      ? m === "access"
                        ? "bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-200"
                        : "bg-purple-50 border-purple-300 text-purple-700 ring-2 ring-purple-200"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {m === "access" ? (
                    <Monitor size={16} />
                  ) : (
                    <ArrowRightLeft size={16} />
                  )}
                  {m === "access" ? "Access" : "Trunk"}
                </button>
              ))}
            </div>
          </div>

          {mode === "access" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Access VLAN
              </label>
              <select
                value={accessVlan}
                onChange={(e) => setAccessVlan(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {vlans.map((v) => (
                  <option key={v.vlan_id} value={v.vlan_id}>
                    VLAN {v.vlan_id} — {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "trunk" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Native VLAN
                </label>
                <select
                  value={trunkNative}
                  onChange={(e) => setTrunkNative(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {vlans.map((v) => (
                    <option key={v.vlan_id} value={v.vlan_id}>
                      VLAN {v.vlan_id} — {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Allowed VLANs
                </label>
                <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {vlans.map((v) => (
                    <label
                      key={v.vlan_id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={trunkAllowed.has(v.vlan_id)}
                        onChange={() => toggleTrunkVlan(v.vlan_id)}
                        className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-slate-700">
                        <span className="font-mono font-medium">
                          {v.vlan_id}
                        </span>{" "}
                        — {v.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Port"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit Port VLAN Modal                                               */
/* ------------------------------------------------------------------ */

function EditPortVlanModal({
  open,
  onClose,
  port,
  vlans,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  port: SwitchPort | null;
  vlans: Vlan[];
  onSave: (
    dbId: number,
    config: {
      mode: "access" | "trunk";
      access_vlan?: number;
      trunk_allowed_vlans?: number[];
      trunk_native_vlan?: number;
    },
  ) => void;
}) {
  const [mode, setMode] = useState<"access" | "trunk">("access");
  const [accessVlan, setAccessVlan] = useState(1);
  const [trunkNativeVlan, setTrunkNativeVlan] = useState(1);
  const [trunkAllowed, setTrunkAllowed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (port && open) {
      setMode(port.mode);
      setAccessVlan(port.access_vlan);
      setTrunkNativeVlan(port.trunk_native_vlan);
      setTrunkAllowed(new Set(port.trunk_allowed_vlans));
    }
  }, [port, open]);

  if (!open || !port) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "access") {
      onSave(port.id, { mode, access_vlan: accessVlan });
    } else {
      if (trunkAllowed.size === 0) {
        toast.error("Select at least one VLAN for the trunk.");
        return;
      }
      onSave(port.id, {
        mode,
        trunk_allowed_vlans: Array.from(trunkAllowed).sort((a, b) => a - b),
        trunk_native_vlan: trunkNativeVlan,
      });
    }
  };

  const toggleTrunkVlan = (vid: number) =>
    setTrunkAllowed((prev) => {
      const next = new Set(prev);
      next.has(vid) ? next.delete(vid) : next.add(vid);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Edit3 size={16} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Edit Port VLAN
              </h3>
              <p className="text-xs text-slate-500">
                {port.switch_name} — {port.port_id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-5 overflow-y-auto flex-1"
        >
          {/* Port Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Port Mode
            </label>
            <div className="flex gap-2">
              {(["access", "trunk"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all",
                    mode === m
                      ? m === "access"
                        ? "bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-200"
                        : "bg-purple-50 border-purple-300 text-purple-700 ring-2 ring-purple-200"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {m === "access" ? (
                    <Monitor size={16} />
                  ) : (
                    <ArrowRightLeft size={16} />
                  )}
                  {m === "access" ? "Access" : "Trunk"}
                </button>
              ))}
            </div>
          </div>

          {mode === "access" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Access VLAN
              </label>
              <select
                value={accessVlan}
                onChange={(e) => setAccessVlan(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {vlans.map((v) => (
                  <option key={v.vlan_id} value={v.vlan_id}>
                    VLAN {v.vlan_id} — {v.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                The port will carry only this VLAN's untagged traffic.
              </p>
            </div>
          )}

          {mode === "trunk" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Native VLAN
                </label>
                <select
                  value={trunkNativeVlan}
                  onChange={(e) =>
                    setTrunkNativeVlan(parseInt(e.target.value, 10))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  {vlans.map((v) => (
                    <option key={v.vlan_id} value={v.vlan_id}>
                      VLAN {v.vlan_id} — {v.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Untagged frames will be assigned to this VLAN.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Allowed VLANs
                </label>
                <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                  {vlans.map((v) => (
                    <label
                      key={v.vlan_id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={trunkAllowed.has(v.vlan_id)}
                        onChange={() => toggleTrunkVlan(v.vlan_id)}
                        className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-slate-700">
                        <span className="font-mono font-medium">
                          {v.vlan_id}
                        </span>{" "}
                        — {v.name}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {trunkAllowed.size} VLAN
                  {trunkAllowed.size !== 1 ? "s" : ""} selected
                </p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Apply Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete VLAN Modal                                                  */
/* ------------------------------------------------------------------ */

function DeleteVlanModal({
  open,
  onClose,
  vlan,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  vlan: Vlan | null;
  onConfirm: (dbId: number) => void;
}) {
  if (!open || !vlan) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="p-6 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <Trash2 size={22} className="text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            Delete VLAN {vlan.vlan_id}?
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            This will remove <span className="font-medium">{vlan.name}</span>{" "}
            (ID {vlan.vlan_id}) from all switches. Ports assigned to this VLAN
            will fall back to VLAN 1.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(vlan.id)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Delete VLAN
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  VLAN Table                                                         */
/* ------------------------------------------------------------------ */

function VlanTable({
  vlans,
  search,
  onSearch,
  onDelete,
  loading,
}: {
  vlans: Vlan[];
  search: string;
  onSearch: (s: string) => void;
  onDelete: (v: Vlan) => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          placeholder="Search by ID or name…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">VLAN ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ports</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center py-12 text-slate-400 text-sm"
                >
                  Loading…
                </td>
              </tr>
            ) : vlans.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center py-12 text-slate-400 text-sm"
                >
                  No VLANs found.
                </td>
              </tr>
            ) : (
              vlans.map((v) => (
                <tr
                  key={v.id}
                  className="hover:bg-slate-50/60 transition-colors"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">
                    {v.vlan_id}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{v.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        v.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          v.status === "active"
                            ? "bg-emerald-500"
                            : "bg-amber-500",
                        )}
                      />
                      {v.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {v.port_count}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.vlan_id !== 1 ? (
                      <button
                        onClick={() => onDelete(v)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                        title={`Delete VLAN ${v.vlan_id}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">
                        default
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Port Assignment Table                                              */
/* ------------------------------------------------------------------ */

function PortAssignmentTable({
  ports,
  vlans,
  search,
  onSearch,
  onEdit,
  loading,
}: {
  ports: SwitchPort[];
  vlans: Vlan[];
  search: string;
  onSearch: (s: string) => void;
  onEdit: (p: SwitchPort) => void;
  loading: boolean;
}) {
  const vlanMap = new Map(vlans.map((v) => [v.vlan_id, v.name]));

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          placeholder="Search ports…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">Switch</th>
              <th className="px-4 py-3">Port</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">VLAN Info</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-slate-400 text-sm"
                >
                  Loading…
                </td>
              </tr>
            ) : ports.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-slate-400 text-sm"
                >
                  No ports found.
                </td>
              </tr>
            ) : (
              ports.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-slate-50/60 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {p.switch_name}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {p.port_id}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">
                    {p.description || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        p.mode === "access"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-purple-100 text-purple-700",
                      )}
                    >
                      {p.mode === "access" ? (
                        <Monitor size={12} />
                      ) : (
                        <ArrowRightLeft size={12} />
                      )}
                      {p.mode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.mode === "access" ? (
                      <span>
                        VLAN {p.access_vlan}
                        <span className="text-slate-400 ml-1 text-xs">
                          ({vlanMap.get(p.access_vlan) ?? "unknown"})
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs">
                        Native: {p.trunk_native_vlan} · Allowed:{" "}
                        {p.trunk_allowed_vlans.length > 0
                          ? p.trunk_allowed_vlans.join(", ")
                          : "all"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        p.status === "up"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-500",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          p.status === "up" ? "bg-emerald-500" : "bg-slate-400",
                        )}
                      />
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onEdit(p)}
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Edit port VLAN"
                    >
                      <Edit3 size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CiscoVlanManagementSection() {
  /* ─── data state ─── */
  const [vlans, setVlans] = useState<Vlan[]>([]);
  const [ports, setPorts] = useState<SwitchPort[]>([]);
  const [switches, setSwitches] = useState<SwitchOption[]>([]);
  const [stats, setStats] = useState<Stats>({
    total_vlans: 0,
    active_vlans: 0,
    access_ports: 0,
    trunk_ports: 0,
  });

  /* ─── UI state ─── */
  const [activeTab, setActiveTab] = useState<TabKey>("vlans");
  const [search, setSearch] = useState("");
  const [portSearch, setPortSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [portLoading, setPortLoading] = useState(false);

  /* ─── modal state ─── */
  const [addVlanOpen, setAddVlanOpen] = useState(false);
  const [addPortOpen, setAddPortOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Vlan | null>(null);
  const [editPort, setEditPort] = useState<SwitchPort | null>(null);

  /* ─── debounce refs ─── */
  const vlanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── loaders ─── */

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchVlanStats();
      setStats(data);
    } catch {
      /* silent */
    }
  }, []);

  const loadVlans = useCallback(async (s = "") => {
    setVlanLoading(true);
    try {
      const data = await fetchVlans(s);
      setVlans(data.vlans ?? []);
    } catch {
      toast.error("Failed to load VLANs");
    } finally {
      setVlanLoading(false);
    }
  }, []);

  const loadPorts = useCallback(async (s = "") => {
    setPortLoading(true);
    try {
      const data = await fetchPorts(s);
      setPorts(data.ports ?? []);
    } catch {
      toast.error("Failed to load ports");
    } finally {
      setPortLoading(false);
    }
  }, []);

  const loadSwitches = useCallback(async () => {
    try {
      const data = await fetchSwitches();
      setSwitches(
        (data.switches ?? []).map((s: any) => ({ id: s.id, name: s.name })),
      );
    } catch {
      /* silent */
    }
  }, []);

  /* ─── initial fetch ─── */

  useEffect(() => {
    loadStats();
    loadVlans();
    loadPorts();
    loadSwitches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── debounced search ─── */

  useEffect(() => {
    if (vlanTimerRef.current) clearTimeout(vlanTimerRef.current);
    vlanTimerRef.current = setTimeout(() => loadVlans(search), 300);
    return () => {
      if (vlanTimerRef.current) clearTimeout(vlanTimerRef.current);
    };
  }, [search, loadVlans]);

  useEffect(() => {
    if (portTimerRef.current) clearTimeout(portTimerRef.current);
    portTimerRef.current = setTimeout(() => loadPorts(portSearch), 300);
    return () => {
      if (portTimerRef.current) clearTimeout(portTimerRef.current);
    };
  }, [portSearch, loadPorts]);

  /* ─── handlers ─── */

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStats(),
        loadVlans(search),
        loadPorts(portSearch),
      ]);
      toast.success("Data refreshed");
    } finally {
      setLoading(false);
    }
  }, [loadStats, loadVlans, loadPorts, search, portSearch]);

  const handleAddVlan = useCallback(
    async (data: { vlan_id: number; name: string }) => {
      await apiCreateVlan(data);
      toast.success(`VLAN ${data.vlan_id} (${data.name}) created`);
      setAddVlanOpen(false);
      loadVlans(search);
      loadStats();
    },
    [search, loadVlans, loadStats],
  );

  const handleDeleteVlan = useCallback(
    async (dbId: number) => {
      try {
        await apiDeleteVlan(dbId);
        toast.success("VLAN deleted");
        setDeleteTarget(null);
        loadVlans(search);
        loadPorts(portSearch);
        loadStats();
      } catch (e: any) {
        toast.error(e.message || "Failed to delete VLAN");
      }
    },
    [search, portSearch, loadVlans, loadPorts, loadStats],
  );

  const handleAddPort = useCallback(
    async (data: any) => {
      await apiCreatePort(data);
      toast.success(`Port ${data.port_id} assigned`);
      setAddPortOpen(false);
      loadPorts(portSearch);
      loadStats();
    },
    [portSearch, loadPorts, loadStats],
  );

  const handleSavePortVlan = useCallback(
    async (
      dbId: number,
      config: {
        mode: "access" | "trunk";
        access_vlan?: number;
        trunk_allowed_vlans?: number[];
        trunk_native_vlan?: number;
      },
    ) => {
      try {
        await apiUpdatePort(dbId, config);
        toast.success("Port VLAN updated");
        setEditPort(null);
        loadPorts(portSearch);
        loadVlans(search);
        loadStats();
      } catch (e: any) {
        toast.error(e.message || "Failed to update port");
      }
    },
    [portSearch, search, loadPorts, loadVlans, loadStats],
  );

  /* ─── tabs ─── */

  const tabs: { key: TabKey; label: string }[] = [
    { key: "vlans", label: "VLANs" },
    { key: "port-assignment", label: "Port VLAN Assignment" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total VLANs"
          value={stats.total_vlans}
          icon={<Layers size={20} className="text-blue-600" />}
          color="bg-blue-100"
        />
        <StatCard
          label="Active VLANs"
          value={stats.active_vlans}
          icon={<CheckCircle2 size={20} className="text-emerald-600" />}
          color="bg-emerald-100"
        />
        <StatCard
          label="Access Ports"
          value={stats.access_ports}
          icon={<Monitor size={20} className="text-amber-600" />}
          color="bg-amber-100"
        />
        <StatCard
          label="Trunk Ports"
          value={stats.trunk_ports}
          icon={<ArrowRightLeft size={20} className="text-purple-600" />}
          color="bg-purple-100"
        />
      </div>

      {/* Tabs + Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4">
          <div className="flex">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
                  activeTab === t.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
              title="Refresh"
            >
              <RefreshCw size={16} className={cn(loading && "animate-spin")} />
            </button>
            {activeTab === "vlans" && (
              <button
                onClick={() => setAddVlanOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Plus size={15} />
                Add VLAN
              </button>
            )}
            {activeTab === "port-assignment" && (
              <button
                onClick={() => setAddPortOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Plus size={15} />
                Add Port
              </button>
            )}
          </div>
        </div>

        <div className="p-4">
          {activeTab === "vlans" && (
            <VlanTable
              vlans={vlans}
              search={search}
              onSearch={setSearch}
              onDelete={setDeleteTarget}
              loading={vlanLoading}
            />
          )}
          {activeTab === "port-assignment" && (
            <PortAssignmentTable
              ports={ports}
              vlans={vlans}
              search={portSearch}
              onSearch={setPortSearch}
              onEdit={setEditPort}
              loading={portLoading}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <AddVlanModal
        open={addVlanOpen}
        onClose={() => setAddVlanOpen(false)}
        onAdd={handleAddVlan}
      />
      <AddPortModal
        open={addPortOpen}
        onClose={() => setAddPortOpen(false)}
        onAdd={handleAddPort}
        switches={switches}
        vlans={vlans}
      />
      <DeleteVlanModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        vlan={deleteTarget}
        onConfirm={handleDeleteVlan}
      />
      <EditPortVlanModal
        open={!!editPort}
        onClose={() => setEditPort(null)}
        port={editPort}
        vlans={vlans}
        onSave={handleSavePortVlan}
      />
    </div>
  );
}
