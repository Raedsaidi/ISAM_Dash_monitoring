export interface Junction {
  id: string;
  name: string;
  type: "tcp" | "ssl" | "mutual";
  backendServer: string;
  port: number;
  status: "active" | "inactive" | "error";
  healthCheck: boolean;
  lastChecked: string;
  responseTime: number;
}

export interface ReverseProxyInstance {
  id: string;
  name: string;
  hostname: string;
  port: number;
  status: "running" | "stopped" | "warning";
  junctions: Junction[];
  sslEnabled: boolean;
  httpEnabled: boolean;
  lastRestart: string;
  uptime: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  resource: string;
  result: "success" | "failure" | "warning";
  details: string;
  ipAddress: string;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  activeConnections: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  errorRate: number;
  uptime: string;
}

export type NavSection =
  | "overview"
  | "junctions"
  | "audit-logs"
  | "user-management"
  | "wan-templates"
  | "my-templates"
  | "switch-management"
  | "port-management"
  | "vlan-management";
