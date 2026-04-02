// src/api/ciscoVlanApi.ts

const API_BASE =
  (import.meta as any).env?.VITE_CISCO_API_URL ||
  "http://localhost:8002/api/v1/cisco";

function getToken(): string | null {
  // ✅ Added all auth_ prefixed keys that your app actually uses
  const keys = [
    "auth_access_token", // ← YOUR APP USES THIS ONE
    "auth_token",
    "token",
    "access_token",
    "accessToken",
    "authToken",
    "jwt",
    "jwtToken",
    "jwt_token",
    "bearer",
    "user_token",
    "id_token",
  ];

  // Check localStorage
  for (const key of keys) {
    const val = localStorage.getItem(key);
    if (val) {
      console.log(`[ciscoVlanApi] Found token in localStorage["${key}"]`);
      return val;
    }
  }

  // Check sessionStorage
  for (const key of keys) {
    const val = sessionStorage.getItem(key);
    if (val) {
      console.log(`[ciscoVlanApi] Found token in sessionStorage["${key}"]`);
      return val;
    }
  }

  // Try cookie
  const cookieMatch = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
  if (cookieMatch) {
    console.log("[ciscoVlanApi] Found token in cookie");
    return cookieMatch[1];
  }

  // Try parsing stored objects (auth_user may contain a token)
  const objectKeys = [
    "auth_user", // ← YOUR APP USES THIS ONE
    "user",
    "auth",
    "session",
    "currentUser",
    "userData",
  ];
  for (const key of objectKeys) {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        const t =
          obj.token ||
          obj.access_token ||
          obj.accessToken ||
          obj.auth_access_token ||
          obj.jwt ||
          obj.id_token;
        if (t) {
          console.log(
            `[ciscoVlanApi] Found token inside parsed object "${key}"`,
          );
          return t;
        }
      } catch {
        /* not JSON */
      }
    }
  }

  console.error(
    "[ciscoVlanApi] NO TOKEN FOUND. localStorage keys:",
    Object.keys(localStorage),
    "sessionStorage keys:",
    Object.keys(sessionStorage),
  );
  return null;
}

function headers(): HeadersInit {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handleRes(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || body.message || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ─── Stats ─── */
export async function fetchVlanStats() {
  const res = await fetch(`${API_BASE}/vlan-management/stats`, {
    headers: headers(),
  });
  return handleRes(res);
}

/* ─── VLANs ─── */
export async function fetchVlans(search = "") {
  const url = `${API_BASE}/vlan-management/vlans${
    search ? `?search=${encodeURIComponent(search)}` : ""
  }`;
  const res = await fetch(url, { headers: headers() });
  return handleRes(res);
}

export async function createVlan(data: { vlan_id: number; name: string }) {
  const res = await fetch(`${API_BASE}/vlan-management/vlans`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  return handleRes(res);
}

export async function deleteVlan(dbId: number) {
  const res = await fetch(`${API_BASE}/vlan-management/vlans/${dbId}`, {
    method: "DELETE",
    headers: headers(),
  });
  return handleRes(res);
}

/* ─── Port Assignments ─── */
export async function fetchPorts(search = "") {
  const url = `${API_BASE}/vlan-management/ports${
    search ? `?search=${encodeURIComponent(search)}` : ""
  }`;
  const res = await fetch(url, { headers: headers() });
  return handleRes(res);
}

export interface CreatePortPayload {
  switch_id: number;
  port_id: string;
  mode: "access" | "trunk";
  access_vlan: number;
  trunk_allowed_vlans: number[];
  trunk_native_vlan: number;
  status: string;
  description: string;
}

export async function createPort(data: CreatePortPayload) {
  const res = await fetch(`${API_BASE}/vlan-management/ports`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  return handleRes(res);
}

export interface UpdatePortPayload {
  mode: "access" | "trunk";
  access_vlan?: number;
  trunk_allowed_vlans?: number[];
  trunk_native_vlan?: number;
}

export async function updatePort(dbId: number, data: UpdatePortPayload) {
  const res = await fetch(`${API_BASE}/vlan-management/ports/${dbId}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(data),
  });
  return handleRes(res);
}

export async function deletePort(dbId: number) {
  const res = await fetch(`${API_BASE}/vlan-management/ports/${dbId}`, {
    method: "DELETE",
    headers: headers(),
  });
  return handleRes(res);
}

/* ─── Switches ─── */
export async function fetchSwitches() {
  const res = await fetch(`${API_BASE}/switches`, { headers: headers() });
  return handleRes(res);
}
