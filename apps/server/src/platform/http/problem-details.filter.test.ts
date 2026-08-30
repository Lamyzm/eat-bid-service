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
import { ProblemDetailsFilter } from "./problem-details.filter";

describe("Problem Details mapping", () => {
  test("maps the complete operational status taxonomy without reflecting exception details", async () => {
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

  test("the exception filter emits application/problem+json for every status family", () => {
    const logger = new RedactingJsonLogger({ buildSha: "a".repeat(40), write: () => undefined });
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
});
