import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
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
}

export default function LTSlotsPanel({ instanceId, accessToken, isAdmin }: LTSlotsPanelProps) {
  const [slots, setSlots] = useState<LTSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => { loadSlots(); }, [instanceId]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`, {
        headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4 font-sans">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
        <h3 className="text-sm font-semibold text-zinc-900 uppercase tracking-wide">LT Slots</h3>
        <button
          onClick={loadSlots}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg text-xs font-medium text-zinc-700 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-2 text-sm font-medium">
          <Loader2 size={16} className="animate-spin" />
          Loading...
        </div>
      )}

      {error && (
        <div className="p-4 bg-white border border-zinc-200 shadow-sm rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-zinc-900 shrink-0 mt-0.5" />
          <div className="text-sm text-zinc-700 font-medium">{error}</div>
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="text-center py-12 text-zinc-400 text-sm font-medium">No LT slots found</div>
      )}

      {!loading && !error && slots.map((slot) => (
        <LTSlotExpander key={slot.slot_id} slot={slot} instanceId={instanceId} accessToken={accessToken} isAdmin={isAdmin} />
      ))}
    </div>
  );
}