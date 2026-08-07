import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";

function ipToLong(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// RouterOS pool "ranges" is a comma-separated list of "start-end" (or a
// single address for a /32). Anything that doesn't parse as a plain IPv4
// range (e.g. a raw CIDR) is skipped rather than guessed at — capacity for
// that segment just won't count toward the total.
function poolCapacity(ranges: string): number {
  let total = 0;
  for (const part of ranges.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const [startStr, endStr] = seg.split("-");
    const start = ipToLong(startStr.trim());
    const end = endStr ? ipToLong(endStr.trim()) : start;
    if (start === null || end === null || end < start) continue;
    total += end - start + 1;
  }
  return total;
}

export default async function dhcpRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>("/routers/:id/dhcp/leases", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      const leases = (await clientFor(router).getDhcpLeases()) as any[];

      // Enrich with "first seen" from our own tracking table (RouterOS
      // leases don't carry this — see worker.ts processDhcpFirstSeen).
      const { rows } = await pool.query(
        "SELECT mac_address, first_seen_at FROM dhcp_first_seen WHERE router_id = $1",
        [router.id]
      );
      const firstSeenByMac = new Map<string, string>(rows.map((r) => [r.mac_address, r.first_seen_at]));

      return leases.map((l) => ({
        ...l,
        "first-seen": firstSeenByMac.get(String(l["mac-address"] ?? "").toUpperCase()) ?? null,
      }));
    } catch {
      return reply.code(502).send({ error: "Router unreachable" });
    }
  });

  // Pool utilization for capacity planning — matches each DHCP server to
  // its address-pool, computes the pool's total capacity from its ranges,
  // and counts currently-bound leases issued by that server.
  app.get<{ Params: { id: string } }>("/routers/:id/dhcp/pool-usage", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      const rc = clientFor(router);
      const [pools, servers, leases] = await Promise.all([rc.getIpPools(), rc.getDhcpServers(), rc.getDhcpLeases()]);
      const poolByName = new Map<string, any>((pools as any[]).map((p) => [p.name, p]));

      const leaseCountByServer = new Map<string, number>();
      for (const l of leases as any[]) {
        if (l.status !== "bound") continue; // only active leases count toward utilization
        const server = l.server ?? "unknown";
        leaseCountByServer.set(server, (leaseCountByServer.get(server) ?? 0) + 1);
      }

      return (servers as any[])
        .filter((s) => s["address-pool"] && s["address-pool"] !== "static-only")
        .map((s) => {
          const p = poolByName.get(s["address-pool"]);
          const capacity = p ? poolCapacity(p.ranges ?? "") : 0;
          const used = leaseCountByServer.get(s.name) ?? 0;
          return {
            server: s.name,
            pool: s["address-pool"],
            ranges: p?.ranges ?? null,
            capacity,
            used,
            percent: capacity > 0 ? Math.round((used / capacity) * 100) : null,
          };
        });
    } catch {
      return reply.code(502).send({ error: "Router unreachable" });
    }
  });

  // Device event feed ("новое устройство в сети" / "устройство пропало"),
  // populated by worker.ts processDhcpFirstSeen — a timeline built from
  // dhcp_first_seen.online transitions instead of a single static column.
  app.get<{ Params: { id: string }; Querystring: { hours?: string; limit?: string } }>(
    "/routers/:id/device-events",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const hours = Number(req.query.hours ?? 24);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const { rows } = await pool.query(
        `SELECT mac_address, ip_address, hostname, event_type, created_at
         FROM device_events
         WHERE router_id = $1 AND created_at > now() - ($2 || ' hours')::interval
         ORDER BY created_at DESC
         LIMIT $3`,
        [router.id, hours, limit]
      );
      return rows;
    }
  );
}
