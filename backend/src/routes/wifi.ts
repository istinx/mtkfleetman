import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { getRouterForTenant, clientFor } from "../db/routers";

export default async function wifiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>("/routers/:id/wifi/clients", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const client = clientFor(router);
    try {
      return await client.getWifiRegistrationTable();
    } catch {
      try {
        return await client.getWirelessRegistrationTable();
      } catch {
        return reply.code(502).send({ error: "Router unreachable or has no wireless capability" });
      }
    }
  });
}
