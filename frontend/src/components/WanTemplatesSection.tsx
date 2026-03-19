import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../utils/cn';
import {
  Plus,
  Trash2,
  Loader2,
  Edit,
  Search,
  Globe,
  User,
  Play,
  Eye,
  FileText,
  Server,
  Sparkles,
  X,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

const ISAM_BASE_URL = 'http://127.0.0.1:8001';

type StatusType = 'active' | 'inactive' | 'error';
type ProtocolPreference = 'telnet' | 'ssh' | 'auto';
type TemplateScope = 'GLOBAL' | 'USER_INSTANCE';
type ConfirmActionType =
  | 'delete-template'
  | 'clear-template-content'
  | 'clear-all-form';

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
  name: string;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id: number | null;
  created_by: string | null;
  source_template_id: number | null;
  created_at: string;
  updated_at: string;
}

interface WanTemplateListResponse {
  templates: WanTemplate[];
}

interface WanTemplateSavePayload {
  name: string;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id?: number | null;
  source_template_id?: number | null;
}

interface TemplateRenderResponse {
  variables_detected: string[];
  rendered_script: string;
  rendered_commands: string[];
}

interface TemplateTestResponse {
  success: boolean;
  protocol_used: string | null;
  rendered_commands: string[];
  raw_output: string;
  message: string;
}

interface ConfirmDialogState {
  open: boolean;
  action: ConfirmActionType | null;
  template: WanTemplate | null;
  loading: boolean;
}

const EMPTY_CONFIRM_DIALOG: ConfirmDialogState = {
  open: false,
  action: null,
  template: null,
  loading: false,
};

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

function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let match: RegExpExecArray | null = null;
  const regex = /\[\[\$(.+?)\]\]/g;

  while ((match = regex.exec(template)) !== null) {
    const variable = match[1]?.trim();
    if (variable && !seen.has(variable)) {
      seen.add(variable);
      result.push(variable);
    }
  }

  return result;
}

function isPortVariable(name: string) {
  const v = name.trim().toLowerCase();
  return v === 'port' || v === 'port_id';
}

function ScopeBadge({ scope }: { scope: TemplateScope }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        scope === 'GLOBAL'
          ? 'bg-violet-100 text-violet-700'
          : 'bg-blue-100 text-blue-700',
      )}
    >
      {scope === 'GLOBAL' ? <Globe size={12} /> : <User size={12} />}
      {scope === 'GLOBAL' ? 'Global' : 'User / Instance'}
    </span>
  );
}

export default function WanTemplatesSection() {
  const { accessToken } = useAuth();

  const [instances, setInstances] = useState<IsamInstance[]>([]);
  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WanTemplate | null>(null);

  const [name, setName] = useState('');
  const [commandsTemplate, setCommandsTemplate] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [testInstanceId, setTestInstanceId] = useState<number | ''>('');
  const [testPort, setTestPort] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [previewState, setPreviewState] = useState<{
    loading: boolean;
    error: string | null;
    rendered_script: string;
    rendered_commands: string[];
  }>({
    loading: false,
    error: null,
    rendered_script: '',
    rendered_commands: [],
  });

  const [testState, setTestState] = useState<{
    loading: boolean;
    success: boolean;
    error: string | null;
    protocol_used: string | null;
    raw_output: string;
    rendered_commands: string[];
    message: string | null;
  }>({
    loading: false,
    success: false,
    error: null,
    protocol_used: null,
    raw_output: '',
    rendered_commands: [],
    message: null,
  });

  const [submitting, setSubmitting] = useState(false);

  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState>(EMPTY_CONFIRM_DIALOG);

  useEffect(() => {
    if (!accessToken) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const detectedVariables = useMemo(
    () => extractTemplateVariables(commandsTemplate),
    [commandsTemplate],
  );

  const customVariables = useMemo(
    () => detectedVariables.filter((v) => !isPortVariable(v)),
    [detectedVariables],
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;

    return templates.filter((t) => {
      const appliesTo =
        t.scope === 'GLOBAL'
          ? 'global'
          : `${t.isam_instance_id ?? ''} ${instanceNameFromList(instances, t.isam_instance_id)}`;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.created_by || '').toLowerCase().includes(q) ||
        appliesTo.toLowerCase().includes(q)
      );
    });
  }, [templates, search, instances]);

  const canSave = Boolean(name.trim() && commandsTemplate.trim());

  useEffect(() => {
    setVariableValues((prev) => {
      const next: Record<string, string> = {};
      customVariables.forEach((v) => {
        next[v] = prev[v] ?? '';
      });
      return next;
    });
  }, [customVariables]);

  async function loadData() {
    setLoading(true);
    setGlobalError(null);

    try {
      const [instRes, tplRes] = await Promise.all([
        authFetchJson<IsamInstanceListResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/instances`,
          accessToken,
        ),
        authFetchJson<WanTemplateListResponse>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
        ),
      ]);

      setInstances(instRes.instances || []);
      setTemplates(tplRes.templates || []);
    } catch (err: any) {
      setGlobalError(err.message || 'Failed to load WAN templates.');
    } finally {
      setLoading(false);
    }
  }

  function resetStatesOnly() {
    setPreviewState({
      loading: false,
      error: null,
      rendered_script: '',
      rendered_commands: [],
    });

    setTestState({
      loading: false,
      success: false,
      error: null,
      protocol_used: null,
      raw_output: '',
      rendered_commands: [],
      message: null,
    });
  }

  function resetModalState() {
    setEditingTemplate(null);
    setName('');
    setCommandsTemplate('');
    setVariableValues({});
    setTestInstanceId('');
    setTestPort('');
    setFormError(null);
    resetStatesOnly();
  }

  function closeConfirmDialog() {
    if (confirmDialog.loading) return;
    setConfirmDialog(EMPTY_CONFIRM_DIALOG);
  }

  function openCreateModal() {
    resetModalState();
    setShowModal(true);
  }

  function openEditModal(template: WanTemplate) {
    resetModalState();
    setEditingTemplate(template);
    setName(template.name);
    setCommandsTemplate(template.commands_template);

    if (template.scope === 'USER_INSTANCE' && template.isam_instance_id) {
      setTestInstanceId(template.isam_instance_id);
    }

    setShowModal(true);
  }

  function openDeleteDialog(template: WanTemplate) {
    setConfirmDialog({
      open: true,
      action: 'delete-template',
      template,
      loading: false,
    });
  }

  function openClearTemplateContentDialog() {
    setConfirmDialog({
      open: true,
      action: 'clear-template-content',
      template: null,
      loading: false,
    });
  }

  function openClearAllFormDialog() {
    setConfirmDialog({
      open: true,
      action: 'clear-all-form',
      template: null,
      loading: false,
    });
  }

  async function handlePreview() {
    setFormError(null);

    if (!commandsTemplate.trim()) {
      setFormError('Commands template is required.');
      return;
    }

    if (detectedVariables.some(isPortVariable) && !testPort.trim()) {
      setFormError(
        'Test port is required for preview because the template uses [[$port]].',
      );
      return;
    }

    setPreviewState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await authFetchJson<TemplateRenderResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/render`,
        accessToken,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commands_template: commandsTemplate,
            selected_port: testPort.trim() || null,
            variables: variableValues,
          }),
        },
      );

      setPreviewState({
        loading: false,
        error: null,
        rendered_script: res.rendered_script,
        rendered_commands: res.rendered_commands,
      });
    } catch (err: any) {
      setPreviewState({
        loading: false,
        error: err.message || 'Failed to render template.',
        rendered_script: '',
        rendered_commands: [],
      });
    }
  }

  async function handleTestTemplate() {
    setFormError(null);

    if (!commandsTemplate.trim()) {
      setFormError('Commands template is required.');
      return;
    }

    if (!testInstanceId) {
      setFormError('Please choose an ISAM for testing.');
      return;
    }

    if (detectedVariables.some(isPortVariable) && !testPort.trim()) {
      setFormError('Please enter a test port.');
      return;
    }

    setTestState((s) => ({
      ...s,
      loading: true,
      error: null,
      success: false,
      message: null,
    }));

    const toastId = toast.loading('Testing template on ISAM...');

    try {
      const res = await authFetchJson<TemplateTestResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/test`,
        accessToken,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instance_id: Number(testInstanceId),
            commands_template: commandsTemplate,
            selected_port: testPort.trim() || null,
            variables: variableValues,
          }),
        },
      );

      setTestState({
        loading: false,
        success: res.success,
        error: res.success ? null : res.message,
        protocol_used: res.protocol_used,
        raw_output: res.raw_output,
        rendered_commands: res.rendered_commands,
        message: res.message,
      });

      if (res.success) {
        toast.success(
          res.message || 'Template test executed successfully.',
          { id: toastId },
        );
      } else {
        toast.error(
          res.message || 'Template test failed.',
          { id: toastId },
        );
      }
    } catch (err: any) {
      setTestState({
        loading: false,
        success: false,
        error: err.message || 'Failed to test template.',
        protocol_used: null,
        raw_output: '',
        rendered_commands: [],
        message: null,
      });

      toast.error(err.message || 'Failed to test template.', {
        id: toastId,
      });
    }
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!canSave) {
      setFormError('Template name and content are required.');
      return;
    }

    const isEditing = Boolean(editingTemplate);
    setSubmitting(true);

    try {
      if (editingTemplate) {
        await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${editingTemplate.id}`,
          accessToken,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: name.trim(),
              commands_template: commandsTemplate,
            }),
          },
        );
      } else {
        const payload: WanTemplateSavePayload = {
          name: name.trim(),
          commands_template: commandsTemplate,
          scope: 'GLOBAL',
          isam_instance_id: null,
        };

        await authFetchJson<WanTemplate>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates`,
          accessToken,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
        );
      }

      await loadData();
      setShowModal(false);
      resetModalState();

      toast.success(
        isEditing
          ? 'The template has been updated successfully.'
          : 'The template has been created successfully.',
      );
    } catch (err: any) {
      setFormError(err.message || 'Failed to save template.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteTemplate(t: WanTemplate) {
    openDeleteDialog(t);
  }

  function handleClearTemplateContent() {
    if (!commandsTemplate.trim()) return;
    openClearTemplateContentDialog();
  }

  function handleClearAllForm() {
    openClearAllFormDialog();
  }

  async function handleConfirmDialog() {
    const { action, template } = confirmDialog;

    if (!action) return;

    if (action === 'clear-template-content') {
      setCommandsTemplate('');
      resetStatesOnly();
      setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      toast.success('Template content has been cleared.');
      return;
    }

    if (action === 'clear-all-form') {
      resetModalState();
      setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      toast.success('The form has been cleared.');
      return;
    }

    if (action === 'delete-template' && template) {
      setConfirmDialog((prev) => ({ ...prev, loading: true }));
      const toastId = toast.loading('Deleting template...');

      try {
        await authFetchJson<void>(
          `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${template.id}`,
          accessToken,
          {
            method: 'DELETE',
          },
        );

        await loadData();

        if (editingTemplate?.id === template.id) {
          setShowModal(false);
          resetModalState();
        }

        toast.success('The template has been deleted.', { id: toastId });
      } catch (err: any) {
        toast.error(err.message || 'Failed to delete template.', {
          id: toastId,
        });
      } finally {
        setConfirmDialog(EMPTY_CONFIRM_DIALOG);
      }
    }
  }

  const confirmTitle =
    confirmDialog.action === 'delete-template'
      ? `Delete "${confirmDialog.template?.name ?? ''}"?`
      : confirmDialog.action === 'clear-template-content'
      ? 'Clear template content?'
      : confirmDialog.action === 'clear-all-form'
      ? 'Reset the whole form?'
      : '';

  const confirmText =
    confirmDialog.action === 'delete-template'
      ? 'Yes, delete'
      : confirmDialog.action === 'clear-template-content'
      ? 'Yes, clear'
      : confirmDialog.action === 'clear-all-form'
      ? 'Yes, reset'
      : 'Confirm';

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">WAN Templates</h2>
            <p className="text-sm text-slate-500">
              Create, preview, test and manage templates. Testing is optional.
            </p>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-sm"
          >
            <Plus size={16} />
            Add Global Template
          </button>
        </div>

        {/* Search */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="relative max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search by template name or creator..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Error */}
        {globalError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {globalError}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading templates...
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Templates</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {filteredTemplates.length} template(s)
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Template
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Scope
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Applies To
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Creator
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                      Updated
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredTemplates.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="px-5 py-4 align-top">
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.commands_template.split('\n').filter(Boolean).length} command
                            line(s)
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 align-top">
                        <ScopeBadge scope={t.scope} />
                      </td>

                      <td className="px-5 py-4 align-top text-slate-700">
                        {t.scope === 'GLOBAL'
                          ? 'All ISAM'
                          : instanceNameFromList(instances, t.isam_instance_id)}
                      </td>

                      <td className="px-5 py-4 align-top text-slate-700">
                        {t.created_by || '—'}
                      </td>

                      <td className="px-5 py-4 align-top text-xs text-slate-500">
                        {new Date(t.updated_at).toLocaleString()}
                      </td>

                      <td className="px-5 py-4 align-top text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(t)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <Edit size={14} />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteTemplate(t)}
                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredTemplates.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm text-slate-500"
                      >
                        No templates found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl border border-slate-200 overflow-hidden max-h-[92vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {editingTemplate ? 'Edit Template' : 'Create Global Template'}
                  </h3>
                  <p className="text-sm text-slate-500">
                    Preview and test are optional but recommended before saving.
                  </p>
                </div>

                <button
                  onClick={() => setShowModal(false)}
                  className="h-9 w-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveTemplate} className="p-6 space-y-6">
                {formError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                  {/* Left side */}
                  <div className="space-y-5">
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <FileText size={18} className="text-blue-600" />
                        <h4 className="font-semibold text-slate-900">
                          Template Definition
                        </h4>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                          Template Name
                        </label>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Example: FTTH activation"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <ScopeBadge scope={editingTemplate?.scope ?? 'GLOBAL'} />
                        {editingTemplate?.scope === 'USER_INSTANCE' && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium bg-slate-100 text-slate-700">
                            <Server size={12} />
                            {instanceNameFromList(
                              instances,
                              editingTemplate.isam_instance_id,
                            )}
                          </span>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <label className="block text-sm font-medium text-slate-700">
                            Commands Template
                          </label>

                          <button
                            type="button"
                            onClick={handleClearTemplateContent}
                            disabled={!commandsTemplate.trim()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={13} />
                            Clear
                          </button>
                        </div>

                        <textarea
                          value={commandsTemplate}
                          onChange={(e) => setCommandsTemplate(e.target.value)}
                          rows={16}
                          className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`configure equipment ont interface [[$port]] admin-state down
configure equipment ont no interface [[$port]]
configure equipment ont interface [[$port]] sw-ver-pland unplanned desc1 [[$desc]] sernum [[$serial_number]]
configure equipment ont interface [[$port]] admin-state up`}
                        />

                        <p className="mt-2 text-xs text-slate-500">
                          Variable format: <code>[[$port]]</code>, <code>[[$desc]]</code>,{' '}
                          <code>[[$serial_number]]</code>
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <div className="text-xs font-semibold text-slate-700 mb-2">
                          Detected variables
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {detectedVariables.length === 0 ? (
                            <span className="text-xs text-slate-500">
                              No variables detected.
                            </span>
                          ) : (
                            detectedVariables.map((v) => (
                              <span
                                key={v}
                                className={cn(
                                  'inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium',
                                  isPortVariable(v)
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-slate-200 text-slate-700',
                                )}
                              >
                                {v}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="space-y-5">
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-amber-600" />
                        <h4 className="font-semibold text-slate-900">Preview & Test</h4>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                          Test ISAM
                        </label>
                        <select
                          value={testInstanceId}
                          onChange={(e) =>
                            setTestInstanceId(e.target.value ? Number(e.target.value) : '')
                          }
                          className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Choose ISAM...</option>
                          {instances.map((inst) => (
                            <option key={inst.id} value={inst.id}>
                              {inst.name} ({inst.host})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                          Test Port
                        </label>
                        <input
                          value={testPort}
                          onChange={(e) => setTestPort(e.target.value)}
                          className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="1/1/7/3/95"
                        />
                      </div>

                      {customVariables.length > 0 && (
                        <div className="space-y-3">
                          <div className="text-sm font-medium text-slate-700">
                            Variables
                          </div>
                          {customVariables.map((v) => (
                            <div key={v}>
                              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                {v}
                              </label>
                              <input
                                value={variableValues[v] ?? ''}
                                onChange={(e) =>
                                  setVariableValues((prev) => ({
                                    ...prev,
                                    [v]: e.target.value,
                                  }))
                                }
                                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handlePreview}
                          disabled={previewState.loading}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                        >
                          {previewState.loading ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Eye size={16} />
                          )}
                          Preview
                        </button>

                        <button
                          type="button"
                          onClick={handleTestTemplate}
                          disabled={testState.loading}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium"
                        >
                          {testState.loading ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Play size={16} />
                          )}
                          Test on ISAM
                        </button>
                      </div>

                      {!testState.success && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          Template not tested yet. You can still save it, but testing
                          is recommended.
                        </div>
                      )}

                      {previewState.error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                          {previewState.error}
                        </div>
                      )}

                      {previewState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-slate-700">
                            Preview Commands
                          </div>
                          <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap">
                            {previewState.rendered_commands.join('\n')}
                          </pre>
                        </div>
                      )}

                      {(testState.error || testState.message) && (
                        <div
                          className={cn(
                            'text-xs border rounded-xl px-3 py-2',
                            testState.success
                              ? 'text-green-700 bg-green-50 border-green-200'
                              : 'text-red-600 bg-red-50 border-red-200',
                          )}
                        >
                          {testState.error || testState.message}
                        </div>
                      )}

                      {testState.rendered_commands.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-slate-700">
                            Tested Commands
                          </div>
                          <pre className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono max-h-40 overflow-auto whitespace-pre-wrap">
                            {testState.rendered_commands.join('\n')}
                          </pre>
                        </div>
                      )}

                      {testState.raw_output && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-slate-700">
                            ISAM Output
                          </div>
                          <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-[11px] font-mono max-h-48 overflow-auto whitespace-pre-wrap">
                            {testState.raw_output}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleClearAllForm}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50"
                  >
                    <RotateCcw size={16} />
                    Clear All
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={submitting || !canSave}
                    className="px-4 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting
                      ? editingTemplate
                        ? 'Saving...'
                        : 'Creating...'
                      : editingTemplate
                      ? 'Save Changes'
                      : 'Save Template'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmTitle}
        confirmText={confirmText}
        cancelText="Cancel"
        loading={confirmDialog.loading}
        variant="danger"
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      >
        {confirmDialog.action === 'delete-template' && confirmDialog.template && (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Template</span>
              <span className="font-semibold text-slate-900">
                {confirmDialog.template.name}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Scope</span>
              <span className="font-semibold text-slate-700">
                {confirmDialog.template.scope}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Created by</span>
              <span className="text-slate-900">
                {confirmDialog.template.created_by || '—'}
              </span>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <span className="text-slate-500">Applies to</span>
              <span className="text-slate-900">
                {confirmDialog.template.scope === 'GLOBAL'
                  ? 'All ISAM'
                  : instanceNameFromList(
                      instances,
                      confirmDialog.template.isam_instance_id,
                    )}
              </span>
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              This action cannot be undone.
            </div>
          </div>
        )}

        {confirmDialog.action === 'clear-template-content' && (
          <p className="text-sm text-slate-600">
            This will remove the current commands from the editor.
          </p>
        )}

        {confirmDialog.action === 'clear-all-form' && (
          <p className="text-sm text-slate-600">
            This will clear the name, template content, variables and test
            results.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

function ConfirmDialog({
  open,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  variant = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>

          <div className="mt-3">{children}</div>

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
              className={cn(
                'px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2',
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700',
              )}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function instanceNameFromList(
  instances: IsamInstance[],
  id: number | null | undefined,
) {
  if (!id) return 'All ISAM';
  const found = instances.find((i) => i.id === id);
  return found ? `${found.name} (${found.host})` : `ISAM #${id}`;
}