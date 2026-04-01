import React, { useEffect, useState } from 'react';
import { Lock, Zap, Cable, Radio, Wifi, CheckCircle2, Circle } from 'lucide-react';
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
  /** Optionnel : si le parent pré-charge les statuts en batch */
  templateStatus?: TemplateStatus | null;
}

// Helper: check if a value is "empty" (0, "-", "", null, undefined)
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
  const [status, setStatus] = useState<TemplateStatus | null>(externalStatus ?? null);
  const [statusLoading, setStatusLoading] = useState(false);

  // Si le parent fournit le statut, on l'utilise directement
  useEffect(() => {
    if (externalStatus !== undefined) {
      setStatus(externalStatus);
      return;
    }

    // Sinon, fetch individuel
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
    if (pt.includes('xdsl')) return <Zap size={13} />;
    if (pt.includes('ethernet')) return <Cable size={13} />;
    if (pt.includes('pon') || pt.includes('ont')) return <Radio size={13} />;
    return <Wifi size={13} />;
  }

  function getTypeStyle() {
    const pt = (port.port_type || '').toLowerCase();
    if (pt.includes('xdsl'))
      return {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        badge: 'bg-amber-100 text-amber-800 border-amber-300',
      };
    if (pt.includes('ethernet'))
      return {
        bg: 'bg-sky-50',
        border: 'border-sky-200',
        text: 'text-sky-700',
        badge: 'bg-sky-100 text-sky-800 border-sky-300',
      };
    if (pt.includes('pon') || pt.includes('ont'))
      return {
        bg: 'bg-violet-50',
        border: 'border-violet-200',
        text: 'text-violet-700',
        badge: 'bg-violet-100 text-violet-800 border-violet-300',
      };
    return {
      bg: 'bg-zinc-50',
      border: 'border-zinc-200',
      text: 'text-zinc-600',
      badge: 'bg-zinc-100 text-zinc-700 border-zinc-300',
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
        'group relative rounded-lg border transition-all duration-100',
        isLocked
          ? 'border-orange-300 bg-orange-50/40 border-dashed'
          : 'border-zinc-200/80 bg-white hover:border-zinc-300 hover:shadow-[0_1px_4px_rgba(0,0,0,0.03)]',
      )}
    >
      {isLocked && (
        <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-orange-400 rounded-full" />
      )}

      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* Left */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-md border shrink-0',
                style.bg,
                style.border,
                style.text,
              )}
            >
              {getPortTypeIcon()}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-bold text-zinc-900 text-[13px] leading-none">
                  {port.port_id}
                </span>
                <span
                  className={cn(
                    'inline-flex px-1.5 py-px rounded text-[8px] font-bold uppercase tracking-widest border leading-none',
                    style.badge,
                  )}
                >
                  {port.port_type}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mt-1.5">
                <StateDot label="Admin" up={adminUp} value={port.admin_state} />
                <div className="w-px h-2.5 bg-zinc-200" />
                <StateDot label="Port" up={portUp} value={port.port_state} />

                {hasDetails && (
                  <>
                    <div className="w-px h-2.5 bg-zinc-200 hidden sm:block" />
                    <div className="hidden sm:flex items-center gap-1">
                      {mtuDisplay && <MicroChip label="MTU" value={mtuDisplay} />}
                      {hasMode && <MicroChip label="Mode" value={port.mode} />}
                      {hasEncap && <MicroChip label="Encap" value={port.encap} />}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isLocked && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 border border-orange-300 rounded text-[9px] font-bold text-orange-700 uppercase tracking-wider">
                <Lock size={9} />
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

        {/* ── Template status row ── */}
        {!statusLoading && status && (
          <div className="mt-2 pt-1.5 border-t border-zinc-100">
            {isConfigured ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-[9px] font-semibold text-emerald-700">
                  <CheckCircle2 size={9} className="shrink-0" />
                  Configured
                </div>

                {status.last_template_name && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[9px] font-mono font-semibold text-zinc-700">
                    {status.last_template_name}
                  </span>
                )}

                {status.last_project && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-[9px] font-semibold text-violet-600">
                    {status.last_project}
                  </span>
                )}

                {status.last_applied_by && (
                  <span className="text-[9px] text-zinc-400">
                    by{' '}
                    <span className="font-semibold text-zinc-500">
                      {status.last_applied_by}
                    </span>
                  </span>
                )}

                {status.last_applied_at && (
                  <span className="text-[9px] text-zinc-300">
                    · {formatRelativeTime(status.last_applied_at)}
                  </span>
                )}

                {(status.apply_count ?? 0) > 1 && (
                  <span className="text-[9px] text-zinc-300">
                    · {status.apply_count}× applied
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Circle size={8} className="text-zinc-300 shrink-0" />
                <span className="text-[9px] text-zinc-400">Not configured</span>
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {statusLoading && (
          <div className="mt-2 pt-1.5 border-t border-zinc-100">
            <div className="h-3 w-32 bg-zinc-100 rounded animate-pulse" />
          </div>
        )}

        {/* Mobile details row */}
        {hasDetails && (
          <div className="sm:hidden mt-2 pt-1.5 border-t border-zinc-100 flex items-center gap-1 flex-wrap">
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
    <div className="flex items-center gap-1">
      <div
        className={cn(
          'w-[5px] h-[5px] rounded-full shrink-0',
          up ? 'bg-emerald-500' : 'bg-zinc-300',
        )}
      />
      <span className="text-[10px] text-zinc-400">{label}</span>
      <span
        className={cn(
          'text-[10px] font-semibold',
          up ? 'text-emerald-700' : 'text-zinc-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MicroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-zinc-100/80 text-[9px]">
      <span className="font-medium text-zinc-400 uppercase">{label}</span>
      <span className="font-mono font-semibold text-zinc-600">{value}</span>
    </span>
  );
}