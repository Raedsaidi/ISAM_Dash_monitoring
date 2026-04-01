import React, { useState, useCallback, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Zap,
  Radio,
  Wifi,
  Cable,
  Search,
  X,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { toast } from 'sonner';
import LTPortItem from './LTPortItem';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [portTypeFilter, setPortTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  function getSlotIcon() {
    const pt = slot.port_type.toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={15} />;
    if (pt.includes('pon') || pt.includes('ont')) return <Radio size={15} />;
    if (pt.includes('ethernet')) return <Cable size={15} />;
    return <Wifi size={15} />;
  }

  function getSlotStyle() {
    const pt = slot.port_type.toLowerCase();
    if (pt.includes('xdsl'))
      return 'text-amber-700 bg-amber-50 border-amber-200';
    if (pt.includes('pon') || pt.includes('ont'))
      return 'text-violet-700 bg-violet-50 border-violet-200';
    if (pt.includes('ethernet'))
      return 'text-sky-700 bg-sky-50 border-sky-200';
    return 'text-zinc-600 bg-zinc-50 border-zinc-200';
  }

  const loadPorts = useCallback(
    async (search?: string, ptFilter?: string, stFilter?: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (ptFilter) params.set('port_type', ptFilter);
        if (stFilter) params.set('state', stFilter);

        const qs = params.toString();
        const encodedSlot = encodeURIComponent(slot.slot_id);
        const url = `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlot}/ports${qs ? `?${qs}` : ''}`;

        const res = await fetch(url, {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch {}
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
        setError(err.message || 'Failed to load ports');
        toast.error('Failed to load ports');
      } finally {
        setLoading(false);
      }
    },
    [slot.slot_id, instanceId, accessToken, ISAM_BASE_URL]
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
    setSearchQuery('');
    setActiveSearch('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    loadPorts('', portTypeFilter, stateFilter);
  }

  function handlePortType(val: string) {
    const next = portTypeFilter === val ? '' : val;
    setPortTypeFilter(next);
    loadPorts(activeSearch, next, stateFilter);
  }

  function handleState(val: string) {
    const next = stateFilter === val ? '' : val;
    setStateFilter(next);
    loadPorts(activeSearch, portTypeFilter, next);
  }

  function handleLockToggle(portId: string) {
    setPortLocks((prev) => ({ ...prev, [portId]: !prev[portId] }));
  }

  function clearAll() {
    setSearchQuery('');
    setActiveSearch('');
    setPortTypeFilter('');
    setStateFilter('');
    loadPorts();
  }

  // Group ports
  const xdslPorts = ports.filter((p) => p.port_type === 'xdsl-line');
  const ethPorts = ports.filter((p) => p.port_type === 'ethernet-line');
  const ponPorts = ports.filter((p) => p.port_type === 'pon');
  const ontPorts = ports.filter((p) => p.port_type === 'ont');

  const ponMap: Record<string, { pon: any; onts: any[] }> = {};
  ponPorts.forEach((pon) => {
    if (!ponMap[pon.port_id]) ponMap[pon.port_id] = { pon, onts: [] };
  });
  ontPorts.forEach((ont) => {
    const parts = (ont.port_id || '').split('/');
    if (parts.length < 4) return;
    const parentId = parts.slice(0, 4).join('/');
    if (!ponMap[parentId]) {
      ponMap[parentId] = {
        pon: {
          port_id: parentId,
          port_type: 'pon',
          admin_state: 'unknown',
          port_state: 'unknown',
          board: slot.board,
        },
        onts: [],
      };
    }
    ponMap[parentId].onts.push(ont);
  });
  const ponGroups = Object.values(ponMap);

  const adminUp = ['up'].includes(slot.admin_state.toLowerCase());
  const portUp = ['up'].includes(slot.port_state.toLowerCase());
  const hasFilters = !!activeSearch || !!portTypeFilter || !!stateFilter;

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-all duration-100',
        expanded
          ? 'border-zinc-300 shadow-[0_2px_8px_rgba(0,0,0,0.04)]'
          : 'border-zinc-200 hover:border-zinc-300'
      )}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        className={cn(
          'w-full px-4 py-3 text-left flex items-center gap-3 transition-colors',
          expanded ? 'bg-zinc-50/80' : 'bg-white hover:bg-zinc-50/40'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg border shrink-0',
            getSlotStyle()
          )}
        >
          {getSlotIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-zinc-900 text-[15px]">
              {slot.slot_id}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 bg-zinc-100 px-1.5 py-px rounded border border-zinc-200">
              {slot.board}
            </span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <MiniPill label="Admin" value={slot.admin_state} up={adminUp} />
          <MiniPill label="Port" value={slot.port_state} up={portUp} />
        </div>

        <div className="text-zinc-400 shrink-0">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="border-t border-zinc-200">
          {/* Search bar */}
          <div className="bg-zinc-50/60 border-b border-zinc-100 px-4 py-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="text"
                  placeholder="Search port ID, type..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-7 pr-7 py-1 text-[11px] border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 placeholder:text-zinc-400"
                />
                {searchQuery && (
                  <button
                    onClick={handleClearSearch}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-0.5"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {['xdsl-line', 'ethernet-line', 'pon', 'ont'].map((pt) => (
                <button
                  key={pt}
                  onClick={() => handlePortType(pt)}
                  className={cn(
                    'px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border transition-all',
                    portTypeFilter === pt
                      ? 'bg-zinc-800 text-white border-zinc-800'
                      : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'
                  )}
                >
                  {pt}
                </button>
              ))}

              <div className="w-px h-4 bg-zinc-200" />

              {['up', 'down'].map((s) => (
                <button
                  key={s}
                  onClick={() => handleState(s)}
                  className={cn(
                    'px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border transition-all',
                    stateFilter === s
                      ? s === 'up'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-red-500 text-white border-red-500'
                      : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'
                  )}
                >
                  {s}
                </button>
              ))}

              {hasLoaded && (
                <span className="text-[9px] font-medium text-zinc-400 ml-auto tabular-nums">
                  {hasFilters
                    ? `${ports.length}/${totalCount}`
                    : ports.length}{' '}
                  ports
                </span>
              )}
            </div>
          </div>

          {/* Ports list */}
          <div className="bg-white p-3">
            {loading && (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 size={14} className="animate-spin text-zinc-400" />
                <span className="text-[11px] text-zinc-500 font-medium">
                  Loading...
                </span>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={14} className="text-red-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[11px] font-semibold text-red-900">
                    Error
                  </div>
                  <div className="text-[10px] text-red-700 mt-0.5">{error}</div>
                </div>
              </div>
            )}

            {!loading && !error && ports.length === 0 && (
              <div className="text-center py-8">
                {hasFilters ? (
                  <div className="space-y-1.5">
                    <Search size={16} className="mx-auto text-zinc-300" />
                    <p className="text-[11px] text-zinc-400 font-medium">
                      No ports match
                    </p>
                    <button
                      onClick={clearAll}
                      className="text-[10px] text-zinc-500 underline hover:text-zinc-700"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-400 font-medium">
                    No ports found
                  </p>
                )}
              </div>
            )}

            {!loading && !error && ports.length > 0 && (
              <div className="space-y-5">
                {xdslPorts.length > 0 && (
                  <PortSection
                    title="XDSL-LINE"
                    count={xdslPorts.length}
                    icon={<Zap size={11} />}
                    color="text-amber-600"
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

                {ethPorts.length > 0 && (
                  <PortSection
                    title="ETHERNET-LINE"
                    count={ethPorts.length}
                    icon={<Cable size={11} />}
                    color="text-sky-600"
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

                {ponGroups.length > 0 && (
                  <PortSection
                    title="PON / ONT"
                    count={ponGroups.reduce((s, g) => s + 1 + g.onts.length, 0)}
                    icon={<Radio size={11} />}
                    color="text-violet-600"
                  >
                    <div className="space-y-2">
                      {ponGroups.map((group) => (
                        <div
                          key={group.pon.port_id}
                          className="rounded-lg border border-zinc-200/80 bg-zinc-50/30 p-2.5"
                        >
                          <div className="flex items-center gap-1.5 mb-2">
                            <Radio size={10} className="text-violet-500" />
                            <span className="text-[11px] font-bold text-zinc-800 font-mono">
                              PON {group.pon.port_id}
                            </span>
                            <span className="text-[9px] text-zinc-400 font-medium">
                              {group.onts.length} ONT
                              {group.onts.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {group.onts.length === 0 ? (
                            <p className="text-[10px] text-zinc-400 pl-4">
                              No ONTs
                            </p>
                          ) : (
                            <div className="space-y-1 border-l-2 border-violet-100 pl-2.5 ml-1.5">
                              {group.onts.map((ont) => (
                                <LTPortItem
                                  key={ont.port_id}
                                  port={ont}
                                  isLocked={portLocks[ont.port_id] || false}
                                  instanceId={instanceId}
                                  accessToken={accessToken}
                                  isAdmin={isAdmin}
                                  onLockToggle={() =>
                                    handleLockToggle(ont.port_id)
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
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
        'flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium',
        up
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-zinc-200 bg-zinc-50 text-zinc-500'
      )}
    >
      <div
        className={cn(
          'w-1 h-1 rounded-full',
          up ? 'bg-emerald-500' : 'bg-zinc-300'
        )}
      />
      <span className={up ? 'text-emerald-500' : 'text-zinc-400'}>
        {label}:
      </span>
      {value}
    </div>
  );
}

function PortSection({
  title,
  count,
  icon,
  color,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className={cn(
            'flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest',
            color
          )}
        >
          {icon}
          {title}
        </div>
        <div className="h-px flex-1 bg-zinc-100" />
        <span className="text-[9px] text-zinc-400 font-medium tabular-nums">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}