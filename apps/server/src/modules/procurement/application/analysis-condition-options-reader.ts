/** @module 책임: 분석 조건 막대가 고를 수 있는 지역·기관·품목과 그 건수를 읽는 port와 application record를 소유한다. */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { AnalysisCohortQuery, AnalysisRegionScheme } from "./analysis-time-series-reader";
import type { MartBuildLineage } from "./mart-build-lineage";

/**
 * 조건 사전 조회다. 코호트 조건은 시간축과 **같은 것**을 쓰고 두 가지만 더 받는다.
 *
 * `sido`는 그 시도 안의 시군구를 함께 세라는 뜻이고, `organizationQuery`는 기관 이름을 좁히는 말이다.
 * 기관 목록의 상한을 요청이 아니라 use case가 정하는 이유는 상한이 화면의 약속(더 적으라고 말하는
 * 자리)이지 호출자가 고를 값이 아니기 때문이다.
 */
export interface AnalysisConditionOptionsQuery extends AnalysisCohortQuery {
  readonly sido: bigint | null;
  readonly organizationQuery: string | null;
  readonly organizationLimit: number;
}

/** 지역 하나와 그 건수다. 라벨은 관측이라 없을 수 있고, 없다고 항목을 빼지 않는다(AGENTS 3). */
export interface AnalysisRegionCountRecord {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly scheme: AnalysisRegionScheme;
  readonly label: string | null;
  readonly count: number;
}

/** 겹쳐 찍을 수 있는 기관 하나다. 같은 이름의 학교가 여럿이라 어느 지역인지를 함께 싣는다. */
export interface AnalysisOrganizationOptionRecord {
  readonly organizationId: bigint;
  readonly name: string | null;
  readonly region: Omit<AnalysisRegionCountRecord, "count"> | null;
  readonly count: number;
}

export interface AnalysisItemCountRecord {
  readonly atom: AuctionItemAtom;
  readonly count: number;
}

/** 지금 고른 비교 지역이다. 전국이면 없다. */
export interface AnalysisSelectedRegionRecord {
  readonly region: Omit<AnalysisRegionCountRecord, "count">;
  readonly parentSidoCodeValueId: bigint | null;
}

/**
 * 한 번의 조회가 돌려주는 것 전부다. 지역과 품목의 건수는 **그 축 하나만 푼 집합**에서 센다 —
 * "이것으로 바꾸면 몇 건이 되나"를 말하는 수라 다른 축까지 함께 풀면 그 약속이 깨진다(EAT-241).
 *
 * 활성 build가 없으면 계보가 null이고 모든 수가 0이다. 그것은 오류가 아니라 파생물이 아직 없는
 * 상태이며, 화면은 시간축 쪽에서 이미 같은 사실을 듣는다(ADR 0011).
 */
export interface AnalysisConditionOptionsReading {
  readonly selectedRegion: AnalysisSelectedRegionRecord | null;
  readonly sido: readonly AnalysisRegionCountRecord[];
  readonly sigungu: readonly AnalysisRegionCountRecord[];
  readonly regionUnobservedCount: number;
  readonly items: readonly AnalysisItemCountRecord[];
  readonly itemUnknownCount: number;
  readonly organizations: readonly AnalysisOrganizationOptionRecord[];
  readonly organizationsTruncated: boolean;
  readonly lineage: MartBuildLineage | null;
}

export interface AnalysisConditionOptionsReader {
  readConditionOptions(query: AnalysisConditionOptionsQuery): Promise<AnalysisConditionOptionsReading>;
}
