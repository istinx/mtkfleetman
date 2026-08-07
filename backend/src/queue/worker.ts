import { Worker } from "bullmq";
import { connection, scheduleRecurringPoll } from "./queue";
import { pool } from "../db/pool";
import { clientFor, RouterRow } from "../db/routers";
import { parseUptime, parseCounterPair, parsePacketPair } from "../mikrotik/parse";
import { logEvent } from "../logging/dbLog";

async function getWatchedInterfaceNames(routerId: string): Promise<Set<string> | null> {
  const { rows } = await pool.query("SELECT interface_name FROM watched_interfaces WHERE router_id = $1", [
    routerId,
  ]);
  if (!rows.length) return null; // nothing selected yet -> watch everything
  return new Set(rows.map((r) => r.interface_name));
}

// /interface only reports cumulative byte counters (rx-byte/tx-byte), not a
// live bits-per-second rate — that requires the interactive
// /interface/monitor-traffic command. Instead we derive bps ourselves from
// the delta between consecutive polls, keyed per router+interface. This
// lives in the worker's memory and resets on restart (first poll after a
// restart reports 0, which is fine — it self-corrects on the next tick).
const lastCounters = new Map<string, { rxByte: number; txByte: number; atMs: number }>();

function deriveRate(key: string, rxByte: number, txByte: number, atMs: number): { rxBps: number; txBps: number } {
  const prev = lastCounters.get(key);
  lastCounters.set(key, { rxByte, txByte, atMs });
  if (!prev) return { rxBps: 0, txBps: 0 };
  const deltaSec = (atMs - prev.atMs) / 1000;
  // Guard against counter resets (interface/router restart) and clock weirdness.
  if (deltaSec <= 0 || rxByte < prev.rxByte || txByte < prev.txByte) return { rxBps: 0, txBps: 0 };
  return {
    rxBps: Math.round(((rxByte - prev.rxByte) * 8) / deltaSec),
    txBps: Math.round(((txByte - prev.txByte) * 8) / deltaSec),
  };
}

// Same idea as deriveRate but for raw counts (packets/sec) rather than
// bits/sec — no *8 multiplication. Separate keyspace ("pkt:" prefix) so it
// doesn't collide with the byte-counter tracking above.
const lastPacketCounters = new Map<string, { a: number; b: number; atMs: number }>();

function derivePacketRate(key: string, a: number, b: number, atMs: number): { aPerSec: number; bPerSec: number } {
  const prev = lastPacketCounters.get(key);
  lastPacketCounters.set(key, { a, b, atMs });
  if (!prev) return { aPerSec: 0, bPerSec: 0 };
  const deltaSec = (atMs - prev.atMs) / 1000;
  if (deltaSec <= 0 || a < prev.a || b < prev.b) return { aPerSec: 0, bPerSec: 0 };
  return {
    aPerSec: Math.round((a - prev.a) / deltaSec),
    bPerSec: Math.round((b - prev.b) / deltaSec),
  };
}

async function processRouterMetrics(router: RouterRow, now: Date, resource: any, allInterfaces: any[]) {
  const watched = await getWatchedInterfaceNames(router.id);
  const interfaces = watched ? allInterfaces.filter((i) => watched.has(i.name)) : allInterfaces;

  await pool.query(
    `INSERT INTO router_metrics (time, router_id, cpu_load, memory_used, memory_total, uptime_seconds)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      now,
      router.id,
      Number(resource["cpu-load"] ?? 0),
      Number(resource["total-memory"] ?? 0) - Number(resource["free-memory"] ?? 0),
      Number(resource["total-memory"] ?? 0),
      parseUptime(resource["uptime"]),
    ]
  );

  for (const iface of interfaces) {
    const rxByte = Number(iface["rx-byte"] ?? 0);
    const txByte = Number(iface["tx-byte"] ?? 0);
    const { rxBps, txBps } = deriveRate(`${router.id}:${iface.name}`, rxByte, txByte, now.getTime());
    await pool.query(
      `INSERT INTO interface_metrics (time, router_id, interface_name, status, rx_bps, tx_bps)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        now,
        router.id,
        iface.name,
        iface.running === "true" ? "up" : iface.disabled === "true" ? "disabled" : "down",
        rxBps,
        txBps,
      ]
    );
  }

  // Router-level status reflects the watched interfaces if any are
  // selected, otherwise all interfaces — so "down" only fires for what
  // the user actually cares about once they've made a selection.
  const anyDown = interfaces.some((i) => i.disabled !== "true" && i.running !== "true");
  const status = anyDown ? "warn" : "up";
  await pool.query("UPDATE routers SET status = $1, last_seen = $2 WHERE id = $3", [status, now, router.id]);
}

async function processWifiClients(router: RouterRow, client: ReturnType<typeof clientFor>, now: Date, leases: any[], arp: any[]) {
  try {
    let registrations: any[] = await client.getCapsmanRegistrations().catch(() => []);
    let isLocal = false;

    // No CAPsMAN configured (or it has no clients right now) — fall back to
    // this router's own local wireless interface, which reports clients the
    // same way minus the CAPsMAN-specific fields (last-ip, remote AP name).
    if (!Array.isArray(registrations) || !registrations.length) {
      registrations = await client.getWifiRegistrationTable().catch(() => []);
      if (!Array.isArray(registrations) || !registrations.length) {
        registrations = await client.getWirelessRegistrationTable().catch(() => []);
      }
      isLocal = true;
    }
    if (!Array.isArray(registrations) || !registrations.length) return;

    const leaseByMac = new Map<string, { ip?: string; hostname?: string }>();
    for (const l of leases) {
      const mac = String(l["mac-address"] ?? "").toUpperCase();
      if (mac) leaseByMac.set(mac, { ip: l.address, hostname: l["host-name"] });
    }
    const arpByMac = new Map<string, string>();
    for (const a of arp) {
      const mac = String(a["mac-address"] ?? "").toUpperCase();
      if (mac && a.address) arpByMac.set(mac, a.address);
    }

    for (const reg of registrations as any[]) {
      const mac = String(reg["mac-address"] ?? "").toUpperCase();
      if (!mac) continue;
      const { a: rxByte, b: txByte } = parseCounterPair(reg);
      const { rxBps, txBps } = deriveRate(`wifi-client:${router.id}:${mac}`, rxByte, txByte, now.getTime());
      const { a: rxPacket, b: txPacket } = parsePacketPair(reg);
      const { aPerSec: rxPps, bPerSec: txPps } = derivePacketRate(`wifi-client:${router.id}:${mac}`, rxPacket, txPacket, now.getTime());
      const lease = leaseByMac.get(mac);
      const ip = reg["last-ip"] || lease?.ip || arpByMac.get(mac) || null;
      const hostname = lease?.hostname ?? null;
      // CAPsMAN reports the remote AP's identity; a local (non-CAPsMAN)
      // radio has no separate "AP" — the interface name itself is the label.
      const apIdentity = isLocal
        ? reg["interface"] ?? null
        : reg["remote-cap-identity"] ?? reg["ap"] ?? reg["interface"] ?? null;
      const ssid = reg["ssid"] ?? null;
      // Legacy "wireless" package calls this signal-strength; CAPsMAN/wifi call it rx-signal.
      const rawSignal = reg["rx-signal"] ?? reg["signal-strength"];
      const rxSignal = rawSignal !== undefined ? parseInt(rawSignal, 10) : null;

      await pool.query(
        `INSERT INTO wifi_client_metrics (time, router_id, mac_address, ip_address, hostname, ap_identity, ssid, rx_signal, rx_bps, tx_bps, rx_pps, tx_pps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [now, router.id, mac, ip, hostname, apIdentity, ssid, rxSignal, rxBps, txBps, rxPps, txPps]
      );
    }
  } catch (err: any) {
    await logEvent("worker", "warn", `Wi-Fi client poll failed for "${router.name}"`, {
      error: err?.message ?? String(err),
    }, router.id);
  }
}

// Wired/static-IP clients without any Simple Queue configured: attribute a
// bridge port's own traffic counters to a client only when the bridge's
// host (FDB) table shows exactly one MAC learned on that port — a very
// common case for access-switch ports wired to a single PC, server, or AP.
// A port with several hosts, or one whose sole MAC belongs to a device
// found via neighbor discovery (i.e. it's an uplink to another switch/AP,
// not an end client), is reported honestly as a shared/uplink port with
// aggregate traffic instead of guessing which host it belongs to.
async function processEthernetClients(
  router: RouterRow,
  client: ReturnType<typeof clientFor>,
  now: Date,
  interfaces: any[],
  leases: any[],
  arp: any[]
) {
  try {
    const [bridgeHosts, neighbors] = await Promise.all([
      client.getBridgeHosts(),
      client.getIpNeighbors().catch(() => []),
    ]);
    if (!Array.isArray(bridgeHosts) || !bridgeHosts.length) return;

    const hostnameByIp = new Map<string, string>();
    for (const l of leases) {
      if (l.address && l["host-name"]) hostnameByIp.set(l.address, l["host-name"]);
    }
    const ipByMac = new Map<string, string>();
    for (const a of arp) {
      const mac = String(a["mac-address"] ?? "").toUpperCase();
      if (mac && a.address) ipByMac.set(mac, a.address);
    }

    // Independent delta-tracking namespace from the interface-monitoring
    // feature ("eth-port:") — reading the same cumulative counters twice
    // per cycle is harmless, but sharing a lastCounters key would corrupt
    // both features' deltas.
    const bpsByPort = new Map<string, { rx: number; tx: number }>();
    for (const iface of interfaces) {
      const { a: rxByte, b: txByte } = parseCounterPair(iface);
      const { rxBps, txBps } = deriveRate(`eth-port:${router.id}:${iface.name}`, rxByte, txByte, now.getTime());
      bpsByPort.set(iface.name, { rx: rxBps, tx: txBps });
    }

    // Neighbor Discovery reports the interface as "ether4,LocalNet_Bridge"
    // (port + bridge name comma-joined) while the bridge host table just
    // uses the bare port name "ether4" — normalize both to the bare port
    // so a real AP uplink's identity actually gets matched instead of
    // silently producing two disconnected entries for the same port.
    function normalizePort(name: string): string {
      return name.split(",")[0].trim();
    }

    const neighborByPort = new Map<string, { identity?: string; platform?: string }>();
    const neighborMacs = new Set<string>();
    for (const n of neighbors as any[]) {
      const iface = n.interface;
      if (iface) neighborByPort.set(normalizePort(iface), { identity: n.identity, platform: n.platform });
      const nmac = String(n["mac-address"] ?? "").toUpperCase();
      if (nmac) neighborMacs.add(nmac);
    }

    const macsByPort = new Map<string, Set<string>>();
    for (const h of bridgeHosts as any[]) {
      if (h.local === "true") continue; // the router's own bridge/VLAN interfaces, not a client
      const rawPort = h.interface ?? h["on-interface"];
      const mac = String(h["mac-address"] ?? "").toUpperCase();
      if (!rawPort || !mac) continue;
      const port = normalizePort(rawPort);
      if (neighborMacs.has(mac)) continue; // that's the neighbor device itself, not an end client behind it
      if (!macsByPort.has(port)) macsByPort.set(port, new Set());
      macsByPort.get(port)!.add(mac);
    }

    for (const [port, macs] of macsByPort) {
      const bps = bpsByPort.get(port) ?? { rx: 0, tx: 0 };
      if (macs.size === 1) {
        const mac = [...macs][0];
        const ip = ipByMac.get(mac) ?? null;
        const hostname = ip ? hostnameByIp.get(ip) ?? null : null;
        await pool.query(
          `INSERT INTO ethernet_client_metrics (time, router_id, client_key, mac_address, ip_address, hostname, port_name, neighbor_identity, confidence, host_count, rx_bps, tx_bps)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [now, router.id, mac, mac, ip, hostname, port, null, "exact", 1, bps.rx, bps.tx]
        );
      } else {
        const neighbor = neighborByPort.get(port);
        await pool.query(
          `INSERT INTO ethernet_client_metrics (time, router_id, client_key, mac_address, ip_address, hostname, port_name, neighbor_identity, confidence, host_count, rx_bps, tx_bps)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [now, router.id, `port:${port}`, null, null, null, port, neighbor?.identity ?? null, "shared", macs.size, bps.rx, bps.tx]
        );
      }
    }

    // Ports with a discovered neighbor but no bridge-learned host at all
    // (e.g. a routed rather than switched uplink) are still useful
    // topology info even without host attribution.
    for (const [port, neighbor] of neighborByPort) {
      if (macsByPort.has(port)) continue;
      const bps = bpsByPort.get(port) ?? { rx: 0, tx: 0 };
      await pool.query(
        `INSERT INTO ethernet_client_metrics (time, router_id, client_key, mac_address, ip_address, hostname, port_name, neighbor_identity, confidence, host_count, rx_bps, tx_bps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [now, router.id, `port:${port}`, null, null, null, port, neighbor.identity ?? null, "neighbor", 0, bps.rx, bps.tx]
      );
    }
  } catch (err: any) {
    await logEvent("worker", "warn", `Ethernet client poll failed for "${router.name}"`, {
      error: err?.message ?? String(err),
    }, router.id);
  }
}

// Tracks when each MAC/IP was first seen via DHCP — a plain upsert, no
// delta/rate logic, no extra fetch (reuses the leases already fetched for
// this cycle).
// Every poll: upsert last_seen_at for currently-leased MACs, and emit a
// device_events row whenever a device is genuinely new or was previously
// marked offline (i.e. transitioning back to online) — not on every routine
// bump. Separately, anything that was online but has aged out of the
// current lease list gets flipped offline and gets its own event. Together
// this turns the static "first/last seen" columns into an actual timeline
// for the DHCP tab.
async function processDhcpFirstSeen(router: RouterRow, leases: any[]) {
  try {
    const currentMacs: string[] = [];
    for (const l of leases) {
      const mac = String(l["mac-address"] ?? "").toUpperCase();
      if (!mac) continue;
      currentMacs.push(mac);
      const ip = l.address ?? null;
      const hostname = l["host-name"] ?? null;

      const { rows } = await pool.query(
        `WITH old AS (SELECT online FROM dhcp_first_seen WHERE router_id = $1 AND mac_address = $2)
         INSERT INTO dhcp_first_seen (router_id, mac_address, ip_address, hostname, first_seen_at, last_seen_at, online)
         VALUES ($1,$2,$3,$4, now(), now(), true)
         ON CONFLICT (router_id, mac_address)
         DO UPDATE SET ip_address = $3, hostname = $4, last_seen_at = now(), online = true
         RETURNING (xmax = 0) AS is_new, (SELECT online FROM old) AS was_online_before`,
        [router.id, mac, ip, hostname]
      );
      const { is_new, was_online_before } = rows[0];
      if (is_new || was_online_before === false) {
        await pool.query(
          `INSERT INTO device_events (router_id, mac_address, ip_address, hostname, event_type) VALUES ($1,$2,$3,$4,'online')`,
          [router.id, mac, ip, hostname]
        );
      }
    }

    // Grace period covers a couple of missed cycles (this runs every 4th
    // tick) before declaring a device offline, so one slow/failed lease
    // fetch doesn't flap the feed.
    const { rows: goneOffline } = await pool.query(
      `UPDATE dhcp_first_seen
       SET online = false
       WHERE router_id = $1 AND online = true
         AND mac_address <> ALL($2::text[])
         AND last_seen_at < now() - interval '2 minutes'
       RETURNING mac_address, ip_address, hostname`,
      [router.id, currentMacs]
    );
    for (const r of goneOffline) {
      await pool.query(
        `INSERT INTO device_events (router_id, mac_address, ip_address, hostname, event_type) VALUES ($1,$2,$3,$4,'offline')`,
        [router.id, r.mac_address, r.ip_address, r.hostname]
      );
    }
    if (Math.random() < 0.05) {
      await pool.query("DELETE FROM device_events WHERE created_at < now() - interval '30 days'");
    }
  } catch (err: any) {
    await logEvent("worker", "warn", `DHCP first-seen poll failed for "${router.name}"`, {
      error: err?.message ?? String(err),
    }, router.id);
  }
}

// Firewall drop/reject log ingestion — only produces anything once the user
// sets log=yes on the relevant rules on the router itself (see README).
// Dedup is an in-memory "IDs seen in the last fetch" set per router, not a
// persisted cursor — same trade-off as deriveRate()'s in-memory counters:
// resets on worker restart, so a restart can re-import whatever's currently
// sitting in the router's (small, rotating) log buffer once. Bounded and
// self-limiting, not worth a persisted cursor for.
const lastSeenLogIds = new Map<string, Set<string>>();

async function processFirewallLog(router: RouterRow, client: ReturnType<typeof clientFor>) {
  try {
    const entries = (await client.getLog("firewall")) as any[];
    if (!Array.isArray(entries) || !entries.length) return;

    const seen = lastSeenLogIds.get(router.id) ?? new Set<string>();
    const fresh = entries.filter((e) => e[".id"] && !seen.has(e[".id"]));
    lastSeenLogIds.set(router.id, new Set(entries.map((e) => e[".id"]).filter(Boolean)));
    if (!fresh.length) return;

    for (const e of fresh) {
      const message = String(e.message ?? "");
      // RouterOS firewall log lines embed "src-ip:port->dst-ip:port" when
      // logging a connection — pull the source address out for
      // aggregation. A rule without that exact shape (custom log-prefix,
      // non-connection log) just stores the raw message with src_ip null.
      const match = message.match(/(\d{1,3}(?:\.\d{1,3}){3}):\d+->/);
      await pool.query(
        `INSERT INTO firewall_log_events (router_id, src_ip, message, topics) VALUES ($1,$2,$3,$4)`,
        [router.id, match ? match[1] : null, message, e.topics ?? null]
      );
    }
    if (Math.random() < 0.05) {
      await pool.query("DELETE FROM firewall_log_events WHERE created_at < now() - interval '14 days'");
    }
  } catch (err: any) {
    await logEvent("worker", "warn", `Firewall log poll failed for "${router.name}"`, {
      error: err?.message ?? String(err),
    }, router.id);
  }
}

// One poll cycle for one router. Fetches system resource, interfaces,
// DHCP leases, and ARP exactly once and shares them across all the
// sub-features below — these used to each fetch their own copies
// independently (up to ~11 separate HTTPS/TLS requests per router per
// cycle), which was enough to make some routers' embedded REST server
// time out intermittently under the load. Now it's 4 shared requests plus
// each feature's own unique one (CAPsMAN registrations, bridge host table,
// neighbor discovery) — down to about 7.
async function pollAllForRouter(router: RouterRow, tick: number) {
  const client = clientFor(router);
  const now = new Date();

  let resource: any;
  let interfaces: any[];
  try {
    [resource, interfaces] = await Promise.all([client.getSystemResource(), client.getInterfaces()]);
  } catch (err: any) {
    await pool.query("UPDATE routers SET status = 'down' WHERE id = $1", [router.id]);
    await logEvent("worker", "error", `Router "${router.name}" unreachable during poll`, {
      host: router.host,
      error: err?.message ?? String(err),
    }, router.id);
    return; // don't pile more requests onto a router that's already struggling this cycle
  }

  await processRouterMetrics(router, now, resource, interfaces);

  const [leasesRes, arpRes] = await Promise.allSettled([client.getDhcpLeases(), client.getArpTable()]);
  const leases = leasesRes.status === "fulfilled" ? (leasesRes.value as any[]) : [];
  const arp = arpRes.status === "fulfilled" ? (arpRes.value as any[]) : [];
  if (leasesRes.status === "rejected" || arpRes.status === "rejected") {
    await logEvent("worker", "warn", `DHCP/ARP fetch failed for "${router.name}" this cycle`, {
      leasesError: leasesRes.status === "rejected" ? String((leasesRes as PromiseRejectedResult).reason) : null,
      arpError: arpRes.status === "rejected" ? String((arpRes as PromiseRejectedResult).reason) : null,
    }, router.id);
  }

  // Top Wi-Fi consumers benefit from staying close to real-time — poll
  // every cycle. Ethernet-client detection and DHCP first-seen bookkeeping
  // are not latency-critical, so they run less often, easing off routers
  // that are already under heavy CPU load (e.g. a full BGP table).
  await processWifiClients(router, client, now, leases, arp);
  if (tick % 2 === 0) await processEthernetClients(router, client, now, interfaces, leases, arp);
  if (tick % 2 === 0) await processFirewallLog(router, client);
  if (tick % 4 === 0) await processDhcpFirstSeen(router, leases);
}

const CONCURRENCY = 5;
let tick = 0;

new Worker(
  "router-poll",
  async () => {
    tick += 1;
    const { rows } = await pool.query<RouterRow>("SELECT * FROM routers WHERE monitoring_enabled = true");
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((r) => pollAllForRouter(r, tick)));
    }
  },
  { connection }
);

scheduleRecurringPoll().then(() => {
  console.log("Worker started, recurring poll scheduled");
  logEvent("worker", "info", "Worker started, recurring poll scheduled");
});
