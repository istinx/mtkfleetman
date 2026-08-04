-- Run manually against an already-running deployment:
--
--   docker compose exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--     < backend/src/db/migrations/005_split_wifi_ethernet.sql
--
-- Drops the short-lived unified client_traffic_metrics table (introduced in
-- 002/004) and replaces it with two independent tables. If that table
-- never actually got populated correctly for you, there's no real history
-- to lose here.

DROP TABLE IF EXISTS client_traffic_metrics;

CREATE TABLE IF NOT EXISTS wifi_client_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  ap_identity TEXT,
  ssid TEXT,
  rx_signal SMALLINT,
  rx_bps BIGINT,
  tx_bps BIGINT
);
SELECT create_hypertable('wifi_client_metrics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_wifi_client_metrics_router_mac_time ON wifi_client_metrics(router_id, mac_address, time DESC);
SELECT add_retention_policy('wifi_client_metrics', INTERVAL '14 days', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS ethernet_client_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  mac_address TEXT,
  ip_address TEXT,
  hostname TEXT,
  port_name TEXT,
  neighbor_identity TEXT,
  confidence TEXT NOT NULL,
  host_count INTEGER,
  rx_bps BIGINT,
  tx_bps BIGINT
);
SELECT create_hypertable('ethernet_client_metrics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_eth_client_metrics_router_key_time ON ethernet_client_metrics(router_id, client_key, time DESC);
SELECT add_retention_policy('ethernet_client_metrics', INTERVAL '14 days', if_not_exists => TRUE);
