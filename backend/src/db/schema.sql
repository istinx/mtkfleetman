CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator', -- admin | operator | viewer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE routers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 443,
  use_tls BOOLEAN NOT NULL DEFAULT true,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL, -- AES-256-GCM, see utils/crypto.ts
  model TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', -- up | warn | down | unknown
  last_seen TIMESTAMPTZ,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routers_tenant ON routers(tenant_id);

-- Time-series: system resource samples (CPU/memory/uptime)
CREATE TABLE router_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  cpu_load INTEGER,
  memory_used BIGINT,
  memory_total BIGINT,
  uptime_seconds BIGINT
);
SELECT create_hypertable('router_metrics', 'time');
CREATE INDEX idx_router_metrics_router_time ON router_metrics(router_id, time DESC);

-- Time-series: per-interface traffic/status samples
CREATE TABLE interface_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  interface_name TEXT NOT NULL,
  status TEXT NOT NULL, -- up | down | disabled
  rx_bps BIGINT,
  tx_bps BIGINT
);
SELECT create_hypertable('interface_metrics', 'time');
CREATE INDEX idx_iface_metrics_router_time ON interface_metrics(router_id, interface_name, time DESC);

-- Downsample retention: keep raw data 14 days (adjust for production)
SELECT add_retention_policy('router_metrics', INTERVAL '14 days');
SELECT add_retention_policy('interface_metrics', INTERVAL '14 days');

-- Which interfaces the user actually wants to watch per router. If a
-- router has no rows here, the worker falls back to watching/storing all
-- of its interfaces (so a freshly added router still shows data before
-- anyone picks specific interfaces).
CREATE TABLE watched_interfaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  interface_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(router_id, interface_name)
);
CREATE INDEX idx_watched_interfaces_router ON watched_interfaces(router_id);

-- Wi-Fi top-consumers: CAPsMAN registration-table byte counters (delta over
-- time, same technique as interface_metrics), enriched with hostname/IP
-- from DHCP/ARP where CAPsMAN's own last-ip is missing.
CREATE TABLE wifi_client_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  ap_identity TEXT,
  ssid TEXT,
  rx_signal SMALLINT,
  rx_bps BIGINT,
  tx_bps BIGINT,
  rx_pps INTEGER,
  tx_pps INTEGER
);
SELECT create_hypertable('wifi_client_metrics', 'time');
CREATE INDEX idx_wifi_client_metrics_router_mac_time ON wifi_client_metrics(router_id, mac_address, time DESC);
SELECT add_retention_policy('wifi_client_metrics', INTERVAL '14 days');

-- Ethernet top-consumers: derived from the bridge host (FDB) table without
-- requiring any Simple Queue setup. A port with exactly one learned MAC
-- gets that port's own traffic counters attributed to it directly
-- (confidence='exact'); a port with several hosts, or one identified via
-- neighbor discovery as another networking device, is reported as a
-- shared/uplink port instead of guessing per-host numbers
-- (confidence='shared'|'neighbor').
CREATE TABLE ethernet_client_metrics (
  time TIMESTAMPTZ NOT NULL,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL, -- MAC address (exact) or 'port:<name>' (shared/neighbor)
  mac_address TEXT,
  ip_address TEXT,
  hostname TEXT,
  port_name TEXT,
  neighbor_identity TEXT,
  confidence TEXT NOT NULL, -- 'exact' | 'shared' | 'neighbor'
  host_count INTEGER,
  rx_bps BIGINT,
  tx_bps BIGINT
);
SELECT create_hypertable('ethernet_client_metrics', 'time');
CREATE INDEX idx_eth_client_metrics_router_key_time ON ethernet_client_metrics(router_id, client_key, time DESC);
SELECT add_retention_policy('ethernet_client_metrics', INTERVAL '14 days');

-- Cache for MAC-address vendor lookups (client detail drill-down). Looked
-- up on demand (not during regular polling) via an external OUI API and
-- cached indefinitely — vendor-to-OUI assignments don't change.
CREATE TABLE mac_vendors (
  oui TEXT PRIMARY KEY, -- first 3 octets, e.g. "AA:BB:CC"
  vendor TEXT,          -- NULL means "looked up, nothing found"
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks when a MAC/IP was first observed via DHCP leases (worker upserts
-- this on every poll: first_seen_at set once, last_seen_at bumped each
-- time). Used to show "in the network since" on the DHCP tab and to
-- cross-reference with when Wi-Fi traffic actually started.
CREATE TABLE dhcp_first_seen (
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  mac_address TEXT NOT NULL,
  ip_address TEXT,
  hostname TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  online BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (router_id, mac_address)
);

-- Transition history for dhcp_first_seen.online — one row per "device
-- appeared" / "device disappeared" event, so the DHCP tab can show a feed
-- instead of just a static "last seen" column. See worker.ts
-- processDhcpFirstSeen for how online/offline is decided.
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

-- Firewall drop/reject hits, parsed from RouterOS /log entries for rules
-- that have log=yes set (not set by this app — see README/Документация for
-- the config step). Populated by worker.ts processFirewallLog. Not a
-- hypertable — volume is low enough for a plain indexed table with
-- opportunistic cleanup (see logging/dbLog.ts pattern).
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

-- Application logs (api + worker), viewable in the UI so problems can be
-- diagnosed/copied without SSHing into the server. Not a replacement for
-- `docker compose logs` — just the errors/timings that matter for
-- debugging router communication.
CREATE TABLE app_log (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,   -- 'api' | 'worker'
  level TEXT NOT NULL,     -- 'info' | 'warn' | 'error'
  message TEXT NOT NULL,
  meta JSONB,
  router_id UUID REFERENCES routers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_log_created ON app_log(created_at DESC);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  router_id UUID REFERENCES routers(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- e.g. firewall.rule.create
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
