import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";

export default async function monitoringRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Historical system metrics (CPU/memory) for charts
  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>(
    "/routers/:id/metrics",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const hours = Number(req.query.hours ?? 24);
      const { rows } = await pool.query(
        `SELECT time, cpu_load, memory_used, memory_total, uptime_seconds
         FROM router_metrics
         WHERE router_id = $1 AND time > now() - ($2 || ' hours')::interval
         ORDER BY time ASC`,
        [router.id, hours]
      );
      return rows;
    }
  );

  // Historical per-interface throughput for charts
  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>(
    "/routers/:id/interface-metrics",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const hours = Number(req.query.hours ?? 24);
      const { rows } = await pool.query(
        `SELECT time, interface_name, status, rx_bps, tx_bps
         FROM interface_metrics
         WHERE router_id = $1 AND time > now() - ($2 || ' hours')::interval
         ORDER BY time ASC`,
        [router.id, hours]
      );
      return rows;
    }
  );

  // IP addresses per interface, so the UI can label each traffic card.
  app.get<{ Params: { id: string } }>("/routers/:id/ip-addresses", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      return await clientFor(router).getIpAddresses();
    } catch {
      return reply.code(502).send({ error: "Router unreachable" });
    }
  });

  // Latest computed rx/tx bps per interface (derived by the worker from
  // byte-counter deltas — /interface itself has no live rate field).
  app.get<{ Params: { id: string } }>("/routers/:id/interfaces/latest", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (interface_name) interface_name, status, rx_bps, tx_bps, time
       FROM interface_metrics WHERE router_id = $1 ORDER BY interface_name, time DESC`,
      [router.id]
    );
    return rows;
  });

  // Live interface list straight from the router (status, MTU, etc.)
  app.get<{ Params: { id: string } }>("/routers/:id/interfaces", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      const interfaces = await clientFor(router).getInterfaces();
      return interfaces;
    } catch {
      return reply.code(502).send({ error: "Router unreachable" });
    }
  });
}
