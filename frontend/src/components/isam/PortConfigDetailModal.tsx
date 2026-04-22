import { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, Copy, AlertCircle, Download } from 'lucide-react';
import { toast } from 'sonner';

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 30) return `${diffD}d ago`;
  return date.toLocaleDateString();
}

export default function PortConfigDetailModal({
  open,
  onClose,
  instanceId,
  portId,
  accessToken,
  ontSernum,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: number;
  portId: string;
  accessToken: string | null;
  ontSernum?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    setLoading(true);
    setErr(null);

    try {
      const url = `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/ports/${encodeURIComponent(
        portId
      )}/config-detail`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.detail || 'Failed to load detail');

      setData(json);
    } catch (e: any) {
      setErr(e.message || 'Failed to load detail');
      toast.error('Failed to load config detail', { description: e.message });
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }

  // ✅ Fonction générique de téléchargement
  function downloadTxt(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }

  // ✅ Télécharge uniquement les VLAN lines
  function downloadVlan() {
    const content = [
      `Port       : ${portId}`,
      sn ? `ONT Sernum : ${sn}` : null,
      `Status     : ${deviceStatus}`,
      lastCheckAt
        ? `Last Check : ${formatRelativeTime(lastCheckAt)} — ${lastCheckOk ? 'OK' : 'FAILED'}`
        : `Last Check : never`,
      lastCheckErr ? `Check Error: ${lastCheckErr}` : null,
      '',
      '═══════════════════════════════════════',
      'VLAN LINES',
      '═══════════════════════════════════════',
      '',
      vlanLines.join('\n') || 'No VLAN lines detected',
    ]
      .filter((l) => l !== null)
      .join('\n');

    const safePort = portId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadTxt(content, `vlan_${safePort}.txt`);
  }

  // ✅ Télécharge uniquement les commandes template
  function downloadCommands() {
    const content = [
      `Port       : ${portId}`,
      sn ? `ONT Sernum : ${sn}` : null,
      `Template   : ${data?.app_last_apply?.template_name || 'N/A'}`,
      data?.app_last_apply?.project ? `Project    : ${data.app_last_apply.project}` : null,
      data?.app_last_apply?.applied_by ? `Applied by : ${data.app_last_apply.applied_by}` : null,
      data?.app_last_apply?.applied_at
        ? `Applied at : ${formatRelativeTime(data.app_last_apply.applied_at)}`
        : null,
      '',
      '═══════════════════════════════════════',
      'COMMANDS EXECUTED',
      '═══════════════════════════════════════',
      '',
      commands.join('\n') || 'No commands',
    ]
      .filter((l) => l !== null)
      .join('\n');

    const safePort = portId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadTxt(content, `commands_${safePort}.txt`);
  }

  // ✅ Télécharge VLAN + commandes dans un seul fichier
  function downloadAll() {
    const content = [
      `Port       : ${portId}`,
      sn ? `ONT Sernum : ${sn}` : null,
      `Status     : ${deviceStatus}`,
      lastCheckAt
        ? `Last Check : ${formatRelativeTime(lastCheckAt)} — ${lastCheckOk ? 'OK' : 'FAILED'}`
        : `Last Check : never`,
      lastCheckErr ? `Check Error: ${lastCheckErr}` : null,
      '',
      '═══════════════════════════════════════',
      'VLAN LINES',
      '═══════════════════════════════════════',
      '',
      vlanLines.join('\n') || 'No VLAN lines detected',
      '',
      '═══════════════════════════════════════',
      'LAST APPLY — COMMANDS EXECUTED',
      '═══════════════════════════════════════',
      '',
      `Template   : ${data?.app_last_apply?.template_name || 'N/A'}`,
      data?.app_last_apply?.project ? `Project    : ${data.app_last_apply.project}` : null,
      data?.app_last_apply?.applied_by ? `Applied by : ${data.app_last_apply.applied_by}` : null,
      data?.app_last_apply?.applied_at
        ? `Applied at : ${formatRelativeTime(data.app_last_apply.applied_at)}`
        : null,
      '',
      commands.join('\n') || 'No commands',
    ]
      .filter((l) => l !== null)
      .join('\n');

    const safePort = portId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadTxt(content, `config_detail_${safePort}.txt`);
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId, portId]);

  if (!open) return null;

  const commands: string[] = data?.app_last_apply?.commands_executed || [];
  const vlanLines: string[] = data?.device_snapshot?.device_vlan_lines || [];

  const deviceStatus: string = data?.device_snapshot?.status || 'UNKNOWN';
  const lastCheckAt: string | null = data?.device_snapshot?.last_device_check_at || null;
  const lastCheckOk: boolean = !!data?.device_snapshot?.last_device_check_success;
  const lastCheckErr: string | null = data?.device_snapshot?.last_device_check_error || null;

  const ontFromDetail: string | null = data?.device_snapshot?.ont_sernum || null;
  const sn = ontFromDetail || ontSernum || null;

  const appFound: boolean = !!data?.app_last_apply?.found;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-2xl"
        style={{ backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)' }}
        onClick={onClose}
      />

      <div className="relative bg-white w-full max-w-5xl max-h-[90vh] rounded-xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900">Config Detail</div>
            <div className="text-sm text-gray-600 font-mono truncate">{portId}</div>
            {sn && (
              <div className="mt-1 text-xs text-purple-700 font-mono">
                sernum: {sn}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* ✅ Bouton download global dans le header */}
            {data && !loading && (
              <button
                onClick={downloadAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                title="Download full config detail as .txt"
              >
                <Download size={14} />
                Download .txt
              </button>
            )}

            <button
              onClick={load}
              disabled={loading}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              title="Reload"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>

            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-auto">
          {err && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle size={18} className="text-red-600 mt-0.5" />
              <div className="text-sm text-red-700">{err}</div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 size={18} className="animate-spin" />
              Loading…
            </div>
          )}

          {!loading && data && (
            <div className="space-y-6">
              {/* Device snapshot */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">Device snapshot (VLAN)</div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-700">{deviceStatus}</span>
                    {/* ✅ Bouton download VLAN */}
                    <button
                      onClick={downloadVlan}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                      title="Download VLAN lines as .txt"
                    >
                      <Download size={13} />
                      .txt
                    </button>
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-xs text-gray-600 mb-2">
                    Last check:{' '}
                    {lastCheckAt ? (
                      <>
                        <span className="font-medium">{formatRelativeTime(lastCheckAt)}</span>
                        {lastCheckOk ? (
                          <span className="ml-2 text-green-700">(OK)</span>
                        ) : (
                          <span className="ml-2 text-red-700">(FAILED)</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">never</span>
                    )}
                  </div>

                  {lastCheckErr && <div className="text-xs text-red-700 mb-2">Error: {lastCheckErr}</div>}

                  <div className="text-xs text-gray-500 mb-2">VLAN lines ({vlanLines.length})</div>
                  <pre className="text-xs bg-white whitespace-pre-wrap font-mono border rounded-lg p-3">
                    {vlanLines.join('\n') || 'No VLAN lines detected'}
                  </pre>
                </div>
              </div>

              {/* App last apply */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">Last apply (App)</div>

                  {appFound && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => copyText(commands.join('\n'))}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors"
                        title="Copy commands"
                      >
                        <Copy size={13} />
                        Copy
                      </button>
                      {/* ✅ Bouton download commandes */}
                      <button
                        onClick={downloadCommands}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                        title="Download commands as .txt"
                      >
                        <Download size={13} />
                        .txt
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  {!appFound ? (
                    <div className="text-sm text-gray-500">No successful apply found for this port.</div>
                  ) : (
                    <>
                      <div className="text-sm text-gray-700 mb-3">
                        Template:{' '}
                        <span className="font-mono">{data.app_last_apply?.template_name || 'N/A'}</span>
                        {data.app_last_apply?.project ? ` · Project: ${data.app_last_apply.project}` : ''}
                        {data.app_last_apply?.applied_by ? ` · By: ${data.app_last_apply.applied_by}` : ''}
                        {data.app_last_apply?.applied_at
                          ? ` · ${formatRelativeTime(data.app_last_apply.applied_at)}`
                          : ''}
                      </div>

                      <div className="text-xs text-gray-500 mb-2">Commands executed ({commands.length})</div>
                      <pre className="text-xs bg-white whitespace-pre-wrap font-mono border rounded-lg p-3">
                        {commands.join('\n') || 'No commands'}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}