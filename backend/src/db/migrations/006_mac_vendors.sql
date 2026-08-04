-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/006_mac_vendors.sql

CREATE TABLE IF NOT EXISTS mac_vendors (
  oui TEXT PRIMARY KEY,
  vendor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
