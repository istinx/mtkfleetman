import bcrypt from "bcrypt";
import { pool } from "../db/pool";
import { encryptSecret } from "../utils/crypto";

async function seed() {
  const { rows: tenantRows } = await pool.query(
    "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
    ["Demo Tenant"]
  );
  const tenantId = tenantRows[0].id;

  const passwordHash = await bcrypt.hash("admin123", 12);
  await pool.query(
    "INSERT INTO users (tenant_id, username, password_hash, role) VALUES ($1,$2,$3,'admin')",
    [tenantId, "admin", passwordHash]
  );

  // Optional sample router — edit host/username/password to match a real device,
  // or remove this block and add routers via POST /routers instead.
  await pool.query(
    `INSERT INTO routers (tenant_id, name, host, port, use_tls, username, password_encrypted, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      tenantId,
      "Demo-Router-01",
      "192.168.88.1",
      443,
      true,
      "admin",
      encryptSecret("changeme"),
      "hAP ax3",
    ]
  );

  console.log("Seeded tenant:", tenantId);
  console.log("Login with admin / admin123");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
