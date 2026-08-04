import { pool } from "./pool";
import { decryptSecret } from "../utils/crypto";
import { MikroTikClient } from "../mikrotik/client";

export interface RouterRow {
  id: string;
  tenant_id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password_encrypted: string;
  model: string | null;
  status: string;
  last_seen: Date | null;
}

export async function getRouterForTenant(tenantId: string, routerId: string): Promise<RouterRow | null> {
  const { rows } = await pool.query<RouterRow>(
    "SELECT * FROM routers WHERE id = $1 AND tenant_id = $2",
    [routerId, tenantId]
  );
  return rows[0] ?? null;
}

export function clientFor(router: RouterRow): MikroTikClient {
  return new MikroTikClient({
    host: router.host,
    port: router.port,
    useTls: router.use_tls,
    username: router.username,
    password: decryptSecret(router.password_encrypted),
  });
}
