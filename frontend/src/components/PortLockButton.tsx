import React, { useState } from 'react';
import { Lock, Unlock, Loader2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { toast } from 'sonner';

interface PortLockButtonProps {
  portId: string;
  isLocked: boolean;
  instanceId: number;
  accessToken: string | null;
  onLockToggle: () => void;
}

export default function PortLockButton({
  portId,
  isLocked,
  instanceId,
  accessToken,
  onLockToggle,
}: PortLockButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleToggleLock() {
    setLoading(true);
    const toastId = toast.loading(isLocked ? 'Unlocking port...' : 'Locking port...');

    try {
      const encodedPortId = encodeURIComponent(portId);
      const url = isLocked
        ? `http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/ports/${encodedPortId}/unlock`
        : `http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/ports/${encodedPortId}/lock`;

      const method = isLocked ? 'DELETE' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

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

      toast.success(
        isLocked ? `Port ${portId} unlocked successfully` : `Port ${portId} locked successfully`,
        { id: toastId }
      );

      onLockToggle();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle port lock', { id: toastId });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggleLock}
      disabled={loading}
      className={cn(
        'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium',
        'transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        isLocked
          ? 'bg-red-100 text-red-700 hover:bg-red-200'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      )}
      title={isLocked ? 'Click to unlock' : 'Click to lock'}
    >
      {loading ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          {isLocked ? 'Unlocking...' : 'Locking...'}
        </>
      ) : isLocked ? (
        <>
          <Lock size={14} />
          Unlock
        </>
      ) : (
        <>
          <Unlock size={14} />
          Lock
        </>
      )}
    </button>
  );
}