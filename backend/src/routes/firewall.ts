import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";

async function audit(tenantId: string, userId: string, routerId: string, action: string, details: unknown) {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, user_id, router_id, action, details) VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, userId, routerId, action, JSON.stringify(details)]
  );
}

export default async function firewallRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>("/routers/:id/firewall/filter", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      return await clientFor(router).getFirewallFilterRules();
    } catch {
      return reply.code(502).send({ error: "Router unreachable" });
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/routers/:id/firewall/filter",
    async (req, reply) => {
      if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      try {
        const created = await clientFor(router).addFirewallFilterRule(req.body);
        await audit(authUser(req).tenantId, authUser(req).userId, router.id, "firewall.rule.create", req.body);
        return reply.code(201).send(created);
      } catch {
        return reply.code(502).send({ error: "Router unreachable or rejected the rule" });
      }
    }
  );

  app.patch<{ Params: { id: string; ruleId: string }; Body: Record<string, unknown> }>(
    "/routers/:id/firewall/filter/:ruleId",
    async (req, reply) => {
      if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      try {
        const updated = await clientFor(router).updateFirewallFilterRule(req.params.ruleId, req.body);
        await audit(authUser(req).tenantId, authUser(req).userId, router.id, "firewall.rule.update", {
          ruleId: req.params.ruleId,
          patch: req.body,
        });
        return updated;
      } catch {
        return reply.code(502).send({ error: "Router unreachable or rejected the update" });
      }
    }
  );

  app.delete<{ Params: { id: string; ruleId: string } }>(
    "/routers/:id/firewall/filter/:ruleId",
    async (req, reply) => {
      if (authUser(req).role !== "admin" && authUser(req).role !== "operator")
        return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      try {
        await clientFor(router).deleteFirewallFilterRule(req.params.ruleId);
        await audit(authUser(req).tenantId, authUser(req).userId, router.id, "firewall.rule.delete", {
          ruleId: req.params.ruleId,
        });
        return reply.code(204).send();
      } catch {
        return reply.code(502).send({ error: "Router unreachable" });
      }
    }
  );
}
