import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant } from "../db/routers";

export default async function watchedInterfacesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>("/routers/:id/watched-interfaces", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const { rows } = await pool.query(
      "SELECT interface_name FROM watched_interfaces WHERE router_id = $1 ORDER BY interface_name",
      [router.id]
    );
    return rows.map((r) => r.interface_name);
  });

  app.post<{ Params: { id: string }; Body: { interfaceName: string } }>(
    "/routers/:id/watched-interfaces",
    async (req, reply) => {
      if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      const { interfaceName } = req.body;
      if (!interfaceName) return reply.code(400).send({ error: "interfaceName required" });
      await pool.query(
        `INSERT INTO watched_interfaces (router_id, interface_name) VALUES ($1,$2)
         ON CONFLICT (router_id, interface_name) DO NOTHING`,
        [router.id, interfaceName]
      );
      return reply.code(201).send({ ok: true });
    }
  );

  app.delete<{ Params: { id: string; name: string } }>(
    "/routers/:id/watched-interfaces/:name",
    async (req, reply) => {
      if (authUser(req).role === "viewer") return reply.code(403).send({ error: "Forbidden" });
      const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
      if (!router) return reply.code(404).send({ error: "Not found" });
      await pool.query(
        "DELETE FROM watched_interfaces WHERE router_id = $1 AND interface_name = $2",
        [router.id, decodeURIComponent(req.params.name)]
      );
      return reply.code(204).send();
    }
  );
}
