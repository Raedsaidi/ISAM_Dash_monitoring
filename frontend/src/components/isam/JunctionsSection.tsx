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
  Database,
  Cable,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import TemplateWorkspaceOverlay from './TemplateWorkspaceOverlay';
import LTSlotsOverlay from './LTSlotsOverlay';

const ISAM_BASE_URL = 'http://127.0.0.1:8001';

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
    // no json
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

  /* ---- Load on mount ---- */
  useEffect(() => {
    if (!accessToken) return;
    loadInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  /* ---- API calls ---- */

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
      setGlobalError(err.message || 'Failed to load ISAM instances.');
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
      setFormErrors({ general: err.message || 'Failed to add ISAM.' });
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
        toast.error(res.message || 'Connection failed', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to test connection.', { id: toastId });
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
      toast.error(err.message || 'Failed to delete this ISAM instance.', {
        id: toastId,
      });
      return false;
    }
  }

  /* ---- Filtering ---- */

  const filtered = instances.filter((inst) => {
    if (filter !== 'all' && inst.status !== filter) return false;
    if (
      searchTerm &&
      !inst.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !inst.host.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const selectedInstance =
    filtered.find((i) => i.id === selectedInstanceId) ||
    instances.find((i) => i.id === selectedInstanceId) ||
    null;

  /* ---- Render ---- */

  return (
    <div className="space-y-6">
      {/* ══════════ Toolbar ══════════ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
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

          {/* Filter pills */}
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

      {/* ══════════ Global error ══════════ */}
      {globalError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {globalError}
        </div>
      )}

      {/* ══════════ Instance Cards ══════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {filtered.map((inst) => (
          <div
            key={inst.id}
            className={cn(
              'bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer',
              selectedInstance && selectedInstance.id === inst.id
                ? 'ring-2 ring-blue-500'
                : '',
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
                    !inst.last_response_time_ms ||
                      inst.last_response_time_ms === 0
                      ? 'text-red-500'
                      : inst.last_response_time_ms > 100
                        ? 'text-amber-500'
                        : 'text-green-600',
                  )}
                >
                  {!inst.last_response_time_ms ||
                  inst.last_response_time_ms === 0
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

      {/* ══════════ Configuration + Details Panels ══════════ */}
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

      {/* ══════════ LT Slots Overlay (full-page) ══════════ */}
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

      {/* ══════════ Template Workspace Overlay ══════════ */}
      {selectedInstance && showTemplateWorkspace && (
        <TemplateWorkspaceOverlay
          instance={selectedInstance}
          onClose={() => setShowTemplateWorkspace(false)}
        />
      )}

      {/* ══════════ Add ISAM Modal ══════════ */}
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
              {/* Name + Host */}
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.name}
                    </div>
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.host}
                    </div>
                  )}
                </div>
              </div>

              {/* Telnet + SSH ports */}
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.telnet_port}
                    </div>
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.ssh_port}
                    </div>
                  )}
                </div>
              </div>

              {/* Protocol preference */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Protocol Preference
                </label>
                <select
                  value={form.protocol_preference}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      protocol_preference: e.target
                        .value as ProtocolPreference,
                    }))
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="auto">Auto (SSH then Telnet)</option>
                  <option value="ssh">SSH only</option>
                  <option value="telnet">Telnet only</option>
                </select>
              </div>

              {/* Username + Password */}
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.username}
                    </div>
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
                    <div className="text-xs text-red-500 mt-1">
                      {formErrors.password}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
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

/* ============================================================
   STATUS BADGE
   ============================================================ */

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

/* ============================================================
   CONFIGURATION PANEL
   ============================================================ */

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

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header with 2 buttons */}
      <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900 text-lg">
            {instance.name} — Configuration
          </h3>
          <p className="text-sm text-slate-500">
            {instance.host} (Telnet:{instance.telnet_port} / SSH:
            {instance.ssh_port})
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Button 1: Open Configuration Workspace */}
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            onClick={onOpenTemplateForm}
          >
            <Settings2 size={16} />
            Open Configuration Workspace
          </button>

          {/* Button 2: LT Slots & Ports (admin only) */}
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

      {/* Config grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5">
        {/* General */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            General Settings
          </h4>
          <div className="space-y-3">
            <ConfigRow label="Instance Name" value={instance.name} />
            <ConfigRow label="Host" value={instance.host} />
            <ConfigRow
              label="Telnet Port"
              value={String(instance.telnet_port)}
            />
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

        {/* Protocol */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-800 text-sm uppercase tracking-wider">
            Protocol Settings
          </h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-green-500" />
                <span className="text-sm text-slate-700">
                  Preferred Protocol
                </span>
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

            <ConfigRow
              label="Status"
              value={instance.status.toUpperCase()}
            />
            <ConfigRow
              label="Last Error"
              value={instance.last_error || 'None'}
            />
          </div>
        </div>

        {/* Session */}
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

        {/* Network */}
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

/* ============================================================
   DETAILS PANEL (admin only)
   ============================================================ */

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

  /* ---- Memory usage state ---- */
  const [memoryUsage, setMemoryUsage] = useState<{
    loading: boolean;
    error: string | null;
    parsed: any;
    protocol_used: string | null;
    cached_at: string | null;
    last_refresh_at: string | null;
    last_refresh_success: boolean;
    last_refresh_error: string | null;
  }>({
    loading: false,
    error: null,
    parsed: {},
    protocol_used: null,
    cached_at: null,
    last_refresh_at: null,
    last_refresh_success: false,
    last_refresh_error: null,
  });

  /* ---- Ports state ---- */
  const [ports, setPorts] = useState<{
    loading: boolean;
    error: string | null;
    ports: any[];
    port_count: number;
    protocol_used: string | null;
    cached_at: string | null;
    last_refresh_at: string | null;
    last_refresh_success: boolean;
    last_refresh_error: string | null;
  }>({
    loading: false,
    error: null,
    ports: [],
    port_count: 0,
    protocol_used: null,
    cached_at: null,
    last_refresh_at: null,
    last_refresh_success: false,
    last_refresh_error: null,
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
          : res.message || 'No cached memory usage available.',
        parsed: res.parsed || {},
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
        last_refresh_at: res.last_refresh_at,
        last_refresh_success: res.last_refresh_success,
        last_refresh_error: res.last_refresh_error,
      });
    } catch (err: any) {
      setMemoryUsage((s) => ({
        ...s,
        loading: false,
        error: err.message || 'Failed to load cached memory usage.',
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
          : res.message || 'No cached ports available.',
        ports: res.ports || [],
        port_count: res.port_count || 0,
        protocol_used: res.protocol_used,
        cached_at: res.cached_at,
        last_refresh_at: res.last_refresh_at,
        last_refresh_success: res.last_refresh_success,
        last_refresh_error: res.last_refresh_error,
      });
    } catch (err: any) {
      setPorts((s) => ({
        ...s,
        loading: false,
        error: err.message || 'Failed to load cached ports.',
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

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900 text-lg">
              {instance.name} — Details
            </h3>
            <p className="text-xs text-slate-500">
              {instance.host} (telnet:{instance.telnet_port} / ssh:
              {instance.ssh_port})
            </p>
          </div>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 rounded-lg"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ---- Memory ---- */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-emerald-600" />
              <h4 className="text-sm font-semibold text-slate-800">
                Memory Usage (last successful snapshot)
              </h4>
            </div>

            <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 text-[11px] text-slate-600 space-y-1">
              <div>
                Last successful snapshot:{' '}
                <span className="font-mono">
                  {formatDateTime(memoryUsage.cached_at)}
                </span>
              </div>
              <div>
                Last refresh attempt:{' '}
                <span className="font-mono">
                  {formatDateTime(memoryUsage.last_refresh_at)}
                </span>
              </div>
              <div>
                Protocol used:{' '}
                <span className="font-mono">
                  {memoryUsage.protocol_used || 'N/A'}
                </span>
              </div>
            </div>

            {memoryUsage.loading && (
              <div className="text-xs text-slate-500">
                <Loader2
                  size={14}
                  className="inline-block animate-spin mr-1"
                />
                Loading...
              </div>
            )}

            {!memoryUsage.loading &&
              !memoryUsage.last_refresh_success &&
              memoryUsage.last_refresh_error &&
              memoryUsage.cached_at && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  Latest refresh failed. Displaying last successful snapshot.
                  Error: {memoryUsage.last_refresh_error}
                </div>
              )}

            {memoryUsage.error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {memoryUsage.error}
              </div>
            )}

            {!memoryUsage.loading && !memoryUsage.error && (
              <div className="bg-slate-50 rounded-lg p-2 text-xs max-h-48 overflow-y-auto">
                <p className="text-slate-600 mb-1">
                  Entry count:{' '}
                  <span className="font-mono">
                    {memoryUsage.parsed?.entry_count ??
                      (Array.isArray(memoryUsage.parsed?.entries)
                        ? memoryUsage.parsed.entries.length
                        : 'N/A')}
                  </span>
                </p>

                {Array.isArray(memoryUsage.parsed?.entries) &&
                memoryUsage.parsed.entries.length > 0 ? (
                  <ul className="space-y-1">
                    {memoryUsage.parsed.entries.map(
                      (e: any, idx: number) => (
                        <li
                          key={idx}
                          className="flex justify-between border-b border-slate-100 pb-0.5"
                        >
                          <span className="text-slate-500">{e.slot}</span>
                          <span className="font-mono text-slate-900">
                            {e.used_mb} / {e.total_mb} MB ({e.used_percent}
                            %)
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <span className="text-slate-500">
                    No memory usage data parsed.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ---- Ports ---- */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Cable size={16} className="text-blue-600" />
              <h4 className="text-sm font-semibold text-slate-800">
                Ports (last successful snapshot)
              </h4>
            </div>

            <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 text-[11px] text-slate-600 space-y-1">
              <div>
                Last successful snapshot:{' '}
                <span className="font-mono">
                  {formatDateTime(ports.cached_at)}
                </span>
              </div>
              <div>
                Last refresh attempt:{' '}
                <span className="font-mono">
                  {formatDateTime(ports.last_refresh_at)}
                </span>
              </div>
              <div>
                Protocol used:{' '}
                <span className="font-mono">
                  {ports.protocol_used || 'N/A'}
                </span>
              </div>
            </div>

            {ports.loading && (
              <div className="text-xs text-slate-500">
                <Loader2
                  size={14}
                  className="inline-block animate-spin mr-1"
                />
                Loading...
              </div>
            )}

            {!ports.loading &&
              !ports.last_refresh_success &&
              ports.last_refresh_error &&
              ports.cached_at && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  Latest refresh failed. Displaying last successful snapshot.
                  Error: {ports.last_refresh_error}
                </div>
              )}

            {ports.error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {ports.error}
              </div>
            )}

            {!ports.loading && !ports.error && (
              <div className="bg-slate-50 rounded-lg p-2 text-xs max-h-48 overflow-y-auto">
                <p className="text-slate-600 mb-1">
                  Port count:{' '}
                  <span className="font-mono">{ports.port_count}</span>
                </p>

                {ports.ports.length > 0 ? (
                  <ul className="space-y-1">
                    {ports.ports.slice(0, 12).map((p: any, idx: number) => (
                      <li
                        key={idx}
                        className="flex justify-between items-center"
                      >
                        <div>
                          <span className="font-mono text-slate-900 mr-2">
                            {p.port_id}
                          </span>
                          <span className="text-slate-500">
                            {p.admin_state}/{p.port_state} ({p.board})
                          </span>
                        </div>
                      </li>
                    ))}
                    {ports.ports.length > 12 && (
                      <li className="text-slate-400">
                        +{ports.ports.length - 12} more...
                      </li>
                    )}
                  </ul>
                ) : (
                  <span className="text-slate-500">
                    No ports parsed from cached snapshot.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirm dialog */}
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
    </>
  );
}

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */

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

/* ============================================================
   CONFIG ROW
   ============================================================ */

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