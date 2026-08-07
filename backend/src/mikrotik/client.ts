import axios, { AxiosInstance } from "axios";
import https from "https";

export interface MikroTikCreds {
  host: string;
  port: number;
  useTls: boolean;
  username: string;
  password: string;
}

// Thin wrapper around RouterOS v7 REST API (/rest/...).
// Docs: https://help.mikrotik.com/docs/display/ROS/REST+API
export class MikroTikClient {
  private http: AxiosInstance;

  constructor(creds: MikroTikCreds) {
    const scheme = creds.useTls ? "https" : "http";
    this.http = axios.create({
      baseURL: `${scheme}://${creds.host}:${creds.port}/rest`,
      auth: { username: creds.username, password: creds.password },
      timeout: 8000,
      // Self-signed certs are common on RouterOS; in production, pin the cert instead.
      httpsAgent: creds.useTls ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    });
  }

  async getSystemResource() {
    const { data } = await this.http.get("/system/resource");
    return data;
  }

  async getInterfaces() {
    const { data } = await this.http.get("/interface");
    return data;
  }

  async getFirewallFilterRules() {
    const { data } = await this.http.get("/ip/firewall/filter");
    return data;
  }

  async addFirewallFilterRule(rule: Record<string, unknown>) {
    const { data } = await this.http.put("/ip/firewall/filter", rule);
    return data;
  }

  async updateFirewallFilterRule(id: string, patch: Record<string, unknown>) {
    const { data } = await this.http.patch(`/ip/firewall/filter/${id}`, patch);
    return data;
  }

  async deleteFirewallFilterRule(id: string) {
    await this.http.delete(`/ip/firewall/filter/${id}`);
  }

  async getDhcpLeases() {
    const { data } = await this.http.get("/ip/dhcp-server/lease");
    return data;
  }

  async getArpTable() {
    const { data } = await this.http.get("/ip/arp");
    return data;
  }

  // Simple queues are useful (some networks already shape per-host) but we
  // no longer require them — kept for anyone who wants to extend this later.
  async getSimpleQueues() {
    const { data } = await this.http.get("/queue/simple");
    return data;
  }

  // Bridge host (FDB) table: which MAC was learned on which physical port.
  // This is what lets us attribute a port's traffic to a single wired
  // client without any Simple Queue configuration.
  async getBridgeHosts() {
    const { data } = await this.http.get("/interface/bridge/host");
    return data;
  }

  // Neighbor discovery (CDP/MNDP) — other MikroTik/switch devices visible
  // on each port. Used to label uplink/trunk ports honestly instead of
  // guessing at per-host traffic on a shared port.
  async getIpNeighbors() {
    const { data } = await this.http.get("/ip/neighbor");
    return data;
  }

  // Connection tracking table, optionally filtered server-side by source
  // address — asking RouterOS to filter is far cheaper than pulling
  // everything and filtering in Node, especially on a router with a large
  // active connection count. When called with no filter (top-destinations
  // view needs the whole table), always restrict to the few fields we
  // actually use via .proplist — full-field serialization of a big
  // conntrack table is what made the old per-channel classification
  // feature slow enough to time out the router's own REST server.
  async getFirewallConnections(srcAddress?: string) {
    const params: Record<string, string> = srcAddress ? { "src-address": srcAddress } : {};
    if (!srcAddress) params[".proplist"] = "src-address,dst-address,dst-port,protocol,orig-bytes,repl-bytes";
    const { data } = await this.http.get("/ip/firewall/connection", { params });
    return data;
  }

  // System log, optionally filtered server-side by topic (e.g. "firewall")
  // — same reasoning as the connection table: let RouterOS do the
  // filtering instead of pulling the whole ring buffer.
  async getLog(topics?: string) {
    const { data } = await this.http.get("/log", { params: topics ? { topics } : undefined });
    return data;
  }

  // IP pools (address ranges) and DHCP servers (which pool each one draws
  // from) — used to compute lease pool utilization on the DHCP tab.
  async getIpPools() {
    const { data } = await this.http.get("/ip/pool");
    return data;
  }

  async getDhcpServers() {
    const { data } = await this.http.get("/ip/dhcp-server");
    return data;
  }

  // CAPsMAN registration table — clients connected to any AP managed by
  // this controller. The exact REST path differs by RouterOS
  // version/package (legacy "caps-man" vs newer "wifi" CAPsMAN), so we try
  // both and use whichever responds.
  async getCapsmanRegistrations() {
    try {
      const { data } = await this.http.get("/caps-man/registration-table");
      return data;
    } catch {
      const { data } = await this.http.get("/interface/wifi/capsman/registration-table");
      return data;
    }
  }

  async getIpAddresses() {
    const { data } = await this.http.get("/ip/address");
    return data;
  }

  // Only static/connected routes — NOT the full table. A router carrying a
  // full or even partial BGP feed can have hundreds of thousands of dynamic
  // routes; asking RouterOS to serialize all of them via REST can crash the
  // request entirely ("Session closed"). We only need static/connected
  // routes anyway for rough traffic classification (default route + VPN
  // routes + local subnets) — BGP-learned specifics don't change that.
  async getRoutes() {
    const { data } = await this.http.get("/ip/route", { params: { dynamic: "false" } });
    return data;
  }

  async getWirelessRegistrationTable() {
    // Wireless package (older AC devices)
    const { data } = await this.http.get("/interface/wireless/registration-table");
    return data;
  }

  async getWifiRegistrationTable() {
    // WiFi package (newer wifiwave2 / wifi, e.g. hAP ax series)
    const { data } = await this.http.get("/interface/wifi/registration-table");
    return data;
  }

  // Generic escape hatch for any RouterOS menu path not wrapped above,
  // e.g. rawRequest('get', '/ip/firewall/nat') or rawRequest('put', '/interface/bridge', {...}).
  async rawRequest(method: "get" | "put" | "patch" | "delete", path: string, body?: unknown) {
    const { data } = await this.http.request({ method, url: path, data: body });
    return data;
  }
}
