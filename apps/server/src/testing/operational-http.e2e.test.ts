import { describe, expect, test } from "bun:test";
import { Controller, Get, Module } from "@nestjs/common";
import {
  get,
  request as sendHttpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import request from "supertest";
import { createApp, type OperationalHttpApplication } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";

@Controller("routing-probe")
class RoutingProbeController {
  @Get()
  get(): { readonly routed: true } {
    return { routed: true };
  }
}

@Module({ controllers: [RoutingProbeController] })
class RoutingProbeModule {}

const environment = (overrides: Record<string, string> = {}) => parseEnvironment({
  NODE_ENV: "test",
  PORT: "0",
  SHUTDOWN_GRACE_MS: "500",
  ...overrides,
});

async function start(
  options: Parameters<typeof createApp>[0] = {},
): Promise<{ runtime: OperationalHttpApplication; server: Server }> {
  const runtime = await createApp({ environment: environment(), logWriter: () => undefined, ...options });
  const server = await runtime.listen(0, "127.0.0.1");
  return { runtime, server };
}

function addressOf(server: Server): { host: string; port: number } {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return { host: "127.0.0.1", port: address.port };
}

function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error("Condition was not observed before the deadline"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

function rawGetAt(
  { host, port }: { host: string; port: number },
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const outgoing = get({ host, port, path, agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    outgoing.on("error", (error) => {
      settled = true;
      reject(error);
    });
    outgoing.on("socket", (socket) => {
      socket.on("close", () => {
        if (!settled) reject(new Error("Connection closed before a response completed"));
      });
    });
  });
}

function rawGet(server: Server, path: string): Promise<{ status: number; body: string }> {
  return rawGetAt(addressOf(server), path);
}

function rawPost(
  server: Server,
  path: string,
  contentType: string,
  body: string,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { host, port } = addressOf(server);
  return new Promise((resolve, reject) => {
    const outgoing = sendHttpRequest({
      host,
      port,
      path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": contentType,
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: responseBody,
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function openPendingGet(server: Server, path: string): {
  readonly request: ClientRequest;
  readonly closed: Promise<void>;
} {
  const { host, port } = addressOf(server);
  const outgoing = get({ host, port, path, agent: false });
  outgoing.on("error", () => undefined);
  return { request: outgoing, closed: new Promise((resolve) => outgoing.once("close", resolve)) };
}

describe("operational HTTP shell", () => {
  test("trusts only the supported body-parser error signatures", async () => {
    const { isSupportedBodyParserError } = await import("../bootstrap/create-app");
    expect(isSupportedBodyParserError({ status: 400, type: "entity.parse.failed", expose: true })).toBe(false);
    const parserSyntaxError = Object.assign(new SyntaxError("fixture"), {
      status: 400,
      statusCode: 400,
      type: "entity.parse.failed",
      expose: true,
    });
    expect(isSupportedBodyParserError(parserSyntaxError)).toBe(true);
  });

  test("propagates accepted/generated request ids through health, Problem Details, and completion logs", async () => {
    const { runtime, server } = await start();
    try {
      const accepted = await request(server)
        .get("/health/live")
        .set("x-request-id", "accepted.req-1")
        .set("origin", "http://localhost:3000");
      expect(accepted.status).toBe(200);
      expect(accepted.body).toEqual({ status: "live" });
      expect(accepted.headers["x-request-id"]).toBe("accepted.req-1");
      expect(accepted.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(accepted.headers["access-control-allow-credentials"]).toBe("true");
      expect(accepted.headers["x-content-type-options"]).toBe("nosniff");

      const missing = await request(server).get("/api/v1/missing?secret=raw-query");
      expect(missing.status).toBe(404);
      expect(missing.headers["content-type"]).toContain("application/problem+json");
      expect(missing.body).toEqual(expect.objectContaining({
        status: 404,
        code: "NOT_FOUND",
        requestId: missing.headers["x-request-id"],
      }));
      expect(missing.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

      const completions = runtime.logger.records.filter((record) => record.event === "request_completed");
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({ requestId: "accepted.req-1", route: "/health/live" });
      expect(JSON.stringify(completions)).not.toContain("raw-query");
      expect(JSON.stringify(completions)).not.toContain("/api/v1/missing?");
    } finally {
      await runtime.shutdown();
    }
  });

  test("keeps Swagger UI/raw JSON off and reports dependency unavailability as a 503 problem", async () => {
    const { runtime, server } = await start({ databaseReadiness: { isReady: () => false } });
    try {
      const ready = await request(server).get("/health/ready");
      expect(ready.status).toBe(503);
      expect(ready.headers["content-type"]).toContain("application/problem+json");
      expect(ready.body).toEqual(expect.objectContaining({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      }));
      expect((await request(server).get("/docs")).status).toBe(404);
      expect((await request(server).get("/docs/openapi.json")).status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });

  test("mounts context and one inflight lease before the raw pre-parser insertion point", async () => {
    let runtime: OperationalHttpApplication | undefined;
    const observations: Array<Record<string, unknown>> = [];
    const started = await start({
      environment: environment({ TRUST_PROXY_HOPS: "1" }),
      mountPreParserRawTransport(application) {
        application.post("/api/auth/raw-boundary", (incoming, response) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () => {
            observations.push({
              body: incoming.body,
              rawBody: Buffer.concat(chunks).toString("utf8"),
              requestId: runtime?.requestContext.current()?.requestId,
              inflight: runtime?.tracker.count,
              ip: incoming.ip,
            });
            response.status(204).end();
          });
        });
      },
    });
    runtime = started.runtime;
    try {
      const exactRawBody = '{"value":true,"token":"transport-bytes"}';
      const response = await request(started.server)
        .post("/api/auth/raw-boundary")
        .set("content-type", "application/json")
        .set("x-request-id", "raw.req-1")
        .set("x-forwarded-for", "203.0.113.10")
        .set("origin", "http://localhost:3000")
        .send(exactRawBody);
      expect(response.status).toBe(204);
      expect(response.headers["x-request-id"]).toBe("raw.req-1");
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(observations).toEqual([{
        body: undefined,
        rawBody: exactRawBody,
        requestId: "raw.req-1",
        inflight: 1,
        ip: "203.0.113.10",
      }]);

      const disallowed = await request(started.server)
        .post("/api/auth/raw-boundary")
        .set("content-type", "application/json")
        .set("origin", "https://disallowed.example")
        .send(exactRawBody);
      expect(disallowed.status).toBe(204);
      expect(disallowed.headers["access-control-allow-origin"]).toBeUndefined();
      await waitUntil(() => runtime!.tracker.count === 0);
      expect(runtime.logger.records.filter((record) => record.event === "request_completed")).toHaveLength(0);
    } finally {
      await runtime.shutdown();
    }
  });

  test("maps malformed JSON from the trusted bounded parser to canonical validation Problem Details", async () => {
    const { runtime, server } = await start();
    try {
      const response = await rawPost(server, "/api/v1/missing", "application/json", '{"broken":');
      expect(response.status).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        status: 400,
        code: "VALIDATION_ERROR",
        requestId: response.headers["x-request-id"],
      }));
    } finally {
      await runtime.shutdown();
    }
  });

  test("prefixes versioned Nest routes under api/v1 while health and raw auth remain neutral", async () => {
    const started = await start({
      testOnlyImports: [RoutingProbeModule],
      mountPreParserRawTransport(application) {
        application.get("/api/auth/session", (_incoming, response) => response.json({ raw: true }));
      },
    });
    try {
      expect((await request(started.server).get("/api/v1/routing-probe")).body).toEqual({ routed: true });
      expect((await request(started.server).get("/routing-probe")).status).toBe(404);
      expect((await request(started.server).get("/api/routing-probe")).status).toBe(404);
      expect((await request(started.server).get("/health/live")).status).toBe(200);
      expect((await request(started.server).get("/api/v1/health/live")).status).toBe(404);
      expect((await request(started.server).get("/api/auth/session")).body).toEqual({ raw: true });
    } finally {
      await started.runtime.shutdown();
    }
  });

  test("the explicit parser rejects a request beyond the configured payload bound", async () => {
    const { runtime, server } = await start({
      environment: environment({ HTTP_PAYLOAD_LIMIT_BYTES: "1024" }),
    });
    try {
      const response = await request(server)
        .post("/health/live")
        .set("content-type", "application/json")
        .send(JSON.stringify({ value: "x".repeat(2_048) }));
      expect(response.status).toBe(413);
      await waitUntil(() => runtime.tracker.count === 0);
    } finally {
      await runtime.shutdown();
    }
  });

  test("lowers readiness, rejects new connections, drains a real request, then closes Nest resources", async () => {
    const started = await start({
      environment: environment({ SHUTDOWN_GRACE_MS: "1000" }),
      mountPreParserRawTransport(application) {
        application.get("/slow-drain", (_incoming, response) => {
          setTimeout(() => response.status(200).send("drained"), 100);
        });
      },
    });
    const existing = rawGet(started.server, "/slow-drain");
    const address = addressOf(started.server);
    await waitUntil(() => started.runtime.tracker.count === 1);
    const shuttingDown = started.runtime.shutdown();
    expect(started.runtime.readiness.ready).toBe(false);
    await expect(rawGetAt(address, "/health/live")).rejects.toBeDefined();
    await expect(existing).resolves.toEqual({ status: 200, body: "drained" });
    await expect(shuttingDown).resolves.toEqual({ drained: true, forced: false, inflightAtDeadline: 0 });
    expect(started.runtime.readiness.closed).toBe(true);
  });

  test("the configured deadline force-closes a real request and records the bounded termination", async () => {
    const started = await start({
      environment: environment({ SHUTDOWN_GRACE_MS: "40" }),
      mountPreParserRawTransport(application) {
        application.get("/never-finishes", () => undefined);
      },
    });
    const existing = openPendingGet(started.server, "/never-finishes");
    await waitUntil(() => started.runtime.tracker.count === 1);
    const began = Date.now();
    const result = await started.runtime.shutdown();
    expect(result).toEqual({ drained: false, forced: true, inflightAtDeadline: 1 });
    expect(Date.now() - began).toBeLessThan(500);
    existing.request.destroy();
    await existing.closed;
    expect(started.runtime.readiness.closed).toBe(true);
    expect(started.runtime.logger.records).toContainEqual(expect.objectContaining({
      event: "shutdown_completed",
      forced: true,
      inflight: 1,
    }));
  });
});
