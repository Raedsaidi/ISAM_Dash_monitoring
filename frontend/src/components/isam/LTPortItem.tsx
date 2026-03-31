import React from 'react';
import { Lock, Zap, Cable, Radio, Wifi } from 'lucide-react';
import { cn } from '../../utils/cn';
import PortLockButton from './PortLockButton';

interface LTPortItemProps {
  port: any;
  isLocked: boolean;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  onLockToggle: () => void;
}

export default function LTPortItem({
  port,
  isLocked,
  instanceId,
  accessToken,
  isAdmin,
  onLockToggle,
}: LTPortItemProps) {
  function getPortTypeIcon() {
    const pt = (port.port_type || '').toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={14} className="text-zinc-600" />;
    if (pt.includes('ethernet')) return <Cable size={14} className="text-zinc-600" />;
    if (pt.includes('pon') || pt.includes('ont'))
      return <Radio size={14} className="text-zinc-600" />;
    return <Wifi size={14} className="text-zinc-400" />;
  }

  const adminUp = port.admin_state === 'Up' || port.admin_state === 'up';
  const portUp = port.port_state === 'Up' || port.port_state === 'up';

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-all duration-200',
        isLocked 
          ? 'border-dashed border-zinc-300 bg-zinc-50/50' 
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm'
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left: Port info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2 bg-zinc-100 rounded-lg border border-zinc-200/50">
            {getPortTypeIcon()}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium text-zinc-900 text-sm">
                {port.port_id}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-zinc-100 text-zinc-600 border border-zinc-200/50">
                {port.port_type}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-1.5">
              {/* Admin state */}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    adminUp ? 'bg-zinc-900' : 'bg-transparent border border-zinc-400'
                  )}
                />
                <span className="text-[11px] text-zinc-500">Admin</span>
                <span className={cn('text-[11px] font-medium', adminUp ? 'text-zinc-900' : 'text-zinc-500')}>
                  {port.admin_state}
                </span>
              </div>

              <div className="w-px h-3 bg-zinc-200" />

              {/* Port state */}
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    portUp ? 'bg-zinc-900' : 'bg-transparent border border-zinc-400'
                  )}
                />
                <span className="text-[11px] text-zinc-500">Port</span>
                <span className={cn('text-[11px] font-medium', portUp ? 'text-zinc-900' : 'text-zinc-500')}>
                  {port.port_state}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Lock */}
        <div className="flex items-center gap-2">
          {isLocked && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 border border-zinc-200 rounded-lg text-[11px] text-zinc-700 font-medium">
              <Lock size={11} />
              LOCKED
            </div>
          )}

          {isAdmin && (
            <PortLockButton
              portId={port.port_id}
              isLocked={isLocked}
              instanceId={instanceId}
              accessToken={accessToken}
              onLockToggle={onLockToggle}
            />
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-4 pt-3 border-t border-zinc-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <DetailChip label="MTU" value={`${port.cfg_mtu}/${port.oper_mtu}`} />
        <DetailChip label="Mode" value={port.mode} />
        <DetailChip label="Link" value={port.link_state} isState />
        <DetailChip label="Encap" value={port.encap} />
      </div>
    </div>
  );
}

function DetailChip({ label, value, isState }: { label: string; value: string; isState?: boolean }) {
  const up = isState && (value === 'Up' || value === 'up');
  const down = isState && (value === 'Down' || value === 'down');

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md">
      <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
        {label}
      </span>
      <span className={cn(
        'text-xs font-mono font-medium',
        isState 
          ? (up ? 'text-zinc-900' : down ? 'text-zinc-400 line-through' : 'text-zinc-600')
          : 'text-zinc-800'
      )}>
        {value}
      </span>
    </div>
  );
}