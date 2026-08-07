-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/012_firewall_log_events.sql

CREATE TABLE firewall_log_events (
  id BIGSERIAL PRIMARY KEY,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  src_ip TEXT,
  message TEXT NOT NULL,
  topics TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_firewall_log_events_router_time ON firewall_log_events(router_id, created_at DESC);
CREATE INDEX idx_firewall_log_events_router_src ON firewall_log_events(router_id, src_ip);
