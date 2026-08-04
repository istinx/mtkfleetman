-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/008_app_log.sql

CREATE TABLE IF NOT EXISTS app_log (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB,
  router_id UUID REFERENCES routers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_log_created ON app_log(created_at DESC);
