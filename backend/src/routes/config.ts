import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";

// Generic escape hatch so the UI can reach any RouterOS menu without a
// dedicated route for every single one (VPN, Queues, Bridge, Scripts,
// Certificates, Container, ...). `path` mirrors the RouterOS REST path,
// e.g. path=/ip/firewall/nat or path=/interface/bridge.
//
// Mutating verbs are restricted to admin/operator and always audited,
// since this route can reach destructive endpoints (e.g. /system/reboot).
export default async function configRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/routers/:id/config",
    async (req, reply) => {
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      if (!req.query.path) return reply.code(400).send({ error: "path query param required" });
      try {
        return await clientFor(router).rawRequest("get", req.query.path);
      } catch {
        return reply.code(502).send({ error: "Router unreachable" });
      }
    }
  );

  app.post<{
    Params: { id: string };
    Body: { path: string; method: "put" | "patch" | "delete"; data?: unknown };
  }>("/routers/:id/config", async (req, reply) => {
    if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const { path, method, data } = req.body;
    if (!path || !method) return reply.code(400).send({ error: "path and method are required" });

    try {
      const result = await clientFor(router).rawRequest(method, path, data);
      await pool.query(
        `INSERT INTO audit_log (tenant_id, user_id, router_id, action, details) VALUES ($1,$2,$3,$4,$5)`,
        [authUser(req).tenantId, authUser(req).userId, router.id, `config.${method}`, JSON.stringify({ path, data })]
      );
      return result;
    } catch {
      return reply.code(502).send({ error: "Router unreachable or rejected the change" });
    }
  });
}
