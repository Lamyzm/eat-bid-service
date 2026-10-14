import { describe, expect, test } from "bun:test";
import { baseRelativeBidRate, bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { RegisteredBusinessRecord, RegisteredSupplierEvidence } from "../../account/application/account-repository";
import { kstDate } from "../domain/kst-day";
import { AnalysisRegionNotFound, type AnalysisAxisLookup } from "./analysis-axes";
import type { FloorLineReader } from "./floor-line-reader";
import { FindMyFloorBids, type FindMyFloorBidsInput } from "./find-my-floor-bids";
import type { MyFloorBidReader } from "./my-floor-bid-reader";

const 입력: FindMyFloorBidsInput = {
  workspaceId: 7n,
  sigunguCodeValueId: 459n,
  period: { from: kstDate("2025-10-01"), to: kstDate("2026-09-30") },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
};

const 스냅샷 = { run: async (work: (handle: never) => Promise<unknown>) => work(undefined as never) } as unknown as UnitOfWork;
const 이름 = { regionLabel: async () => "김해시" } as unknown as FloorLineReader;
const 지역있음: AnalysisAxisLookup = { organizationExists: async () => true, regionExists: async () => true };

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

describe("하한선 자리 내 투찰 use case", () => {
  test("원본에서 확인된 등록 사업자만으로 투찰을 읽고 확인되지 않은 등록 수를 따로 센다", async () => {
    const asked: bigint[][] = [];
    const reader: MyFloorBidReader = {
      readBids: async (_snapshot, input) => {
        asked.push([...input.supplierPartyIds]);
        return [{
          attemptId: 11n,
          supplierPartyId: 1947n,
          supplierName: "가상축산",
          rate: baseRelativeBidRate(canonicalDecimal("90.3200", 4)),
          outcome: { kind: "valid", rank: 31, validBidderCount: 53, won: false },
        }];
      },
    };
    const result = await runner.run(new FindMyFloorBids(
      스냅샷,
      사업자들([등록({ kind: "linked", supplierPartyId: 1947n }), 등록({ kind: "unobserved" }), 등록({ kind: "evidence-conflict" })]),
      reader,
      이름,
      지역있음,
    ).execute(입력));
    expect(asked).toEqual([[1947n]]);
    expect(result.linkedBusinessCount).toBe(1);
    expect(result.unlinkedBusinessCount).toBe(2);
    expect(result.bids).toHaveLength(1);
    expect(result.regionLabel).toBe("김해시");
  });

  test("확인된 사업자가 없으면 명단을 읽지 않고 빈 목록과 그 수를 낸다", async () => {
    let reads = 0;
    const reader: MyFloorBidReader = { readBids: async () => { reads += 1; return []; } };
    const result = await runner.run(new FindMyFloorBids(스냅샷, 사업자들([등록({ kind: "unobserved" })]), reader, 이름, 지역있음)
      .execute(입력));
    expect(reads).toBe(0);
    expect(result).toMatchObject({ linkedBusinessCount: 0, unlinkedBusinessCount: 1, bids: [] });
  });

  test("없는 시군구는 지역 없음으로 실패하고 등록 사업자를 읽지 않는다", async () => {
    let listed = 0;
    const businesses = { list: async () => { listed += 1; return []; } } as unknown as RegisteredBusinessReader;
    const 없음: AnalysisAxisLookup = { organizationExists: async () => true, regionExists: async () => false };
    const outcome = runner.run(new FindMyFloorBids(스냅샷, businesses, { readBids: async () => [] }, 이름, 없음).execute(입력));
    await expect(outcome).rejects.toBeInstanceOf(AnalysisRegionNotFound);
    expect(listed).toBe(0);
  });
});
