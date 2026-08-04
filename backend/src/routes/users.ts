import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";

export default async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Who am I — lets the frontend know the current user's role/username
  // without decoding the JWT client-side.
  app.get("/me", async (req, reply) => {
    const { userId, tenantId, role } = authUser(req);
    const { rows } = await pool.query("SELECT id, username, role FROM users WHERE id = $1 AND tenant_id = $2", [
      userId,
      tenantId,
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return { id: rows[0].id, username: rows[0].username, role: rows[0].role };
  });

  // Any authenticated user can change their own password, given the
  // current one — this does not require the admin role.
  app.patch<{ Body: { currentPassword: string; newPassword: string } }>(
    "/me/password",
    async (req, reply) => {
      const { userId } = authUser(req);
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return reply.code(400).send({ error: "currentPassword and newPassword are required" });
      }
      if (newPassword.length < 8) {
        return reply.code(400).send({ error: "New password must be at least 8 characters" });
      }
      const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
      if (!rows[0]) return reply.code(404).send({ error: "Not found" });
      const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!ok) return reply.code(401).send({ error: "Current password is incorrect" });
      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userId]);
      return { ok: true };
    }
  );

  // Everything below manages other users within the same tenant — admin only.
  function requireAdmin(req: any, reply: any): boolean {
    if (authUser(req).role !== "admin") {
      reply.code(403).send({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  app.get("/users", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { rows } = await pool.query(
      "SELECT id, username, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at",
      [authUser(req).tenantId]
    );
    return rows;
  });

  app.post<{ Body: { username: string; password: string; role: string } }>("/users", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { username, password, role } = req.body;
    if (!username || !password) return reply.code(400).send({ error: "username and password are required" });
    if (password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters" });
    if (!["admin", "operator", "viewer"].includes(role)) {
      return reply.code(400).send({ error: "role must be admin, operator, or viewer" });
    }
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (tenant_id, username, password_hash, role) VALUES ($1,$2,$3,$4)
         RETURNING id, username, role, created_at`,
        [authUser(req).tenantId, username, hash, role]
      );
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === "23505") return reply.code(409).send({ error: "A user with this username already exists" });
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { username?: string; role?: string; password?: string } }>(
    "/users/:id",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { tenantId } = authUser(req);
      const { rows: existing } = await pool.query("SELECT id FROM users WHERE id = $1 AND tenant_id = $2", [
        req.params.id,
        tenantId,
      ]);
      if (!existing[0]) return reply.code(404).send({ error: "Not found" });

      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const b = req.body;
      if (b.username) { fields.push(`username = $${i++}`); values.push(b.username); }
      if (b.role) {
        if (!["admin", "operator", "viewer"].includes(b.role)) {
          return reply.code(400).send({ error: "role must be admin, operator, or viewer" });
        }
        fields.push(`role = $${i++}`);
        values.push(b.role);
      }
      if (b.password) {
        if (b.password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters" });
        fields.push(`password_hash = $${i++}`);
        values.push(await bcrypt.hash(b.password, 12));
      }
      if (!fields.length) return reply.code(400).send({ error: "No fields to update" });

      values.push(req.params.id);
      try {
        await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i}`, values);
        return { ok: true };
      } catch (err: any) {
        if (err.code === "23505") return reply.code(409).send({ error: "A user with this username already exists" });
        throw err;
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { userId, tenantId } = authUser(req);
    if (req.params.id === userId) {
      return reply.code(400).send({ error: "You can't delete your own account — use another admin account" });
    }
    await pool.query("DELETE FROM users WHERE id = $1 AND tenant_id = $2", [req.params.id, tenantId]);
    return reply.code(204).send();
  });
}
