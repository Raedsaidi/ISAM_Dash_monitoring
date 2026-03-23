import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthUser, AuthTokens } from "../types/auth";

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;

/* ---------- types ---------- */

interface AuthContextType {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Fetch wrapper: auto-handles 401 → refresh → retry → force logout */
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACCESS_TOKEN_KEY = "auth_access_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";
const USER_KEY = "auth_user";

/* ---------- helpers ---------- */

async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, options);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // no JSON
  }
  if (!res.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      (Array.isArray(data) && data[0]?.msg) ||
      "Erreur inconnue";
    throw new Error(detail);
  }
  return data as T;
}

/** Parse JWT payload to extract expiry timestamp in ms */
function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // malformed
  }
  return null;
}

/* ========== PROVIDER ========== */

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  /* --- state initialised from localStorage for instant hydration --- */
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY),
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(() =>
    localStorage.getItem(REFRESH_TOKEN_KEY),
  );
  const [loading, setLoading] = useState(true);

  /* --- refs to avoid stale closures --- */
  const accessTokenRef = useRef(accessToken);
  const refreshTokenRef = useRef(refreshToken);
  const isRefreshing = useRef(false);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);
  useEffect(() => {
    refreshTokenRef.current = refreshToken;
  }, [refreshToken]);

  /* ---------- persist helpers ---------- */

  const persistAll = useCallback(
    (
      access: string | null,
      refresh: string | null,
      userData: AuthUser | null,
    ) => {
      if (access) localStorage.setItem(ACCESS_TOKEN_KEY, access);
      else localStorage.removeItem(ACCESS_TOKEN_KEY);

      if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
      else localStorage.removeItem(REFRESH_TOKEN_KEY);

      if (userData) localStorage.setItem(USER_KEY, JSON.stringify(userData));
      else localStorage.removeItem(USER_KEY);

      setAccessToken(access);
      setRefreshToken(refresh);
      setUser(userData);
    },
    [],
  );

  /* ---------- force logout (immediate, no redirect needed) ---------- */

  const forceLogout = useCallback(() => {
    // Clear proactive timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    // Fire-and-forget server revoke
    const currentRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (currentRefresh) {
      fetch(`${AUTH_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: currentRefresh }),
      }).catch(() => {});
    }

    // Clear everything → user becomes null → App shows LoginForm
    persistAll(null, null, null);
  }, [persistAll]);

  /* ---------- schedule proactive refresh ---------- */

  const scheduleTokenRefresh = useCallback(
    (token: string) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      const expiryMs = getTokenExpiryMs(token);
      if (!expiryMs) return;

      // Refresh 60s before expiry, minimum 5s
      const msUntilExpiry = expiryMs - Date.now();
      const refreshIn = Math.max(msUntilExpiry - 60_000, 5_000);

      refreshTimerRef.current = setTimeout(() => {
        doRefreshToken();
      }, refreshIn);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ---------- do refresh ---------- */

  const doRefreshToken = useCallback(async (): Promise<string | null> => {
    const currentRefresh =
      refreshTokenRef.current ?? localStorage.getItem(REFRESH_TOKEN_KEY);

    if (!currentRefresh) {
      forceLogout();
      return null;
    }

    try {
      const res = await fetch(`${AUTH_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: currentRefresh }),
      });

      if (!res.ok) {
        // Refresh token invalid / expired → session over
        forceLogout();
        return null;
      }

      const data: AuthTokens = await res.json();

      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);

      scheduleTokenRefresh(data.access_token);

      return data.access_token;
    } catch {
      forceLogout();
      return null;
    }
  }, [forceLogout, scheduleTokenRefresh]);

  // Wire scheduleTokenRefresh to latest doRefreshToken on mount
  useEffect(() => {
    if (accessToken) {
      scheduleTokenRefresh(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doRefreshToken]);

  /** Single-flight refresh: all concurrent callers share one promise */
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (isRefreshing.current && refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    isRefreshing.current = true;
    refreshPromiseRef.current = doRefreshToken().finally(() => {
      isRefreshing.current = false;
      refreshPromiseRef.current = null;
    });

    return refreshPromiseRef.current;
  }, [doRefreshToken]);

  /* ---------- authFetch ---------- */

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      let token =
        accessTokenRef.current ?? localStorage.getItem(ACCESS_TOKEN_KEY);

      if (!token) {
        forceLogout();
        throw new Error("No access token");
      }

      // Pre-check: token already expired? refresh first
      const expiryMs = getTokenExpiryMs(token);
      if (expiryMs && expiryMs <= Date.now()) {
        const newToken = await refreshAccessToken();
        if (!newToken) throw new Error("Session expired");
        token = newToken;
      }

      // Make request
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });

      // 401 → try refresh once, then retry
      if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) throw new Error("Session expired");

        const retryRes = await fetch(url, {
          ...options,
          headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${newToken}`,
          },
        });

        if (retryRes.status === 401) {
          forceLogout();
          throw new Error("Session expired");
        }

        return retryRes;
      }

      return res;
    },
    [forceLogout, refreshAccessToken],
  );

  /* ---------- login ---------- */

  const login = useCallback(
    async (username: string, password: string) => {
      // Clear any leftover session
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      const params = new URLSearchParams();
      params.append("username", username);
      params.append("password", password);

      const tokens = await fetchJson<AuthTokens>(
        `${AUTH_BASE_URL}/api/v1/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        },
      );

      // Fetch profile immediately
      const me = await fetchJson<AuthUser>(`${AUTH_BASE_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      // Persist everything at once
      persistAll(tokens.access_token, tokens.refresh_token, me);

      // Schedule proactive refresh
      scheduleTokenRefresh(tokens.access_token);
    },
    [persistAll, scheduleTokenRefresh],
  );

  /* ---------- logout ---------- */

  const logout = useCallback(async () => {
    forceLogout();
  }, [forceLogout]);

  /* ---------- initial session validation ---------- */

  useEffect(() => {
    async function initAuth() {
      const storedAccess = localStorage.getItem(ACCESS_TOKEN_KEY);
      const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (!storedAccess || !storedRefresh) {
        persistAll(null, null, null);
        setLoading(false);
        return;
      }

      // Check if access token expired
      const expiryMs = getTokenExpiryMs(storedAccess);
      const isExpired = expiryMs ? expiryMs <= Date.now() : false;

      let tokenToUse = storedAccess;

      if (isExpired) {
        try {
          const res = await fetch(`${AUTH_BASE_URL}/api/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: storedRefresh }),
          });

          if (!res.ok) {
            persistAll(null, null, null);
            setLoading(false);
            return;
          }

          const data: AuthTokens = await res.json();
          tokenToUse = data.access_token;
          localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
          setAccessToken(data.access_token);
          setRefreshToken(data.refresh_token);
        } catch {
          persistAll(null, null, null);
          setLoading(false);
          return;
        }
      }

      // Validate with /me
      try {
        const me = await fetchJson<AuthUser>(
          `${AUTH_BASE_URL}/api/v1/auth/me`,
          { headers: { Authorization: `Bearer ${tokenToUse}` } },
        );
        persistAll(tokenToUse, localStorage.getItem(REFRESH_TOKEN_KEY), me);
        scheduleTokenRefresh(tokenToUse);
      } catch {
        persistAll(null, null, null);
      }

      setLoading(false);
    }

    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- cross-tab sync ---------- */

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === ACCESS_TOKEN_KEY && !e.newValue) {
        // Another tab logged out
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
        setAccessToken(null);
        setRefreshToken(null);
        setUser(null);
      }

      if (
        e.key === ACCESS_TOKEN_KEY &&
        e.newValue &&
        e.newValue !== accessTokenRef.current
      ) {
        // Another tab logged in with different account
        window.location.reload();
      }
    }

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  /* ---------- cleanup ---------- */

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  /* ---------- value ---------- */

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      accessToken,
      refreshToken,
      loading,
      login,
      logout,
      authFetch,
    }),
    [user, accessToken, refreshToken, loading, login, logout, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
