/**
 * @module 책임: 요청자 워크스페이스의 등록 사업자로 하한선 자리 창 안에서 투찰이 가장 많은 공고지역을 찾고, 원본에서 확인되지 않은 등록 수와 함께 조립한다.
 */
import { Effect } from "effect";
import type { BidRate } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import type { FloorLinePeriodInput } from "./find-floor-lines";
import type { MyFloorRegionReader, MyFloorRegionRecord } from "./my-floor-bid-reader";
import { kstDayAfter, kstDayStart } from "../domain/kst-day";

export interface FindMyFloorRegionInput {
  readonly workspaceId: bigint;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
}

export interface MyFloorRegionResult {
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
  readonly linkedBusinessCount: number;
  /** 원본 대조가 안 됐거나 증거가 갈린 등록 수다. 지역이 없는 까닭이 "투찰이 없음"인지 "사업자를 아직 못 찾음"인지 가른다. */
  readonly unlinkedBusinessCount: number;
  readonly region: MyFloorRegionRecord | null;
}

/**
 * 등록 사업자 목록과 투찰을 한 스냅샷에서 읽는다(복기·내 투찰과 같은 까닭). 지역 이름 조회도 같은 문장 안에서 해 결과 하나가 한
 * 시점의 사실이 되게 한다.
 */
export class FindMyFloorRegion {
  constructor(
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly reader: MyFloorRegionReader,
  ) {}

  execute(input: FindMyFloorRegionInput): Effect.Effect<MyFloorRegionResult, ProcurementDependencyUnavailable, never> {
    const window = {
      from: kstDayStart(input.period.from),
      before: kstDayAfter(input.period.to),
      floorRateMilli: rateTextMilli(input.floorRate),
    };
    return Effect.tryPromise({
      try: () => this.snapshot.run(async (snapshot) => {
        const businesses = await this.businesses.list(snapshot, input.workspaceId);
        const supplierPartyIds = businesses.flatMap((business) =>
          business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
        const region = supplierPartyIds.length === 0 ? null : await this.reader.readTopRegion(snapshot, { window, supplierPartyIds });
        return {
          period: input.period,
          floorRate: input.floorRate,
          linkedBusinessCount: supplierPartyIds.length,
          unlinkedBusinessCount: businesses.length - supplierPartyIds.length,
          region,
        };
      }),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    });
  }
}
