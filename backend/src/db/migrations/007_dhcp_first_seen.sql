-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/007_dhcp_first_seen.sql

CREATE TABLE IF NOT EXISTS dhcp_first_seen (
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, mac_address)
);
