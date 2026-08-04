import bcrypt from "bcrypt";
import { pool } from "./pool";
import { config } from "../config";
import { logEvent } from "../logging/dbLog";

// Runs on every API boot — must stay cheap and idempotent. Only acts the
// very first time a deployment starts against a completely empty users
// table; every boot after that (including the second replica in a race,
// which is not guarded against — see README/plan notes, not worth an
// advisory lock at this project's single-api-replica scale) is a no-op.
export async function ensureBootstrapAdmin(): Promise<void> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0].count > 0) return;

  const { bootstrapAdminUsername: username, bootstrapAdminPassword: password } = config;
  if (!username || !password) {
    console.warn(
      "No users exist yet and BOOTSTRAP_ADMIN_USERNAME/BOOTSTRAP_ADMIN_PASSWORD are not set — " +
        "nobody can log in. Set both in .env and restart, or run `node dist/scripts/seed.js`."
    );
    await logEvent("api", "warn", "Startup: users table empty, no bootstrap admin configured");
    return;
  }

  const { rows: tenantRows } = await pool.query("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [
    "Default Tenant",
  ]);
  const tenantId = tenantRows[0].id;
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    "INSERT INTO users (tenant_id, username, password_hash, role) VALUES ($1,$2,$3,'admin')",
    [tenantId, username, passwordHash]
  );

  console.log(`Bootstrap admin created: ${username}`);
  await logEvent("api", "info", `Startup: created bootstrap admin "${username}"`);
}
