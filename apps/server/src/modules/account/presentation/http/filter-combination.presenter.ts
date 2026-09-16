/** @module 책임: 저장된 조건 조합 record와 조합 건수 결과를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import type {
  MyFilterCombinationCountsV1Response,
  MyFilterCombinationsV1Response,
  MyFilterCombinationV1Response,
} from "@eatbid/contracts";

import { bigintText, instantText, martBuildLineageWire } from "../../../../platform/http/wire";
import type { OpenAuctionFilterCountsResult } from "../../../procurement/application/count-open-auctions-for-filters";
import type { FilterCombinationRecord } from "../../application/filter-combination-repository";

/**
 * 빈 배열을 null로 바꿔 싣는다. 저장 자리에서 "안 골랐다"는 행이 없는 것이고, 화면이 `[]`과 `null`을
 * 다른 상태로 읽을 이유가 없다 — 목록 query의 필터 atom도 없으면 아예 안 보낸다.
 */
function emptyToNull<Value>(values: readonly Value[]): Value[] | null {
  return values.length === 0 ? null : [...values];
}

export function toFilterCombinationWire(record: FilterCombinationRecord): MyFilterCombinationV1Response["combination"] {
  return {
    filterCombinationId: bigintText(record.filterCombinationId),
    name: record.name,
    filter: {
      sido: bigintText(record.filter.sidoCodeValueId),
      sigungu: emptyToNull(record.filter.sigunguCodeValueIds.map((value) => bigintText(value))),
      items: emptyToNull(record.filter.itemLabels),
      baseAmountMin: record.filter.baseAmountMin,
      baseAmountMax: record.filter.baseAmountMax,
    },
    createdAt: instantText(record.createdAt),
  };
}

export function toMyFilterCombinationsResponse(
  records: readonly FilterCombinationRecord[],
): MyFilterCombinationsV1Response {
  return { combinations: records.map(toFilterCombinationWire) };
}

export function toMyFilterCombinationResponse(record: FilterCombinationRecord): MyFilterCombinationV1Response {
  return { combination: toFilterCombinationWire(record) };
}

/**
 * 저장된 조합의 건수를 **요청한 순서로** 다시 짝짓는다. 세는 쪽은 조합 이름을 모르고 위치만 알기
 * 때문이다 — 이름은 사용자 문자열이라 열 이름도 조인 키도 되지 않는다(AGENTS 2).
 */
export function toMyFilterCombinationCountsResponse(input: {
  readonly combinations: readonly FilterCombinationRecord[];
  readonly result: OpenAuctionFilterCountsResult;
}): MyFilterCombinationCountsV1Response {
  const { counts } = input.result;
  return {
    defaults: [
      { key: "regionAll", count: counts.regionAll },
      { key: "regionClosingToday", count: counts.regionClosingToday },
      { key: "noBids", count: counts.noBids },
      { key: "itemUnknownIncluded", count: counts.itemUnknownIncluded },
    ],
    saved: input.combinations.map((combination, index) => ({
      filterCombinationId: bigintText(combination.filterCombinationId),
      count: counts.saved[index] ?? 0,
    })),
    meta: {
      // 아홉 수 전부의 코호트다. 조합마다 다른 시각을 보면 옆의 수와 눌렀을 때의 목록이 어긋난다(AGENTS 7).
      asOf: instantText(input.result.asOf),
      openAuctionSnapshotBuild: martBuildLineageWire(counts.snapshotLineage),
    },
  };
}
