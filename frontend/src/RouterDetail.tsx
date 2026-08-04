import { useEffect, useRef, useState, ReactNode } from "react";
import Chart from "chart.js/auto";
import TerminalTab from "./TerminalTab";
import TopologyTab from "./TopologyTab";
import {
  RouterSummary,
  getMetrics,
  getLiveInterfaces,
  getLatestInterfaceMetrics,
  getIpAddresses,
  getTopWifiClients,
  WifiTopClient,
  getWifiClientDetail,
  ClientDetail,
  getTopEthernetClients,
  EthernetTopClient,
  getInterfaceMetrics,
  getFirewallRules,
  getDhcpLeases,
  getWifiClients,
  getConfig,
  postConfig,
  testRouter,
  deleteRouter,
  getWatchedInterfaces,
  watchInterface,
  unwatchInterface,
} from "./api";

const TABS = [
  ["mon", "Мониторинг"],
  ["clients-wifi", "Топ Wi-Fi"],
  ["clients-eth", "Топ Ethernet"],
  ["fw", "Firewall"],
  ["dhcp", "DHCP"],
  ["wifi", "Wi-Fi"],
  ["term", "Терминал"],
  ["topo", "Схема сети"],
  ["cfg", "Настройки"],
] as const;

type TabId = (typeof TABS)[number][0];

function ErrorNote({ msg }: { msg: string }) {
  return <p className="muted">{msg}</p>;
}

const PALETTE = ["#5b9ef5", "#5fe3a6", "#f5a742", "#f0556b", "#a78bfa", "#eb6834", "#38bdf8", "#facc15"];
const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: "Выкл", ms: 0 },
  { label: "10с", ms: 10000 },
  { label: "30с", ms: 30000 },
  { label: "1мин", ms: 60000 },
  { label: "5мин", ms: 300000 },
];

function blockOrderKey(routerId: string) {
  return `blockOrder:${routerId}`;
}
function loadBlockOrder(routerId: string): string[] | null {
  try {
    const raw = localStorage.getItem(blockOrderKey(routerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveBlockOrder(routerId: string, order: string[]) {
  try {
    localStorage.setItem(blockOrderKey(routerId), JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

// Chart range + auto-refresh interval are a global UI preference (not
// per-router) — restored on reload or a fresh login in the same browser.
const HOURS_KEY = "monitoring:hours";
const REFRESH_KEY = "monitoring:refreshMs";
function loadNumberPref(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const n = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function savePref(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

// Shared drag-and-drop wrapper — any block (CPU, memory, a given interface's
// traffic card) can be dragged onto any other to reorder the grid. Order is
// persisted per router in localStorage.
function DraggableCard({
  id,
  onDrop,
  down,
  children,
}: {
  id: string;
  onDrop: (sourceId: string, targetId: string) => void;
  down?: boolean;
  children: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`card ${down ? "card-down" : ""} ${dragOver ? "drag-over" : ""}`}
      style={{ marginBottom: 0 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", id);
        e.currentTarget.classList.add("dragging");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const sourceId = e.dataTransfer.getData("text/plain");
        if (sourceId && sourceId !== id) onDrop(sourceId, id);
      }}
    >
      {children}
    </div>
  );
}

function MiniLineChart({
  title,
  points,
  color,
  max,
  suffix,
}: {
  title: string;
  points: { t: string; v: number }[];
  color: string;
  max?: number;
  suffix: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((p) => new Date(p.t).toLocaleTimeString()),
        datasets: [{ data: points.map((p) => p.v), borderColor: color, tension: 0.3, pointRadius: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: max ? { min: 0, max } : { beginAtZero: true } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [points, color, max]);

  const latest = points[points.length - 1];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {latest ? `${Math.round(latest.v)}${suffix}` : "нет данных"}
        </span>
      </div>
      <div style={{ position: "relative", height: 150 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

// Picks kbps vs Mbps per card based on its own peak — a busy WAN uplink and
// an idle backup link shouldn't be forced onto the same unit.
function pickTrafficUnit(points: { rx_bps: number; tx_bps: number }[]): { divisor: number; label: string } {
  let peak = 0;
  for (const p of points) peak = Math.max(peak, p.rx_bps, p.tx_bps);
  return peak >= 1_000_000 ? { divisor: 1_000_000, label: "Mbps" } : { divisor: 1_000, label: "kbps" };
}

function formatRate(bps: number, unit: { divisor: number; label: string }): string {
  const v = bps / unit.divisor;
  return `${unit.label === "Mbps" ? v.toFixed(v < 10 ? 2 : 1) : Math.round(v)} ${unit.label}`;
}

function IfaceTrafficCard({
  name,
  ip,
  down,
  points,
  color,
}: {
  name: string;
  ip: string | undefined;
  down: boolean;
  points: { time: string; rx_bps: number; tx_bps: number }[];
  color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const unit = pickTrafficUnit(points);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((p) => new Date(p.time).toLocaleTimeString()),
        datasets: [
          { label: "Rx", data: points.map((p) => p.rx_bps / unit.divisor), borderColor: color, tension: 0.3, pointRadius: 0 },
          {
            label: "Tx",
            data: points.map((p) => p.tx_bps / unit.divisor),
            borderColor: color,
            borderDash: [4, 3],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { title: { display: true, text: unit.label } } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [points, color, unit.divisor, unit.label]);

  const latest = points[points.length - 1];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{name}</strong>
        {down && <span className="badge down blink">отвал</span>}
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {ip ?? "IP не назначен"}
        {latest && (
          <span>
            {" "}· Rx {formatRate(latest.rx_bps, unit)} · Tx {formatRate(latest.tx_bps, unit)}
          </span>
        )}
      </div>
      <div style={{ position: "relative", height: 150 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function MonitoringTab({ router }: { router: RouterSummary }) {
  const [hours, setHoursState] = useState(() => loadNumberPref(HOURS_KEY, 24));
  const [refreshMs, setRefreshMsState] = useState(() => loadNumberPref(REFRESH_KEY, 30000));
  const [tick, setTick] = useState(0);

  function setHours(h: number) {
    setHoursState(h);
    savePref(HOURS_KEY, h);
  }
  function setRefreshMs(ms: number) {
    setRefreshMsState(ms);
    savePref(REFRESH_KEY, ms);
  }

  const [liveIfaces, setLiveIfaces] = useState<any[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchedError, setWatchedError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [latestBps, setLatestBps] = useState<Map<string, { rx_bps: number; tx_bps: number }>>(new Map());
  const [ipByIface, setIpByIface] = useState<Map<string, string>>(new Map());

  const [cpuPoints, setCpuPoints] = useState<{ t: string; v: number }[]>([]);
  const [memPoints, setMemPoints] = useState<{ t: string; v: number }[]>([]);

  const [ifaceSeries, setIfaceSeries] = useState<Map<string, { time: string; rx_bps: number; tx_bps: number }[]>>(
    new Map()
  );
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<string[]>([]);

  // Auto-refresh ticker.
  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  useEffect(() => {
    let cancelled = false;
    getLiveInterfaces(router.id)
      .then((d) => !cancelled && setLiveIfaces(d))
      .catch(() => !cancelled && setLiveError("Не удалось получить список интерфейсов с роутера."));
    return () => {
      cancelled = true;
    };
  }, [router.id, tick]);

  useEffect(() => {
    let cancelled = false;
    getWatchedInterfaces(router.id)
      .then((names) => !cancelled && setWatched(new Set(names)))
      .catch(() => !cancelled && setWatchedError("Не удалось загрузить список наблюдаемых интерфейсов."));
    return () => {
      cancelled = true;
    };
  }, [router.id]);

  useEffect(() => {
    let cancelled = false;
    getIpAddresses(router.id)
      .then((rows) => !cancelled && setIpByIface(new Map(rows.map((r) => [r.interface, r.address]))))
      .catch(() => {}); // non-critical, cards just omit the IP
    return () => {
      cancelled = true;
    };
  }, [router.id]);

  useEffect(() => {
    let cancelled = false;
    getLatestInterfaceMetrics(router.id)
      .then((latest) => !cancelled && setLatestBps(new Map(latest.map((l) => [l.interface_name, { rx_bps: l.rx_bps, tx_bps: l.tx_bps }]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router.id, tick]);

  async function toggleWatch(name: string) {
    setPending(name);
    try {
      if (watched.has(name)) {
        await unwatchInterface(router.id, name);
        setWatched((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      } else {
        await watchInterface(router.id, name);
        setWatched((prev) => new Set(prev).add(name));
      }
    } finally {
      setPending(null);
    }
  }

  // CPU/memory history.
  useEffect(() => {
    let cancelled = false;
    getMetrics(router.id, hours).then((metrics) => {
      if (cancelled) return;
      setCpuPoints(metrics.map((m) => ({ t: m.time, v: m.cpu_load })));
      setMemPoints(
        metrics.map((m) => ({ t: m.time, v: m.memory_total ? Math.round((m.memory_used / m.memory_total) * 100) : 0 }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, tick]);

  // Per-interface traffic history.
  useEffect(() => {
    if (!watched.size) {
      setIfaceSeries(new Map());
      return;
    }
    let cancelled = false;
    getInterfaceMetrics(router.id, hours)
      .then((rows) => {
        if (cancelled) return;
        const byIface = new Map<string, { time: string; rx_bps: number; tx_bps: number }[]>();
        for (const row of rows) {
          if (!watched.has(row.interface_name)) continue;
          if (!byIface.has(row.interface_name)) byIface.set(row.interface_name, []);
          byIface.get(row.interface_name)!.push({ time: row.time, rx_bps: row.rx_bps, tx_bps: row.tx_bps });
        }
        setIfaceSeries(byIface);
        setSeriesError(null);
      })
      .catch(() => !cancelled && setSeriesError("Не удалось загрузить историю трафика."));
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, watched, tick]);

  // Keep the draggable block order in sync with the current watch list:
  // traffic cards first (as requested), then CPU, then memory by default;
  // a saved order (if compatible) wins, new interfaces get appended.
  useEffect(() => {
    const ifaceIds = [...watched].map((n) => `iface:${n}`);
    const desired = [...ifaceIds, "cpu", "mem"];
    const saved = loadBlockOrder(router.id);
    const base = saved && saved.length ? saved.filter((id) => desired.includes(id)) : [];
    const missing = desired.filter((id) => !base.includes(id));
    setBlocks([...base, ...missing]);
  }, [watched, router.id]);

  function moveBlock(sourceId: string, targetId: string) {
    setBlocks((prev) => {
      const next = [...prev];
      const from = next.indexOf(sourceId);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, sourceId);
      saveBlockOrder(router.id, next);
      return next;
    });
  }

  function isIfaceDown(name: string): boolean {
    const live = liveIfaces?.find((i) => i.name === name);
    if (!live) return false;
    return live.running !== "true" && live.disabled !== "true";
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
              {h === 1 ? "1ч" : h === 24 ? "24ч" : "7д"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>Автообновление:</span>
          {REFRESH_OPTIONS.map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: pickerOpen ? 10 : 20 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Наблюдаемые интерфейсы {watched.size ? `(${watched.size} выбрано)` : ""}
        </span>
        <button onClick={() => setPickerOpen((v) => !v)}>{pickerOpen ? "Свернуть" : "Выбрать интерфейсы"}</button>
      </div>
      {pickerOpen && (
        <>
          {watchedError && <ErrorNote msg={watchedError} />}
          {liveError && <ErrorNote msg={liveError} />}
          {!liveIfaces && !liveError && <ErrorNote msg="Загрузка интерфейсов…" />}
          {liveIfaces && (
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr><th style={{ width: 30 }}></th><th>Интерфейс</th><th>Статус</th><th>Rx bps</th><th>Tx bps</th></tr>
              </thead>
              <tbody>
                {liveIfaces.map((i, idx) => {
                  const down = i.running !== "true" && i.disabled !== "true";
                  const rates = latestBps.get(i.name);
                  return (
                    <tr key={idx}>
                      <td>
                        <input type="checkbox" checked={watched.has(i.name)} disabled={pending === i.name} onChange={() => toggleWatch(i.name)} />
                      </td>
                      <td>{i.name}</td>
                      <td>
                        <span className={`badge ${i.disabled === "true" ? "unknown" : i.running === "true" ? "up" : "down"} ${down ? "blink" : ""}`}>
                          {i.disabled === "true" ? "выключен" : i.running === "true" ? "работает" : "отвал"}
                        </span>
                      </td>
                      <td className="mono">{rates ? rates.rx_bps.toLocaleString() : "— (ждём опроса)"}</td>
                      <td className="mono">{rates ? rates.tx_bps.toLocaleString() : "— (ждём опроса)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {seriesError && <ErrorNote msg={seriesError} />}
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
        Блоки можно перетаскивать мышью — порядок сохраняется для этого роутера.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {blocks.map((id) => {
          if (id === "cpu") {
            return (
              <DraggableCard key="cpu" id="cpu" onDrop={moveBlock}>
                <MiniLineChart title="CPU" points={cpuPoints} color="#1baf7a" max={100} suffix="%" />
              </DraggableCard>
            );
          }
          if (id === "mem") {
            return (
              <DraggableCard key="mem" id="mem" onDrop={moveBlock}>
                <MiniLineChart title="Память" points={memPoints} color="#4a3aa7" max={100} suffix="%" />
              </DraggableCard>
            );
          }
          const name = id.slice("iface:".length);
          const idx = [...watched].indexOf(name);
          return (
            <DraggableCard key={id} id={id} onDrop={moveBlock} down={isIfaceDown(name)}>
              <IfaceTrafficCard
                name={name}
                ip={ipByIface.get(name)}
                down={isIfaceDown(name)}
                points={ifaceSeries.get(name) ?? []}
                color={PALETTE[idx % PALETTE.length]}
              />
            </DraggableCard>
          );
        })}
      </div>
    </div>
  );
}


const CLIENTS_HOURS_KEY = "clients:hours";
const CLIENTS_REFRESH_KEY = "clients:refreshMs";
const CLIENTS_LIMIT_KEY = "clients:limit";

function useClientPrefs(namespace: string) {
  const hoursKey = `${namespace}:hours`;
  const refreshKey = `${namespace}:refreshMs`;
  const limitKey = `${namespace}:limit`;
  const [hours, setHoursState] = useState(() => loadNumberPref(hoursKey, 24));
  const [refreshMs, setRefreshMsState] = useState(() => loadNumberPref(refreshKey, 30000));
  const [limit, setLimitState] = useState(() => loadNumberPref(limitKey, 15));
  function setHours(h: number) { setHoursState(h); savePref(hoursKey, h); }
  function setRefreshMs(ms: number) { setRefreshMsState(ms); savePref(refreshKey, ms); }
  function setLimit(n: number) { setLimitState(n); savePref(limitKey, n); }
  return { hours, setHours, refreshMs, setRefreshMs, limit, setLimit };
}

function ClientCardChart({
  series,
  color,
  latestRx,
  latestTx,
}: {
  series: { time: string; rx_bps: number; tx_bps: number }[];
  color: string;
  latestRx: number;
  latestTx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const unit = pickTrafficUnit(series);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: series.map((p) => new Date(p.time).toLocaleTimeString()),
        datasets: [
          { label: "Rx", data: series.map((p) => p.rx_bps / unit.divisor), borderColor: color, tension: 0.3, pointRadius: 0 },
          {
            label: "Tx",
            data: series.map((p) => p.tx_bps / unit.divisor),
            borderColor: color,
            borderDash: [4, 3],
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { title: { display: true, text: unit.label } } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [series, color, unit.divisor, unit.label]);

  return (
    <>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 4 }}>
        Rx {formatRate(latestRx, unit)} · Tx {formatRate(latestTx, unit)}
      </div>
      <div style={{ position: "relative", height: 150 }}>
        <canvas ref={canvasRef} />
      </div>
    </>
  );
}

function WifiClientCard({ client, color, onDetail }: { client: WifiTopClient; color: string; onDetail: (mac: string) => void }) {
  const title = client.hostname || client.ip || client.mac;
  const subtitleParts = [
    client.hostname && client.ip ? client.ip : null,
    client.mac,
    client.ap ? `AP: ${client.ap}` : null,
    client.ssid,
    client.signal !== null ? `${client.signal} dBm` : null,
  ].filter(Boolean);

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button onClick={() => onDetail(client.mac)} style={{ fontSize: 11, padding: "3px 8px" }}>Детально</button>
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {subtitleParts.join(" · ")}
      </div>
      <ClientCardChart series={client.series} color={color} latestRx={client.latest.rx_bps} latestTx={client.latest.tx_bps} />
    </div>
  );
}

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "точно",
  shared: "общий порт",
  neighbor: "сосед",
};

function EthernetClientCard({ client, color }: { client: EthernetTopClient; color: string }) {
  const title = client.confidence === "exact" ? client.hostname || client.ip || client.mac || client.port : `Порт ${client.port}`;
  const subtitleParts = [
    client.confidence === "exact" && client.ip ? client.ip : null,
    client.confidence === "exact" ? client.mac : null,
    client.port ? `Порт: ${client.port}` : null,
    client.neighborIdentity ? `Сосед: ${client.neighborIdentity}` : null,
    client.confidence !== "exact" && client.hostCount ? `${client.hostCount} устройств` : null,
  ].filter(Boolean);

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="badge unknown">{CONFIDENCE_LABEL[client.confidence]}</span>
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {subtitleParts.join(" · ")}
      </div>
      <ClientCardChart series={client.series} color={color} latestRx={client.latest.rx_bps} latestTx={client.latest.tx_bps} />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}д`);
  if (h || d) parts.push(`${h}ч`);
  parts.push(`${m}м`);
  return parts.join(" ");
}

export function ClientDetailModal({ router, mac, onClose }: { router: RouterSummary; mac: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWifiClientDetail(router.id, mac, 24)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError("Не удалось загрузить детали клиента."));
    return () => {
      cancelled = true;
    };
  }, [router.id, mac]);

  const unit = detail ? pickTrafficUnit(detail.series.map((p) => ({ rx_bps: p.rx_bps, tx_bps: p.tx_bps }))) : null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!detail || !canvasRef.current || !unit) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: detail.series.map((p) => new Date(p.time).toLocaleTimeString()),
        datasets: [
          { label: "Rx", data: detail.series.map((p) => p.rx_bps / unit.divisor), borderColor: "#5b9ef5", tension: 0.3, pointRadius: 0 },
          { label: "Tx", data: detail.series.map((p) => p.tx_bps / unit.divisor), borderColor: "#5b9ef5", borderDash: [4, 3], tension: 0.3, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { title: { display: true, text: unit.label } } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [detail, unit]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <h2>Детали клиента</h2>
        {error && <ErrorNote msg={error} />}
        {!detail && !error && <p className="muted">Загрузка…</p>}
        {detail && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{detail.hostname || detail.ip || detail.mac}</strong>
              <span className={`badge ${detail.online ? "up" : "down"}`}>{detail.online ? "в сети" : "не в сети"}</span>
            </div>
            <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
              {detail.mac} {detail.ip ? `· ${detail.ip}` : ""}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Производитель</div>
                <div>{detail.vendor ?? "неизвестен"}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Подключён с</div>
                <div>
                  {detail.connectedSince
                    ? new Date(detail.connectedSince).toLocaleString() +
                      ` (${formatDuration((Date.now() - new Date(detail.connectedSince).getTime()) / 1000)})`
                    : "неизвестно"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Точка доступа / SSID</div>
                <div>{detail.apOrInterface ?? "—"}{detail.ssid ? ` · ${detail.ssid}` : ""}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Сигнал</div>
                <div>{detail.signal !== null ? `${detail.signal} dBm` : "—"}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Скорость канала (Rx/Tx PHY)</div>
                <div className="mono" style={{ fontSize: 12 }}>{detail.rxRate ?? "—"} / {detail.txRate ?? "—"}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>В сети с (DHCP)</div>
                <div>{detail.firstSeenDhcp ? new Date(detail.firstSeenDhcp).toLocaleString() : "неизвестно"}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>Начал генерировать трафик</div>
                <div>{detail.firstTrafficAt ? new Date(detail.firstTrafficAt).toLocaleString() : "пока не зафиксировано"}</div>
              </div>
            </div>

            {unit && detail.series.length > 0 && (
              <>
                <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>Трафик за 24ч</div>
                <div style={{ position: "relative", height: 160, marginBottom: 12 }}>
                  <canvas ref={canvasRef} />
                </div>
                {(() => {
                  const latestPoint = detail.series[detail.series.length - 1];
                  if (!latestPoint || (latestPoint.rx_pps === null && latestPoint.tx_pps === null)) return null;
                  return (
                    <p className="muted mono" style={{ fontSize: 12, marginBottom: 20 }}>
                      Пакетов/сек сейчас: Rx {latestPoint.rx_pps ?? "—"} · Tx {latestPoint.tx_pps ?? "—"}
                      {" — "}резкий рост pps без роста трафика в kbps часто означает сканирование портов или флуд
                      мелкими пакетами.
                    </p>
                  );
                })()}
              </>
            )}

            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Разбивка по каналам (провайдер/VPN) убрана — смотрите вкладку «Мониторинг». Ниже — только адреса и
              порты назначения, без определения исходящего интерфейса (дёшево: RouterOS фильтрует по IP на своей
              стороне).
            </p>
            <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>Топ адресов и портов</div>
            {!detail.topDestinations.length && (
              <p className="muted" style={{ fontSize: 12 }}>Нет данных — клиент сейчас не активен.</p>
            )}
            {!!detail.topDestinations.length && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Адрес</th><th>Порт</th><th>Протокол</th><th>Соединений</th><th>Байт</th></tr>
                  </thead>
                  <tbody>
                    {detail.topDestinations.map((d, i) => (
                      <tr key={i}>
                        <td className="mono">{d.ip}</td>
                        <td className="mono">{d.port ?? "—"}</td>
                        <td>{d.protocol ?? "—"}</td>
                        <td>{d.connections}</td>
                        <td className="mono">{(d.bytes / 1024).toFixed(1)} KB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function TopWifiClientsTab({ router }: { router: RouterSummary }) {
  const { hours, setHours, refreshMs, setRefreshMs, limit, setLimit } = useClientPrefs(CLIENTS_HOURS_KEY + ":wifi");
  const [tick, setTick] = useState(0);
  const [clients, setClients] = useState<WifiTopClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailMac, setDetailMac] = useState<string | null>(null);

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  useEffect(() => {
    let cancelled = false;
    getTopWifiClients(router.id, hours, limit)
      .then((d) => !cancelled && setClients(d))
      .catch(() => !cancelled && setError("Не удалось загрузить данные клиентов. Возможно, на этом роутере не настроен CAPsMAN, либо ещё не накопилось ни одного опроса."));
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, limit, tick]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
        Данные собираются с CAPsMAN (регистрационная таблица клиентов точек доступа), имена и IP — из DHCP и ARP.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
              {h === 1 ? "1ч" : h === 24 ? "24ч" : "7д"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>Показывать топ:</span>
          {[10, 15, 25].map((n) => (
            <button key={n} onClick={() => setLimit(n)} style={limit === n ? { borderColor: "var(--blue)" } : undefined}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>Автообновление:</span>
          {[{ label: "Выкл", ms: 0 }, { label: "10с", ms: 10000 }, { label: "30с", ms: 30000 }, { label: "1мин", ms: 60000 }].map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote msg={error} />}
      {!clients && !error && <ErrorNote msg="Загрузка…" />}
      {clients && !clients.length && !error && (
        <ErrorNote msg="Пока нет данных — либо на роутере не настроен CAPsMAN, либо клиенты появятся после следующего опроса." />
      )}
      {clients && !!clients.length && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {clients.map((c, idx) => (
            <WifiClientCard key={c.key} client={c} color={PALETTE[idx % PALETTE.length]} onDetail={setDetailMac} />
          ))}
        </div>
      )}
      {detailMac && <ClientDetailModal router={router} mac={detailMac} onClose={() => setDetailMac(null)} />}
    </div>
  );
}

function TopEthernetClientsTab({ router }: { router: RouterSummary }) {
  const { hours, setHours, refreshMs, setRefreshMs, limit, setLimit } = useClientPrefs(CLIENTS_HOURS_KEY + ":eth");
  const [tick, setTick] = useState(0);
  const [clients, setClients] = useState<EthernetTopClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  useEffect(() => {
    let cancelled = false;
    getTopEthernetClients(router.id, hours, limit)
      .then((d) => !cancelled && setClients(d))
      .catch(() => !cancelled && setError("Не удалось загрузить данные проводных клиентов."));
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, limit, tick]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
        Без настройки Simple Queue: если на порту виден ровно один MAC (таблица бриджа) — его скорость показана точно
        («точно»). Порт с несколькими устройствами или ведущий к другому MikroTik/свитчу (Neighbor Discovery)
        показывается честно как общий/соседний, без придуманных цифр на одно устройство.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
              {h === 1 ? "1ч" : h === 24 ? "24ч" : "7д"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>Показывать топ:</span>
          {[10, 15, 25].map((n) => (
            <button key={n} onClick={() => setLimit(n)} style={limit === n ? { borderColor: "var(--blue)" } : undefined}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>Автообновление:</span>
          {[{ label: "Выкл", ms: 0 }, { label: "10с", ms: 10000 }, { label: "30с", ms: 30000 }, { label: "1мин", ms: 60000 }].map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote msg={error} />}
      {!clients && !error && <ErrorNote msg="Загрузка…" />}
      {clients && !clients.length && !error && (
        <ErrorNote msg="Пока нет данных — либо на роутере нет бриджа, либо клиенты появятся после следующего опроса." />
      )}
      {clients && !!clients.length && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {clients.map((c, idx) => (
            <EthernetClientCard key={c.key} client={c} color={PALETTE[idx % PALETTE.length]} />
          ))}
        </div>
      )}
    </div>
  );
}

const FIREWALL_REFRESH_KEY = "firewall:refreshMs";

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function FirewallTab({ router }: { router: RouterSummary }) {
  const [rules, setRules] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshMs, setRefreshMsState] = useState(() => loadNumberPref(FIREWALL_REFRESH_KEY, 15000));
  const [tick, setTick] = useState(0);
  const [rates, setRates] = useState<Map<string, { bps: number; pps: number }>>(new Map());
  const prevSnapshot = useRef<Map<string, { bytes: number; packets: number; time: number }>>(new Map());

  function setRefreshMs(ms: number) {
    setRefreshMsState(ms);
    savePref(FIREWALL_REFRESH_KEY, ms);
  }

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  useEffect(() => {
    let cancelled = false;
    getFirewallRules(router.id)
      .then((data) => {
        if (cancelled) return;
        const now = Date.now();
        const nextRates = new Map<string, { bps: number; pps: number }>();
        for (const r of data) {
          const id = r[".id"];
          const bytes = Number(r.bytes ?? 0);
          const packets = Number(r.packets ?? 0);
          const prev = prevSnapshot.current.get(id);
          if (prev) {
            const dtSec = (now - prev.time) / 1000;
            if (dtSec > 0 && bytes >= prev.bytes) {
              nextRates.set(id, { bps: Math.round(((bytes - prev.bytes) * 8) / dtSec), pps: Math.round((packets - prev.packets) / dtSec) });
            }
          }
          prevSnapshot.current.set(id, { bytes, packets, time: now });
        }
        setRates(nextRates);
        setRules(data);
      })
      .catch(() => !cancelled && setError("Роутер недоступен — правила не получены."));
    return () => {
      cancelled = true;
    };
  }, [router.id, tick]);

  if (error) return <ErrorNote msg={error} />;
  if (!rules) return <ErrorNote msg="Загрузка…" />;
  if (!rules.length) return <ErrorNote msg="Правил firewall нет." />;

  // Position of each rule within its own chain, in the order RouterOS
  // returned them (which is the actual evaluation order) — used for the
  // "possible bottleneck" heuristic below.
  const chainCounts = new Map<string, number>();
  const chainIndex = new Map<string, number>();
  for (const r of rules) {
    const idx = chainCounts.get(r.chain) ?? 0;
    chainIndex.set(r[".id"], idx);
    chainCounts.set(r.chain, idx + 1);
  }
  const maxPackets = Math.max(1, ...rules.map((r) => Number(r.packets ?? 0)));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 12 }}>Автообновление счётчиков:</span>
        {[{ label: "Выкл", ms: 0 }, { label: "5с", ms: 5000 }, { label: "15с", ms: 15000 }, { label: "1мин", ms: 60000 }].map((o) => (
          <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        Скорость (bps/pps) считается по разнице счётчиков между обновлениями — появится после второго опроса.
        «Возможное узкое место» — эвристика: правило стоит далеко в цепочке (после многих других) и при этом
        через него проходит заметная доля пакетов этой цепочки — стоит проверить порядок правил.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Chain</th><th>Action</th><th>Src</th><th>Dst</th><th>Packets</th><th>Bytes</th><th>Скорость</th><th>Статус</th></tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const id = r[".id"];
              const packets = Number(r.packets ?? 0);
              const rate = rates.get(id);
              const idx = chainIndex.get(id) ?? 0;
              const chainLen = chainCounts.get(r.chain) ?? 1;
              const isBottleneck = idx > chainLen / 2 && packets > maxPackets * 0.15;
              let statusBadge: { cls: string; text: string };
              if (packets === 0) statusBadge = { cls: "unknown", text: "не сработало" };
              else if (rate && rate.pps > 0) statusBadge = { cls: "up", text: "активно" };
              else statusBadge = { cls: "warn", text: "сейчас тихо" };

              return (
                <tr key={id ?? i}>
                  <td>{r.chain}</td>
                  <td>{r.action}</td>
                  <td className="mono">{r["src-address"] ?? "any"}</td>
                  <td className="mono">{r["dst-address"] ?? "any"}</td>
                  <td className="mono">{packets.toLocaleString()}</td>
                  <td className="mono">{formatBytes(Number(r.bytes ?? 0))}</td>
                  <td className="mono">{rate ? `${Math.round(rate.bps / 1000)} kbps` : "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
                      {isBottleneck && <span className="badge warn" title="Далеко в цепочке и заметная доля пакетов — проверьте порядок правил">⚠️ узкое место?</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DhcpTab({ router }: { router: RouterSummary }) {
  const [leases, setLeases] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDhcpLeases(router.id).then(setLeases).catch(() => setError("Роутер недоступен — аренды не получены."));
  }, [router.id]);

  if (error) return <ErrorNote msg={error} />;
  if (!leases) return <ErrorNote msg="Загрузка…" />;
  if (!leases.length) return <ErrorNote msg="Нет активных аренд." />;

  return (
    <table>
      <thead><tr><th>IP</th><th>MAC</th><th>Хост</th><th>Статус</th><th>В сети с</th></tr></thead>
      <tbody>
        {leases.map((l, i) => (
          <tr key={i}>
            <td className="mono">{l.address}</td>
            <td className="mono">{l["mac-address"]}</td>
            <td>{l["host-name"] ?? "—"}</td>
            <td>{l.status}</td>
            <td className="mono" style={{ fontSize: 11 }}>
              {l["first-seen"] ? new Date(l["first-seen"]).toLocaleString() : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WifiTab({ router }: { router: RouterSummary }) {
  const [clients, setClients] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWifiClients(router.id).then(setClients).catch(() => setError("Wi-Fi недоступен на этом роутере."));
  }, [router.id]);

  if (error) return <ErrorNote msg={error} />;
  if (!clients) return <ErrorNote msg="Загрузка…" />;
  if (!clients.length) return <ErrorNote msg="Нет подключённых клиентов." />;

  return (
    <table>
      <thead><tr><th>MAC</th><th>Интерфейс</th><th>Сигнал</th></tr></thead>
      <tbody>
        {clients.map((c, i) => (
          <tr key={i}><td className="mono">{c["mac-address"]}</td><td>{c.interface}</td><td>{c["signal-strength"] ?? "—"}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfigTab({ router, onDeleted }: { router: RouterSummary; onDeleted: () => void }) {
  const [path, setPath] = useState("/ip/address");
  const [result, setResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function runGet() {
    setBusy(true);
    try {
      const data = await getConfig(router.id, path);
      setResult(JSON.stringify(data, null, 2));
    } catch {
      setResult("Ошибка: роутер недоступен или путь неверный.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await testRouter(router.id);
      setTestResult({ ok: true, msg: "Роутер отвечает." });
    } catch {
      setTestResult({ ok: false, msg: "Роутер недоступен." });
    } finally {
      setTesting(false);
    }
  }

  async function runDelete() {
    if (!confirm(`Удалить роутер «${router.name}»? Это действие необратимо.`)) return;
    setDeleting(true);
    try {
      await deleteRouter(router.id);
      onDeleted();
    } catch {
      setTestResult({ ok: false, msg: "Не удалось удалить роутер. Проверьте права доступа." });
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={runTest} disabled={testing}>{testing ? "Проверяем…" : "Проверить связь"}</button>
          <button onClick={runDelete} disabled={deleting} style={{ borderColor: "var(--red)", color: "var(--red)" }}>
            {deleting ? "Удаляем…" : "Удалить роутер"}
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: testResult.ok ? "var(--mint)" : "var(--red)" }}>
            {testResult.msg}
          </div>
        )}
      </div>

      <p className="muted" style={{ marginBottom: 12 }}>
        Прямой доступ к любому меню RouterOS REST API — путь как в консоли, например{" "}
        <code className="mono">/ip/firewall/nat</code> или <code className="mono">/interface/bridge</code>.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input className="mono" style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="primary" onClick={runGet} disabled={busy}>{busy ? "…" : "GET"}</button>
      </div>
      {result && <pre className="mono" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto" }}>{result}</pre>}
    </div>
  );
}

export default function RouterDetail({ router, onDeleted }: { router: RouterSummary; onDeleted: () => void }) {
  const [tab, setTab] = useState<TabId>("mon");
  const [terminalActivated, setTerminalActivated] = useState(false);

  useEffect(() => {
    if (tab === "term") setTerminalActivated(true);
  }, [tab]);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", rowGap: 8 }}>
        <div>
          <div style={{ fontWeight: 500 }}>{router.name}</div>
          <div className="muted mono">{router.host}:{router.port} · {router.model ?? "неизвестная модель"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={`badge ${router.status}`}>{router.status}</span>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "mon" && <MonitoringTab router={router} />}
      {tab === "clients-wifi" && <TopWifiClientsTab router={router} />}
      {tab === "clients-eth" && <TopEthernetClientsTab router={router} />}
      {tab === "fw" && <FirewallTab router={router} />}
      {tab === "dhcp" && <DhcpTab router={router} />}
      {tab === "wifi" && <WifiTab router={router} />}
      {terminalActivated && (
        <div style={{ display: tab === "term" ? "block" : "none" }}>
          <TerminalTab router={router} active={tab === "term"} />
        </div>
      )}
      {tab === "topo" && <TopologyTab router={router} />}
      {tab === "cfg" && <ConfigTab router={router} onDeleted={onDeleted} />}
    </div>
  );
}
