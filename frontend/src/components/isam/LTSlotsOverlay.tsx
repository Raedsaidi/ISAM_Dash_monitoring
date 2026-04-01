import React, { useState, useEffect } from 'react';
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
  const [filterType, setFilterType] = useState<'all' | 'xdsl' | 'pon' | 'ethernet'>('all');
  const [searchSlot, setSearchSlot] = useState('');
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
  }, [instanceId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} }
      );
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally {
      setLoading(false);
    }
  }

  const active = slots.filter((s) => ['up'].includes(s.admin_state.toLowerCase())).length;
  const down = slots.filter((s) => ['down'].includes(s.port_state.toLowerCase())).length;

  const filtered = slots.filter((s) => {
    if (filterType !== 'all') {
      const pt = s.port_type.toLowerCase();
      if (filterType === 'xdsl' && !pt.includes('xdsl')) return false;
      if (filterType === 'pon' && !pt.includes('pon') && !pt.includes('ont')) return false;
      if (filterType === 'ethernet' && !pt.includes('ethernet')) return false;
    }
    if (searchSlot) {
      const q = searchSlot.toLowerCase();
      if (!s.slot_id.toLowerCase().includes(q) && !s.board.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-50 overflow-hidden font-sans">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 shrink-0">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-zinc-900 rounded-lg">
              <Layers size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-900">LT Slots & Ports</h1>
              <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                <span className="font-medium text-zinc-700">{instanceName}</span>
                <span className="text-zinc-300">·</span>
                <span className="font-mono">{instanceHost}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 bg-white border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-5 py-2 flex items-center gap-3 flex-wrap">
          <StatBadge icon={<Cpu size={11} />} value={slots.length} label="Total" />
          <StatBadge icon={<Signal size={11} />} value={active} label="Active" variant="success" />
          <StatBadge icon={<Activity size={11} />} value={down} label="Down" variant={down > 0 ? 'warning' : 'default'} />

          <div className="h-4 w-px bg-zinc-200 hidden sm:block" />

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search slot..."
                value={searchSlot}
                onChange={(e) => setSearchSlot(e.target.value)}
                className="pl-7 pr-2 py-1 border border-zinc-200 rounded text-[11px] w-40 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 bg-zinc-50 placeholder:text-zinc-400"
              />
            </div>

            <div className="flex p-px rounded border border-zinc-200 bg-zinc-50">
              {([
                { key: 'all', label: 'All' },
                { key: 'xdsl', label: 'XDSL' },
                { key: 'pon', label: 'PON' },
                { key: 'ethernet', label: 'ETH' },
              ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterType(f.key)}
                  className={cn(
                    'px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all',
                    filterType === f.key
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-500 hover:text-zinc-800'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              onClick={loadSlots}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-5 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Loader2 size={18} className="animate-spin text-zinc-400" />
              <p className="text-[11px] text-zinc-500 font-medium">Loading slots...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 p-3 bg-white border border-zinc-200 rounded-lg shadow-sm">
              <AlertCircle size={16} className="text-red-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-zinc-900">Error</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <Cpu size={20} className="text-zinc-300" />
              <p className="text-[11px] text-zinc-400 font-medium">No slots found</p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                {filtered.length} slot{filtered.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {filtered.map((slot) => (
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
      </div>
    </div>
  );
}

function StatBadge({
  icon,
  value,
  label,
  variant = 'default',
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  variant?: 'default' | 'success' | 'warning';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium',
        variant === 'success' && value > 0
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : variant === 'warning' && value > 0
          ? 'border-orange-200 bg-orange-50 text-orange-700'
          : 'border-zinc-200 bg-zinc-50 text-zinc-700'
      )}
    >
      <span className="text-zinc-400">{icon}</span>
      <span className="font-bold tabular-nums">{value}</span>
      <span className="text-[8px] font-bold uppercase tracking-widest opacity-60">
        {label}
      </span>
    </div>
  );
}