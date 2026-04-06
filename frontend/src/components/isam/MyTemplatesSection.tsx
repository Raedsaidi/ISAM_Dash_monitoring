import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Loader2,
  Pencil,
  Trash2,
  RefreshCw,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
  FileText,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { toast } from "sonner";
import { cn } from "../../utils/cn";

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;
const PAGE_SIZE = 10;
const PROJECT_NONE = "__NONE__";

type TemplateScope = "GLOBAL" | "USER_INSTANCE";

interface SavedParameters {
  selected_port?: string | null;
  manual_port?: string | null;
  effective_port?: string | null;
  variables?: Record<string, string>;
  saved_from?: "manual-edit" | "apply-success" | null;
  applied_at?: string | null;
}

interface WanTemplate {
  id: number;
  name: string;
  project: string | null;
  commands_template: string;
  scope: TemplateScope;
  isam_instance_id: number | null;
  created_by: string | null;
  source_template_id: number | null;
  saved_parameters?: SavedParameters | null;
  created_at: string;
  updated_at: string;
}

interface WanTemplateListResponse {
  templates: WanTemplate[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface TemplateProject {
  id: number;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TemplateProjectListResponse {
  projects: TemplateProject[];
}

function getReadableErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message?.trim();
    return msg || "An unexpected error occurred.";
  }
  return "An unexpected error occurred.";
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
    if (res.status !== 204) {
      data = await res.json();
    }
  } catch {}

  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : typeof data?.message === "string"
          ? data.message
          : `Request failed with status ${res.status}.`;

    throw new Error(detail);
  }

  return data as T;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-slate-600">{description}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyTemplatesSection() {
  const { accessToken, user } = useAuth();

  const [templates, setTemplates] = useState<WanTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateSearch, setTemplateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [projects, setProjects] = useState<string[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [page, setPage] = useState(1);
  const [totalTemplates, setTotalTemplates] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [editingTemplate, setEditingTemplate] = useState<WanTemplate | null>(null);
  const [editName, setEditName] = useState("");
  const [editCommands, setEditCommands] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<WanTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pageRange = useMemo(() => {
    if (!totalTemplates) return { start: 0, end: 0 };
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalTemplates);
    return { start, end };
  }, [page, totalTemplates]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(templateSearch);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [templateSearch]);

  const loadProjects = useCallback(async () => {
    if (!accessToken) return;

    setLoadingProjects(true);
    try {
      const res = await authFetchJson<TemplateProjectListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/template-projects`,
        accessToken,
      );

      const names = (res.projects || [])
        .map((p) => (p?.name || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      setProjects(names);
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [accessToken]);

  const loadTemplates = useCallback(async () => {
    if (!accessToken) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("mine", "true");
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));

      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }

      if (projectFilter !== "ALL") {
        params.set("project", projectFilter);
      }

      const res = await authFetchJson<WanTemplateListResponse>(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates?${params.toString()}`,
        accessToken,
      );

      setTemplates(res.templates || []);
      setTotalTemplates(typeof res.total === "number" ? res.total : 0);
      setTotalPages(typeof res.total_pages === "number" ? res.total_pages : 1);
    } catch (err) {
      setTemplates([]);
      setTotalTemplates(0);
      setTotalPages(1);
      setError(getReadableErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, debouncedSearch, projectFilter]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages || 1);
    }
  }, [page, totalPages]);

  const openEditModal = (tpl: WanTemplate) => {
    setEditingTemplate(tpl);
    setEditName(tpl.name);
    setEditCommands(tpl.commands_template);
  };

  const closeEditModal = () => {
    setEditingTemplate(null);
    setEditName("");
    setEditCommands("");
  };

  const handleEditSave = async () => {
    if (!editingTemplate) return;

    if (!editName.trim()) {
      toast.error("Template name is required.");
      return;
    }

    if (!editCommands.trim()) {
      toast.error("Commands template is required.");
      return;
    }

    setSaving(true);
    try {
      await authFetchJson(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${editingTemplate.id}`,
        accessToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editName.trim(),
            commands_template: editCommands,
          }),
        },
      );

      toast.success("Template updated successfully.");
      closeEditModal();
      await loadTemplates();
    } catch (err) {
      toast.error(getReadableErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      await authFetchJson(
        `${ISAM_BASE_URL}/api/v1/isam/wan-templates/${deleteTarget.id}`,
        accessToken,
        {
          method: "DELETE",
        },
      );

      toast.success("Template deleted successfully.");
      setDeleteTarget(null);
      await loadTemplates();
    } catch (err) {
      toast.error(getReadableErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  if (user?.role !== "USER") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        This section is available only for role USER.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Search
              </label>
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Search by name, content, project..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                />
              </div>
            </div>

            <div className="w-full lg:w-64">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Project
              </label>
              <select
                value={projectFilter}
                onChange={(e) => {
                  setProjectFilter(e.target.value);
                  setPage(1);
                }}
                disabled={loadingProjects}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              >
                <option value="ALL">All projects</option>
                <option value={PROJECT_NONE}>No project</option>
                {projects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={loadTemplates}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            {pageRange.start > 0 ? (
              <>
                Showing <strong>{pageRange.start}</strong>–<strong>{pageRange.end}</strong> of{" "}
                <strong>{totalTemplates}</strong> personal template{totalTemplates !== 1 ? "s" : ""}
              </>
            ) : (
              "No personal templates found."
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Loading personal templates...
            </div>
          ) : error ? (
            <div className="px-5 py-6 text-sm text-red-600">{error}</div>
          ) : templates.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No personal templates found.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-col gap-4 p-5 xl:flex-row xl:items-start xl:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">
                        {tpl.name}
                      </h3>
                      <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                        {tpl.scope}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <FolderOpen size={12} />
                        {tpl.project || "No project"}
                      </span>
                      <span>
                        Updated {new Date(tpl.updated_at).toLocaleString()}
                      </span>
                      {tpl.source_template_id && (
                        <span>Source #{tpl.source_template_id}</span>
                      )}
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <FileText size={12} />
                        Commands Template
                      </div>
                      <pre className="overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">
                        {tpl.commands_template}
                      </pre>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => openEditModal(tpl)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>

                    <button
                      onClick={() => setDeleteTarget(tpl)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm",
                page <= 1 || loading
                  ? "cursor-not-allowed border-slate-200 text-slate-400"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50",
              )}
            >
              <ChevronLeft size={14} />
              Previous
            </button>

            <div className="text-sm text-slate-600">
              Page <strong>{page}</strong> / <strong>{Math.max(1, totalPages)}</strong>
            </div>

            <button
              onClick={() => setPage((p) => Math.min(Math.max(1, totalPages), p + 1))}
              disabled={page >= totalPages || loading}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm",
                page >= totalPages || loading
                  ? "cursor-not-allowed border-slate-200 text-slate-400"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50",
              )}
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Edit Template</h3>
              <button
                onClick={closeEditModal}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Template Name
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Commands Template
                </label>
                <textarea
                  value={editCommands}
                  onChange={(e) => setEditCommands(e.target.value)}
                  rows={16}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={closeEditModal}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template?"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : ""
        }
        confirmText={deleting ? "Deleting..." : "Delete"}
        cancelText="Cancel"
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}