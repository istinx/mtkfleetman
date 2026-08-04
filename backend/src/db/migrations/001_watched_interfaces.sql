-- Run this manually against an already-running deployment (schema.sql only
-- executes on a brand-new, empty database volume). From the host:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/001_watched_interfaces.sql
--
-- (values for POSTGRES_USER/POSTGRES_DB come from your .env; defaults are
-- "mtk" and "mikrotik_manager").

CREATE TABLE IF NOT EXISTS watched_interfaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  interface_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(router_id, interface_name)
);
CREATE INDEX IF NOT EXISTS idx_watched_interfaces_router ON watched_interfaces(router_id);
