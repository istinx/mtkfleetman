import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { getRouterForTenant, clientFor } from "../db/routers";

export default async function wifiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: { id: string } }>("/routers/:id/wifi/clients", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const client = clientFor(router);

    // Same source order as the Топ Wi-Fi poller (worker.ts processWifiClients):
    // CAPsMAN first — a router managed by a CAPsMAN controller has no entries
    // in its own local registration table, so skipping this source is why
    // this tab used to show "no clients" while Топ Wi-Fi had data.
    let registrations: any[] | null = null;
    try {
      const caps = await client.getCapsmanRegistrations();
      if (Array.isArray(caps) && caps.length) registrations = caps;
    } catch {
      /* fall through to local wifi/wireless */
    }
    if (!registrations) {
      try {
        registrations = await client.getWifiRegistrationTable();
      } catch {
        try {
          registrations = await client.getWirelessRegistrationTable();
        } catch {
          return reply.code(502).send({ error: "Router unreachable or has no wireless capability" });
        }
      }
    }
    // Both fallback calls resolve to `any` (axios response data), so TS
    // can't narrow away null purely from the assignments above — guard
    // explicitly instead of a non-null assertion.
    if (!registrations) {
      return reply.code(502).send({ error: "Router unreachable or has no wireless capability" });
    }

    // CAPsMAN reports signal as "rx-signal", the local tables as
    // "signal-strength" — normalize so the UI doesn't need to know which
    // source answered.
    return registrations.map((r) => ({ ...r, "signal-strength": r["signal-strength"] ?? r["rx-signal"] ?? null }));
  });
}
