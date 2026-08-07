import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";
import { reverseDnsBestEffort } from "../services/reverseDns";

export default async function securityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // "Кто чаще всего ловит блокировки" — aggregated from firewall_log_events,
  // which only fills up once log=yes is set on the relevant drop/reject
  // rules on the router itself (see README/Документация в приложении).
  // Hostname/MAC enrichment is a live DHCP+ARP snapshot, same pattern as the
  // Wi-Fi client detail route.
  app.get<{ Params: { id: string }; Querystring: { hours?: string; limit?: string } }>(
    "/routers/:id/security/top-blocked",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });

      const hours = Number(req.query.hours ?? 24);
      const limit = Math.min(Number(req.query.limit ?? 15), 50);

      const { rows } = await pool.query(
        `SELECT src_ip, COUNT(*) AS hits, MAX(created_at) AS last_seen, MIN(created_at) AS first_seen
         FROM firewall_log_events
         WHERE router_id = $1 AND src_ip IS NOT NULL AND created_at > now() - ($2 || ' hours')::interval
         GROUP BY src_ip
         ORDER BY hits DESC
         LIMIT $3`,
        [router.id, hours, limit]
      );

      if (!rows.length) return { entries: [] };

      const [leasesRes, arpRes] = await Promise.allSettled([
        clientFor(router).getDhcpLeases(),
        clientFor(router).getArpTable(),
      ]);
      const leases = leasesRes.status === "fulfilled" ? (leasesRes.value as any[]) : [];
      const arp = arpRes.status === "fulfilled" ? (arpRes.value as any[]) : [];
      const hostnameByIp = new Map<string, string>();
      for (const l of leases) if (l.address && l["host-name"]) hostnameByIp.set(l.address, l["host-name"]);
      const macByIp = new Map<string, string>();
      for (const a of arp) if (a.address && a["mac-address"]) macByIp.set(a.address, a["mac-address"]);

      return {
        entries: rows.map((r) => ({
          ip: r.src_ip,
          hits: Number(r.hits),
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
          hostname: hostnameByIp.get(r.src_ip) ?? null,
          mac: macByIp.get(r.src_ip) ?? null,
        })),
      };
    }
  );

  // Top destination addresses across ALL clients — a live, on-demand pull of
  // the full connection table (proplist-restricted, see
  // mikrotik/client.ts getFirewallConnections), deliberately NOT part of the
  // background poller. This is the one place the app pulls the whole
  // conntrack table instead of filtering server-side by src-address —
  // acceptable only because it's user-triggered (not repeated every poll
  // cycle) and field-restricted. Can still be slow on a router with a very
  // large active connection count — see README.
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/routers/:id/security/top-destinations",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const limit = Math.min(Number(req.query.limit ?? 20), 50);

      let connections: any[];
      try {
        connections = (await clientFor(router).getFirewallConnections()) as any[];
      } catch {
        return reply.code(502).send({ error: "Router unreachable, or the connection table is too large to fetch" });
      }
      if (!Array.isArray(connections) || !connections.length) return { destinations: [] };

      const [leasesRes, arpRes] = await Promise.allSettled([
        clientFor(router).getDhcpLeases(),
        clientFor(router).getArpTable(),
      ]);
      const leases = leasesRes.status === "fulfilled" ? (leasesRes.value as any[]) : [];
      const arp = arpRes.status === "fulfilled" ? (arpRes.value as any[]) : [];
      const hostnameByIp = new Map<string, string>();
      for (const l of leases) if (l.address && l["host-name"]) hostnameByIp.set(l.address, l["host-name"]);
      const macByIp = new Map<string, string>();
      for (const a of arp) if (a.address && a["mac-address"]) macByIp.set(a.address, a["mac-address"]);

      const byDest = new Map<
        string,
        { port: string | null; protocol: string | null; bytes: number; count: number; bySrc: Map<string, { bytes: number; count: number }> }
      >();
      for (const c of connections) {
        const dstIp = String(c["dst-address"] ?? "");
        const srcIp = String(c["src-address"] ?? "");
        if (!dstIp || !srcIp) continue;
        const bytes = Number(c["orig-bytes"] ?? 0) + Number(c["repl-bytes"] ?? 0);
        const entry = byDest.get(dstIp) ?? { port: c["dst-port"] ?? null, protocol: c.protocol ?? null, bytes: 0, count: 0, bySrc: new Map() };
        entry.bytes += bytes;
        entry.count += 1;
        const srcEntry = entry.bySrc.get(srcIp) ?? { bytes: 0, count: 0 };
        srcEntry.bytes += bytes;
        srcEntry.count += 1;
        entry.bySrc.set(srcIp, srcEntry);
        byDest.set(dstIp, entry);
      }

      const top = [...byDest.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit);

      // Reverse-DNS only the addresses we're actually returning, in
      // parallel — bounded by `limit`, each lookup capped at 700ms
      // (reverseDnsBestEffort), so worst case is ~0.7s total, not per-address.
      const destinations = await Promise.all(
        top.map(async ([ip, info]) => ({
          ip,
          hostname: await reverseDnsBestEffort(ip),
          port: info.port,
          protocol: info.protocol,
          bytes: info.bytes,
          connections: info.count,
          sources: [...info.bySrc.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([srcIp, s]) => ({
              ip: srcIp,
              hostname: hostnameByIp.get(srcIp) ?? null,
              mac: macByIp.get(srcIp) ?? null,
              bytes: s.bytes,
              connections: s.count,
            })),
        }))
      );

      return { destinations };
    }
  );
}
