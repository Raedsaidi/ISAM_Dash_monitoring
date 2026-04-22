import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Loader2, Edit, Play, Search, X,
  Terminal, ChevronLeft, ChevronRight, AlertTriangle,
  Copy, Check, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';

type FunctionScope = 'GLOBAL' | 'USER_INSTANCE';

interface IsamInstance { id: number; name: string; host: string; }
interface CustomFunction {
  id: number; name: string; command_template: string;
  description?: string | null; project?: string | null;
  scope: FunctionScope; isam_instance_id?: number | null;
  created_by?: string | null; created_at: string; updated_at: string;
}
interface CustomFunctionListResponse {
  functions: CustomFunction[]; total: number; page: number;
  page_size: number; total_pages: number;
}
interface ExecuteResponse {
  success: boolean; protocol_used?: string | null;
  executed_command: string; raw_output: string;
  variables_used: Record<string, string>; message: string;
  function_id?: number | null; function_name?: string | null;
}

function extractTemplateVars(template: string): string[] {
  const regex = /\[\[\s*\$(.+?)\s*\]\]/g;
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const v = (match[1] || '').trim();
    if (v) vars.add(v);
  }
  return Array.from(vars);
}

function detectCliError(raw?: string | null): { isError: boolean; reason?: string } {
  const out = (raw || '').trim();
  if (!out) return { isError: false };
  const lower = out.toLowerCase();
  if (lower.includes('invalid token')) return { isError: true, reason: 'Invalid authentication token' };
  const patterns = [
    { re: /\bunknown command\b/i, reason: 'Unknown command' },
    { re: /\bsyntax error\b/i, reason: 'Syntax error in command' },
    { re: /\bpermission denied\b/i, reason: 'Permission denied' },
    { re: /\bnot found\b/i, reason: 'Resource not found' },
    { re: /\b(error|errors)\b/i, reason: 'Command error' },
    { re: /\bfail(ed)?\b/i, reason: 'Command failed' },
  ];
  for (const p of patterns) if (p.re.test(out)) return { isError: true, reason: p.reason };
  return { isError: false };
}

function isTemplateErrorMessage(msg?: string | null) {
  const m = (msg || '').toLowerCase();
  return m.includes('template') || m.includes('render') || m.includes('variable') ||
    m.includes('missing') || m.includes('no command template provided') || m.includes('placeholder');
}

function formatErrorMessage(rawMessage: string): string {
  let cleaned = rawMessage
    .replace(/SSH:\s*\[SSH\]\s*/gi, '').replace(/SSH-LEGACY:\s*/gi, '')
    .replace(/TELNET:\s*\[TELNET\]\s*/gi, '')
    .replace(/Erreur inattendue lors de l'exécution\s*:\s*/gi, '')
    .replace(/Erreur lors de l'exécution de la commande\s*:\s*/gi, '').trim();
  if (cleaned.includes('Unable to connect') || cleaned.includes('Connection refused'))
    return 'Unable to connect to the ISAM instance. Please verify the instance is online.';
  if (cleaned.includes('port 22')) return 'SSH connection failed. The instance may be offline.';
  if (cleaned.includes('Authentication failed') || cleaned.includes('invalid token'))
    return 'Authentication failed. Please check your credentials.';
  if (cleaned.includes('timeout') || cleaned.includes('timed out'))
    return 'Connection timed out. The instance is not responding.';
  if (cleaned.includes('No route to host'))
    return 'Network unreachable. Check the instance network configuration.';
  if (cleaned.includes('[Errno') || cleaned.includes('Traceback'))
    return 'An error occurred while executing the command.';
  if (cleaned.length < 100 && !cleaned.includes(';')) return cleaned;
  return 'Command execution failed. Please check the instance and try again.';
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}

// ─── Shared components ────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1800);
      }}
      className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
    >
      {ok ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
    </button>
  );
}

function Badge({
  children, variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'blue' | 'violet' | 'default' | 'amber';
}) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    default: 'bg-slate-100 text-slate-600 border-slate-200',
  }[variant];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
      {children}
    </span>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

const field =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white text-slate-900 ' +
  'placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 ' +
  'focus:border-slate-400 transition-colors';

function ModalShell({
  children, onClose, maxW = 'max-w-2xl',
}: {
  children: React.ReactNode; onClose: () => void; maxW?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl w-full ${maxW} max-h-[90vh] flex flex-col`}>
        {children}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CustomFunctionsSection() {
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const username =
    (user as any)?.username ??
    (user as any)?.preferred_username ??
    (user as any)?.sub ??
    null;
  const apiBase = `${import.meta.env.VITE_ISAM_BASE_URL}/api/v1/isam`;

  const [functions, setFunctions] = useState<CustomFunction[]>([]);
  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'' | FunctionScope>('');
  const [projectFilter, setProjectFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingFunction, setEditingFunction] = useState<CustomFunction | null>(null);
  const [name, setName] = useState('');
  const [commandTemplate, setCommandTemplate] = useState('');
  const [description, setDescription] = useState('');
  const [project, setProject] = useState('');
  const [scope, setScope] = useState<FunctionScope>('GLOBAL');
  const [instanceIdForFunction, setInstanceIdForFunction] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [executingFunction, setExecutingFunction] = useState<CustomFunction | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | ''>('');
  const [executeVariables, setExecuteVariables] = useState<Record<string, string>>({});
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<CustomFunction | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [search, scopeFilter, projectFilter, pageSize]);
  useEffect(() => { loadInstances(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadFunctions(); }, [page, pageSize, search, scopeFilter, projectFilter]);

  const instanceById = useMemo(() => {
    const m = new Map<number, IsamInstance>();
    instances.forEach((i) => m.set(i.id, i));
    return m;
  }, [instances]);

  const detectedCreateEditVars = useMemo(
    () => extractTemplateVars(commandTemplate),
    [commandTemplate],
  );
  const detectedExecVars = useMemo(
    () => extractTemplateVars(executingFunction?.command_template || ''),
    [executingFunction],
  );

  const canEditOrDelete = (func: CustomFunction) =>
    isAdmin || (func.scope === 'USER_INSTANCE' && !!username && func.created_by === username);

  // ─── API ────────────────────────────────────────────────────────────────────

  const loadFunctions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (search) params.set('search', search);
      if (scopeFilter) params.set('scope', scopeFilter);
      if (projectFilter.trim()) params.set('project', projectFilter.trim());
      const res = await fetch(`${apiBase}/custom-functions?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await safeJson(res)) as CustomFunctionListResponse | null;
      if (!res.ok) throw new Error((data as any)?.detail);
      setFunctions(data?.functions || []);
      setTotal(data?.total ?? 0);
      setTotalPages(data?.total_pages ?? 1);
    } catch { toast.error('Failed to load functions'); }
    finally { setLoading(false); }
  };

  const loadInstances = async () => {
    try {
      const res = await fetch(`${apiBase}/instances`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.detail);
      setInstances(data?.instances || []);
    } catch { toast.error('Failed to load instances'); }
  };

  const resetForm = () => {
    setEditingFunction(null); setName(''); setCommandTemplate('');
    setDescription(''); setProject(''); setScope('GLOBAL'); setInstanceIdForFunction('');
  };

  const openCreateModal = () => {
    if (!isAdmin) { toast.warning('Only administrators can create functions.'); return; }
    resetForm(); setShowModal(true);
  };

  const openEditModal = (func: CustomFunction) => {
    setEditingFunction(func); setName(func.name); setCommandTemplate(func.command_template);
    setDescription(func.description || ''); setProject(func.project || '');
    setScope(func.scope); setInstanceIdForFunction(func.isam_instance_id ?? '');
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); resetForm(); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !commandTemplate.trim()) {
      toast.warning('Name and command template are required.'); return;
    }
    setSaving(true);
    try {
      const url = editingFunction
        ? `${apiBase}/custom-functions/${editingFunction.id}`
        : `${apiBase}/custom-functions`;
      const payload: any = editingFunction
        ? {
            name: name.trim(), command_template: commandTemplate.trim(),
            description: description.trim() || undefined, project: project.trim() || undefined,
          }
        : {
            name: name.trim(), command_template: commandTemplate.trim(),
            description: description.trim() || undefined, project: project.trim() || undefined,
            scope, isam_instance_id: scope === 'USER_INSTANCE' ? instanceIdForFunction : undefined,
          };
      const res = await fetch(url, {
        method: editingFunction ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.detail);
      toast.success(editingFunction ? 'Function updated.' : 'Function created.');
      closeModal(); await loadFunctions();
    } catch { toast.error('Failed to save function.'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/custom-functions/${deleteConfirm.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) { const d = await safeJson(res); throw new Error(d?.detail); }
      toast.success(`"${deleteConfirm.name}" deleted.`);
      setDeleteConfirm(null); await loadFunctions();
    } catch { toast.error('Failed to delete function.'); }
    finally { setDeleting(false); }
  };

  const openExecuteModal = (func: CustomFunction) => {
    setExecutingFunction(func); setExecuteResult(null); setExecuteVariables({});
    if (!isAdmin && func.scope === 'USER_INSTANCE') {
      if (!func.isam_instance_id) {
        toast.error('No instance associated with this function.'); return;
      }
      setSelectedInstanceId(func.isam_instance_id);
    } else {
      setSelectedInstanceId(func.isam_instance_id ?? '');
    }
  };

  const closeExecuteModal = () => {
    setExecutingFunction(null); setExecuteResult(null);
    setExecuteVariables({}); setSelectedInstanceId('');
  };

  const disableInstanceSelect =
    !!executingFunction && !isAdmin &&
    executingFunction.scope === 'USER_INSTANCE' && !!executingFunction.isam_instance_id;

  const executeFunction = async () => {
    if (!executingFunction || !selectedInstanceId) {
      toast.warning('Please select an instance.'); return;
    }
    if (
      !isAdmin && executingFunction.scope === 'USER_INSTANCE' &&
      selectedInstanceId !== executingFunction.isam_instance_id
    ) {
      toast.error('You can only run this function on its assigned instance.'); return;
    }
    setIsExecuting(true);
    try {
      const res = await fetch(`${apiBase}/custom-functions/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          function_id: executingFunction.id,
          variables: executeVariables,
          instance_id: selectedInstanceId,
        }),
      });
      const data = (await safeJson(res)) as ExecuteResponse | null;
      if (!res.ok) {
        const raw = (data as any)?.detail || data?.message || 'Execution failed';
        isTemplateErrorMessage(raw)
          ? toast.warning('Check your template variables.')
          : toast.error(formatErrorMessage(raw));
        return;
      }
      const cliError = detectCliError(data?.raw_output);
      const ok = Boolean(data?.success) && !cliError.isError;
      const normalized: ExecuteResponse = {
        ...(data as ExecuteResponse),
        success: ok,
        message: cliError.isError
          ? cliError.reason || 'Error'
          : data?.message || (ok ? 'Success' : 'Failed'),
      };
      setExecuteResult(normalized);
      ok ? toast.success('Command executed.') : toast.error(normalized.message);
    } catch { toast.error('Unexpected error during execution.'); }
    finally { setIsExecuting(false); }
  };

  const hasFilters = !!(search || scopeFilter || projectFilter);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Custom Functions</h1>
            <p className="text-sm text-slate-500 mt-0.5">Reusable CLI command templates</p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={16} /> New function
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="bg-white border border-slate-200 rounded-lg mb-4">
          <div className="flex items-center gap-2 p-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search functions…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200" />

            {/* Scope */}
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-slate-400" />
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter((e.target.value as any) || '')}
                className="text-sm border border-slate-200 rounded-md px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
              >
                <option value="">All scopes</option>
                <option value="GLOBAL">Global</option>
                <option value="USER_INSTANCE">User instance</option>
              </select>
            </div>

            {/* Project */}
            <input
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="Project…"
              className="text-sm border border-slate-200 rounded-md px-3 py-2 w-32 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />

            {hasFilters && (
              <button
                onClick={() => { setSearchInput(''); setScopeFilter(''); setProjectFilter(''); }}
                className="text-xs text-slate-500 hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <X size={13} /> Clear
              </button>
            )}

            <div className="ml-auto">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="text-sm border border-slate-200 rounded-md px-2 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>

          {/* Sub-bar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-lg">
            <span className="text-xs text-slate-500">
              {loading
                ? 'Loading…'
                : <><strong className="text-slate-700">{total}</strong> function{total !== 1 ? 's' : ''}{hasFilters ? ' found' : ''}</>}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-slate-600 font-medium tabular-nums">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        {loading && functions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-16 flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-slate-400" size={24} />
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : functions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-16 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <Terminal size={22} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">No functions found</p>
            <p className="text-xs text-slate-400">
              {hasFilters ? 'Try adjusting your filters.' : 'Create your first custom function to get started.'}
            </p>
            {isAdmin && !hasFilters && (
              <button onClick={openCreateModal} className="mt-2 text-sm text-slate-900 underline underline-offset-2">
                Create a function
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Scope</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Instance</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Updated</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {functions.map((func) => {
                  const inst = func.isam_instance_id ? instanceById.get(func.isam_instance_id) : null;
                  const vars = extractTemplateVars(func.command_template);
                  const editable = canEditOrDelete(func);

                  return (
                    <React.Fragment key={func.id}>
                      {/* Main row */}
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        {/* Name */}
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-slate-900">{func.name}</p>
                          {func.description && (
                            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                              {func.description}
                            </p>
                          )}
                          {vars.length > 0 && (
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {vars.map((v) => (
                                <code
                                  key={v}
                                  className="px-1.5 py-px text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded font-mono"
                                >
                                  ${v}
                                </code>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Scope */}
                        <td className="px-4 py-3.5">
                          {func.scope === 'GLOBAL'
                            ? <Badge variant="blue">Global</Badge>
                            : <Badge variant="violet">User</Badge>}
                        </td>

                        {/* Project */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          {func.project
                            ? <span className="text-slate-600">{func.project}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>

                        {/* Instance */}
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          {inst
                            ? <span className="text-slate-600">{inst.name}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>

                        {/* Updated */}
                        <td className="px-4 py-3.5 hidden lg:table-cell text-slate-400 text-xs whitespace-nowrap">
                          {new Date(func.updated_at).toLocaleDateString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {/* Run */}
                            <button
                              onClick={() => openExecuteModal(func)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-700 text-white rounded-md transition-colors"
                            >
                              <Play size={12} strokeWidth={2.5} /> Run
                            </button>

                            {/* Edit */}
                            {editable && (
                              <button
                                onClick={() => openEditModal(func)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                                title="Edit"
                              >
                                <Edit size={15} />
                              </button>
                            )}

                            {/* Delete */}
                            {editable && (
                              <button
                                onClick={() => setDeleteConfirm(func)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Template row */}
                      <tr className="bg-slate-950">
                        <td colSpan={6}>
                          <div className="flex items-start justify-between px-4 py-2.5">
                            <pre className="text-xs text-slate-300 font-mono leading-relaxed flex-1 overflow-x-auto whitespace-pre-wrap break-all">
                              {func.command_template}
                            </pre>
                            <CopyBtn text={func.command_template} />
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ Delete Modal ═══ */}
      {deleteConfirm && (
        <ModalShell onClose={() => !deleting && setDeleteConfirm(null)} maxW="max-w-md">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={17} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-base mb-1">Delete function</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  You are about to permanently delete{' '}
                  <strong className="text-slate-800 font-medium">"{deleteConfirm.name}"</strong>.
                  This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting
                  ? <><Loader2 size={14} className="animate-spin" /> Deleting…</>
                  : 'Delete'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* ═══ Create / Edit Modal ═══ */}
      {showModal && (
        <ModalShell onClose={closeModal}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">
              {editingFunction ? 'Edit function' : 'New function'}
            </h2>
            <button
              onClick={closeModal}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
            {/* Row 1 — Name + Scope */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label required>Name</Label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className={field} placeholder="e.g., Show VLAN Config"
                />
              </div>

              {!editingFunction ? (
                <div>
                  <Label required>Scope</Label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as FunctionScope)}
                    className={field}
                  >
                    <option value="GLOBAL">Global</option>
                    <option value="USER_INSTANCE">User instance</option>
                  </select>
                </div>
              ) : (
                <div>
                  <Label>Scope</Label>
                  <div className="flex items-center h-9 gap-2">
                    {scope === 'GLOBAL'
                      ? <Badge variant="blue">Global</Badge>
                      : <Badge variant="violet">User instance</Badge>}
                    <span className="text-xs text-slate-400">Cannot be changed</span>
                  </div>
                </div>
              )}
            </div>

            {/* Row 2 — Project + Instance */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Project</Label>
                <input
                  type="text" value={project} onChange={(e) => setProject(e.target.value)}
                  className={field} placeholder="Optional"
                />
              </div>

              {!editingFunction ? (
                <div>
                  <Label required={scope === 'USER_INSTANCE'}>ISAM Instance</Label>
                  <select
                    value={instanceIdForFunction}
                    onChange={(e) => setInstanceIdForFunction(e.target.value ? Number(e.target.value) : '')}
                    disabled={scope !== 'USER_INSTANCE'}
                    className={`${field} disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed`}
                  >
                    <option value="">— Select instance —</option>
                    {instances.map((i) => (
                      <option key={i.id} value={i.id}>{i.name} ({i.host})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <Label>ISAM Instance</Label>
                  <div className="flex items-center h-9 text-sm text-slate-600">
                    {editingFunction.isam_instance_id
                      ? instanceById.get(editingFunction.isam_instance_id)?.name || `#${editingFunction.isam_instance_id}`
                      : <span className="text-slate-400 italic">None</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <Label>Description</Label>
              <input
                type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className={field} placeholder="What does this function do?"
              />
            </div>

            {/* Template */}
            <div>
              <Label required>Command template</Label>
              <textarea
                value={commandTemplate}
                onChange={(e) => setCommandTemplate(e.target.value)}
                rows={7}
                className="w-full px-3 py-2.5 bg-slate-950 text-slate-100 border border-slate-800 rounded-md text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 resize-none placeholder-slate-600 transition-colors"
                placeholder={'show port [[ $port_id ]]\nshow vlan [[ $vlan_id ]]'}
              />
              {detectedCreateEditVars.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">Variables:</span>
                  {detectedCreateEditVars.map((v) => (
                    <code
                      key={v}
                      className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs font-mono"
                    >
                      ${v}
                    </code>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 pt-2">
              <button
                type="button" onClick={closeModal}
                className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={saving}
                className="flex-1 px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : editingFunction ? 'Update' : 'Create function'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* ═══ Execute Modal ═══ */}
      {executingFunction && (
        <ModalShell onClose={closeExecuteModal}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
            <div>
              <h2 className="font-semibold text-slate-900">Run function</h2>
              <p className="text-xs text-slate-400 mt-0.5">{executingFunction.name}</p>
            </div>
            <button
              onClick={closeExecuteModal}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {/* Template preview */}
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Template</p>
              <div className="bg-slate-950 rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800">
                  <span className="text-xs text-slate-500 font-mono">command</span>
                  <CopyBtn text={executingFunction.command_template} />
                </div>
                <pre className="px-4 py-3 text-xs text-slate-200 font-mono overflow-x-auto leading-relaxed">
                  {executingFunction.command_template}
                </pre>
              </div>
            </div>

            {/* Instance */}
            <div>
              <Label required>ISAM Instance</Label>
              <select
                value={selectedInstanceId}
                onChange={(e) => setSelectedInstanceId(e.target.value ? Number(e.target.value) : '')}
                disabled={disableInstanceSelect}
                className={`${field} disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed`}
              >
                <option value="">— Select instance —</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.host})</option>
                ))}
              </select>
              {!isAdmin && executingFunction.scope === 'USER_INSTANCE' && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <AlertTriangle size={12} /> Restricted to assigned instance
                </p>
              )}
            </div>

            {/* Variables */}
            {detectedExecVars.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Variables</p>
                <div className="grid grid-cols-2 gap-3">
                  {detectedExecVars.map((v) => (
                    <div key={v}>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        <code className="text-amber-700">${v}</code>
                      </label>
                      <input
                        type="text"
                        value={executeVariables[v] || ''}
                        onChange={(e) => setExecuteVariables((p) => ({ ...p, [v]: e.target.value }))}
                        className={field}
                        placeholder={`Value for ${v}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Result */}
            {executeResult && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                {/* Status */}
                <div className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm ${
                  executeResult.success
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${executeResult.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="font-medium">{executeResult.success ? 'Success' : 'Failed'}</span>
                  <span className="text-xs opacity-75">— {executeResult.message}</span>
                  {executeResult.protocol_used && (
                    <span className="ml-auto text-xs font-mono opacity-60">{executeResult.protocol_used}</span>
                  )}
                </div>

                {/* Executed command */}
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
                    Executed command
                  </p>
                  <div className="relative bg-slate-950 rounded-md">
                    <div className="absolute top-1.5 right-2">
                      <CopyBtn text={executeResult.executed_command} />
                    </div>
                    <pre className="px-4 py-3 text-xs text-amber-300 font-mono overflow-x-auto leading-relaxed pr-20">
                      {executeResult.executed_command || '—'}
                    </pre>
                  </div>
                </div>

                {/* Output */}
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Output</p>
                  <div className="relative bg-slate-950 rounded-md">
                    <div className="absolute top-1.5 right-2">
                      <CopyBtn text={executeResult.raw_output} />
                    </div>
                    <pre className="px-4 py-3 text-xs text-green-400 font-mono overflow-auto max-h-52 leading-relaxed pr-20">
                      {executeResult.raw_output || 'No output returned'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex gap-3">
            <button
              onClick={closeExecuteModal}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={executeFunction}
              disabled={isExecuting || !selectedInstanceId}
              className="flex-1 px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {isExecuting
                ? <><Loader2 size={14} className="animate-spin" /> Running…</>
                : <><Play size={14} strokeWidth={2.5} /> Run command</>}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}