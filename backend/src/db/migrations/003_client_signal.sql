-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/003_client_signal.sql

ALTER TABLE client_traffic_metrics ADD COLUMN IF NOT EXISTS rx_signal SMALLINT;
