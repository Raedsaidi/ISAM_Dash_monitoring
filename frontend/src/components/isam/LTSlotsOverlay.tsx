import { useState, useEffect, useMemo } from 'react';
import {
  X,
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
  if (pt.includes('xdsl')) return 'XDSL';
  if (pt.includes('pon') || pt.includes('ont') || pt.includes('gpon'))
    return 'PON';
  if (pt.includes('ethernet')) return 'Ethernet';
  return 'Other';
}

function getCategoryStyle(category: string) {
  switch (category) {
    case 'XDSL':
      return {
        icon: <Zap size={16} className="text-blue-700" />,
        iconBg: 'bg-blue-50 ring-1 ring-blue-100',
      };
    case 'PON':
      return {
        icon: <Radio size={16} className="text-blue-700" />,
        iconBg: 'bg-blue-50 ring-1 ring-blue-100',
      };
    case 'Ethernet':
      return {
        icon: <Cable size={16} className="text-blue-700" />,
        iconBg: 'bg-blue-50 ring-1 ring-blue-100',
      };
    default:
      return {
        icon: <Server size={16} className="text-slate-600" />,
        iconBg: 'bg-slate-100 ring-1 ring-slate-200',
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
    <div className="mb-5 rounded-2xl border border-slate-200/70 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.04)] overflow-hidden transition-all hover:shadow-[0_8px_28px_rgba(15,23,42,0.07)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50/80 transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <div className={cn('p-2.5 rounded-xl', style.iconBg)}>{style.icon}</div>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm text-left">
              {category} Slots
            </h3>
            <p className="text-xs text-slate-500 font-medium text-left mt-0.5">
              {slots.length} slot{slots.length !== 1 ? 's' : ''} available
            </p>
          </div>
        </div>

        <ChevronRight
          size={18}
          className={cn(
            'text-slate-400 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className="p-4 pt-0 border-t border-slate-100 bg-slate-50/40">
          <div className="mt-4 grid grid-cols-1 gap-3">
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
    <div className="grid grid-cols-1 gap-3">
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
  const [searchSlot, setSearchSlot] = useState('');
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        },
      );

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        //
      }

      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return slots.filter((s) => {
      if (searchSlot) {
        const q = searchSlot.toLowerCase();
        if (
          !s.slot_id.toLowerCase().includes(q) &&
          !s.board.toLowerCase().includes(q) &&
          !s.port_type.toLowerCase().includes(q)
        ) {
          return false;
        }
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

    const order = ['XDSL', 'PON', 'Ethernet', 'Other'];
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-[1200px] h-full max-h-[90vh] bg-gradient-to-b from-white to-slate-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/30 animate-in zoom-in-95 duration-200">
        <div className="flex-none bg-white/95 backdrop-blur border-b border-slate-200/80 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center shadow-sm">
              <Layers className="text-white" size={24} />
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
                LT Slots & Ports
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                <span className="font-semibold text-slate-700">
                  {instanceName}
                </span>
                <span className="text-slate-300">•</span>
                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded-full text-slate-600 border border-slate-200">
                  {instanceHost}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Search slot or board..."
                value={searchSlot}
                onChange={(e) => setSearchSlot(e.target.value)}
                className="pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-300 transition-all w-full sm:w-64 placeholder:text-slate-400 shadow-sm"
              />
              {searchSlot && (
                <button
                  onClick={() => setSearchSlot('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-900 p-1"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button
              onClick={loadSlots}
              disabled={loading}
              title="Refresh Slots"
              className="p-2.5 border border-slate-200 bg-white rounded-xl text-slate-600 hover:bg-blue-50 hover:text-blue-900 hover:border-blue-200 transition-colors disabled:opacity-50 shadow-sm"
            >
              <RefreshCw
                size={18}
                className={loading ? 'animate-spin text-blue-900' : ''}
              />
            </button>

            <div className="w-px h-8 bg-slate-200 mx-1 hidden sm:block" />

            <button
              onClick={onClose}
              title="Close Overlay"
              className="p-2.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-xl transition-colors border border-transparent hover:border-red-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 bg-slate-50/70 scroll-smooth">
          <div className="max-w-5xl mx-auto">
            {loading && (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <Loader2 size={28} className="animate-spin text-blue-900" />
                <p className="text-sm text-slate-500 font-medium">
                  Fetching slots configuration...
                </p>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl shadow-sm">
                <AlertCircle
                  size={20}
                  className="text-red-600 shrink-0 mt-0.5"
                />
                <div>
                  <div className="text-sm font-bold text-red-800">
                    Failed to load data
                  </div>
                  <div className="text-sm text-red-600 mt-1">{error}</div>
                </div>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-3 bg-white border border-slate-200 border-dashed rounded-2xl shadow-sm">
                <Server size={32} className="text-slate-300" />
                <p className="text-sm text-slate-500 font-medium">
                  No slots match your criteria.
                </p>
                {searchSlot && (
                  <button
                    onClick={() => setSearchSlot('')}
                    className="text-sm text-blue-900 hover:text-blue-950 font-semibold"
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}

            {!loading && !error && grouped.length > 0 && (
              <div className="space-y-6">
                {grouped.map(([category, categorySlots]) =>
                  category === 'Other' ? (
                    <div key={category} className="mt-8">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-[0.18em] mb-4 ml-1">
                        Other Slots ({categorySlots.length})
                      </h3>
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}