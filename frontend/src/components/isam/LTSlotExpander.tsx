import { useState, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Loader2,
  AlertCircle,
  Zap,
  Radio,
  Wifi,
  Cable,
  Search,
  X,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";
import LTPortItem from "./LTPortItem";

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

interface LTSlotExpanderProps {
  slot: LTSlot;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
}

function PortSection({
  title,
  count,
  icon,
  color,
  borderColor,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-lg border overflow-hidden", borderColor)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 transition-colors",
          "hover:brightness-95",
          expanded ? "bg-slate-50/80" : "bg-white",
        )}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={12}
            className={cn(
              "transition-transform duration-200",
              color,
              expanded && "rotate-90",
            )}
          />
          <div
            className={cn(
              "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest",
              color,
            )}
          >
            {icon}
            {title}
          </div>
        </div>

        <span
          className={cn(
            "text-[9px] font-semibold px-2 py-0.5 rounded-full",
            "bg-slate-100 text-slate-500",
          )}
        >
          {count} port{count !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-white p-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

export default function LTSlotExpander({
  slot,
  instanceId,
  accessToken,
  isAdmin,
}: LTSlotExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const [ports, setPorts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portLocks, setPortLocks] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [portTypeFilter, setPortTypeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  function getSlotIcon() {
    const pt = slot.port_type.toLowerCase();
    if (pt.includes("xdsl")) return <Zap size={15} />;
    if (pt.includes("pon") || pt.includes("ont")) return <Radio size={15} />;
    if (pt.includes("ethernet")) return <Cable size={15} />;
    return <Wifi size={15} />;
  }

  function getSlotStyle() {
    return "text-blue-700 bg-blue-50 border-blue-200";
  }

  const loadPorts = useCallback(
    async (search?: string, ptFilter?: string, stFilter?: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (ptFilter) params.set("port_type", ptFilter);
        if (stFilter) params.set("state", stFilter);

        const qs = params.toString();
        const encodedSlot = encodeURIComponent(slot.slot_id);
        const url = `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlot}/ports${qs ? `?${qs}` : ""}`;

        const res = await fetch(url, {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch {
          /* */
        }
        if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);

        setPorts(data.ports || []);
        setTotalCount(data.total_count ?? data.port_count ?? 0);
        setHasLoaded(true);

        const locks: Record<string, boolean> = {};
        (data.ports || []).forEach((p: any) => {
          locks[p.port_id] = p.locked || false;
        });
        setPortLocks(locks);
      } catch (err: any) {
        setError(err.message || "Failed to load ports");
        toast.error("Failed to load ports");
      } finally {
        setLoading(false);
      }
    },
    [slot.slot_id, instanceId, accessToken, ISAM_BASE_URL],
  );

  function handleToggle() {
    if (!expanded && !hasLoaded) loadPorts();
    setExpanded(!expanded);
  }

  function handleSearch(val: string) {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActiveSearch(val);
      loadPorts(val, portTypeFilter, stateFilter);
    }, 400);
  }

  function handleClearSearch() {
    setSearchQuery("");
    setActiveSearch("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    loadPorts("", portTypeFilter, stateFilter);
  }

  function handlePortType(val: string) {
    const next = portTypeFilter === val ? "" : val;
    setPortTypeFilter(next);
    loadPorts(activeSearch, next, stateFilter);
  }

  function handleState(val: string) {
    const next = stateFilter === val ? "" : val;
    setStateFilter(next);
    loadPorts(activeSearch, portTypeFilter, next);
  }

  function handleLockToggle(portId: string) {
    setPortLocks((prev) => ({ ...prev, [portId]: !prev[portId] }));
  }

  function clearAll() {
    setSearchQuery("");
    setActiveSearch("");
    setPortTypeFilter("");
    setStateFilter("");
    loadPorts();
  }

  // Group ports
  const xdslPorts = ports.filter((p) => p.port_type === "xdsl-line");
  const ethPorts = ports.filter((p) => p.port_type === "ethernet-line");
  const ponPorts = ports.filter((p) => p.port_type === "pon");
  const ontPorts = ports.filter((p) => p.port_type === "ont");

  const ponMap: Record<string, { pon: any; onts: any[] }> = {};
  ponPorts.forEach((pon) => {
    if (!ponMap[pon.port_id]) ponMap[pon.port_id] = { pon, onts: [] };
  });
  ontPorts.forEach((ont) => {
    const parts = (ont.port_id || "").split("/");
    if (parts.length < 4) return;
    const parentId = parts.slice(0, 4).join("/");
    if (!ponMap[parentId]) {
      ponMap[parentId] = {
        pon: {
          port_id: parentId,
          port_type: "pon",
          admin_state: "unknown",
          port_state: "unknown",
          board: slot.board,
        },
        onts: [],
      };
    }
    ponMap[parentId].onts.push(ont);
  });
  const ponGroups = Object.values(ponMap);

  const adminUp = ["up"].includes(slot.admin_state.toLowerCase());
  const portUp = ["up"].includes(slot.port_state.toLowerCase());
  const hasFilters = !!activeSearch || !!portTypeFilter || !!stateFilter;

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all duration-100",
        expanded
          ? "border-blue-300 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
          : "border-slate-200 hover:border-blue-300",
      )}
    >
      {/* Slot Header */}
      <button
        onClick={handleToggle}
        className={cn(
          "w-full px-4 py-3 text-left flex items-center gap-3 transition-colors",
          expanded ? "bg-blue-50/40" : "bg-white hover:bg-blue-50/20",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-lg border shrink-0",
            getSlotStyle(),
          )}
        >
          {getSlotIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-slate-700 text-[15px]">
              {slot.slot_id}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-1.5 py-px rounded border border-blue-200">
              {slot.board}
            </span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <MiniPill label="Admin" value={slot.admin_state} up={adminUp} />
          <MiniPill label="Port" value={slot.port_state} up={portUp} />
        </div>

        <div className="text-blue-400 shrink-0">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-blue-200">
          {/* Search & Filters bar */}
          <div className="bg-blue-50/30 border-b border-blue-100 px-4 py-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Search input */}
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Search port ID, type..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-7 pr-7 py-1 text-[11px] border border-slate-200 rounded-md
                             bg-white focus:outline-none focus:border-blue-400
                             focus:ring-1 focus:ring-blue-100 placeholder:text-slate-400
                             transition-all duration-150"
                />
                {searchQuery && (
                  <button
                    onClick={handleClearSearch}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2
                               text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Port type filters — removed "ont" */}
              {["xdsl-line", "ethernet-line", "pon"].map((pt) => (
                <button
                  key={pt}
                  onClick={() => handlePortType(pt)}
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md border transition-all duration-150",
                    portTypeFilter === pt
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-700",
                  )}
                >
                  {pt}
                </button>
              ))}

              <div className="w-px h-4 bg-slate-200" />

              {/* State filters */}
              {["up", "down"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleState(s)}
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md border transition-all duration-150",
                    stateFilter === s
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-700",
                  )}
                >
                  {s}
                </button>
              ))}

              {/* Clear all */}
              {hasFilters && (
                <button
                  onClick={clearAll}
                  className="text-[9px] text-blue-600 hover:text-blue-700 font-medium underline ml-1"
                >
                  Clear
                </button>
              )}

              {/* Port count */}
              {hasLoaded && (
                <span className="text-[9px] font-medium text-slate-400 ml-auto tabular-nums">
                  {hasFilters ? `${ports.length}/${totalCount}` : ports.length}{" "}
                  ports
                </span>
              )}
            </div>
          </div>

          {/* Ports list */}
          <div className="bg-white p-3">
            {loading && (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 size={14} className="animate-spin text-blue-500" />
                <span className="text-[11px] text-slate-500 font-medium">
                  Loading...
                </span>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle
                  size={14}
                  className="text-red-500 mt-0.5 shrink-0"
                />
                <div>
                  <div className="text-[11px] font-semibold text-red-700">
                    Error
                  </div>
                  <div className="text-[10px] text-red-600 mt-0.5">{error}</div>
                </div>
              </div>
            )}

            {!loading && !error && ports.length === 0 && (
              <div className="text-center py-8">
                {hasFilters ? (
                  <div className="space-y-1.5">
                    <Search size={16} className="mx-auto text-slate-200" />
                    <p className="text-[11px] text-slate-400 font-medium">
                      No ports match
                    </p>
                    <button
                      onClick={clearAll}
                      className="text-[10px] text-blue-600 underline hover:text-blue-700"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 font-medium">
                    No ports found
                  </p>
                )}
              </div>
            )}

            {!loading && !error && ports.length > 0 && (
              <div className="space-y-3">
                {/* XDSL */}
                {xdslPorts.length > 0 && (
                  <PortSection
                    title="XDSL-LINE"
                    count={xdslPorts.length}
                    icon={<Zap size={11} />}
                    color="text-blue-600"
                    borderColor="border-blue-200"
                  >
                    <div className="space-y-1">
                      {xdslPorts.map((p) => (
                        <LTPortItem
                          key={p.port_id}
                          port={p}
                          isLocked={portLocks[p.port_id] || false}
                          instanceId={instanceId}
                          accessToken={accessToken}
                          isAdmin={isAdmin}
                          onLockToggle={() => handleLockToggle(p.port_id)}
                        />
                      ))}
                    </div>
                  </PortSection>
                )}

                {/* Ethernet */}
                {ethPorts.length > 0 && (
                  <PortSection
                    title="ETHERNET-LINE"
                    count={ethPorts.length}
                    icon={<Cable size={11} />}
                    color="text-blue-600"
                    borderColor="border-blue-200"
                  >
                    <div className="space-y-1">
                      {ethPorts.map((p) => (
                        <LTPortItem
                          key={p.port_id}
                          port={p}
                          isLocked={portLocks[p.port_id] || false}
                          instanceId={instanceId}
                          accessToken={accessToken}
                          isAdmin={isAdmin}
                          onLockToggle={() => handleLockToggle(p.port_id)}
                        />
                      ))}
                    </div>
                  </PortSection>
                )}

                {/* PON / ONT */}
                {ponGroups.length > 0 && (
                  <PortSection
                    title="PON / ONT"
                    count={ponGroups.reduce((s, g) => s + 1 + g.onts.length, 0)}
                    icon={<Radio size={11} />}
                    color="text-blue-600"
                    borderColor="border-blue-200"
                  >
                    <div className="space-y-2">
                      {ponGroups.map((group) => (
                        <PonGroupExpander
                          key={group.pon.port_id}
                          group={group}
                          portLocks={portLocks}
                          instanceId={instanceId}
                          accessToken={accessToken}
                          isAdmin={isAdmin}
                          onLockToggle={handleLockToggle}
                        />
                      ))}
                    </div>
                  </PortSection>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PonGroupExpander({
  group,
  portLocks,
  instanceId,
  accessToken,
  isAdmin,
  onLockToggle,
}: {
  group: { pon: any; onts: any[] };
  portLocks: Record<string, boolean>;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  onLockToggle: (portId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-blue-200/80 bg-blue-50/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50/50 transition-colors"
      >
        <ChevronRight
          size={11}
          className={cn(
            "text-blue-500 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <Radio size={10} className="text-blue-500" />
        <span className="text-[11px] font-bold text-slate-700 font-mono">
          PON {group.pon.port_id}
        </span>
        <span className="text-[9px] text-slate-400 font-medium">
          {group.onts.length} ONT
          {group.onts.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-blue-100 bg-white p-2.5">
          {group.onts.length === 0 ? (
            <p className="text-[10px] text-slate-400 pl-4">No ONTs</p>
          ) : (
            <div className="space-y-1 border-l-2 border-blue-100 pl-2.5 ml-1.5">
              {group.onts.map((ont) => (
                <LTPortItem
                  key={ont.port_id}
                  port={ont}
                  isLocked={portLocks[ont.port_id] || false}
                  instanceId={instanceId}
                  accessToken={accessToken}
                  isAdmin={isAdmin}
                  onLockToggle={() => onLockToggle(ont.port_id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniPill({
  label,
  value,
  up,
}: {
  label: string;
  value: string;
  up: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium",
        up
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500",
      )}
    >
      <div
        className={cn(
          "w-1 h-1 rounded-full",
          up ? "bg-emerald-500" : "bg-slate-300",
        )}
      />
      <span className={up ? "text-emerald-500" : "text-slate-400"}>
        {label}:
      </span>
      {value}
    </div>
  );
}
