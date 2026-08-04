-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/002_client_traffic_metrics.sql

CREATE TABLE IF NOT EXISTS client_traffic_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  ap_identity TEXT,
  ssid TEXT,
  rx_bps BIGINT,
  tx_bps BIGINT
);
SELECT create_hypertable('client_traffic_metrics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_client_metrics_router_mac_time ON client_traffic_metrics(router_id, mac_address, time DESC);
SELECT add_retention_policy('client_traffic_metrics', INTERVAL '14 days', if_not_exists => TRUE);
