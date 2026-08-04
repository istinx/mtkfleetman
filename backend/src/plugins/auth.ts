import fp from "fastify-plugin" ;
import fastifyJwt from "@fastify/jwt";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";

export interface JwtPayload {
  userId: string;
  tenantId: string;
  role: "admin" | "operator" | "viewer";
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// @fastify/jwt's own request.user typing varies across versions and is easy
// to conflict with via declaration merging. Sidestep that entirely: keep
// request.user as whatever the plugin declares, and use this helper at each
// call site to get a properly typed view of our own payload shape.
export function authUser(req: FastifyRequest): JwtPayload {
  return req.user as unknown as JwtPayload;
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.register(fastifyJwt, { secret: config.jwtSecret });

  app.decorate("authenticate", async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
});
