import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, RefreshCw, Cpu, Signal, Activity, Layers } from 'lucide-react';
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

export default function LTSlotsOverlay({ instanceId, instanceName, instanceHost, accessToken, isAdmin, onClose }: LTSlotsOverlayProps) {
  const [slots, setSlots] = useState<LTSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'xdsl' | 'pon' | 'ethernet'>('all');
  const [searchSlot, setSearchSlot] = useState('');
  const [cacheInfo, setCacheInfo] = useState({ cached_at: null, last_refresh_success: false, last_refresh_error: null as string | null });

  useEffect(() => { loadSlots(); }, [instanceId]);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/lt-slots`, {
        headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
      setCacheInfo({ cached_at: data.cached_at, last_refresh_success: data.last_refresh_success, last_refresh_error: data.last_refresh_error });
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally { setLoading(false); }
  }

  const activeSlots = slots.filter((s) => s.admin_state === 'Up' || s.admin_state === 'up').length;
  const downSlots = slots.filter((s) => s.port_state === 'Down' || s.port_state === 'down').length;

  const filtered = slots.filter((s) => {
    if (filterType !== 'all') {
      const pt = s.port_type.toLowerCase();
      if (filterType === 'xdsl' && !pt.includes('xdsl')) return false;
      if (filterType === 'pon' && !pt.includes('pon') && !pt.includes('ont')) return false;
      if (filterType === 'ethernet' && !pt.includes('ethernet')) return false;
    }
    if (searchSlot && !s.slot_id.toLowerCase().includes(searchSlot.toLowerCase()) && !s.board.toLowerCase().includes(searchSlot.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-50 overflow-hidden font-sans">
      {/* Header Minimaliste */}
      <div className="bg-white border-b border-zinc-200 shrink-0">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-zinc-100 rounded-lg border border-zinc-200">
              <Layers size={20} className="text-zinc-800" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 tracking-tight">LT Slots & Ports</h1>
              <p className="text-sm text-zinc-500 mt-0.5">{instanceName} <span className="mx-1 text-zinc-300">•</span> {instanceHost}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Barre d'outils / Stats */}
      <div className="shrink-0 bg-white border-b border-zinc-200">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-6 flex-wrap">
          <div className="flex gap-4">
            <StatMini icon={<Cpu size={14} />} label="Total" value={slots.length} />
            <StatMini icon={<Signal size={14} />} label="Active" value={activeSlots} />
            <StatMini icon={<Activity size={14} />} label="Down" value={downSlots} />
          </div>

          <div className="h-6 w-px bg-zinc-200 hidden sm:block" />

          <div className="ml-auto flex items-center gap-3">
            <input
              type="text"
              placeholder="Search slot or board..."
              value={searchSlot}
              onChange={(e) => setSearchSlot(e.target.value)}
              className="px-3 py-1.5 border border-zinc-200 rounded-lg text-sm w-56 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 bg-zinc-50"
            />

            <div className="flex p-0.5 rounded-lg border border-zinc-200 bg-zinc-50">
              {([ { key: 'all', label: 'All' }, { key: 'xdsl', label: 'XDSL' }, { key: 'pon', label: 'PON' }, { key: 'ethernet', label: 'ETH' } ] as const).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterType(f.key)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-all',
                    filterType === f.key ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200/50' : 'text-zinc-500 hover:text-zinc-900'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              onClick={loadSlots}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-6 py-8">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={24} className="animate-spin text-zinc-400" />
              <p className="text-zinc-500 font-medium text-sm">Loading LT slots...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-4 p-5 bg-white border border-zinc-200 shadow-sm rounded-xl">
              <AlertCircle size={20} className="text-zinc-900" />
              <div>
                <div className="font-semibold text-zinc-900">Error loading slots</div>
                <div className="text-sm text-zinc-500 mt-1">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="p-3 bg-zinc-100 rounded-xl border border-zinc-200"><Cpu size={24} className="text-zinc-400" /></div>
              <p className="text-zinc-500 font-medium text-sm">No LT slots found</p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-4">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Showing {filtered.length} slots
              </p>
              <div className="grid grid-cols-1 gap-4">
                {filtered.map((slot) => (
                  <LTSlotExpander key={slot.slot_id} slot={slot} instanceId={instanceId} accessToken={accessToken} isAdmin={isAdmin} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatMini({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-800">
      <div className="text-zinc-400">{icon}</div>
      <div>
        <span className="text-sm font-semibold">{value}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 ml-1.5">{label}</span>
      </div>
    </div>
  );
}