import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ArgumentsHost,
} from "@nestjs/common";
import { describe, expect, test } from "bun:test";
import { RedactingJsonLogger } from "../logging/logging.module";
import { fixedClock, Temporal } from "@eatbid/domain";
import { ProblemDetailsFilter } from "./problem-details.filter";
import { claimCompletionLog } from "./request-completion-log";

describe("Problem Details 상태 매핑", () => {
  test("예외 detail을 반사하지 않고 전체 운영 status taxonomy로 매핑한다", async () => {
    const module = await import("./problem-details.filter").catch(() => undefined);
    expect(module, "Problem Details filter must exist").toBeDefined();
    const expected = new Map([
      [400, "VALIDATION_ERROR"], [401, "UNAUTHENTICATED"], [403, "FORBIDDEN"],
      [404, "NOT_FOUND"], [409, "CONFLICT"], [429, "RATE_LIMITED"],
      [503, "DEPENDENCY_UNAVAILABLE"], [500, "INTERNAL_ERROR"],
    ]);
    for (const [status, code] of expected) {
      expect(module!.problemForStatus(status, "req-taxonomy")).toEqual(expect.objectContaining({
        status,
        code,
        requestId: "req-taxonomy",
      }));
    }
  });

  test("exception filter가 모든 status family에 application/problem+json을 내보낸다", () => {
    const logger = new RedactingJsonLogger({
      buildSha: "a".repeat(40),
      clock: fixedClock(Temporal.Instant.from("2026-08-30T09:00:00Z")),
      write: () => undefined,
    });
    const filter = new ProblemDetailsFilter(logger);
    const cases: ReadonlyArray<readonly [unknown, number, string]> = [
      [new BadRequestException(), 400, "VALIDATION_ERROR"],
      [new UnauthorizedException(), 401, "UNAUTHENTICATED"],
      [new ForbiddenException(), 403, "FORBIDDEN"],
      [new NotFoundException(), 404, "NOT_FOUND"],
      [new ConflictException(), 409, "CONFLICT"],
      [new HttpException("limited", 429), 429, "RATE_LIMITED"],
      [new ServiceUnavailableException(), 503, "DEPENDENCY_UNAVAILABLE"],
      [new Error("unexpected person@example.com"), 500, "INTERNAL_ERROR"],
    ];
    for (const [exception, expectedStatus, expectedCode] of cases) {
      const observed: { status?: number; type?: string; body?: unknown } = {};
      const response = {
        locals: {} as Record<string, unknown>,
        status(value: number) { observed.status = value; return this; },
        type(value: string) { observed.type = value; return this; },
        send(value: unknown) { observed.body = value; return this; },
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ method: "GET", baseUrl: "", route: { path: "/api/v1/test" } }),
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;
      filter.catch(exception, host);
      expect(observed.status).toBe(expectedStatus);
      expect(observed.type).toBe("application/problem+json");
      expect(observed.body).toEqual(expect.objectContaining({ status: expectedStatus, code: expectedCode }));
    }
    expect(JSON.stringify(logger.records)).not.toContain("person@example.com");
  });

  test("완료 interceptor에 닿지 못한 거부만 요약 로그로 남기고 예외 message와 원문 URL은 싣지 않는다", () => {
    const logger = new RedactingJsonLogger({
      buildSha: "c".repeat(40),
      clock: fixedClock(Temporal.Instant.from("2026-09-10T09:00:00Z")),
      write: () => undefined,
    });
    const filter = new ProblemDetailsFilter(logger);
    const respond = (exception: unknown, claimed: boolean, route?: string): void => {
      const response = {
        locals: {} as Record<string, unknown>,
        status() { return this; },
        type() { return this; },
        send() { return this; },
      };
      if (claimed) claimCompletionLog(response as never);
      const request = { method: "GET", baseUrl: "", ...(route ? { route: { path: route } } : {}) };
      filter.catch(exception, {
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      } as unknown as ArgumentsHost);
    };

    respond(new UnauthorizedException(), false, "/api/v1/auctions/:auctionId");
    respond(new NotFoundException("Cannot GET /api/v1/missing?secret=raw-query"), false);
    const cause = Object.assign(new Error("connection refused to db-host"), { code: "ECONNREFUSED" });
    respond(new ServiceUnavailableException(undefined, { cause }), false, "/api/v1/me/businesses");
    // interceptor가 맡은 응답은 finish 시점의 완료 로그가 있으므로 여기서 다시 남기면 두 줄이 된다.
    respond(new NotFoundException(), true, "/api/v1/auctions/:auctionId");

    const rejected = logger.records.filter((record) => record.event === "request_rejected");
    expect(rejected).toHaveLength(3);
    expect(rejected[0]).toMatchObject({
      level: "info",
      method: "GET",
      route: "/api/v1/auctions/:auctionId",
      status: 401,
      errorCode: "UNAUTHENTICATED",
    });
    expect(rejected[0]).not.toHaveProperty("errorName");
    expect(rejected[1]).toMatchObject({ route: "unmatched", status: 404, errorCode: "NOT_FOUND" });
    // 503만 원인 분류를 싣는다. 그래야 DB 장애와 인증을 켜지 않은 배포가 로그에서 갈린다.
    expect(rejected[2]).toMatchObject({
      status: 503,
      errorCode: "DEPENDENCY_UNAVAILABLE",
      causeClassification: "error",
      cause: { errorName: "Error", errorCode: "ECONNREFUSED" },
    });
    expect(logger.records.filter((record) => record.event === "request_defect")).toHaveLength(0);
    const serialized = JSON.stringify(logger.records);
    expect(serialized).not.toContain("raw-query");
    expect(serialized).not.toContain("db-host");
  });
});
