import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";
import { parseUptime } from "../mikrotik/parse";
import { getVendorForMac } from "../services/macVendor";
import { logEvent } from "../logging/dbLog";

export default async function clientsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Wi-Fi top consumers (CAPsMAN registration table, keyed by MAC).
  app.get<{ Params: { id: string }; Querystring: { hours?: string; limit?: string } }>(
    "/routers/:id/clients/wifi/top",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });

      const hours = Number(req.query.hours ?? 24);
      const limit = Math.min(Number(req.query.limit ?? 15), 50);

      const { rows: latest } = await pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (mac_address)
             mac_address, ip_address, hostname, ap_identity, ssid, rx_signal, rx_bps, tx_bps, rx_pps, tx_pps, time
           FROM wifi_client_metrics
           WHERE router_id = $1
           ORDER BY mac_address, time DESC
         )
         SELECT * FROM latest ORDER BY (rx_bps + tx_bps) DESC LIMIT $2`,
        [router.id, limit]
      );

      if (!latest.length) return [];

      const macs = latest.map((r) => r.mac_address);
      const { rows: series } = await pool.query(
        `SELECT mac_address, time, rx_bps, tx_bps, rx_pps, tx_pps
         FROM wifi_client_metrics
         WHERE router_id = $1 AND mac_address = ANY($2) AND time > now() - ($3 || ' hours')::interval
         ORDER BY time ASC`,
        [router.id, macs, hours]
      );

      const seriesByMac = new Map<string, { time: string; rx_bps: number; tx_bps: number; rx_pps: number; tx_pps: number }[]>();
      for (const row of series) {
        if (!seriesByMac.has(row.mac_address)) seriesByMac.set(row.mac_address, []);
        seriesByMac.get(row.mac_address)!.push({ time: row.time, rx_bps: row.rx_bps, tx_bps: row.tx_bps, rx_pps: row.rx_pps, tx_pps: row.tx_pps });
      }

      return latest.map((r) => ({
        key: r.mac_address,
        mac: r.mac_address,
        ip: r.ip_address,
        hostname: r.hostname,
        ap: r.ap_identity,
        ssid: r.ssid,
        signal: r.rx_signal,
        latest: { rx_bps: r.rx_bps, tx_bps: r.tx_bps, rx_pps: r.rx_pps, tx_pps: r.tx_pps, time: r.time },
        series: seriesByMac.get(r.mac_address) ?? [],
      }));
    }
  );

  // Ethernet top consumers (bridge host table + neighbor discovery, no
  // Simple Queue required — see worker.ts processEthernetClients for how
  // confidence is determined).
  app.get<{ Params: { id: string }; Querystring: { hours?: string; limit?: string } }>(
    "/routers/:id/clients/ethernet/top",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });

      const hours = Number(req.query.hours ?? 24);
      const limit = Math.min(Number(req.query.limit ?? 15), 50);

      const { rows: latest } = await pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (client_key)
             client_key, mac_address, ip_address, hostname, port_name, neighbor_identity, confidence, host_count, rx_bps, tx_bps, time
           FROM ethernet_client_metrics
           WHERE router_id = $1
           ORDER BY client_key, time DESC
         )
         SELECT * FROM latest ORDER BY (rx_bps + tx_bps) DESC LIMIT $2`,
        [router.id, limit]
      );

      if (!latest.length) return [];

      const keys = latest.map((r) => r.client_key);
      const { rows: series } = await pool.query(
        `SELECT client_key, time, rx_bps, tx_bps
         FROM ethernet_client_metrics
         WHERE router_id = $1 AND client_key = ANY($2) AND time > now() - ($3 || ' hours')::interval
         ORDER BY time ASC`,
        [router.id, keys, hours]
      );

      const seriesByKey = new Map<string, { time: string; rx_bps: number; tx_bps: number }[]>();
      for (const row of series) {
        if (!seriesByKey.has(row.client_key)) seriesByKey.set(row.client_key, []);
        seriesByKey.get(row.client_key)!.push({ time: row.time, rx_bps: row.rx_bps, tx_bps: row.tx_bps });
      }

      return latest.map((r) => ({
        key: r.client_key,
        mac: r.mac_address,
        ip: r.ip_address,
        hostname: r.hostname,
        port: r.port_name,
        neighborIdentity: r.neighbor_identity,
        confidence: r.confidence,
        hostCount: r.host_count,
        latest: { rx_bps: r.rx_bps, tx_bps: r.tx_bps, time: r.time },
        series: seriesByKey.get(r.client_key) ?? [],
      }));
    }
  );

  // Client detail drill-down: live registration snapshot (signal, PHY
  // rate, connected-since), vendor by MAC OUI, and a "where does it go"
  // breakdown from the connection-tracking table. Everything here is a
  // live hit to the router (except the historical chart), so it's only
  // fetched when the user actually opens this view — not on every poll.
  app.get<{ Params: { id: string; mac: string }; Querystring: { hours?: string } }>(
    "/routers/:id/clients/wifi/:mac/detail",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const mac = req.params.mac.toUpperCase();
      const hours = Number(req.query.hours ?? 24);
      const rc = clientFor(router);

      // Find the live registration entry for this mac. Run every source in
      // parallel (CAPsMAN, local wifi, local wireless, DHCP, ARP) instead
      // of trying them one after another — sequential fallbacks each
      // waiting out their own timeout is what made this view feel like it
      // hangs on a slow/unreachable router.
      const [capsRes, wifiRes, wirelessRes, leasesRes, arpRes] = await Promise.allSettled([
        rc.getCapsmanRegistrations(),
        rc.getWifiRegistrationTable(),
        rc.getWirelessRegistrationTable(),
        rc.getDhcpLeases(),
        rc.getArpTable(),
      ]);

      function findByMac(res: PromiseSettledResult<any>): any | null {
        if (res.status !== "fulfilled" || !Array.isArray(res.value)) return null;
        return res.value.find((r: any) => String(r["mac-address"] ?? "").toUpperCase() === mac) ?? null;
      }
      const reg = findByMac(capsRes) ?? findByMac(wifiRes) ?? findByMac(wirelessRes);
      const leases = leasesRes.status === "fulfilled" ? leasesRes.value : [];
      const arp = arpRes.status === "fulfilled" ? arpRes.value : [];

      for (const [label, res] of [
        ["CAPsMAN", capsRes], ["local wifi", wifiRes], ["local wireless", wirelessRes],
        ["DHCP", leasesRes], ["ARP", arpRes],
      ] as const) {
        if (res.status === "rejected") {
          await logEvent("api", "warn", `Client detail: ${label} lookup failed for ${mac} on "${router.name}"`, {
            error: (res.reason as any)?.message ?? String(res.reason),
          }, router.id);
        }
      }

      const lease = (leases as any[]).find((l) => String(l["mac-address"] ?? "").toUpperCase() === mac);
      const arpEntry = (arp as any[]).find((a) => String(a["mac-address"] ?? "").toUpperCase() === mac);
      const ip = reg?.["last-ip"] || lease?.address || arpEntry?.address || null;

      const connectedSinceSeconds = reg?.uptime ? parseUptime(reg.uptime) : null;
      const connectedSince = connectedSinceSeconds !== null ? new Date(Date.now() - connectedSinceSeconds * 1000) : null;
      const vendor = await getVendorForMac(mac);

      // Top destinations: cheap because RouterOS filters server-side by
      // src-address (we're not pulling the whole conntrack table), and
      // there's no route-table lookup here — just address/port/bytes.
      let topDestinations: any[] = [];
      if (ip) {
        try {
          const connections = (await rc.getFirewallConnections(ip)) as any[];
          const byDest = new Map<string, { port: string | null; protocol: string | null; bytes: number; count: number }>();
          for (const c of connections) {
            const dstIp = String(c["dst-address"] ?? "");
            if (!dstIp) continue;
            const bytes = Number(c["orig-bytes"] ?? 0) + Number(c["repl-bytes"] ?? 0);
            const entry = byDest.get(dstIp) ?? { port: c["dst-port"] ?? null, protocol: c.protocol ?? null, bytes: 0, count: 0 };
            entry.bytes += bytes;
            entry.count += 1;
            byDest.set(dstIp, entry);
          }
          topDestinations = [...byDest.entries()]
            .sort((a, b) => b[1].bytes - a[1].bytes || b[1].count - a[1].count)
            .slice(0, 10)
            .map(([dstIp, info]) => ({ ip: dstIp, port: info.port, protocol: info.protocol, bytes: info.bytes, connections: info.count }));
        } catch (err: any) {
          await logEvent("api", "warn", `Client detail: connection lookup failed for ${mac} on "${router.name}"`, {
            error: err?.message ?? String(err),
          }, router.id);
        }
      }

      const { rows: series } = await pool.query(
        `SELECT time, rx_bps, tx_bps, rx_pps, tx_pps FROM wifi_client_metrics
         WHERE router_id = $1 AND mac_address = $2 AND time > now() - ($3 || ' hours')::interval
         ORDER BY time ASC`,
        [router.id, mac, hours]
      );

      // Cross-reference: when did DHCP first see this device, vs. when did
      // it actually start generating measurable Wi-Fi traffic?
      const { rows: firstSeenRows } = await pool.query(
        "SELECT first_seen_at FROM dhcp_first_seen WHERE router_id = $1 AND mac_address = $2",
        [router.id, mac]
      );
      const { rows: firstTrafficRows } = await pool.query(
        `SELECT MIN(time) AS first_traffic FROM wifi_client_metrics
         WHERE router_id = $1 AND mac_address = $2 AND (rx_bps > 0 OR tx_bps > 0)`,
        [router.id, mac]
      );

      return {
        mac,
        ip,
        hostname: lease?.["host-name"] ?? null,
        vendor,
        ssid: reg?.ssid ?? null,
        apOrInterface: reg?.["remote-cap-identity"] ?? reg?.ap ?? reg?.interface ?? null,
        signal: reg?.["rx-signal"] ?? reg?.["signal-strength"] ?? null,
        txRate: reg?.["tx-rate"] ?? null,
        rxRate: reg?.["rx-rate"] ?? null,
        connectedSince,
        firstSeenDhcp: firstSeenRows[0]?.first_seen_at ?? null,
        firstTrafficAt: firstTrafficRows[0]?.first_traffic ?? null,
        online: !!reg,
        topDestinations,
        series,
      };
    }
  );
}
