-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/011_monitoring_enabled.sql

ALTER TABLE routers ADD COLUMN monitoring_enabled BOOLEAN NOT NULL DEFAULT true;
