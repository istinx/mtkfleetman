import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { getRouterForTenant, clientFor } from "../db/routers";
import { logEvent } from "../logging/dbLog";

// Thresholds for flagging problems — heuristics, not hard science, but
// useful starting points for "what needs a look":
const LOW_SIGNAL_DBM = -85;
const HIGH_PPS = 3000; // packets/sec with little matching byte growth = possible flood/scan
const SHARED_PORT_BOTTLENECK_HOSTS = 20; // hosts crammed behind one uplink with NO recognized neighbor identity

export default async function topologyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Fetched only when this tab is opened — not part of the regular poll
  // cycle. Neighbors come live from the router (small/cheap, no ping —
  // "reachable" is inferred from the ARP table). Everything else (Wi-Fi
  // clients, wired clients, provider/VPN channels) is assembled from data
  // already collected for other tabs — zero extra router load, and
  // specifically avoids any live /ip/route or conntrack lookup.
  app.get<{ Params: { id: string } }>("/routers/:id/topology", async (req, reply) => {
    const router = await getRouterForTenant(authUser(req).tenantId, req.params.id);
    if (!router) return reply.code(404).send({ error: "Not found" });
    const rc = clientFor(router);

    const [neighborsRes, arpRes] = await Promise.allSettled([rc.getIpNeighbors(), rc.getArpTable()]);
    for (const [label, res] of [["neighbors", neighborsRes], ["arp", arpRes]] as const) {
      if (res.status === "rejected") {
        await logEvent("api", "warn", `Topology: ${label} lookup failed for "${router.name}"`, {
          error: (res.reason as any)?.message ?? String(res.reason),
        }, router.id);
      }
    }
    const neighbors = neighborsRes.status === "fulfilled" ? (neighborsRes.value as any[]) : [];
    const arp = arpRes.status === "fulfilled" ? (arpRes.value as any[]) : [];
    const arpByAddress = new Set(arp.map((a) => a.address).filter(Boolean));

    const { rows: channels } = await pool.query(
      `SELECT DISTINCT ON (interface_name) interface_name, status, rx_bps, tx_bps, time
       FROM interface_metrics
       WHERE router_id = $1 AND interface_name IN (SELECT interface_name FROM watched_interfaces WHERE router_id = $1)
       ORDER BY interface_name, time DESC`,
      [router.id]
    );

    const { rows: wifiClients } = await pool.query(
      `SELECT DISTINCT ON (mac_address) mac_address, hostname, ip_address, ap_identity, ssid, rx_signal, rx_bps, tx_bps, rx_pps, tx_pps, time
       FROM wifi_client_metrics WHERE router_id = $1 ORDER BY mac_address, time DESC`,
      [router.id]
    );

    const { rows: ethClients } = await pool.query(
      `SELECT DISTINCT ON (client_key) client_key, mac_address, ip_address, hostname, port_name, neighbor_identity, confidence, host_count, rx_bps, tx_bps, time
       FROM ethernet_client_metrics WHERE router_id = $1 ORDER BY client_key, time DESC`,
      [router.id]
    );

    // --- Assemble the tree ---
    const problems: { severity: "warn" | "error"; message: string }[] = [];

    const channelNodes = channels.map((c) => {
      const down = c.status !== "up";
      if (down) problems.push({ severity: "error", message: `Канал «${c.interface_name}» не работает (статус: ${c.status})` });
      return {
        id: `channel:${c.interface_name}`,
        type: "cloud" as const,
        label: c.interface_name,
        sub: `${Math.round(c.rx_bps / 1000)} / ${Math.round(c.tx_bps / 1000)} kbps`,
        problem: down ? "down" : null,
        meta: { Статус: c.status, "Rx bps": c.rx_bps, "Tx bps": c.tx_bps, Обновлено: c.time },
      };
    });

    // Group Wi-Fi clients by AP so the tree has an AP node with clients
    // hanging under it, instead of a flat list of dozens of devices.
    const apGroups = new Map<string, typeof wifiClients>();
    for (const c of wifiClients) {
      const ap = c.ap_identity || "Wi-Fi (без AP)";
      if (!apGroups.has(ap)) apGroups.set(ap, []);
      apGroups.get(ap)!.push(c);
    }
    const apNodes = [...apGroups.entries()].map(([ap, clients]) => ({
      id: `ap:${ap}`,
      type: "ap" as const,
      label: ap,
      sub: `${clients.length} клиент(ов)`,
      problem: null as string | null,
      meta: { Интерфейс: ap, "Клиентов сейчас": clients.length },
      children: clients.map((c) => {
        const lowSignal = c.rx_signal !== null && Number(c.rx_signal) < LOW_SIGNAL_DBM;
        const flooding = (c.rx_pps ?? 0) > HIGH_PPS || (c.tx_pps ?? 0) > HIGH_PPS;
        const label = c.hostname || c.ip_address || c.mac_address;
        if (lowSignal) problems.push({ severity: "warn", message: `«${label}» — слабый сигнал (${c.rx_signal} dBm)` });
        if (flooding) problems.push({ severity: "warn", message: `«${label}» — аномально высокий pps (возможен флуд/скан)` });
        return {
          id: `wifi:${c.mac_address}`,
          type: "client-wifi" as const,
          label,
          sub: `${Math.round(c.rx_bps / 1000)}/${Math.round(c.tx_bps / 1000)} kbps · ${c.rx_signal ?? "—"} dBm`,
          problem: lowSignal ? "warn" : flooding ? "warn" : null,
          meta: {
            MAC: c.mac_address,
            IP: c.ip_address,
            Хост: c.hostname,
            SSID: c.ssid,
            "Точка доступа": ap,
            "Сигнал, dBm": c.rx_signal,
            "Rx bps": c.rx_bps,
            "Tx bps": c.tx_bps,
            "Rx pps": c.rx_pps,
            "Tx pps": c.tx_pps,
          },
        };
      }),
    }));

    // Wired: exact = one device on that port (own node); shared/neighbor =
    // a switch-like node representing the port itself, flagged as a
    // bottleneck if it's carrying a lot of hosts behind one uplink.
    const wiredExact = ethClients
      .filter((c) => c.confidence === "exact")
      .map((c) => ({
        id: `eth:${c.client_key}`,
        type: "client-wired" as const,
        label: c.hostname || c.ip_address || c.mac_address,
        sub: `${Math.round(c.rx_bps / 1000)}/${Math.round(c.tx_bps / 1000)} kbps · порт ${c.port_name}`,
        problem: null as string | null,
        meta: {
          MAC: c.mac_address,
          IP: c.ip_address,
          Хост: c.hostname,
          Порт: c.port_name,
          "Rx bps": c.rx_bps,
          "Tx bps": c.tx_bps,
        },
      }));

    const wiredShared = ethClients
      .filter((c) => c.confidence !== "exact")
      .map((c) => {
        // A recognized neighbor (another MikroTik/AP via Neighbor Discovery)
        // carrying many wireless clients behind it is normal mesh
        // architecture — only flag as a bottleneck when there's no such
        // identity, i.e. an unidentified switch/hub with a lot of hosts.
        const bottleneck = !c.neighbor_identity && (c.host_count ?? 0) >= SHARED_PORT_BOTTLENECK_HOSTS;
        const label = c.neighbor_identity || `Порт ${c.port_name}`;
        if (bottleneck) {
          problems.push({
            severity: "warn",
            message: `Порт «${c.port_name}» несёт ${c.host_count} устройств за одним аплинком без опознанного соседа — возможное узкое место`,
          });
        }
        return {
          id: `eth:${c.client_key}`,
          type: "switch" as const,
          label,
          sub: c.host_count ? `${c.host_count} устройств · порт ${c.port_name}` : `порт ${c.port_name}`,
          problem: bottleneck ? "warn" : null,
          meta: {
            Порт: c.port_name,
            "Опознанный сосед": c.neighbor_identity,
            "Устройств за портом": c.host_count,
            "Rx bps": c.rx_bps,
            "Tx bps": c.tx_bps,
          },
        };
      });

    return {
      self: { name: router.name, host: router.host, status: router.status },
      problems,
      channels: channelNodes,
      aps: apNodes,
      wiredDevices: wiredExact,
      wiredSwitches: wiredShared,
      neighbors: neighbors.map((n) => ({
        identity: n.identity ?? null,
        platform: n.platform ?? null,
        address: n.address ?? null,
        interface: n.interface ?? null,
        reachable: n.address ? arpByAddress.has(n.address) : null,
      })),
    };
  });
}
