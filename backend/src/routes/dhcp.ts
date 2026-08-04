import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";

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
}
