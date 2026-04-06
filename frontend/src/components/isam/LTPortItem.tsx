import React, { useEffect, useState } from 'react';
import {
  Lock,
  Zap,
  Cable,
  Radio,
  Wifi,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import PortLockButton from './PortLockButton';

const ISAM_BASE_URL = import.meta.env.VITE_ISAM_BASE_URL;

interface TemplateStatus {
  configured: boolean;
  last_template_name?: string | null;
  last_applied_by?: string | null;
  last_project?: string | null;
  last_applied_at?: string | null;
  apply_count?: number;
}

interface LTPortItemProps {
  port: any;
  isLocked: boolean;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  onLockToggle: () => void;
  templateStatus?: TemplateStatus | null;
}

function isEmpty(val: any): boolean {
  if (val === null || val === undefined || val === '') return true;
  if (typeof val === 'number' && val === 0) return true;
  if (typeof val === 'string' && val.trim() === '-') return true;
  return false;
}

function formatMtu(cfg: any, oper: any): string | null {
  if (isEmpty(cfg) && isEmpty(oper)) return null;
  const c = isEmpty(cfg) ? '—' : cfg;
  const o = isEmpty(oper) ? '—' : oper;
  return `${c}/${o}`;
}

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

export default function LTPortItem({
  port,
  isLocked,
  instanceId,
  accessToken,
  isAdmin,
  onLockToggle,
  templateStatus: externalStatus,
}: LTPortItemProps) {
  const [status, setStatus] = useState<TemplateStatus | null>(
    externalStatus ?? null,
  );
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    if (externalStatus !== undefined) {
      setStatus(externalStatus);
      return;
    }

    if (!instanceId || !port.port_id || !accessToken) return;

    let cancelled = false;
    setStatusLoading(true);

    fetch(
      `${ISAM_BASE_URL}/api/v1/isam/instances/${instanceId}/ports/${port.port_id}/template-status`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId, port.port_id, accessToken, externalStatus]);

  function getPortTypeIcon() {
    const pt = (port.port_type || '').toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={14} />;
    if (pt.includes('ethernet')) return <Cable size={14} />;
    if (pt.includes('pon') || pt.includes('ont')) return <Radio size={14} />;
    return <Wifi size={14} />;
  }

  function getTypeStyle() {
    const pt = (port.port_type || '').toLowerCase();

    if (pt.includes('xdsl')) {
      return {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        badge: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    }

    if (pt.includes('ethernet')) {
      return {
        bg: 'bg-sky-50',
        border: 'border-sky-200',
        text: 'text-sky-700',
        badge: 'bg-sky-50 text-sky-800 border-sky-200',
      };
    }

    if (pt.includes('pon') || pt.includes('ont')) {
      return {
        bg: 'bg-violet-50',
        border: 'border-violet-200',
        text: 'text-violet-700',
        badge: 'bg-violet-50 text-violet-800 border-violet-200',
      };
    }

    return {
      bg: 'bg-slate-50',
      border: 'border-slate-200',
      text: 'text-slate-600',
      badge: 'bg-slate-50 text-slate-700 border-slate-200',
    };
  }

  const style = getTypeStyle();
  const adminUp = ['up'].includes((port.admin_state || '').toLowerCase());
  const portUp = ['up'].includes((port.port_state || '').toLowerCase());

  const mtuDisplay = formatMtu(port.cfg_mtu, port.oper_mtu);
  const hasMode = !isEmpty(port.mode);
  const hasEncap = !isEmpty(port.encap);
  const hasDetails = mtuDisplay || hasMode || hasEncap;

  const isConfigured = status?.configured === true;

  return (
    <div
      className={cn(
        'group relative rounded-xl border transition-all duration-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)]',
        isLocked
          ? 'border-orange-200 bg-gradient-to-r from-orange-50 via-orange-50/60 to-white'
          : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]',
      )}
    >
      {isLocked && (
        <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-orange-300 to-orange-500" />
      )}

      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg border shadow-sm shrink-0 ring-1 ring-white',
                style.bg,
                style.border,
                style.text,
              )}
            >
              {getPortTypeIcon()}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-slate-900 text-[13px] leading-none tracking-tight">
                  {port.port_id}
                </span>

                <span
                  className={cn(
                    'inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.14em] border leading-none',
                    style.badge,
                  )}
                >
                  {port.port_type}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <StateDot label="Admin" up={adminUp} value={port.admin_state} />
                <StateDot label="Port" up={portUp} value={port.port_state} />

                {hasDetails && (
                  <>
                    <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
                      {mtuDisplay && <MicroChip label="MTU" value={mtuDisplay} />}
                      {hasMode && <MicroChip label="Mode" value={port.mode} />}
                      {hasEncap && <MicroChip label="Encap" value={port.encap} />}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isLocked && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 border border-orange-200 rounded-full text-[9px] font-bold text-orange-700 uppercase tracking-[0.12em] shadow-sm">
                <Lock size={10} />
                Locked
              </div>
            )}

            {isAdmin && (
              <PortLockButton
                portId={port.port_id}
                isLocked={isLocked}
                instanceId={instanceId}
                accessToken={accessToken}
                onLockToggle={onLockToggle}
              />
            )}
          </div>
        </div>

        {!statusLoading && status && (
          <div className="mt-2.5 pt-2 border-t border-slate-100">
            {isConfigured ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full text-[9px] font-semibold text-emerald-700 shadow-sm">
                  <CheckCircle2 size={10} className="shrink-0" />
                  Configured
                </div>

                {status.last_template_name && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[9px] font-mono font-semibold text-slate-700">
                    {status.last_template_name}
                  </span>
                )}

                {status.last_project && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[9px] font-semibold text-violet-700">
                    {status.last_project}
                  </span>
                )}

                {status.last_applied_by && (
                  <span className="text-[9px] text-slate-400">
                    by{' '}
                    <span className="font-semibold text-slate-500">
                      {status.last_applied_by}
                    </span>
                  </span>
                )}

                {status.last_applied_at && (
                  <span className="text-[9px] text-slate-300">
                    · {formatRelativeTime(status.last_applied_at)}
                  </span>
                )}

                {(status.apply_count ?? 0) > 1 && (
                  <span className="text-[9px] text-slate-300">
                    · {status.apply_count}× applied
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <Circle size={8} className="text-slate-300 shrink-0" />
                <span>Not configured</span>
              </div>
            )}
          </div>
        )}

        {statusLoading && (
          <div className="mt-2.5 pt-2 border-t border-slate-100">
            <div className="h-3 w-32 bg-slate-100 rounded-full animate-pulse" />
          </div>
        )}

        {hasDetails && (
          <div className="sm:hidden mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
            {mtuDisplay && <MicroChip label="MTU" value={mtuDisplay} />}
            {hasMode && <MicroChip label="Mode" value={port.mode} />}
            {hasEncap && <MicroChip label="Encap" value={port.encap} />}
          </div>
        )}
      </div>
    </div>
  );
}

function StateDot({
  label,
  up,
  value,
}: {
  label: string;
  up: boolean;
  value: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-slate-50 border border-slate-100">
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          up ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]' : 'bg-slate-300',
        )}
      />
      <span className="text-[10px] text-slate-400">{label}</span>
      <span
        className={cn(
          'text-[10px] font-semibold uppercase',
          up ? 'text-emerald-700' : 'text-slate-500',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MicroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-[9px] shadow-sm">
      <span className="font-semibold text-slate-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="font-mono font-semibold text-slate-700">{value}</span>
    </span>
  );
}