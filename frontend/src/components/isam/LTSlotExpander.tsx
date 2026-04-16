import { useState, useCallback, useRef, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  Zap,
  Radio,
  Cable,
  Search,
  X,
  Signal,
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

interface SFPInfo {
  sfp_id: string;
  slot_short_id: string;
  sfp_index: number;
  port_id: string;
  status: string;
  is_empty: boolean;
  is_active: boolean;
  is_copper: boolean;
  part_number: string | null;
  wavelength: string | null;
  fiber_mode: string | null;
  standard: string | null;
  speed: string | null;
  direction: string | null;
  media: string | null;
  tx_wavelength: string | null;
  rx_wavelength: string | null;
  last_refresh_at: string | null;
}

type ConfigFilter = 'all' | 'configured' | 'not_configured' | 'unknown';

/**
 * Résout le SFP pour n'importe quel port_id.
 *
 * ethernet  "1/1/7/1"   → sfpMap["1/1/7/1"]   ✅ direct
 * ONT       "1/1/7/1/1" → sfpMap["1/1/7/1/1"] ❌ absent
 *                       → sfpMap["1/1/7/1"]    ✅ fallback (4 segments)
 */
function resolveSFP(sfpMap: Record<string, SFPInfo>, portId: string): SFPInfo | null {
  if (sfpMap[portId]) return sfpMap[portId];

  const parts = portId.split('/');
  if (parts.length === 5) {
    const parent = parts.slice(0, 4).join('/');
    if (sfpMap[parent]) return sfpMap[parent];
  }
  return null;
}

function PortSection({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={16}
            className={cn('text-gray-400 transition-transform', expanded && 'rotate-90')}
          />
          <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
            {icon}
            {title}
          </div>
        </div>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
      </button>

      {expanded && <div className="border-t border-gray-200 bg-gray-50 p-3">{children}</div>}
    </div>
  );
}

export default function LTSlotExpander({ slot, instanceId, accessToken, isAdmin }: LTSlotExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const [ports, setPorts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sfpMap, setSfpMap] = useState<Record<string, SFPInfo>>({});
  const [sfpLoading, setSfpLoading] = useState(false);
  const [sfpSyncing, setSfpSyncing] = useState(false);

  const [portLocks, setPortLocks] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [portTypeFilter, setPortTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [configFilter, setConfigFilter] = useState<ConfigFilter>('all');
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  const slotShort = slot.slot_id.replace('lt:', '').trim();

  async function loadSFP() {
    if (!accessToken) return;
    setSfpLoading(true);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodeURIComponent(slotShort)}/sfp`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return;

      const list: SFPInfo[] = await res.json();
      const map: Record<string, SFPInfo> = {};
      for (const sfp of list) map[sfp.port_id] = sfp;
      setSfpMap(map);
    } catch {
      // silencieux
    } finally {
      setSfpLoading(false);
    }
  }

  async function syncSFP() {
    if (!accessToken) return;
    setSfpSyncing(true);
    try {
      const params = new URLSearchParams();
      params.append('slot_short_ids', slotShort);

      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/transceivers/refresh?${params}`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);

      toast.success('SFP synced', { description: `Transceiver data refreshed for slot ${slotShort}` });
      await loadSFP();
    } catch (e: any) {
      toast.error('SFP sync failed', { description: e?.message });
    } finally {
      setSfpSyncing(false);
    }
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
        const url = `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlot}/ports${
          qs ? `?${qs}` : ''
        }`;

        const res = await fetch(url, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
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
        const msg = 'Failed to load ports. Please try again.';
        setError(msg);
        toast.error('Failed to load ports', { description: msg });
      } finally {
        setLoading(false);
      }
    },
    [slot.slot_id, instanceId, accessToken, ISAM_BASE_URL],
  );

  function handleToggle() {
    if (!expanded && !hasLoaded) {
      loadPorts();
      loadSFP();
    }
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
    setConfigFilter('all');
    loadPorts();
  }

  function getPortConfigStatus(p: any): string {
    const cfg = p?.config;
    if (typeof cfg === 'string') {
      try {
        return String(JSON.parse(cfg)?.status || 'UNKNOWN').toUpperCase();
      } catch {
        return 'UNKNOWN';
      }
    }
    return String(cfg?.status || 'UNKNOWN').toUpperCase();
  }

  function matchConfigFilter(p: any): boolean {
    const st = getPortConfigStatus(p);
    if (configFilter === 'all') return true;
    if (configFilter === 'configured') return ['VIA_APP', 'MANUAL', 'DRIFTED'].includes(st);
    if (configFilter === 'not_configured') return st === 'NOT_CONFIGURED';
    if (configFilter === 'unknown') return st === 'UNKNOWN';
    return true;
  }

  const visiblePorts = ports.filter(matchConfigFilter);
  const xdslPorts = visiblePorts.filter((p) => p.port_type === 'xdsl-line');
  const ethPorts = visiblePorts.filter((p) => p.port_type === 'ethernet-line');
  const ponPorts = visiblePorts.filter((p) => p.port_type === 'pon');
  const ontPorts = visiblePorts.filter((p) => p.port_type === 'ont');
  const mixedXdslEth = xdslPorts.length > 0 && ethPorts.length > 0;
  const effectiveEthPorts = mixedXdslEth ? [] : ethPorts;

  // Group PON + ONT
  const ponMap: Record<string, { pon: any; onts: any[] }> = {};
  ponPorts.forEach((pon) => {
    ponMap[pon.port_id] = { pon, onts: [] };
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

  const adminUp = (slot.admin_state || '').toLowerCase() === 'up';
  const portUp = (slot.port_state || '').toLowerCase() === 'up';
  const hasFilters = !!activeSearch || !!portTypeFilter || !!stateFilter || configFilter !== 'all';
  const isTrulyEmpty = hasLoaded && totalCount === 0 && !hasFilters;

  function getSlotIcon() {
    const pt = (slot.port_type || '').toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={18} className="text-blue-600" />;
    if (pt.includes('pon') || pt.includes('ont')) return <Radio size={18} className="text-purple-600" />;
    if (pt.includes('ethernet')) return <Cable size={18} className="text-green-600" />;
    return <Cable size={18} className="text-gray-600" />;
  }

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-all bg-white',
        expanded ? 'border-blue-200 shadow-md' : 'border-gray-200 hover:border-gray-300',
      )}
    >
      {/* Header slot */}
      <button
        onClick={handleToggle}
        className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 border border-gray-200">
          {getSlotIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-semibold text-gray-900 text-sm">{slot.slot_id}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{slot.board}</span>

            {Object.keys(sfpMap).length > 0 && (
              <span className="text-xs text-cyan-600 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded flex items-center gap-1">
                <Signal size={10} />
                {Object.keys(sfpMap).length} SFP
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <StatePill label="Admin" value={slot.admin_state} up={adminUp} />
            <StatePill label="Port" value={slot.port_state} up={portUp} />
          </div>
        </div>

        <ChevronDown size={20} className={cn('text-gray-400 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-gray-200">
          {/* Barre filtres */}
          {!isTrulyEmpty && (
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search port ID or serial..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={handleClearSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Port type */}
                <div className="flex gap-1.5">
                  {['xdsl-line', 'ethernet-line', 'ont', 'pon'].map((pt) => (
                    <button
                      key={pt}
                      onClick={() => handlePortType(pt)}
                      className={cn(
                        'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        portTypeFilter === pt
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                      )}
                    >
                      {pt}
                    </button>
                  ))}
                </div>

                {/* State */}
                <div className="flex gap-1.5">
                  {['up', 'down'].map((s) => (
                    <button
                      key={s}
                      onClick={() => handleState(s)}
                      className={cn(
                        'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors capitalize',
                        stateFilter === s
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Config filter */}
                <div className="flex gap-1.5">
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'configured', label: 'Configured' },
                    { key: 'not_configured', label: 'Not configured' },
                    { key: 'unknown', label: 'Unknown' },
                  ].map((it) => (
                    <button
                      key={it.key}
                      onClick={() => setConfigFilter(it.key as ConfigFilter)}
                      className={cn(
                        'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        configFilter === it.key
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                      )}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>

                {/* Sync SFP (admin) */}
                {isAdmin && (
                  <button
                    onClick={syncSFP}
                    disabled={sfpSyncing || sfpLoading}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium',
                      'rounded-lg border transition-colors',
                      'bg-cyan-600 text-white border-cyan-600 hover:bg-cyan-700 disabled:opacity-50',
                    )}
                    title={`Sync SFP transceiver data for slot ${slotShort}`}
                  >
                    {sfpSyncing ? <Loader2 size={12} className="animate-spin" /> : <Signal size={12} />}
                    {sfpSyncing ? 'Syncing…' : 'Sync SFP'}
                  </button>
                )}

                {hasFilters && (
                  <button onClick={clearAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium underline">
                    Clear filters
                  </button>
                )}

                {hasLoaded && (
                  <span className="text-xs text-gray-500 ml-auto bg-white px-2 py-1 rounded border border-gray-200">
                    {hasFilters ? `${visiblePorts.length} / ${totalCount}` : visiblePorts.length} ports
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Corps */}
          <div className="p-4 bg-white">
            {loading && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 size={24} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-500">Loading ports...</span>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">{error}</div>
              </div>
            )}

            {!loading && !error && visiblePorts.length === 0 && (
              <div className="text-center py-8">
                {hasFilters ? (
                  <>
                    <Search size={24} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500 mb-2">No ports match your filters</p>
                    <button onClick={clearAll} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <AlertCircle size={24} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">No ports configured</p>
                  </>
                )}
              </div>
            )}

            {!loading && !error && visiblePorts.length > 0 && (
              <div className="space-y-3">
                {/* XDSL */}
                {xdslPorts.length > 0 && (
                  <PortSection title="XDSL Lines" count={xdslPorts.length} icon={<Zap size={14} />}>
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
                          sfp={resolveSFP(sfpMap, p.port_id)}
                        />
                      ))}
                    </div>
                  </PortSection>
                )}

                {/* Ethernet */}
                {effectiveEthPorts.length > 0 && (
                  <PortSection title="Ethernet Lines" count={effectiveEthPorts.length} icon={<Cable size={14} />}>
                    <div className="space-y-2">
                      {effectiveEthPorts.map((p) => (
                        <LTPortItem
                          key={p.port_id}
                          port={p}
                          isLocked={portLocks[p.port_id] || false}
                          instanceId={instanceId}
                          accessToken={accessToken}
                          isAdmin={isAdmin}
                          onLockToggle={() => handleLockToggle(p.port_id)}
                          sfp={resolveSFP(sfpMap, p.port_id)}
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
                    icon={<Radio size={14} />}
                  >
                    <div className="space-y-2">
                      {ponGroups.map((group) => (
                        <PonGroupExpander
                          key={group.pon.port_id}
                          group={group}
                          portLocks={portLocks}
                          sfpMap={sfpMap}
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
  sfpMap,
  instanceId,
  accessToken,
  isAdmin,
  onLockToggle,
}: {
  group: { pon: any; onts: any[] };
  portLocks: Record<string, boolean>;
  sfpMap: Record<string, SFPInfo>;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  onLockToggle: (portId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        <ChevronRight size={16} className={cn('text-gray-400 transition-transform', expanded && 'rotate-90')} />
        <Radio size={14} className="text-purple-600" />
        <span className="text-xs font-medium text-gray-700 font-mono">{group.pon.port_id}</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded ml-auto">
          {group.onts.length} ONT{group.onts.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-2">
          {(() => {
            // ✅ SFP du port PON parent
            const parentSfp = resolveSFP(sfpMap, group.pon.port_id);

            return (
              <div className="space-y-2">
                {/* ✅ Afficher SFP sur PON */}
                <LTPortItem
                  key={group.pon.port_id}
                  port={group.pon}
                  isLocked={portLocks[group.pon.port_id] || false}
                  instanceId={instanceId}
                  accessToken={accessToken}
                  isAdmin={isAdmin}
                  onLockToggle={() => onLockToggle(group.pon.port_id)}
                  sfp={parentSfp}
                />

                {/* ✅ ONT: juste empty/plugged (géré dans LTPortItem car port_type=ont) */}
                {group.onts.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-2">No ONTs</p>
                ) : (
                  <div className="space-y-2">
                    {group.onts.map((ont) => (
                      <LTPortItem
                        key={ont.port_id}
                        port={ont}
                        isLocked={portLocks[ont.port_id] || false}
                        instanceId={instanceId}
                        accessToken={accessToken}
                        isAdmin={isAdmin}
                        onLockToggle={() => onLockToggle(ont.port_id)}
                        sfp={parentSfp} // ✅ même SFP → empty/plugged
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function StatePill({ label, value, up }: { label: string; value: string; up: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs',
        up ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600',
      )}
    >
      <div className={cn('w-1.5 h-1.5 rounded-full', up ? 'bg-green-500' : 'bg-gray-400')} />
      <span className="capitalize">
        {label}: {value}
      </span>
    </div>
  );
}