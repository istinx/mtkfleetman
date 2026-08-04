import { useEffect, useState } from "react";
import { getTopology, Topology, TopologyNode, TopologyApNode, RouterSummary } from "./api";
import { ClientDetailModal } from "./RouterDetail";

export const ICON: Record<string, string> = {
  cloud: "☁",
  ap: "📶",
  "client-wifi": "📱",
  "client-wired": "🖥",
  switch: "🔌",
  router: "🖧",
  unknown: "❔",
};

// Loose shape so this modal can also show NetworkMapNode meta (router / unknown
// devices from the network map), not just TopologyNode.
export interface InspectableNode {
  type: string;
  label: string;
  meta: Record<string, unknown>;
}

function NodeBox({ node, onClick }: { node: TopologyNode; onClick: () => void }) {
  const cls = node.problem === "down" ? "problem-down" : node.problem === "warn" ? "problem-warn" : "";
  return (
    <div className={`node-box ${cls}`} onClick={onClick}>
      <div>{ICON[node.type] ?? "•"} {node.label}</div>
      <div className="node-sub">{node.sub}</div>
    </div>
  );
}

export function NodeInfoModal({ node, onClose }: { node: InspectableNode; onClose: () => void }) {
  const entries = Object.entries(node.meta).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h2>{ICON[node.type] ?? ""} {node.label}</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}><td className="muted" style={{ paddingRight: 16 }}>{k}</td><td className="mono">{String(v)}</td></tr>
              ))}
              {!entries.length && <tr><td className="muted">Нет дополнительных данных.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

export default function TopologyTab({ router }: { router: RouterSummary }) {
  const [topo, setTopo] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoNode, setInfoNode] = useState<TopologyNode | null>(null);
  const [wifiDetailMac, setWifiDetailMac] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTopology(router.id)
      .then((d) => !cancelled && setTopo(d))
      .catch(() => !cancelled && setError("Не удалось загрузить схему сети."));
    return () => {
      cancelled = true;
    };
  }, [router.id]);

  function handleClick(node: TopologyNode) {
    if (node.type === "client-wifi") {
      setWifiDetailMac(String(node.meta.MAC ?? node.id.replace("wifi:", "")));
    } else {
      setInfoNode(node);
    }
  }

  if (error) return <p className="muted">{error}</p>;
  if (!topo) return <p className="muted">Загрузка…</p>;

  const hasAnything = topo.channels.length || topo.aps.length || topo.wiredDevices.length || topo.wiredSwitches.length;

  return (
    <div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        Собрано из уже опрашиваемых данных — без ping/traceroute и без живых запросов к таблице маршрутов или
        conntrack. Кликните по любому узлу, чтобы увидеть максимум собранных о нём данных.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>
          {topo.problems.length ? `Найдено проблем: ${topo.problems.length}` : "Проблем не обнаружено"}
        </div>
        {!!topo.problems.length && (
          <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflowY: "auto" }}>
            {topo.problems.map((p, i) => (
              <li key={i} style={{ fontSize: 13, color: p.severity === "error" ? "var(--red)" : "var(--amber)" }}>
                {p.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!hasAnything && (
        <p className="muted">
          Пока нечего показать — либо не отмечены интерфейсы во вкладке «Мониторинг», либо ещё не накопилось данных
          по Wi-Fi/Ethernet клиентам.
        </p>
      )}

      {!!hasAnything && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 500, marginBottom: 14 }}>🖧 {topo.self.name}</div>

          {!!topo.channels.length && (
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Каналы (провайдер/VPN)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {topo.channels.map((n) => <NodeBox key={n.id} node={n} onClick={() => handleClick(n)} />)}
              </div>
            </div>
          )}

          {!!topo.wiredDevices.length && (
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Проводные устройства (точно определены)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {topo.wiredDevices.map((n) => <NodeBox key={n.id} node={n} onClick={() => handleClick(n)} />)}
              </div>
            </div>
          )}

          {!!topo.wiredSwitches.length && (
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Порты с несколькими устройствами / соседями</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {topo.wiredSwitches.map((n) => <NodeBox key={n.id} node={n} onClick={() => handleClick(n)} />)}
              </div>
            </div>
          )}

          {!!topo.aps.length && (
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Точки доступа и их клиенты</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {topo.aps.map((ap: TopologyApNode) => (
                  <div key={ap.id} style={{ borderLeft: "2px solid var(--border-strong)", paddingLeft: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <NodeBox node={ap} onClick={() => handleClick(ap)} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 16 }}>
                      {ap.children.map((c) => <NodeBox key={c.id} node={c} onClick={() => handleClick(c)} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!!topo.neighbors.length && (
        <div>
          <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Соседи (Neighbor Discovery, справочно)</div>
          <table>
            <thead><tr><th></th><th>Identity</th><th>Platform</th><th>Адрес</th><th>Порт</th></tr></thead>
            <tbody>
              {topo.neighbors.map((n, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: n.reachable ? "var(--mint)" : n.reachable === false ? "var(--red)" : "var(--text-muted)" }} />
                  </td>
                  <td>{n.identity ?? "—"}</td>
                  <td>{n.platform ?? "—"}</td>
                  <td className="mono">{n.address ?? "—"}</td>
                  <td>{n.interface ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {infoNode && <NodeInfoModal node={infoNode} onClose={() => setInfoNode(null)} />}
      {wifiDetailMac && <ClientDetailModal router={router} mac={wifiDetailMac} onClose={() => setWifiDetailMac(null)} />}
    </div>
  );
}
