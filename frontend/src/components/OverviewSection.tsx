import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../utils/cn';
import {
  Activity,
  Server,
  AlertTriangle,
  Clock,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Cable,
  FileText,
  User as UserIcon,
  Mail,
  ShieldCheck,
  CalendarDays,
  LogIn,
  CheckCircle2,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useAuth } from '../context/AuthContext';

/**
 * Ajuste ici selon ton architecture :
 * - auth-service
 * - isam-service
 *
 * Si tu as un API gateway unique, mets les 2 à la même valeur.
 */
const AUTH_BASE_URL = 'http://127.0.0.1:9000';
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

interface WanTemplate {
  id: number;
  isam_instance_id: number;
  name: string;
  commands_template: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

interface WanTemplateListResponse {
  templates: WanTemplate[];
}

interface ConfigHistoryItem {
  id: number;
  username: string;
  action: string;
  isam_instance_id: number | null;
  port_id: string | null;
  template_id: number | null;
  success: boolean;
  message: string | null;
  commands_executed: string | null;
  raw_output: string | null;
  ip_address: string | null;
  created_at: string;
}

interface ConfigHistoryListResponse {
  items: ConfigHistoryItem[];
}

interface UserPort {
  id: number;
  label: string | null;
  value: string;
}

interface MeResponse {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;

  // compat ancien
  port_label?: string | null;
  port_value?: string | null;

  // nouveau modèle
  ports?: UserPort[];

  created_at?: string;
  last_login_at?: string | null;
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
    // réponse vide ou non json
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

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: { value: string; positive: boolean };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          {trend && (
            <div
              className={cn(
                'flex items-center gap-1 mt-2 text-xs font-medium',
                trend.positive ? 'text-green-600' : 'text-red-600',
              )}
            >
              {trend.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {trend.value}
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-xl', color)}>{icon}</div>
      </div>
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-slate-900 break-words">{value || '-'}</div>
    </div>
  );
}

export default function OverviewSection() {
  const { accessToken } = useAuth();

  const jwt = useMemo(() => parseJwt(accessToken), [accessToken]);
  const roleFromJwt = (jwt?.role as UserRole | undefined) ?? null;

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);

  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [history, setHistory] = useState<ConfigHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const effectiveRole: UserRole = (me?.role ?? roleFromJwt ?? 'USER') as UserRole;
  const isAdmin = effectiveRole === 'ADMIN' || effectiveRole === 'SUPER_ADMIN';

  useEffect(() => {
    if (!accessToken) return;
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    if (isAdmin) {
      loadInstances();
      loadTemplatesAll();
      loadHistoryAdmin();
    } else {
      // USER
      setInstances([]);
      setInstancesError(null);
      loadTemplatesAll(); // on filtre ensuite par created_by == me.username
      loadHistoryUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, isAdmin]);

  async function loadMe() {
    setLoadingMe(true);
    setMeError(null);

    try {
      const data = await authFetchJson<MeResponse>(
        `${AUTH_BASE_URL}/api/v1/auth/me`,
        accessToken,
      );
      setMe(data);
    } catch (err: any) {
      setMeError(err.message || 'Failed to load profile.');
    } finally {
      setLoadingMe(false);
    }
  }

  async function loadInstances() {
    setLoadingInstances(true);
    setInstancesError(null);

    try {
      const data = await authFetchJson<IsamInstanceListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/instances`,
        accessToken,
      );
      setInstances(data.instances ?? []);
    } catch (err: any) {
      setInstancesError(err.message || 'Failed to load ISAM instances.');
    } finally {
      setLoadingInstances(false);
    }
  }

  async function loadTemplatesAll() {
    setLoadingTemplates(true);
    setTemplatesError(null);

    try {
      const data = await authFetchJson<WanTemplateListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
        accessToken,
      );
      setTemplates(data.templates ?? []);
    } catch (err: any) {
      setTemplatesError(err.message || 'Failed to load templates.');
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function loadHistoryAdmin() {
    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const data = await authFetchJson<ConfigHistoryListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/config-history?limit=100`,
        accessToken,
      );
      setHistory(data.items ?? []);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load configuration history.');
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadHistoryUser() {
    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const data = await authFetchJson<ConfigHistoryListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/my-config-history?limit=100`,
        accessToken,
      );
      setHistory(data.items ?? []);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load my history.');
    } finally {
      setLoadingHistory(false);
    }
  }

  const myPorts = useMemo<UserPort[]>(() => {
    if (me?.ports && me.ports.length > 0) {
      return me.ports;
    }

    // compat ancien système si jamais un user a encore un port unique
    if (me?.port_value) {
      return [
        {
          id: -1,
          label: me.port_label ?? 'Primary port',
          value: me.port_value,
        },
      ];
    }

    return [];
  }, [me]);

  const visibleTemplates = useMemo<WanTemplate[]>(() => {
    if (isAdmin) return templates;

    if (templates.length === 0) return [];

    // si created_by est renvoyé, on filtre vraiment par user courant
    const hasCreatedByField = templates.some((t) => typeof t.created_by !== 'undefined');

    if (hasCreatedByField) {
      if (!me?.username) return [];
      return templates.filter((t) => t.created_by === me.username);
    }

    // fallback si le backend ne renvoie pas created_by
    return templates;
  }, [templates, isAdmin, me?.username]);

  const totalIsam = instances.length;
  const activeIsam = instances.filter((i) => i.status === 'active').length;
  const errorIsam = instances.filter((i) => i.status === 'error').length;

  const totalTemplates = visibleTemplates.length;

  const totalActions = history.length;
  const successCount = history.filter((h) => h.success).length;
  const failureCount = history.filter((h) => !h.success).length;
  const successRate =
    totalActions > 0 ? Math.round((successCount / totalActions) * 100) : 0;

  const responseTimes = instances
    .map((i) => i.last_response_time_ms || 0)
    .filter((v) => v > 0);

  const avgResponseTime =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

  const successFailureData = [
    { name: 'Success', value: successCount, color: '#22c55e' },
    { name: 'Failure', value: failureCount, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  const latestHistory = history.slice(0, 5);
  const myPortsCount = myPorts.length;

  // ===================== ADMIN VIEW =====================
  if (isAdmin) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="ISAM Instances"
            value={totalIsam}
            subtitle="Total registered ISAM devices"
            icon={<Server size={20} className="text-blue-600" />}
            color="bg-blue-50"
            trend={
              totalIsam > 0 ? { value: `${activeIsam} active`, positive: true } : undefined
            }
          />
          <StatCard
            title="Active Instances"
            value={activeIsam}
            subtitle={`Error: ${errorIsam}`}
            icon={<Activity size={20} className="text-green-600" />}
            color="bg-green-50"
            trend={
              errorIsam > 0
                ? { value: `${errorIsam} in error`, positive: false }
                : undefined
            }
          />
          <StatCard
            title="WAN Templates"
            value={totalTemplates}
            subtitle="Total templates"
            icon={<Zap size={20} className="text-amber-600" />}
            color="bg-amber-50"
          />
          <StatCard
            title="Config Success Rate"
            value={`${successRate}%`}
            subtitle={`Total actions: ${totalActions}`}
            icon={<AlertTriangle size={20} className="text-red-600" />}
            color="bg-red-50"
            trend={
              totalActions > 0
                ? {
                    value: `${successCount} success / ${failureCount} failure`,
                    positive: successRate >= 80,
                  }
                : undefined
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Latest Configuration Activity
                </h3>
                <p className="text-sm text-slate-500">
                  Last applied templates and actions
                </p>
              </div>
              {loadingHistory && (
                <Loader2 size={16} className="animate-spin text-slate-500" />
              )}
            </div>

            {historyError && (
              <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {historyError}
              </div>
            )}

            <div className="space-y-2 text-xs">
              {latestHistory.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-slate-900">{h.action}</span>
                    <span className="text-slate-500">
                      User {h.username} on ISAM #{h.isam_instance_id ?? '-'}{' '}
                      {h.port_id ? `/ ${h.port_id}` : ''}
                    </span>
                    {h.template_id !== null && (
                      <span className="text-slate-400">Template ID: {h.template_id}</span>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={cn(
                        'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
                        h.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                      )}
                    >
                      {h.success ? 'success' : 'failure'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock size={10} />
                      {formatDate(h.created_at)}
                    </span>
                  </div>
                </div>
              ))}

              {latestHistory.length === 0 && !loadingHistory && (
                <div className="text-xs text-slate-500">No activity yet.</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Configuration Results</h3>
            <p className="text-sm text-slate-500 mb-4">Distribution of success vs failure</p>

            {loadingHistory ? (
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={successFailureData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {successFailureData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="space-y-2 mt-2 text-sm">
                  {successFailureData.length === 0 && (
                    <span className="text-xs text-slate-500">No actions yet.</span>
                  )}
                  {successFailureData.map((item) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-slate-600">{item.name}</span>
                      </div>
                      <span className="font-medium text-slate-900">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Response Time Overview</h3>
              <span className="text-xs text-slate-400">
                Avg: {avgResponseTime > 0 ? `${avgResponseTime} ms` : 'N/A'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Average last response time reported by ISAM instances.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">ISAM Instances Status</h3>
              {loadingInstances && (
                <Loader2 size={16} className="animate-spin text-slate-500" />
              )}
            </div>

            {instancesError && (
              <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {instancesError}
              </div>
            )}

            <div className="text-xs text-slate-500 mb-3">
              Total: {totalIsam} | Active: {activeIsam} | Error: {errorIsam}
            </div>

            <div className="space-y-3">
              {instances.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Server
                      size={18}
                      className={cn(
                        inst.status === 'active'
                          ? 'text-green-500'
                          : inst.status === 'error'
                            ? 'text-red-500'
                            : 'text-slate-400',
                      )}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{inst.name}</p>
                      <p className="text-xs text-slate-500">
                        {inst.host} ({inst.protocol_preference})
                      </p>
                    </div>
                  </div>

                  <span
                    className={cn(
                      'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
                      inst.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : inst.status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {inst.status}
                  </span>
                </div>
              ))}

              {instances.length === 0 && !loadingInstances && !instancesError && (
                <div className="text-xs text-slate-500">No ISAM instances configured yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===================== USER VIEW =====================
  return (
    <div className="space-y-6">
      {/* Account information */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-900">Account Information</h3>
            <p className="text-sm text-slate-500">
              User profile data and assigned database ports
            </p>
          </div>
          {loadingMe && <Loader2 size={16} className="animate-spin text-slate-500" />}
        </div>

        {meError && (
          <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
            {meError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <InfoItem
            icon={<UserIcon size={14} />}
            label="Username"
            value={me?.username ?? '-'}
          />
          <InfoItem
            icon={<UserIcon size={14} />}
            label="Full name"
            value={me?.full_name ?? '-'}
          />
          <InfoItem
            icon={<Mail size={14} />}
            label="Email"
            value={me?.email ?? '-'}
          />
          <InfoItem
            icon={<ShieldCheck size={14} />}
            label="Role"
            value={me?.role ?? roleFromJwt ?? '-'}
          />
          <InfoItem
            icon={<CheckCircle2 size={14} />}
            label="Status"
            value={me?.is_active ? 'Active' : 'Disabled'}
          />
          <InfoItem
            icon={<Cable size={14} />}
            label="Assigned DB ports"
            value={myPortsCount}
          />
          <InfoItem
            icon={<CalendarDays size={14} />}
            label="Created at"
            value={formatDate(me?.created_at)}
          />
          <InfoItem
            icon={<LogIn size={14} />}
            label="Last login"
            value={formatDate(me?.last_login_at)}
          />
        </div>
      </div>

      {/* Stats user */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="My Ports"
          value={myPortsCount}
          subtitle="Database ports assigned to your account"
          icon={<Cable size={20} className="text-teal-700" />}
          color="bg-teal-50"
        />
        <StatCard
          title="My Templates"
          value={totalTemplates}
          subtitle="Templates created by you"
          icon={<FileText size={20} className="text-purple-700" />}
          color="bg-purple-50"
        />
        <StatCard
          title="My Success Rate"
          value={`${successRate}%`}
          subtitle={`My actions: ${totalActions}`}
          icon={<AlertTriangle size={20} className="text-amber-700" />}
          color="bg-amber-50"
          trend={
            totalActions > 0
              ? {
                  value: `${successCount} success / ${failureCount} failure`,
                  positive: successRate >= 80,
                }
              : undefined
          }
        />
        <StatCard
          title="My Role"
          value={me?.role ?? roleFromJwt ?? 'USER'}
          subtitle={me?.is_active ? 'Account is active' : 'Account is disabled'}
          icon={<ShieldCheck size={20} className="text-blue-700" />}
          color="bg-blue-50"
        />
      </div>

      {/* Activity + pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-900">My Latest Activity</h3>
              <p className="text-sm text-slate-500">Your latest configuration actions</p>
            </div>
            {loadingHistory && <Loader2 size={16} className="animate-spin text-slate-500" />}
          </div>

          {historyError && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
              {historyError}
            </div>
          )}

          <div className="space-y-2 text-xs">
            {latestHistory.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-slate-900">{h.action}</span>
                  <span className="text-slate-500">
                    User {h.username} on ISAM #{h.isam_instance_id ?? '-'}{' '}
                    {h.port_id ? `/ ${h.port_id}` : ''}
                  </span>
                  {h.template_id !== null && (
                    <span className="text-slate-400">Template ID: {h.template_id}</span>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
                      h.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                    )}
                  >
                    {h.success ? 'success' : 'failure'}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock size={10} />
                    {formatDate(h.created_at)}
                  </span>
                </div>
              </div>
            ))}

            {latestHistory.length === 0 && !loadingHistory && (
              <div className="text-xs text-slate-500">No activity yet.</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-1">My Results</h3>
          <p className="text-sm text-slate-500 mb-4">Distribution of success vs failure</p>

          {loadingHistory ? (
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={successFailureData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {successFailureData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="space-y-2 mt-2 text-sm">
                {successFailureData.length === 0 && (
                  <span className="text-xs text-slate-500">No actions yet.</span>
                )}
                {successFailureData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-slate-600">{item.name}</span>
                    </div>
                    <span className="font-medium text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Ports DB assignés */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-slate-900">My Assigned Database Ports</h3>
            <p className="text-sm text-slate-500">
              Ports assigned to this user in auth-service database
            </p>
          </div>
          {loadingMe && <Loader2 size={16} className="animate-spin text-slate-500" />}
        </div>

        {meError && (
          <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
            {meError}
          </div>
        )}

        <div className="space-y-2">
          {myPorts.map((p) => (
            <div
              key={`${p.id}-${p.value}`}
              className="p-3 bg-slate-50 rounded-lg flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {p.label || 'Port'}
                </div>
                <div className="text-xs text-slate-500 font-mono">{p.value}</div>
              </div>

              <span className="text-[11px] px-2 py-1 rounded-full bg-teal-100 text-teal-700">
                assigned
              </span>
            </div>
          ))}

          {myPorts.length === 0 && !loadingMe && (
            <div className="text-xs text-slate-500">No database ports assigned to this user.</div>
          )}
        </div>
      </div>

      {/* Templates user */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-slate-900">My Templates</h3>
            <p className="text-sm text-slate-500">
              Templates created by the current user
            </p>
          </div>
          {loadingTemplates && <Loader2 size={16} className="animate-spin text-slate-500" />}
        </div>

        {templatesError && (
          <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
            {templatesError}
          </div>
        )}

        <div className="space-y-2">
          {visibleTemplates.slice(0, 12).map((t) => (
            <div
              key={t.id}
              className="p-3 bg-slate-50 rounded-lg flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{t.name}</div>
                <div className="text-xs text-slate-500">
                  Template #{t.id} • ISAM #{t.isam_instance_id}
                </div>
                {t.created_by && (
                  <div className="text-[11px] text-slate-400">Created by: {t.created_by}</div>
                )}
              </div>

              <div className="text-xs text-slate-400 whitespace-nowrap">
                {formatDate(t.created_at)}
              </div>
            </div>
          ))}

          {visibleTemplates.length === 0 && !loadingTemplates && (
            <div className="text-xs text-slate-500">No templates found for this user.</div>
          )}
        </div>
      </div>
    </div>
  );
}