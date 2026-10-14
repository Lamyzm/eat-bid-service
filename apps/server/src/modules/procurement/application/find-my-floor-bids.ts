/**
 * @module 책임: 요청자 워크스페이스의 등록 사업자로 하한선 자리 창 안의 내 투찰을 읽고, 원본에서 확인되지 않은 등록 수와 함께 조립한다.
 */
import { Effect } from "effect";
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import type { BidRate } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { AnalysisRegionNotFound, type AnalysisAxisLookup } from "./analysis-axes";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import type { FloorLinePeriodInput } from "./find-floor-lines";
import type { FloorLineReader } from "./floor-line-reader";
import type { MyFloorBidReader, MyFloorBidRecord } from "./my-floor-bid-reader";
import { kstDayAfter, kstDayStart } from "../domain/kst-day";

export interface FindMyFloorBidsInput {
  readonly workspaceId: bigint;
  readonly sigunguCodeValueId: bigint;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
}

export interface MyFloorBidsResult {
  readonly regionCodeValueId: bigint;
  readonly regionLabel: string | null;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
  readonly linkedBusinessCount: number;
  /** 원본 대조가 안 됐거나 증거가 갈린 등록 수다. 투찰이 없는 것과 못 찾은 것을 같은 빈 목록으로 말하지 않는다. */
  readonly unlinkedBusinessCount: number;
  readonly bids: readonly MyFloorBidRecord[];
}

function read<Value>(task: () => Promise<Value>): Effect.Effect<Value, ProcurementDependencyUnavailable, never> {
  return Effect.tryPromise({ try: task, catch: (cause) => new ProcurementDependencyUnavailable(cause) });
}

export class FindMyFloorBids {
  constructor(
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly reader: MyFloorBidReader,
    private readonly labels: FloorLineReader,
    private readonly axes: AnalysisAxisLookup,
  ) {}

  execute(input: FindMyFloorBidsInput): Effect.Effect<MyFloorBidsResult, ProcurementDependencyUnavailable | AnalysisRegionNotFound, never> {
    const scheme = CODE_SCHEME_NAMES.auctionLocationSigungu;
    const window = {
      from: kstDayStart(input.period.from),
      before: kstDayAfter(input.period.to),
      floorRateMilli: rateTextMilli(input.floorRate),
    };
    return read(() => this.axes.regionExists(scheme, input.sigunguCodeValueId)).pipe(
      Effect.flatMap((found) => found
        ? Effect.succeed(undefined)
        : Effect.fail(new AnalysisRegionNotFound(scheme, input.sigunguCodeValueId))),
      Effect.flatMap(() => read(async () => {
        const [regionLabel, facts] = await Promise.all([
          this.labels.regionLabel(input.sigunguCodeValueId),
          this.snapshot.run(async (snapshot) => {
            const businesses = await this.businesses.list(snapshot, input.workspaceId);
            const supplierPartyIds = businesses.flatMap((business) =>
              business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
            const bids = supplierPartyIds.length === 0
              ? []
              : await this.reader.readBids(snapshot, { window, sigunguCodeValueId: input.sigunguCodeValueId, supplierPartyIds });
            return { linked: supplierPartyIds.length, unlinked: businesses.length - supplierPartyIds.length, bids };
          }),
        ]);
        return {
          regionCodeValueId: input.sigunguCodeValueId,
          regionLabel,
          period: input.period,
          floorRate: input.floorRate,
          linkedBusinessCount: facts.linked,
          unlinkedBusinessCount: facts.unlinked,
          bids: facts.bids,
        };
      })),
    );
  }
}
