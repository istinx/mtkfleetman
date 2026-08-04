-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/004_wired_clients.sql

ALTER TABLE client_traffic_metrics ALTER COLUMN mac_address DROP NOT NULL;
ALTER TABLE client_traffic_metrics ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE client_traffic_metrics ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'wifi';

-- ap_identity is renamed to source_label (AP name for wifi, queue name for
-- wired) — add the new name and backfill from the old column if present.
ALTER TABLE client_traffic_metrics ADD COLUMN IF NOT EXISTS source_label TEXT;
UPDATE client_traffic_metrics SET source_label = ap_identity
  WHERE source_label IS NULL AND ap_identity IS NOT NULL;
ALTER TABLE client_traffic_metrics DROP COLUMN IF EXISTS ap_identity;

UPDATE client_traffic_metrics SET client_key = mac_address WHERE client_key IS NULL;
ALTER TABLE client_traffic_metrics ALTER COLUMN client_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_metrics_router_key_time
  ON client_traffic_metrics(router_id, client_key, time DESC);
