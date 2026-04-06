import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
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

export default function LTSlotsPanel({
  instanceId,
  accessToken,
  isAdmin,
}: LTSlotsPanelProps) {
  const [slots, setSlots] = useState<LTSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  useEffect(() => {
    loadSlots();
  }, [instanceId]);

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        {
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        },
      );

      let data: any = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 font-sans">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
            <Layers size={14} className="text-slate-700" />
          </div>

          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-[0.16em]">
              LT Slots
            </h3>

            {!loading && slots.length > 0 && (
              <span className="text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                {slots.length}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={loadSlots}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-slate-500 gap-2 text-xs font-medium">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      )}

      {error && !loading && (
        <div className="p-4 bg-red-50 border border-red-200 shadow-sm rounded-xl flex items-start gap-2.5">
          <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-700 font-medium">{error}</div>
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-xs font-medium bg-white border border-dashed border-slate-200 rounded-xl">
          No LT slots found
        </div>
      )}

      {!loading &&
        !error &&
        slots.map((slot) => (
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