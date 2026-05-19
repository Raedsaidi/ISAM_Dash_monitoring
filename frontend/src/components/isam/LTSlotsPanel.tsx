import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Layers,
  Search,
  ChevronRight,
  Zap,
  Cable,
  Radio,
  Server,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import LTSlotExpander from './LTSlotExpander';
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

interface LTSlotsPanelProps {
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  instanceName?: string;
  instanceHost?: string;
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

interface OntSearchResult {
  ont: any;
  slotId: string;
  ponPortId: string;
  sfp: SFPInfo | null;
}

function looksLikeOntSerial(q: string) {
  const s = q.trim().toLowerCase();
  if (s.length < 4) return false;
  if (s.includes('lt:') || s.includes('/')) return false; // slot / port patterns
  const hasLetter = /[a-z]/.test(s);
  const hasDigit = /\d/.test(s);
  return hasLetter && hasDigit;
}

function getSlotCategory(portType: string): string {
  const pt = (portType || '').toLowerCase();
  if (pt.includes('xdsl')) return 'XDSL';
  if (pt.includes('pon') || pt.includes('ont') || pt.includes('gpon')) return 'PON';
  if (pt.includes('ethernet')) return 'Ethernet';
  return 'Other';
}

function getCategoryStyle(category: string) {
  switch (category) {
    case 'XDSL':
      return {
        icon: <Zap size={18} className="text-blue-600" />,
        bg: 'bg-blue-50 border-blue-200',
      };
    case 'PON':
      return {
        icon: <Radio size={18} className="text-purple-600" />,
        bg: 'bg-purple-50 border-purple-200',
      };
    case 'Ethernet':
      return {
        icon: <Cable size={18} className="text-green-600" />,
        bg: 'bg-green-50 border-green-200',
      };
    default:
      return {
        icon: <Server size={18} className="text-gray-600" />,
        bg: 'bg-gray-50 border-gray-200',
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
  const [expanded, setExpanded] = useState(true);
  const style = getCategoryStyle(category);

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg border', style.bg)}>{style.icon}</div>
          <div>
            <h3 className="font-semibold text-gray-900">{category}</h3>
            <p className="text-xs text-gray-500">
              {slots.length} slot{slots.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <ChevronRight
          size={20}
          className={cn('text-gray-400 transition-transform', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-4">
          <div className="space-y-3">
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

function OntSernumResults({
  results,
  instanceId,
  accessToken,
  isAdmin,
  query,
}: {
  results: OntSearchResult[];
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  query: string;
}) {
  if (results.length === 0) {
    return (
      <div className="text-center py-16">
        <Radio size={32} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm font-medium text-gray-500">No ONT found</p>
        <p className="text-xs text-gray-400 mt-1">
          No ONT serial number matches{' '}
          <span className="font-mono font-semibold text-purple-600">"{query}"</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Radio size={14} className="text-purple-600" />
        <span className="text-sm font-medium text-gray-700">
          {results.length} ONT{results.length !== 1 ? 's' : ''} found for{' '}
          <span className="font-mono font-semibold text-purple-600">"{query}"</span>
        </span>
      </div>

      {results.map((r) => (
        <div key={r.ont.port_id} className="rounded-lg border border-purple-100 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border-b border-purple-100 text-[11px] text-purple-500">
            <span className="font-mono">{r.slotId}</span>
            <ChevronRight size={10} />
            <span className="font-mono">{r.ponPortId}</span>
          </div>

          <div className="p-2 bg-white">
            <LTPortItem
              port={r.ont}
              isLocked={false}
              instanceId={instanceId}
              accessToken={accessToken}
              isAdmin={isAdmin}
              onLockToggle={() => {}}
              sfp={r.sfp}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LTSlotsPanel({
  instanceId,
  accessToken,
  isAdmin,
  instanceName,
  instanceHost,
}: LTSlotsPanelProps) {
  const [slots, setSlots] = useState<LTSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingLT, setSyncingLT] = useState(false);
  const [syncingVLAN, setSyncingVLAN] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Recherche unique (slot/board OU serial ONT)
  const [search, setSearch] = useState('');

  // ONT serial results
  const [computedResults, setComputedResults] = useState<OntSearchResult[]>([]);
  const [sernumSearching, setSernumSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache en ref (pas en state → pas de re-render / pas de boucles)
  const slotDataCacheRef = useRef<Record<string, { ports: any[]; sfpMap: Record<string, SFPInfo> }>>(
    {},
  );

  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {}
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch {
      const errorMsg = 'Failed to load LT slots. Please try again.';
      setError(errorMsg);
      toast.error('Failed to load slots', { description: errorMsg });
    } finally {
      setLoading(false);
    }
  }

  const fetchSlotData = useCallback(
    async (slot: LTSlot): Promise<{ ports: any[]; sfpMap: Record<string, SFPInfo> }> => {
      const cached = slotDataCacheRef.current[slot.slot_id];
      if (cached) return cached;

      const slotShort = slot.slot_id.replace('lt:', '').trim();
      const encodedSlot = encodeURIComponent(slot.slot_id);
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

      const [portsRes, sfpRes] = await Promise.allSettled([
        fetch(
          `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlot}/ports`,
          { headers },
        ),
        fetch(
          `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodeURIComponent(slotShort)}/sfp`,
          { headers },
        ),
      ]);

      let ports: any[] = [];
      if (portsRes.status === 'fulfilled' && portsRes.value.ok) {
        const d = await portsRes.value.json().catch(() => ({}));
        ports = d.ports || [];
      }

      const sfpMap: Record<string, SFPInfo> = {};
      if (sfpRes.status === 'fulfilled' && sfpRes.value.ok) {
        const list: SFPInfo[] = await sfpRes.value.json().catch(() => []);
        for (const sfp of list) sfpMap[sfp.port_id] = sfp;
      }

      const result = { ports, sfpMap };
      slotDataCacheRef.current[slot.slot_id] = result;
      return result;
    },
    [ISAM_BASE_URL, instanceId, accessToken],
  );

  function resolveSFP(sfpMap: Record<string, SFPInfo>, portId: string): SFPInfo | null {
    if (sfpMap[portId]) return sfpMap[portId];
    const parts = portId.split('/');
    if (parts.length === 5) {
      const parent = parts.slice(0, 4).join('/');
      if (sfpMap[parent]) return sfpMap[parent];
    }
    return null;
  }

  function getOntSernum(port: any): string {
    const cfg = port?.config;
    if (!cfg) return '';
    if (typeof cfg === 'string') {
      try {
        return String(JSON.parse(cfg)?.ont_sernum || '');
      } catch {
        return '';
      }
    }
    return String(cfg?.ont_sernum || '');
  }

  const isSerialMode = useMemo(() => looksLikeOntSerial(search), [search]);

  // ✅ Recherche ONT serial via le même champ `search` (avec debounce)
  useEffect(() => {
    const q = search.trim().toLowerCase();

    // si pas en mode serial → pas de résultats ONT
    if (!q || !isSerialMode) {
      setComputedResults([]);
      setSernumSearching(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }

    if (slots.length === 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSernumSearching(true);

    let cancelled = false;

    debounceRef.current = setTimeout(() => {
      Promise.all(slots.map((slot) => fetchSlotData(slot)))
        .then((slotDataList) => {
          if (cancelled) return;

          const results: OntSearchResult[] = [];

          slots.forEach((slot, i) => {
            const { ports, sfpMap } = slotDataList[i];
            const ontPorts = ports.filter((p) => p.port_type === 'ont');

            ontPorts.forEach((ont) => {
              const sn = getOntSernum(ont).toLowerCase();
              if (!sn.includes(q)) return;

              const parts = (ont.port_id || '').split('/');
              const ponPortId = parts.length >= 4 ? parts.slice(0, 4).join('/') : ont.port_id;

              results.push({
                ont,
                slotId: slot.slot_id,
                ponPortId,
                sfp: resolveSFP(sfpMap, ont.port_id),
              });
            });
          });

          setComputedResults(results);
        })
        .finally(() => {
          if (!cancelled) setSernumSearching(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, isSerialMode, slots, fetchSlotData]);

  async function handleForceSyncLT() {
    setSyncingLT(true);
    try {
      const res = await fetch(`${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Sync failed');
      toast.success('LT sync completed', {
        description: 'Slots and ports have been synchronized from the equipment.',
      });

      // ✅ vider cache
      slotDataCacheRef.current = {};
      await loadSlots();
    } catch (err: any) {
      toast.error('LT sync failed', { description: err?.message });
    } finally {
      setSyncingLT(false);
    }
  }

  async function handleForceSyncVLAN() {
    setSyncingVLAN(true);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/ports-config/sync?force=true`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
          },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Sync failed');
      toast.success('VLAN sync started', {
        description: 'Info-flat sync started in background. Refresh ports later.',
      });
    } catch (err: any) {
      toast.error('VLAN sync failed', { description: err?.message });
    } finally {
      setSyncingVLAN(false);
    }
  }

  // Filtrage slots/board avec le même champ search (quand ce n’est pas un serial)
  const filteredSlots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return slots;
    if (isSerialMode) return slots; // en mode serial, on ne filtre pas les slots (on affiche la vue ONT)

    return slots.filter(
      (s) => s.slot_id.toLowerCase().includes(q) || s.board.toLowerCase().includes(q),
    );
  }, [slots, search, isSerialMode]);

  const grouped = useMemo(() => {
    const groups: Record<string, LTSlot[]> = {};
    filteredSlots.forEach((slot) => {
      const cat = getSlotCategory(slot.port_type);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(slot);
    });
    const order = ['XDSL', 'PON', 'Ethernet', 'Other'];
    return order
      .filter((cat) => groups[cat])
      .map((cat) => [cat, groups[cat]] as [string, LTSlot[]]);
  }, [filteredSlots]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Layers size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">LT Slots & Ports</h3>
            {(instanceName || instanceHost) && (
              <p className="text-xs text-gray-500">
                {instanceName ?? ''}
                {instanceName && instanceHost ? ' — ' : ''}
                {instanceHost ?? ''}
              </p>
            )}
          </div>
          {!loading && slots.length > 0 && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{slots.length}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* ✅ Recherche unique */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search slot/board or ONT serial..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg w-64 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            onClick={loadSlots}
            disabled={loading || syncingLT || syncingVLAN}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={handleForceSyncLT}
            disabled={syncingLT || loading || syncingVLAN}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {syncingLT ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncingLT ? 'Syncing LT…' : 'Sync from Equipment'}
          </button>

          <button
            onClick={handleForceSyncVLAN}
            disabled={syncingVLAN || loading || syncingLT}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
          >
            {syncingVLAN ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncingVLAN ? 'Syncing VLAN…' : 'Sync VLAN info'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 size={20} className="animate-spin text-blue-600" />
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      )}

      {error && !loading && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* ✅ Mode serial ONT (automatique) */}
      {!loading && !error && isSerialMode && (
        <div>
          {sernumSearching ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 size={20} className="animate-spin text-purple-600" />
              <span className="text-sm text-gray-500">Searching ONT serials…</span>
            </div>
          ) : (
            <OntSernumResults
              results={computedResults}
              instanceId={instanceId}
              accessToken={accessToken}
              isAdmin={isAdmin}
              query={search.trim()}
            />
          )}
        </div>
      )}

      {/* Mode normal slots */}
      {!loading && !error && !isSerialMode && (
        <>
          {grouped.length === 0 ? (
            <div className="text-center py-12">
              <Layers className="mx-auto mb-3 text-gray-300" size={32} />
              <p className="text-sm text-gray-500">No LT slots found</p>
            </div>
          ) : (
            <div>
              {grouped.map(([category, categorySlots]) => (
                <SlotCategoryGroup
                  key={category}
                  category={category}
                  slots={categorySlots}
                  instanceId={instanceId}
                  accessToken={accessToken}
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}