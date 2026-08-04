import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { pool } from "../db/pool";

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { username: string; password: string } }>("/auth/login", async (req, reply) => {
    const { username, password } = req.body;
    const { rows } = await pool.query(
      "SELECT id, tenant_id, password_hash, role FROM users WHERE username = $1",
      [username]
    );
    const user = rows[0];
    if (!user) return reply.code(401).send({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    const token = app.jwt.sign(
      { userId: user.id, tenantId: user.tenant_id, role: user.role },
      { expiresIn: "12h" }
    );
    return { token };
  });
}
