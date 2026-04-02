const BASE = import.meta.env.VITE_CISCO_BASE_URL ?? "http://localhost:8002";
const PREFIX = `${BASE}/api/v1/cisco/switches`;

// ═══════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════

export interface CiscoSwitch {
  id: number;
  name: string;
  host: string;
  ssh_port: number;
  telnet_port: number;
  protocol_preference: string;
  username: string;
  status: string;
  health_protocol_used: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  device_hostname: string | null;
  device_model: string | null;
  ios_version: string | null;
  serial_number: string | null;
  cache_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSwitchPayload {
  name: string;
  host: string;
  telnet_port?: number;
  ssh_port?: number;
  protocol_preference?: string;
  username: string;
  password: string;
  enable_password?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  protocol_used: string | null;
  status: string;
  message: string;
  response_time_ms: number | null;
  last_error: string | null;
  device_info: {
    hostname: string | null;
    model: string | null;
    ios_version: string | null;
    serial_number: string | null;
  } | null;
}

export interface InterfaceInfo {
  name: string;
  status: string;
  protocol: string;
  ip_address: string | null;
}

export interface VlanInfo {
  id: number;
  name: string;
  status: string;
  ports: string[];
}

interface SwitchListResponse {
  switches: CiscoSwitch[];
  total: number;
}

interface InterfacesApiResponse {
  success: boolean;
  interfaces: InterfaceInfo[];
  total: number;
  protocol_used: string | null;
  error: string | null;
  cached_at: string | null;
}

interface VlansApiResponse {
  success: boolean;
  vlans: VlanInfo[];
  total: number;
  protocol_used: string | null;
  error: string | null;
  cached_at: string | null;
}

interface DeviceInfoApiResponse {
  success: boolean;
  hostname: string | null;
  model: string | null;
  ios_version: string | null;
  serial_number: string | null;
  uptime: string | null;
  raw_output: string | null;
  protocol_used: string | null;
  error: string | null;
}

// ═══════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* no json */
  }

  if (!res.ok) {
    const detail =
      body?.detail ||
      body?.message ||
      (Array.isArray(body) && body[0]?.msg) ||
      `HTTP ${res.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }

  return body as T;
}

// ═══════════════════════════════════════════════════════
//  API Calls
// ═══════════════════════════════════════════════════════

export async function fetchCiscoSwitches(
  token: string | null,
): Promise<CiscoSwitch[]> {
  const res = await fetch(PREFIX, { headers: authHeaders(token) });
  const data = await handleResponse<SwitchListResponse>(res);
  return data.switches;
}

export async function createCiscoSwitch(
  payload: CreateSwitchPayload,
  token: string | null,
): Promise<CiscoSwitch> {
  const res = await fetch(PREFIX, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<CiscoSwitch>(res);
}

export async function deleteCiscoSwitch(
  id: number,
  token: string | null,
): Promise<void> {
  const res = await fetch(`${PREFIX}/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* 204 has no body */
    }
    throw new Error(body?.detail || `HTTP ${res.status}`);
  }
}

export async function testCiscoConnection(
  id: number,
  token: string | null,
): Promise<TestConnectionResponse> {
  const res = await fetch(`${PREFIX}/${id}/test-connection`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<TestConnectionResponse>(res);
}

export async function getCiscoDeviceInfo(
  id: number,
  token: string | null,
): Promise<DeviceInfoApiResponse> {
  const res = await fetch(`${PREFIX}/${id}/device-info`, {
    headers: authHeaders(token),
  });
  return handleResponse<DeviceInfoApiResponse>(res);
}

export async function getCiscoInterfaces(
  id: number,
  token: string | null,
): Promise<InterfacesApiResponse> {
  const res = await fetch(`${PREFIX}/${id}/interfaces`, {
    headers: authHeaders(token),
  });
  return handleResponse<InterfacesApiResponse>(res);
}

export async function getCiscoVlans(
  id: number,
  token: string | null,
): Promise<VlansApiResponse> {
  const res = await fetch(`${PREFIX}/${id}/vlans`, {
    headers: authHeaders(token),
  });
  return handleResponse<VlansApiResponse>(res);
}
// ═══════════════════════════════════════════════════════
//  Port Management
// ═══════════════════════════════════════════════════════

export interface CiscoPortInfo {
  port_label: string;
  port_number: number;
  description: string;
  status: string;
  vlan: string;
  duplex: string;
  speed: string;
  port_type: string;
  mac_address: string | null;
  locked: boolean;
}

interface PortStatusApiResponse {
  success: boolean;
  switch_id: number;
  port_count: number;
  ports: CiscoPortInfo[];
  protocol_used: string | null;
  error: string | null;
}

interface PortLockToggleApiResponse {
  success: boolean;
  port_label: string;
  locked: boolean;
  message: string;
}

interface BulkLockApiResponse {
  success: boolean;
  affected: number;
  message: string;
}

export interface VlanChangePayload {
  port_label: string;
  new_vlan: string;
  vlan_type: string;
  description?: string;
}

interface VlanChangeApiResponse {
  success: boolean;
  output: string | null;
  current_vlan: string | null;
  protocol_used: string | null;
  error: string | null;
}

export async function fetchPortStatus(
  switchId: number,
  token: string | null,
): Promise<PortStatusApiResponse> {
  const res = await fetch(`${PREFIX}/${switchId}/port-status`, {
    headers: authHeaders(token),
  });
  return handleResponse<PortStatusApiResponse>(res);
}

export async function togglePortLock(
  switchId: number,
  portLabel: string,
  token: string | null,
): Promise<PortLockToggleApiResponse> {
  const res = await fetch(
    `${PREFIX}/${switchId}/ports/${encodeURIComponent(portLabel)}/toggle-lock`,
    { method: "POST", headers: authHeaders(token) },
  );
  return handleResponse<PortLockToggleApiResponse>(res);
}

export async function bulkLockPorts(
  switchId: number,
  token: string | null,
): Promise<BulkLockApiResponse> {
  const res = await fetch(`${PREFIX}/${switchId}/bulk-lock`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<BulkLockApiResponse>(res);
}

export async function bulkUnlockPorts(
  switchId: number,
  token: string | null,
): Promise<BulkLockApiResponse> {
  const res = await fetch(`${PREFIX}/${switchId}/bulk-unlock`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<BulkLockApiResponse>(res);
}

export async function changePortVlan(
  switchId: number,
  payload: VlanChangePayload,
  token: string | null,
): Promise<VlanChangeApiResponse> {
  const res = await fetch(`${PREFIX}/${switchId}/change-vlan`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<VlanChangeApiResponse>(res);
}
