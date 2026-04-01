import { useState, useEffect, useMemo } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Signal,
  Activity,
  Layers,
  Search,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../utils/cn";
import LTSlotExpander from "./LTSlotExpander";

interface LTSlot {
  slot_id: string;
  board: string;
  admin_state: string;
  link_state: string;
  port_state: string;
  port_type: string;
  cfg_mtu: number;
  oper_mtu: number;
  lag_bndl: string;
  mode: string;
  encap: string;
}

interface LTSlotsOverlayProps {
  instanceId: number;
  instanceName: string;
  instanceHost: string;
  accessToken: string | null;
  isAdmin: boolean;
  onClose: () => void;
}

function getSlotCategory(portType: string): string {
  const pt = portType.toLowerCase();
  if (pt.includes("xdsl")) return "XDSL";
  if (pt.includes("pon") || pt.includes("ont") || pt.includes("gpon"))
    return "PON";
  if (pt.includes("ethernet")) return "Ethernet";
  return "Other";
}

function getCategoryColor(category: string): {
  bg: string;
  text: string;
  border: string;
  dot: string;
  headerBg: string;
} {
  switch (category) {
    case "XDSL":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
        dot: "bg-blue-500",
        headerBg: "bg-blue-50/80",
      };
    case "PON":
      return {
        bg: "bg-violet-50",
        text: "text-violet-700",
        border: "border-violet-200",
        dot: "bg-violet-500",
        headerBg: "bg-violet-50/80",
      };
    case "Ethernet":
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
        headerBg: "bg-emerald-50/80",
      };
    default:
      return {
        bg: "bg-slate-50",
        text: "text-slate-700",
        border: "border-slate-200",
        dot: "bg-slate-500",
        headerBg: "bg-slate-50/80",
      };
  }
}

function SlotCategoryGroup({
  category,
  slots,
  instanceId,
  accessToken,
  isAdmin,
}: {
  category: string;
  slots: LTSlot[];
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = getCategoryColor(category);

  const activeCount = slots.filter(
    (s) => s.admin_state.toLowerCase() === "up",
  ).length;

  return (
    <div className={cn("rounded-lg border overflow-hidden", colors.border)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2.5 transition-colors",
          colors.headerBg,
          "hover:brightness-95",
        )}
      >
        <div className="flex items-center gap-2.5">
          <ChevronRight
            size={14}
            className={cn(
              "transition-transform duration-200",
              colors.text,
              expanded && "rotate-90",
            )}
          />
          <span className={cn("h-2 w-2 rounded-full", colors.dot)} />
          <span className={cn("text-xs font-bold", colors.text)}>
            {category}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">
            {slots.length} slot{slots.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
              activeCount > 0
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-500",
            )}
          >
            {activeCount} active
          </span>
          <span className="text-[10px] font-medium text-slate-400 px-2 py-0.5 rounded-full bg-slate-100">
            {slots.length - activeCount} other
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-white">
          <div className="p-3 space-y-2">
            {slots.map((slot) => (
              <LTSlotExpander
                key={slot.slot_id}
                slot={slot}
                instanceId={instanceId}
                accessToken={accessToken}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SlotFlatGroup({
  slots,
  instanceId,
  accessToken,
  isAdmin,
}: {
  slots: LTSlot[];
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-2">
      {slots.map((slot) => (
        <LTSlotExpander
          key={slot.slot_id}
          slot={slot}
          instanceId={instanceId}
          accessToken={accessToken}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

export default function LTSlotsOverlay({
  instanceId,
  instanceName,
  instanceHost,
  accessToken,
  isAdmin,
  onClose,
}: LTSlotsOverlayProps) {
  const [slots, setSlots] = useState<LTSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchSlot, setSearchSlot] = useState("");
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        },
      );
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* */
      }
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || "Failed to load LT slots");
      toast.error("Failed to load LT slots");
    } finally {
      setLoading(false);
    }
  }

  const active = slots.filter(
    (s) => s.admin_state.toLowerCase() === "up",
  ).length;
  const down = slots.filter(
    (s) => s.port_state.toLowerCase() === "down",
  ).length;

  const filtered = useMemo(() => {
    return slots.filter((s) => {
      if (searchSlot) {
        const q = searchSlot.toLowerCase();
        if (
          !s.slot_id.toLowerCase().includes(q) &&
          !s.board.toLowerCase().includes(q) &&
          !s.port_type.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [slots, searchSlot]);

  const grouped = useMemo(() => {
    const groups: Record<string, LTSlot[]> = {};
    filtered.forEach((slot) => {
      const cat = getSlotCategory(slot.port_type);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(slot);
    });

    const order = ["XDSL", "PON", "Ethernet", "Other"];
    const sorted: [string, LTSlot[]][] = [];
    for (const cat of order) {
      if (groups[cat]) sorted.push([cat, groups[cat]]);
    }
    for (const cat of Object.keys(groups)) {
      if (!order.includes(cat)) sorted.push([cat, groups[cat]]);
    }
    return sorted;
  }, [filtered]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm font-sans">
      <div className="w-[95vw] max-w-[1400px] h-[92vh] bg-slate-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 shrink-0">
          <div className="px-8 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Layers size={18} className="text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-700">
                  LT Slots & Ports
                </h1>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <span className="font-medium text-slate-600">
                    {instanceName}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono">{instanceHost}</span>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="shrink-0 bg-white border-b border-slate-100">
          <div className="px-8 py-2.5 flex items-center gap-3 flex-wrap">
            <StatBadge
              icon={<Cpu size={12} />}
              value={slots.length}
              label="Total"
            />
            <StatBadge
              icon={<Signal size={12} />}
              value={active}
              label="Active"
              variant="success"
            />
            <StatBadge
              icon={<Activity size={12} />}
              value={down}
              label="Down"
              variant={down > 0 ? "warning" : "default"}
            />

            <div className="h-5 w-px bg-slate-200 hidden sm:block" />

            <div className="ml-auto flex items-center gap-2.5">
              {/* Search only — no type filter buttons */}
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Search slot..."
                  value={searchSlot}
                  onChange={(e) => setSearchSlot(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48
                             focus:outline-none focus:border-blue-400 focus:ring-1
                             focus:ring-blue-100 bg-slate-50 placeholder:text-slate-400
                             transition-all duration-150"
                />
                {searchSlot && (
                  <button
                    onClick={() => setSearchSlot("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2
                               text-slate-400 hover:text-slate-600"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <button
                onClick={loadSlots}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                           border border-blue-200 bg-blue-600 text-white
                           hover:bg-blue-700 disabled:opacity-50 shadow-sm
                           transition-all duration-150"
              >
                <RefreshCw
                  size={11}
                  className={loading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-8 py-6">
            {loading && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Loader2 size={22} className="animate-spin text-blue-500" />
                <p className="text-xs text-slate-500 font-medium">
                  Loading slots...
                </p>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-3 p-4 bg-white border border-red-200 rounded-lg shadow-sm">
                <AlertCircle
                  size={18}
                  className="text-red-500 shrink-0 mt-0.5"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-700">
                    Error
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{error}</div>
                </div>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Cpu size={24} className="text-slate-200" />
                <p className="text-xs text-slate-400 font-medium">
                  No slots found
                </p>
                {searchSlot && (
                  <button
                    onClick={() => setSearchSlot("")}
                    className="text-[11px] text-blue-600 hover:text-blue-700 underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}

            {!loading && !error && grouped.length > 0 && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    {filtered.length} slot{filtered.length !== 1 ? "s" : ""} in{" "}
                    {grouped.length} group{grouped.length !== 1 ? "s" : ""}
                  </p>
                </div>

                <div className="space-y-4">
                  {grouped.map(([category, categorySlots]) =>
                    category === "Other" ? (
                      <div key={category}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                          Other ({categorySlots.length} slot
                          {categorySlots.length !== 1 ? "s" : ""})
                        </p>
                        <SlotFlatGroup
                          slots={categorySlots}
                          instanceId={instanceId}
                          accessToken={accessToken}
                          isAdmin={isAdmin}
                        />
                      </div>
                    ) : (
                      <SlotCategoryGroup
                        key={category}
                        category={category}
                        slots={categorySlots}
                        instanceId={instanceId}
                        accessToken={accessToken}
                        isAdmin={isAdmin}
                      />
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBadge({
  icon,
  value,
  label,
  variant = "default",
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  variant?: "default" | "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium",
        variant === "success" && value > 0
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : variant === "warning" && value > 0
            ? "border-orange-200 bg-orange-50 text-orange-700"
            : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="font-bold tabular-nums">{value}</span>
      <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
        {label}
      </span>
    </div>
  );
}
