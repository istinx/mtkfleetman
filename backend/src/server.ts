import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config";
import { ensureBootstrapAdmin } from "./db/bootstrapAdmin";
import authPlugin from "./plugins/auth";
import authRoutes from "./routes/auth";
import routerRoutes from "./routes/routers";
import monitoringRoutes from "./routes/monitoring";
import firewallRoutes from "./routes/firewall";
import dhcpRoutes from "./routes/dhcp";
import wifiRoutes from "./routes/wifi";
import configRoutes from "./routes/config";
import watchedInterfacesRoutes from "./routes/watched";
import clientsRoutes from "./routes/clients";
import usersRoutes from "./routes/users";
import logsRoutes from "./routes/logs";
import terminalRoutes from "./routes/terminal";
import topologyRoutes from "./routes/topology";
import networkMapRoutes from "./routes/networkMap";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(authPlugin);

  await ensureBootstrapAdmin();

  await app.register(authRoutes);
  await app.register(routerRoutes);
  await app.register(monitoringRoutes);
  await app.register(firewallRoutes);
  await app.register(dhcpRoutes);
  await app.register(wifiRoutes);
  await app.register(configRoutes);
  await app.register(watchedInterfacesRoutes);
  await app.register(clientsRoutes);
  await app.register(usersRoutes);
  await app.register(logsRoutes);
  await app.register(terminalRoutes);
  await app.register(topologyRoutes);
  await app.register(networkMapRoutes);

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ host: "0.0.0.0", port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
