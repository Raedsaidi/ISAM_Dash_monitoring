import { X } from 'lucide-react';
import LTSlotsPanel from './LTSlotsPanel';

export default function LTSlotsOverlay({
  instanceId,
  instanceName,
  instanceHost,
  accessToken,
  isAdmin,
  onClose,
}: {
  instanceId: number;
  instanceName: string;
  instanceHost: string;
  accessToken: string | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
       <div className="fixed inset-0 bg-gray-900/30" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">LT Slots & Ports</h2>
              <p className="text-sm text-gray-600">
                {instanceName} — {instanceHost}
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            <LTSlotsPanel
              instanceId={instanceId}
              accessToken={accessToken}
              isAdmin={isAdmin}
              instanceName={instanceName}
              instanceHost={instanceHost}
            />
          </div>
        </div>
      </div>
    </div>
  );
}