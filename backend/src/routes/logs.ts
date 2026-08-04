import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";

export default async function logsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Querystring: { service?: string; level?: string; limit?: string } }>(
    "/logs",
    async (req, reply) => {
      if (authUser(req).role !== "admin") return reply.code(403).send({ error: "Forbidden" });

      const limit = Math.min(Number(req.query.limit ?? 200), 1000);
      const conditions: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (req.query.service) { conditions.push(`service = $${i++}`); values.push(req.query.service); }
      if (req.query.level) { conditions.push(`level = $${i++}`); values.push(req.query.level); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      values.push(limit);

      const { rows } = await pool.query(
        `SELECT id, service, level, message, meta, router_id, created_at
         FROM app_log ${where} ORDER BY created_at DESC LIMIT $${i}`,
        values
      );
      return rows;
    }
  );
}
