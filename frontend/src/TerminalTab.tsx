import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getTerminalWsUrl } from "./api";
import { RouterSummary } from "./api";

export default function TerminalTab({ router, active }: { router: RouterSummary; active: boolean }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 13,
      theme: { background: "#10161b", foreground: "#e7ecef" },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const ws = new WebSocket(getTerminalWsUrl(router.id));
    ws.onmessage = (ev) => term.write(ev.data);
    ws.onclose = () => term.write(`\r\n\x1b[33m${t("terminal.closed")}\x1b[0m\r\n`);
    ws.onerror = () => term.write(`\r\n\x1b[31m${t("terminal.connError")}\x1b[0m\r\n`);
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      ws.close();
      term.dispose();
    };
  }, [router.id]);

  // xterm computes its size from the container's actual pixel dimensions —
  // while hidden via display:none (switched away to another tab) that's
  // 0×0, so it needs an explicit re-fit right after becoming visible again.
  useEffect(() => {
    if (active) requestAnimationFrame(() => fitRef.current?.fit());
  }, [active]);

  return (
    <div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {t("terminal.intro")}
      </p>
      <div ref={containerRef} style={{ height: "calc(100vh - 260px)", minHeight: 480, background: "#10161b", borderRadius: 8, padding: 8 }} />
    </div>
  );
}
