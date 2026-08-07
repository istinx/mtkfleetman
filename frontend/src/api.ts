import axios from "axios";

// Resolved at runtime from the page's own address, not baked in at build
// time — otherwise "localhost" in the bundle would mean the visitor's own
// machine, not wherever this is actually deployed. Set VITE_API_URL at
// build time only if the API lives on a different host/port than "same
// host, port 3000" (e.g. behind a reverse proxy with a custom domain).
function resolveApiUrl(): string {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit) return explicit;
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

const API_URL = resolveApiUrl();

export function getTerminalWsUrl(routerId: string): string {
  const token = localStorage.getItem("token") ?? "";
  const wsBase = API_URL.replace(/^http/, "ws");
  return `${wsBase}/routers/${routerId}/terminal?token=${encodeURIComponent(token)}`;
}

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export interface RouterSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  model: string | null;
  status: "up" | "warn" | "down" | "unknown";
  last_seen: string | null;
  monitoring_enabled: boolean;
}

export async function login(username: string, password: string) {
  const { data } = await api.post("/auth/login", { username, password });
  localStorage.setItem("token", data.token);
  return data.token as string;
}

export async function listRouters() {
  const { data } = await api.get<RouterSummary[]>("/routers");
  return data;
}

export async function createRouter(payload: {
  name: string;
  host: string;
  port?: number;
  useTls?: boolean;
  username: string;
  password: string;
  model?: string;
}) {
  const { data } = await api.post<RouterSummary>("/routers", payload);
  return data;
}

export async function testRouter(id: string) {
  const { data } = await api.post(`/routers/${id}/test`);
  return data;
}

export interface RouterDetailFull extends RouterSummary {
  username: string;
}

export async function getRouter(id: string) {
  const { data } = await api.get<RouterDetailFull>(`/routers/${id}`);
  return data;
}

export interface RouterStatusReason {
  status: string;
  downInterfaces: { interface_name: string; status: string; time: string }[];
  events: { message: string; meta: unknown; created_at: string }[];
}

export async function getRouterStatusReason(id: string) {
  const { data } = await api.get<RouterStatusReason>(`/routers/${id}/status-reason`);
  return data;
}

export async function updateRouter(id: string, payload: {
  name?: string;
  host?: string;
  port?: number;
  useTls?: boolean;
  username?: string;
  password?: string;
  model?: string;
  monitoringEnabled?: boolean;
}) {
  const { data } = await api.patch(`/routers/${id}`, payload);
  return data;
}

export async function deleteRouter(id: string) {
  await api.delete(`/routers/${id}`);
}

export async function getMetrics(id: string, hours = 24) {
  const { data } = await api.get(`/routers/${id}/metrics`, { params: { hours } });
  return data as { time: string; cpu_load: number; memory_used: number; memory_total: number }[];
}

export async function getInterfaceMetrics(id: string, hours = 24) {
  const { data } = await api.get(`/routers/${id}/interface-metrics`, { params: { hours } });
  return data as { time: string; interface_name: string; status: string; rx_bps: number; tx_bps: number }[];
}

export async function getLiveInterfaces(id: string) {
  const { data } = await api.get(`/routers/${id}/interfaces`);
  return data as any[];
}

export async function getLatestInterfaceMetrics(id: string) {
  const { data } = await api.get(`/routers/${id}/interfaces/latest`);
  return data as { interface_name: string; status: string; rx_bps: number; tx_bps: number; time: string }[];
}

export async function getIpAddresses(id: string) {
  const { data } = await api.get(`/routers/${id}/ip-addresses`);
  return data as { interface: string; address: string }[];
}

export interface WifiTopClient {
  key: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  ap: string | null;
  ssid: string | null;
  signal: number | null;
  avgBps: number;
  peakBps: number;
  latest: { rx_bps: number; tx_bps: number; rx_pps: number | null; tx_pps: number | null; time: string };
  series: { time: string; rx_bps: number; tx_bps: number; rx_pps: number | null; tx_pps: number | null }[];
}

export interface WifiTopClientsResponse {
  clients: WifiTopClient[];
  peakTotalBps: number;
}

export async function getTopWifiClients(id: string, hours = 24, limit = 15) {
  const { data } = await api.get<WifiTopClientsResponse>(`/routers/${id}/clients/wifi/top`, { params: { hours, limit } });
  return data;
}

export interface ClientDestination {
  ip: string;
  port: string | null;
  protocol: string | null;
  bytes: number;
  connections: number;
}

export interface ClientDetail {
  mac: string;
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  ssid: string | null;
  apOrInterface: string | null;
  signal: string | number | null;
  txRate: string | null;
  rxRate: string | null;
  connectedSince: string | null;
  firstSeenDhcp: string | null;
  firstTrafficAt: string | null;
  online: boolean;
  topDestinations: ClientDestination[];
  series: { time: string; rx_bps: number; tx_bps: number; rx_pps: number | null; tx_pps: number | null }[];
}

export async function getWifiClientDetail(routerId: string, mac: string, hours = 24) {
  const { data } = await api.get<ClientDetail>(`/routers/${routerId}/clients/wifi/${encodeURIComponent(mac)}/detail`, {
    params: { hours },
  });
  return data;
}

export interface EthernetTopClient {
  key: string;
  mac: string | null;
  ip: string | null;
  hostname: string | null;
  port: string | null;
  neighborIdentity: string | null;
  confidence: "exact" | "shared" | "neighbor";
  hostCount: number | null;
  latest: { rx_bps: number; tx_bps: number; time: string };
  series: { time: string; rx_bps: number; tx_bps: number }[];
}

export async function getTopEthernetClients(id: string, hours = 24, limit = 15) {
  const { data } = await api.get<EthernetTopClient[]>(`/routers/${id}/clients/ethernet/top`, { params: { hours, limit } });
  return data;
}

export interface EthernetDestinations {
  ip: string | null;
  topDestinations: ClientDestination[];
}

export async function getEthernetClientDestinations(routerId: string, mac: string) {
  const { data } = await api.get<EthernetDestinations>(
    `/routers/${routerId}/clients/ethernet/${encodeURIComponent(mac)}/destinations`
  );
  return data;
}

export interface Me {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
}

export async function getMe() {
  const { data } = await api.get<Me>("/me");
  return data;
}

export async function changeMyPassword(currentPassword: string, newPassword: string) {
  await api.patch("/me/password", { currentPassword, newPassword });
}

export interface TenantUser {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  created_at: string;
}

export async function listUsers() {
  const { data } = await api.get<TenantUser[]>("/users");
  return data;
}

export async function createUser(payload: { username: string; password: string; role: string }) {
  const { data } = await api.post<TenantUser>("/users", payload);
  return data;
}

export async function updateUser(id: string, payload: { username?: string; role?: string; password?: string }) {
  await api.patch(`/users/${id}`, payload);
}

export async function deleteUser(id: string) {
  await api.delete(`/users/${id}`);
}

export async function getFirewallRules(id: string) {
  const { data } = await api.get(`/routers/${id}/firewall/filter`);
  return data as any[];
}

export async function getDhcpLeases(id: string) {
  const { data } = await api.get(`/routers/${id}/dhcp/leases`);
  return data as any[];
}

export interface DhcpPoolUsage {
  server: string;
  pool: string;
  ranges: string | null;
  capacity: number;
  used: number;
  percent: number | null;
}

export async function getDhcpPoolUsage(id: string) {
  const { data } = await api.get<DhcpPoolUsage[]>(`/routers/${id}/dhcp/pool-usage`);
  return data;
}

export interface DeviceEvent {
  mac_address: string;
  ip_address: string | null;
  hostname: string | null;
  event_type: "online" | "offline";
  created_at: string;
}

export async function getDeviceEvents(id: string, hours = 24, limit = 50) {
  const { data } = await api.get<DeviceEvent[]>(`/routers/${id}/device-events`, { params: { hours, limit } });
  return data;
}

export interface TopBlockedEntry {
  ip: string;
  hits: number;
  firstSeen: string;
  lastSeen: string;
  hostname: string | null;
  mac: string | null;
}

export async function getTopBlocked(id: string, hours = 24, limit = 15) {
  const { data } = await api.get<{ entries: TopBlockedEntry[] }>(`/routers/${id}/security/top-blocked`, {
    params: { hours, limit },
  });
  return data.entries;
}

export interface TopDestinationSource {
  ip: string;
  hostname: string | null;
  mac: string | null;
  bytes: number;
  connections: number;
}

export interface TopDestination {
  ip: string;
  hostname: string | null;
  port: string | null;
  protocol: string | null;
  bytes: number;
  connections: number;
  sources: TopDestinationSource[];
}

export async function getTopDestinations(id: string, limit = 20) {
  const { data } = await api.get<{ destinations: TopDestination[] }>(`/routers/${id}/security/top-destinations`, {
    params: { limit },
  });
  return data.destinations;
}

export async function getWifiClients(id: string) {
  const { data } = await api.get(`/routers/${id}/wifi/clients`);
  return data as any[];
}

export async function getWatchedInterfaces(id: string) {
  const { data } = await api.get<string[]>(`/routers/${id}/watched-interfaces`);
  return data;
}

export async function watchInterface(id: string, interfaceName: string) {
  await api.post(`/routers/${id}/watched-interfaces`, { interfaceName });
}

export async function unwatchInterface(id: string, interfaceName: string) {
  await api.delete(`/routers/${id}/watched-interfaces/${encodeURIComponent(interfaceName)}`);
}

export async function getConfig(id: string, path: string) {
  const { data } = await api.get(`/routers/${id}/config`, { params: { path } });
  return data;
}

export async function postConfig(id: string, path: string, method: "put" | "patch" | "delete", body?: unknown) {
  const { data } = await api.post(`/routers/${id}/config`, { path, method, data: body });
  return data;
}

export interface LogEntry {
  id: number;
  service: "api" | "worker";
  level: "info" | "warn" | "error";
  message: string;
  meta: unknown;
  router_id: string | null;
  created_at: string;
}

export async function getLogs(params: { service?: string; level?: string; limit?: number } = {}) {
  const { data } = await api.get<LogEntry[]>("/logs", { params });
  return data;
}

export interface TopologyNeighbor {
  identity: string | null;
  platform: string | null;
  address: string | null;
  interface: string | null;
  reachable: boolean | null;
}
export interface TopologyProblem {
  severity: "warn" | "error";
  message: string;
}
export interface TopologyNode {
  id: string;
  type: "cloud" | "ap" | "client-wifi" | "client-wired" | "switch";
  label: string;
  sub: string;
  problem: string | null;
  meta: Record<string, string | number | null>;
}
export interface TopologyApNode extends TopologyNode {
  children: TopologyNode[];
}
export interface Topology {
  self: { name: string; host: string; status: string };
  problems: TopologyProblem[];
  channels: TopologyNode[];
  aps: TopologyApNode[];
  wiredDevices: TopologyNode[];
  wiredSwitches: TopologyNode[];
  neighbors: TopologyNeighbor[];
}

export async function getTopology(routerId: string) {
  const { data } = await api.get<Topology>(`/routers/${routerId}/topology`);
  return data;
}

export interface NetworkMapRouterNode {
  id: string;
  type: "router";
  label: string;
  sub: string;
  status: "up" | "warn" | "down" | "unknown";
  meta: Record<string, unknown>;
}
export interface NetworkMapUnknownNode {
  id: string;
  type: "unknown";
  label: string;
  sub: string;
  meta: Record<string, unknown>;
}
export type NetworkMapNode = NetworkMapRouterNode | NetworkMapUnknownNode;
export interface NetworkMapEdge {
  id: string;
  from: string;
  to: string;
  fromInterface: string | null;
  label: string | null;
}
export interface NetworkMapWarning {
  routerId: string;
  routerName: string;
  message: string;
}
export interface NetworkMap {
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
  warnings: NetworkMapWarning[];
}

export async function getNetworkMap() {
  const { data } = await api.get<NetworkMap>("/network-map");
  return data;
}
