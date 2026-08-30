import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dir, "../../..");

describe("공개 운영 계약", () => {
  test("health와 Problem Details 계약의 범위를 제한한다", async () => {
    const module = await import("./index").catch(() => undefined);
    expect(module, "contracts package must publish operational schemas").toBeDefined();
    expect(module!.liveHealthSchema.safeParse({ status: "live" }).success).toBe(true);
    expect(module!.liveHealthSchema.safeParse({ status: "live", secret: true }).success).toBe(false);
    expect(module!.problemDetailsSchema.safeParse({
      type: "https://eatbid.dev/problems/internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: "req-1",
      secret: true,
    }).success).toBe(false);
    expect(module!.healthOperations.live).toMatchObject({
      controllerPath: "health",
      handlerPath: "live",
      path: "/health/live",
    });
    expect(module!.healthOperations.ready).toMatchObject({
      controllerPath: "health",
      handlerPath: "ready",
      path: "/health/ready",
    });
    expect(module!.auctionV1Operations.find).toMatchObject({
      handlerPath: ":auctionId",
      path: "/api/v1/auctions/{auctionId}",
      operationId: "findAuction",
    });
    expect("auctionOperations" in module!).toBe(false);
    expect("auctionResponseSchema" in module!).toBe(false);
    expect("AuctionResponse" in module!).toBe(false);
    expect(module!.auctionV1ResponseSchema).toBeDefined();
    expect(module!.auctionV1Operations.find.responseSchema).toBe(module!.auctionV1ResponseSchema);
    expect(module!.moneyCodec).toBeDefined();
    expect(module!.instantCodec).toBeDefined();
  });

  test("제거한 TypeScript 전용 AuctionResponse는 consumer가 import할 수 없다", () => {
    const fixture = resolve(import.meta.dir, "../fixtures/removed-auction-response.consumer.ts");
    const program = ts.createProgram({
      rootNames: [fixture],
      options: {
        baseUrl: repositoryRoot,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        paths: { "@eatbid/contracts": ["packages/contracts/src/index.ts"] },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const fixtureDiagnostics = ts.getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file
        && resolve(diagnostic.file.fileName).toLowerCase() === resolve(fixture).toLowerCase());

    expect(fixtureDiagnostics).toHaveLength(1);
    expect([2305, 2724]).toContain(fixtureDiagnostics[0]!.code);
    expect(ts.flattenDiagnosticMessageText(fixtureDiagnostics[0]!.messageText, "\n"))
      .toContain("has no exported member");
    expect(ts.flattenDiagnosticMessageText(fixtureDiagnostics[0]!.messageText, "\n"))
      .toContain("AuctionResponse");
  });
});
