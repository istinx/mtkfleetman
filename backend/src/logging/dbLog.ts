import { pool } from "../db/pool";

export type LogLevel = "info" | "warn" | "error";

// Fire-and-forget: logging must never itself crash the caller. Also trims
// old entries occasionally so the table doesn't grow forever without
// needing a separate cron/job for it.
export async function logEvent(
  service: "api" | "worker",
  level: LogLevel,
  message: string,
  meta?: unknown,
  routerId?: string
) {
  try {
    await pool.query(
      `INSERT INTO app_log (service, level, message, meta, router_id) VALUES ($1,$2,$3,$4,$5)`,
      [service, level, message, meta !== undefined ? JSON.stringify(meta) : null, routerId ?? null]
    );
    if (Math.random() < 0.02) {
      await pool.query("DELETE FROM app_log WHERE created_at < now() - interval '7 days'");
    }
  } catch {
    // If logging itself fails (e.g. DB briefly unavailable), there's
    // nowhere else to put this — just swallow it.
  }
}
