import React, { useState } from "react";
import { Lock, Unlock, Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { toast } from "sonner";

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
    const toastId = toast.loading(
      isLocked ? "Unlocking port..." : "Locking port...",
    );

    try {
      const encodedPortId = encodeURIComponent(portId);
      const url = isLocked
        ? `http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/ports/${encodedPortId}/unlock`
        : `http://127.0.0.1:8001/api/v1/isam/instances/${instanceId}/ports/${encodedPortId}/lock`;

      const method = isLocked ? "DELETE" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {}
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);

      toast.success(
        isLocked ? `Port ${portId} unlocked` : `Port ${portId} locked`,
        { id: toastId },
      );
      onLockToggle();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle port lock", { id: toastId });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleToggleLock();
      }}
      disabled={loading}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
        "disabled:opacity-50 disabled:cursor-not-allowed border",
        isLocked
          ? "bg-white text-blue-700 border-blue-200 hover:bg-blue-50 hover:border-blue-300 shadow-sm"
          : "bg-blue-600 text-white border-transparent hover:bg-blue-700 shadow-sm",
      )}
      title={isLocked ? "Click to unlock" : "Click to lock"}
    >
      {loading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : isLocked ? (
        <Unlock size={13} />
      ) : (
        <Lock size={13} />
      )}
      {isLocked ? "Unlock" : "Lock"}
    </button>
  );
}
