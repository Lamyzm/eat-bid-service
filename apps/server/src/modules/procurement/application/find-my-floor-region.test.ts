import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { RegisteredBusinessRecord, RegisteredSupplierEvidence } from "../../account/application/account-repository";
import { kstDate } from "../domain/kst-day";
import { ProcurementDependencyUnavailable } from "./failures";
import { FindMyFloorRegion, type FindMyFloorRegionInput } from "./find-my-floor-region";
import type { MyFloorRegionReader } from "./my-floor-bid-reader";

const 입력: FindMyFloorRegionInput = {
  workspaceId: 7n,
  period: { from: kstDate("2025-10-01"), to: kstDate("2026-10-15") },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
};

const 스냅샷 = { run: async (work: (handle: never) => Promise<unknown>) => work(undefined as never) } as unknown as UnitOfWork;

function 등록(supplier: RegisteredSupplierEvidence): RegisteredBusinessRecord {
  return {
    registeredBusinessId: 1n,
    businessNumber: "9000000016",
    registeredAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    supplier,
    location: null,
  };
}

function 사업자들(records: readonly RegisteredBusinessRecord[]): RegisteredBusinessReader {
  return { list: async () => records, find: async () => { throw new Error("쓰지 않는다"); } } as unknown as RegisteredBusinessReader;
}

const runner = new EffectRunner();

describe("내 업체 주 공고지역 use case", () => {
  test("원본에서 확인된 등록 사업자만으로 지역을 세고 KST 하루 경계로 창을 만든다", async () => {
    const asked: { from: string; before: string; floorRateMilli: bigint; parties: bigint[] }[] = [];
    const reader: MyFloorRegionReader = {
      readTopRegion: async (_snapshot, input) => {
        asked.push({
          from: input.window.from.toString(),
          before: input.window.before.toString(),
          floorRateMilli: input.window.floorRateMilli,
          parties: [...input.supplierPartyIds],
        });
        return { sidoCodeValueId: 40n, sidoLabel: "경남", sigunguCodeValueId: 459n, sigunguLabel: "김해시", roundCount: 1210 };
      },
    };
    const result = await runner.run(new FindMyFloorRegion(
      스냅샷,
      사업자들([등록({ kind: "linked", supplierPartyId: 1947n }), 등록({ kind: "linked", supplierPartyId: 1954n }), 등록({ kind: "unobserved" })]),
      reader,
    ).execute(입력));
    expect(asked).toEqual([{ from: "2025-09-30T15:00:00Z", before: "2026-10-15T15:00:00Z", floorRateMilli: 90_000n, parties: [1947n, 1954n] }]);
    expect(result.region?.sigunguLabel).toBe("김해시");
    expect([result.linkedBusinessCount, result.unlinkedBusinessCount]).toEqual([2, 1]);
  });

  test("확인된 사업자가 없으면 투찰을 읽지 않고 지역 없음과 그 수를 낸다", async () => {
    let reads = 0;
    const reader: MyFloorRegionReader = { readTopRegion: async () => { reads += 1; return null; } };
    const result = await runner.run(new FindMyFloorRegion(스냅샷, 사업자들([등록({ kind: "unobserved" })]), reader).execute(입력));
    expect(reads).toBe(0);
    expect(result.region).toBeNull();
    expect([result.linkedBusinessCount, result.unlinkedBusinessCount]).toEqual([0, 1]);
  });

  test("저장소를 읽지 못하면 의존성 실패로 낸다", async () => {
    const reader: MyFloorRegionReader = { readTopRegion: async () => { throw new Error("연결 끊김"); } };
    const outcome = runner.run(new FindMyFloorRegion(스냅샷, 사업자들([등록({ kind: "linked", supplierPartyId: 1947n })]), reader).execute(입력));
    await expect(outcome).rejects.toBeInstanceOf(ProcurementDependencyUnavailable);
  });
});
