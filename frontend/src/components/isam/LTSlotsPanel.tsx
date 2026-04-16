import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../utils/cn';
import LTSlotExpander from './LTSlotExpander';

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

  // optionnel
  instanceName?: string;
  instanceHost?: string;
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
      return { icon: <Zap size={18} className="text-blue-600" />, bg: 'bg-blue-50 border-blue-200' };
    case 'PON':
      return { icon: <Radio size={18} className="text-purple-600" />, bg: 'bg-purple-50 border-purple-200' };
    case 'Ethernet':
      return { icon: <Cable size={18} className="text-green-600" />, bg: 'bg-green-50 border-green-200' };
    default:
      return { icon: <Server size={18} className="text-gray-600" />, bg: 'bg-gray-50 border-gray-200' };
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
            <p className="text-xs text-gray-500">{slots.length} slot{slots.length !== 1 ? 's' : ''}</p>
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
  const [searchSlot, setSearchSlot] = useState('');

  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        }
      );

      let data: any = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      const errorMsg = 'Failed to load LT slots. Please try again.';
      setError(errorMsg);
      toast.error('Failed to load slots', { description: errorMsg });
      console.error('Load slots error:', err);
    } finally {
      setLoading(false);
    }
  }

  // Sync LT slots/ports snapshot (existant chez toi)
  async function handleForceSyncLT() {
    setSyncingLT(true);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
          },
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Sync failed');

      toast.success('LT sync completed', {
        description: 'Slots and ports have been synchronized from the equipment.',
      });

      await loadSlots();
    } catch (err: any) {
      toast.error('LT sync failed', {
        description: err?.message || 'Unable to sync LT data. Please try again.',
      });
      console.error('LT sync error:', err);
    } finally {
      setSyncingLT(false);
    }
  }

  // NEW: Sync VLAN info-flat for ALL ports (ports_config)
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
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Sync failed');

      toast.success('VLAN sync started', {
        description:
          'Info-flat sync started in background. It may take several minutes. Refresh ports later.',
      });
    } catch (err: any) {
      toast.error('VLAN sync failed', {
        description: err?.message || 'Unable to sync VLAN info. Please try again.',
      });
      console.error('VLAN sync error:', err);
    } finally {
      setSyncingVLAN(false);
    }
  }

  const filteredSlots = useMemo(() => {
    if (!searchSlot) return slots;
    const q = searchSlot.toLowerCase();
    return slots.filter(
      (s) => s.slot_id.toLowerCase().includes(q) || s.board.toLowerCase().includes(q)
    );
  }, [slots, searchSlot]);

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
      {/* Header page */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Layers size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">LT Slots & Ports</h3>
            {(instanceName || instanceHost) && (
              <p className="text-xs text-gray-500">
                {instanceName ? instanceName : ''}
                {instanceName && instanceHost ? ' — ' : ''}
                {instanceHost ? instanceHost : ''}
              </p>
            )}
          </div>

          {!loading && slots.length > 0 && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {slots.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search slot or board..."
              value={searchSlot}
              onChange={(e) => setSearchSlot(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg w-64 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={loadSlots}
            disabled={loading || syncingLT || syncingVLAN}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={handleForceSyncLT}
            disabled={syncingLT || loading || syncingVLAN}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {syncingLT ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncingLT ? 'Syncing LT…' : 'Sync from Equipment'}
          </button>

          <button
            onClick={handleForceSyncVLAN}
            disabled={syncingVLAN || loading || syncingLT}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            title="Sync VLAN info-flat for all ports (may take several minutes)"
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

      {!loading && !error && grouped.length === 0 && (
        <div className="text-center py-12">
          <Layers className="mx-auto mb-3 text-gray-300" size={32} />
          <p className="text-sm text-gray-500">No LT slots found</p>
        </div>
      )}

      {!loading && !error && grouped.length > 0 && (
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
    </div>
  );
}