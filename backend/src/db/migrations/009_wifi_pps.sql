-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/009_wifi_pps.sql

ALTER TABLE wifi_client_metrics ADD COLUMN IF NOT EXISTS rx_pps INTEGER;
ALTER TABLE wifi_client_metrics ADD COLUMN IF NOT EXISTS tx_pps INTEGER;
