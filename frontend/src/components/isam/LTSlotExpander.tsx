import { useState, useCallback, useRef } from 'react';
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

function PortSection({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-[0_2px_10px_rgba(15,23,42,0.03)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3.5 py-2.5 transition-colors',
          expanded ? 'bg-slate-50/80' : 'bg-white hover:bg-slate-50/60',
        )}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={14}
            className={cn(
              'text-slate-400 transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-800">
            {icon}
            {title}
          </div>
        </div>

        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
          {count} port{count !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/30 p-2.5">
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
    if (pt.includes('xdsl')) return <Zap size={16} className="text-blue-800" />;
    if (pt.includes('pon') || pt.includes('ont'))
      return <Radio size={16} className="text-blue-800" />;
    if (pt.includes('ethernet'))
      return <Cable size={16} className="text-blue-800" />;
    return <Wifi size={16} className="text-blue-800" />;
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
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch {
          //
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
        setError(err.message || 'Failed to load ports');
        toast.error('Failed to load ports');
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
  const isTrulyEmpty = hasLoaded && totalCount === 0 && !hasFilters;

  return (
    <div
      className={cn(
        'rounded-2xl border overflow-hidden transition-all duration-200 bg-white',
        expanded
          ? 'border-blue-200 shadow-[0_8px_30px_rgba(30,41,59,0.08)] ring-1 ring-blue-100'
          : 'border-slate-200/80 shadow-[0_2px_10px_rgba(15,23,42,0.03)] hover:border-slate-300 hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)]',
      )}
    >
      <button
        onClick={handleToggle}
        className={cn(
          'w-full px-4 py-3.5 text-left flex items-center gap-4 transition-colors focus:outline-none',
          expanded
            ? 'bg-gradient-to-r from-slate-50 to-white'
            : 'bg-white hover:bg-slate-50/70',
        )}
      >
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-100 shadow-sm shrink-0">
          {getSlotIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-mono font-semibold text-slate-900 text-[15px] tracking-tight">
              {slot.slot_id}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 bg-slate-100/80 px-2 py-0.5 rounded-full border border-slate-200">
              {slot.board}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <MiniPill label="Admin" value={slot.admin_state} up={adminUp} />
            <MiniPill label="Port" value={slot.port_state} up={portUp} />
          </div>
        </div>

        <div className="text-slate-400 shrink-0 p-2 rounded-full bg-slate-100/70 border border-slate-200/70 transition-colors">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 bg-white">
          {!isTrulyEmpty && (
            <div className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    placeholder="Search port ID..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-2 text-sm border border-slate-200 rounded-lg bg-white/90 focus:outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100 placeholder:text-slate-400 transition-all duration-150 shadow-sm"
                  />
                  {searchQuery && (
                    <button
                      onClick={handleClearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1 hidden sm:block" />

                <div className="flex gap-1.5 flex-wrap">
                  {['xdsl-line', 'ethernet-line', 'pon'].map((pt) => (
                    <button
                      key={pt}
                      onClick={() => handlePortType(pt)}
                      className={cn(
                        'px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] rounded-full border transition-all duration-150',
                        portTypeFilter === pt
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      {pt}
                    </button>
                  ))}
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1 hidden lg:block" />

                <div className="flex gap-1.5">
                  {['up', 'down'].map((s) => (
                    <button
                      key={s}
                      onClick={() => handleState(s)}
                      className={cn(
                        'px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] rounded-full border transition-all duration-150',
                        stateFilter === s
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {hasFilters && (
                  <button
                    onClick={clearAll}
                    className="text-[11px] text-blue-800 hover:text-blue-950 font-semibold underline ml-2"
                  >
                    Clear
                  </button>
                )}

                {hasLoaded && (
                  <span className="text-[11px] font-medium text-slate-500 ml-auto tabular-nums bg-white px-2.5 py-1 rounded-full border border-slate-200 shadow-sm">
                    {hasFilters ? `${ports.length} / ${totalCount}` : ports.length} ports
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="p-4 bg-slate-50/30">
            {loading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 size={24} className="animate-spin text-blue-900" />
                <span className="text-sm text-slate-500 font-medium">
                  Loading ports...
                </span>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl shadow-sm">
                <AlertCircle size={20} className="text-red-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-red-800">Error</div>
                  <div className="text-sm text-red-600 mt-1">{error}</div>
                </div>
              </div>
            )}

            {!loading && !error && ports.length === 0 && (
              <div className="text-center py-10">
                {hasFilters ? (
                  <div className="space-y-2">
                    <Search size={24} className="mx-auto text-slate-300" />
                    <p className="text-sm text-slate-500 font-medium">
                      No ports match your filters
                    </p>
                    <button
                      onClick={clearAll}
                      className="text-sm text-blue-900 font-semibold hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                      <AlertCircle size={24} className="text-slate-300" />
                    </div>
                    <p className="text-sm text-slate-500 font-medium">
                      No ports configured on this slot.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!loading && !error && ports.length > 0 && (
              <div className="space-y-4">
                {xdslPorts.length > 0 && (
                  <PortSection
                    title="XDSL-LINE"
                    count={xdslPorts.length}
                    icon={<Zap size={14} />}
                  >
                    <div className="space-y-2">
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
                    icon={<Cable size={14} />}
                  >
                    <div className="space-y-2">
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
                    icon={<Radio size={14} />}
                  >
                    <div className="space-y-3">
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
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-100/80 transition-colors focus:outline-none"
      >
        <ChevronRight
          size={14}
          className={cn(
            'text-slate-400 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        <Radio size={14} className="text-blue-900" />
        <span className="text-xs font-semibold text-slate-800 font-mono tracking-tight">
          PON {group.pon.port_id}
        </span>
        <span className="text-[10px] text-slate-500 font-medium px-2 py-0.5 bg-white border border-slate-200 rounded-full shadow-sm">
          {group.onts.length} ONT{group.onts.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 bg-white p-3">
          {group.onts.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No ONTs assigned.</p>
          ) : (
            <div className="space-y-2 border-l border-dashed border-slate-200 pl-3 ml-2">
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
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium shadow-sm',
        up
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-500',
      )}
    >
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          up ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      />
      <span className={up ? 'text-emerald-600' : 'text-slate-400'}>
        {label}:
      </span>
      <span className="uppercase">{value}</span>
    </div>
  );
}