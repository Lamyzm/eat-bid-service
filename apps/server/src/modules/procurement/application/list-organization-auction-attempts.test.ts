import { describe, expect, test } from "bun:test";
import { fixedClock, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { OrganizationAttemptPage, OrganizationAttemptQuery } from "./organization-attempt-reader";
import { organizationId } from "../domain/organization-id";

// 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034).
const lineage = {
  buildId: 501n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const emptyPage: OrganizationAttemptPage = { attempts: [], nextCursor: null, sampleCount: 0, lineage };
const query = { organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12, opened: "only" } as const;

// 개찰 기준 시각은 clock에서만 온다. 고정 clock이어야 reader에 넘긴 시각을 문자 그대로 검사할 수 있다.
const NOW = Temporal.Instant.from("2026-09-06T01:00:00Z");
const clock = fixedClock(NOW);

describe("ListOrganizationAuctionAttempts 조회 use case", () => {
  test("입력·reader query·페이지를 함께 돌려주고 페이지는 reader가 준 그대로다", async () => {
    const application = await import("./list-organization-auction-attempts").catch(() => undefined);
    expect(application, "기관 회차 이력 use case가 있어야 한다").toBeDefined();
    const useCase = new application!.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "page", page: emptyPage }),
    }, clock);
    const result = await new EffectRunner().run(useCase.execute(query));
    expect(result.input).toBe(query);
    expect(result.page).toBe(emptyPage);
    expect(result.query.organizationId).toBe(query.organizationId);
  });

  test("opened가 only면 clock 시각을 개찰 기준으로 reader에 넘기고 any면 기준 없이 읽는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const observed: OrganizationAttemptQuery[] = [];
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async (readerQuery) => {
        observed.push(readerQuery);
        return { kind: "page", page: emptyPage };
      },
    }, clock);
    const runner = new EffectRunner();
    const onlyOpened = await runner.run(useCase.execute(query));
    const anyAttempt = await runner.run(useCase.execute({ ...query, opened: "any" }));
    expect(observed.map((item) => item.openedAtOrBefore)).toEqual([NOW, null]);
    // 표본 수 0이 "개찰된 회차가 없다"인지 "회차 자체가 없다"인지는 presenter가 meta로 말해야 하므로
    // 실제로 비교한 기준을 결과에 그대로 남긴다(AGENTS 7).
    expect(onlyOpened.query.openedAtOrBefore).toBe(NOW);
    expect(anyAttempt.query.openedAtOrBefore).toBeNull();
  });

  test("품목을 지정한 조회는 reader query에 품목을 그대로 넘긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "page", page: emptyPage }),
    }, clock);
    const result = await new EffectRunner().run(useCase.execute({ ...query, itemCodeValueId: 7n }));
    expect(result.query.itemCodeValueId).toBe(7n);
  });

  test("기관이 없으면 OrganizationNotFound로 실패하고 목록은 읽지 않는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    let listed = 0;
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => false,
      listAttempts: async () => {
        listed += 1;
        throw new Error("unreachable");
      },
    }, clock);
    await expect(new EffectRunner().run(useCase.execute(query))).rejects.toMatchObject({
      name: "OrganizationNotFound",
      code: "ORGANIZATION_NOT_FOUND",
      organizationId: 42n,
    });
    expect(listed).toBe(0);
  });

  test("다른 기관이나 사라진 cursor는 AttemptCursorInvalid로 닫고 빈 목록으로 위장하지 않는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "cursor-not-found", cursor: 5_796_468n }),
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({ ...query, cursor: 5_796_468n })))
      .rejects.toMatchObject({
        name: "AttemptCursorInvalid",
        code: "VALIDATION_ERROR",
        organizationId: 42n,
        cursor: 5_796_468n,
      });
  });

  test("이어 읽기는 첫 페이지의 asOf를 그대로 기준으로 쓰고 build를 reader에 넘긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const observed: OrganizationAttemptQuery[] = [];
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async (readerQuery) => {
        observed.push(readerQuery);
        return { kind: "page", page: emptyPage };
      },
    }, clock);
    const pinned = Temporal.Instant.from("2026-09-05T00:00:00Z");
    const result = await new EffectRunner().run(useCase.execute({
      ...query,
      expectedBuildId: 501n,
      asOf: pinned,
    }));

    // clock을 다시 읽으면 그 사이 개찰된 회차가 누적 목록에 새로 끼어든다.
    expect(observed[0]?.openedAtOrBefore).toBe(pinned);
    expect(observed[0]?.expectedBuildId).toBe(501n);
    // 결과의 query가 실제로 비교한 기준을 들고 있어야 presenter가 소비자에게 같은 값을 되돌릴 수 있다.
    expect(result.query.openedAtOrBefore).toBe(pinned);
  });

  test("첫 페이지가 볼 수 없었던 미래 asOf는 요청 오류로 닫는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    let listed = 0;
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => { listed += 1; return true; },
      listAttempts: async () => ({ kind: "page", page: emptyPage }),
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({
      ...query,
      expectedBuildId: 501n,
      asOf: Temporal.Instant.from("2026-09-06T01:00:00.000000001Z"),
    }))).rejects.toMatchObject({ name: "AttemptAsOfInFuture", code: "VALIDATION_ERROR" });
    // 판정이 저장소보다 앞서야 잘못된 기준으로 만든 페이지가 애초에 만들어지지 않는다.
    expect(listed).toBe(0);
  });

  test("고정한 build가 활성이 아니면 cursor 오류가 아니라 재조회 충돌로 닫는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "build-changed", expectedBuildId: 501n, activeBuildId: 502n }),
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({ ...query, expectedBuildId: 501n, asOf: NOW })))
      .rejects.toMatchObject({
        name: "AttemptBuildChanged",
        code: "CONFLICT",
        expectedBuildId: 501n,
        activeBuildId: 502n,
      });
  });

  test("저장소 장애는 모듈 공통 ProcurementDependencyUnavailable로 번역하고 원문을 숨긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const runner = new EffectRunner();
    const existsFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => { throw new Error("credential=must-not-escape"); },
      listAttempts: async () => { throw new Error("unreachable"); },
    }, clock);
    await expect(runner.run(existsFailure.execute(query))).rejects.toMatchObject({
      name: "ProcurementDependencyUnavailable",
      code: "DEPENDENCY_UNAVAILABLE",
    });
    const listFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => { throw new Error("credential=must-not-escape"); },
    }, clock);
    const failure = await runner.run(listFailure.execute(query)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "ProcurementDependencyUnavailable", code: "DEPENDENCY_UNAVAILABLE" });
    expect(String(failure)).not.toContain("must-not-escape");
  });
});
