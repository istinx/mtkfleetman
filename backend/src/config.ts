import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtSecret: required("JWT_SECRET"),
  masterKeyHex: required("MASTER_KEY"), // 32-byte hex key for AES-256-GCM
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  // Optional — only used if the users table is empty at startup. See
  // db/bootstrapAdmin.ts. Left unset on an already-provisioned deployment,
  // so this must not be a required() var.
  bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
};
