import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { encryptSecret } from "../utils/crypto";
import { getRouterForTenant, clientFor } from "../db/routers";

interface CreateRouterBody {
  name: string;
  host: string;
  port?: number;
  useTls?: boolean;
  username: string;
  password: string;
  model?: string;
}

interface UpdateRouterBody extends Partial<CreateRouterBody> {
  monitoringEnabled?: boolean;
}

export default async function routerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // List all routers for the caller's tenant
  app.get("/routers", async (req) => {
    const { tenantId } = authUser(req);
    const { rows } = await pool.query(
      `SELECT id, name, host, port, use_tls, model, status, last_seen, monitoring_enabled
       FROM routers WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]
    );
    return rows;
  });

  // Register a new router
  app.post<{ Body: CreateRouterBody }>("/routers", async (req, reply) => {
    const { tenantId, role } = authUser(req);
    if (role === "viewer") return reply.code(403).send({ error: "Forbidden" });

    const { name, host, port = 443, useTls = true, username, password, model } = req.body;
    const passwordEncrypted = encryptSecret(password);

    const { rows } = await pool.query(
      `INSERT INTO routers (tenant_id, name, host, port, use_tls, username, password_encrypted, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, host, port, use_tls, model, status, last_seen`,
      [tenantId, name, host, port, useTls, username, passwordEncrypted, model ?? null]
    );
    return reply.code(201).send(rows[0]);
  });

  // Router detail
  app.get<{ Params: { id: string } }>("/routers/:id", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const { password_encrypted, ...safe } = router;
    return safe;
  });

  // Update router metadata / credentials / monitoring toggle
  app.patch<{ Params: { id: string }; Body: UpdateRouterBody }>(
    "/routers/:id",
    async (req, reply) => {
      if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });

      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const b = req.body;
      if (b.name) { fields.push(`name = $${i++}`); values.push(b.name); }
      if (b.host) { fields.push(`host = $${i++}`); values.push(b.host); }
      if (b.port) { fields.push(`port = $${i++}`); values.push(b.port); }
      if (b.useTls !== undefined) { fields.push(`use_tls = $${i++}`); values.push(b.useTls); }
      if (b.username) { fields.push(`username = $${i++}`); values.push(b.username); }
      if (b.password) { fields.push(`password_encrypted = $${i++}`); values.push(encryptSecret(b.password)); }
      if (b.model !== undefined) { fields.push(`model = $${i++}`); values.push(b.model); }
      if (b.monitoringEnabled !== undefined) { fields.push(`monitoring_enabled = $${i++}`); values.push(b.monitoringEnabled); }
      if (!fields.length) return reply.code(400).send({ error: "No fields to update" });

      values.push(router.id);
      await pool.query(`UPDATE routers SET ${fields.join(", ")} WHERE id = $${i}`, values);
      return { ok: true };
    }
  );

  // Remove a router
  app.delete<{ Params: { id: string } }>("/routers/:id", async (req, reply) => {
    if (authUser(req).role !== "admin") return reply.code(403).send({ error: "Forbidden" });
    await pool.query("DELETE FROM routers WHERE id = $1 AND tenant_id = $2", [
      req.params.id,
      authUser(req).tenantId,
    ]);
    return reply.code(204).send();
  });

  // Why is the status badge warn/down? Cheap enough to compute on click
  // (no live router call) — open to any tenant role, not just admin, since
  // it's just an explanation of a badge already visible to everyone.
  app.get<{ Params: { id: string } }>("/routers/:id/status-reason", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });

    if (router.status === "down") {
      const { rows } = await pool.query(
        `SELECT message, meta, created_at FROM app_log
         WHERE router_id = $1 AND service = 'worker' AND level IN ('warn', 'error')
         ORDER BY created_at DESC LIMIT 5`,
        [router.id]
      );
      return { status: router.status, downInterfaces: [], events: rows };
    }

    if (router.status === "warn") {
      // Same "watched interfaces, else all" rule the poller uses to decide
      // warn in the first place (worker.ts processRouterMetrics) — only the
      // latest sample per interface matters, filtered to the watch list if
      // one is set.
      const { rows } = await pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (interface_name) interface_name, status, time
           FROM interface_metrics WHERE router_id = $1
           ORDER BY interface_name, time DESC
         ), watched AS (
           SELECT interface_name FROM watched_interfaces WHERE router_id = $1
         )
         SELECT latest.interface_name, latest.status, latest.time
         FROM latest
         WHERE latest.status = 'down'
           AND (NOT EXISTS (SELECT 1 FROM watched) OR latest.interface_name IN (SELECT interface_name FROM watched))
         ORDER BY latest.interface_name`,
        [router.id]
      );
      return { status: router.status, downInterfaces: rows, events: [] };
    }

    return { status: router.status, downInterfaces: [], events: [] };
  });

  // On-demand connectivity check against the live router
  app.post<{ Params: { id: string } }>("/routers/:id/test", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    try {
      const resource = await clientFor(router).getSystemResource();
      return { ok: true, resource };
    } catch (err) {
      return reply.code(502).send({ ok: false, error: "Router unreachable" });
    }
  });
}
