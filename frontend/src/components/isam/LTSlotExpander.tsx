import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, AlertCircle, Zap, Radio, Wifi, Cable } from 'lucide-react';
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

export default function LTSlotExpander({ slot, instanceId, accessToken, isAdmin }: LTSlotExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const [ports, setPorts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portLocks, setPortLocks] = useState<Record<string, boolean>>({});
  const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

  function getSlotIcon() {
    const pt = slot.port_type.toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={16} className="text-zinc-700" />;
    if (pt.includes('pon') || pt.includes('ont')) return <Radio size={16} className="text-zinc-700" />;
    if (pt.includes('ethernet')) return <Cable size={16} className="text-zinc-700" />;
    return <Wifi size={16} className="text-zinc-700" />;
  }

  async function loadPorts() {
    setLoading(true);
    setError(null);

    try {
      const encodedSlotId = encodeURIComponent(slot.slot_id);
      const res = await fetch(`${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/lt-slots/${encodedSlotId}/ports`, {
        headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      });

      let data: any = null;
      try { data = await res.json(); } catch {}

      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);

      setPorts(data.ports || []);
      const locks: Record<string, boolean> = {};
      (data.ports || []).forEach((port: any) => { locks[port.port_id] = port.locked || false; });
      setPortLocks(locks);
    } catch (err: any) {
      setError(err.message || 'Failed to load ports');
      toast.error('Failed to load ports for this slot');
    } finally {
      setLoading(false);
    }
  }

  function handleToggleExpand() {
    if (!expanded && ports.length === 0 && !error) loadPorts();
    setExpanded(!expanded);
  }

  function handlePortLockToggle(portId: string) {
    setPortLocks((prev) => ({ ...prev, [portId]: !prev[portId] }));
  }

  const xdslPorts = ports.filter((p) => p.port_type === 'xdsl-line');
  const ethPorts = ports.filter((p) => p.port_type === 'ethernet-line');
  const ponPorts = ports.filter((p) => p.port_type === 'pon');
  const ontPorts = ports.filter((p) => p.port_type === 'ont');

  const ponMap: Record<string, { pon: any; onts: any[] }> = {};
  ponPorts.forEach((pon) => { if (!ponMap[pon.port_id]) ponMap[pon.port_id] = { pon, onts: [] }; });
  ontPorts.forEach((ont) => {
    const parts = (ont.port_id || '').split('/');
    if (parts.length < 4) return;
    const parentPonId = parts.slice(0, 4).join('/');
    if (!ponMap[parentPonId]) {
      ponMap[parentPonId] = {
        pon: { port_id: parentPonId, port_type: 'pon', admin_state: 'unknown', port_state: 'unknown', board: slot.board },
        onts: [],
      };
    }
    ponMap[parentPonId].onts.push(ont);
  });
  const ponGroups = Object.values(ponMap);

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-200 overflow-hidden',
      expanded ? 'border-zinc-300 shadow-sm' : 'border-zinc-200 bg-white hover:border-zinc-300'
    )}>
      <button
        onClick={handleToggleExpand}
        className={cn(
          'w-full px-5 py-4 text-left flex items-center justify-between gap-4 transition-colors',
          expanded ? 'bg-zinc-50/50' : 'bg-transparent'
        )}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="p-2 border border-zinc-200 bg-white rounded-lg shrink-0">
            {getSlotIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono font-semibold text-zinc-900 text-lg">{slot.slot_id}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-zinc-100 text-zinc-600 border border-zinc-200/50">
                {slot.port_type}
              </span>
            </div>
            <div className="text-sm text-zinc-500 mt-1 flex items-center gap-4 flex-wrap">
              <span>Board: <span className="font-mono font-medium text-zinc-700">{slot.board}</span></span>
              <span>MTU: <span className="font-mono font-medium text-zinc-700">{slot.cfg_mtu}</span></span>
              <span>Mode: <span className="font-mono font-medium text-zinc-700">{slot.mode}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusPill label="Admin" state={slot.admin_state} />
            <StatusPill label="Port" state={slot.port_state} />
          </div>
          <div className="p-1.5 rounded-md hover:bg-zinc-100 transition-colors shrink-0 text-zinc-400">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 bg-zinc-50/30 p-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={20} className="animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-500 font-medium">Loading ports...</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-4 bg-white border border-zinc-200 rounded-xl shadow-sm">
              <AlertCircle size={18} className="text-zinc-800 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-zinc-900 text-sm">Error loading ports</div>
                <div className="text-xs text-zinc-500 mt-1">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && ports.length === 0 && (
            <div className="text-center py-8 text-zinc-400 text-sm font-medium">
              No ports found for this slot
            </div>
          )}

          {!loading && !error && ports.length > 0 && (
            <div className="space-y-8">
              {xdslPorts.length > 0 && (
                <PortGroup title="XDSL-LINE" count={xdslPorts.length} icon={<Zap size={14} />}>
                  {xdslPorts.map((p) => (
                    <LTPortItem key={p.port_id} port={p} isLocked={portLocks[p.port_id] || false} instanceId={instanceId} accessToken={accessToken} isAdmin={isAdmin} onLockToggle={() => handlePortLockToggle(p.port_id)} />
                  ))}
                </PortGroup>
              )}

              {ethPorts.length > 0 && (
                <PortGroup title="ETHERNET-LINE" count={ethPorts.length} icon={<Cable size={14} />}>
                  {ethPorts.map((p) => (
                    <LTPortItem key={p.port_id} port={p} isLocked={portLocks[p.port_id] || false} instanceId={instanceId} accessToken={accessToken} isAdmin={isAdmin} onLockToggle={() => handlePortLockToggle(p.port_id)} />
                  ))}
                </PortGroup>
              )}

              {ponGroups.length > 0 && (
                <PortGroup title="PON / ONT" count={ponGroups.reduce((s, g) => s + 1 + g.onts.length, 0)} icon={<Radio size={14} />}>
                  {ponGroups.map((group) => (
                    <div key={group.pon.port_id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-zinc-100 rounded-md border border-zinc-200">
                          <Radio size={12} className="text-zinc-700" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-900 font-mono">PON {group.pon.port_id}</span>
                        <span className="text-xs text-zinc-400 font-medium">({group.onts.length} ONT{group.onts.length !== 1 ? 's' : ''})</span>
                      </div>
                      {group.onts.length === 0 && <div className="text-xs text-zinc-400 pl-8">No ONT ports on this PON</div>}
                      {group.onts.length > 0 && (
                         <div className="space-y-2 border-l-2 border-zinc-100 pl-4 ml-3">
                          {group.onts.map((ont) => (
                            <LTPortItem key={ont.port_id} port={ont} isLocked={portLocks[ont.port_id] || false} instanceId={instanceId} accessToken={accessToken} isAdmin={isAdmin} onLockToggle={() => handlePortLockToggle(ont.port_id)} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </PortGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, state }: { label: string; state: string }) {
  const up = state === 'Up' || state === 'up';
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-700">
      <div className={cn('w-1.5 h-1.5 rounded-full', up ? 'bg-zinc-900' : 'bg-transparent border border-zinc-400')} />
      <span className="text-zinc-500">{label}:</span> {state}
    </div>
  );
}

function PortGroup({ title, count, icon, children }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-900">
          {icon} {title}
        </div>
        <div className="h-px flex-1 bg-zinc-200" />
        <span className="text-xs text-zinc-400 font-medium">{count} port{count !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}