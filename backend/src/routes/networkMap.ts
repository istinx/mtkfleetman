import { FastifyInstance } from "fastify";
import { authUser } from "../plugins/auth";
import { pool } from "../db/pool";
import { RouterRow, clientFor } from "../db/routers";
import { logEvent } from "../logging/dbLog";

// Same batching convention as queue/worker.ts — fan out to every router in
// the fleet without hammering all of them (or the event loop) at once.
const CONCURRENCY = 5;

export interface NetworkMapRouterNode {
  id: string;
  type: "router";
  label: string;
  sub: string;
  status: "up" | "warn" | "down" | "unknown";
  meta: Record<string, unknown>;
}

export interface NetworkMapUnknownNode {
  id: string;
  type: "unknown";
  label: string;
  sub: string;
  meta: Record<string, unknown>;
}

export type NetworkMapNode = NetworkMapRouterNode | NetworkMapUnknownNode;

export interface NetworkMapEdge {
  id: string;
  from: string;
  to: string;
  fromInterface: string | null;
  label: string | null;
}

export interface NetworkMapWarning {
  routerId: string;
  routerName: string;
  message: string;
}

export interface NetworkMap {
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
  warnings: NetworkMapWarning[];
}

type RouterListRow = Pick<
  RouterRow,
  "id" | "name" | "host" | "port" | "use_tls" | "username" | "password_encrypted" | "model" | "status"
>;

export default async function networkMapRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Fleet-wide map, fetched only when the tab is opened (no polling, no
  // persistence) — the same "live on demand" philosophy as the per-router
  // topology endpoint. Neighbor-to-router matching is done purely by
  // comparing what a router's Neighbor Discovery (MNDP/CDP/LLDP, all
  // surfaced together by RouterOS under /ip/neighbor) reports as a
  // neighbor's address against another router's stored management host.
  // Known limitation: this breaks if a router's `host` is a DNS name, or if
  // its management address differs from the address Neighbor Discovery
  // advertises — such neighbors simply surface as "unknown" leaf nodes
  // instead of linking back to their real fleet entry, rather than being
  // dropped or guessed at.
  app.get("/network-map", async (req) => {
    const { tenantId } = authUser(req);
    const { rows: routers } = await pool.query<RouterListRow>(
      `SELECT id, name, host, port, use_tls, username, password_encrypted, model, status
       FROM routers WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]
    );

    const routerByHost = new Map<string, RouterListRow>();
    for (const r of routers) routerByHost.set(r.host, r);

    const warnings: NetworkMapWarning[] = [];
    const neighborsByRouter = new Map<string, any[]>();

    for (let i = 0; i < routers.length; i += CONCURRENCY) {
      const batch = routers.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((r) => clientFor(r as RouterRow).getIpNeighbors())
      );
      results.forEach((res, idx) => {
        const router = batch[idx];
        if (res.status === "fulfilled") {
          neighborsByRouter.set(router.id, res.value as any[]);
        } else {
          const message = "Роутер недоступен — данные Neighbor Discovery не получены";
          warnings.push({ routerId: router.id, routerName: router.name, message });
          logEvent("api", "warn", `Network map: neighbor lookup failed for "${router.name}"`, {
            error: (res.reason as any)?.message ?? String(res.reason),
          }, router.id);
        }
      });
    }

    const nodes: NetworkMapNode[] = routers.map((r) => ({
      id: r.id,
      type: "router",
      label: r.name,
      sub: `${r.host}${r.model ? " · " + r.model : ""}`,
      status: r.status as NetworkMapRouterNode["status"],
      meta: { Хост: r.host, Порт: r.port, Модель: r.model, Статус: r.status },
    }));
    const unknownNodeIds = new Set<string>();
    const edgesByPairKey = new Map<string, NetworkMapEdge>();

    for (const router of routers) {
      const neighbors = neighborsByRouter.get(router.id) ?? [];
      for (const n of neighbors) {
        const address: string | null = n.address ?? null;
        const identity: string | null = n.identity ?? null;
        const mac: string | null = n["mac-address"] ?? null;
        const platform: string | null = n.platform ?? null;

        const matched = address ? routerByHost.get(address) : undefined;
        let targetId: string;
        if (matched) {
          targetId = matched.id;
        } else {
          const unknownKey = address ?? identity ?? mac;
          if (!unknownKey) continue; // nothing to key a stable node on — skip
          targetId = `unknown:${unknownKey}`;
          if (!unknownNodeIds.has(targetId)) {
            unknownNodeIds.add(targetId);
            nodes.push({
              id: targetId,
              type: "unknown",
              label: identity || platform || address || unknownKey,
              sub: platform || address || "",
              meta: { Identity: identity, Platform: platform, Address: address, MAC: mac },
            });
          }
        }

        if (targetId === router.id) continue; // ignore self-neighbor noise

        // Neighbor Discovery is often bidirectional (A sees B and B sees A)
        // and can report the same neighbor from more than one port — dedupe
        // on the unordered pair so the map doesn't double-draw every link.
        const pairKey = [router.id, targetId].sort().join("|");
        if (!edgesByPairKey.has(pairKey)) {
          edgesByPairKey.set(pairKey, {
            id: pairKey,
            from: router.id,
            to: targetId,
            fromInterface: n.interface ?? null,
            label: platform,
          });
        }
      }
    }

    return { nodes, edges: [...edgesByPairKey.values()], warnings } satisfies NetworkMap;
  });
}
