import { useMemo, useState } from 'react';
import { Lock, Zap, Cable, Radio, Signal, Wifi, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import PortLockButton from './PortLockButton';
import PortConfigDetailModal from './PortConfigDetailModal';

type PortConfigStatus = 'UNKNOWN' | 'NOT_CONFIGURED' | 'VIA_APP' | 'MANUAL' | 'DRIFTED';

interface PortConfigSummary {
  status: PortConfigStatus;
  last_device_check_at?: string | null;
  last_template_name?: string | null;
  last_project?: string | null;
  last_applied_by?: string | null;
  last_applied_at?: string | null;
  apply_count?: number;
  device_vlan_count?: number;
  expected_vlan_count?: number;
  ont_sernum?: string | null;
}

// ✅ Interface SFP inline — pas de fichier séparé
interface SFPInfo {
  sfp_id: string;
  slot_short_id: string;
  sfp_index: number;
  port_id: string;
  status: string;
  is_empty: boolean;
  is_active: boolean;
  is_copper: boolean;
  part_number: string | null;
  wavelength: string | null;
  fiber_mode: string | null;
  standard: string | null;
  speed: string | null;
  direction: string | null;
  media: string | null;
  tx_wavelength: string | null;
  rx_wavelength: string | null;
  last_refresh_at: string | null;
}

interface LTPortItemProps {
  port: any;
  isLocked: boolean;
  instanceId: number;
  accessToken: string | null;
  isAdmin: boolean;
  onLockToggle: () => void;
  // ✅ SFP passé depuis le parent — pas de fetch ici
  sfp?: SFPInfo | null;
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

function normalizeConfig(cfg: any): PortConfigSummary | null {
  if (!cfg) return null;
  if (typeof cfg === 'string') {
    try {
      return JSON.parse(cfg);
    } catch {
      return null;
    }
  }
  return cfg as PortConfigSummary;
}

// ── Badges existants ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const s = (status || 'UNKNOWN').toUpperCase();
  const cls =
    s === 'VIA_APP'
      ? 'bg-green-50 border-green-200 text-green-700'
      : s === 'MANUAL'
        ? 'bg-blue-50 border-blue-200 text-blue-700'
        : s === 'DRIFTED'
          ? 'bg-red-50 border-red-200 text-red-700'
          : s === 'NOT_CONFIGURED'
            ? 'bg-gray-50 border-gray-200 text-gray-700'
            : 'bg-yellow-50 border-yellow-200 text-yellow-800';

  return (
    <span className={cn('px-2 py-1 rounded border text-xs font-medium', cls)}>{s}</span>
  );
}

function StateBadge({ label, up, value }: { label: string; up: boolean; value: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs',
        up ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600',
      )}
    >
      <div className={cn('w-1.5 h-1.5 rounded-full', up ? 'bg-green-500' : 'bg-gray-400')} />
      <span>
        {label}: {value}
      </span>
    </div>
  );
}

// ── ONT badge (empty/plugged only) ───────────────────────────────────────────

function ONTPlugBadge({ plugged }: { plugged: boolean }) {
  if (!plugged) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-400 text-xs">
        <Signal size={10} />
        empty
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 text-xs font-medium">
      <Signal size={10} />
      plugged
    </span>
  );
}

// ── SFP badge inline ─────────────────────────────────────────────────────────

function SFPBadge({
  sfp,
  expanded,
  onClick,
}: {
  sfp: SFPInfo;
  expanded: boolean;
  onClick?: () => void;
}) {
  // Port vide
  if (sfp.is_empty) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-400 text-xs">
        <Signal size={10} />
        empty
      </span>
    );
  }

  // Cuivre
  if (sfp.is_copper) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors',
          'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 cursor-pointer',
          expanded && 'ring-1 ring-amber-400',
        )}
      >
        <Cable size={10} />
        {sfp.speed ?? '1 Gbps'} · Copper
      </button>
    );
  }

  // Fibre active / GPON
  if (sfp.is_active) {
    const dir =
      sfp.direction === 'downstream' ? '↓' : sfp.direction === 'upstream' ? '↑' : '↕';

    const isGpon = (sfp.standard || '').toLowerCase().includes('bplusc');
    const mediaLabel = isGpon ? 'GPON' : 'Fiber';

    const colorCls = isGpon
      ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
      : 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100';

    const ringCls = expanded ? (isGpon ? 'ring-1 ring-purple-400' : 'ring-1 ring-cyan-400') : '';

    const waveCls = isGpon ? 'text-purple-500' : 'text-cyan-500';

    return (
      <button
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors cursor-pointer',
          colorCls,
          ringCls,
        )}
      >
        <Wifi size={10} />
        {sfp.speed ?? ''} {dir} {mediaLabel}
        {sfp.wavelength && (
          <span className={cn('ml-1 font-mono text-[10px]', waveCls)}>{sfp.wavelength}</span>
        )}
      </button>
    );
  }

  // Erreur
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-600 text-xs">
      <Signal size={10} />
      {sfp.status}
    </span>
  );
}

// ── Panneau SFP détaillé collapse ────────────────────────────────────────────

function SFPPanel({ sfp, onClose }: { sfp: SFPInfo; onClose: () => void }) {
  if (sfp.is_empty) return null;

  const isCopper = sfp.is_copper;
  const isGpon = (sfp.standard || '').toLowerCase().includes('bplusc');

  const panelCls = isCopper
    ? 'bg-amber-50 border-amber-100'
    : isGpon
      ? 'bg-purple-50 border-purple-100'
      : 'bg-cyan-50 border-cyan-100';

  const headerCls = isCopper ? 'text-amber-700' : isGpon ? 'text-purple-700' : 'text-cyan-700';

  // (optionnel mais utile) : afficher GPON dans le panel aussi
  const mediaValue = isGpon ? 'GPON' : sfp.media;

  const rows: { label: string; value: string | null; mono?: boolean }[] = [
    { label: 'SFP ID', value: sfp.sfp_id, mono: true },
    { label: 'Status', value: sfp.status },
    { label: 'Part #', value: sfp.part_number, mono: true },
    { label: 'Standard', value: sfp.standard, mono: true },
    { label: 'Speed', value: sfp.speed },
    { label: 'Direction', value: sfp.direction },
    { label: 'Media', value: mediaValue },
    { label: 'Wavelength', value: sfp.wavelength, mono: true },
    { label: 'Fiber mode', value: sfp.fiber_mode },
    { label: 'TX λ', value: sfp.tx_wavelength, mono: true },
    { label: 'RX λ', value: sfp.rx_wavelength, mono: true },
    {
      label: 'Refreshed',
      value: sfp.last_refresh_at ? formatRelativeTime(sfp.last_refresh_at) : null,
    },
  ].filter(
    (r): r is { label: string; value: string; mono?: boolean } =>
      r.value !== null && r.value !== undefined && r.value !== '',
  );

  return (
    <div className={cn('mt-3 px-3 py-2.5 rounded-lg border', panelCls)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-xs font-semibold font-mono', headerCls)}>{sfp.sfp_id}</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/60 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Grille infos */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-1 min-w-0">
            <span className="text-[11px] text-gray-400 shrink-0 w-20">{r.label}:</span>
            <span
              className={cn('text-[11px] text-gray-700 truncate', r.mono && 'font-mono')}
              title={r.value ?? undefined}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────

export default function LTPortItem({
  port,
  isLocked,
  instanceId,
  accessToken,
  isAdmin,
  onLockToggle,
  sfp,
}: LTPortItemProps) {
  const cfg = useMemo(() => normalizeConfig(port?.config), [port?.config]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sfpExpanded, setSfpExpanded] = useState(false);

  function getPortTypeIcon() {
    const pt = (port.port_type || '').toLowerCase();
    if (pt.includes('xdsl')) return <Zap size={16} className="text-blue-600" />;
    if (pt.includes('ethernet')) return <Cable size={16} className="text-green-600" />;
    if (pt.includes('pon') || pt.includes('ont'))
      return <Radio size={16} className="text-purple-600" />;
    return <Cable size={16} className="text-gray-600" />;
  }

  const adminUp = (port.admin_state || '').toLowerCase() === 'up';
  const portUp = (port.port_state || '').toLowerCase() === 'up';
  const isOnt = (port.port_type || '').toLowerCase() === 'ont';
  const sfpNotEmpty = !!sfp && !sfp.is_empty;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        isLocked ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300',
      )}
    >
      {/* ── Ligne principale ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        {/* Gauche */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-gray-100 border border-gray-200 shrink-0">
            {getPortTypeIcon()}
          </div>

          <div className="min-w-0 flex-1">
            {/* Badges ligne 1 */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-mono font-medium text-gray-900 text-sm">{port.port_id}</span>

              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {port.port_type}
              </span>

              <StatusBadge status={cfg?.status} />

              {/* ONT sernum */}
              {isOnt && cfg?.ont_sernum && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 font-mono">
                  {cfg.ont_sernum}
                </span>
              )}

              {/* ✅ ONT: juste empty/plugged | PON/Eth/...: badge complet */}
              {isOnt ? (
                <ONTPlugBadge plugged={!!sfp && !sfp.is_empty} />
              ) : sfp ? (
                <SFPBadge
                  sfp={sfp}
                  expanded={sfpExpanded}
                  onClick={sfpNotEmpty ? () => setSfpExpanded((v) => !v) : undefined}
                />
              ) : null}
            </div>

            {/* Ligne 2 : états */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
              <StateBadge label="Admin" up={adminUp} value={port.admin_state} />
              <StateBadge label="Port" up={portUp} value={port.port_state} />

              {cfg?.last_device_check_at && (
                <span className="text-gray-400">· synced {formatRelativeTime(cfg.last_device_check_at)}</span>
              )}

              {cfg?.device_vlan_count !== undefined && (
                <span className="text-gray-400">· VLAN {cfg.device_vlan_count}</span>
              )}
            </div>
          </div>
        </div>

        {/* Droite : boutons */}
        <div className="flex items-center gap-2 shrink-0">
          {isLocked && (
            <div className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 border border-orange-200 rounded text-xs font-medium text-orange-700">
              <Lock size={12} />
              Locked
            </div>
          )}

          <button
            onClick={() => setDetailOpen(true)}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
            disabled={!accessToken}
            title={!accessToken ? 'Login required' : 'Open config detail'}
          >
            Details
          </button>

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

      {/* ✅ Panel SFP : jamais sur ONT */}
      {sfpExpanded && sfp && sfpNotEmpty && !isOnt && (
        <SFPPanel sfp={sfp} onClose={() => setSfpExpanded(false)} />
      )}

      {/* Template info */}
      {cfg?.last_template_name && (
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600 flex flex-wrap gap-2">
          <span className="px-2 py-1 rounded bg-gray-100 border border-gray-200 text-gray-700 font-mono">
            {cfg.last_template_name}
          </span>
          {cfg.last_project && (
            <span className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-blue-700 font-medium">
              {cfg.last_project}
            </span>
          )}
          {cfg.last_applied_by && <span className="text-gray-500">by {cfg.last_applied_by}</span>}
          {cfg.last_applied_at && (
            <span className="text-gray-400">· {formatRelativeTime(cfg.last_applied_at)}</span>
          )}
        </div>
      )}

      <PortConfigDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        instanceId={instanceId}
        portId={port.port_id}
        accessToken={accessToken}
        ontSernum={cfg?.ont_sernum || null}
      />
    </div>
  );
}