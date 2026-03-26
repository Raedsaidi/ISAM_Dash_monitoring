import React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '../utils/cn';
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
  const getStateColor = (state: string) => {
    if (state === 'Up' || state === 'up') return 'text-green-600';
    if (state === 'Down' || state === 'down') return 'text-red-600';
    return 'text-slate-400';
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Port ID */}
          <div className="min-w-0">
            <div className="font-mono font-semibold text-slate-900 break-all">
              {port.port_id}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Type:{' '}
              <span className="font-mono">
                {port.port_type}
              </span>
            </div>
          </div>

          {/* State indicators */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Admin:</span>
                <span className={cn('font-semibold', getStateColor(port.admin_state))}>
                  {port.admin_state}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Port:</span>
                <span className={cn('font-semibold', getStateColor(port.port_state))}>
                  {port.port_state}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Lock status and button */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            {isLocked && (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-100 rounded text-xs text-red-700 font-semibold">
                <Lock size={12} />
                Locked
              </div>
            )}
            <PortLockButton
              portId={port.port_id}
              isLocked={isLocked}
              instanceId={instanceId}
              accessToken={accessToken}
              onLockToggle={onLockToggle}
            />
          </div>
        )}

        {!isAdmin && isLocked && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-100 rounded text-xs text-red-700 font-semibold">
            <Lock size={12} />
            Locked
          </div>
        )}
      </div>

      {/* Details */}
      <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-500">MTU:</span>
          <span className="font-mono ml-2">
            {port.cfg_mtu} / {port.oper_mtu}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Mode:</span>
          <span className="font-mono ml-2">{port.mode}</span>
        </div>
        <div>
          <span className="text-slate-500">Link:</span>
          <span className="font-mono ml-2">{port.link_state}</span>
        </div>
        <div>
          <span className="text-slate-500">Encap:</span>
          <span className="font-mono ml-2">{port.encap}</span>
        </div>
      </div>
    </div>
  );
}