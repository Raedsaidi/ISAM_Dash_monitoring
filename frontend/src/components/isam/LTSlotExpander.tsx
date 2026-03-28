import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
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

  const getStateColor = (state: string) => {
    if (state === 'Up' || state === 'up') return 'text-green-600';
    if (state === 'Down' || state === 'down') return 'text-red-600';
    return 'text-slate-400';
  };

  async function loadPorts() {
    setLoading(true);
    setError(null);

    try {
      // Encodage complet du slot_id (ex: "lt:1/1/5" -> "lt%3A1%2F1%2F5")
      const encodedSlotId = encodeURIComponent(slot.slot_id);

      console.log('[LT_SLOT_EXPANDER] Loading ports for slot:', slot.slot_id);
      console.log('[LT_SLOT_EXPANDER] Encoded slot_id:', encodedSlotId);

      const res = await fetch(
        `http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlotId}/ports`,
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

      console.log(
        '[LT_SLOT_EXPANDER] Ports loaded:',
        Array.isArray(data.ports) ? data.ports.length : 0
      );

      setPorts(data.ports || []);

      // Initialize lock status for each port
      const locks: Record<string, boolean> = {};
      (data.ports || []).forEach((port: any) => {
        locks[port.port_id] = port.locked || false;
      });
      setPortLocks(locks);
    } catch (err: any) {
      console.error('[LT_SLOT_EXPANDER] Error loading ports:', err);
      setError(err.message || 'Failed to load ports');
      toast.error('Failed to load ports for this slot');
    } finally {
      setLoading(false);
    }
  }

  function handleToggleExpand() {
    if (!expanded && ports.length === 0 && !error) {
      loadPorts();
    }
    setExpanded(!expanded);
  }

  function handlePortLockToggle(portId: string) {
    setPortLocks(prev => ({
      ...prev,
      [portId]: !prev[portId],
    }));
  }

  // --- Regroupement par type (calculé à chaque render) ---
  const xdslPorts = ports.filter(p => p.port_type === 'xdsl-line');
  const ethPorts = ports.filter(p => p.port_type === 'ethernet-line');
  const ponPorts = ports.filter(p => p.port_type === 'pon');
  const ontPorts = ports.filter(p => p.port_type === 'ont');

  // Groupe ONT -> PON1 -> liste d'ONTs
  type PonGroup = {
    pon: any;
    onts: any[];
  };
  const ponMap: Record<string, PonGroup> = {};

  // 1) Créer les groupes pour chaque PON
  ponPorts.forEach(pon => {
    const ponId = pon.port_id; // ex: "1/1/7/1"
    if (!ponMap[ponId]) {
      ponMap[ponId] = {
        pon,
        onts: [],
      };
    }
  });

  // 2) Attacher chaque ONT à son PON parent
  ontPorts.forEach(ont => {
    const parts = (ont.port_id || '').split('/');
    if (parts.length < 4) {
      return;
    }
    const parentPonId = parts.slice(0, 4).join('/'); // "1/1/7/1" pour "1/1/7/1/17"
    if (!ponMap[parentPonId]) {
      // Si jamais un ONT est présent sans ligne PON correspondante (rare),
      // on crée un groupe PON "minimal" pour ne pas perdre l'ONT.
      ponMap[parentPonId] = {
        pon: {
          port_id: parentPonId,
          port_type: 'pon',
          admin_state: 'unknown',
          link_state: 'unknown',
          port_state: 'unknown',
          cfg_mtu: 0,
          oper_mtu: 0,
          lag_bndl: '-',
          mode: '-',
          encap: '-',
          board: slot.board,
        },
        onts: [],
      };
    }
    ponMap[parentPonId].onts.push(ont);
  });

  const ponGroups: PonGroup[] = Object.values(ponMap);

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {/* Slot Header - Clickable to expand */}
      <button
        onClick={handleToggleExpand}
        className="w-full p-4 hover:bg-slate-50 transition-colors text-left flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {expanded ? (
            <ChevronUp size={18} className="text-slate-600 shrink-0" />
          ) : (
            <ChevronDown size={18} className="text-slate-600 shrink-0" />
          )}

          {/* Slot info */}
          <div className="flex-1 min-w-0">
            <div className="font-mono font-semibold text-slate-900 text-lg">
              {slot.slot_id}
            </div>
            <div className="text-sm text-slate-600 mt-1 flex items-center gap-3 flex-wrap">
              <span>
                Type:{' '}
                <span className="font-mono font-medium">{slot.port_type}</span>
              </span>
              <span>
                Board:{' '}
                <span className="font-mono font-medium">{slot.board}</span>
              </span>
            </div>
          </div>

          {/* State indicators */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Admin:</span>
                <span className={cn('font-semibold', getStateColor(slot.admin_state))}>
                  {slot.admin_state}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Port:</span>
                <span className={cn('font-semibold', getStateColor(slot.port_state))}>
                  {slot.port_state}
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded content - Ports list */}
      {expanded && (
        <div className="border-t border-slate-200 p-4 bg-slate-50">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading ports...
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Error loading ports</div>
                <div className="text-xs mt-1">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && ports.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No ports found for this slot
            </div>
          )}

          {!loading && !error && ports.length > 0 && (
            <div className="space-y-6">
              {/* XDSL-LINE */}
              {xdslPorts.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">
                    XDSL-LINE ports ({xdslPorts.length})
                  </div>
                  <div className="space-y-3">
                    {xdslPorts.map(p => (
                      <LTPortItem
                        key={p.port_id}
                        port={p}
                        isLocked={portLocks[p.port_id] || false}
                        instanceId={instanceId}
                        accessToken={accessToken}
                        isAdmin={isAdmin}
                        onLockToggle={() => handlePortLockToggle(p.port_id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ETHERNET-LINE */}
              {ethPorts.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">
                    ETHERNET-LINE ports ({ethPorts.length})
                  </div>
                  <div className="space-y-3">
                    {ethPorts.map(p => (
                      <LTPortItem
                        key={p.port_id}
                        port={p}
                        isLocked={portLocks[p.port_id] || false}
                        instanceId={instanceId}
                        accessToken={accessToken}
                        isAdmin={isAdmin}
                        onLockToggle={() => handlePortLockToggle(p.port_id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ONT -> PON -> ONT ports */}
              {ponGroups.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">
                    ONT / PON
                  </div>
                  <div className="space-y-4">
                    {ponGroups.map(group => (
                      <div
                        key={group.pon.port_id}
                        className="border border-slate-200 rounded-lg bg-white p-3"
                      >
                        <div className="text-xs font-semibold text-slate-700 mb-2">
                          PON {group.pon.port_id}
                        </div>

                        {group.onts.length === 0 && (
                          <div className="text-xs text-slate-500">
                            No ONT ports on this PON
                          </div>
                        )}

                        {group.onts.length > 0 && (
                          <div className="space-y-3">
                            {group.onts.map(ont => (
                              <LTPortItem
                                key={ont.port_id}
                                port={ont}
                                isLocked={portLocks[ont.port_id] || false}
                                instanceId={instanceId}
                                accessToken={accessToken}
                                isAdmin={isAdmin}
                                onLockToggle={() => handlePortLockToggle(ont.port_id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}