-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/013_device_events.sql

ALTER TABLE dhcp_first_seen ADD COLUMN online BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE device_events (
  id BIGSERIAL PRIMARY KEY,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  event_type TEXT NOT NULL, -- 'online' | 'offline'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_events_router_time ON device_events(router_id, created_at DESC);
