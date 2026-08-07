import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import {
  getNetworkMap,
  NetworkMap as NetworkMapData,
  NetworkMapNode,
  NetworkMapRouterNode,
  NetworkMapUnknownNode,
  RouterSummary,
} from "./api";
import { ICON, NodeInfoModal } from "./TopologyTab";
import { guessNeighborIcon } from "./deviceIcons";

const NODE_WIDTH = 170;
const NODE_HEIGHT = 56;

// One-shot layered layout, computed fresh on every load — same "no stored
// positions" philosophy as the rest of this app. Top-down/hierarchical reads
// far more cleanly for fleet/uplink relationships than a force-directed
// graph would.
function layout(nodes: NetworkMapNode[], edges: { from: string; to: string }[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 64 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n) => {
    const p = g.node(n.id);
    positions.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  });
  return positions;
}

function RouterNodeView({ data }: NodeProps<NetworkMapRouterNode>) {
  const cls = data.status === "down" ? "problem-down" : data.status === "warn" ? "problem-warn" : "";
  return (
    <div className={`node-box ${cls}`} style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
      <div>{ICON.router} {data.label}</div>
      <div className="node-sub">{data.sub}</div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    </div>
  );
}

function UnknownNodeView({ data }: NodeProps<NetworkMapUnknownNode>) {
  // Neighbor Discovery gives us identity/platform even for devices that
  // aren't one of our managed routers — enough to guess router/AP/switch
  // instead of showing a bare "?" for every non-fleet neighbor.
  const icon = guessNeighborIcon(String(data.meta.Identity ?? "") || null, String(data.meta.Platform ?? "") || null);
  return (
    <div className="node-box" style={{ width: NODE_WIDTH, borderStyle: "dashed", opacity: 0.85 }}>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
      <div>{icon} {data.label}</div>
      <div className="node-sub">{data.sub}</div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    </div>
  );
}

const nodeTypes = { router: RouterNodeView, unknown: UnknownNodeView };

export default function NetworkMap({
  routers,
  onSelectRouter,
}: {
  routers: RouterSummary[];
  onSelectRouter: (r: RouterSummary) => void;
}) {
  const [map, setMap] = useState<NetworkMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoNode, setInfoNode] = useState<NetworkMapNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNetworkMap()
      .then((d) => !cancelled && setMap(d))
      .catch(() => !cancelled && setError("Не удалось загрузить карту сети."));
    return () => {
      cancelled = true;
    };
  }, []);

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!map) return { flowNodes: [] as Node[], flowEdges: [] as Edge[] };
    const positions = layout(map.nodes, map.edges);
    const nodes: Node[] = map.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: n,
    }));
    const edges: Edge[] = map.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label ?? undefined,
      style: { stroke: "var(--border-strong)" },
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    return { flowNodes: nodes, flowEdges: edges };
  }, [map]);

  function handleNodeClick(_event: unknown, node: Node) {
    const mapNode = node.data as NetworkMapNode;
    if (mapNode.type === "router") {
      const router = routers.find((r) => r.id === mapNode.id);
      if (router) {
        onSelectRouter(router);
        return;
      }
    }
    setInfoNode(mapNode);
  }

  if (error) return <p className="muted">{error}</p>;
  if (!map) return <p className="muted">Загрузка…</p>;
  if (!map.nodes.length) return <p className="muted">Роутеров пока нет — добавьте первый.</p>;

  return (
    <div>
      {!!map.warnings.length && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            Не удалось опросить {map.warnings.length} роутер(ов)
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {map.warnings.map((w) => (
              <li key={w.routerId} style={{ fontSize: 13, color: "var(--amber)" }}>
                {w.routerName}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!map.edges.length && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Связей между роутерами не обнаружено — Neighbor Discovery не увидел ни одного известного соседа.
        </p>
      )}
      <div style={{ height: "70vh", border: "0.5px solid var(--border-strong)", borderRadius: "var(--radius)" }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {infoNode && <NodeInfoModal node={infoNode} onClose={() => setInfoNode(null)} />}
    </div>
  );
}
