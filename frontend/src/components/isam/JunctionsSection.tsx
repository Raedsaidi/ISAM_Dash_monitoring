import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../utils/cn';
import {
  Network,
  CheckCircle,
  XCircle,
  Activity,
  Plus,
  Search,
  Loader2,
  RefreshCw,
  Trash2,
  Lock,
  Unlock,
  Settings2,
  Cable,
  Layers,
  HardDrive,
  Clock,
  AlertCircle,
  Server,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import TemplateWorkspaceOverlay from './TemplateWorkspaceOverlay';
import LTSlotsOverlay from './LTSlotsOverlay';

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

type StatusType = 'active' | 'inactive' | 'error';
type ProtocolPreference = 'telnet' | 'ssh' | 'auto';
type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

interface IsamInstance {
  id: number;
  name: string;
  host: string;
  telnet_port: number;
  ssh_port: number;
  protocol_preference: ProtocolPreference;
  username: string;
  status: StatusType;
  health_protocol_used: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface IsamInstanceListResponse {
  instances: IsamInstance[];
}

interface TestConnectionResponse {
  success: boolean;
  protocol_used: string | null;
  status: StatusType;
  message: string;
  response_time_ms: number | null;
  last_error: string | null;
}

interface CachedMemoryUsageResponse {
  success: boolean;
  protocol_used: string | null;
  raw_output: string;
  parsed: any;
  message: string;
  cached_at: string | null;
  last_refresh_at: string | null;
  last_refresh_success: boolean;
  last_refresh_error: string | null;
}

interface CachedPortsResponse {
  success: boolean;
  protocol_used: string | null;
  port_count: number;
  ports: any[];
  raw_output: string;
  message: string;
  cached_at: string | null;
  last_refresh_at: string | null;
  last_refresh_success: boolean;
  last_refresh_error: string | null;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'N/A';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
}

function parseJwt(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractErrorMessage(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;
  return '';
}

function toReadableError(message?: string | null, fallback = 'Something went wrong.') {
  const raw = (message || '').trim();
  const msg = raw.toLowerCase();

  if (!raw) return fallback;

  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'The ISAM device did not respond in time.';
  }

  if (
    msg.includes('unable to connect') ||
    msg.includes('impossible de se connecter') ||
    msg.includes('connection refused') ||
    msg.includes('no valid connections') ||
    msg.includes('network is unreachable')
  ) {
    return 'Unable to connect to the ISAM device.';
  }

  if (
    msg.includes('authentication') ||
    msg.includes("erreur d'authentification") ||
    msg.includes('auth failed')
  ) {
    return 'Authentication failed while contacting the ISAM device.';
  }

  if (msg.includes('forbidden') || msg.includes('unauthorized')) {
    return 'You are not authorized to perform this action.';
  }

  if (msg.includes('not found')) {
    return 'Requested resource was not found.';
  }

  if (msg.includes('ssh:') || msg.includes('telnet:') || msg.includes('ssh-legacy')) {
    return 'Unable to contact the ISAM device.';
  }

  return fallback;
}

function toReadableSnapshotError(
  message?: string | null,
  fallback = 'Failed to refresh hardware data.',
) {
  const raw = (message || '').trim();
  const msg = raw.toLowerCase();

  if (!raw) return fallback;

  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'The ISAM device did not respond in time during refresh.';
  }

  if (
    msg.includes('unable to connect') ||
    msg.includes('connection refused') ||
    msg.includes('no valid connections') ||
    msg.includes('impossible de se connecter')
  ) {
    return 'Unable to connect to the ISAM device during refresh.';
  }

  if (
    msg.includes('ssh:') ||
    msg.includes('telnet:') ||
    msg.includes('ssh-legacy')
  ) {
    return 'The ISAM device could not be reached during refresh.';
  }

  if (msg.includes('authentication')) {
    return 'Authentication failed during refresh.';
  }

  return fallback;
}

async function authFetchJson<T>(
  url: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    //
  }

  if (!res.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      (Array.isArray(data) && data[0]?.msg) ||
      'Unknown error';
    throw new Error(detail);
  }

  return data as T;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function JunctionsSection() {
  const { accessToken, user } = useAuth();

  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const currentRole = (user?.role ?? jwt?.role ?? null) as UserRole | null;
  const isAdmin = currentRole === 'ADMIN' || currentRole === 'SUPER_ADMIN';

  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'error'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '',
    host: '',
    telnet_port: 23,
    ssh_port: 22,
    protocol_preference: 'auto' as ProtocolPreference,
    username: '',
    password: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitAdding, setSubmitAdding] = useState(false);

  const [showTemplateWorkspace, setShowTemplateWorkspace] = useState(false);
  const [showLTSlotsOverlay, setShowLTSlotsOverlay] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    loadInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function loadInstances(nextSelectedId?: number | null) {
    setLoading(true);
    setGlobalError(null);

    try {
      const data = await authFetchJson<IsamInstanceListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/instances`,
        accessToken,
      );

      setInstances(data.instances);

      const desiredSelectedId =
        nextSelectedId === undefined ? selectedInstanceId : nextSelectedId;

      if (data.instances.length === 0) {
        setSelectedInstanceId(null);
      } else if (
        desiredSelectedId !== null &&
        data.instances.some((inst) => inst.id === desiredSelectedId)
      ) {
        setSelectedInstanceId(desiredSelectedId);
      } else {
        setSelectedInstanceId(data.instances[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load ISAM instances:', err);
      setGlobalError(
        toReadableError(
          extractErrorMessage(err),
          'Failed to load ISAM instances.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function validateForm(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    else if (form.name.length < 3) e.name = 'Name must be at least 3 characters.';
    if (!form.host.trim()) e.host = 'Host is required.';
    if (!form.username.trim()) e.username = 'Username is required.';
    if (!form.password) e.password = 'Password is required.';
    if (!form.telnet_port || form.telnet_port < 1 || form.telnet_port > 65535)
      e.telnet_port = 'Telnet port must be between 1 and 65535.';
    if (!form.ssh_port || form.ssh_port < 1 || form.ssh_port > 65535)
      e.ssh_port = 'SSH port must be between 1 and 65535.';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleAddIsam(e: React.FormEvent) {
    e.preventDefault();
    setFormErrors({});
    if (!validateForm()) return;
    setSubmitAdding(true);

    try {
      await authFetchJson<IsamInstance>(
        `${ISAM_BASE_URL}/api/v1/isam/instances`,
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );

      setShowAddModal(false);
      setForm({
        name: '',
        host: '',
        telnet_port: 23,
        ssh_port: 22,
        protocol_preference: 'auto',
        username: '',
        password: '',
      });

      await loadInstances();
      toast.success('The ISAM instance has been created successfully.');
    } catch (err: any) {
      console.error('Failed to add ISAM:', err);
      setFormErrors({
        general: toReadableError(
          extractErrorMessage(err),
          'Failed to add the ISAM instance.',
        ),
      });
    } finally {
      setSubmitAdding(false);
    }
  }

  async function handleTestConnection(id: number) {
    const toastId = toast.loading('Testing connection...');

    try {
      const res = await authFetchJson<TestConnectionResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${id}/test-connection`,
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );

      setInstances((prev) =>
        prev.map((inst) =>
          inst.id === id
            ? {
                ...inst,
                status: res.status,
                health_protocol_used: res.protocol_used,
                last_response_time_ms: res.response_time_ms,
                last_error: res.last_error,
                last_checked_at: new Date().toISOString(),
              }
            : inst,
        ),
      );

      if (res.success) {
        toast.success(res.message || 'Connection OK', { id: toastId });
      } else {
        toast.error(
          toReadableError(res.message, 'Connection failed.'),
          { id: toastId },
        );
      }
    } catch (err: any) {
      console.error('Failed to test connection:', err);
      toast.error(
        toReadableError(
          extractErrorMessage(err),
          'Failed to test the connection.',
        ),
        { id: toastId },
      );
    }
  }

  async function deleteInstance(id: number): Promise<boolean> {
    const toastId = toast.loading('Deleting ISAM...');

    try {
      await authFetchJson<void>(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${id}`,
        accessToken,
        { method: 'DELETE' },
      );

      await loadInstances(null);
      toast.success('The ISAM instance has been deleted successfully.', {
        id: toastId,
      });
      return true;
    } catch (err: any) {
      console.error('Failed to delete ISAM:', err);
      toast.error(
        toReadableError(
          extractErrorMessage(err),
          'Failed to delete this ISAM instance.',
        ),
        { id: toastId },
      );
      return false;
    }
  }

  const filtered = instances.filter((inst) => {
    if (filter !== 'all' && inst.status !== filter) return false;
    if (
      searchTerm &&
      !inst.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !inst.host.toLowerCase().includes(searchTerm.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const selectedInstance =
    filtered.find((i) => i.id === selectedInstanceId) ||
    instances.find((i) => i.id === selectedInstanceId) ||
    null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search ISAM..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
          </div>

          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(['all', 'active', 'inactive', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                  filter === f
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          )}

          <button
            onClick={() => loadInstances()}
            className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            <RefreshCw size={14} /> Refresh
          </button>

          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Add ISAM
            </button>
          )}
        </div>
      </div>

      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {globalError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {filtered.map((inst) => (
          <div
            key={inst.id}
            className={cn(
              'bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer',
              selectedInstance && selectedInstance.id === inst.id ? 'ring-2 ring-blue-500' : '',
            )}
            onClick={() => setSelectedInstanceId(inst.id)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Network
                  size={18}
                  className={cn(
                    inst.status === 'active'
                      ? 'text-green-500'
                      : inst.status === 'error'
                        ? 'text-red-500'
                        : 'text-slate-400',
                  )}
                />
                <h3 className="font-semibold text-slate-900 font-mono">
                  {inst.name}
                </h3>
              </div>
              <StatusBadge status={inst.status} />
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Backend</span>
                <span className="font-mono text-slate-700 text-right break-all">
                  {inst.host}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Protocol</span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium uppercase',
                    inst.protocol_preference === 'ssh'
                      ? 'bg-green-100 text-green-700'
                      : inst.protocol_preference === 'telnet'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-slate-100 text-slate-700',
                  )}
                >
                  {inst.protocol_preference}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Health Check</span>
                {inst.status === 'active' ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <XCircle size={16} className="text-slate-400" />
                )}
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Response Time</span>
                <span
                  className={cn(
                    'font-mono font-medium',
                    !inst.last_response_time_ms || inst.last_response_time_ms === 0
                      ? 'text-red-500'
                      : inst.last_response_time_ms > 100
                        ? 'text-amber-500'
                        : 'text-green-600',
                  )}
                >
                  {!inst.last_response_time_ms || inst.last_response_time_ms === 0
                    ? 'N/A'
                    : `${inst.last_response_time_ms}ms`}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between items-center gap-2">
              <span className="min-w-0">
                Last checked:{' '}
                {inst.last_checked_at
                  ? new Date(inst.last_checked_at).toLocaleString()
                  : 'Never'}
              </span>

              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestConnection(inst.id);
                  }}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 shrink-0"
                >
                  <Activity size={14} />
                  Test
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedInstance && (
        <div className="space-y-4">
          <IsamConfigurationPanel
            instance={selectedInstance}
            isAdmin={isAdmin}
            onOpenTemplateForm={() => setShowTemplateWorkspace(true)}
            onOpenLTSlots={() => setShowLTSlotsOverlay(true)}
          />

          {isAdmin && (
            <IsamDetailsPanel
              instance={selectedInstance}
              onDeleted={() => {
                setShowTemplateWorkspace(false);
                setShowLTSlotsOverlay(false);
              }}
              onDeleteInstance={deleteInstance}
            />
          )}
        </div>
      )}

      {selectedInstance && showLTSlotsOverlay && (
        <LTSlotsOverlay
          instanceId={selectedInstance.id}
          instanceName={selectedInstance.name}
          instanceHost={selectedInstance.host}
          accessToken={accessToken}
          isAdmin={isAdmin}
          onClose={() => setShowLTSlotsOverlay(false)}
        />
      )}

      {selectedInstance && showTemplateWorkspace && (
        <TemplateWorkspaceOverlay
          instance={selectedInstance}
          onClose={() => setShowTemplateWorkspace(false)}
        />
      )}

      {showAddModal && isAdmin && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 relative">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Add ISAM Instance
            </h2>

            {formErrors.general && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {formErrors.general}
              </div>
            )}

            <form onSubmit={handleAddIsam} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Name
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.name
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.name && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.name}</div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Host
                  </label>
                  <input
                    value={form.host}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, host: e.target.value }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.host
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.host && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.host}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Telnet Port
                  </label>
                  <input
                    type="number"
                    value={form.telnet_port}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telnet_port: Number(e.target.value),
                      }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.telnet_port
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.telnet_port && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.telnet_port}</div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    SSH Port
                  </label>
                  <input
                    type="number"
                    value={form.ssh_port}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ssh_port: Number(e.target.value),
                      }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.ssh_port
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.ssh_port && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.ssh_port}</div>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Protocol Preference
                </label>
                <select
                  value={form.protocol_preference}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      protocol_preference: e.target.value as ProtocolPreference,
                    }))
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="auto">Auto (SSH then Telnet)</option>
                  <option value="ssh">SSH only</option>
                  <option value="telnet">Telnet only</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    value={form.username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.username
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.username && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.username}</div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    className={cn(
                      'w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2',
                      formErrors.password
                        ? 'border-red-400 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500',
                    )}
                  />
                  {formErrors.password && (
                    <div className="text-xs text-red-500 mt-1">{formErrors.password}</div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitAdding}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitAdding ? 'Adding...' : 'Add ISAM'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StatusType }) {
  return (
    <span
      className={cn(
        'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
        status === 'active'
          ? 'bg-green-100 text-green-700'
          : status === 'error'
            ? 'bg-red-100 text-red-700'
            : 'bg-slate-100 text-slate-600',
      )}
    >
      {status}
    </span>
  );
}

function IsamConfigurationPanel({
  instance,
  isAdmin,
  onOpenTemplateForm,
  onOpenLTSlots,
}: {
  instance: IsamInstance;
  isAdmin: boolean;
  onOpenTemplateForm: () => void;
  onOpenLTSlots: () => void;
}) {
  const responseTime =
    !instance.last_response_time_ms || instance.last_response_time_ms === 0
      ? 'N/A'
      : `${instance.last_response_time_ms} ms`;

  const readableLastError = instance.last_error
    ? toReadableError(instance.last_error, 'An error was reported by the device.')
    : 'None';

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900 text-lg">
            {instance.name} — Configuration
          </h3>
          <p className="text-sm text-slate-500">
            {instance.host} (Telnet:{instance.telnet_port} / SSH:{instance.ssh_port})
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            onClick={onOpenTemplateForm}
          >
            <Settings2 size={16} />
            Open Configuration Workspace
          </button>

          {isAdmin && (
            <button
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg hover:from-violet-700 hover:to-purple-700 transition-all shadow-sm"
              onClick={onOpenLTSlots}
            >
              <Layers size={16} />
              LT Slots & Ports
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5">
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            General Settings
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Instance Name" value={instance.name} />
            <ConfigRow label="Host" value={instance.host} />
            <ConfigRow label="Telnet Port" value={String(instance.telnet_port)} />
            <ConfigRow label="SSH Port" value={String(instance.ssh_port)} />
            <ConfigRow
              label="Last Checked"
              value={
                instance.last_checked_at
                  ? new Date(instance.last_checked_at).toLocaleString()
                  : 'Never'
              }
            />
            <ConfigRow label="Response Time" value={responseTime} />
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            Protocol Settings
          </h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-green-500" />
                <span className="text-sm text-slate-700">Preferred Protocol</span>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 uppercase">
                {instance.protocol_preference}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Unlock
                  size={16}
                  className={
                    instance.health_protocol_used === 'telnet'
                      ? 'text-amber-500'
                      : 'text-slate-400'
                  }
                />
                <span className="text-sm text-slate-700">
                  Last health protocol used
                </span>
              </div>
              <span className="text-xs text-slate-600">
                {instance.health_protocol_used || 'N/A'}
              </span>
            </div>

            <ConfigRow label="Status" value={instance.status.toUpperCase()} />
            <ConfigRow label="Last Error" value={readableLastError} />
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            Session Management
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Session Timeout" value="1800s (30 min)" />
            <ConfigRow label="Inactive Timeout" value="600s (10 min)" />
            <ConfigRow label="Max Sessions" value="10000" />
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            Network Settings
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Worker Threads" value="64" />
            <ConfigRow label="Max Connections" value="4096" />
            <ConfigRow label="Keep-Alive Timeout" value="120s" />
            <ConfigRow label="Request Timeout" value="300s" />
          </div>
        </div>
      </div>
    </div>
  );
}

function IsamDetailsPanel({
  instance,
  onDeleted,
  onDeleteInstance,
}: {
  instance: IsamInstance;
  onDeleted: () => void;
  onDeleteInstance: (id: number) => Promise<boolean>;
}) {
  const { accessToken } = useAuth();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [memoryUsage, setMemoryUsage] = useState({
    loading: false,
    error: null as string | null,
    parsed: {},
    protocol_used: null as string | null,
    cached_at: null as string | null,
    last_refresh_at: null as string | null,
    last_refresh_success: false,
    last_refresh_error: null as string | null,
  });

  const [ports, setPorts] = useState({
    loading: false,
    error: null as string | null,
    ports: [] as any[],
    port_count: 0,
    protocol_used: null as string | null,
    cached_at: null as string | null,
    last_refresh_at: null as string | null,
    last_refresh_success: false,
    last_refresh_error: null as string | null,
  });

  useEffect(() => {
    loadCachedMemoryUsage();
    loadCachedPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  async function loadCachedMemoryUsage() {
    setMemoryUsage((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await authFetchJson<CachedMemoryUsageResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instance.id}/cached-memory-usage`,
        accessToken,
      );

      setMemoryUsage({
        loading: false,
        error: res.success
          ? null
          : toReadableSnapshotError(
              res.message,
              'No cached memory usage data available.',
            ),
        parsed: res.parsed || {},
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
        last_refresh_at: res.last_refresh_at,
        last_refresh_success: res.last_refresh_success,
        last_refresh_error: res.last_refresh_error
          ? toReadableSnapshotError(
              res.last_refresh_error,
              'Failed to refresh memory data.',
            )
          : null,
      });
    } catch (err: any) {
      console.error('Failed to load cached memory usage:', err);
      setMemoryUsage((s) => ({
        ...s,
        loading: false,
        error: toReadableSnapshotError(
          extractErrorMessage(err),
          'Failed to load cached memory usage.',
        ),
      }));
    }
  }

  async function loadCachedPorts() {
    setPorts((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await authFetchJson<CachedPortsResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/instances/${instance.id}/cached-ports`,
        accessToken,
      );

      setPorts({
        loading: false,
        error: res.success
          ? null
          : toReadableSnapshotError(
              res.message,
              'No cached port data available.',
            ),
        ports: res.ports || [],
        port_count: res.port_count || 0,
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
        last_refresh_at: res.last_refresh_at,
        last_refresh_success: res.last_refresh_success,
        last_refresh_error: res.last_refresh_error
          ? toReadableSnapshotError(
              res.last_refresh_error,
              'Failed to refresh port data.',
            )
          : null,
      });
    } catch (err: any) {
      console.error('Failed to load cached ports:', err);
      setPorts((s) => ({
        ...s,
        loading: false,
        error: toReadableSnapshotError(
          extractErrorMessage(err),
          'Failed to load cached ports.',
        ),
      }));
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const deleted = await onDeleteInstance(instance.id);
    setDeleting(false);
    if (deleted) {
      setShowDeleteDialog(false);
      onDeleted();
    }
  }

  const memoryEntries = Array.isArray(memoryUsage.parsed?.entries)
    ? memoryUsage.parsed.entries
    : [];

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900 text-lg">
              Hardware & Resources
            </h3>
            <p className="text-sm text-slate-500">
              Cached snapshots for performance analysis.
            </p>
          </div>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-2 text-sm font-medium text-red-600 hover:text-white bg-red-50 hover:bg-red-600 border border-red-200 hover:border-red-600 px-4 py-2 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
            Delete Instance
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="bg-white p-4 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-100 p-2 rounded-lg">
                  <HardDrive size={18} className="text-indigo-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">Memory Allocation</h4>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={12} />
                    {formatDateTime(memoryUsage.cached_at)}
                    {memoryUsage.protocol_used && (
                      <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] uppercase font-mono">
                        {memoryUsage.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-700">{memoryEntries.length}</span>
                <span className="text-xs text-slate-500 block uppercase tracking-wider">
                  Slots
                </span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto max-h-[360px] custom-scrollbar">
              {memoryUsage.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Loader2 size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Fetching memory stats...</span>
                </div>
              ) : memoryUsage.error ? (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{memoryUsage.error}</p>
                </div>
              ) : memoryEntries.length > 0 ? (
                <div className="space-y-5">
                  {!memoryUsage.last_refresh_success && memoryUsage.last_refresh_error && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <p>{memoryUsage.last_refresh_error}</p>
                    </div>
                  )}

                  {memoryEntries.map((entry: any, idx: number) => {
                    const pct = Number(entry.used_percent) || 0;
                    const colorClass =
                      pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500';
                    const lightColorClass =
                      pct > 85 ? 'bg-red-100' : pct > 60 ? 'bg-amber-100' : 'bg-emerald-100';

                    return (
                      <div key={idx} className="relative">
                        <div className="flex justify-between items-end mb-1.5">
                          <div className="flex items-center gap-2">
                            <Server size={14} className="text-slate-400" />
                            <span className="font-semibold text-slate-700 text-sm">
                              {entry.slot}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            <span className="text-slate-900 font-medium">{entry.used_mb}</span> /{' '}
                            {entry.total_mb} MB
                          </div>
                        </div>

                        <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden flex">
                          <div
                            className={`h-full ${colorClass} transition-all duration-1000 ease-out`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="flex justify-end mt-1">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lightColorClass} ${colorClass.replace(
                              'bg-',
                              'text-',
                            )}`}
                          >
                            {pct}% Used
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-slate-500">
                  No memory usage data available in the current snapshot.
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="bg-white p-4 border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Cable size={18} className="text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-800">Port Status</h4>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={12} />
                    {formatDateTime(ports.cached_at)}
                    {ports.protocol_used && (
                      <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[10px] uppercase font-mono">
                        {ports.protocol_used}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-slate-700">{ports.port_count}</span>
                <span className="text-xs text-slate-500 block uppercase tracking-wider">
                  Total
                </span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto max-h-[360px] custom-scrollbar">
              {ports.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Loader2 size={24} className="animate-spin mb-2" />
                  <span className="text-sm">Fetching ports data...</span>
                </div>
              ) : ports.error ? (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{ports.error}</p>
                </div>
              ) : ports.ports.length > 0 ? (
                <div className="space-y-4">
                  {!ports.last_refresh_success && ports.last_refresh_error && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <p>{ports.last_refresh_error}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ports.ports.map((p: any, idx: number) => {
                      const isUp = p.port_state?.toLowerCase().includes('up');
                      const isAdminDown = p.admin_state?.toLowerCase().includes('down');

                      let dotColor = 'bg-slate-300';
                      let dotShadow = '';

                      if (isUp) {
                        dotColor = 'bg-emerald-500';
                        dotShadow = 'shadow-[0_0_6px_rgba(16,185,129,0.6)]';
                      } else if (isAdminDown) {
                        dotColor = 'bg-slate-400';
                      } else {
                        dotColor = 'bg-red-500';
                      }

                      return (
                        <div
                          key={idx}
                          className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between hover:border-slate-300 transition-colors"
                          title={`Admin: ${p.admin_state} | Port: ${p.port_state}`}
                        >
                          <div className="flex flex-col truncate pr-2">
                            <span className="font-mono text-[13px] font-bold text-slate-800">
                              {p.port_id}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase truncate">
                              {p.board || 'Unknown'}
                            </span>
                          </div>
                          <div className="flex items-center justify-center shrink-0 w-6 h-6 rounded-full bg-slate-50">
                            <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ${dotShadow}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-slate-500">
                  No ports data available in the current snapshot.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this ISAM instance?"
        description="This action is irreversible. Deleting an ISAM also deletes all templates linked to this instance."
        confirmText={deleting ? 'Deleting...' : 'Yes, delete'}
        cancelText="Cancel"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setShowDeleteDialog(false);
        }}
        onConfirm={handleDelete}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
      `}</style>
    </>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{description}</p>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            >
              {cancelText}
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Deleting...
                </span>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-medium text-slate-900 font-mono text-right break-all">
        {value}
      </span>
    </div>
  );
}