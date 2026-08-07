import { useEffect, useRef, useState, ReactNode, Fragment } from "react";
import { useTranslation } from "react-i18next";
import Chart from "chart.js/auto";
import { guessDeviceIcon } from "./deviceIcons";
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
  getDhcpPoolUsage,
  DhcpPoolUsage,
  getDeviceEvents,
  DeviceEvent,
  getTopBlocked,
  TopBlockedEntry,
  getTopDestinations,
  TopDestination,
  getEthernetClientDestinations,
  EthernetDestinations,
  getWifiClients,
  getConfig,
  postConfig,
  testRouter,
  deleteRouter,
  updateRouter,
  getRouter,
  RouterDetailFull,
  getRouterStatusReason,
  RouterStatusReason,
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
  ["dest", "Топ адресов назначения"],
  ["term", "Терминал"],
  ["topo", "Схема сети"],
  ["cfg", "Настройки"],
] as const;

type TabId = (typeof TABS)[number][0];

const TAB_LABEL_KEY: Record<TabId, string> = {
  mon: "tabs.mon",
  "clients-wifi": "tabs.wifiTop",
  "clients-eth": "tabs.ethTop",
  fw: "tabs.fw",
  dhcp: "tabs.dhcp",
  wifi: "tabs.wifi",
  dest: "tabs.dest",
  term: "tabs.term",
  topo: "tabs.topo",
  cfg: "tabs.cfg",
};

function ErrorNote({ msg }: { msg: string }) {
  return <p className="muted">{msg}</p>;
}

function StatusReasonModal({ routerId, status, onClose }: { routerId: string; status: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<RouterStatusReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRouterStatusReason(routerId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(t("statusReason.loadError")));
    return () => { cancelled = true; };
  }, [routerId, t]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h2>{t("statusReason.title", { status: t(`status.${status}`, status) })}</h2>
        {error && <ErrorNote msg={error} />}
        {!data && !error && <p className="muted">{t("common.loading")}</p>}

        {data && status === "warn" && (
          data.downInterfaces.length ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                {t("statusReason.notInState")} {data.downInterfaces.length === 1 ? t("statusReason.oneWatched") : t("statusReason.manyWatched")}
                {" "}{t("statusReason.watchedListNote")}
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 320, overflowY: "auto" }}>
                {data.downInterfaces.map((i) => (
                  <li key={i.interface_name} className="mono" style={{ fontSize: 13, marginBottom: 4 }}>
                    {i.interface_name}{" "}
                    <span className="muted" style={{ fontSize: 11 }}>{t("statusReason.polledAt")} {new Date(i.time).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">{t("statusReason.noSpecificIface")}</p>
          )
        )}

        {data && status === "down" && (
          data.events.length ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                {t("statusReason.routerNoAnswer")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
                {data.events.map((e, i) => (
                  <div key={i}>
                    <div className="muted mono" style={{ fontSize: 11 }}>{new Date(e.created_at).toLocaleString()}</div>
                    <div style={{ fontSize: 13 }}>{e.message}</div>
                    {!!e.meta && <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{JSON.stringify(e.meta)}</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">{t("statusReason.noLogEntries")}</p>
          )
        )}

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

// Shared status badge — used on the fleet card grid (App.tsx) and the
// router detail header. warn/down are clickable: they fetch and explain
// the actual reason instead of leaving the user to guess from a color.
export function StatusBadge({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!router.monitoring_enabled) return <span className="badge unknown">{t("status.monitoringOff")}</span>;

  const clickable = router.status === "warn" || router.status === "down";
  return (
    <>
      <span
        className={`badge ${router.status}`}
        style={clickable ? { cursor: "pointer", textDecoration: "underline dotted" } : undefined}
        title={clickable ? t("statusReason.clickHint") : undefined}
        onClick={
          clickable
            ? (e) => {
                e.stopPropagation();
                setOpen(true);
              }
            : undefined
        }
      >
        {t(`status.${router.status}`, router.status)}
      </span>
      {open && <StatusReasonModal routerId={router.id} status={router.status} onClose={() => setOpen(false)} />}
    </>
  );
}

const PALETTE = ["#5b9ef5", "#5fe3a6", "#f5a742", "#f0556b", "#a78bfa", "#eb6834", "#38bdf8", "#facc15"];

// Color gradation for "how hot is this device relative to the busiest
// moment this network has seen" — green (idle) through amber to red (at
// or near the network's own peak combined traffic).
function heatColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const stops: [number, number, number][] = [
    [95, 227, 166], // --mint
    [245, 167, 66], // --amber
    [240, 85, 107], // --red
  ];
  const scaled = r * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const t = scaled - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r0, r1)}, ${mix(g0, g1)}, ${mix(b0, b1)})`;
}
const REFRESH_OPTIONS: { labelKey: string; ms: number }[] = [
  { labelKey: "common.refreshOff", ms: 0 },
  { labelKey: "common.refresh10s", ms: 10000 },
  { labelKey: "common.refresh30s", ms: 30000 },
  { labelKey: "common.refresh1m", ms: 60000 },
  { labelKey: "common.refresh5m", ms: 300000 },
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
  const { t } = useTranslation();
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
          {latest ? `${Math.round(latest.v)}${suffix}` : t("common.noData")}
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
  const { t } = useTranslation();
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
        {down && <span className="badge down blink">{t("monitoring.statusDown")}</span>}
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {ip ?? t("monitoring.ipNotAssigned")}
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
  const { t } = useTranslation();
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
      .catch(() => !cancelled && setLiveError(t("monitoring.ifacesLoadError")));
    return () => {
      cancelled = true;
    };
  }, [router.id, tick]);

  useEffect(() => {
    let cancelled = false;
    getWatchedInterfaces(router.id)
      .then((names) => !cancelled && setWatched(new Set(names)))
      .catch(() => !cancelled && setWatchedError(t("monitoring.watchedLoadError")));
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
      .catch(() => !cancelled && setSeriesError(t("monitoring.trafficHistoryError")));
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
              {h === 1 ? t("common.h1") : h === 24 ? t("common.h24") : t("common.d7")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("common.autoRefresh")}</span>
          {REFRESH_OPTIONS.map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: pickerOpen ? 10 : 20 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {t("monitoring.watchedInterfaces")} {watched.size ? t("monitoring.selected", { count: watched.size }) : ""}
        </span>
        <button onClick={() => setPickerOpen((v) => !v)}>{pickerOpen ? t("monitoring.collapse") : t("monitoring.selectInterfaces")}</button>
      </div>
      {pickerOpen && (
        <>
          {watchedError && <ErrorNote msg={watchedError} />}
          {liveError && <ErrorNote msg={liveError} />}
          {!liveIfaces && !liveError && <ErrorNote msg={t("monitoring.ifacesLoading")} />}
          {liveIfaces && (
            <table style={{ marginBottom: 20 }}>
              <thead>
                <tr><th style={{ width: 30 }}></th><th>{t("monitoring.colInterface")}</th><th>{t("monitoring.colStatus")}</th><th>{t("monitoring.colRxBps")}</th><th>{t("monitoring.colTxBps")}</th></tr>
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
                          {i.disabled === "true" ? t("monitoring.statusDisabled") : i.running === "true" ? t("monitoring.statusUp") : t("monitoring.statusDown")}
                        </span>
                      </td>
                      <td className="mono">{rates ? rates.rx_bps.toLocaleString() : t("monitoring.waitingPoll")}</td>
                      <td className="mono">{rates ? rates.tx_bps.toLocaleString() : t("monitoring.waitingPoll")}</td>
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
        {t("monitoring.dragHint")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {blocks.map((id) => {
          if (id === "cpu") {
            return (
              <DraggableCard key="cpu" id="cpu" onDrop={moveBlock}>
                <MiniLineChart title={t("common.cpu")} points={cpuPoints} color="#1baf7a" max={100} suffix="%" />
              </DraggableCard>
            );
          }
          if (id === "mem") {
            return (
              <DraggableCard key="mem" id="mem" onDrop={moveBlock}>
                <MiniLineChart title={t("common.memory")} points={memPoints} color="#4a3aa7" max={100} suffix="%" />
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

function WifiClientCard({
  client,
  color,
  heatRatio,
  onDetail,
}: {
  client: WifiTopClient;
  color: string;
  heatRatio: number;
  onDetail: (mac: string) => void;
}) {
  const { t } = useTranslation();
  const title = client.hostname || client.ip || client.mac;
  const icon = guessDeviceIcon(client.hostname) ?? "📱";
  const subtitleParts = [
    client.hostname && client.ip ? client.ip : null,
    client.mac,
    client.ap ? `AP: ${client.ap}` : null,
    client.ssid,
    client.signal !== null ? `${client.signal} dBm` : null,
  ].filter(Boolean);
  const heat = heatColor(heatRatio);

  return (
    <div className="card" style={{ marginBottom: 0, borderLeft: `3px solid ${heat}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{icon} {title}</strong>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            className="mono"
            title={t("wifiTopTab.heatTitle")}
            style={{ fontSize: 11, color: heat }}
          >
            {Math.round(heatRatio * 100)}%
          </span>
          <button onClick={() => onDetail(client.mac)} style={{ fontSize: 11, padding: "3px 8px" }}>{t("common.details")}</button>
        </div>
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {subtitleParts.join(" · ")}
      </div>
      <ClientCardChart series={client.series} color={color} latestRx={client.latest.rx_bps} latestTx={client.latest.tx_bps} />
    </div>
  );
}

function EthernetDestinationsModal({ router, mac, onClose }: { router: RouterSummary; mac: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<EthernetDestinations | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEthernetClientDestinations(router.id, mac)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(t("ethDest.loadError")));
    return () => { cancelled = true; };
  }, [router.id, mac, t]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <h2>{t("ethDest.title")} {mac}</h2>
        {error && <ErrorNote msg={error} />}
        {!data && !error && <p className="muted">{t("common.loading")}</p>}
        {data && !data.ip && <p className="muted">{t("ethDest.noIp")}</p>}
        {data && data.ip && !data.topDestinations.length && (
          <p className="muted">{t("ethDest.noDataInactive")}</p>
        )}
        {data && !!data.topDestinations.length && (
          <div className="table-scroll">
            <table>
              <thead><tr><th>{t("clientDetail.colAddress")}</th><th>{t("clientDetail.colPort")}</th><th>{t("clientDetail.colProtocol")}</th><th>{t("clientDetail.colConnections")}</th><th>{t("clientDetail.colBytes")}</th></tr></thead>
              <tbody>
                {data.topDestinations.map((d, i) => (
                  <tr key={i}>
                    <td className="mono">{d.ip}</td>
                    <td className="mono">{d.port ?? t("common.dash")}</td>
                    <td>{d.protocol ?? t("common.dash")}</td>
                    <td>{d.connections}</td>
                    <td className="mono">{(d.bytes / 1024).toFixed(1)} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

function EthernetClientCard({ client, color, router }: { client: EthernetTopClient; color: string; router: RouterSummary }) {
  const { t } = useTranslation();
  const [showDest, setShowDest] = useState(false);
  const title = client.confidence === "exact" ? client.hostname || client.ip || client.mac || client.port : `${t("ethTopTab.port")} ${client.port}`;
  const icon = client.confidence === "exact" ? guessDeviceIcon(client.hostname) ?? "🖥" : "🔌";
  const subtitleParts = [
    client.confidence === "exact" && client.ip ? client.ip : null,
    client.confidence === "exact" ? client.mac : null,
    client.port ? `${t("ethTopTab.port")}: ${client.port}` : null,
    client.neighborIdentity ? `${t("ethTopTab.neighbor")}: ${client.neighborIdentity}` : null,
    client.confidence !== "exact" && client.hostCount ? `${client.hostCount} ${t("ethTopTab.devicesCount")}` : null,
  ].filter(Boolean);

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{icon} {title}</strong>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {client.confidence === "exact" && client.mac && (
            <button onClick={() => setShowDest(true)} style={{ fontSize: 11, padding: "3px 8px" }}>{t("common.details")}</button>
          )}
          <span className="badge unknown">{t(`confidence.${client.confidence}`)}</span>
        </div>
      </div>
      <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {subtitleParts.join(" · ")}
      </div>
      <ClientCardChart series={client.series} color={color} latestRx={client.latest.rx_bps} latestTx={client.latest.tx_bps} />
      {showDest && client.mac && (
        <EthernetDestinationsModal router={router} mac={client.mac} onClose={() => setShowDest(false)} />
      )}
    </div>
  );
}

function formatDuration(seconds: number, units: { d: string; h: string; m: string }): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}${units.d}`);
  if (h || d) parts.push(`${h}${units.h}`);
  parts.push(`${m}${units.m}`);
  return parts.join(" ");
}

export function ClientDetailModal({ router, mac, onClose }: { router: RouterSummary; mac: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWifiClientDetail(router.id, mac, 24)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError(t("clientDetail.loadError")));
    return () => {
      cancelled = true;
    };
  }, [router.id, mac, t]);

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
        <h2>{t("clientDetail.title")}</h2>
        {error && <ErrorNote msg={error} />}
        {!detail && !error && <p className="muted">{t("common.loading")}</p>}
        {detail && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{detail.hostname || detail.ip || detail.mac}</strong>
              <span className={`badge ${detail.online ? "up" : "down"}`}>{detail.online ? t("clientDetail.online") : t("clientDetail.offline")}</span>
            </div>
            <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
              {detail.mac} {detail.ip ? `· ${detail.ip}` : ""}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.vendor")}</div>
                <div>{detail.vendor ?? t("clientDetail.vendorUnknown")}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.connectedSince")}</div>
                <div>
                  {detail.connectedSince
                    ? new Date(detail.connectedSince).toLocaleString() +
                      ` (${formatDuration((Date.now() - new Date(detail.connectedSince).getTime()) / 1000, { d: t("common.dayUnit"), h: t("common.hourUnit"), m: t("common.minUnit") })})`
                    : t("clientDetail.unknown")}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.apSsid")}</div>
                <div>{detail.apOrInterface ?? t("common.dash")}{detail.ssid ? ` · ${detail.ssid}` : ""}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.signal")}</div>
                <div>{detail.signal !== null ? `${detail.signal} dBm` : t("common.dash")}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.channelSpeed")}</div>
                <div className="mono" style={{ fontSize: 12 }}>{detail.rxRate ?? t("common.dash")} / {detail.txRate ?? t("common.dash")}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.onlineSinceDhcp")}</div>
                <div>{detail.firstSeenDhcp ? new Date(detail.firstSeenDhcp).toLocaleString() : t("clientDetail.unknown")}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{t("clientDetail.trafficStarted")}</div>
                <div>{detail.firstTrafficAt ? new Date(detail.firstTrafficAt).toLocaleString() : t("clientDetail.neverRecorded")}</div>
              </div>
            </div>

            {unit && detail.series.length > 0 && (
              <>
                <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>{t("clientDetail.trafficChart")}</div>
                <div style={{ position: "relative", height: 160, marginBottom: 12 }}>
                  <canvas ref={canvasRef} />
                </div>
                {(() => {
                  const latestPoint = detail.series[detail.series.length - 1];
                  if (!latestPoint || (latestPoint.rx_pps === null && latestPoint.tx_pps === null)) return null;
                  return (
                    <p className="muted mono" style={{ fontSize: 12, marginBottom: 20 }}>
                      {t("clientDetail.ppsNow")} Rx {latestPoint.rx_pps ?? t("common.dash")} · Tx {latestPoint.tx_pps ?? t("common.dash")}
                      {" — "}{t("clientDetail.ppsNote")}
                    </p>
                  );
                })()}
              </>
            )}

            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {t("clientDetail.channelBreakdownNote")}
            </p>
            <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>{t("clientDetail.topAddressesPorts")}</div>
            {!detail.topDestinations.length && (
              <p className="muted" style={{ fontSize: 12 }}>{t("clientDetail.noDataInactive")}</p>
            )}
            {!!detail.topDestinations.length && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>{t("clientDetail.colAddress")}</th><th>{t("clientDetail.colPort")}</th><th>{t("clientDetail.colProtocol")}</th><th>{t("clientDetail.colConnections")}</th><th>{t("clientDetail.colBytes")}</th></tr>
                  </thead>
                  <tbody>
                    {detail.topDestinations.map((d, i) => (
                      <tr key={i}>
                        <td className="mono">{d.ip}</td>
                        <td className="mono">{d.port ?? t("common.dash")}</td>
                        <td>{d.protocol ?? t("common.dash")}</td>
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
          <button className="primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

function TopWifiClientsTab({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const { hours, setHours, refreshMs, setRefreshMs, limit, setLimit } = useClientPrefs(CLIENTS_HOURS_KEY + ":wifi");
  const [tick, setTick] = useState(0);
  const [clients, setClients] = useState<WifiTopClient[] | null>(null);
  const [peakTotalBps, setPeakTotalBps] = useState(0);
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
      .then((d) => {
        if (cancelled) return;
        setClients(d.clients);
        setPeakTotalBps(d.peakTotalBps);
      })
      .catch(() => !cancelled && setError(t("wifiTopTab.loadError")));
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, limit, tick, t]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
        {t("wifiTopTab.source")}
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
              {h === 1 ? t("common.h1") : h === 24 ? t("common.h24") : t("common.d7")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("common.showTop")}</span>
          {[10, 15, 25].map((n) => (
            <button key={n} onClick={() => setLimit(n)} style={limit === n ? { borderColor: "var(--blue)" } : undefined}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("common.autoRefresh")}</span>
          {[{ label: t("common.refreshOff"), ms: 0 }, { label: t("common.refresh10s"), ms: 10000 }, { label: t("common.refresh30s"), ms: 30000 }, { label: t("common.refresh1m"), ms: 60000 }].map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote msg={error} />}
      {!clients && !error && <ErrorNote msg={t("common.loading")} />}
      {clients && !clients.length && !error && (
        <ErrorNote msg={t("wifiTopTab.noData")} />
      )}
      {clients && !!clients.length && (
        <>
          <p className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
            {t("wifiTopTab.sortedNote")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {clients.map((c, idx) => (
              <WifiClientCard
                key={c.key}
                client={c}
                color={PALETTE[idx % PALETTE.length]}
                heatRatio={peakTotalBps > 0 ? c.peakBps / peakTotalBps : 0}
                onDetail={setDetailMac}
              />
            ))}
          </div>
        </>
      )}
      {detailMac && <ClientDetailModal router={router} mac={detailMac} onClose={() => setDetailMac(null)} />}
    </div>
  );
}

function TopEthernetClientsTab({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
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
      .catch(() => !cancelled && setError(t("ethTopTab.loadError")));
    return () => {
      cancelled = true;
    };
  }, [router.id, hours, limit, tick, t]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
        {t("ethTopTab.source")}
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 24, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
              {h === 1 ? t("common.h1") : h === 24 ? t("common.h24") : t("common.d7")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("common.showTop")}</span>
          {[10, 15, 25].map((n) => (
            <button key={n} onClick={() => setLimit(n)} style={limit === n ? { borderColor: "var(--blue)" } : undefined}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("common.autoRefresh")}</span>
          {[{ label: t("common.refreshOff"), ms: 0 }, { label: t("common.refresh10s"), ms: 10000 }, { label: t("common.refresh30s"), ms: 30000 }, { label: t("common.refresh1m"), ms: 60000 }].map((o) => (
            <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote msg={error} />}
      {!clients && !error && <ErrorNote msg={t("common.loading")} />}
      {clients && !clients.length && !error && (
        <ErrorNote msg={t("ethTopTab.noData")} />
      )}
      {clients && !!clients.length && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {clients.map((c, idx) => (
            <EthernetClientCard key={c.key} client={c} color={PALETTE[idx % PALETTE.length]} router={router} />
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
  const { t } = useTranslation();
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
      .catch(() => !cancelled && setError(t("firewall.unreachable")));
    return () => {
      cancelled = true;
    };
  }, [router.id, tick, t]);

  if (error) return <ErrorNote msg={error} />;
  if (!rules) return <ErrorNote msg={t("common.loading")} />;
  if (!rules.length) return <ErrorNote msg={t("firewall.noRules")} />;

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

  // Top by current load — same rules/rates already fetched for the table
  // below, just re-sorted client-side. Only rules with a computed rate
  // (i.e. we've seen at least two samples) are eligible.
  const topByLoad = rules
    .map((r) => ({ rule: r, rate: rates.get(r[".id"]) }))
    .filter((x) => x.rate && x.rate.bps > 0)
    .sort((a, b) => (b.rate!.bps - a.rate!.bps))
    .slice(0, 5);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t("firewall.autoRefreshCounters")}</span>
        {[{ label: t("common.refreshOff"), ms: 0 }, { label: t("common.refresh5s"), ms: 5000 }, { label: t("common.refresh15s"), ms: 15000 }, { label: t("common.refresh1m"), ms: 60000 }].map((o) => (
          <button key={o.ms} onClick={() => setRefreshMs(o.ms)} style={refreshMs === o.ms ? { borderColor: "var(--blue)" } : undefined}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        {t("firewall.speedNote")}
      </p>
      {!!topByLoad.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>{t("firewall.topLoadNow")}</strong>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Chain</th><th>Action</th><th>Src</th><th>Dst</th><th>{t("firewall.colSpeed")}</th></tr></thead>
              <tbody>
                {topByLoad.map(({ rule: r, rate }) => (
                  <tr key={r[".id"]}>
                    <td>{r.chain}</td>
                    <td>{r.action}</td>
                    <td className="mono">{r["src-address"] ?? "any"}</td>
                    <td className="mono">{r["dst-address"] ?? "any"}</td>
                    <td className="mono">{Math.round(rate!.bps / 1000)} kbps · {rate!.pps} pps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Chain</th><th>Action</th><th>Src</th><th>Dst</th><th>Packets</th><th>Bytes</th><th>{t("firewall.colSpeed")}</th><th>{t("firewall.colStatus")}</th></tr>
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
              if (packets === 0) statusBadge = { cls: "unknown", text: t("firewall.notTriggered") };
              else if (rate && rate.pps > 0) statusBadge = { cls: "up", text: t("firewall.active") };
              else statusBadge = { cls: "warn", text: t("firewall.quietNow") };

              return (
                <tr key={id ?? i}>
                  <td>{r.chain}</td>
                  <td>{r.action}</td>
                  <td className="mono">{r["src-address"] ?? "any"}</td>
                  <td className="mono">{r["dst-address"] ?? "any"}</td>
                  <td className="mono">{packets.toLocaleString()}</td>
                  <td className="mono">{formatBytes(Number(r.bytes ?? 0))}</td>
                  <td className="mono">{rate ? `${Math.round(rate.bps / 1000)} kbps` : t("common.dash")}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
                      {isBottleneck && <span className="badge warn" title={t("firewall.bottleneckTitle")}>{t("firewall.bottleneck")}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TopBlockedPanel router={router} />
    </div>
  );
}

function TopBlockedPanel({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [hours, setHours] = useState(24);
  const [entries, setEntries] = useState<TopBlockedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTopBlocked(router.id, hours, 15)
      .then((d) => !cancelled && setEntries(d))
      .catch(() => !cancelled && setError(t("common.loadErrorGeneric")));
    return () => { cancelled = true; };
  }, [router.id, hours, t]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 13, display: "block", marginBottom: 4 }}>{t("topBlocked.title")}</strong>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {t("topBlocked.description")}{" "}
        <code className="mono">log=yes</code> {t("topBlocked.descriptionCont")}
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[1, 24, 168].map((h) => (
          <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
            {h === 1 ? t("common.h1") : h === 24 ? t("common.h24") : t("common.d7")}
          </button>
        ))}
      </div>
      {error && <ErrorNote msg={error} />}
      {!entries && !error && <p className="muted">{t("common.loading")}</p>}
      {entries && !entries.length && !error && (
        <p className="muted" style={{ fontSize: 12 }}>{t("topBlocked.noDataPeriod")}</p>
      )}
      {entries && !!entries.length && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>IP</th><th>{t("topBlocked.colHost")}</th><th>MAC</th><th>{t("topBlocked.colAttempts")}</th><th>{t("topBlocked.colLastSeen")}</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.ip}>
                  <td className="mono">{e.ip}</td>
                  <td>{e.hostname ?? t("common.dash")}</td>
                  <td className="mono">{e.mac ?? t("common.dash")}</td>
                  <td className="mono">{e.hits.toLocaleString()}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{new Date(e.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DhcpTab({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [leases, setLeases] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poolUsage, setPoolUsage] = useState<DhcpPoolUsage[] | null>(null);

  useEffect(() => {
    getDhcpLeases(router.id).then(setLeases).catch(() => setError(t("dhcp.unreachable")));
    // Best-effort, auxiliary to the main leases table — a router without
    // /ip/pool configured (all-static DHCP) just shows nothing here.
    getDhcpPoolUsage(router.id).then(setPoolUsage).catch(() => setPoolUsage([]));
  }, [router.id, t]);

  if (error) return <ErrorNote msg={error} />;
  if (!leases) return <ErrorNote msg={t("common.loading")} />;

  return (
    <div>
      {!!poolUsage?.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13, display: "block", marginBottom: 10 }}>{t("dhcp.poolFillTitle")}</strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {poolUsage.map((p) => (
              <div key={p.server}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                  <span>{p.server} <span className="muted">({p.pool})</span></span>
                  <span className="mono">
                    {p.used} / {p.capacity || "?"}{p.percent !== null ? ` · ${p.percent}%` : ""}
                  </span>
                </div>
                {p.percent !== null && (
                  <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, p.percent)}%`, background: heatColor(p.percent / 100) }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!leases.length ? (
        <ErrorNote msg={t("dhcp.noLeases")} />
      ) : (
        <table>
          <thead><tr><th>IP</th><th>MAC</th><th>{t("dhcp.colHost")}</th><th>{t("dhcp.colStatus")}</th><th>{t("dhcp.colOnlineSince")}</th></tr></thead>
          <tbody>
            {leases.map((l, i) => (
              <tr key={i}>
                <td className="mono">{l.address}</td>
                <td className="mono">{l["mac-address"]}</td>
                <td>{l["host-name"] ? `${guessDeviceIcon(l["host-name"]) ?? "❔"} ${l["host-name"]}` : t("common.dash")}</td>
                <td>{l.status}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {l["first-seen"] ? new Date(l["first-seen"]).toLocaleString() : t("common.dash")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DeviceEventsPanel router={router} />
    </div>
  );
}

function DeviceEventsPanel({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [hours, setHours] = useState(24);
  const [events, setEvents] = useState<DeviceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDeviceEvents(router.id, hours, 50)
      .then((d) => !cancelled && setEvents(d))
      .catch(() => !cancelled && setError(t("deviceEvents.loadError")));
    return () => { cancelled = true; };
  }, [router.id, hours, t]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 13, display: "block", marginBottom: 4 }}>{t("deviceEvents.title")}</strong>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {t("deviceEvents.description")}
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[1, 24, 168].map((h) => (
          <button key={h} onClick={() => setHours(h)} style={hours === h ? { borderColor: "var(--blue)" } : undefined}>
            {h === 1 ? t("common.h1") : h === 24 ? t("common.h24") : t("common.d7")}
          </button>
        ))}
      </div>
      {error && <ErrorNote msg={error} />}
      {!events && !error && <p className="muted">{t("common.loading")}</p>}
      {events && !events.length && !error && (
        <p className="muted" style={{ fontSize: 12 }}>{t("deviceEvents.noEvents")}</p>
      )}
      {events && !!events.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {events.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, flexWrap: "wrap" }}>
              <span className={`badge ${e.event_type === "online" ? "up" : "down"}`}>
                {e.event_type === "online" ? t("deviceEvents.appeared") : t("deviceEvents.disappeared")}
              </span>
              <span>{guessDeviceIcon(e.hostname) ?? "❔"} {e.hostname || e.ip_address || e.mac_address}</span>
              <span className="muted mono" style={{ fontSize: 11 }}>{e.mac_address}</span>
              <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>{new Date(e.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WifiTab({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [clients, setClients] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWifiClients(router.id).then(setClients).catch(() => setError(t("wifiRawTab.unreachable")));
  }, [router.id, t]);

  if (error) return <ErrorNote msg={error} />;
  if (!clients) return <ErrorNote msg={t("common.loading")} />;
  if (!clients.length) return <ErrorNote msg={t("wifiRawTab.noClients")} />;

  return (
    <table>
      <thead><tr><th>MAC</th><th>{t("wifiRawTab.colInterface")}</th><th>{t("wifiRawTab.colSignal")}</th></tr></thead>
      <tbody>
        {clients.map((c, i) => (
          <tr key={i}><td className="mono">{c["mac-address"]}</td><td>{c.interface}</td><td>{c["signal-strength"] ?? t("common.dash")}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TopDestinationsTab({ router }: { router: RouterSummary }) {
  const { t } = useTranslation();
  const [destinations, setDestinations] = useState<TopDestination[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await getTopDestinations(router.id, 25);
      setDestinations(d);
      setLoadedOnce(true);
    } catch {
      setError(t("destinations.loadError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
        {t("destinations.description")}
      </p>
      <button className="primary" onClick={load} disabled={loading}>
        {loading ? t("destinations.loading") : loadedOnce ? t("destinations.refresh") : t("destinations.load")}
      </button>
      {error && (
        <div style={{ marginTop: 12 }}>
          <ErrorNote msg={error} />
        </div>
      )}
      {destinations && !destinations.length && !error && (
        <p className="muted" style={{ marginTop: 12 }}>{t("destinations.noConnections")}</p>
      )}
      {!!destinations?.length && (
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th></th><th>{t("destinations.colDestAddress")}</th><th>{t("destinations.colPort")}</th><th>{t("destinations.colProtocol")}</th><th>{t("destinations.colConnections")}</th><th>{t("destinations.colBytes")}</th></tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <Fragment key={d.ip}>
                  <tr style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === d.ip ? null : d.ip)}>
                    <td className="mono">{expanded === d.ip ? "▾" : "▸"}</td>
                    <td className="mono">
                      {d.ip}
                      {d.hostname && <div className="muted" style={{ fontSize: 11 }}>{d.hostname}</div>}
                    </td>
                    <td className="mono">{d.port ?? t("common.dash")}</td>
                    <td>{d.protocol ?? t("common.dash")}</td>
                    <td className="mono">{d.connections}</td>
                    <td className="mono">{formatBytes(d.bytes)}</td>
                  </tr>
                  {expanded === d.ip && (
                    <tr>
                      <td></td>
                      <td colSpan={5} style={{ paddingTop: 0, paddingBottom: 16 }}>
                        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                          {t("destinations.sourcesNote")}
                        </div>
                        <table>
                          <thead><tr><th>{t("destinations.colDevice")}</th><th>MAC</th><th>{t("destinations.colConnections")}</th><th>{t("destinations.colBytes")}</th></tr></thead>
                          <tbody>
                            {d.sources.map((s) => (
                              <tr key={s.ip}>
                                <td className="mono">
                                  {guessDeviceIcon(s.hostname) ?? "❔"} {s.hostname ?? s.ip}
                                  {s.hostname && <span className="muted"> ({s.ip})</span>}
                                </td>
                                <td className="mono">{s.mac ?? t("common.dash")}</td>
                                <td className="mono">{s.connections}</td>
                                <td className="mono">{formatBytes(s.bytes)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EditRouterModal({ router, onClose, onUpdated }: { router: RouterSummary; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<{ name: string; host: string; port: number; username: string; password: string; model: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRouter(router.id)
      .then((d: RouterDetailFull) => {
        if (cancelled) return;
        setForm({ name: d.name, host: d.host, port: d.port, username: d.username, password: "", model: d.model ?? "" });
      })
      .catch(() => !cancelled && setLoadError(t("editRouter.loadError")));
    return () => { cancelled = true; };
  }, [router.id, t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const payload: { name: string; host: string; port: number; username: string; model: string; password?: string } = {
        name: form.name, host: form.host, port: form.port, username: form.username, model: form.model,
      };
      if (form.password) payload.password = form.password;
      await updateRouter(router.id, payload);
      onUpdated();
      onClose();
    } catch {
      setError(t("editRouter.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{t("editRouter.title")}</h2>
        {loadError && <div className="error-text">{loadError}</div>}
        {!form && !loadError && <p className="muted">{t("common.loading")}</p>}
        {form && (
          <>
            <label>{t("editRouter.name")}</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>{t("editRouter.host")}</label>
            <input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <label>{t("editRouter.port")}</label>
            <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            <label>{t("editRouter.apiUser")}</label>
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <label>{t("editRouter.newPassword")}</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label>{t("editRouter.model")}</label>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            {error && <div className="error-text">{error}</div>}
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary" type="submit" disabled={busy || !form}>{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </div>
  );
}

function ConfigTab({ router, onDeleted, onUpdated }: { router: RouterSummary; onDeleted: () => void; onUpdated: () => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState("/ip/address");
  const [result, setResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingMonitoring, setTogglingMonitoring] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  async function runGet() {
    setBusy(true);
    try {
      const data = await getConfig(router.id, path);
      setResult(JSON.stringify(data, null, 2));
    } catch {
      setResult(t("configTab.getError"));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await testRouter(router.id);
      setTestResult({ ok: true, msg: t("configTab.testOk") });
    } catch {
      setTestResult({ ok: false, msg: t("configTab.testFail") });
    } finally {
      setTesting(false);
    }
  }

  async function runDelete() {
    if (!confirm(t("configTab.deleteConfirm", { name: router.name }))) return;
    setDeleting(true);
    try {
      await deleteRouter(router.id);
      onDeleted();
    } catch {
      setTestResult({ ok: false, msg: t("configTab.deleteError") });
      setDeleting(false);
    }
  }

  async function toggleMonitoring() {
    setTogglingMonitoring(true);
    try {
      await updateRouter(router.id, { monitoringEnabled: !router.monitoring_enabled });
      onUpdated();
    } catch {
      setTestResult({ ok: false, msg: t("configTab.monitoringError") });
    } finally {
      setTogglingMonitoring(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowEdit(true)}>{t("common.edit")}</button>
          <button onClick={runTest} disabled={testing}>{testing ? t("configTab.testing") : t("configTab.testConnection")}</button>
          <button onClick={toggleMonitoring} disabled={togglingMonitoring}>
            {togglingMonitoring ? "…" : router.monitoring_enabled ? t("configTab.pauseMonitoring") : t("configTab.resumeMonitoring")}
          </button>
          <button onClick={runDelete} disabled={deleting} style={{ borderColor: "var(--red)", color: "var(--red)" }}>
            {deleting ? t("common.deleting") : t("configTab.deleteRouter")}
          </button>
        </div>
        {!router.monitoring_enabled && (
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {t("configTab.monitoringOffNote")}
          </p>
        )}
        {testResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: testResult.ok ? "var(--mint)" : "var(--red)" }}>
            {testResult.msg}
          </div>
        )}
      </div>
      {showEdit && <EditRouterModal router={router} onClose={() => setShowEdit(false)} onUpdated={onUpdated} />}

      <p className="muted" style={{ marginBottom: 12 }}>
        {t("configTab.directAccessNote")}{" "}
        <code className="mono">/ip/firewall/nat</code> {t("common.orWord")} <code className="mono">/interface/bridge</code>.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input className="mono" style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="primary" onClick={runGet} disabled={busy}>{busy ? "…" : "GET"}</button>
      </div>
      {result && <pre className="mono" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, fontSize: 11, overflowX: "auto" }}>{result}</pre>}
    </div>
  );
}

export default function RouterDetail({ router, onDeleted, onUpdated }: { router: RouterSummary; onDeleted: () => void; onUpdated: () => void }) {
  const { t } = useTranslation();
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
          <div className="muted mono">{router.host}:{router.port} · {router.model ?? t("common.unknownModel")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusBadge router={router} />
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([id]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{t(TAB_LABEL_KEY[id])}</button>
        ))}
      </div>
      {tab === "mon" && <MonitoringTab router={router} />}
      {tab === "clients-wifi" && <TopWifiClientsTab router={router} />}
      {tab === "clients-eth" && <TopEthernetClientsTab router={router} />}
      {tab === "fw" && <FirewallTab router={router} />}
      {tab === "dhcp" && <DhcpTab router={router} />}
      {tab === "wifi" && <WifiTab router={router} />}
      {tab === "dest" && <TopDestinationsTab router={router} />}
      {terminalActivated && (
        <div style={{ display: tab === "term" ? "block" : "none" }}>
          <TerminalTab router={router} active={tab === "term"} />
        </div>
      )}
      {tab === "topo" && <TopologyTab router={router} />}
      {tab === "cfg" && <ConfigTab router={router} onDeleted={onDeleted} onUpdated={onUpdated} />}
    </div>
  );
}
