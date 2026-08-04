import { FastifyInstance } from "fastify";
import { Client as SSHClient } from "ssh2";
import { getRouterForTenant } from "../db/routers";
import { decryptSecret } from "../utils/crypto";

export default async function terminalRoutes(app: FastifyInstance) {
  // Not behind the normal `authenticate` preHandler — browsers can't set
  // custom headers on a WebSocket handshake, so the JWT comes in as a
  // query param instead and is verified manually here.
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/routers/:id/terminal",
    { websocket: true },
    async (connection: any, req) => {
      const socket = connection.socket;
      let tenantId: string;
      try {
        const payload: any = app.jwt.verify(req.query.token ?? "");
        tenantId = payload.tenantId;
      } catch {
        socket.send("\r\n\x1b[31mОшибка авторизации.\x1b[0m\r\n");
        socket.close();
        return;
      }

      const router = await getRouterForTenant(tenantId, req.params.id);
      if (!router) {
        socket.send("\r\n\x1b[31mРоутер не найден.\x1b[0m\r\n");
        socket.close();
        return;
      }

      socket.send(`\x1b[36mПодключение к ${router.name} (${router.host}) по SSH...\x1b[0m\r\n`);

      const ssh = new SSHClient();

      ssh.on("ready", () => {
        ssh.shell((err, stream) => {
          if (err) {
            socket.send(`\r\n\x1b[31mНе удалось открыть shell: ${err.message}\x1b[0m\r\n`);
            socket.close();
            return;
          }
          stream.on("data", (data: Buffer) => {
            if (socket.readyState === socket.OPEN) socket.send(data.toString("utf8"));
          });
          stream.on("close", () => {
            ssh.end();
            socket.close();
          });
          socket.on("message", (msg: Buffer) => {
            try {
              stream.write(msg);
            } catch {
              /* stream already closed */
            }
          });
          socket.on("close", () => ssh.end());
        });
      });

      ssh.on("error", (err) => {
        socket.send(
          `\r\n\x1b[31mSSH-подключение не удалось: ${err.message}\x1b[0m\r\n` +
            `Проверьте, что на роутере включён SSH (/ip service print) и порт 22 доступен с этого сервера.\r\n`
        );
        socket.close();
      });

      ssh.connect({
        host: router.host,
        port: 22,
        username: router.username,
        password: decryptSecret(router.password_encrypted),
        readyTimeout: 8000,
        // RouterOS's SSH implementation is picky about algorithm
        // negotiation on some versions — widen the accepted set a bit
        // rather than relying on ssh2's modern-only defaults.
        algorithms: {
          kex: [
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1",
            "diffie-hellman-group-exchange-sha256",
            "ecdh-sha2-nistp256",
          ],
        },
      });
    }
  );
}
