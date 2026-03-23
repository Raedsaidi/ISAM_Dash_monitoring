import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../utils/cn';
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
  const [cacheInfo, setCacheInfo] = useState<{
    cached_at: string | null;
    last_refresh_at: string | null;
    last_refresh_success: boolean;
    last_refresh_error: string | null;
  }>({
    cached_at: null,
    last_refresh_at: null,
    last_refresh_success: false,
    last_refresh_error: null,
  });

  useEffect(() => {
    loadSlots();
  }, [instanceId]);

  async function loadSlots() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots`,
        {
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        }
      );

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // not json
      }

      if (!res.ok) {
        const detail =
          data?.detail ||
          data?.message ||
          (Array.isArray(data) && data[0]?.msg) ||
          `HTTP ${res.status}`;
        throw new Error(detail);
      }

      setSlots(data.slots || []);
      setCacheInfo({
        cached_at: data.cached_at,
        last_refresh_at: data.last_refresh_at,
        last_refresh_success: data.last_refresh_success,
        last_refresh_error: data.last_refresh_error,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load LT slots');
      toast.error('Failed to load LT slots');
    } finally {
      setLoading(false);
    }
  }

  function formatDateTime(value?: string | null) {
    if (!value) return 'Never';
    try {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
    } catch {
      return 'N/A';
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">LT Slots</h3>
          <p className="text-sm text-slate-500">
            Manage LT slots and port locks (6-hour cache)
          </p>
        </div>

        <button
          onClick={loadSlots}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Cache info */}
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 text-xs space-y-1 text-slate-600">
        <div>
          Last successful snapshot:{' '}
          <span className="font-mono">{formatDateTime(cacheInfo.cached_at)}</span>
        </div>
        <div>
          Last refresh attempt:{' '}
          <span className="font-mono">{formatDateTime(cacheInfo.last_refresh_at)}</span>
        </div>
        {!cacheInfo.last_refresh_success && cacheInfo.last_refresh_error && (
          <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
            Latest refresh failed: {cacheInfo.last_refresh_error}
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
          <Loader2 size={18} className="animate-spin" />
          Loading LT slots...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-900">Error loading slots</div>
            <div className="text-sm text-red-700 mt-1">{error}</div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && slots.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
          <div className="text-slate-500">No LT slots found</div>
        </div>
      )}

      {/* Slots list */}
      {!loading && !error && slots.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-700">
            Found {slots.length} LT slot{slots.length > 1 ? 's' : ''}
          </div>
          {slots.map(slot => (
            <LTSlotExpander
              key={slot.slot_id}
              slot={slot}
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